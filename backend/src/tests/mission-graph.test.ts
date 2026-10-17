import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as m from "../graph/mission-graph.js";
import {
  DEV_ID,
  SKIP_DB,
  getTestGraph,
  closeTestGraph,
  q,
  developerExists,
  findBadNumbers,
} from "./graph-test-helpers.js";

const good: m.EvaluationRecord = {
  missionId: "m1",
  developerId: "d",
  headCommit: "abc",
  verdict: "completed",
  ciState: "success",
  results: [
    { id: "c1", met: true, verified: true, quote: "x", reasoning: "y" },
  ],
  scopeWarnings: [],
  changedFiles: ["a.ts"],
  summary: "ok",
  demonstration: {
    capabilityId: "retry_backoff",
    technique: "retry",
    summary: "s",
    depth: "working",
    path: "a.ts",
    permalink: "",
    commitSubject: "feat",
  },
};

// ============================================================
// PURE: the rule that decides whether a mission counts as proof
// ============================================================
describe("mission-graph: verifyEvaluation (pure)", () => {
  it("a fully met, verified, CI-green evaluation with a demonstration is verified", () => {
    const v = m.verifyEvaluation(good);
    assert.equal(v.verified, true);
    assert.equal(v.state, "verified");
  });

  const failing: Array<[string, Partial<m.EvaluationRecord>, RegExp]> = [
    ["needs_work verdict", { verdict: "needs_work" }, /not completed/],
    ["no criteria", { results: [] }, /no criteria/],
    [
      "unmet criterion",
      {
        results: [
          { id: "c1", met: false, verified: false, quote: "", reasoning: "" },
        ],
      },
      /not met/,
    ],
    [
      "met but not verified against the diff",
      {
        results: [
          { id: "c1", met: true, verified: false, quote: "", reasoning: "" },
        ],
      },
      /not verified/,
    ],
    ["CI failed", { ciState: "failure" }, /CI failed/],
    ["CI pending", { ciState: "pending" }, /pending/],
    ["no demonstration", { demonstration: null }, /no demonstration/],
  ];
  for (const [name, patch, reason] of failing) {
    it(`is NOT verified when: ${name}`, () => {
      const v = m.verifyEvaluation({ ...good, ...patch });
      assert.equal(v.verified, false);
      assert.equal(v.state, "evaluated");
      assert.ok(
        v.reasons.some((r) => reason.test(r)),
        `reasons: ${v.reasons}`,
      );
    });
  }

  it("CI 'none' (no CI configured) is acceptable", () => {
    assert.equal(
      m.verifyEvaluation({ ...good, ciState: "none" }).verified,
      true,
    );
  });

  it("reports every reason at once, not only the first", () => {
    const v = m.verifyEvaluation({
      ...good,
      verdict: "needs_work",
      ciState: "failure",
      demonstration: null,
    });
    assert.ok(v.reasons.length >= 3);
  });
});

describe("mission-graph: small pure pieces", () => {
  it("newMissionId is stable and includes goal, move version and sequence", () => {
    const id = m.newMissionId("goal:1:x", "v2", 3);
    assert.equal(id, m.newMissionId("goal:1:x", "v2", 3));
    assert.notEqual(id, m.newMissionId("goal:1:x", "v2", 4));
    assert.ok(
      id.includes("goal:1:x") && id.includes("v2") && id.endsWith(":3"),
    );
  });

  it("only unfinished statuses can be evaluated", () => {
    for (const s of [
      "proposed",
      "in_progress",
      "submitted",
      "needs_work",
    ] as const)
      assert.ok(m.EVALUABLE.includes(s), s);
    for (const s of ["completed", "abandoned"] as const)
      assert.ok(!m.EVALUABLE.includes(s), s);
  });
});

// ============================================================
// LIVE (read-only)
// ============================================================
describe("mission-graph: live graph", { skip: SKIP_DB }, () => {
  let graph: Awaited<ReturnType<typeof getTestGraph>>;
  let goalIds: string[] = [];

  before(async () => {
    graph = await getTestGraph();
    goalIds = (
      await q(
        graph,
        `MATCH (:Developer {id:$d})-[:HAS_GOAL]->(g:Goal) RETURN g.id AS id`,
        { d: DEV_ID },
      )
    ).map((r) => String(r.id));
  });
  after(closeTestGraph);

  it("developer exists", async () => {
    assert.ok(await developerExists(graph), `Developer ${DEV_ID} not found`);
  });

  it("saved moves load completely and cite only their own evidence", async (t) => {
    if (!goalIds.length) return t.skip("developer has no goals yet");
    for (const goalId of goalIds) {
      const saved = await m.loadSavedMove(graph, DEV_ID, goalId);
      if (!saved) {
        console.log(`[info] ${goalId} has no NextMove`);
        continue;
      }
      assert.equal(saved.developerId, DEV_ID);
      assert.equal(saved.goalId, goalId);
      assert.ok(
        saved.title && saved.nextMoveId && saved.moveVersion,
        `${goalId}: incomplete move`,
      );
      const refs = saved.evidence.map((e) => e.ref);
      assert.equal(
        new Set(refs).size,
        refs.length,
        `${goalId}: duplicate evidence refs`,
      );
      assert.ok(refs.every((r) => /^E\d+$/.test(r)));
      assert.ok(
        saved.trace.length > 0,
        "the load must record the queries it ran",
      );
      assert.deepEqual(findBadNumbers(saved), []);
      if (saved.capability) {
        const [r] = await q(
          graph,
          `MATCH (c:Capability {id:$c}) RETURN count(c) AS n`,
          { c: saved.capability.id },
        );
        assert.equal(
          Number(r.n),
          1,
          `${goalId}: move targets a capability that does not exist`,
        );
      }
      if (saved.startFileChangeId) {
        const [r] = await q(
          graph,
          `MATCH (fc:FileChange {id:$f}) RETURN count(fc) AS n`,
          { f: saved.startFileChangeId },
        );
        assert.equal(
          Number(r.n),
          1,
          `${goalId}: move starts at a FileChange that does not exist`,
        );
      }
    }
  });

  it("missions belong to this developer and round-trip through loadMission", async (t) => {
    if (!goalIds.length) return t.skip("developer has no goals yet");
    let seen = 0;
    for (const goalId of goalIds) {
      const list = await m.listGoalMissions(graph, DEV_ID, goalId);
      const created = list.map((x: any) => String(x.createdAt ?? ""));
      assert.deepEqual(
        [...created].sort().reverse(),
        created,
        `${goalId}: missions must be newest first`,
      );
      for (const mission of list) {
        seen += 1;
        const again = await m.loadMission(graph, DEV_ID, mission.id);
        assert.ok(again, `${mission.id}: listed but cannot be loaded`);
        assert.equal(again.id, mission.id);
        assert.ok(
          Array.isArray(m.EVALUABLE) && typeof mission.status === "string",
        );
      }
    }
    if (!seen) console.log("[info] developer has goals but no missions yet");
  });

  it("another developer's id can never load this developer's mission", async (t) => {
    const [row] = await q(
      graph,
      `MATCH (:Developer {id:$d})-[:ASSIGNED]->(x:Mission) RETURN x.id AS id LIMIT 1`,
      { d: DEV_ID },
    );
    if (!row) return t.skip("developer has no missions");
    assert.equal(
      await m.loadMission(graph, "999999999999", String(row.id)),
      null,
    );
    assert.equal(
      await m.loadLatestEvaluation(graph, "999999999999", String(row.id)),
      null,
    );
  });

  it("latest evaluation is consistent with the verification rule", async (t) => {
    const rows = await q(
      graph,
      `MATCH (:Developer {id:$d})-[:ASSIGNED]->(x:Mission)-[:EVALUATED_AS]->(:Evaluation) RETURN DISTINCT x.id AS id, x.status AS status, x.verification_state AS vs`,
      { d: DEV_ID },
    );
    if (!rows.length) return t.skip("developer has no evaluated missions");
    for (const r of rows) {
      const ev = await m.loadLatestEvaluation(graph, DEV_ID, String(r.id));
      assert.ok(ev, `${r.id}: evaluation missing`);
      // loadLatestEvaluation does not restore the demonstration, so only the stored flag can be compared
      if (String(r.vs) === "verified") {
        assert.equal(
          ev.verdict,
          "completed",
          `${r.id}: verified mission with a non-completed verdict`,
        );
        assert.ok(
          ev.results.length > 0 && ev.results.every((x) => x.met && x.verified),
          `${r.id}: verified but criteria are not all met and verified`,
        );
        assert.notEqual(ev.ciState, "failure");
        assert.notEqual(ev.ciState, "pending");
      }
    }
  });

  it("every verified mission has a mission demonstration in the graph", async (t) => {
    const verified = await m.readVerifiedMissions(graph, DEV_ID);
    if (!verified.length) return t.skip("developer has no verified missions");
    for (const v of verified) {
      const [r] = await q(
        graph,
        `MATCH (:Developer {id:$d})-[:DEMONSTRATED]->(x:Demonstration {id:$x}) WHERE x.source = "mission" RETURN count(x) AS n`,
        { d: DEV_ID, x: v.demonstrationId },
      );
      assert.equal(
        Number(r.n),
        1,
        `${v.missionId}: verified but its Demonstration ${v.demonstrationId} is missing`,
      );
    }
    const bySlug = verified[0].topicSlug
      ? await m.readVerifiedMissions(graph, DEV_ID, verified[0].topicSlug)
      : verified;
    assert.ok(
      bySlug.every(
        (x) => !verified[0].topicSlug || x.topicSlug === verified[0].topicSlug,
      ),
    );
  });

  it("no mission demonstration exists without a verified mission behind it", async () => {
    const verified = new Set(
      (await m.readVerifiedMissions(graph, DEV_ID)).map(
        (v) => v.demonstrationId,
      ),
    );
    const rows = await q(
      graph,
      `MATCH (:Developer {id:$d})-[:DEMONSTRATED]->(x:Demonstration) WHERE x.source = "mission" RETURN x.id AS id`,
      { d: DEV_ID },
    );
    const orphans = rows
      .map((r) => String(r.id))
      .filter((id) => !verified.has(id));
    assert.deepEqual(
      orphans,
      [],
      "mission demonstrations that no verified mission explains (evidence that was never retracted?)",
    );
  });

  it("stale topic assessments name a topic and a reason", async () => {
    for (const s of await m.readStaleTopicAssessments(graph, DEV_ID)) {
      assert.ok(
        s.topicSlug && s.reason,
        "stale assessment without slug or reason",
      );
    }
  });
});
