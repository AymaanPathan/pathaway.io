import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as j from "../graph/developer-journey-graph.js";
import {
  DEV_ID,
  SKIP_DB,
  getTestGraph,
  closeTestGraph,
  q,
  developerExists,
  assessedTopicSlugs,
  findBadNumbers,
  isSortedBy,
} from "./graph-test-helpers.js";

const LEVEL_RANK: Record<j.CapLevel, number> = {
  missing: -1,
  insufficient_evidence: 0,
  usage: 1,
  repeated_usage: 2,
  implementation: 3,
  strong: 4,
};

const cap = (over: Partial<j.BuiltCapability>): j.BuiltCapability => ({
  capabilityId: "c",
  name: "Cap",
  description: "",
  domainId: "d",
  domain: "Domain",
  level: "usage",
  state: "partial",
  recency: "recent",
  bestDepth: "usage",
  evidenceCount: 5,
  commitCount: 3,
  repoCount: 1,
  activeDays: 4,
  firstSeen: "",
  lastSeen: "",
  techniques: [],
  experiences: [],
  proofs: [],
  ...over,
});

// ============================================================
// PURE
// ============================================================
describe("developer-journey-graph: pure logic", () => {
  it("evidenceStateFor maps every level", () => {
    const expected: Record<j.CapLevel, j.EvidenceState> = {
      strong: "demonstrated",
      implementation: "demonstrated",
      repeated_usage: "partial",
      usage: "partial",
      insufficient_evidence: "unverified",
      missing: "missing",
    };
    for (const [level, state] of Object.entries(expected))
      assert.equal(j.evidenceStateFor(level as j.CapLevel), state, level);
  });

  it("levelsInStates returns exactly the levels of those states", () => {
    assert.deepEqual(
      new Set(j.levelsInStates(["demonstrated"])),
      new Set(["implementation", "strong"]),
    );
    assert.deepEqual(
      new Set(j.levelsInStates(["partial", "unverified"])),
      new Set(["usage", "repeated_usage", "insufficient_evidence"]),
    );
  });

  it("deriveStrengths: tiers, tentative flag, ordering", () => {
    const strengths = j.deriveStrengths([
      cap({
        capabilityId: "a",
        name: "A",
        level: "strong",
        evidenceCount: 10,
        commitCount: 4,
      }),
      cap({
        capabilityId: "b",
        name: "B",
        level: "implementation",
        evidenceCount: 2,
        commitCount: 1,
      }),
      cap({
        capabilityId: "c",
        name: "C",
        level: "repeated_usage",
        evidenceCount: 6,
        commitCount: 3,
      }),
      cap({ capabilityId: "d", name: "D", level: "usage" }),
      cap({ capabilityId: "e", name: "E", level: "insufficient_evidence" }),
    ]);
    assert.deepEqual(
      strengths.map((s) => s.capabilityId),
      ["a", "b", "c"],
      "usage / lone sightings are not strengths",
    );
    assert.deepEqual(
      strengths.map((s) => s.tier),
      ["core", "solid", "emerging"],
    );
    assert.deepEqual(
      strengths.map((s) => s.tentative),
      [false, true, false],
    );
    assert.match(strengths[1].reason, /tentative/);
    assert.match(strengths[2].reason, /mechanism itself was not detected/);
  });

  it("deriveFrontierStatus mirrors the rules", () => {
    assert.equal(j.deriveFrontierStatus("strong", []), "demonstrated");
    assert.equal(j.deriveFrontierStatus("missing", []), "eligible");
    assert.equal(
      j.deriveFrontierStatus("usage", [
        { level: "strong" },
        { level: "implementation" },
      ]),
      "eligible",
    );
    assert.equal(
      j.deriveFrontierStatus("usage", [
        { level: "strong" },
        { level: "usage" },
      ]),
      "blocked",
    );
    assert.equal(
      j.deriveFrontierStatus("missing", [{ level: "repeated_usage" }]),
      "blocked",
      "repeated usage is not a built mechanism",
    );
  });

  it("eligibleNextSteps keeps only eligible nodes", () => {
    const nodes = [
      { status: "eligible" },
      { status: "blocked" },
      { status: "demonstrated" },
    ] as j.FrontierNode[];
    assert.deepEqual(
      j.eligibleNextSteps(nodes).map((n) => n.status),
      ["eligible"],
    );
  });

  it("evaluateCapabilityCriteria: missing evidence can only make it false", () => {
    assert.equal(j.evaluateCapabilityCriteria("strong", []).met, false);
    const tech = (built: number, seen: boolean): j.TechniqueCriterion => ({
      ruleId: "r",
      technique: "retry",
      built,
      bestDepth: "implementation",
      permalink: "",
      path: "",
      safeguards: [{ label: "max attempts", seen }],
    });
    assert.equal(
      j.evaluateCapabilityCriteria("strong", [tech(2, true)]).met,
      true,
    );
    const unseen = j.evaluateCapabilityCriteria("strong", [tech(2, false)]);
    assert.equal(unseen.met, false);
    assert.ok(unseen.unmet.some((u) => u.includes("max attempts")));
    assert.equal(
      j.evaluateCapabilityCriteria("usage", [tech(2, true)]).met,
      false,
    );
    assert.equal(
      j.evaluateCapabilityCriteria("strong", [tech(0, false)]).met,
      false,
    );
  });

  it("isGoalComplete", () => {
    const done = {
      status: "demonstrated",
      requiredByGoal: true,
      criteriaMet: true,
    } as const;
    assert.equal(j.isGoalComplete([], []), false);
    assert.equal(j.isGoalComplete([done], []), true);
    assert.equal(j.isGoalComplete([done], ["unsupported thing"]), false);
    assert.equal(
      j.isGoalComplete([{ ...done, requiredByGoal: false }], []),
      false,
      "no required node",
    );
    assert.equal(
      j.isGoalComplete([done, { ...done, status: "eligible" }], []),
      false,
    );
    assert.equal(
      j.isGoalComplete([{ ...done, criteriaMet: false }], []),
      false,
    );
  });

  it("GRAPH_MODEL documents each relationship once", () => {
    const types = j.GRAPH_MODEL.relationships.map((r) => r.type);
    assert.equal(new Set(types).size, types.length);
  });
});

// ============================================================
// LIVE
// ============================================================
describe("developer-journey-graph: live graph", { skip: SKIP_DB }, () => {
  let graph: Awaited<ReturnType<typeof getTestGraph>>;
  let journey: j.Journey | null = null;
  let slugs: string[] = [];

  before(async () => {
    graph = await getTestGraph();
    journey = await j.readJourney(graph, DEV_ID);
    slugs = await assessedTopicSlugs(graph, 3);
  });
  after(closeTestGraph);

  it("developer exists and journey loads", async () => {
    assert.ok(await developerExists(graph), `Developer ${DEV_ID} not found`);
    assert.ok(journey, "readJourney returned null");
    assert.deepEqual(findBadNumbers(journey), []);
  });

  it("the graph model only documents relationship types that exist (core ones must)", async () => {
    const r = await q(
      graph,
      `CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType AS t`,
    );
    const inDb = new Set(r.map((x) => String(x.t)));
    for (const core of [
      "AUTHORED_CODE",
      "DEMONSTRATED",
      "OF_CAPABILITY",
      "HAS_CAPABILITY",
      "EXPERIENCED",
      "SUPPORTED_BY",
    ])
      assert.ok(
        inDb.has(core),
        `core relationship ${core} is missing from the database`,
      );
    const missing = j.GRAPH_MODEL.relationships
      .map((x) => x.type)
      .filter((t) => !inDb.has(t));
    if (missing.length)
      console.log(
        `[info] documented but not in this graph yet: ${missing.join(", ")}`,
      );
  });

  describe("journey sections", () => {
    it("summary counts match the lists", () => {
      const jr = journey!;
      assert.equal(jr.summary.capabilitiesWithEvidence, jr.capabilities.length);
      assert.equal(
        jr.summary.built,
        jr.capabilities.filter((c) => c.state === "demonstrated").length,
      );
      assert.equal(
        jr.summary.partial,
        jr.capabilities.filter((c) => c.state === "partial").length,
      );
      assert.equal(jr.summary.strengths, jr.strengths.length);
    });

    it("capabilities: state matches level, sorted strongest first, counts coherent", () => {
      const caps = journey!.capabilities;
      for (const c of caps) {
        assert.equal(
          c.state,
          j.evidenceStateFor(c.level),
          `${c.capabilityId}: state/level`,
        );
        assert.ok(
          c.commitCount <= c.evidenceCount || c.evidenceCount === 0,
          `${c.capabilityId}: more commits than detections`,
        );
        if (c.firstSeen && c.lastSeen)
          assert.ok(
            c.firstSeen <= c.lastSeen,
            `${c.capabilityId}: first > last`,
          );
        assert.ok(c.proofs.length <= 3);
      }
      assert.ok(
        isSortedBy(caps, (c) => LEVEL_RANK[c.level], "desc"),
        "capabilities not sorted by level",
      );
    });

    it("strengths equal deriveStrengths(capabilities)", () => {
      assert.deepEqual(
        journey!.strengths,
        j.deriveStrengths(journey!.capabilities),
      );
    });

    it("domains roll up their capabilities", () => {
      for (const d of journey!.domains) {
        const inDomain = journey!.capabilities.filter(
          (c) => c.domainId === d.domainId,
        );
        assert.equal(d.touched, inDomain.length, d.domain);
        assert.equal(
          d.built,
          inDomain.filter((c) => c.state === "demonstrated").length,
          d.domain,
        );
        assert.equal(
          d.evidence,
          inDomain.reduce((n, c) => n + c.evidenceCount, 0),
          d.domain,
        );
      }
    });

    it("timeline months are YYYY-MM and sorted", () => {
      const t = journey!.timeline;
      assert.ok(t.every((p) => /^\d{4}-\d{2}$/.test(p.month)));
      assert.ok(t.every((p, i) => i === 0 || t[i - 1].month <= p.month));
    });

    it("self totals match direct counts in the graph", async () => {
      const [w] = await q(
        graph,
        `MATCH (:Developer {id:$d})-[:AUTHORED_CODE]->(fc:FileChange)
        RETURN count(fc) AS files, count(DISTINCT fc.commit_sha) AS commits, count(DISTINCT fc.repository_id) AS repos`,
        { d: DEV_ID },
      );
      const [x] = await q(
        graph,
        `MATCH (:Developer {id:$d})-[:DEMONSTRATED]->(x:Demonstration) RETURN count(x) AS n`,
        { d: DEV_ID },
      );
      const [e] = await q(
        graph,
        `MATCH (:Developer {id:$d})-[:EXPERIENCED]->(e:Experience) RETURN count(e) AS n`,
        { d: DEV_ID },
      );
      const t = journey!.self.totals;
      assert.equal(t.fileChanges, Number(w.files));
      assert.equal(t.commits, Number(w.commits));
      assert.equal(t.repositories, Number(w.repos));
      assert.equal(t.demonstrations, Number(x.n));
      assert.equal(t.experiences, Number(e.n));
    });

    it("coverage agrees with the totals", () => {
      const c = journey!.coverage;
      if (!c.known)
        return console.log("[info] coverage unknown for this developer");
      if (c.source === "file_changes")
        assert.equal(c.repositories, journey!.self.totals.repositories);
      assert.ok(c.incomplete <= c.repositories);
    });

    it("every section has provenance and limitations are given", () => {
      assert.ok(journey!.provenance.length >= 5);
      for (const s of journey!.provenance)
        assert.ok(s.explanation.length > 20, `${s.section}: empty explanation`);
      assert.ok(journey!.limitations.length > 0);
      assert.ok(journey!.howFalkorDBAnswered.length > 50);
    });

    it("HAS_CAPABILITY roll-up equals a recount of the Demonstration nodes", async (t) => {
      const leaves = journey!.capabilities.slice(0, 12);
      if (!leaves.length) return t.skip("no capabilities");
      for (const c of leaves) {
        const [r] = await q(
          graph,
          `MATCH (:Developer {id:$d})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability {id:$c}) RETURN count(x) AS n`,
          { d: DEV_ID, c: c.capabilityId },
        );
        assert.equal(
          c.evidenceCount,
          Number(r.n),
          `${c.capabilityId}: roll-up says ${c.evidenceCount}, graph has ${r.n}. The roll-up is stale: rebuild the overview graph.`,
        );
      }
    });
  });

  describe("focused readers", () => {
    it("readBuiltCapabilities honours minLevel", async () => {
      const all = await j.readBuiltCapabilities(graph, DEV_ID);
      const built = await j.readBuiltCapabilities(graph, DEV_ID, {
        minLevel: "implementation",
      });
      assert.ok(
        built.every((c) => LEVEL_RANK[c.level] >= LEVEL_RANK.implementation),
      );
      assert.equal(
        built.length,
        all.filter((c) => LEVEL_RANK[c.level] >= 3).length,
      );
    });

    it("readCapabilityTrace for the strongest capability", async (t) => {
      const top = journey!.capabilities[0];
      if (!top) return t.skip("no capabilities");
      const trace = await j.readCapabilityTrace(
        graph,
        DEV_ID,
        top.capabilityId,
        5,
      );
      assert.ok(!("error" in trace), "error" in trace ? trace.error : "");
      assert.ok(trace.demonstrations.length <= 5);
      assert.equal(trace.evidenceCount, top.evidenceCount);
      assert.ok(
        trace.demonstrations.every(
          (d) => d.permalink.startsWith("http") || d.permalink === "",
        ),
      );
    });

    it("unknown capability / empty repository give an error object, not a crash", async () => {
      assert.ok(
        "error" in
          (await j.readCapabilityTrace(
            graph,
            DEV_ID,
            "no_such_capability_xyz",
          )),
      );
      assert.ok("error" in (await j.readRepositoryTrace(graph, DEV_ID, "  ")));
    });

    it("readRepositoryTrace finds the top repository", async (t) => {
      const repo = journey!.repositories[0]?.name;
      if (!repo) return t.skip("no repositories with evidence");
      const trace = await j.readRepositoryTrace(graph, DEV_ID, repo);
      assert.ok(!("error" in trace));
      assert.ok(trace.matches.some((m) => m.repository === repo));
    });

    it("findCapabilitiesForText returns real, unique leaf capabilities", async () => {
      const hits = await j.findCapabilitiesForText(
        graph,
        "redis caching latency",
      );
      assert.equal(new Set(hits.map((h) => h.capabilityId)).size, hits.length);
      assert.ok(isSortedBy(hits, (h) => h.score, "desc"));
      assert.deepEqual(
        await j.findCapabilitiesForText(
          graph,
          "I want to become a better engineer",
        ),
        [],
        "only stopwords must yield nothing",
      );
    });
  });

  describe("topic view", () => {
    it("topic experiences carry provenance", async (t) => {
      if (!slugs[0]) return t.skip("no assessed topics");
      const exps = await j.readTopicExperiences(graph, DEV_ID, slugs[0]);
      for (const e of exps) {
        assert.equal(e.evidenceCount, e.demonstrationIds.length);
        assert.ok(e.linkConfidence >= 0 && e.linkConfidence <= 1);
      }
      if (exps[0]) {
        const prov = await j.readExperienceProvenance(
          graph,
          DEV_ID,
          exps[0].experienceId,
        );
        assert.ok(
          prov.length >= exps[0].evidenceCount,
          "provenance shorter than the experience's evidence",
        );
        assert.ok(
          prov.every((p, i) => i === 0 || prov[i - 1].createdAt <= p.createdAt),
          "provenance must be oldest first",
        );
      }
    });

    it("topic history events are ordered and the explanation is honest", async (t) => {
      if (!slugs[0]) return t.skip("no assessed topics");
      const h = await j.readTopicHistory(graph, DEV_ID, slugs[0]);
      assert.equal(h.slug, slugs[0]);
      assert.ok(
        h.events.every((e, i) => i === 0 || h.events[i - 1].when <= e.when),
      );
      if (!h.timeline.length)
        assert.match(h.explanation, /No implementation evidence/);
    });
  });

  describe("goal frontier", () => {
    let frontier: j.FrontierNode[] | null = null;
    before(async () => {
      frontier = await j.readFrontierChecked(graph, DEV_ID);
    });

    it("query succeeds", () =>
      assert.ok(frontier, "frontier query FAILED (check logs)"));

    it("status in the database agrees with the pure deriveFrontierStatus", () => {
      for (const n of frontier!) {
        assert.equal(
          n.status,
          j.deriveFrontierStatus(n.level, n.prerequisites),
          `${n.capabilityId}: query says ${n.status}`,
        );
        assert.equal(n.state, j.evidenceStateFor(n.level));
      }
    });

    it("eligible nodes have every prerequisite satisfied, blocked ones have at least one gap", () => {
      for (const n of frontier!) {
        if (n.status === "eligible")
          assert.ok(
            n.prerequisites.every((p) => p.satisfied),
            `${n.capabilityId} eligible with an unmet prerequisite`,
          );
        if (n.status === "blocked")
          assert.ok(
            n.prerequisites.some((p) => !p.satisfied),
            `${n.capabilityId} blocked but nothing blocks it`,
          );
        if (n.status === "demonstrated")
          assert.ok(["implementation", "strong"].includes(n.level));
      }
    });

    it("every capability id appears once and criteria flags are coherent", () => {
      const ids = frontier!.map((n) => n.capabilityId);
      assert.equal(new Set(ids).size, ids.length);
      for (const n of frontier!)
        assert.equal(
          n.criteriaMet,
          n.unmetCriteria.length === 0,
          n.capabilityId,
        );
    });

    it("directions never suggest something already built", async () => {
      const built = new Set(
        journey!.capabilities
          .filter((c) => c.state === "demonstrated")
          .map((c) => c.capabilityId),
      );
      for (const d of await j.readDirections(graph, DEV_ID))
        for (const m of d.moves) {
          assert.ok(
            !built.has(m.capabilityId),
            `${m.capabilityId} is already demonstrated`,
          );
          assert.equal(m.kind, m.state === "partial" ? "deepen" : "extend");
          assert.ok(
            m.builtOn.every((p) =>
              ["implementation", "strong"].includes(p.level),
            ),
            `${m.capabilityId}: suggested without its prerequisites built`,
          );
        }
    });
  });
});
