import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as kg from "../graph/developer-knowledge-graph.js";
import {
  DEV_ID,
  SKIP_DB,
  WRITES,
  getTestGraph,
  closeTestGraph,
  q,
  developerExists,
  findBadNumbers,
  isAcyclic,
} from "./graph-test-helpers.js";

// ============================================================
// PURE: the taxonomy and the detectors
// ============================================================
describe("developer-knowledge-graph: taxonomy (pure)", () => {
  it("capability ids are unique and every parent exists", () => {
    const ids = kg.CAPABILITIES.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate capability id");
    for (const c of kg.CAPABILITIES)
      if (c.parentId !== null)
        assert.ok(
          kg.CAPABILITY_BY_ID.has(c.parentId),
          `${c.id}: unknown parent ${c.parentId}`,
        );
    assert.equal(
      kg.LEARNABLE_CAPABILITIES.length + kg.CATEGORY_CAPABILITIES.length,
      kg.CAPABILITIES.length,
    );
    assert.ok(
      kg.CATEGORY_CAPABILITIES.every((c) => !kg.isLearnableCapability(c.id)),
    );
    assert.ok(
      kg.LEARNABLE_CAPABILITIES.every((c) => kg.isLearnableCapability(c.id)),
    );
  });

  it("the declared capability graph passes its own validator", () => {
    assert.deepEqual(kg.validateCapabilityGraph(), []);
    assert.deepEqual(kg.validateCompletionCriteria(), []);
  });

  it("the validator really catches a cycle, a self loop and an unknown capability", () => {
    const [a, b] = kg.LEARNABLE_CAPABILITIES.map((c) => c.id);
    const rel = (from: string, to: string): kg.CapabilityRelationship => ({
      from,
      to,
      type: "PREREQUISITE_OF",
      weight: 1,
      reason: "needed because the second one is built on the first one",
    });
    const codes = (r: kg.CapabilityRelationship[]) =>
      kg.validateCapabilityGraph(r).map((p) => p.code);
    assert.ok(codes([rel(a, b), rel(b, a)]).includes("prerequisite_cycle"));
    assert.ok(codes([rel(a, a)]).includes("self_loop"));
    assert.ok(codes([rel(a, "does_not_exist")]).includes("unknown_capability"));
  });

  it("declared PREREQUISITE_OF edges form a DAG within MAX_PREREQUISITE_DEPTH", () => {
    const edges = kg.CAPABILITY_GRAPH_RELATIONSHIPS.filter(
      (r) => r.type === "PREREQUISITE_OF",
    );
    assert.ok(isAcyclic(edges));
    const adj = new Map<string, string[]>();
    for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    const longest = (n: string, seen = new Map<string, number>()): number =>
      seen.get(n) ??
      (seen.set(
        n,
        1 + Math.max(0, ...(adj.get(n) ?? []).map((m) => longest(m, seen))),
      ),
      seen.get(n) as number);
    for (const n of adj.keys())
      assert.ok(
        longest(n) <= kg.MAX_PREREQUISITE_DEPTH + 1,
        `${n}: chain too deep`,
      );
  });

  it("every dependency-audit key is a learnable capability", () => {
    for (const id of Object.keys(kg.CAPABILITY_DEPENDENCIES))
      assert.ok(
        kg.isLearnableCapability(id),
        `${id} in audit but not learnable`,
      );
  });

  it("signal rules have unique ids and point at real learnable capabilities", () => {
    const ids = kg.SIGNAL_RULES.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate rule id");
    for (const r of kg.SIGNAL_RULES)
      assert.ok(
        kg.isLearnableCapability(r.capabilityId),
        `${r.id} -> ${r.capabilityId}`,
      );
  });

  it("capability definitions version is stable", () => {
    assert.equal(
      kg.capabilityDefinitionsVersion(),
      kg.CAPABILITY_DEFINITIONS_VERSION,
    );
  });
});

describe("developer-knowledge-graph: helpers (pure)", () => {
  it("parseAddedLines tracks new-file line numbers across hunks", () => {
    const patch = [
      "@@ -1,3 +10,4 @@",
      " context",
      "-removed",
      "+added one",
      "+added two",
      " context2",
      "@@ -20,1 +30,2 @@",
      "+later",
    ].join("\n");
    assert.deepEqual(kg.parseAddedLines(patch), [
      { line: 11, text: "added one" },
      { line: 12, text: "added two" },
      { line: 30, text: "later" },
    ]);
    assert.deepEqual(
      kg.parseAddedLines("+ before any hunk header is ignored"),
      [],
    );
  });

  it("conceptKey normalises names", () => {
    assert.equal(kg.conceptKey("  Redis  Cache-Aside! "), "redis_cache_aside");
  });

  it("resolveConceptProposals reuses an existing capability and only creates new names", () => {
    const existing = kg.LEARNABLE_CAPABILITIES[0];
    const parent = existing.id; // a concept's parent must be a LEARNABLE capability, not a domain
    const res = kg.resolveConceptProposals([
      { name: existing.name, parentId: parent },
      { name: "A Brand New Concept Nobody Has", parentId: parent },
      { name: "a brand new concept nobody has", parentId: parent },
      {
        name: "Parent is a domain so this is dropped",
        parentId: existing.parentId as string,
      },
    ]);
    assert.equal(res.reuse.length, 1);
    assert.equal(res.reuse[0].id, existing.id);
    assert.equal(
      res.create.length,
      1,
      "duplicate new proposals must collapse into one, and a domain parent is refused",
    );
  });

  it("rollUpDemonstrations on nothing is nothing", () => {
    assert.deepEqual(kg.rollUpDemonstrations([]), []);
  });
});

// ============================================================
// LIVE
// ============================================================
describe("developer-knowledge-graph: live graph", { skip: SKIP_DB }, () => {
  let graph: Awaited<ReturnType<typeof getTestGraph>>;
  before(async () => {
    graph = await getTestGraph();
  });
  after(closeTestGraph);

  it("developer exists", async () => {
    assert.ok(await developerExists(graph), `Developer ${DEV_ID} not found`);
  });

  describe("stored taxonomy matches the code", () => {
    it("capability schema is current", async () => {
      assert.ok(
        await kg.isCapabilityGraphCurrent(graph),
        "stored capability map is out of date with developer-knowledge-graph.ts: run ensureCapabilityGraph()",
      );
    });

    it("every declared capability exists in the graph with the right parent", async () => {
      const rows = await q(
        graph,
        `MATCH (c:Capability) RETURN c.id AS id, coalesce(c.parent_id,"") AS parent`,
      );
      const stored = new Map(rows.map((r) => [String(r.id), String(r.parent)]));
      for (const c of kg.CAPABILITIES) {
        assert.ok(stored.has(c.id), `${c.id} missing in graph`);
        assert.equal(
          stored.get(c.id),
          c.parentId ?? "",
          `${c.id}: parent differs`,
        );
      }
    });

    it("stored declared PREREQUISITE_OF edges equal the ones in the file (no stale ones)", async () => {
      const rows = await q(
        graph,
        `MATCH (a:Capability)-[r:PREREQUISITE_OF]->(b:Capability) WHERE r.basis = "declared" RETURN a.id AS a, b.id AS b`,
      );
      const stored = new Set(rows.map((r) => `${r.a}>${r.b}`));
      const declared = new Set(
        kg.CAPABILITY_GRAPH_RELATIONSHIPS.filter(
          (r) => r.type === "PREREQUISITE_OF",
        ).map((r) => `${r.from}>${r.to}`),
      );
      assert.deepEqual(
        [...stored].filter((e) => !declared.has(e)),
        [],
        "stale edges in the graph",
      );
      assert.deepEqual(
        [...declared].filter((e) => !stored.has(e)),
        [],
        "declared edges missing from the graph",
      );
    });

    it("stored PREREQUISITE_OF (any basis) is acyclic", async () => {
      const rows = await q(
        graph,
        `MATCH (a:Capability)-[:PREREQUISITE_OF]->(b:Capability) RETURN a.id AS from, b.id AS to`,
      );
      assert.ok(
        isAcyclic(
          rows.map((r) => ({ from: String(r.from), to: String(r.to) })),
        ),
      );
    });
  });

  describe("developer evidence", () => {
    it("stored demonstrations are well formed", async () => {
      const demos = await kg.loadDemonstrationRows(graph, DEV_ID);
      assert.ok(
        demos.length > 0,
        "developer has no Demonstration nodes: run buildOverviewIntelligenceGraph",
      );
      assert.equal(
        new Set(demos.map((d) => d.id)).size,
        demos.length,
        "duplicate demonstration ids",
      );
      for (const d of demos) {
        assert.ok(
          kg.isLearnableCapability(d.capabilityId),
          `${d.id}: capability ${d.capabilityId} is not learnable`,
        );
        assert.ok(
          d.startLine <= d.endLine || d.endLine === 0,
          `${d.id}: line range reversed`,
        );
        assert.ok(Array.isArray(d.modifiers));
      }
      assert.deepEqual(findBadNumbers(demos), []);
    });

    it("HAS_CAPABILITY roll-ups equal a fresh roll-up of the stored demonstrations", async () => {
      const demos = await kg.loadDemonstrationRows(graph, DEV_ID);
      const fresh = new Map(
        kg.rollUpDemonstrations(demos).map((r) => [r.capabilityId, r]),
      );
      const profile = await kg.getCapabilityProfile(graph, DEV_ID);
      const stored = profile.flatMap((d) => [d, ...d.capabilities]);
      assert.ok(stored.length > 0, "no HAS_CAPABILITY edges");
      for (const s of stored) {
        const f = fresh.get(s.capabilityId);
        assert.ok(
          f,
          `${s.capabilityId}: stored but no demonstration supports it`,
        );
        assert.equal(s.level, f.level, `${s.capabilityId}: level`);
        assert.equal(
          s.evidenceCount,
          f.evidenceCount,
          `${s.capabilityId}: evidence count`,
        );
        assert.equal(
          s.commitCount,
          f.commitCount,
          `${s.capabilityId}: commit count`,
        );
        assert.equal(s.repoCount, f.repoCount, `${s.capabilityId}: repo count`);
        assert.equal(s.bestDepth, f.bestDepth, `${s.capabilityId}: best depth`);
      }
      const storedIds = new Set(stored.map((s) => s.capabilityId));
      for (const id of fresh.keys())
        assert.ok(
          storedIds.has(id),
          `${id}: demonstrations exist but no HAS_CAPABILITY edge`,
        );
    });

    it("domain roll-ups cover their capabilities", async () => {
      for (const d of await kg.getCapabilityProfile(graph, DEV_ID)) {
        assert.ok(
          d.evidenceCount >=
            Math.max(0, ...d.capabilities.map((c) => c.evidenceCount)),
          `${d.capabilityId}: domain has less evidence than a child`,
        );
      }
    });

    it("getCapabilityEvidence respects the limit and returns only that capability", async () => {
      const profile = await kg.getCapabilityProfile(graph, DEV_ID);
      const id = profile.flatMap((d) => d.capabilities)[0]?.capabilityId;
      if (!id) return;
      const ev = await kg.getCapabilityEvidence(graph, DEV_ID, id, 3);
      assert.ok(ev.length <= 3);
      assert.ok(
        ev.every(
          (e: any) =>
            !e.capabilityId ||
            e.capabilityId === id ||
            kg.CAPABILITY_BY_ID.get(e.capabilityId)?.parentId === id,
        ),
      );
    });

    it("experiences and the overview snapshot have no broken numbers", async () => {
      const exps = await kg.getEngineeringExperiences(graph, DEV_ID, 20);
      assert.ok(exps.length <= 20);
      assert.deepEqual(findBadNumbers(exps), []);
      assert.deepEqual(
        findBadNumbers(await kg.getOverviewGraphSnapshot(graph, DEV_ID)),
        [],
      );
    });

    it("capability gaps point at learnable capabilities and respect the limit", async () => {
      const gaps = await kg.findCapabilityGaps(graph, DEV_ID, 10);
      assert.ok(gaps.length <= 10);
      for (const g of gaps) {
        assert.ok(
          kg.isLearnableCapability(g.capabilityId),
          `${g.capabilityId} is not learnable`,
        );
        assert.ok(g.graphDistance >= 0);
      }
    });
  });

  describe("writes (PATHWAY_TEST_WRITES=1)", { skip: !WRITES }, () => {
    it("ensureCapabilityGraph converges and is idempotent", async () => {
      await kg.ensureCapabilityGraph(graph);
      assert.ok(await kg.isCapabilityGraphCurrent(graph));
      const before = (
        await q(
          graph,
          `MATCH (:Capability)-[r:PREREQUISITE_OF]->(:Capability) RETURN count(r) AS n`,
        )
      )[0].n;
      await kg.ensureCapabilityGraph(graph);
      const after = (
        await q(
          graph,
          `MATCH (:Capability)-[r:PREREQUISITE_OF]->(:Capability) RETURN count(r) AS n`,
        )
      )[0].n;
      assert.equal(after, before);
    });

    it("rebuilding the overview graph twice gives the same result", async () => {
      const a = await kg.buildOverviewIntelligenceGraph(graph, DEV_ID);
      const b = await kg.buildOverviewIntelligenceGraph(graph, DEV_ID);
      assert.deepEqual(
        b,
        a,
        "second build differs from first: the build is not idempotent",
      );
      const [{ n }] = await q(
        graph,
        `MATCH (:Developer {id:$d})-[:DEMONSTRATED]->(x:Demonstration) RETURN count(x) AS n`,
        { d: DEV_ID },
      );
      assert.ok(
        Number(n) >= b.demonstrationsFound,
        "fewer Demonstration nodes than the build reported",
      );
    });
  });
});
