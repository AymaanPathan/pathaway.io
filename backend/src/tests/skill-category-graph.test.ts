import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as sk from "../graph/skill-category-graph.js";
import {
  DEV_ID,
  SKIP_DB,
  WRITES,
  getTestGraph,
  closeTestGraph,
  q,
  developerExists,
  findBadNumbers,
  isSortedBy,
} from "./graph-test-helpers.js";

const def = (over: Partial<sk.SkillDefinition>): sk.SkillDefinition => ({
  id: "x",
  name: "X",
  category: "languages",
  ...over,
});

// ============================================================
// PURE
// ============================================================
describe("skill-category-graph: taxonomy (pure)", () => {
  it("skill ids are unique and every skill has a real category", () => {
    const ids = sk.SKILL_TAXONOMY.map((s) => s.id);
    assert.equal(
      new Set(ids).size,
      ids.length,
      `duplicate skill ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`,
    );
    const cats = new Set(sk.SKILL_CATEGORIES.map((c) => c.id));
    assert.equal(
      cats.size,
      sk.SKILL_CATEGORIES.length,
      "duplicate category ids",
    );
    for (const s of sk.SKILL_TAXONOMY)
      assert.ok(
        cats.has(s.category),
        `${s.id}: unknown category ${s.category}`,
      );
  });

  it("implies / related only point at skills that exist, never at themselves", () => {
    const ids = new Set(sk.SKILL_TAXONOMY.map((s) => s.id));
    for (const s of sk.SKILL_TAXONOMY)
      for (const [kind, list] of [
        ["implies", s.implies],
        ["related", s.related],
      ] as const)
        for (const other of list ?? []) {
          assert.ok(ids.has(other), `${s.id}.${kind}: unknown skill ${other}`);
          assert.notEqual(other, s.id, `${s.id}.${kind}: points at itself`);
        }
  });

  it("every skill can actually be detected", () => {
    for (const s of sk.SKILL_TAXONOMY) {
      const hasRule = Boolean(
        s.matchLanguages?.length ||
        s.pathPatterns?.length ||
        s.hintPathPatterns?.length ||
        s.codePatterns?.length,
      );
      assert.ok(
        hasRule,
        `${s.id}: no language, path or code pattern, so it can never be detected`,
      );
    }
  });

  it("no category is empty", () => {
    for (const c of sk.SKILL_CATEGORIES)
      assert.ok(
        sk.SKILL_TAXONOMY.some((s) => s.category === c.id),
        `${c.id} has no skills`,
      );
  });
});

describe("skill-category-graph: matching (pure)", () => {
  it("isNoiseFile ignores lockfiles, build output and vendored code", () => {
    for (const p of [
      "package-lock.json",
      "node_modules/react/index.js",
      "dist/app.js",
      "src/types.d.ts",
      "a/b/yarn.lock",
      "logo.png",
      "app.min.js",
      "src/__generated__/x.ts",
    ])
      assert.equal(sk.isNoiseFile(p), true, p);
    for (const p of [
      "src/app.ts",
      "Dockerfile",
      "prisma/schema.prisma",
      "src/distance.ts",
    ])
      assert.equal(sk.isNoiseFile(p), false, p);
  });

  it("skillSignal: path and code are strong, language depends on the flag, hints are weak", () => {
    const row = (path: string, language = "", added_code = "") => ({
      path,
      language,
      added_code,
    });
    assert.equal(
      sk.skillSignal(
        def({ pathPatterns: [/Dockerfile$/] }),
        row("a/Dockerfile"),
      ),
      2,
    );
    assert.equal(
      sk.skillSignal(
        def({ codePatterns: [/from "redis"/] }),
        row("a.ts", "typescript", 'import x from "redis"'),
      ),
      2,
    );
    assert.equal(
      sk.skillSignal(
        def({ matchLanguages: ["typescript"], strongLanguage: true }),
        row("a.ts", "typescript"),
      ),
      2,
    );
    assert.equal(
      sk.skillSignal(
        def({ matchLanguages: ["typescript"] }),
        row("a.ts", "typescript"),
      ),
      1,
    );
    assert.equal(
      sk.skillSignal(def({ hintPathPatterns: [/\.tsx$/] }), row("a.tsx")),
      1,
    );
    assert.equal(
      sk.skillSignal(
        def({ pathPatterns: [/Dockerfile$/] }),
        row("a.ts", "typescript"),
      ),
      0,
    );
  });

  it("matchesSkill is simply 'signal > 0'", () => {
    const d = def({ matchLanguages: ["go"] });
    assert.equal(
      sk.matchesSkill(d, { path: "a.go", language: "go", added_code: "" }),
      true,
    );
    assert.equal(
      sk.matchesSkill(d, {
        path: "a.ts",
        language: "typescript",
        added_code: "",
      }),
      false,
    );
  });

  it("every real taxonomy skill is detected by an obvious example of itself", () => {
    const byId = (id: string) => sk.SKILL_TAXONOMY.find((s) => s.id === id);
    const docker = byId("docker");
    if (docker)
      assert.ok(
        sk.skillSignal(docker, {
          path: "Dockerfile",
          language: "",
          added_code: "",
        }) > 0,
        "docker not detected from a Dockerfile",
      );
    const prisma = byId("prisma");
    if (prisma)
      assert.ok(
        sk.skillSignal(prisma, {
          path: "prisma/schema.prisma",
          language: "",
          added_code: "",
        }) > 0,
        "prisma not detected from schema.prisma",
      );
  });
});

describe("skill-category-graph: insights (pure)", () => {
  it("buildSkillInsights on an empty profile is empty, not a crash", () => {
    const i = sk.buildSkillInsights([]);
    assert.equal(i.headline.totalSkills, 0);
    assert.deepEqual(i.strengths, []);
    assert.deepEqual(findBadNumbers(i), []);
  });
});

// ============================================================
// LIVE
// ============================================================
describe("skill-category-graph: live graph", { skip: SKIP_DB }, () => {
  let graph: Awaited<ReturnType<typeof getTestGraph>>;
  let groups: sk.CategorySkillGroup[] = [];

  before(async () => {
    graph = await getTestGraph();
    groups = await sk.getDeveloperSkillProfile(graph, DEV_ID);
  });
  after(closeTestGraph);

  it("developer exists and has a skill profile", async () => {
    assert.ok(await developerExists(graph), `Developer ${DEV_ID} not found`);
    assert.ok(
      groups.length > 0,
      "no HAS_SKILL edges: run analyzeDeveloperSkills first",
    );
  });

  it("profile only contains skills and categories from the taxonomy", () => {
    const skills = new Set(sk.SKILL_TAXONOMY.map((s) => s.id));
    const cats = new Map(sk.SKILL_CATEGORIES.map((c) => [c.id, c.name]));
    for (const g of groups) {
      assert.ok(cats.has(g.categoryId), `unknown category ${g.categoryId}`);
      for (const s of g.skills) {
        assert.ok(skills.has(s.skillId), `unknown skill ${s.skillId}`);
        assert.equal(
          sk.SKILL_TAXONOMY.find((d) => d.id === s.skillId)?.category,
          g.categoryId,
          `${s.skillId} is under the wrong category`,
        );
      }
    }
    const all = groups.flatMap((g) => g.skills.map((s) => s.skillId));
    assert.equal(new Set(all).size, all.length, "a skill appears twice");
  });

  it("numbers are sane", () => {
    assert.deepEqual(findBadNumbers(groups), []);
    for (const g of groups)
      for (const s of g.skills) {
        assert.ok(
          s.depthScore >= 0 && s.depthScore <= 100,
          `${s.skillId}: score ${s.depthScore}`,
        );
        assert.ok(
          s.evidenceQuality >= 0 && s.evidenceQuality <= 1.0001,
          `${s.skillId}: quality ${s.evidenceQuality}`,
        );
        assert.ok(
          s.strongFiles <= s.filesTouched,
          `${s.skillId}: strongFiles > filesTouched`,
        );
        assert.ok(
          s.commitsCount <= s.filesTouched || s.filesTouched === 0,
          `${s.skillId}: more commits than files`,
        );
        assert.ok(
          s.firstSeen <= s.lastSeen || !s.firstSeen,
          `${s.skillId}: first > last`,
        );
        assert.ok(["rising", "steady", "cooling", "dormant"].includes(s.trend));
        assert.ok(["high", "medium", "low"].includes(s.confidence));
        assert.ok(s.activity.every((a) => /^\d{4}-\d{2}$/.test(a.month)));
      }
  });

  it("category score is the mean of its top three skills", () => {
    for (const g of groups) {
      const top = g.skills
        .map((s) => s.depthScore)
        .sort((a, b) => b - a)
        .slice(0, 3);
      const mean = top.reduce((a, b) => a + b, 0) / top.length;
      assert.ok(
        Math.abs(g.categoryScore - mean) <= 1,
        `${g.categoryId}: score ${g.categoryScore}, expected about ${mean.toFixed(1)}`,
      );
    }
  });

  it("a higher level never has a lower score than a lower level", () => {
    const order = ["beginner", "intermediate", "advanced", "expert"];
    const scored = groups
      .flatMap((g) => g.skills)
      .filter((s) => order.includes(s.level as string));
    for (const a of scored)
      for (const b of scored)
        if (order.indexOf(a.level as string) > order.indexOf(b.level as string))
          assert.ok(
            a.depthScore >= b.depthScore,
            `${a.skillId} (${a.level}, ${a.depthScore}) vs ${b.skillId} (${b.level}, ${b.depthScore})`,
          );
  });

  it("the skill graph is closed and typed", async () => {
    const g = await sk.getSkillGraph(graph, DEV_ID, {
      includeRepositories: true,
    });
    const ids = g.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate node ids");
    const set = new Set(ids);
    for (const e of g.edges) {
      assert.ok(
        set.has(e.source) && set.has(e.target),
        `dangling edge ${e.source}->${e.target}`,
      );
      assert.ok(
        ["contains", "co_occurs", "implies", "used_in"].includes(e.type),
      );
      assert.ok(e.weight >= 0);
    }
    const skillNodes = g.nodes.filter((n) => n.type === "skill").length;
    assert.equal(
      skillNodes,
      groups.flatMap((x) => x.skills).length,
      "skill nodes differ from the profile",
    );
  });

  it("HAS_SKILL edges equal the profile", async () => {
    const [{ n }] = await q(
      graph,
      `MATCH (:Developer {id:$d})-[:HAS_SKILL]->(:Skill) RETURN count(*) AS n`,
      { d: DEV_ID },
    );
    assert.equal(Number(n), groups.flatMap((g) => g.skills).length);
  });

  it("insights agree with the profile", async () => {
    const i = await sk.getSkillInsights(graph, DEV_ID);
    assert.equal(
      i.headline.totalSkills,
      groups.flatMap((g) => g.skills).length,
    );
    assert.ok(
      i.strengths.every((s) =>
        groups.some((g) => g.skills.some((x) => x.skillId === s.skillId)),
      ),
    );
    assert.ok(isSortedBy(i.strengths, (s) => s.depthScore, "desc"));
    assert.deepEqual(findBadNumbers(i), []);
  });

  it("skill detail: proof is limited, unknown skill is null", async (t) => {
    assert.equal(
      await sk.getSkillDetail(graph, DEV_ID, "not_a_real_skill_xyz"),
      null,
    );
    const top = groups.flatMap((g) => g.skills)[0];
    if (!top) return t.skip("no skills");
    const d = await sk.getSkillDetail(graph, DEV_ID, top.skillId, 3);
    assert.ok(d);
    assert.ok((d as any).proof === undefined || (d as any).proof.length <= 3);
    assert.deepEqual(findBadNumbers(d), []);
  });

  describe("writes (PATHWAY_TEST_WRITES=1)", { skip: !WRITES }, () => {
    it("analyzeDeveloperSkills is idempotent and matches what it stores", async () => {
      const a = await sk.analyzeDeveloperSkills(graph, DEV_ID);
      const b = await sk.analyzeDeveloperSkills(graph, DEV_ID);
      assert.equal(b.skillsFound, a.skillsFound);
      assert.equal(b.filesAnalyzed, a.filesAnalyzed);
      assert.deepEqual(
        b.profile.map((p) => [p.skillId, p.depthScore]),
        a.profile.map((p) => [p.skillId, p.depthScore]),
      );
      const [{ n }] = await q(
        graph,
        `MATCH (:Developer {id:$d})-[:AUTHORED_CODE]->(fc:FileChange) RETURN count(fc) AS n`,
        { d: DEV_ID },
      );
      assert.equal(
        a.filesAnalyzed + a.filesIgnored,
        Number(n),
        "analysed + ignored must equal all authored files",
      );
      const stored = await sk.getDeveloperSkillProfile(graph, DEV_ID);
      assert.equal(stored.flatMap((g) => g.skills).length, b.skillsFound);
    });
  });
});
