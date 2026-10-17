import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as goal from "../graph/goal-graph.js";
import {
  DEV_ID,
  SKIP_DB,
  WRITES,
  getTestGraph,
  closeTestGraph,
  q,
  developerExists,
  assessedTopicSlugs,
  findBadNumbers,
  isSortedBy,
} from "./graph-test-helpers.js";

// ============================================================
// PURE
// ============================================================
describe("goal-graph: pure logic", () => {
  it("wishTokens drops filler words and keeps the subject", () => {
    assert.deepEqual(goal.wishTokens("I want to get better at Redis caching"), [
      "redis",
      "caching",
    ]);
    assert.deepEqual(goal.wishTokens("I want to become a better engineer"), []);
    assert.deepEqual(
      goal.wishTokens("redis redis REDIS"),
      ["redis"],
      "tokens must be unique",
    );
  });

  it("levelRank orders depth levels and READY_RANK means 'working'", () => {
    assert.ok(goal.levelRank("none") < goal.levelRank("surface"));
    assert.ok(goal.levelRank("surface") < goal.levelRank("working"));
    assert.ok(goal.levelRank("proficient") < goal.levelRank("deep"));
    assert.equal(goal.levelRank("working"), goal.READY_RANK);
  });

  describe("personalizedPageRank", () => {
    const nodes = ["a", "b", "c", "island"];
    const edges = [
      { from: "a", to: "b", weight: 1 },
      { from: "b", to: "c", weight: 1 },
    ];

    // edges are treated as UNDIRECTED by the implementation, so a hub can outscore the restart node
    it("scores sum to 1", () => {
      const pr = goal.personalizedPageRank(nodes, edges, ["a"]);
      const sum = [...pr.values()].reduce((x, y) => x + y, 0);
      assert.ok(Math.abs(sum - 1) < 1e-6, `sum is ${sum}`);
    });

    it("closer nodes score higher than farther ones; unconnected nodes get ~0", () => {
      const pr = goal.personalizedPageRank(nodes, edges, ["a"]);
      assert.ok(pr.get("b")! > pr.get("c")!);
      assert.ok(pr.get("island")! < 1e-6);
    });

    it("a node scores higher when it is the restart node than when it is not", () => {
      const fromA = goal.personalizedPageRank(nodes, edges, ["a"]);
      const fromC = goal.personalizedPageRank(nodes, edges, ["c"]);
      assert.ok(
        fromA.get("a")! > fromC.get("a")!,
        "restarting at a must raise a",
      );
      assert.ok(
        fromC.get("c")! > fromA.get("c")!,
        "restarting at c must raise c",
      );
      assert.ok(
        fromA.get("a")! > fromA.get("c")!,
        "the restart node beats the far end of the chain",
      );
    });

    it("edges work in both directions", () => {
      const pr = goal.personalizedPageRank(
        ["x", "y"],
        [{ from: "x", to: "y", weight: 1 }],
        ["y"],
      );
      assert.ok(
        pr.get("x")! > 0.2,
        "mass must flow against the edge direction too",
      );
    });

    it("heavier edges attract more of the walk", () => {
      const fork = [
        { from: "a", to: "b", weight: 5 },
        { from: "a", to: "c", weight: 1 },
      ];
      const pr = goal.personalizedPageRank(["a", "b", "c"], fork, ["a"]);
      assert.ok(pr.get("b")! > pr.get("c")!);
    });

    it("ignores zero-weight and dangling edges, and is deterministic", () => {
      const clean = goal.personalizedPageRank(nodes, edges, ["a"]);
      const noisy = goal.personalizedPageRank(
        nodes,
        [
          ...edges,
          { from: "a", to: "c", weight: 0 },
          { from: "a", to: "ghost", weight: 3 },
        ],
        ["a"],
      );
      for (const n of nodes)
        assert.ok(Math.abs(clean.get(n)! - noisy.get(n)!) < 1e-9, n);
      assert.deepEqual(
        [...goal.personalizedPageRank(nodes, edges, ["a"])],
        [...clean],
      );
    });
  });
});

// ============================================================
// LIVE
// ============================================================
describe("goal-graph: live graph", { skip: SKIP_DB }, () => {
  let graph: Awaited<ReturnType<typeof getTestGraph>>;
  let slugs: string[] = [];
  let result: goal.GoalGraphResult;
  let wish = "";

  before(async () => {
    graph = await getTestGraph();
    slugs = await assessedTopicSlugs(graph, 3);
    if (slugs[0]) {
      wish = `get deeper at ${slugs[0].replace(/_/g, " ")}`;
      result = await goal.buildGoalGraph(graph, {
        developerId: DEV_ID,
        wish,
        goalTopics: [slugs[0]],
      });
    }
  });
  after(closeTestGraph);

  it("developer exists and has assessed topics to plan from", async () => {
    assert.ok(await developerExists(graph), `Developer ${DEV_ID} not found`);
    assert.ok(
      slugs.length > 0,
      "no DepthAssessment nodes: run the depth analysis first, the goal graph has nothing to start from",
    );
  });

  describe("a goal tied to a real topic", () => {
    it("resolves to the topic the agent named", (t) => {
      if (!result) return t.skip("no assessed topics");
      assert.equal(result.resolution.method, "agent_topics");
      assert.ok(result.resolution.seeds.some((s) => s.slug === slugs[0]));
      assert.equal(result.resolution.needsClarification, false);
      assert.equal(result.clarification, null);
    });

    it("topics: unique, seeds at hop 0, relevance in 0..1", (t) => {
      if (!result) return t.skip("no assessed topics");
      const topics = result.topics;
      assert.ok(topics.length > 0);
      assert.equal(new Set(topics.map((x) => x.slug)).size, topics.length);
      for (const s of result.resolution.seeds) {
        const topic = topics.find((x) => x.slug === s.slug);
        assert.ok(topic, `seed ${s.slug} missing from topics`);
        assert.equal(topic.hops, 0);
        assert.equal(topic.role, "seed");
      }
      for (const x of topics)
        assert.ok(
          x.relevance >= 0 && x.relevance <= 1.0001,
          `${x.slug}: relevance ${x.relevance}`,
        );
      assert.deepEqual(findBadNumbers(result), []);
    });

    it("links stay inside the topic set and never use BUILDS_ON", (t) => {
      if (!result) return t.skip("no assessed topics");
      const set = new Set(result.topics.map((x) => x.slug));
      for (const l of result.links) {
        assert.ok(
          set.has(l.a) && set.has(l.b),
          `link ${l.a}-${l.b} leaves the topic set`,
        );
        assert.ok(
          ["RELATED_TOPIC", "SAME_CLUSTER"].includes(l.type),
          `unexpected link type ${l.type}`,
        );
        assert.ok(l.weight > 0);
      }
      assert.ok(
        !JSON.stringify(result.operations).includes("BUILDS_ON"),
        "goal graph must not traverse BUILDS_ON",
      );
    });

    it("context graph is closed and the ranking is ordered", (t) => {
      if (!result) return t.skip("no assessed topics");
      const keys = result.context.nodes.map((n) => n.key);
      assert.equal(
        new Set(keys).size,
        keys.length,
        "duplicate context node keys",
      );
      const set = new Set(keys);
      for (const e of result.context.edges)
        assert.ok(
          set.has(e.from) && set.has(e.to),
          `dangling ${e.from}->${e.to}`,
        );
      assert.ok(isSortedBy(result.ranking, (n) => n.score, "desc"));
      const sum = result.context.nodes.reduce((n, x) => n + x.score, 0);
      assert.ok(sum <= 1.001, `PageRank scores sum to ${sum}`);
    });

    it("evidence ids are E1..En, unique, and belong to topics in the result", (t) => {
      if (!result) return t.skip("no assessed topics");
      const ids = result.evidence.map((e) => e.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(ids.every((id) => /^E\d+$/.test(id)));
      const topics = new Set(result.topics.map((x) => x.slug));
      for (const e of result.evidence)
        assert.ok(
          topics.has(e.topicSlug),
          `${e.id}: topic ${e.topicSlug} not in result`,
        );
      const idSet = new Set(ids);
      for (const c of result.code)
        assert.ok(
          idSet.has(c.evidenceId),
          `code excerpt for unknown ${c.evidenceId}`,
        );
    });

    it("signals reference real topics and their own evidence", (t) => {
      if (!result) return t.skip("no assessed topics");
      const topics = new Set(result.topics.map((x) => x.slug));
      const byId = new Map(result.evidence.map((e) => [e.id, e]));
      for (const kind of ["strengths", "unproven", "opportunities"] as const)
        for (const s of result.signals[kind]) {
          assert.ok(topics.has(s.slug), `${kind}: ${s.slug} not in result`);
          for (const id of s.evidenceIds)
            assert.equal(
              byId.get(id)?.topicSlug,
              s.slug,
              `${kind}/${s.slug}: cites ${id} from another topic`,
            );
        }
      const strong = new Set(result.signals.strengths.map((s) => s.slug));
      assert.ok(
        result.signals.unproven.every((s) => !strong.has(s.slug)),
        "a topic is both a strength and unproven",
      );
    });

    it("capability coverage points at topics in the result", (t) => {
      if (!result) return t.skip("no assessed topics");
      const topics = new Set(result.topics.map((x) => x.slug));
      for (const c of result.coverage) {
        assert.ok(topics.has(c.topicSlug));
        assert.ok(c.weight >= 0 && c.weight <= 1);
        assert.ok(c.demonstrations >= 0);
      }
    });

    it("every graph operation ran and is described", (t) => {
      if (!result) return t.skip("no assessed topics");
      const ids = result.operations.map((o) => o.id);
      assert.equal(new Set(ids).size, ids.length);
      const failed = result.operations.filter((o) => o.status === "failed");
      assert.equal(
        failed.length,
        0,
        `failed operations: ${failed.map((o) => `${o.id} (${o.purpose})`)}`,
      );
      assert.ok(
        result.operations.every(
          (o) => o.durationMs >= 0 && o.purpose.length > 0,
        ),
      );
    });

    it("the same goal gives the same answer twice", async (t) => {
      if (!result) return t.skip("no assessed topics");
      const again = await goal.buildGoalGraph(graph, {
        developerId: DEV_ID,
        wish,
        goalTopics: [slugs[0]],
      });
      assert.deepEqual(
        again.topics.map((x) => x.slug),
        result.topics.map((x) => x.slug),
      );
      assert.deepEqual(
        again.evidence.map((e) => e.demonstrationId),
        result.evidence.map((e) => e.demonstrationId),
      );
      assert.deepEqual(
        again.ranking.map((n) => n.key),
        result.ranking.map((n) => n.key),
      );
    });

    it("briefForAgent is plain JSON, cites only known ids, and states the goal", (t) => {
      if (!result) return t.skip("no assessed topics");
      const brief = goal.briefForAgent(result);
      const json = JSON.stringify(brief);
      assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(brief)));
      assert.equal(brief.goal, result.wish);
      assert.ok(
        json.length < 400_000,
        `brief is ${json.length} chars: too big for a prompt`,
      );
      assert.deepEqual(findBadNumbers(brief), []);
    });
  });

  describe("a goal the graph cannot tie to anything", () => {
    it("asks for clarification instead of inventing a topic", async () => {
      const r = await goal.buildGoalGraph(graph, {
        developerId: DEV_ID,
        wish: "zzqx wvvk plorb",
      });
      assert.equal(r.resolution.needsClarification, true);
      assert.equal(r.resolution.confidence, "none");
      assert.equal(r.topics.length, 0);
      assert.ok(
        r.clarification &&
          r.clarification.suggestions.length > 0 &&
          r.clarification.suggestions.length <= 6,
      );
    });
  });

  describe("writes (PATHWAY_TEST_WRITES=1)", { skip: !WRITES }, () => {
    const testWish = "pathway automated test goal";
    const goalId = `goal:${DEV_ID}:pathway_automated_test_goal`;

    after(async () => {
      await q(
        graph,
        `MATCH (g:Goal {id:$g}) OPTIONAL MATCH (g)-[:PROPOSES]->(m:NextMove) DETACH DELETE m, g`,
        { g: goalId },
      );
    });

    it("storeNextMove keeps real ids, rejects invented ones, and keeps one move per goal", async (t) => {
      if (!slugs[0]) return t.skip("no assessed topics");
      const r = await goal.buildGoalGraph(graph, {
        developerId: DEV_ID,
        wish: testWish,
        goalTopics: [slugs[0]],
      });
      const first = r.evidence[0];
      const stored = await goal.storeNextMove(graph, r, {
        title: "Test move",
        summary: "created by the automated test",
        focusSlug: slugs[0],
        strengthSlugs: ["not_a_real_topic_xyz"],
        gapSlugs: [],
        evidenceIds: [...(first ? [first.id] : []), "E99999"],
        doneWhen: "never",
      });
      assert.equal(stored.goalId, goalId);
      assert.ok(
        stored.rejected.length >= 1,
        "invented topic / evidence id must be reported as rejected",
      );
      assert.equal(stored.links.focus, 1);

      await goal.storeNextMove(graph, r, {
        title: "Replacement",
        summary: "second",
        focusSlug: slugs[0],
        strengthSlugs: [],
        gapSlugs: [],
        evidenceIds: [],
      });
      const [{ n }] = await q(
        graph,
        `MATCH (:Goal {id:$g})-[:PROPOSES]->(m:NextMove) RETURN count(m) AS n`,
        { g: goalId },
      );
      assert.equal(
        Number(n),
        1,
        "a goal must have exactly one current NextMove",
      );
      const [{ title }] = await q(
        graph,
        `MATCH (:Goal {id:$g})-[:PROPOSES]->(m:NextMove) RETURN m.title AS title`,
        { g: goalId },
      );
      assert.equal(title, "Replacement");
    });
  });
});
