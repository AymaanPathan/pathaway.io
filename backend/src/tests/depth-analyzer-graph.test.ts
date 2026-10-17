import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as depth from "../graph/depth-analyzer-graph.js";
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
  isAcyclic,
  isSortedBy,
} from "./graph-test-helpers.js";

// ============================================================
// PURE: no database
// ============================================================
describe("depth-analyzer-graph: pure logic", () => {
  it("levelForScore has the right boundaries", () => {
    const cases: Array<[number, depth.DepthLevel]> = [
      [0, "none"],
      [1, "surface"],
      [19, "surface"],
      [20, "working"],
      [39, "working"],
      [40, "proficient"],
      [64, "proficient"],
      [65, "deep"],
      [100, "deep"],
    ];
    for (const [score, level] of cases)
      assert.equal(depth.levelForScore(score), level, `score ${score}`);
  });

  it("DEPTH_BANDS agree with levelForScore at both ends of every band", () => {
    for (const level of depth.DEPTH_LEVELS) {
      const [lo, hi] = depth.DEPTH_BANDS[level];
      assert.equal(depth.levelForScore(lo), level, `${level} low`);
      assert.equal(depth.levelForScore(hi), level, `${level} high`);
    }
  });

  it("slugify / asTopicDomain / asDepthLevel normalise input", () => {
    assert.equal(depth.slugify("  Redis Caching!! "), "redis_caching");
    assert.equal(depth.asTopicDomain("Front End"), "frontend");
    assert.equal(depth.asTopicDomain("DevOps"), "infrastructure");
    assert.equal(depth.asTopicDomain("AI/ML"), "ai_ml");
    assert.equal(depth.asTopicDomain("underwater basket weaving"), null);
    assert.equal(depth.asDepthLevel("deep"), "deep");
    assert.equal(depth.asDepthLevel("nonsense"), "none");
    assert.equal(depth.asConfidence("nonsense"), "low");
    assert.equal(depth.asAuthenticity("nonsense"), "insufficient_evidence");
  });

  it("isSpecificRationale rejects templates and accepts real reasons", () => {
    assert.equal(depth.isSpecificRationale(""), false);
    assert.equal(depth.isSpecificRationale("X builds on Y"), false);
    assert.equal(
      depth.isSpecificRationale("Redis caching relates to databases"),
      false,
    );
    assert.equal(
      depth.isSpecificRationale(
        "Cache invalidation only makes sense once you know how TTLs and eviction work in a key-value store",
      ),
      true,
    );
  });

  it("evidenceBandFor", () => {
    assert.equal(depth.evidenceBandFor(0, 0), "none");
    assert.equal(depth.evidenceBandFor(2, 5), "sparse");
    assert.equal(depth.evidenceBandFor(3, 1), "sparse");
    assert.equal(depth.evidenceBandFor(10, 10), "moderate");
    assert.equal(depth.evidenceBandFor(20, 10), "rich");
  });

  it("wouldCreateBuildsOnCycle", () => {
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    assert.equal(depth.wouldCreateBuildsOnCycle(edges, "c", "a"), true);
    assert.equal(depth.wouldCreateBuildsOnCycle(edges, "a", "c"), false);
    assert.equal(depth.wouldCreateBuildsOnCycle(edges, "a", "a"), true);
    assert.equal(depth.wouldCreateBuildsOnCycle(edges, "c", "d"), false);
  });

  const base: depth.BaselineInput = {
    files: 0,
    commits: 0,
    repos: 0,
    activeDays: 0,
    spanDays: 0,
    additions: 0,
    testFiles: 0,
    definedSymbols: 0,
    demoBestRank: 0,
    hardeningCount: 0,
    revisitRatio: 0,
    followUpCommits: 0,
    approachesWithEvidence: 0,
    scaffoldShare: 0,
  };

  it("computeBaselineDepth: no files => 0 / none", () => {
    const r = depth.computeBaselineDepth(base);
    assert.equal(r.score, 0);
    assert.equal(r.level, "none");
  });

  it("computeBaselineDepth: a single file or commit is capped", () => {
    const oneFile = depth.computeBaselineDepth({
      ...base,
      files: 1,
      commits: 1,
      additions: 100000,
      demoBestRank: 3,
      definedSymbols: 9,
      hardeningCount: 9,
    });
    assert.ok(oneFile.score <= 20, `one file scored ${oneFile.score}`);
    const oneCommit = depth.computeBaselineDepth({
      ...base,
      files: 30,
      commits: 1,
      additions: 100000,
      demoBestRank: 3,
      definedSymbols: 9,
      hardeningCount: 9,
      repos: 3,
      activeDays: 20,
      spanDays: 200,
    });
    assert.ok(oneCommit.score <= 25, `one commit scored ${oneCommit.score}`);
    assert.ok(oneCommit.caps.length > 0, "cap must be explained");
  });

  it("computeBaselineDepth: scaffold-heavy evidence is reduced and explained", () => {
    const rich = {
      ...base,
      files: 40,
      commits: 40,
      repos: 3,
      activeDays: 30,
      spanDays: 200,
      additions: 5000,
      testFiles: 5,
      definedSymbols: 6,
      demoBestRank: 3,
      hardeningCount: 8,
      revisitRatio: 0.5,
      followUpCommits: 5,
      approachesWithEvidence: 2,
    };
    const clean = depth.computeBaselineDepth(rich);
    const scaffold = depth.computeBaselineDepth({
      ...rich,
      scaffoldShare: 0.8,
    });
    assert.equal(clean.score, 100);
    assert.equal(clean.level, "deep");
    assert.ok(scaffold.score < clean.score);
    assert.ok(scaffold.caps.some((c) => /scaffold/i.test(c)));
  });

  it("computeBaselineDepth: monotonic in files and always inside 0..100 with level matching score", () => {
    let prev = -1;
    for (const files of [1, 2, 5, 10, 20, 40]) {
      const r = depth.computeBaselineDepth({
        ...base,
        files,
        commits: files,
        additions: files * 50,
        activeDays: files,
        spanDays: files * 5,
      });
      assert.ok(r.score >= prev, `score dropped at ${files} files`);
      assert.ok(r.score >= 0 && r.score <= 100);
      assert.equal(r.level, depth.levelForScore(r.score));
      prev = r.score;
    }
  });
});

// ============================================================
// LIVE: reads the real graph for the test developer
// ============================================================
describe("depth-analyzer-graph: live graph", { skip: SKIP_DB }, () => {
  let graph: Awaited<ReturnType<typeof getTestGraph>>;
  let atlas: depth.EvidenceAtlas | null = null;
  let slugs: string[] = [];

  before(async () => {
    graph = await getTestGraph();
    atlas = await depth.readEvidenceAtlas(graph, DEV_ID);
    slugs = await assessedTopicSlugs(graph, 5);
  });
  after(closeTestGraph);

  it("developer exists", async () => {
    assert.ok(
      await developerExists(graph),
      `Developer ${DEV_ID} not found in graph`,
    );
  });

  describe("evidence atlas", () => {
    it("loads and matches a direct count of authored file changes", async () => {
      assert.ok(atlas, "readEvidenceAtlas returned null");
      const [{ n }] = await q(
        graph,
        `MATCH (:Developer {id: $d})-[:AUTHORED_CODE]->(fc:FileChange) RETURN count(fc) AS n`,
        { d: DEV_ID },
      );
      assert.equal(
        atlas.totals.files,
        Number(n),
        "atlas file count differs from the graph",
      );
      assert.equal(
        new Set(atlas.index.files.map((f) => f.id)).size,
        atlas.index.files.length,
        "duplicate FileChange ids",
      );
    });

    it("totals are internally consistent", () => {
      const t = atlas!.totals;
      assert.ok(t.codeFiles <= t.files);
      assert.ok(t.commits <= t.files);
      assert.ok(t.activeDays <= t.files);
      assert.ok(t.repositories <= t.commits);
      if (t.firstSeen && t.lastSeen) assert.ok(t.firstSeen <= t.lastSeen);
      assert.deepEqual(findBadNumbers(atlas!.totals), []);
    });

    it("packages / signals are sorted and sane", () => {
      const { packages, signals } = atlas!;
      assert.ok(isSortedBy(packages, (p) => p.files, "desc"));
      assert.ok(isSortedBy(signals, (s) => s.files, "desc"));
      for (const p of packages) {
        assert.ok(p.commits <= p.files, `${p.name}: commits > files`);
        assert.ok(
          p.activeDays >= 1 || p.firstSeen === "",
          `${p.name}: no active days`,
        );
        if (p.firstSeen && p.lastSeen) assert.ok(p.firstSeen <= p.lastSeen);
      }
    });

    it("clusters have >= 2 members and unique ids", () => {
      const ids = atlas!.clusters.map((c) => c.id);
      assert.equal(new Set(ids).size, ids.length);
      for (const c of atlas!.clusters) {
        assert.ok(c.members.length >= 2);
        assert.ok(c.cohesion >= 0 && c.cohesion <= 1);
      }
    });

    it("probeAtlas keeps only atoms that really exist", () => {
      const top = atlas!.packages[0]?.name;
      const res = depth.probeAtlas(atlas!, {
        packages: [top ?? "react", "definitely-not-a-package-xyz"],
      });
      assert.ok(!res.packages.includes("definitely-not-a-package-xyz"));
      if (top) assert.ok(res.packages.includes(top));
    });
  });

  describe("gatherTopicEvidence", () => {
    it("a synthetic topic built from the top package matches exactly the files that import it", async (t) => {
      const pkg = atlas!.packages[0]?.name;
      if (!pkg) return t.skip("developer has no imported packages");
      const spec: depth.TopicSpec = {
        slug: "__test_topic",
        name: pkg,
        domain: "general",
        description: "",
        aliases: [],
        keywords: [],
        packages: [pkg],
        signals: [],
        capabilityIds: [],
        approaches: [],
        buildsOn: [],
        related: [],
        pinnedFileIds: [],
      };
      const ev = await depth.gatherTopicEvidence(graph, atlas!, spec);
      const NON_CODE = new Set(["config", "infra", "dependency_manifest"]);
      const expected = atlas!.index.files.filter(
        (f) =>
          !f.isTest &&
          !NON_CODE.has(f.role) &&
          f.packages.some((p) => p === pkg || p.startsWith(`${pkg}/`)),
      );
      assert.equal(
        ev.totals.files,
        expected.length,
        "matched file count differs from an independent recount",
      );
      assert.equal(ev.matched, expected.length > 0);
      assert.equal(ev.baseline.level, depth.levelForScore(ev.baseline.score));
      assert.ok(ev.baseline.score >= 0 && ev.baseline.score <= 100);
      assert.equal(
        new Set(ev.refs.map((r) => r.key)).size,
        ev.refs.length,
        "evidence ref keys must be unique",
      );
      assert.ok(ev.samples.length <= 8);
      assert.deepEqual(findBadNumbers(ev.totals), []);
      assert.ok(ev.scaffold.share >= 0 && ev.scaffold.share <= 1);
    });

    it("a topic nobody wrote about matches nothing and scores 0", async () => {
      const spec: depth.TopicSpec = {
        slug: "__test_empty",
        name: "Nothing",
        domain: "general",
        description: "",
        aliases: [],
        keywords: ["zzzqqqxxx"],
        packages: ["zzzqqqxxx-pkg"],
        signals: [],
        capabilityIds: [],
        approaches: [],
        buildsOn: [],
        related: [],
        pinnedFileIds: [],
      };
      const ev = await depth.gatherTopicEvidence(graph, atlas!, spec);
      assert.equal(ev.matched, false);
      assert.equal(ev.totals.files, 0);
      assert.equal(ev.baseline.score, 0);
      assert.equal(ev.baseline.level, "none");
    });
  });

  describe("shared taxonomy", () => {
    it("BUILDS_ON: no self loops, acyclic, valid strength / confidence", async () => {
      const edges = await depth.readTaxonomyEdges(graph, "BUILDS_ON", {
        fresh: true,
      });
      assert.ok(
        edges.every((e) => e.from !== e.to),
        "self loop found",
      );
      assert.ok(
        isAcyclic(edges),
        "BUILDS_ON contains a cycle: prerequisites must be a DAG",
      );
      for (const e of edges) {
        assert.ok(["required", "helpful"].includes(e.strength));
        assert.ok(
          e.confidence >= 0 && e.confidence <= 1,
          `${e.from}>${e.to} confidence ${e.confidence}`,
        );
      }
    });

    it("RELATED_TOPIC is symmetric and never duplicates a BUILDS_ON link", async () => {
      const related = await depth.readTaxonomyEdges(graph, "RELATED_TOPIC", {
        fresh: true,
      });
      const builds = await depth.readTaxonomyEdges(graph, "BUILDS_ON", {
        fresh: true,
      });
      const set = new Set(related.map((e) => `${e.from}>${e.to}`));
      const missing = related.filter((e) => !set.has(`${e.to}>${e.from}`));
      assert.equal(
        missing.length,
        0,
        `${missing.length} RELATED_TOPIC edges have no reverse (run repairTopicEdges): ${missing.slice(0, 3).map((e) => `${e.from}>${e.to}`)}`,
      );
      const linked = new Set(
        builds.map((e) => [e.from, e.to].sort().join("~")),
      );
      const both = related.filter((e) =>
        linked.has([e.from, e.to].sort().join("~")),
      );
      assert.equal(
        both.length,
        0,
        "topics linked by both BUILDS_ON and RELATED_TOPIC",
      );
    });

    it("edges carry specific rationales (curated edges excepted)", async () => {
      const all = [
        ...(await depth.readTaxonomyEdges(graph, "BUILDS_ON")),
        ...(await depth.readTaxonomyEdges(graph, "RELATED_TOPIC")),
      ];
      const vague = all.filter(
        (e) => e.basis !== "curated" && !depth.isSpecificRationale(e.reason),
      );
      assert.equal(
        vague.length,
        0,
        `${vague.length}/${all.length} edges have a missing or generic reason, e.g. ${vague
          .slice(0, 3)
          .map((e) => `${e.from}->${e.to}: "${e.reason}"`)
          .join(" | ")}`,
      );
    });

    it("topic catalog: valid domains, sorted by foundation rank", async () => {
      const cat = await depth.listTopicCatalog(graph, 500);
      assert.ok(cat.length > 0, "no Topic nodes");
      const allowed = new Set<string>([...depth.TOPIC_DOMAINS, ""]);
      const bad = cat.filter((t) => !allowed.has(t.domain));
      assert.equal(
        bad.length,
        0,
        `topics with an invalid domain: ${bad.slice(0, 5).map((t) => `${t.slug}=${t.domain}`)}`,
      );
      assert.ok(isSortedBy(cat, (t) => t.foundationRank ?? 0, "desc"));
      assert.equal(
        new Set(cat.map((t) => t.slug)).size,
        cat.length,
        "duplicate topic slugs",
      );
    });

    it("capability catalog has unique leaf ids", async () => {
      const caps = await depth.listCapabilityCatalog(graph);
      assert.ok(caps.length > 0);
      assert.equal(new Set(caps.map((c) => c.id)).size, caps.length);
    });

    it("no orphaned assessments or approaches", async () => {
      const r = await depth.readOrphanReport(graph);
      assert.equal(r.assessmentsWithoutTopic, 0);
      assert.equal(r.approachesWithoutTopic, 0);
    });
  });

  describe("developer topic profile", () => {
    it("every topic score sits inside the band of its level", async (t) => {
      const profile = await depth.readDeveloperTopicProfile(graph, DEV_ID);
      if (!profile.topics.length)
        return t.skip("developer has no depth assessments yet");
      assert.equal(
        new Set(profile.topics.map((x) => x.slug)).size,
        profile.topics.length,
      );
      for (const topic of profile.topics) {
        const [lo, hi] = depth.DEPTH_BANDS[topic.level];
        assert.ok(
          topic.score >= lo && topic.score <= hi,
          `${topic.slug}: score ${topic.score} outside ${topic.level} band [${lo},${hi}]`,
        );
        assert.ok(
          topic.commits <= topic.files || topic.files === 0,
          `${topic.slug}: commits > files`,
        );
      }
      assert.equal(
        profile.domains.reduce((n, d) => n + d.topics, 0),
        profile.topics.length,
      );
      assert.deepEqual(findBadNumbers(profile), []);
    });

    it("topic detail: evidence band, history order, stored spec", async (t) => {
      if (!slugs[0]) return t.skip("no assessed topics");
      const detail = await depth.readTopicDepthDetail(graph, DEV_ID, slugs[0]);
      assert.ok(detail);
      assert.equal(
        detail.evidenceBand,
        depth.evidenceBandFor(detail.summary.files, detail.summary.commits),
      );
      assert.ok(
        isSortedBy(
          detail.history,
          (h) => Date.parse(h.assessedAt) || 0,
          "desc",
        ),
        "history must be newest first",
      );
      const spec = await depth.readStoredTopicSpec(graph, DEV_ID, slugs[0]);
      assert.equal(spec?.slug, slugs[0]);
    });
  });

  describe("learning graph", () => {
    it("prerequisite walk, readiness and blocking flags agree", async (t) => {
      if (!slugs.length) return t.skip("no assessed topics");
      for (const slug of slugs) {
        const g = await depth.readTopicLearningGraph(graph, DEV_ID, slug);
        assert.ok(g, `${slug}: no learning graph`);
        const unmet = g.prerequisites
          .filter((n) => n.hops === 1 && n.blocking)
          .map((n) => n.slug)
          .sort();
        assert.deepEqual(
          [...g.readiness.unmetRequired].sort(),
          unmet,
          `${slug}: unmetRequired`,
        );
        assert.equal(
          g.readiness.ready,
          unmet.length === 0,
          `${slug}: ready flag`,
        );
        for (const n of g.prerequisites) {
          assert.ok(n.hops >= 1 && n.hops <= 3);
          assert.equal(n.via.at(-1), n.slug);
          assert.equal(n.via.length, n.hops);
          const rank = n.developer ? depth.DEPTH_RANK[n.developer.level] : 0;
          assert.equal(
            n.met,
            rank >= depth.PREREQ_MET_RANK,
            `${slug}<-${n.slug}: met flag`,
          );
          assert.equal(n.blocking, n.requiredPath && !n.met);
        }
        const blocking = new Set(
          g.prerequisites.filter((n) => n.blocking).map((n) => n.slug),
        );
        assert.ok(g.readiness.learningOrder.every((s) => blocking.has(s)));
        const ordered = g.readiness.learningOrder.map(
          (s) => g.prerequisites.find((n) => n.slug === s)!.hops,
        );
        assert.ok(
          isSortedBy(ordered, (h) => h, "desc"),
          `${slug}: learning order must go deepest first`,
        );
      }
    });

    it("topic context foundations are a subset of the learning graph prerequisites", async (t) => {
      if (!slugs[0]) return t.skip("no assessed topics");
      const ctx = await depth.readTopicContext(graph, DEV_ID, slugs[0]);
      const g = await depth.readTopicLearningGraph(graph, DEV_ID, slugs[0]);
      const all = new Set(g!.prerequisites.map((n) => n.slug));
      for (const f of ctx?.foundations ?? [])
        assert.ok(all.has(f.slug), `${f.slug} missing from learning graph`);
    });

    it("learning frontier: ready first, below proficient, blockers consistent", async () => {
      const frontier = await depth.readLearningFrontier(graph, DEV_ID, {
        limit: 60,
      });
      const firstBlocked = frontier.findIndex((e) => !e.ready);
      if (firstBlocked !== -1)
        assert.ok(
          frontier.slice(firstBlocked).every((e) => !e.ready),
          "a ready topic appears after a blocked one",
        );
      for (const e of frontier) {
        assert.ok(
          !e.developer ||
            depth.DEPTH_RANK[e.developer.level] < depth.DEPTH_RANK.proficient,
          `${e.topic.slug} already proficient`,
        );
        assert.equal(e.ready, e.blockedBy.length === 0);
        const expected = e.prerequisites
          .filter((p) => p.strength === "required" && !p.met)
          .map((p) => p.slug)
          .sort();
        assert.deepEqual(
          [...e.blockedBy].sort(),
          expected,
          `${e.topic.slug}: blockedBy`,
        );
      }
    });

    it("path helpers agree with each other", async (t) => {
      if (!slugs[0]) return t.skip("no assessed topics");
      const g = await depth.readTopicLearningGraph(graph, DEV_ID, slugs[0]);
      const target = g?.prerequisites[0]?.slug;
      if (!target) return t.skip("topic has no prerequisites");
      const detailed = await depth.readTopicPathDetailed(
        graph,
        slugs[0],
        target,
      );
      const plain = await depth.readTopicPath(graph, slugs[0], target);
      assert.deepEqual(plain, detailed.slugs);
      assert.ok(detailed.slugs.length >= 2, "a prerequisite must be reachable");
      assert.equal(detailed.hops.length, detailed.slugs.length - 1);
      assert.equal(detailed.slugs[0], slugs[0]);
      assert.equal(detailed.slugs.at(-1), target);
    });
  });

  describe("evidence graph for a topic", () => {
    it("nodes and edges are well formed", async (t) => {
      if (!slugs[0]) return t.skip("no assessed topics");
      const g = await depth.readTopicGraphEvidence(graph, DEV_ID, slugs[0]);
      assert.ok(g);
      const ids = g.nodes.map((n) => n.id);
      assert.equal(new Set(ids).size, ids.length, "duplicate node ids");
      const set = new Set(ids);
      for (const e of g.edges)
        assert.ok(
          set.has(e.source) && set.has(e.target),
          `dangling edge ${e.id}`,
        );
      assert.equal(g.nodes.find((n) => n.id === `topic:${slugs[0]}`)?.hop, 0);
      assert.equal(
        Object.values(g.hopCounts).reduce((a, b) => a + b, 0),
        g.nodes.filter((n) => n.hop > 0).length,
      );
      for (const b of g.builds)
        assert.ok(
          b.routeIds.every((id) => set.has(id)),
          `build ${b.id}: route leaves the graph`,
        );
      assert.deepEqual(findBadNumbers(g), []);
    });

    it("capability traversal weights are 0..1", async (t) => {
      if (!slugs[0]) return t.skip("no assessed topics");
      for (const p of await depth.readTopicEvidenceTraversal(
        graph,
        DEV_ID,
        slugs[0],
      )) {
        assert.ok(p.weight === null || (p.weight >= 0 && p.weight <= 1));
        assert.ok(p.demonstrations >= 0);
      }
    });
  });

  describe("developer knowledge subgraph", () => {
    it("is bounded and has no dangling edges", async () => {
      const g = await depth.readDeveloperKnowledgeGraph(graph, DEV_ID, {
        maxNodes: 100,
        maxHops: 2,
      });
      assert.ok(g, "returned null");
      assert.ok(g.nodes.length <= 100);
      assert.equal(g.counts.nodes, g.nodes.length);
      const ids = new Set(g.nodes.map((n) => n.id));
      for (const e of g.edges) assert.ok(ids.has(e.from) && ids.has(e.to));
    });
  });

  describe("writes (PATHWAY_TEST_WRITES=1)", { skip: !WRITES }, () => {
    it("repairTopicEdges is idempotent", async () => {
      const now = new Date().toISOString();
      await depth.repairTopicEdges(graph, { now });
      const second = await depth.repairTopicEdges(graph, { now });
      assert.deepEqual(second, { selfLoopsRemoved: 0, reverseAdded: 0 });
    });

    it("refreshTopicGraphMetrics ranks every topic", async () => {
      const m = await depth.refreshTopicGraphMetrics(graph, {
        buildId: "test-run",
      });
      assert.notEqual(m.status, "failed", m.failures.join("; "));
      assert.ok(m.pageRank > 0, "PageRank wrote nothing");
      const [{ n }] = await q(
        graph,
        `MATCH (t:Topic) WHERE t.foundation_rank IS NOT NULL RETURN count(t) AS n`,
      );
      assert.equal(Number(n), m.pageRank);
    });
  });
});
