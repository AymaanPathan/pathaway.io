import type { Graph } from "../db/falkordb.js";
import {
  collectPlans,
  runTool,
  specsFor,
  type Ctx,
  type PlanMode,
  type QueryTrace,
  type Tool,
  type ToolTraceEntry,
} from "../tools/tools.index.js";

































type Obj = Record<string, any>;

const LOG_PREFIX = "[journey-agent]";
const log = (message: string, detail?: Obj): void => {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
};

const str = (v: unknown, d = ""): string =>
  v === null || v === undefined || typeof v === "object" ? d : String(v).trim();
const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];
const cut = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n)}…`;
const round = (v: number, p = 2): number => {
  const f = 10 ** p;
  return Math.round(v * f) / f;
};
const per1k = (count: number, lines: number): number =>
  lines > 0 ? round((count / lines) * 1000) : 0;
const pct = (a: number, b: number): number =>
  b > 0 ? round((a / b) * 100, 1) : 0;
const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;
const clampInt = (v: unknown, lo: number, hi: number, d: number): number =>
  Math.min(hi, Math.max(lo, Math.floor(num(v, d))));
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return (JSON.parse(v) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

const graphOf = (ctx: Ctx): Graph => ctx.graph as unknown as Graph;


async function tryRows(
  graph: Graph,
  label: string,
  query: string,
  params: Obj = {},
): Promise<Obj[] | null> {
  try {
    const result = await graph.query(query, { params });
    return (result.data ?? []) as Obj[];
  } catch (error) {
    log(`${label} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}





type Level =
  | "missing"
  | "insufficient_evidence"
  | "usage"
  | "repeated_usage"
  | "implementation"
  | "strong";

const LEVELS: Level[] = [
  "missing",
  "insufficient_evidence",
  "usage",
  "repeated_usage",
  "implementation",
  "strong",
];
const LEVEL_RANK: Record<Level, number> = {
  missing: -1,
  insufficient_evidence: 0,
  usage: 1,
  repeated_usage: 2,
  implementation: 3,
  strong: 4,
};
const asLevel = (v: unknown): Level =>
  LEVELS.includes(str(v) as Level) ? (str(v) as Level) : "missing";
const stateFor = (
  l: Level,
): "demonstrated" | "partial" | "unverified" | "missing" =>
  l === "strong" || l === "implementation"
    ? "demonstrated"
    : l === "usage" || l === "repeated_usage"
      ? "partial"
      : l === "insufficient_evidence"
        ? "unverified"
        : "missing";
const DEPTH_BY_RANK = ["", "usage", "implementation", "strong"];

const MIN_DETECTIONS = 3;
const MIN_COMMITS = 2;
const DORMANT_AFTER_DAYS = 120;





export const JOURNEY_MODEL = {
  summary:
    "One FalkorDB graph stores the sync (Developer, Repository, Commit, FileChange, PullRequest), the evidence (Demonstration, Experience), the roll-ups (HAS_CAPABILITY, HAS_SKILL) and the shared taxonomy (Capability, TechniqueSpec, Safeguard). Every journey query starts at one Developer node and follows stored edges. Nothing in the journey is typed by a person or written by a language model: it is paths through the graph.",
  whyFalkorDB: [
    "The history is naturally a web: a person made commits, commits changed files, files showed techniques, techniques prove skills. FalkorDB stores that web as nodes and edges, so the answer is a path, not a paragraph.",
    "Edges are stored connections, not join tables. Walking Developer -> Commit -> FileChange -> Demonstration -> Capability follows links; cost depends on what is touched, not on database size.",
    "Roll-ups live on edges. HAS_CAPABILITY stores level, evidence, commit and repository counts, so 'what are they good at' is an edge read, and 'why' is one more traversal down to the code.",
    "Every claim is a few hops from its code. A Demonstration node carries file, line range, permalink and snippet, and is wired to its FileChange, Commit, Repository and Capability.",
    "The taxonomy is in the same graph: Capability -> TechniqueSpec -> Safeguard lets one query compare what was expected with the hardening actually seen in the developer's code.",
    "Graph algorithms apply directly: RELATED_TO and PREREQUISITE_OF edges give skill clusters and shortest paths between skills.",
  ],
  relationships: [
    {
      type: "MADE",
      from: "Developer",
      to: "Commit",
      meaning: "The developer made this commit.",
    },
    {
      type: "CHANGED",
      from: "Commit",
      to: "FileChange",
      meaning: "The file diffs inside a commit.",
    },
    {
      type: "AUTHORED_CODE",
      from: "Developer",
      to: "FileChange",
      meaning: "The developer wrote this diff.",
    },
    {
      type: "IN_REPOSITORY",
      from: "Commit | FileChange | Demonstration | Experience",
      to: "Repository",
      meaning: "Where it lives.",
    },
    {
      type: "IN_PR",
      from: "Commit",
      to: "PullRequest",
      meaning: "The commit belongs to this pull request.",
    },
    {
      type: "AUTHORED",
      from: "Developer",
      to: "PullRequest",
      meaning: "The developer opened this pull request.",
    },
    {
      type: "DEMONSTRATED",
      from: "Developer",
      to: "Demonstration",
      meaning: "Atomic evidence owned by this developer.",
    },
    {
      type: "EVIDENCED_BY",
      from: "Demonstration",
      to: "FileChange",
      meaning: "The exact diff the evidence was extracted from.",
    },
    {
      type: "OF_CAPABILITY",
      from: "Demonstration",
      to: "Capability",
      meaning: "Which skill the evidence points to.",
    },
    {
      type: "IN_CONTEXT",
      from: "Demonstration | Experience",
      to: "EngineeringContext",
      meaning: "Which system layer it touched.",
    },
    {
      type: "USES",
      from: "Demonstration",
      to: "Skill",
      meaning: "A technology used inside one piece of evidence.",
    },
    {
      type: "EXPERIENCED",
      from: "Developer",
      to: "Experience",
      meaning: "Grouped evidence: same capability and technique.",
    },
    {
      type: "SUPPORTED_BY",
      from: "Experience",
      to: "Demonstration",
      meaning: "The detections an experience was grouped from.",
    },
    {
      type: "DEMONSTRATES_CAPABILITY",
      from: "Experience",
      to: "Capability",
      meaning: "Experience to skill.",
    },
    {
      type: "OCCURS_IN",
      from: "Experience",
      to: "Repository",
      meaning: "Experience to project.",
    },
    {
      type: "SOLVES / USES_TECHNIQUE / USES_TECHNOLOGY",
      from: "Experience",
      to: "Problem / Technique / Technology",
      meaning: "Names attached to an experience.",
    },
    {
      type: "HAS_CAPABILITY",
      from: "Developer",
      to: "Capability",
      meaning:
        "Roll-up of all demonstrations: level, evidence, commit, repo, day counts, first/last seen.",
    },
    {
      type: "SPECIALIZES",
      from: "Capability",
      to: "Capability (domain)",
      meaning: "Capability belongs to a domain.",
    },
    {
      type: "HAS_TECHNIQUE_SPEC",
      from: "Capability",
      to: "TechniqueSpec",
      meaning: "A technique the taxonomy expects.",
    },
    {
      type: "HAS_SAFEGUARD",
      from: "TechniqueSpec",
      to: "Safeguard",
      meaning: "A hardening behaviour the technique should show.",
    },
    {
      type: "RELATED_TO / PREREQUISITE_OF",
      from: "Capability",
      to: "Capability",
      meaning: "Relationships between skills in the taxonomy.",
    },
    {
      type: "HAS_SKILL",
      from: "Developer",
      to: "Skill",
      meaning:
        "Technology skill from the skill graph (separate pipeline from capability levels).",
    },
    {
      type: "DEMONSTRATED_IN",
      from: "Skill",
      to: "Repository",
      meaning: "Per-developer attribution of a technology to a repository.",
    },
  ],
  levels: {
    insufficient_evidence: "a single lone sighting",
    usage: "a primitive was used",
    repeated_usage:
      "a primitive was used in 2+ commits but the mechanism was never built",
    implementation:
      "a composed mechanism was detected, or a primitive plus 2 hardening behaviours",
    strong: "detected with hardening in 2+ separate commits",
  } as Record<string, string>,
  evidenceStatus: {
    full_patch: "the commit's patches were read in full by the detectors",
    metadata_only:
      "the commit budget deferred this commit: only metadata was stored, so no code evidence can come from it",
  },
};






async function readFunnel(g: Graph, dev: string): Promise<Obj> {
  const p = { dev };
  const [
    who,
    commits,
    fcs,
    demos,
    evFcs,
    exps,
    caps,
    doms,
    repos,
    prs,
    skills,
  ] = await Promise.all([
    tryRows(
      g,
      "funnel developer",
      `MATCH (d:Developer {id: $dev}) RETURN coalesce(d.name,"") AS name, coalesce(d.username,"") AS username, coalesce(d.avatar_url,"") AS avatar LIMIT 1`,
      p,
    ),
    tryRows(
      g,
      "funnel commits",
      `MATCH (:Developer {id: $dev})-[:MADE]->(c:Commit) RETURN count(c) AS n, sum(CASE WHEN c.evidence_status = "full_patch" THEN 1 ELSE 0 END) AS full_patch, sum(CASE WHEN c.evidence_status = "metadata_only" THEN 1 ELSE 0 END) AS metadata_only`,
      p,
    ),
    tryRows(
      g,
      "funnel file changes",
      `MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange) RETURN count(fc) AS n, count(DISTINCT fc.repository_id) AS repos, count(DISTINCT fc.commit_sha) AS commits, sum(fc.additions) AS additions, sum(fc.deletions) AS deletions`,
      p,
    ),
    tryRows(
      g,
      "funnel demonstrations",
      `MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration) RETURN count(x) AS n, count(DISTINCT x.path) AS files, count(DISTINCT x.rule_id) AS rules`,
      p,
    ),
    tryRows(
      g,
      "funnel evidenced file changes",
      `MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:EVIDENCED_BY]->(fc:FileChange) RETURN count(DISTINCT fc) AS n`,
      p,
    ),
    tryRows(
      g,
      "funnel experiences",
      `MATCH (:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience) RETURN count(e) AS n, sum(e.evidence_count) AS evidence`,
      p,
    ),
    tryRows(
      g,
      "funnel capabilities",
      `MATCH (:Developer {id: $dev})-[:HAS_CAPABILITY]->(c:Capability) WHERE c.parent_id <> "" RETURN count(c) AS n`,
      p,
    ),
    tryRows(
      g,
      "funnel domains",
      `MATCH (:Developer {id: $dev})-[:HAS_CAPABILITY]->(c:Capability)-[:SPECIALIZES]->(dom:Capability) RETURN count(DISTINCT dom) AS n`,
      p,
    ),
    tryRows(
      g,
      "funnel repositories with evidence",
      `MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:IN_REPOSITORY]->(r:Repository) RETURN count(DISTINCT r) AS n`,
      p,
    ),
    tryRows(
      g,
      "funnel pull requests",
      `MATCH (:Developer {id: $dev})-[:AUTHORED]->(pr:PullRequest) RETURN count(pr) AS n`,
      p,
    ),
    tryRows(
      g,
      "funnel skills",
      `MATCH (:Developer {id: $dev})-[:HAS_SKILL]->(s:Skill) RETURN count(s) AS n`,
      p,
    ),
  ]);

  if (who === null) return { error: "developer read failed" };
  if (who.length === 0)
    return { error: "journey_not_found", code: "journey_not_found" };

  const complete = ![
    commits,
    fcs,
    demos,
    evFcs,
    exps,
    caps,
    doms,
    repos,
    prs,
    skills,
  ].some((x) => x === null);

  const c = commits?.[0] ?? {};
  const f = fcs?.[0] ?? {};
  const d = demos?.[0] ?? {};
  const n = (r: Obj[] | null) => num(r?.[0]?.n);

  const commitN = n(commits);
  const full = num(c.full_patch);
  const meta = num(c.metadata_only);
  const fcN = n(fcs);
  const demoN = n(demos);
  const evidencedFcN = n(evFcs);

  const stages = [
    {
      label: "Developer",
      count: 1,
      via: null as string | null,
      detail: { name: str(who[0].name), username: str(who[0].username) },
    },
    {
      label: "Commit",
      count: commitN,
      via: "MADE",
      detail: {
        fullPatch: full,
        metadataOnly: meta,
        other: Math.max(0, commitN - full - meta),
      },
    },
    {
      label: "FileChange",
      count: fcN,
      via: "AUTHORED_CODE",
      detail: {
        repositories: num(f.repos),
        commitsWithPatches: num(f.commits),
        additions: num(f.additions),
        deletions: num(f.deletions),
      },
    },
    {
      label: "Demonstration",
      count: demoN,
      via: "DEMONSTRATED",
      detail: {
        distinctFiles: num(d.files),
        detectorRules: num(d.rules),
        fileChangesThatProducedEvidence: evidencedFcN,
        shareOfFileChanges: pct(evidencedFcN, fcN),
      },
    },
    {
      label: "Experience",
      count: n(exps),
      via: "EXPERIENCED",
      detail: { evidenceGrouped: num(exps?.[0]?.evidence) },
    },
    { label: "Capability", count: n(caps), via: "HAS_CAPABILITY", detail: {} },
    { label: "Domain", count: n(doms), via: "SPECIALIZES", detail: {} },
  ];

  return {
    complete,
    developer: {
      id: dev,
      name: str(who[0].name),
      username: str(who[0].username),
      avatarUrl: str(who[0].avatar),
    },
    stages,
    side: {
      repositoriesWithEvidence: n(repos),
      repositoriesTouched: num(f.repos),
      pullRequests: n(prs),
      technologySkills: n(skills),
    },
  };
}


async function readFootprint(g: Graph, dev: string): Promise<Obj> {
  const p = { dev };
  const hop = (label: string, from: string, match: string) =>
    tryRows(
      g,
      `footprint ${label}`,
      `${match} RETURN type(r) AS rel, labels(y)[0] AS target, count(*) AS n ORDER BY n DESC`,
      p,
    ).then((rows) =>
      rows === null
        ? null
        : rows.map((r) => ({
            from,
            rel: str(r.rel),
            to: str(r.target),
            count: num(r.n),
          })),
    );

  const [hub, commit, fc, demo, exp, cap] = await Promise.all([
    hop("developer", "Developer", `MATCH (:Developer {id: $dev})-[r]->(y)`),
    hop(
      "commit",
      "Commit",
      `MATCH (:Developer {id: $dev})-[:MADE]->(:Commit)-[r]->(y)`,
    ),
    hop(
      "file change",
      "FileChange",
      `MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(:FileChange)-[r]->(y)`,
    ),
    hop(
      "demonstration",
      "Demonstration",
      `MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(:Demonstration)-[r]->(y)`,
    ),
    hop(
      "experience",
      "Experience",
      `MATCH (:Developer {id: $dev})-[:EXPERIENCED]->(:Experience)-[r]->(y)`,
    ),
    hop(
      "capability",
      "Capability (shared taxonomy)",
      `MATCH (:Developer {id: $dev})-[:HAS_CAPABILITY]->(:Capability)-[r]->(y)`,
    ),
  ]);

  const developerScope = [
    ...(hub ?? []),
    ...(commit ?? []),
    ...(fc ?? []),
    ...(demo ?? []),
    ...(exp ?? []),
  ];
  const taxonomy = cap ?? [];
  const sum = (xs: Obj[]) => xs.reduce((a, x) => a + x.count, 0);

  return {
    complete: ![hub, commit, fc, demo, exp, cap].some((x) => x === null),
    developerEdges: developerScope,
    taxonomyEdges: taxonomy,
    totals: {
      developerScopeEdges: sum(developerScope),
      distinctEdgeTypes: new Set(developerScope.map((e) => e.rel)).size,
      taxonomyEdgesTouched: sum(taxonomy),
    },
  };
}

function toChain(capId: string, dev: string, r: Obj): Obj {
  const sha = str(r.commit_id);
  const path = str(r.path);
  const demoId = str(r.demo_id);
  const repo = str(r.repository);
  const prNumber = num(r.pr_number);
  const hops: string[] = [];
  if (sha) {
    hops.push(`(Developer ${dev}) -[MADE]-> (Commit ${sha.slice(0, 8)})`);
    hops.push(`(Commit ${sha.slice(0, 8)}) -[CHANGED]-> (FileChange ${path})`);
  } else {
    hops.push(`(Developer ${dev}) -[AUTHORED_CODE]-> (FileChange ${path})`);
  }
  hops.push(`(Demonstration ${demoId}) -[EVIDENCED_BY]-> (FileChange ${path})`);
  hops.push(
    `(Demonstration ${demoId}) -[OF_CAPABILITY]-> (Capability ${capId})`,
  );
  if (repo)
    hops.push(
      `(Demonstration ${demoId}) -[IN_REPOSITORY]-> (Repository ${repo})`,
    );
  if (prNumber > 0 && sha)
    hops.push(
      `(Commit ${sha.slice(0, 8)}) -[IN_PR]-> (PullRequest #${prNumber})`,
    );

  return {
    capabilityId: capId,
    path: hops,
    demonstration: {
      id: demoId,
      technique: str(r.technique),
      depth: str(r.depth) || "usage",
      hardening: str(r.modifiers).split(" | ").filter(Boolean),
      lines: `${num(r.start_line)}-${num(r.end_line)}`,
      permalink: str(r.permalink),
      snippet: cut(str(r.snippet), 600),
      detectedAt: str(r.created_at),
      changeIntent: str(r.intent),
    },
    fileChange: { id: str(r.fc_id), path, language: str(r.language) },
    commit: sha
      ? {
          id: sha,
          subject: str(r.commit_subject),
          type: str(r.commit_type),
          day: str(r.commit_day),
        }
      : null,
    repository: repo,
    layer: str(r.context),
    pullRequest:
      prNumber > 0
        ? {
            number: prNumber,
            title: str(r.pr_title),
            merged: r.pr_merged === true,
          }
        : null,
  };
}

const CHAIN_FIELDS = `
  demo_id: x.id, technique: x.technique, depth: coalesce(x.depth, "usage"),
  modifiers: coalesce(x.modifiers, ""), start_line: coalesce(x.start_line, 0),
  end_line: coalesce(x.end_line, 0), permalink: coalesce(x.permalink, ""),
  snippet: coalesce(x.snippet, ""), created_at: coalesce(x.created_at, ""),
  intent: coalesce(x.change_intent, ""), fc_id: coalesce(fc.id, ""),
  path: coalesce(fc.path, x.path, ""), language: coalesce(fc.language, ""),
  commit_id: coalesce(cm.sha, cm.id, fc.commit_sha, ""),
  commit_subject: coalesce(x.commit_subject, cm.subject, cm.message, ""),
  commit_type: coalesce(cm.commit_type, ""), commit_day: coalesce(cm.date_day, ""),
  repository: coalesce(r.full_name, r.name, ""), context: coalesce(ctx.name, ""),
  pr_number: coalesce(pr.number, 0), pr_title: coalesce(pr.title, ""),
  pr_merged: coalesce(pr.merged, false)`;

const CHAIN_MATCH = `
  OPTIONAL MATCH (x)-[:EVIDENCED_BY]->(fc:FileChange)
  OPTIONAL MATCH (cm:Commit)-[:CHANGED]->(fc)
  OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
  OPTIONAL MATCH (x)-[:IN_CONTEXT]->(ctx:EngineeringContext)
  OPTIONAL MATCH (cm)-[:IN_PR]->(pr:PullRequest)`;


async function readCapabilities(
  g: Graph,
  dev: string,
  onlyId = "",
): Promise<Obj> {
  const p = { dev, cap: onlyId };
  const [caps, techs, guards, chains] = await Promise.all([
    tryRows(
      g,
      "capabilities",
      `
      MATCH (d:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c:Capability)
      WHERE c.parent_id <> "" AND ($cap = "" OR c.id = $cap)
      OPTIONAL MATCH (c)-[:SPECIALIZES]->(dom:Capability)
      RETURN c.id AS id, c.name AS name, coalesce(c.description,"") AS description,
             coalesce(dom.id,"") AS domain_id, coalesce(dom.name,"") AS domain,
             coalesce(hc.level,"missing") AS level, coalesce(hc.recency,"") AS recency,
             coalesce(hc.evidence_count,0) AS evidence, coalesce(hc.commit_count,0) AS commits,
             coalesce(hc.repo_count,0) AS repos, coalesce(hc.active_days,0) AS active_days,
             coalesce(hc.first_seen,"") AS first_seen, coalesce(hc.last_seen,"") AS last_seen`,
      p,
    ),
    tryRows(
      g,
      "built techniques",
      `
      MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
      WHERE $cap = "" OR c.id = $cap
      RETURN c.id AS capability_id, x.rule_id AS rule_id, x.technique AS technique,
             count(x) AS built, max(x.depth_rank) AS best_rank, collect(x.modifiers) AS mods`,
      p,
    ),
    tryRows(
      g,
      "taxonomy safeguards",
      `
      MATCH (d:Developer {id: $dev})-[:HAS_CAPABILITY]->(c:Capability)-[:HAS_TECHNIQUE_SPEC]->(t:TechniqueSpec)-[:HAS_SAFEGUARD]->(sg:Safeguard)
      WHERE $cap = "" OR c.id = $cap
      OPTIONAL MATCH (d)-[:DEMONSTRATED]->(x:Demonstration)
      WHERE x.rule_id = t.rule_id
      WITH c, t, sg, max(CASE WHEN x.modifiers CONTAINS sg.modifier_label THEN 1 ELSE 0 END) AS observed
      RETURN c.id AS capability_id, t.rule_id AS rule_id, t.name AS technique,
             sg.name AS safeguard, sg.required AS required, observed`,
      p,
    ),
    tryRows(
      g,
      "proof chains",
      `
      MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
      WHERE c.parent_id <> "" AND ($cap = "" OR c.id = $cap)
      ${CHAIN_MATCH}
      WITH c, x, fc, cm, r, ctx, pr
      ORDER BY x.depth_rank DESC, x.created_at DESC
      WITH c.id AS capability_id, collect({${CHAIN_FIELDS}}) AS chains
      RETURN capability_id, chains[0..3] AS chains`,
      p,
    ),
  ]);

  if (!caps) return { error: "capability read failed" };

  const guardsByRule = new Map<string, Obj[]>();
  for (const r of guards ?? []) {
    const key = `${str(r.capability_id)}:${str(r.rule_id)}`;
    const list = guardsByRule.get(key) ?? [];
    list.push({
      name: str(r.safeguard),
      required: r.required === true,
      observed: num(r.observed) === 1,
    });
    guardsByRule.set(key, list);
  }

  const techByCap = new Map<string, Obj[]>();
  for (const r of techs ?? []) {
    const counts = new Map<string, number>();
    for (const m of strList(r.mods)) {
      for (const label of m.split(" | ")) {
        const l = label.trim();
        if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
      }
    }
    const capId = str(r.capability_id);
    const ruleId = str(r.rule_id);
    const sg = guardsByRule.get(`${capId}:${ruleId}`) ?? [];
    const list = techByCap.get(capId) ?? [];
    list.push({
      ruleId,
      technique: str(r.technique),
      built: num(r.built),
      bestDepth: DEPTH_BY_RANK[num(r.best_rank)] || "usage",
      hardeningSeen: [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([label, count]) => ({ label, count })),
      safeguards: sg,
      requiredTotal: sg.filter((s) => s.required).length,
      requiredObserved: sg.filter((s) => s.required && s.observed).length,
    });
    techByCap.set(capId, list);
  }

  const chainsByCap = new Map<string, Obj[]>();
  for (const r of chains ?? []) {
    const id = str(r.capability_id);
    const list = Array.isArray(r.chains) ? r.chains : [];
    chainsByCap.set(
      id,
      list.map((c: Obj) => toChain(id, dev, c)),
    );
  }

  const out = caps
    .map((r) => {
      const level = asLevel(r.level);
      const id = str(r.id);
      return {
        capabilityId: id,
        name: str(r.name),
        description: str(r.description),
        domainId: str(r.domain_id),
        domain: str(r.domain),
        level,
        state: stateFor(level),
        recency: str(r.recency),
        detections: num(r.evidence),
        commits: num(r.commits),
        repositories: num(r.repos),
        activeDays: num(r.active_days),
        firstSeen: str(r.first_seen),
        lastSeen: str(r.last_seen),
        techniques: (techByCap.get(id) ?? []).sort((a, b) => b.built - a.built),
        chains: chainsByCap.get(id) ?? [],
      };
    })
    .sort(
      (a, b) =>
        LEVEL_RANK[b.level as Level] - LEVEL_RANK[a.level as Level] ||
        b.detections - a.detections ||
        a.name.localeCompare(b.name),
    );

  return { complete: !!(techs && guards && chains), capabilities: out };
}


async function readExperiences(g: Graph, dev: string): Promise<Obj> {
  const rows = await tryRows(
    g,
    "experience web",
    `
    MATCH (:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)
    OPTIONAL MATCH (e)-[:DEMONSTRATES_CAPABILITY]->(c:Capability)
    OPTIONAL MATCH (e)-[:SOLVES]->(pb:Problem)
    OPTIONAL MATCH (e)-[:USES_TECHNIQUE]->(t:Technique)
    OPTIONAL MATCH (e)-[:USES_TECHNOLOGY]->(tech:Technology)
    OPTIONAL MATCH (e)-[:IN_CONTEXT]->(ctx:EngineeringContext)
    OPTIONAL MATCH (e)-[:OCCURS_IN]->(r:Repository)
    OPTIONAL MATCH (e)-[:SUPPORTED_BY]->(x:Demonstration)
    RETURN e.id AS id, e.technique AS technique, coalesce(e.summary,"") AS summary,
           coalesce(e.best_depth,"usage") AS depth, coalesce(e.evidence_count,0) AS evidence,
           coalesce(e.commit_count,0) AS commits, coalesce(e.repo_count,0) AS repos,
           coalesce(e.active_days,0) AS active_days, coalesce(e.first_seen,"") AS first_seen,
           coalesce(e.last_seen,"") AS last_seen, coalesce(c.id,"") AS capability_id,
           collect(DISTINCT pb.statement)[0] AS example_commit_subject,
           collect(DISTINCT t.name) AS techniques, collect(DISTINCT tech.name) AS technologies,
           collect(DISTINCT ctx.name) AS contexts,
           collect(DISTINCT coalesce(r.full_name, r.name)) AS repositories,
           count(DISTINCT x) AS supported_by
    ORDER BY evidence DESC`,
    { dev },
  );
  if (!rows) return { error: "experience read failed" };

  return {
    experiences: rows.map((r) => ({
      id: str(r.id),
      technique: str(r.technique),
      capabilityId: str(r.capability_id),
      depth: str(r.depth),
      detections: num(r.evidence),
      supportedByEdges: num(r.supported_by),
      commits: num(r.commits),
      repositoriesCount: num(r.repos),
      activeDays: num(r.active_days),
      firstSeen: str(r.first_seen),
      lastSeen: str(r.last_seen),
      summary: str(r.summary),
      
      exampleCommitSubject: str(r.example_commit_subject),
      techniques: strList(r.techniques),
      technologies: strList(r.technologies),
      layers: strList(r.contexts),
      repositories: strList(r.repositories),
    })),
  };
}


async function readSkillLinks(g: Graph, dev: string): Promise<Obj> {
  const [out, inc] = await Promise.all([
    tryRows(
      g,
      "skill links out",
      `
      MATCH (d:Developer {id: $dev})-[ha:HAS_CAPABILITY]->(a:Capability)-[r:RELATED_TO|PREREQUISITE_OF]->(b:Capability)
      OPTIONAL MATCH (d)-[hb:HAS_CAPABILITY]->(b)
      RETURN a.id AS a_id, a.name AS a_name, coalesce(ha.level,"missing") AS a_level,
             type(r) AS rel, b.id AS b_id, b.name AS b_name, coalesce(hb.level,"missing") AS b_level`,
      { dev },
    ),
    tryRows(
      g,
      "skill links in",
      `
      MATCH (d:Developer {id: $dev})-[hb:HAS_CAPABILITY]->(b:Capability)
      MATCH (a:Capability)-[r:RELATED_TO|PREREQUISITE_OF]->(b)
      OPTIONAL MATCH (d)-[ha:HAS_CAPABILITY]->(a)
      RETURN a.id AS a_id, a.name AS a_name, coalesce(ha.level,"missing") AS a_level,
             type(r) AS rel, b.id AS b_id, b.name AS b_name, coalesce(hb.level,"missing") AS b_level`,
      { dev },
    ),
  ]);
  if (!out || !inc) return { error: "skill link read failed" };

  const seen = new Set<string>();
  const links: Obj[] = [];
  for (const r of [...out, ...inc]) {
    const key = `${str(r.a_id)}|${str(r.rel)}|${str(r.b_id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const aLevel = asLevel(r.a_level);
    const bLevel = asLevel(r.b_level);
    links.push({
      from: { id: str(r.a_id), name: str(r.a_name), level: aLevel },
      rel: str(r.rel),
      to: { id: str(r.b_id), name: str(r.b_name), level: bLevel },
      bothDetected: aLevel !== "missing" && bLevel !== "missing",
    });
  }

  
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    const px = parent.get(x)!;
    if (px === x) return x;
    const root = find(px);
    parent.set(x, root);
    return root;
  };
  const names = new Map<string, string>();
  for (const l of links.filter((x) => x.bothDetected)) {
    names.set(l.from.id, l.from.name);
    names.set(l.to.id, l.to.name);
    parent.set(find(l.from.id), find(l.to.id));
  }
  const groups = new Map<string, string[]>();
  for (const id of names.keys()) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), names.get(id)!]);
  }

  return {
    links,
    clusters: [...groups.values()]
      .filter((x) => x.length > 1)
      .map((x) => x.sort()),
  };
}


async function readSkillMap(
  g: Graph,
  dev: string,
  repository = "",
): Promise<Obj> {
  const [attr, used] = await Promise.all([
    tryRows(
      g,
      "skill attribution",
      `
      MATCH (d:Developer {id: $dev})-[hs:HAS_SKILL]->(s:Skill)-[di:DEMONSTRATED_IN]->(r:Repository)
      WHERE di.developer_id = $dev
        AND ($repo = "" OR toLower(coalesce(r.full_name, r.name, "")) CONTAINS $repo)
      RETURN s.name AS skill, coalesce(hs.level,"") AS level,
             coalesce(r.full_name, r.name, "") AS repository,
             coalesce(di.evidence_count,0) AS evidence, coalesce(di.commit_count,0) AS commits
      ORDER BY evidence DESC LIMIT 400`,
      { dev, repo: repository.trim().toLowerCase() },
    ),
    tryRows(
      g,
      "skills in demonstrations",
      `
      MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:USES]->(s:Skill)
      RETURN s.name AS skill, count(x) AS demonstrations, collect(DISTINCT x.technique)[0..3] AS techniques
      ORDER BY demonstrations DESC LIMIT 30`,
      { dev },
    ),
  ]);
  if (!attr || !used) return { error: "skill map read failed" };

  const bySkill = new Map<string, Obj>();
  for (const r of attr) {
    const k = str(r.skill);
    const e = bySkill.get(k) ?? {
      skill: k,
      level: str(r.level),
      evidence: 0,
      commits: 0,
      repositories: [] as Obj[],
    };
    e.evidence += num(r.evidence);
    e.commits += num(r.commits);
    e.repositories.push({
      name: str(r.repository),
      evidence: num(r.evidence),
      commits: num(r.commits),
    });
    bySkill.set(k, e);
  }

  return {
    
    skills: [...bySkill.values()]
      .sort((a, b) => b.evidence - a.evidence)
      .slice(0, 25),
    usedInDemonstrations: used.map((r) => ({
      skill: str(r.skill),
      demonstrations: num(r.demonstrations),
      techniques: strList(r.techniques),
    })),
  };
}


async function readRepositories(g: Graph, dev: string): Promise<Obj> {
  const [fcs, demos] = await Promise.all([
    tryRows(
      g,
      "repository file changes",
      `
      MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
      WITH fc.repository_id AS rid, count(fc) AS file_changes,
           count(DISTINCT fc.commit_sha) AS commits, sum(fc.additions) AS additions,
           sum(fc.deletions) AS deletions,
           sum(CASE WHEN fc.patch IS NULL OR fc.patch = "" THEN 1 ELSE 0 END) AS no_patch
      WHERE rid IS NOT NULL
      OPTIONAL MATCH (r:Repository {id: rid})
      RETURN toString(rid) AS rid, coalesce(r.full_name, r.name, toString(rid)) AS name,
             coalesce(r.language,"") AS language, coalesce(r.analysis_status,"") AS status,
             file_changes, commits, additions, deletions, no_patch
      ORDER BY file_changes DESC`,
      { dev },
    ),
    tryRows(
      g,
      "repository detections",
      `
      MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:IN_REPOSITORY]->(r:Repository)
      OPTIONAL MATCH (x)-[:OF_CAPABILITY]->(c:Capability)
      RETURN coalesce(r.full_name, r.name, "") AS name, count(x) AS detections,
             collect(DISTINCT c.name) AS capabilities, collect(DISTINCT x.technique) AS techniques`,
      { dev },
    ),
  ]);
  if (!fcs) return { error: "repository read failed" };

  const det = new Map<string, Obj>();
  for (const r of demos ?? []) det.set(str(r.name), r);

  const repositories = fcs.map((r) => {
    const d = det.get(str(r.name));
    const changes = num(r.file_changes);
    const noPatch = num(r.no_patch);
    const status = str(r.status);
    return {
      name: str(r.name),
      language: str(r.language),
      fileChanges: changes,
      commits: num(r.commits),
      additions: num(r.additions),
      deletions: num(r.deletions),
      detections: num(d?.detections),
      capabilities: strList(d?.capabilities).sort(),
      techniques: strList(d?.techniques).sort(),
      readable: !(
        status === "failed" ||
        status === "partial" ||
        (changes > 0 && noPatch / changes > 0.5)
      ),
    };
  });

  return {
    complete: demos !== null,
    repositories,
    coverage: {
      repositories: repositories.length,
      withDetections: repositories.filter((r) => r.detections > 0).length,
      withoutDetections: repositories.filter((r) => r.detections === 0).length,
      partlyReadable: repositories
        .filter((r) => !r.readable)
        .map((r) => r.name)
        .slice(0, 8),
    },
  };
}


async function readCodeProfile(
  g: Graph,
  dev: string,
  sample = 1500,
): Promise<Obj> {
  const limit = clampInt(sample, 100, 4000, 1500);
  const p = { dev };
  const [
    totals,
    langs,
    roles,
    rows,
    cTotals,
    cTypes,
    cHours,
    cDays,
    intents,
    habits,
  ] = await Promise.all([
    tryRows(
      g,
      "code totals",
      `MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange) RETURN count(fc) AS files, sum(fc.additions) AS additions, sum(CASE WHEN fc.is_test = true THEN 1 ELSE 0 END) AS test_files, sum(CASE WHEN fc.file_role = "source" THEN 1 ELSE 0 END) AS source_files`,
      p,
    ),
    tryRows(
      g,
      "code languages",
      `MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange) RETURN coalesce(fc.language,"unknown") AS language, count(fc) AS files, sum(fc.additions) AS additions, sum(fc.deletions) AS deletions ORDER BY files DESC LIMIT 12`,
      p,
    ),
    tryRows(
      g,
      "code roles",
      `MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange) RETURN coalesce(fc.file_role,"source") AS role, count(fc) AS files ORDER BY files DESC`,
      p,
    ),
    tryRows(
      g,
      "code json columns",
      `
      MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
      RETURN fc.commit_sha AS sha, fc.repository_id AS repo, coalesce(fc.additions,0) AS additions,
             fc.code_signals_json AS signals, fc.symbols_added_json AS sym_added,
             fc.symbols_modified_json AS sym_modified, fc.imports_added_json AS imports,
             coalesce(fc.comment_lines_added,0) AS comments, coalesce(fc.max_indent_depth,0) AS indent
      ORDER BY fc.date_ts DESC LIMIT $limit`,
      { dev, limit },
    ),
    tryRows(
      g,
      "commit totals",
      `MATCH (:Developer {id: $dev})-[:MADE]->(c:Commit) RETURN count(c) AS commits, count(DISTINCT c.date_day) AS active_days, min(c.date_day) AS first_day, max(c.date_day) AS last_day, sum(CASE WHEN c.is_revert = true THEN 1 ELSE 0 END) AS reverts, avg(c.files_count) AS avg_files, avg(c.additions) AS avg_additions`,
      p,
    ),
    tryRows(
      g,
      "commit types",
      `MATCH (:Developer {id: $dev})-[:MADE]->(c:Commit) RETURN coalesce(c.commit_type,"other") AS type, count(c) AS n ORDER BY n DESC`,
      p,
    ),
    tryRows(
      g,
      "commit hours",
      `MATCH (:Developer {id: $dev})-[:MADE]->(c:Commit) WHERE c.utc_hour IS NOT NULL RETURN c.utc_hour AS k, count(c) AS n`,
      p,
    ),
    tryRows(
      g,
      "commit weekdays",
      `MATCH (:Developer {id: $dev})-[:MADE]->(c:Commit) WHERE c.utc_weekday IS NOT NULL RETURN c.utc_weekday AS k, count(c) AS n`,
      p,
    ),
    tryRows(
      g,
      "change intents",
      `MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration) RETURN coalesce(x.change_intent,"change") AS name, count(x) AS n ORDER BY n DESC LIMIT 8`,
      p,
    ),
    tryRows(
      g,
      "hardening habits",
      `MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration) WHERE x.modifiers IS NOT NULL AND x.modifiers <> "" UNWIND split(x.modifiers, " | ") AS label RETURN label, count(*) AS n ORDER BY n DESC LIMIT 12`,
      p,
    ),
  ]);

  const t = totals?.[0] ?? {};
  const fileChanges = num(t.files);
  const testFiles = num(t.test_files);
  const sourceFiles = num(t.source_files);

  const signalMap = new Map<string, { count: number; files: number }>();
  const kindMap = new Map<string, number>();
  const pkgMap = new Map<
    string,
    { files: number; shas: Set<string>; repos: Set<string> }
  >();
  let sampledLines = 0;
  let commentLines = 0;
  let indentSum = 0;
  let indentRows = 0;

  for (const r of rows ?? []) {
    sampledLines += num(r.additions);
    commentLines += num(r.comments);
    if (num(r.indent) > 0) {
      indentSum += num(r.indent);
      indentRows++;
    }
    for (const [name, count] of Object.entries(
      parseJson<Record<string, number>>(r.signals, {}),
    )) {
      const s = signalMap.get(name) ?? { count: 0, files: 0 };
      s.count += num(count);
      s.files += 1;
      signalMap.set(name, s);
    }
    for (const sym of [
      ...strList(parseJson<unknown[]>(r.sym_added, [])),
      ...strList(parseJson<unknown[]>(r.sym_modified, [])),
    ]) {
      const kind = sym.split(":")[0] || "symbol";
      kindMap.set(kind, (kindMap.get(kind) ?? 0) + 1);
    }
    for (const name of strList(parseJson<unknown[]>(r.imports, []))) {
      const e = pkgMap.get(name) ?? {
        files: 0,
        shas: new Set<string>(),
        repos: new Set<string>(),
      };
      e.files += 1;
      if (str(r.sha)) e.shas.add(str(r.sha));
      if (str(r.repo)) e.repos.add(str(r.repo));
      pkgMap.set(name, e);
    }
  }
  const sig = (n: string) => signalMap.get(n)?.count ?? 0;

  const ct = cTotals?.[0] ?? {};
  const hours = Array<number>(24).fill(0);
  for (const r of cHours ?? []) {
    const k = num(r.k, -1);
    if (k >= 0 && k < 24) hours[k] = num(r.n);
  }
  const weekdays = Array<number>(7).fill(0);
  for (const r of cDays ?? []) {
    const k = num(r.k, -1);
    if (k >= 0 && k < 7) weekdays[k] = num(r.n);
  }

  return {
    complete: ![
      totals,
      langs,
      roles,
      rows,
      cTotals,
      cTypes,
      cHours,
      cDays,
      intents,
      habits,
    ].some((x) => x === null),
    sampled: fileChanges > (rows?.length ?? 0),
    sampleSize: rows?.length ?? 0,
    fileChanges,
    addedLines: num(t.additions),
    languages: (langs ?? []).map((r) => ({
      language: str(r.language),
      files: num(r.files),
      additions: num(r.additions),
      deletions: num(r.deletions),
    })),
    roles: (roles ?? []).map((r) => ({
      role: str(r.role),
      files: num(r.files),
    })),
    testing: {
      testFiles,
      sourceFiles,
      testSharePercent: pct(testFiles, testFiles + sourceFiles),
    },
    
    signals: [...signalMap.entries()]
      .map(([name, s]) => ({
        name,
        count: s.count,
        files: s.files,
        per1kLines: per1k(s.count, sampledLines),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    symbolKinds: [...kindMap.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    imports: [...pkgMap.entries()]
      .map(([name, e]) => ({
        name,
        files: e.files,
        commits: e.shas.size,
        repositories: e.repos.size,
      }))
      .sort((a, b) => b.files - a.files)
      .slice(0, 30),
    hygiene: {
      anyUsagePer1k: per1k(sig("any_usage"), sampledLines),
      suppressionsPer1k: per1k(sig("lint_type_suppressions"), sampledLines),
      asyncPer1k: per1k(sig("async_await"), sampledLines),
      errorHandlingPer1k: per1k(sig("error_handling"), sampledLines),
      commentShare: sampledLines > 0 ? round(commentLines / sampledLines) : 0,
      avgIndentDepth: indentRows > 0 ? round(indentSum / indentRows, 1) : 0,
    },
    commitShape: {
      commits: num(ct.commits),
      activeDays: num(ct.active_days),
      firstDay: str(ct.first_day),
      lastDay: str(ct.last_day),
      reverts: num(ct.reverts),
      avgFilesPerCommit: round(num(ct.avg_files), 1),
      avgAddedLinesPerCommit: round(num(ct.avg_additions), 0),
      types: (cTypes ?? []).map((r) => ({
        type: str(r.type),
        count: num(r.n),
      })),
      byHourUtc: hours,
      byWeekdayUtc: weekdays,
    },
    changeIntents: (intents ?? []).map((r) => ({
      intent: str(r.name),
      detections: num(r.n),
    })),
    hardeningHabits: (habits ?? []).map((r) => ({
      label: str(r.label),
      count: num(r.n),
    })),
  };
}


async function readCollaboration(g: Graph, dev: string): Promise<Obj> {
  const [prs, issues, reviewed] = await Promise.all([
    tryRows(
      g,
      "pull requests",
      `
      MATCH (:Developer {id: $dev})-[:AUTHORED]->(p:PullRequest)
      OPTIONAL MATCH (c:Commit)-[:IN_PR]->(p)
      OPTIONAL MATCH (c)-[:IN_REPOSITORY]->(r:Repository)
      WITH p, count(DISTINCT c) AS linked, collect(DISTINCT coalesce(r.full_name, r.name, "")) AS repos
      RETURN p.number AS number, coalesce(p.title,"") AS title, p.merged AS merged,
             coalesce(p.merged_at,"") AS merged_at, coalesce(p.time_to_merge_hours,0) AS hours,
             coalesce(p.additions,0) AS additions, coalesce(p.changed_files,0) AS files,
             p.created_at AS created_at, p.review_states_json AS states,
             p.reviewers_json AS reviewers, p.review_feedback_json AS feedback, linked, repos
      ORDER BY created_at DESC LIMIT 80`,
      { dev },
    ),
    tryRows(
      g,
      "issues opened",
      `MATCH (:Developer {id: $dev})-[:OPENED]->(i:Issue) RETURN count(i) AS n`,
      { dev },
    ),
    tryRows(
      g,
      "reviews for others",
      `MATCH (:Developer {id: $dev})-[:REVIEWED]->(p:ReviewedPullRequest) WHERE p.is_own_repo = false RETURN count(p) AS n`,
      { dev },
    ),
  ]);
  if (!prs) return { error: "pull request read failed" };

  const states = new Map<string, number>();
  const reviewers = new Map<string, number>();
  const feedback: Obj[] = [];
  const list = prs.map((r) => {
    for (const [s, n] of Object.entries(
      parseJson<Record<string, number>>(r.states, {}),
    ))
      states.set(s, (states.get(s) ?? 0) + num(n));
    for (const login of strList(parseJson<unknown[]>(r.reviewers, [])))
      reviewers.set(login, (reviewers.get(login) ?? 0) + 1);
    for (const f of parseJson<Obj[]>(r.feedback, [])) {
      const body = str(f?.body);
      if (body)
        feedback.push({
          pullRequest: `#${num(r.number)}`,
          path: str(f?.path),
          author: str(f?.author),
          body: cut(body, 300),
        });
    }
    return {
      number: num(r.number),
      title: str(r.title),
      repository: strList(r.repos)[0] ?? "",
      merged: r.merged === true || str(r.merged_at) !== "",
      hoursToMerge: num(r.hours),
      additions: num(r.additions),
      changedFiles: num(r.files),
      linkedCommits: num(r.linked),
    };
  });
  const merged = list.filter((x) => x.merged);

  return {
    complete: issues !== null && reviewed !== null,
    pullRequests: list,
    totals: {
      authored: list.length,
      merged: merged.length,
      linkedToCommits: list.filter((x) => x.linkedCommits > 0).length,
      
      meanHoursToMerge: merged.length
        ? round(
            merged.reduce((n, x) => n + x.hoursToMerge, 0) / merged.length,
            1,
          )
        : 0,
    },
    reviewStates: [...states.entries()]
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count),
    reviewers: [...reviewers.entries()]
      .map(([login, count]) => ({ login, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    feedback: feedback.slice(0, 12),
    issuesOpened: num(issues?.[0]?.n),
    reviewedForOthers: num(reviewed?.[0]?.n),
  };
}


async function readEvolution(
  g: Graph,
  dev: string,
  capabilityId = "",
): Promise<Obj> {
  const p = { dev, cap: capabilityId };
  const [timeline, caps] = await Promise.all([
    tryRows(
      g,
      "evolution timeline",
      `
      MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
      WHERE x.created_at IS NOT NULL AND x.created_at <> "" AND c.parent_id <> "" AND ($cap = "" OR c.id = $cap)
      RETURN substring(x.created_at, 0, 7) AS month, c.id AS capability_id, c.name AS name,
             count(x) AS n, max(x.depth_rank) AS best_rank
      ORDER BY month`,
      p,
    ),
    tryRows(
      g,
      "evolution capabilities",
      `
      MATCH (:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c:Capability)
      WHERE c.parent_id <> "" AND ($cap = "" OR c.id = $cap)
      RETURN c.id AS id, c.name AS name, coalesce(hc.level,"missing") AS level,
             coalesce(hc.evidence_count,0) AS evidence, coalesce(hc.commit_count,0) AS commits,
             coalesce(hc.repo_count,0) AS repos, coalesce(hc.first_seen,"") AS first_seen,
             coalesce(hc.last_seen,"") AS last_seen`,
      p,
    ),
  ]);
  if (!timeline || !caps) return { error: "evolution read failed" };

  const monthly = new Map<string, Obj[]>();
  for (const r of timeline) {
    const month = str(r.month);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const id = str(r.capability_id);
    const list = monthly.get(id) ?? [];
    list.push({
      month,
      detections: num(r.n),
      bestDepth: DEPTH_BY_RANK[num(r.best_rank)] || "usage",
      rank: num(r.best_rank),
    });
    monthly.set(id, list);
  }

  const now = Date.now();
  const capabilities = caps.map((r) => {
    const id = str(r.id);
    const level = asLevel(r.level);
    const m = (monthly.get(id) ?? []).sort((a, b) =>
      a.month.localeCompare(b.month),
    );
    const reached: Obj = {};
    for (const [rank, label] of [
      [1, "usage"],
      [2, "implementation"],
      [3, "strong"],
    ] as const) {
      const first = m.find((x) => x.rank >= rank);
      if (first) reached[label] = first.month;
    }
    const last = Date.parse(str(r.last_seen));
    const daysQuiet = Number.isFinite(last)
      ? Math.floor((now - last) / 86_400_000)
      : null;
    const repos = num(r.repos);
    const commits = num(r.commits);
    const evidence = num(r.evidence);
    let state: "plateau" | "dormant" | "active" = "active";
    if (
      (level === "usage" || level === "repeated_usage") &&
      (repos >= 2 || commits >= 4 || evidence >= 6)
    )
      state = "plateau";
    else if (
      (level === "implementation" || level === "strong") &&
      daysQuiet !== null &&
      daysQuiet > DORMANT_AFTER_DAYS
    )
      state = "dormant";
    return {
      capabilityId: id,
      name: str(r.name),
      level,
      detections: evidence,
      firstSeen: str(r.first_seen),
      lastSeen: str(r.last_seen),
      daysSinceLastDetection: daysQuiet,
      monthsActive: m.length,
      firstReachedDepthInMonth: reached,
      state,
      monthly: m.map(({ month, detections, bestDepth }) => ({
        month,
        detections,
        bestDepth,
      })),
    };
  });

  return {
    capabilities: capabilities.sort((a, b) => b.detections - a.detections),
    plateaus: capabilities
      .filter((c) => c.state === "plateau")
      .map((c) => c.name),
    dormant: capabilities
      .filter((c) => c.state === "dormant")
      .map((c) => ({ name: c.name, lastSeen: c.lastSeen })),
  };
}


async function readHotspots(g: Graph, dev: string, limit = 12): Promise<Obj> {
  const n = clampInt(limit, 1, 30, 12);
  const [spots, pairs] = await Promise.all([
    tryRows(
      g,
      "hotspots",
      `
      MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
      WHERE fc.is_source_code = true
      OPTIONAL MATCH (fc)-[:IN_REPOSITORY]->(r:Repository)
      RETURN fc.path AS path, coalesce(r.full_name, r.name, "") AS repository,
             count(DISTINCT fc.commit_sha) AS commits, sum(fc.additions) AS additions, sum(fc.deletions) AS deletions
      ORDER BY commits DESC LIMIT $limit`,
      { dev, limit: n },
    ),
    tryRows(
      g,
      "co-change pairs",
      `
      MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(a:FileChange)<-[:CHANGED]-(c:Commit)-[:CHANGED]->(b:FileChange)
      WHERE a.path < b.path AND a.is_source_code = true AND b.is_source_code = true
      WITH a.repository_id AS rid, a.path AS path_a, b.path AS path_b, count(DISTINCT c) AS together
      WHERE together >= 3
      OPTIONAL MATCH (r:Repository {id: rid})
      RETURN coalesce(r.full_name, r.name, "") AS repository, path_a, path_b, together
      ORDER BY together DESC LIMIT $limit`,
      { dev, limit: n },
    ),
  ]);
  if (!spots || !pairs) return { error: "hotspot read failed" };
  return {
    hotspots: spots.map((r) => ({
      path: str(r.path),
      repository: str(r.repository),
      commits: num(r.commits),
      additions: num(r.additions),
      deletions: num(r.deletions),
      rewriteRatio:
        num(r.additions) > 0 ? round(num(r.deletions) / num(r.additions)) : 0,
    })),
    coChanges: pairs.map((r) => ({
      repository: str(r.repository),
      fileA: str(r.path_a),
      fileB: str(r.path_b),
      commitsTogether: num(r.together),
    })),
  };
}



async function traceCapability(
  g: Graph,
  dev: string,
  id: string,
  limit: number,
): Promise<Obj> {
  const cid = id.trim();
  if (!cid) return { error: "capability_id is required" };
  const n = clampInt(limit, 1, 20, 6);
  const [head, rows, detail] = await Promise.all([
    tryRows(
      g,
      "capability header",
      `
      MATCH (c:Capability {id: $cid})
      OPTIONAL MATCH (:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c)
      RETURN c.name AS name, coalesce(hc.level,"missing") AS level, coalesce(hc.evidence_count,0) AS evidence LIMIT 1`,
      { dev, cid },
    ),
    tryRows(
      g,
      "capability chains",
      `
      MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
      WHERE c.id = $cid OR c.parent_id = $cid
      ${CHAIN_MATCH}
      RETURN c.id AS capability_id, ${CHAIN_FIELDS.replace(/\n/g, " ")}
      ORDER BY x.depth_rank DESC, x.created_at DESC LIMIT ${n}`,
      { dev, cid },
    ),
    readCapabilities(g, dev, cid),
  ]);
  if (!head || head.length === 0)
    return { error: `unknown capability "${cid}"` };
  if (!rows) return { error: "chain read failed" };
  const cap = (detail.capabilities as Obj[] | undefined)?.[0];
  return {
    capabilityId: cid,
    name: str(head[0].name),
    level: asLevel(head[0].level),
    detections: num(head[0].evidence),
    howWeKnow: cap ? howWeKnow(cap) : null,
    techniques: cap?.techniques ?? [],
    chains: rows.map((r) => toChain(str(r.capability_id), dev, r)),
  };
}

async function traceRepository(
  g: Graph,
  dev: string,
  name: string,
): Promise<Obj> {
  const q = name.trim().toLowerCase();
  if (!q) return { error: "repository is required" };
  const [det, foot] = await Promise.all([
    tryRows(
      g,
      "repository trace",
      `
      MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:IN_REPOSITORY]->(r:Repository)
      WHERE toLower(coalesce(r.full_name, r.name, "")) CONTAINS $q
      OPTIONAL MATCH (x)-[:OF_CAPABILITY]->(c:Capability)
      RETURN coalesce(r.full_name, r.name) AS repository, coalesce(c.id,"") AS capability_id,
             coalesce(c.name,"") AS capability, x.technique AS technique, count(x) AS detections,
             max(x.depth_rank) AS best_rank, min(x.created_at) AS first, max(x.created_at) AS last,
             collect(DISTINCT x.permalink)[0] AS sample_permalink
      ORDER BY detections DESC LIMIT 60`,
      { dev, q },
    ),
    tryRows(
      g,
      "repository footprint",
      `
      MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)-[:IN_REPOSITORY]->(r:Repository)
      WHERE toLower(coalesce(r.full_name, r.name, "")) CONTAINS $q
      RETURN coalesce(r.full_name, r.name) AS repository, count(fc) AS file_changes,
             count(DISTINCT fc.commit_sha) AS commits, collect(DISTINCT fc.language)[0..6] AS languages`,
      { dev, q },
    ),
  ]);
  if (!det || !foot) return { error: "repository read failed" };
  return {
    query: name,
    footprint: foot.map((r) => ({
      repository: str(r.repository),
      fileChanges: num(r.file_changes),
      commits: num(r.commits),
      languages: strList(r.languages),
    })),
    detections: det.map((r) => ({
      repository: str(r.repository),
      capabilityId: str(r.capability_id),
      capability: str(r.capability),
      technique: str(r.technique),
      detections: num(r.detections),
      bestDepth: DEPTH_BY_RANK[num(r.best_rank)] || "usage",
      firstDetected: str(r.first),
      lastDetected: str(r.last),
      samplePermalink: str(r.sample_permalink),
    })),
  };
}

async function traceCommit(g: Graph, dev: string, sha: string): Promise<Obj> {
  const s = sha.trim().toLowerCase();
  if (!/^[0-9a-f]{6,40}$/.test(s))
    return { error: "sha must be 6 to 40 hex characters" };
  const rows = await tryRows(
    g,
    "commit trace",
    `
    MATCH (d:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
    WHERE fc.commit_sha STARTS WITH $sha
    OPTIONAL MATCH (cm:Commit)-[:CHANGED]->(fc)
    OPTIONAL MATCH (d)-[:DEMONSTRATED]->(x:Demonstration)-[:EVIDENCED_BY]->(fc)
    OPTIONAL MATCH (x)-[:OF_CAPABILITY]->(c:Capability)
    OPTIONAL MATCH (fc)-[:IN_REPOSITORY]->(r:Repository)
    OPTIONAL MATCH (cm)-[:IN_PR]->(pr:PullRequest)
    RETURN fc.commit_sha AS sha, fc.id AS fc_id, fc.path AS path, fc.language AS language,
           fc.additions AS additions, fc.deletions AS deletions, coalesce(r.full_name, r.name, "") AS repository,
           cm.commit_type AS commit_type, cm.date_day AS day, cm.evidence_status AS evidence_status,
           pr.number AS pr_number, pr.title AS pr_title, x.id AS demo_id, x.technique AS technique,
           c.id AS capability_id, c.name AS capability, x.permalink AS permalink, x.modifiers AS modifiers
    LIMIT 200`,
    { dev, sha: s },
  );
  if (!rows) return { error: "commit read failed" };
  if (!rows.length)
    return { error: `no file changes of yours in a commit starting with ${s}` };
  const files = new Map<string, Obj>();
  for (const r of rows) {
    const key = str(r.fc_id) || str(r.path);
    const e = files.get(key) ?? {
      path: str(r.path),
      language: str(r.language),
      additions: num(r.additions),
      deletions: num(r.deletions),
      detections: [] as Obj[],
    };
    if (str(r.demo_id)) {
      e.detections.push({
        demonstrationId: str(r.demo_id),
        technique: str(r.technique),
        capabilityId: str(r.capability_id),
        capability: str(r.capability),
        hardening: str(r.modifiers).split(" | ").filter(Boolean),
        permalink: str(r.permalink),
      });
    }
    files.set(key, e);
  }
  const f = rows[0];
  return {
    sha: str(f.sha),
    repository: str(f.repository),
    commit: {
      type: str(f.commit_type),
      day: str(f.day),
      evidenceStatus: str(f.evidence_status),
    },
    pullRequest:
      num(f.pr_number) > 0
        ? { number: num(f.pr_number), title: str(f.pr_title) }
        : null,
    path: [
      `(Developer ${dev}) -[MADE]-> (Commit ${str(f.sha).slice(0, 8)}) -[CHANGED]-> (FileChange x${files.size}) <-[EVIDENCED_BY]- (Demonstration) -[OF_CAPABILITY]-> (Capability)`,
    ],
    fileChanges: [...files.values()],
  };
}

async function traceFile(g: Graph, dev: string, path: string): Promise<Obj> {
  const q = path.trim().toLowerCase();
  if (q.length < 3) return { error: "path must be at least 3 characters" };
  const [files, demos] = await Promise.all([
    tryRows(
      g,
      "file trace",
      `
      MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
      WHERE toLower(fc.path) CONTAINS $q
      OPTIONAL MATCH (fc)-[:IN_REPOSITORY]->(r:Repository)
      RETURN fc.path AS path, coalesce(r.full_name, r.name, "") AS repository,
             count(DISTINCT fc.commit_sha) AS commits, sum(fc.additions) AS additions, sum(fc.deletions) AS deletions
      ORDER BY commits DESC LIMIT 15`,
      { dev, q },
    ),
    tryRows(
      g,
      "file detections",
      `
      MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
      WHERE toLower(x.path) CONTAINS $q
      RETURN x.path AS path, c.id AS capability_id, c.name AS capability, x.technique AS technique,
             count(x) AS detections, collect(x.permalink)[0] AS sample_permalink
      ORDER BY detections DESC LIMIT 30`,
      { dev, q },
    ),
  ]);
  if (!files || !demos) return { error: "file read failed" };
  return {
    query: path,
    files: files.map((r) => ({
      path: str(r.path),
      repository: str(r.repository),
      commits: num(r.commits),
      additions: num(r.additions),
      deletions: num(r.deletions),
    })),
    detections: demos.map((r) => ({
      path: str(r.path),
      capabilityId: str(r.capability_id),
      capability: str(r.capability),
      technique: str(r.technique),
      detections: num(r.detections),
      samplePermalink: str(r.sample_permalink),
    })),
  };
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "how",
  "can",
  "have",
  "does",
  "did",
  "what",
  "show",
  "about",
  "into",
  "from",
  "good",
  "skills",
  "skill",
  "code",
  "work",
  "build",
]);

async function searchCapabilities(
  g: Graph,
  dev: string,
  text: string,
): Promise<Obj> {
  const tokens = [
    ...new Set(
      (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(
        (t) => !STOP.has(t),
      ),
    ),
  ].slice(0, 12);
  if (!tokens.length) return { hits: [] };
  const qs = tokens.map((t) => (t.length >= 4 ? `${t}*` : t)).join("|");
  const hits = await tryRows(
    g,
    "fulltext capability search",
    `
    CALL db.idx.fulltext.queryNodes('Capability', $q) YIELD node, score
    OPTIONAL MATCH (leaf:Capability)-[:SPECIALIZES*1..3]->(node)
    WITH CASE WHEN leaf IS NULL THEN node ELSE leaf END AS cap, score
    WHERE cap.parent_id <> ""
    RETURN cap.id AS id, cap.name AS name, max(score) AS score
    ORDER BY score DESC LIMIT 8`,
    { q: qs },
  );
  if (!hits)
    return {
      error:
        "full-text index unavailable (run the knowledge build / ensureJourneySchema)",
    };
  const ids = hits.map((h) => str(h.id));
  const mine = ids.length
    ? await tryRows(
        g,
        "search levels",
        `MATCH (:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c:Capability) WHERE c.id IN $ids RETURN c.id AS id, hc.level AS level, hc.evidence_count AS evidence`,
        { dev, ids },
      )
    : [];
  const byId = new Map((mine ?? []).map((r) => [str(r.id), r]));
  return {
    hits: hits.map((h) => ({
      capabilityId: str(h.id),
      name: str(h.name),
      score: round(num(h.score)),
      developerLevel: asLevel(byId.get(str(h.id))?.level),
      detections: num(byId.get(str(h.id))?.evidence),
    })),
  };
}

async function skillPath(
  g: Graph,
  dev: string,
  a: string,
  b: string,
): Promise<Obj> {
  const A = a.trim();
  const B = b.trim();
  if (!A || !B) return { error: "from and to capability ids are required" };
  const variants = [
    `MATCH (a:Capability {id: $a}), (b:Capability {id: $b}) MATCH p = shortestPath((a)-[:RELATED_TO*1..5]-(b)) RETURN [n IN nodes(p) | n.id] AS ids, [n IN nodes(p) | n.name] AS names, length(p) AS hops`,
    `MATCH (a:Capability {id: $a}), (b:Capability {id: $b}) MATCH p = shortestPath((a)-[:RELATED_TO*1..5]->(b)) RETURN [n IN nodes(p) | n.id] AS ids, [n IN nodes(p) | n.name] AS names, length(p) AS hops`,
    `MATCH (a:Capability {id: $a}), (b:Capability {id: $b}) MATCH p = shortestPath((b)-[:RELATED_TO*1..5]->(a)) RETURN [n IN nodes(p) | n.id] AS ids, [n IN nodes(p) | n.name] AS names, length(p) AS hops`,
  ];
  let row: Obj | undefined;
  for (const [i, q] of variants.entries()) {
    const r = await tryRows(g, `skill path v${i}`, q, { a: A, b: B });
    if (r && r.length) {
      row = r[0];
      break;
    }
  }
  if (!row) return { from: A, to: B, connected: false };
  const ids = strList(row.ids);
  const lv = await tryRows(
    g,
    "path levels",
    `MATCH (:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c:Capability) WHERE c.id IN $ids RETURN c.id AS id, hc.level AS level`,
    { dev, ids },
  );
  const levels = new Map((lv ?? []).map((r) => [str(r.id), asLevel(r.level)]));
  return {
    from: A,
    to: B,
    connected: true,
    hops: num(row.hops),
    route: ids.map((id, i) => ({
      id,
      name: strList(row.names)[i],
      developerLevel: levels.get(id) ?? "missing",
    })),
  };
}





const tool = (
  name: string,
  description: string,
  properties: Obj,
  run: (ctx: Ctx, args: Obj) => Promise<unknown>,
  required: string[] = [],
): Tool =>
  ({
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    run,
  }) as unknown as Tool;

const G = (ctx: Ctx) => ({ g: graphOf(ctx), dev: ctx.developerId });

const compactCapability = (c: Obj) => ({
  capabilityId: c.capabilityId,
  name: c.name,
  domain: c.domain,
  level: c.level,
  detections: c.detections,
  commits: c.commits,
  repositories: c.repositories,
  activeDays: c.activeDays,
  firstSeen: c.firstSeen,
  lastSeen: c.lastSeen,
  techniques: (c.techniques as Obj[]).slice(0, 3).map((t) => ({
    technique: t.technique,
    built: t.built,
    hardeningSeen: (t.hardeningSeen as Obj[]).slice(0, 4),
    requiredSafeguards: `${t.requiredObserved}/${t.requiredTotal} observed`,
    notDetected: (t.safeguards as Obj[])
      .filter((s) => s.required && !s.observed)
      .map((s) => s.name),
  })),
  bestChain: c.chains?.[0]
    ? {
        path: c.chains[0].path,
        repository: c.chains[0].repository,
        file: c.chains[0].fileChange.path,
        permalink: c.chains[0].demonstration.permalink,
      }
    : null,
});

const TOOLS_BY_NAME = {
  get_funnel: tool(
    "get_funnel",
    "Hop-by-hop counts from the Developer node: Commit, FileChange, Demonstration, Experience, Capability, Domain, and what share of file changes produced evidence. Start here for 'how did you get this'.",
    {},
    async (ctx) => {
      const { g, dev } = G(ctx);
      return readFunnel(g, dev);
    },
  ),
  get_footprint: tool(
    "get_footprint",
    "Edge census: every edge type leaving the developer's subgraph, hop by hop, with counts.",
    {},
    async (ctx) => {
      const { g, dev } = G(ctx);
      return readFootprint(g, dev);
    },
  ),
  list_capabilities: tool(
    "list_capabilities",
    "Capabilities with evidence, strongest first: level, counts, techniques, safeguards seen vs expected, and one proof chain each.",
    {
      min_level: {
        type: "string",
        enum: [
          "insufficient_evidence",
          "usage",
          "repeated_usage",
          "implementation",
          "strong",
        ],
      },
      domain_id: { type: "string" },
    },
    async (ctx, a) => {
      const { g, dev } = G(ctx);
      const r = await readCapabilities(g, dev);
      if (r.error) return r;
      const min = a.min_level ? LEVEL_RANK[asLevel(a.min_level)] : -1;
      const list = (r.capabilities as Obj[]).filter(
        (c) =>
          LEVEL_RANK[c.level as Level] >= min &&
          (!a.domain_id || c.domainId === a.domain_id),
      );
      return { count: list.length, capabilities: list.map(compactCapability) };
    },
  ),
  trace_capability: tool(
    "trace_capability",
    "Walk from one capability (or a domain id) down to its proof chains: Commit, FileChange, Demonstration, repository, PR, permalink, snippet, hardening, plus how the level was derived.",
    {
      capability_id: { type: "string", description: "e.g. retry_backoff" },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
    async (ctx, a) => {
      const { g, dev } = G(ctx);
      return traceCapability(g, dev, str(a.capability_id), num(a.limit, 6));
    },
    ["capability_id"],
  ),
  trace_repository: tool(
    "trace_repository",
    "The graph read from one project: file changes, commits, detections per capability and technique.",
    { repository: { type: "string" } },
    async (ctx, a) => {
      const { g, dev } = G(ctx);
      return traceRepository(g, dev, str(a.repository));
    },
    ["repository"],
  ),
  trace_commit: tool(
    "trace_commit",
    "One commit (sha prefix): its file changes, the detections found in them and the capabilities they point to.",
    { sha: { type: "string", description: "6 to 40 hex chars" } },
    async (ctx, a) => {
      const { g, dev } = G(ctx);
      return traceCommit(g, dev, str(a.sha));
    },
    ["sha"],
  ),
  trace_file: tool(
    "trace_file",
    "One file (path fragment): how often it changed, and which capabilities were detected in it.",
    { path: { type: "string" } },
    async (ctx, a) => {
      const { g, dev } = G(ctx);
      return traceFile(g, dev, str(a.path));
    },
    ["path"],
  ),
  search_capabilities: tool(
    "search_capabilities",
    "Full-text search over capability names, descriptions and keywords for a loose topic; each hit includes the developer's own level.",
    { text: { type: "string" } },
    async (ctx, a) => {
      const { g, dev } = G(ctx);
      return searchCapabilities(g, dev, str(a.text));
    },
    ["text"],
  ),
  skill_path: tool(
    "skill_path",
    "Shortest RELATED_TO path between two capabilities, with the developer's level at each step.",
    { from: { type: "string" }, to: { type: "string" } },
    async (ctx, a) => {
      const { g, dev } = G(ctx);
      return skillPath(g, dev, str(a.from), str(a.to));
    },
    ["from", "to"],
  ),
  get_experience_web: tool(
    "get_experience_web",
    "Experience nodes with their SUPPORTED_BY count, techniques, technologies, system layers and repositories.",
    {},
    async (ctx) => {
      const { g, dev } = G(ctx);
      return readExperiences(g, dev);
    },
  ),
  get_skill_links: tool(
    "get_skill_links",
    "RELATED_TO / PREREQUISITE_OF edges touching detected capabilities, and clusters of detected capabilities that are linked.",
    {},
    async (ctx) => {
      const { g, dev } = G(ctx);
      return readSkillLinks(g, dev);
    },
  ),
  get_skill_map: tool(
    "get_skill_map",
    "Technology skills (TypeScript, Redis ...) attributed to repositories via DEMONSTRATED_IN, and skills used inside detections. Skill levels come from a separate pipeline.",
    { repository: { type: "string" } },
    async (ctx, a) => {
      const { g, dev } = G(ctx);
      return readSkillMap(g, dev, str(a.repository));
    },
  ),
  get_repositories: tool(
    "get_repositories",
    "Per-repository file changes, commits, detections and readability.",
    {},
    async (ctx) => {
      const { g, dev } = G(ctx);
      return readRepositories(g, dev);
    },
  ),
  get_code_profile: tool(
    "get_code_profile",
    "How the developer writes code (languages, signals, symbols, imports, hygiene) and commits (types, hours, weekdays). Signals are from a sample of recent file changes.",
    {},
    async (ctx) => {
      const { g, dev } = G(ctx);
      return readCodeProfile(g, dev);
    },
  ),
  get_collaboration: tool(
    "get_collaboration",
    "Pull requests (with repository and linked commits), review states, reviewers, feedback.",
    {},
    async (ctx) => {
      const { g, dev } = G(ctx);
      return readCollaboration(g, dev);
    },
  ),
  get_evolution: tool(
    "get_evolution",
    "Growth path per capability from detection timestamps: month each depth was first reached, plateaus, dormant skills.",
    { capability_id: { type: "string" } },
    async (ctx, a) => {
      const { g, dev } = G(ctx);
      return readEvolution(g, dev, str(a.capability_id));
    },
  ),
  get_hotspots: tool(
    "get_hotspots",
    "Most-revisited source files and files that change in the same commit.",
    {},
    async (ctx) => {
      const { g, dev } = G(ctx);
      return readHotspots(g, dev);
    },
  ),
};

const JOURNEY_TOOLS: Tool[] = Object.values(TOOLS_BY_NAME);
export const JOURNEY_TOOL_NAMES: string[] = JOURNEY_TOOLS.map((t) => t.name);





const TOOL_META: Record<
  string,
  { title: string; question: string; pattern: string; how: string }
> = {
  get_funnel: {
    title: "Funnel",
    question: "How does raw history narrow down to skills?",
    pattern:
      "(Developer)-[MADE]->(Commit); -[AUTHORED_CODE]->(FileChange); -[DEMONSTRATED]->(Demonstration)-[EVIDENCED_BY]->(FileChange); -[EXPERIENCED]->(Experience); -[HAS_CAPABILITY]->(Capability)-[SPECIALIZES]->(Domain)",
    how: "Started at the Developer node and counted what each stored edge reaches, one hop at a time. No row is read twice for a different purpose, and nothing is estimated.",
  },
  get_footprint: {
    title: "Edge census",
    question: "How big is this developer's part of the graph?",
    pattern:
      "(Developer)-[r]->(); (Developer)-[:MADE]->(Commit)-[r]->(); ... one query per hub label",
    how: "Grouped every outgoing edge by type and target label from the Developer node and from each hub node (Commit, FileChange, Demonstration, Experience). The sums are real stored edges.",
  },
  get_capabilities: {
    title: "Capabilities, safeguards and proof chains",
    question:
      "Which skills were detected, how was each level derived, and which code is behind it?",
    pattern:
      "(Developer)-[HAS_CAPABILITY]->(Capability)-[SPECIALIZES]->(Domain); (Capability)-[HAS_TECHNIQUE_SPEC]->(TechniqueSpec)-[HAS_SAFEGUARD]->(Safeguard); (Developer)-[DEMONSTRATED]->(Demonstration)-[OF_CAPABILITY|EVIDENCED_BY|IN_REPOSITORY]->(...)<-[CHANGED]-(Commit)-[IN_PR]->(PullRequest)",
    how: "Read the roll-up stored on each HAS_CAPABILITY edge, grouped Demonstration nodes by detector rule, compared their hardening labels with the Safeguard nodes the taxonomy expects, and walked the strongest Demonstrations back to their FileChange, Commit, Repository and PullRequest.",
  },
  get_experience_web: {
    title: "Experience web",
    question: "How are detections grouped into engineering experiences?",
    pattern:
      "(Developer)-[EXPERIENCED]->(Experience)-[DEMONSTRATES_CAPABILITY|SOLVES|USES_TECHNIQUE|USES_TECHNOLOGY|IN_CONTEXT|OCCURS_IN|SUPPORTED_BY]->(...)",
    how: "Started at each Experience node and followed its stored edges to capability, technique, technology, system layer, repository and the Demonstration nodes it was grouped from.",
  },
  get_skill_links: {
    title: "Skill links",
    question:
      "Which detected skills are connected to each other in the taxonomy?",
    pattern:
      "(Developer)-[HAS_CAPABILITY]->(Capability)-[RELATED_TO|PREREQUISITE_OF]-(Capability)",
    how: "Followed taxonomy edges out of and into the capabilities the developer has, then computed connected components over edges where both ends were detected.",
  },
  get_skill_map: {
    title: "Technology attribution",
    question: "Which technologies were used in which repositories?",
    pattern:
      "(Developer)-[HAS_SKILL]->(Skill)-[DEMONSTRATED_IN]->(Repository); (Demonstration)-[USES]->(Skill)",
    how: "Followed HAS_SKILL to Skill nodes and DEMONSTRATED_IN (filtered to this developer's id) to repositories, and separately USES edges from Demonstrations.",
  },
  get_repositories: {
    title: "Repositories",
    question:
      "Where did the work and the detections happen, and was it readable?",
    pattern:
      "(Developer)-[AUTHORED_CODE]->(FileChange) grouped by repository; (Demonstration)-[IN_REPOSITORY]->(Repository)",
    how: "Grouped the developer's FileChange nodes by repository, counted stored patches, and joined the repositories that have Demonstration nodes.",
  },
  get_code_profile: {
    title: "Code and commit profile",
    question: "How does this developer write and ship code?",
    pattern:
      "(Developer)-[AUTHORED_CODE]->(FileChange {language, code_signals_json, symbols_*, imports_*}); (Developer)-[MADE]->(Commit {commit_type, utc_hour})",
    how: "Read the small structured columns stored on FileChange and Commit nodes (never the patch text). Totals use every node; signal, symbol and import figures use a sample of the most recent file changes.",
  },
  get_collaboration: {
    title: "Collaboration",
    question: "Which commits became pull requests, and what did reviewers say?",
    pattern:
      "(Developer)-[AUTHORED]->(PullRequest)<-[IN_PR]-(Commit)-[IN_REPOSITORY]->(Repository)",
    how: "Followed AUTHORED to pull requests, IN_PR back to their commits and IN_REPOSITORY to the project, and read stored review states.",
  },
  get_evolution: {
    title: "Growth path",
    question: "When did each skill appear and how deep did it get?",
    pattern:
      "(Developer)-[DEMONSTRATED]->(Demonstration {created_at})-[OF_CAPABILITY]->(Capability) grouped by month",
    how: "Grouped Demonstration nodes by month and capability inside the query, then found the first month each depth was reached.",
  },
  get_hotspots: {
    title: "Hotspots and co-change",
    question:
      "Where does the work keep returning, and which files move together?",
    pattern:
      "(Developer)-[AUTHORED_CODE]->(FileChange)<-[CHANGED]-(Commit)-[CHANGED]->(FileChange)",
    how: "A two-hop traversal from a file change to its commit and out to the other files in that commit, counted per pair.",
  },
};





function howWeKnow(c: Obj): string {
  const techs = (c.techniques as Obj[]) ?? [];
  const rules = techs.map((t) => t.technique).join("; ") || "none recorded";
  const seen = techs.flatMap((t) =>
    (t.hardeningSeen as Obj[]).map((h) => h.label),
  );
  const reqTotal = techs.reduce((n, t) => n + t.requiredTotal, 0);
  const reqSeen = techs.reduce((n, t) => n + t.requiredObserved, 0);
  return (
    `${plural(c.detections, "Demonstration node")} point at this Capability through OF_CAPABILITY, across ${plural(c.commits, "commit")}, ${plural(c.repositories, "repository", "repositories")} and ${plural(c.activeDays, "active day")}. ` +
    `Detector rule(s): ${rules}. Hardening labels seen on those nodes: ${seen.length ? [...new Set(seen)].join(", ") : "none"}. ` +
    `Against the TechniqueSpec, ${reqSeen} of ${reqTotal} required Safeguard nodes were observed. ` +
    `These facts are stored on the HAS_CAPABILITY edge as level "${c.level}" (${JOURNEY_MODEL.levels[c.level] ?? "no rule text"}).`
  );
}

function deriveStrengths(caps: Obj[]): Obj[] {
  const out: Obj[] = [];
  for (const c of caps) {
    let tier: "core" | "solid" | "emerging" | null =
      c.level === "strong"
        ? "core"
        : c.level === "implementation"
          ? "solid"
          : c.level === "repeated_usage"
            ? "emerging"
            : null;
    if (!tier) continue;
    const tentative = c.detections < MIN_DETECTIONS || c.commits < MIN_COMMITS;
    
    if (tentative && tier !== "emerging") tier = "emerging";
    out.push({
      capabilityId: c.capabilityId,
      name: c.name,
      domain: c.domain,
      tier,
      level: c.level,
      tentative,
      detections: c.detections,
      commits: c.commits,
      repositories: c.repositories,
      activeDays: c.activeDays,
      reason: `${plural(c.detections, "detection")} across ${plural(c.commits, "commit")} in ${plural(c.repositories, "repository", "repositories")}; level "${c.level}" stored on HAS_CAPABILITY${tentative ? "; thin evidence, tentative" : ""}.`,
    });
  }
  const rank: Record<string, number> = { core: 3, solid: 2, emerging: 1 };
  return out.sort(
    (a, b) =>
      rank[b.tier] - rank[a.tier] ||
      Number(a.tentative) - Number(b.tentative) ||
      b.detections - a.detections,
  );
}

function buildFlow(x: {
  funnel: Obj;
  footprint: Obj | null;
  caps: Obj[];
  links: Obj | null;
  skills: Obj | null;
  collab: Obj | null;
  repos: Obj | null;
  experiences: Obj[];
}): Obj[] {
  const st = (label: string) =>
    (x.funnel.stages as Obj[]).find((s) => s.label === label)!;
  const commit = st("Commit");
  const fc = st("FileChange");
  const demo = st("Demonstration");
  const exp = st("Experience");
  const cap = st("Capability");
  const dom = st("Domain");

  const levelCounts = new Map<string, number>();
  for (const c of x.caps)
    levelCounts.set(c.level, (levelCounts.get(c.level) ?? 0) + 1);
  const levelText = [...levelCounts.entries()]
    .sort((a, b) => LEVEL_RANK[b[0] as Level] - LEVEL_RANK[a[0] as Level])
    .map(([l, n]) => `${n} ${l}`)
    .join(", ");

  const techs = x.caps
    .flatMap((c) => c.techniques as Obj[])
    .filter((t) => t.built > 0);
  const reqTotal = techs.reduce((n, t) => n + t.requiredTotal, 0);
  const reqSeen = techs.reduce((n, t) => n + t.requiredObserved, 0);

  const steps: Obj[] = [
    {
      step: 1,
      name: "Sync: history becomes nodes",
      traversal: "get_funnel",
      nodes: [`Commit x${commit.count}`, `FileChange x${fc.count}`],
      edges: ["MADE", "AUTHORED_CODE", "CHANGED", "IN_REPOSITORY"],
      explain: `Your Developer node reaches ${plural(commit.count, "Commit node")} through MADE and ${plural(fc.count, "FileChange node")} through AUTHORED_CODE, spread over ${plural(fc.detail.repositories, "repository", "repositories")}. ${commit.detail.fullPatch} commits were read as full patches${commit.detail.metadataOnly ? `, ${commit.detail.metadataOnly} stored as metadata only` : ""}${commit.detail.other ? `, ${commit.detail.other} neither (for example merge commits or commits without file changes)` : ""}.`,
    },
    {
      step: 2,
      name: "Detection: diffs become evidence",
      traversal: "get_funnel",
      nodes: [`Demonstration x${demo.count}`],
      edges: [
        "DEMONSTRATED",
        "EVIDENCED_BY",
        "OF_CAPABILITY",
        "IN_REPOSITORY",
        "IN_CONTEXT",
      ],
      explain: `Rule-based detectors matched ${plural(demo.count, "Demonstration node")} in ${plural(demo.detail.fileChangesThatProducedEvidence, "file change")} (${demo.detail.shareOfFileChanges}% of ${fc.count}), using ${plural(demo.detail.detectorRules, "detector rule")} over ${plural(demo.detail.distinctFiles, "distinct file")}. Each one is wired to the FileChange it came from, its repository, its system layer and its capability.`,
    },
    {
      step: 3,
      name: "Grouping: evidence becomes experience",
      traversal: "get_experience_web",
      nodes: [`Experience x${exp.count}`],
      edges: [
        "EXPERIENCED",
        "SUPPORTED_BY",
        "DEMONSTRATES_CAPABILITY",
        "OCCURS_IN",
        "USES_TECHNIQUE",
        "USES_TECHNOLOGY",
        "SOLVES",
      ],
      explain: `Detections with the same capability and technique were grouped into ${plural(exp.count, "Experience node")} holding ${exp.detail.evidenceGrouped} detections in total. Each Experience points back to its Demonstration nodes through SUPPORTED_BY.`,
    },
    {
      step: 4,
      name: "Roll-up: experience becomes a level on an edge",
      traversal: "get_capabilities",
      nodes: [`Capability x${cap.count}`, `Domain x${dom.count}`],
      edges: ["HAS_CAPABILITY", "SPECIALIZES"],
      explain: `${plural(cap.count, "HAS_CAPABILITY edge")} carry the roll-up (level, detections, commits, repositories, active days, first/last seen): ${levelText || "none"}. Reading a level is reading an edge property; the proof chains below show the nodes it was computed from.`,
    },
    {
      step: 5,
      name: "Taxonomy check: expected vs observed hardening",
      traversal: "get_capabilities",
      nodes: ["TechniqueSpec", "Safeguard"],
      edges: ["HAS_TECHNIQUE_SPEC", "HAS_SAFEGUARD"],
      explain: `For the ${plural(techs.length, "technique")} you built, the shared taxonomy lists required Safeguard nodes. ${reqSeen} of ${reqTotal} required safeguards had a matching hardening label on your Demonstration nodes. A safeguard not detected means it was not seen in the code read.`,
    },
  ];

  if (x.links && !x.links.error) {
    const both = (x.links.links as Obj[]).filter((l) => l.bothDetected).length;
    steps.push({
      step: steps.length + 1,
      name: "Skill links: how detected skills connect",
      traversal: "get_skill_links",
      nodes: ["Capability"],
      edges: ["RELATED_TO", "PREREQUISITE_OF"],
      explain: `${plural(both, "taxonomy edge")} connect two capabilities you have evidence for; ${plural((x.links.clusters as string[][]).length, "cluster")} of linked detected skills result${(x.links.clusters as string[][]).length ? `: ${(x.links.clusters as string[][]).map((c) => c.join(" + ")).join(" | ")}` : ""}.`,
    });
  }
  if (x.skills && !x.skills.error) {
    steps.push({
      step: steps.length + 1,
      name: "Technology attribution",
      traversal: "get_skill_map",
      nodes: [`Skill x${x.funnel.side.technologySkills}`],
      edges: ["HAS_SKILL", "DEMONSTRATED_IN", "USES"],
      explain: `${plural(x.funnel.side.technologySkills, "Skill node")} hang off your Developer node; DEMONSTRATED_IN attributes each to the repositories where it was used.`,
    });
  }
  if (x.collab && !x.collab.error) {
    steps.push({
      step: steps.length + 1,
      name: "Collaboration",
      traversal: "get_collaboration",
      nodes: [`PullRequest x${x.collab.totals.authored}`],
      edges: ["AUTHORED", "IN_PR"],
      explain: `${plural(x.collab.totals.authored, "pull request")} authored, ${x.collab.totals.merged} merged, ${x.collab.totals.linkedToCommits} linked to commits in the graph through IN_PR.`,
    });
  }
  return steps;
}

function buildGraph(
  dev: string,
  funnel: Obj,
  caps: Obj[],
  exps: Obj[],
  links: Obj | null,
): Obj {
  const nodes = new Map<string, Obj>();
  const edges = new Map<string, Obj>();
  const node = (label: string, id: string, name: string, props: Obj = {}) => {
    const key = `${label}:${id}`;
    if (!nodes.has(key))
      nodes.set(key, { id: key, label, name: cut(name, 80), props });
    return key;
  };
  const edge = (from: string, to: string, type: string, props: Obj = {}) => {
    const key = `${from}|${type}|${to}`;
    if (!edges.has(key)) edges.set(key, { from, to, type, props });
  };

  const me = node("Developer", dev, funnel.developer?.username || dev);
  for (const c of caps) {
    const cap = node("Capability", c.capabilityId, c.name, {
      level: c.level,
      detections: c.detections,
    });
    edge(me, cap, "HAS_CAPABILITY", {
      level: c.level,
      evidence_count: c.detections,
      commit_count: c.commits,
      repo_count: c.repositories,
    });
    if (c.domainId)
      edge(cap, node("Domain", c.domainId, c.domain), "SPECIALIZES");
    for (const ch of (c.chains as Obj[]).slice(0, 2)) {
      const demo = node(
        "Demonstration",
        ch.demonstration.id,
        ch.demonstration.technique,
        {
          depth: ch.demonstration.depth,
          permalink: ch.demonstration.permalink,
          lines: ch.demonstration.lines,
        },
      );
      const fc = node(
        "FileChange",
        ch.fileChange.id || ch.fileChange.path,
        ch.fileChange.path,
      );
      edge(me, demo, "DEMONSTRATED");
      edge(demo, cap, "OF_CAPABILITY");
      edge(demo, fc, "EVIDENCED_BY");
      edge(me, fc, "AUTHORED_CODE");
      if (ch.commit) {
        const cm = node(
          "Commit",
          ch.commit.id,
          ch.commit.subject || ch.commit.id.slice(0, 8),
          { type: ch.commit.type, day: ch.commit.day },
        );
        edge(me, cm, "MADE");
        edge(cm, fc, "CHANGED");
        if (ch.pullRequest) {
          const pr = node(
            "PullRequest",
            `${ch.repository}#${ch.pullRequest.number}`,
            `#${ch.pullRequest.number} ${ch.pullRequest.title}`,
            { merged: ch.pullRequest.merged },
          );
          edge(cm, pr, "IN_PR");
        }
      }
      if (ch.repository)
        edge(
          demo,
          node("Repository", ch.repository, ch.repository),
          "IN_REPOSITORY",
        );
    }
  }
  for (const e of exps) {
    const ex = node("Experience", e.id, e.technique, {
      depth: e.depth,
      detections: e.detections,
    });
    edge(me, ex, "EXPERIENCED");
    if (e.capabilityId)
      edge(
        ex,
        node("Capability", e.capabilityId, e.capabilityId),
        "DEMONSTRATES_CAPABILITY",
      );
    for (const r of (e.repositories as string[]).slice(0, 4))
      edge(ex, node("Repository", r, r), "OCCURS_IN");
    for (const t of (e.technologies as string[]).slice(0, 4))
      edge(ex, node("Technology", t, t), "USES_TECHNOLOGY");
    for (const l of (e.layers as string[]).slice(0, 4))
      edge(ex, node("EngineeringContext", l, l), "IN_CONTEXT");
  }
  for (const l of (links?.links as Obj[] | undefined) ?? []) {
    if (l.bothDetected)
      edge(
        node("Capability", l.from.id, l.from.name),
        node("Capability", l.to.id, l.to.name),
        l.rel,
      );
  }

  const total = (funnel.stages as Obj[]).reduce((n, s) => n + s.count, 0);
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    note: `Sample for display: ${nodes.size} nodes and ${edges.size} edges (top proof chains per capability, all experiences). Your stored subgraph holds ${total} nodes on the funnel path alone; see footprint for edge counts.`,
  };
}

function buildFindings(x: {
  caps: Obj[];
  strengths: Obj[];
  funnel: Obj;
  evolution: Obj | null;
  hotspots: Obj | null;
  links: Obj | null;
  repos: Obj | null;
}): Obj[] {
  const out: Obj[] = [];
  for (const s of x.strengths
    .filter((s) => s.tier !== "emerging" || !s.tentative)
    .slice(0, 8)) {
    const cap = x.caps.find((c) => c.capabilityId === s.capabilityId);
    out.push({
      kind: "strength",
      title: `${s.name}: ${s.tier}${s.tentative ? " (tentative)" : ""}`,
      detail: s.reason,
      graphPath: cap?.chains?.[0]?.path ?? [],
      evidence: cap?.chains?.[0]?.demonstration?.permalink
        ? [cap.chains[0].demonstration.permalink]
        : [],
    });
  }
  for (const c of x.caps) {
    for (const t of c.techniques as Obj[]) {
      const missing = (t.safeguards as Obj[])
        .filter((s) => s.required && !s.observed)
        .map((s) => s.name);
      if (t.built > 0 && missing.length) {
        out.push({
          kind: "safeguards_not_detected",
          title: `${t.technique}: ${t.requiredObserved}/${t.requiredTotal} required safeguards observed`,
          detail: `Not detected in the code read: ${missing.join(", ")}.`,
          graphPath: [
            `(Capability ${c.capabilityId}) -[HAS_TECHNIQUE_SPEC]-> (TechniqueSpec ${t.ruleId}) -[HAS_SAFEGUARD]-> (Safeguard)`,
          ],
          evidence: [],
        });
      }
    }
  }
  const demo = (x.funnel.stages as Obj[]).find(
    (s) => s.label === "Demonstration",
  );
  if (demo) {
    out.push({
      kind: "conversion",
      title: `${demo.detail.shareOfFileChanges}% of file changes produced a detection`,
      detail: `${demo.detail.fileChangesThatProducedEvidence} of your file changes are the source of ${demo.count} Demonstration nodes. The rest matched no detector, which means not seen, not absent.`,
      graphPath: [
        "(Demonstration) -[EVIDENCED_BY]-> (FileChange) <-[AUTHORED_CODE]- (Developer)",
      ],
      evidence: [],
    });
  }
  if (x.links && !x.links.error) {
    for (const cl of (x.links.clusters as string[][]).slice(0, 3)) {
      out.push({
        kind: "skill_cluster",
        title: `Linked skills: ${cl.join(" + ")}`,
        detail:
          "Connected through RELATED_TO or PREREQUISITE_OF edges and all detected in your code.",
        graphPath: ["(Capability) -[RELATED_TO|PREREQUISITE_OF]- (Capability)"],
        evidence: [],
      });
    }
  }
  for (const c of ((x.evolution?.capabilities as Obj[]) ?? [])
    .filter((c) => c.state === "dormant")
    .slice(0, 3)) {
    out.push({
      kind: "dormant",
      title: `${c.name}: last detected ${c.lastSeen.slice(0, 10)}`,
      detail: `${c.daysSinceLastDetection} days without a newer detection; reached "${c.level}".`,
      graphPath: [
        `(Developer) -[DEMONSTRATED]-> (Demonstration {created_at}) -[OF_CAPABILITY]-> (Capability ${c.capabilityId})`,
      ],
      evidence: [],
    });
  }
  for (const h of ((x.hotspots?.coChanges as Obj[]) ?? [])
    .filter((p) => p.commitsTogether >= 5)
    .slice(0, 2)) {
    out.push({
      kind: "co_change",
      title: "Two files that change together",
      detail: `${h.fileA} and ${h.fileB} changed in the same commit ${h.commitsTogether} times (${h.repository}).`,
      graphPath: [
        "(FileChange) <-[CHANGED]- (Commit) -[CHANGED]-> (FileChange)",
      ],
      evidence: [h.fileA, h.fileB],
    });
  }
  if (x.repos && !x.repos.error) {
    const c = x.repos.coverage;
    out.push({
      kind: "repository_spread",
      title: `${c.withDetections} of ${c.repositories} repositories have detections`,
      detail: `${c.withoutDetections} repositories have file changes but no Demonstration nodes (not seen, not absent).`,
      graphPath: [
        "(Developer) -[AUTHORED_CODE]-> (FileChange) vs (Demonstration) -[IN_REPOSITORY]-> (Repository)",
      ],
      evidence: [],
    });
  }
  return out;
}

function buildNarrative(funnel: Obj, strengths: Obj[], caps: Obj[]): string {
  const st = (l: string) =>
    (funnel.stages as Obj[]).find((s) => s.label === l)!;
  const fc = st("FileChange");
  const demo = st("Demonstration");
  const parts = [
    `From your Developer node, FalkorDB reaches ${plural(st("Commit").count, "commit")} and ${plural(fc.count, "file change")}. Detectors turned ${demo.detail.fileChangesThatProducedEvidence} of those file changes into ${plural(demo.count, "Demonstration node")}, grouped into ${plural(st("Experience").count, "Experience node")} and rolled up onto ${plural(st("Capability").count, "HAS_CAPABILITY edge")} in ${plural(st("Domain").count, "domain")}.`,
  ];
  const core = strengths.filter((s) => s.tier === "core");
  if (core.length)
    parts.push(
      `Level "strong" (hardened mechanism in 2+ commits) is stored for ${core.map((s) => `${s.name} (${s.detections} detections, ${s.repositories} repositories)`).join(" and ")}.`,
    );
  const solid = strengths.filter((s) => s.tier === "solid");
  if (solid.length)
    parts.push(
      `Level "implementation" is stored for ${solid.map((s) => s.name).join(", ")}.`,
    );
  const thin = strengths.filter((s) => s.tentative);
  if (thin.length)
    parts.push(
      `${thin.map((s) => s.name).join(", ")} rest on thin evidence and are tentative.`,
    );
  const weak = caps.filter((c) => c.state === "unverified");
  if (weak.length)
    parts.push(
      `${weak.map((c) => c.name).join(", ")} appear once, not enough to judge.`,
    );
  parts.push(
    "Every number above is a count of stored nodes and edges; every level can be opened as a path down to a commit, a file, a line range and a permalink. Levels come from rule-based detectors, so they describe patterns found in code, not a verified assessment.",
  );
  return parts.join(" ");
}

const LIMITATIONS = [
  "Capabilities are inferred by deterministic pattern detectors over the added lines of diffs. A pattern can match without the code being good, and good work written in an unrecognised way is not seen.",
  "Levels and tiers are Pathway's own thresholds, not an industry standard.",
  "Missing evidence means 'not seen', never 'cannot do it'. Skills built outside GitHub, in unsynced repositories, or outside the sync window are not represented.",
  "Technology skill levels (HAS_SKILL) come from a separate pipeline and are not comparable with capability levels.",
  "Code signal, symbol and import figures are computed over a sample of the most recent file changes; counts and totals use every node.",
];





export interface AgentTrace {
  tool: string;
  title: string;
  question: string;
  pattern: string;
  how: string;
  ms: number;
  queries: number;
  dbMs: number;
  error?: string;
  
  cypher?: Array<{
    id: string;
    query: string;
    ms: number;
    internalMs?: number;
    cached?: boolean;
    rows: number;
    error?: string;
  }>;
  
  plans?: QueryTrace[];
}

export interface JourneyDossier {
  developerId: string;
  developer: Obj;
  funnel: Obj;
  flow: Obj[];
  footprint: Obj | null;
  strengths: Obj[];
  capabilities: Obj[];
  experiences: Obj[];
  skillLinks: Obj | null;
  skillMap: Obj | null;
  repositories: Obj | null;
  codeProfile: Obj | null;
  collaboration: Obj | null;
  evolution: Obj | null;
  hotspots: Obj | null;
  findings: Obj[];
  graph: Obj;
  narrative: string;
  narrativeSource: "generated" | "llm";
  limitations: string[];
  traversals: AgentTrace[];
  generatedAt: string;
}

export type NarrateFn = (system: string, user: string) => Promise<string>;

export interface JourneyAgentOptions {
  narrate?: NarrateFn;
  plan?: PlanMode;
  fresh?: boolean;
}

function unwrap<T = Obj>(e: ToolTraceEntry): T | null {
  const r = e.result as any;
  if (r && typeof r === "object" && !Array.isArray(r) && "error" in r)
    return null;
  return (r ?? null) as T | null;
}

async function traceFor(
  ctx: Ctx,
  entry: ToolTraceEntry,
  plan?: PlanMode,
): Promise<AgentTrace> {
  const r = entry.result as any;
  const error =
    r &&
    typeof r === "object" &&
    !Array.isArray(r) &&
    typeof r.error === "string"
      ? r.error
      : undefined;
  const key =
    entry.tool === "list_capabilities" ? "get_capabilities" : entry.tool;
  const meta = TOOL_META[key] ?? {
    title: entry.tool,
    question: "Focused traversal",
    pattern: "(Developer)-[...]->(...)",
    how: "Ran a traversal over the developer's own subgraph and returned what the stored nodes and edges contain.",
  };
  const base: AgentTrace = {
    tool: entry.tool,
    ...meta,
    ms: entry.ms,
    queries: entry.db.queries,
    dbMs: entry.db.ms,
    cypher: entry.db.traces.map((q) => ({
      id: q.id,
      query: oneLine(q.query),
      ms: q.ms,
      internalMs: q.internalMs,
      cached: q.cached,
      rows: q.rows,
      ...(q.error ? { error: q.error } : {}),
    })),
    ...(error ? { error } : {}),
  };
  if (plan && plan !== "off")
    return { ...base, plans: await collectPlans(ctx, entry, plan) };
  return base;
}

const DOSSIER_PLAN: Array<[string, Obj]> = [
  ["get_funnel", {}],
  ["get_footprint", {}],
  ["get_capabilities_full", {}],
  ["get_experience_web", {}],
  ["get_skill_links", {}],
  ["get_skill_map", {}],
  ["get_repositories", {}],
  ["get_code_profile", {}],
  ["get_collaboration", {}],
  ["get_evolution", {}],
  ["get_hotspots", {}],
];


const CAPABILITIES_FULL = tool(
  "get_capabilities_full",
  "Full capability read with proof chains (dossier only).",
  {},
  async (ctx) => {
    const { g, dev } = G(ctx);
    return readCapabilities(g, dev);
  },
);
const DOSSIER_TOOLS: Tool[] = [...JOURNEY_TOOLS, CAPABILITIES_FULL];

const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 200;
const cache = new Map<
  string,
  { at: number; value: Promise<JourneyDossier | null> }
>();

async function build(
  ctx: Ctx,
  opts: JourneyAgentOptions,
): Promise<JourneyDossier | null> {
  const entries = await Promise.all(
    DOSSIER_PLAN.map(([name, args]) => runTool(ctx, name, args, DOSSIER_TOOLS)),
  );
  const by = new Map(entries.map((e) => [e.tool, e]));
  const get = (n: string) => by.get(n)!;

  const funnelE = get("get_funnel");
  const funnel = unwrap(funnelE);
  if (!funnel) {
    const r = funnelE.result as any;
    if (r?.code === "journey_not_found") return null;
    throw new Error(`get_funnel failed: ${r?.error ?? "unknown"}`);
  }

  const capsR = unwrap(get("get_capabilities_full"));
  if (!capsR)
    throw new Error(
      `capability read failed: ${(get("get_capabilities_full").result as any)?.error}`,
    );
  const caps = capsR.capabilities as Obj[];

  const footprint = unwrap(get("get_footprint"));
  const exps = (unwrap(get("get_experience_web"))?.experiences as Obj[]) ?? [];
  const links = unwrap(get("get_skill_links"));
  const skills = unwrap(get("get_skill_map"));
  const repos = unwrap(get("get_repositories"));
  const code = unwrap(get("get_code_profile"));
  const collab = unwrap(get("get_collaboration"));
  const evolution = unwrap(get("get_evolution"));
  const hotspots = unwrap(get("get_hotspots"));

  const strengths = deriveStrengths(caps);
  const capsOut = caps.map((c) => ({ ...c, howWeKnow: howWeKnow(c) }));

  const traversals = await Promise.all(
    entries.map((e) => traceFor(ctx, e, opts.plan)),
  );

  return {
    developerId: ctx.developerId,
    developer: funnel.developer,
    funnel: {
      stages: funnel.stages,
      side: funnel.side,
      complete: funnel.complete,
    },
    flow: buildFlow({
      funnel,
      footprint,
      caps,
      links,
      skills,
      collab,
      repos,
      experiences: exps,
    }),
    footprint,
    strengths,
    capabilities: capsOut,
    experiences: exps,
    skillLinks: links,
    skillMap: skills,
    repositories: repos,
    codeProfile: code,
    collaboration: collab,
    evolution,
    hotspots,
    findings: buildFindings({
      caps,
      strengths,
      funnel,
      evolution,
      hotspots,
      links,
      repos,
    }),
    graph: buildGraph(ctx.developerId, funnel, caps, exps, links),
    narrative: buildNarrative(funnel, strengths, caps),
    narrativeSource: "generated",
    limitations: LIMITATIONS,
    traversals,
    generatedAt: new Date().toISOString(),
  };
}

const NARRATE_SYSTEM = `You write a short, personal explanation of how a developer's code history was read from a FalkorDB graph.
Rules:
- Use ONLY facts in the JSON. Never invent repositories, files, numbers or skills.
- Follow the funnel: commits, file changes, detections, experiences, capabilities. Quote the real counts.
- Name at least one proof chain (commit, file, capability) from the JSON.
- Say levels come from rule-based detectors, not a verified assessment. Mark tentative strengths as tentative.
- No advice, no next steps. Second person, plain words, at most 200 words, no headings.`;

function compactForNarration(d: JourneyDossier): string {
  return JSON.stringify({
    funnel: d.funnel,
    flow: d.flow.map((f) => ({ name: f.name, explain: f.explain })),
    strengths: d.strengths.slice(0, 8),
    proofChains: d.capabilities
      .slice(0, 4)
      .map((c) => ({
        capability: c.name,
        level: c.level,
        chain: c.chains?.[0]?.path,
        file: c.chains?.[0]?.fileChange?.path,
      })),
    limitations: d.limitations,
    draft: d.narrative,
  });
}

export async function runJourneyAgent(
  ctx: Ctx,
  opts: JourneyAgentOptions = {},
): Promise<JourneyDossier | null> {
  const cacheable = !opts.fresh && (!opts.plan || opts.plan === "off");
  const key = ctx.developerId;

  let pending: Promise<JourneyDossier | null>;
  const hit = cache.get(key);
  if (cacheable && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    pending = hit.value;
  } else {
    pending = build(ctx, opts);
    if (cacheable) {
      if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { at: Date.now(), value: pending });
      pending.catch(() => cache.delete(key));
    }
  }

  const base = await pending;
  if (!base || !opts.narrate) return base;
  try {
    const text = (
      await opts.narrate(NARRATE_SYSTEM, compactForNarration(base))
    ).trim();
    return text ? { ...base, narrative: text, narrativeSource: "llm" } : base;
  } catch {
    return base;
  }
}

export function invalidateJourney(developerId: string): void {
  cache.delete(developerId);
}




export function withoutQueries(d: JourneyDossier): JourneyDossier {
  return {
    ...d,
    traversals: d.traversals.map(({ cypher, plans, ...t }) => ({
      ...t,
      queries: t.queries,
    })),
  };
}


export function toSummary(d: JourneyDossier) {
  return {
    developerId: d.developerId,
    developer: d.developer,
    funnel: d.funnel,
    flow: d.flow,
    strengths: d.strengths.slice(0, 10),
    capabilities: d.capabilities.map((c) => ({
      capabilityId: c.capabilityId,
      name: c.name,
      domain: c.domain,
      level: c.level,
      detections: c.detections,
      commits: c.commits,
      repositories: c.repositories,
      bestChain: c.chains?.[0]?.path ?? [],
    })),
    footprint: d.footprint ? { totals: d.footprint.totals } : null,
    repositories: d.repositories?.coverage ?? null,
    findings: d.findings.slice(0, 12),
    narrative: d.narrative,
    narrativeSource: d.narrativeSource,
    limitations: d.limitations,
    generatedAt: d.generatedAt,
  };
}


export function toFlow(d: JourneyDossier) {
  return {
    developerId: d.developerId,
    funnel: d.funnel,
    flow: d.flow,
    footprint: d.footprint,
    traversals: d.traversals,
    whyFalkorDB: JOURNEY_MODEL.whyFalkorDB,
    generatedAt: d.generatedAt,
  };
}

export const toGraph = (d: JourneyDossier) => ({
  developerId: d.developerId,
  ...d.graph,
  generatedAt: d.generatedAt,
});



export async function runJourneyTool(
  ctx: Ctx,
  name: string,
  args: Obj = {},
): Promise<{ result: unknown; trace: AgentTrace }> {
  const entry = await runTool(ctx, name, args, JOURNEY_TOOLS);
  return { result: entry.result, trace: await traceFor(ctx, entry) };
}





export interface IntegrityCheck {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
  sample?: Obj[];
}

export async function runJourneyIntegrity(
  ctx: Ctx,
): Promise<{ ok: boolean; checks: IntegrityCheck[]; generatedAt: string }> {
  const g = graphOf(ctx);
  const dev = ctx.developerId;
  const checks: IntegrityCheck[] = [];

  const zero = async (
    id: string,
    name: string,
    query: string,
    bad: string,
    params: Obj = { dev },
  ) => {
    const rows = await tryRows(g, `integrity ${id}`, query, params);
    checks.push(
      rows === null
        ? { id, name, ok: false, detail: "query failed" }
        : {
            id,
            name,
            ok: rows.length === 0,
            detail: rows.length === 0 ? "no problems found" : bad,
            ...(rows.length ? { sample: rows.slice(0, 10) } : {}),
          },
    );
  };

  await zero(
    "rollup_matches_evidence",
    "HAS_CAPABILITY roll-up equals the Demonstration nodes behind it",
    `MATCH (d:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c:Capability) WHERE c.parent_id <> ""
     OPTIONAL MATCH (d)-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c)
     WITH c, hc, count(x) AS actual WHERE hc.evidence_count <> actual
     RETURN c.id AS capability, hc.evidence_count AS stored, actual`,
    "stored evidence_count differs from the nodes found (mission-sourced demonstrations can cause this legitimately)",
  );

  {
    const [e, x] = await Promise.all([
      tryRows(
        g,
        "integrity experiences",
        `MATCH (:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience) RETURN sum(e.evidence_count) AS n`,
        { dev },
      ),
      tryRows(
        g,
        "integrity demonstrations",
        `MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration) RETURN count(x) AS n`,
        { dev },
      ),
    ]);
    const id = "experiences_cover_demonstrations";
    const name = "Experiences account for every Demonstration";
    if (!e || !x) checks.push({ id, name, ok: false, detail: "query failed" });
    else {
      const a = num(e[0]?.n);
      const b = num(x[0]?.n);
      checks.push({
        id,
        name,
        ok: a === b,
        detail:
          a === b
            ? `${b} demonstrations, all grouped`
            : `experiences hold ${a}, ${b} demonstrations exist (mission-sourced ones can cause this)`,
      });
    }
  }

  await zero(
    "orphan_demonstrations",
    "Every Demonstration has capability, repository, file change and context",
    `MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)
     WHERE NOT (x)-[:OF_CAPABILITY]->(:Capability) OR NOT (x)-[:IN_REPOSITORY]->(:Repository)
        OR NOT (x)-[:EVIDENCED_BY]->(:FileChange) OR NOT (x)-[:IN_CONTEXT]->(:EngineeringContext)
     RETURN x.id AS id, x.technique AS technique LIMIT 20`,
    "demonstrations are missing a supporting edge",
  );

  await zero(
    "experiences_missing_edges",
    "Every Experience has its supporting edges",
    `MATCH (:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)
     WHERE NOT (e)-[:SUPPORTED_BY]->(:Demonstration) OR NOT (e)-[:DEMONSTRATES_CAPABILITY]->(:Capability)
        OR NOT (e)-[:SOLVES]->(:Problem) OR NOT (e)-[:USES_TECHNIQUE]->(:Technique) OR NOT (e)-[:OCCURS_IN]->(:Repository)
     RETURN e.id AS id, e.technique AS technique LIMIT 20`,
    "experiences are missing a supporting edge",
  );

  {
    const rows = await tryRows(
      g,
      "integrity builds",
      `MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration) RETURN x.build_id AS build, count(*) AS n`,
      { dev },
    );
    const id = "single_build";
    const name = "All Demonstrations come from one build";
    checks.push(
      rows === null
        ? { id, name, ok: false, detail: "query failed" }
        : {
            id,
            name,
            ok: rows.length <= 1,
            detail:
              rows.length <= 1
                ? "one build"
                : "more than one build present: stale cleanup did not finish",
            ...(rows.length > 1 ? { sample: rows.slice(0, 10) } : {}),
          },
    );
  }

  await zero(
    "no_cross_developer_experiences",
    "No Experience belongs to another developer",
    `MATCH (:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience) WHERE e.developer_id <> $dev RETURN e.id AS id, e.developer_id AS developer_id LIMIT 20`,
    "experiences carry another developer's id",
  );

  await zero(
    "taxonomy_integrity",
    "Every learnable capability has a domain and a technique spec",
    `MATCH (c:Capability) WHERE c.parent_id <> ""
     OPTIONAL MATCH (c)-[:SPECIALIZES]->(dom:Capability)
     OPTIONAL MATCH (c)-[:HAS_TECHNIQUE_SPEC]->(t:TechniqueSpec)
     WITH c, dom, count(t) AS specs WHERE dom IS NULL OR specs = 0
     RETURN c.id AS capability, dom.id AS domain, specs`,
    "capabilities are missing a domain or a technique spec",
    {},
  );

  await zero(
    "filechange_links",
    "Every FileChange has a repository and a commit",
    `MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
     WHERE NOT (fc)-[:IN_REPOSITORY]->(:Repository) OR NOT (:Commit)-[:CHANGED]->(fc)
     RETURN fc.id AS id LIMIT 20`,
    "file changes are missing a repository or commit link",
  );

  return {
    ok: checks.every((c) => c.ok),
    checks,
    generatedAt: new Date().toISOString(),
  };
}





export interface ToolCall {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type ChatFn = (
  messages: ChatMessage[],
  tools: ReturnType<typeof specsFor>,
) => Promise<{ content: string | null; tool_calls?: ToolCall[] }>;

const graphBrief = (): string =>
  [
    "WHY A GRAPH (FalkorDB):",
    ...JOURNEY_MODEL.whyFalkorDB.map((w) => `- ${w}`),
    "",
    "GRAPH MODEL (one subgraph per developer, shared taxonomy):",
    ...JOURNEY_MODEL.relationships.map(
      (r) => `- (${r.from})-[:${r.type}]->(${r.to}): ${r.meaning}`,
    ),
    "LEVELS: " +
      Object.entries(JOURNEY_MODEL.levels)
        .map(([k, v]) => `${k} = ${v}`)
        .join("; "),
    "COMMIT EVIDENCE: " +
      Object.entries(JOURNEY_MODEL.evidenceStatus)
        .map(([k, v]) => `${k} = ${v}`)
        .join("; "),
  ].join("\n");

const ASK_SYSTEM = `You are the journey agent for ONE developer. You do not summarise: you walk their FalkorDB graph with tools and report the path, the counts and the code. A reader must be able to see that the answer came from stored nodes and edges, not from a language model's guess.

${graphBrief()}

Which tool for which question:
- "How did you get this / how does it work / show the flow" -> get_funnel, get_footprint.
- "What are they good at" -> list_capabilities, then trace_capability on the top ones.
- "Show proof" -> trace_capability (chains), trace_commit, trace_file.
- A project -> trace_repository, get_repositories.
- A loose topic (caching, auth, queues) -> search_capabilities, then trace_capability where developerLevel is not "missing".
- Hardening quality -> list_capabilities or trace_capability (safeguards seen vs not detected).
- Languages and tools -> get_skill_map, get_code_profile.
- How skills connect -> get_skill_links, skill_path.
- How skills grew -> get_evolution.
- How they ship and review -> get_code_profile, get_collaboration, get_hotspots.
- Experiences -> get_experience_web.
Call independent tools in the same round. Do not repeat a call.

HOW TO ANSWER (always this shape):
1. THE ANSWER with real repositories, files, counts, line ranges and permalinks copied EXACTLY from tool results. Never write a URL a tool did not return.
2. PATH WALKED: show at least one concrete chain from the results, for example (Developer) -[MADE]-> (Commit abc12345) -[CHANGED]-> (FileChange path) <-[EVIDENCED_BY]- (Demonstration id) -[OF_CAPABILITY]-> (Capability id). Use the "path" arrays from the tool results.
3. HOW FALKORDB GOT THIS: plain sentences. Where the traversal started, which edges it followed, what it read at the end, the real counts per hop (commits, file changes, detections, experiences, capabilities), and why a graph makes that trustworthy: stored connections, roll-ups on edges, every claim a few hops from its code.

Honesty rules:
- Capabilities come from rule-based detectors. Say "detected", never "proved".
- 1-2 detections or a single commit is tentative.
- "Not detected" safeguards means not seen in the code read, never "the developer skipped it".
- usage / repeated_usage means a primitive was used, not that the mechanism was built.
- Describe past work only. Never recommend, rank next steps or say what to learn.
- If a result has complete:false or an error, say that part is unknown. Missing evidence means "not seen".
- Never invent data. If tools returned nothing, say so.`;

const MAX_ROUNDS = 6;
const MAX_CALLS_PER_ROUND = 4;
const MAX_TOOL_CHARS = 14_000;
const MAX_HISTORY = 6;
const clip = (s: string): string =>
  s.length <= MAX_TOOL_CHARS ? s : `${s.slice(0, MAX_TOOL_CHARS)}…[truncated]`;
const URL_RE = /https?:\/\/[^\s)\]>"'`]+/g;
const trimUrl = (u: string): string => u.replace(/[.,;:!?]+$/, "");

export interface AskResult {
  answer: string;
  
  howFalkorDBAnswered: string[];
  toolsUsed: string[];
  
  ungroundedLinks: string[];
  
  trace: AgentTrace[];
}

export async function askJourney(
  ctx: Ctx,
  question: string,
  chat: ChatFn,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<AskResult> {
  const specs = specsFor(JOURNEY_TOOLS);
  const messages: ChatMessage[] = [
    { role: "system", content: ASK_SYSTEM },
    ...history
      .slice(-MAX_HISTORY)
      .map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
    { role: "user", content: question },
  ];

  const trace: AgentTrace[] = [];
  const memo = new Map<string, string>();
  const knownUrls = new Set<string>();
  const remember = (t: string) => {
    for (const m of t.match(URL_RE) ?? []) knownUrls.add(trimUrl(m));
  };

  const finish = (raw: string): AskResult => {
    const ungrounded = new Set<string>();
    const answer = raw.replace(URL_RE, (m) => {
      const u = trimUrl(m);
      if (knownUrls.has(u)) return m;
      ungrounded.add(u);
      return "[link removed: not in graph results]";
    });
    return {
      answer,
      howFalkorDBAnswered: trace.map(
        (t) =>
          `${t.title}: ${t.how} (${t.queries} ${t.queries === 1 ? "query" : "queries"}, ${t.dbMs} ms inside FalkorDB)`,
      ),
      toolsUsed: [...new Set(trace.map((t) => t.tool))],
      ungroundedLinks: [...ungrounded],
      trace,
    };
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const reply = await chat(messages, specs);
    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) return finish(reply.content ?? "");

    messages.push({
      role: "assistant",
      content: reply.content,
      tool_calls: calls,
    });

    const results = await Promise.all(
      calls.map(async (c, i) => {
        if (i >= MAX_CALLS_PER_ROUND)
          return {
            content: JSON.stringify({
              error: "too many tool calls in one round; ask again next round",
            }),
          };
        const key = `${c.function.name}:${c.function.arguments}`;
        const cached = memo.get(key);
        if (cached) return { content: cached };
        const entry = await runTool(
          ctx,
          c.function.name,
          c.function.arguments,
          JOURNEY_TOOLS,
        );
        trace.push(await traceFor(ctx, entry));
        const json = JSON.stringify(entry.result);
        remember(json);
        const content = clip(json);
        memo.set(key, content);
        return { content };
      }),
    );

    for (const [i, r] of results.entries()) {
      messages.push({
        role: "tool",
        tool_call_id: calls[i].id,
        content: r.content,
      });
    }
  }

  messages.push({
    role: "user",
    content:
      "Answer now using only what the tools returned. Include the answer, the PATH WALKED with a concrete chain, and HOW FALKORDB GOT THIS with real counts. Note any thin or unknown evidence.",
  });
  const last = await chat(messages, []);
  return finish(last.content ?? "");
}
