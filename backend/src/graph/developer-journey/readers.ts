import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import ALL_LEVELS = _constants.ALL_LEVELS;
import LEVEL_RANK = _constants.LEVEL_RANK;
import DEPTH_BY_RANK = _constants.DEPTH_BY_RANK;
import schemaReady = _constants.schemaReady;
import log = _helpers.log;
import str = _helpers.str;
import num = _helpers.num;
import strList = _helpers.strList;
import mapList = _helpers.mapList;
import rows = _helpers.rows;
import tryRows = _helpers.tryRows;
import asLevel = _helpers.asLevel;
import evidenceStateFor = _helpers.evidenceStateFor;
import levelsInStates = _helpers.levelsInStates;
import MAX_PREREQUISITE_DEPTH = _helpers.MAX_PREREQUISITE_DEPTH;
import PREREQUISITE_SATISFIED_BY = _helpers.PREREQUISITE_SATISFIED_BY;
import MIN_DETECTIONS_FOR_CONFIDENCE = _helpers.MIN_DETECTIONS_FOR_CONFIDENCE;
import MIN_COMMITS_FOR_CONFIDENCE = _helpers.MIN_COMMITS_FOR_CONFIDENCE;
import GRAPH_MODEL = _helpers.GRAPH_MODEL;
import CAPABILITY_KEYWORDS = _helpers.CAPABILITY_KEYWORDS;
import ignoreExists = _helpers.ignoreExists;
import setupSearch = _helpers.setupSearch;
import STOPWORDS = _helpers.STOPWORDS;
import fulltextQuery = _helpers.fulltextQuery;
import EXPERIENCE_DETAIL = _helpers.EXPERIENCE_DETAIL;
import EXPERIENCE_MAP = _helpers.EXPERIENCE_MAP;
import toExperience = _helpers.toExperience;
import toProof = _helpers.toProof;
import deriveStrengths = _helpers.deriveStrengths;
import summariseDomains = _helpers.summariseDomains;
import badRepo = _helpers.badRepo;
import plural = _helpers.plural;
import explainSelf = _helpers.explainSelf;
import explainCapabilities = _helpers.explainCapabilities;
import explainProof = _helpers.explainProof;
import explainStrengths = _helpers.explainStrengths;
import explainTimeline = _helpers.explainTimeline;
import explainRepositories = _helpers.explainRepositories;
import explainCoverage = _helpers.explainCoverage;
import explainWhole = _helpers.explainWhole;
import buildLimitations = _helpers.buildLimitations;
import deriveFrontierStatus = _helpers.deriveFrontierStatus;
import byNameThenId = _helpers.byNameThenId;
import PREREQUISITE_CHECK = _queries.PREREQUISITE_CHECK;
import FRONTIER_QUERY = _queries.FRONTIER_QUERY;
import asStatus = _queries.asStatus;
import Row = _types.Row;
import CapLevel = _types.CapLevel;
import EvidenceState = _types.EvidenceState;
import ProofRef = _types.ProofRef;
import ExperienceBrief = _types.ExperienceBrief;
import SelfReadout = _types.SelfReadout;
import Coverage = _types.Coverage;
import BuiltTechnique = _types.BuiltTechnique;
import BuiltCapability = _types.BuiltCapability;
import StrengthTier = _types.StrengthTier;
import JourneyStrength = _types.JourneyStrength;
import DomainSummary = _types.DomainSummary;
import TimelinePoint = _types.TimelinePoint;
import JourneyRepository = _types.JourneyRepository;
import GraphStep = _types.GraphStep;
import Journey = _types.Journey;
import CapabilityTrace = _types.CapabilityTrace;
import RepositoryTrace = _types.RepositoryTrace;
import CapabilityHit = _types.CapabilityHit;
import FrontierStatus = _types.FrontierStatus;
import PrerequisiteReadout = _types.PrerequisiteReadout;
import SafeguardCriterion = _types.SafeguardCriterion;
import TechniqueCriterion = _types.TechniqueCriterion;
import FrontierNode = _types.FrontierNode;
import DirectionMove = _types.DirectionMove;
import DirectionReadout = _types.DirectionReadout;
import ensureJourneySchema = _writers.ensureJourneySchema;

export async function findCapabilitiesForText(
  graph: Graph,
  text: string,
  limit = 8,
): Promise<CapabilityHit[]> {
  await ensureJourneySchema(graph);

  const q = fulltextQuery(text);
  if (!q) return [];

  const n = Math.min(Math.max(Math.floor(limit), 1), 12);

  const result = await tryRows(
    graph,
    "fulltext capability search",
    `
    CALL db.idx.fulltext.queryNodes('Capability', $q) YIELD node, score
    OPTIONAL MATCH (leaf:Capability)-[:SPECIALIZES*1..3]->(node)
    WITH CASE WHEN leaf IS NULL THEN node ELSE leaf END AS cap, score
    WHERE cap.parent_id <> ""
    RETURN cap.id AS capability_id, cap.name AS name, max(score) AS score
    ORDER BY score DESC
    LIMIT ${n}
    `,
    { q },
  );

  return (result ?? []).map((r) => ({
    capabilityId: str(r.capability_id),
    name: str(r.name),
    score: num(r.score),
  }));
}

export async function readTopExperiences(
  graph: Graph,
  developerId: string,
  limit: number,
): Promise<ExperienceBrief[]> {
  const result = await tryRows(
    graph,
    "top experiences",
    `
    MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)
    ${EXPERIENCE_DETAIL}
    WITH e, p,
         collect(DISTINCT coalesce(r.full_name, r.name)) AS repos,
         collect(DISTINCT tech.name) AS techs,
         collect(DISTINCT ctx.name) AS ctxs,
         CASE WHEN e.best_depth = "strong" THEN 3
              WHEN e.best_depth = "implementation" THEN 2
              ELSE 1 END AS depth_rank
    ORDER BY depth_rank DESC, e.evidence_count DESC
    LIMIT ${limit}
    RETURN ${EXPERIENCE_MAP} AS exp
    `,
    { dev: developerId },
  );

  return (result ?? []).map((r) => toExperience(r.exp ?? {}));
}

export async function readSelf(
  graph: Graph,
  developerId: string,
): Promise<SelfReadout> {
  const [
    who,
    work,
    demos,
    exps,
    caps,
    topExperiences,
    layers,
    intents,
    technologies,
    habits,
    repositories,
    depthMix,
    skills,
    activity,
  ] = await Promise.all([
    tryRows(
      graph,
      "developer",
      `MATCH (d:Developer {id: $dev})
       RETURN coalesce(d.name, "") AS name,
              coalesce(d.username, "") AS username,
              coalesce(d.avatar_url, "") AS avatar_url
       LIMIT 1`,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "work totals",
      `MATCH (d:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
       RETURN count(fc) AS file_changes,
              count(DISTINCT fc.commit_sha) AS commits,
              count(DISTINCT fc.repository_id) AS repositories`,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "demonstration totals",
      `MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)
       RETURN count(x) AS n`,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "experience totals",
      `MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)
       RETURN count(e) AS n`,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "capability totals",
      `MATCH (d:Developer {id: $dev})-[:HAS_CAPABILITY]->(c:Capability)
       WHERE c.parent_id <> ""
       RETURN count(c) AS n`,
      { dev: developerId },
    ),
    readTopExperiences(graph, developerId, 10),

    // which layer of the system they work in
    tryRows(
      graph,
      "layers",
      `MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:IN_CONTEXT]->(ctx:EngineeringContext)
       RETURN ctx.name AS name,
              count(DISTINCT e) AS experiences,
              sum(e.evidence_count) AS evidence
       ORDER BY evidence DESC
       LIMIT 6`,
      { dev: developerId },
    ),

    // why they change code (fix / feature / performance / reliability ...)
    tryRows(
      graph,
      "intents",
      `MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)
       RETURN coalesce(x.change_intent, "change") AS name, count(x) AS n
       ORDER BY n DESC
       LIMIT 6`,
      { dev: developerId },
    ),

    // what tools show up in their solutions
    tryRows(
      graph,
      "technologies",
      `MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:USES_TECHNOLOGY]->(t:Technology)
       RETURN t.name AS name,
              count(DISTINCT e) AS experiences,
              sum(e.evidence_count) AS evidence
       ORDER BY evidence DESC
       LIMIT 8`,
      { dev: developerId },
    ),

    // hardening habits: split the stored " | " modifier string inside Cypher
    tryRows(
      graph,
      "habits",
      `MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)
       WHERE x.modifiers IS NOT NULL AND x.modifiers <> ""
       UNWIND split(x.modifiers, " | ") AS label
       RETURN label, count(*) AS n
       ORDER BY n DESC
       LIMIT 8`,
      { dev: developerId },
    ),

    tryRows(
      graph,
      "repositories",
      `MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:OCCURS_IN]->(r:Repository)
       WITH r,
            count(DISTINCT e) AS experiences,
            sum(e.evidence_count) AS evidence,
            collect(DISTINCT e.technique) AS all_techniques
       RETURN coalesce(r.full_name, r.name) AS name,
              experiences,
              evidence,
              all_techniques[0..4] AS techs
       ORDER BY evidence DESC
       LIMIT 6`,
      { dev: developerId },
    ),

    tryRows(
      graph,
      "depth mix",
      `MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)
       RETURN coalesce(e.best_depth, "usage") AS depth, count(e) AS n
       ORDER BY n DESC`,
      { dev: developerId },
    ),

    tryRows(
      graph,
      "skills",
      `MATCH (d:Developer {id: $dev})-[hs:HAS_SKILL]->(s:Skill)
       RETURN s.name AS name,
              coalesce(hs.level, "") AS level,
              coalesce(hs.depth_score, 0) AS score
       ORDER BY score DESC
       LIMIT 8`,
      { dev: developerId },
    ),

    tryRows(
      graph,
      "activity",
      `MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)
       WHERE x.created_at IS NOT NULL AND x.created_at <> ""
       RETURN substring(x.created_at, 0, 7) AS month, count(x) AS n
       ORDER BY month`,
      { dev: developerId },
    ),
  ]);

  const w = work?.[0] ?? {};

  return {
    name: str(who?.[0]?.name),
    username: str(who?.[0]?.username),
    avatarUrl: str(who?.[0]?.avatar_url),
    totals: {
      repositories: num(w.repositories),
      commits: num(w.commits),
      fileChanges: num(w.file_changes),
      demonstrations: num(demos?.[0]?.n),
      experiences: num(exps?.[0]?.n),
      capabilities: num(caps?.[0]?.n),
    },
    topExperiences,
    layers: (layers ?? []).map((r) => ({
      name: str(r.name),
      experiences: num(r.experiences),
      evidence: num(r.evidence),
    })),
    intents: (intents ?? []).map((r) => ({
      name: str(r.name),
      count: num(r.n),
    })),
    technologies: (technologies ?? []).map((r) => ({
      name: str(r.name),
      experiences: num(r.experiences),
      evidence: num(r.evidence),
    })),
    habits: (habits ?? []).map((r) => ({
      label: str(r.label),
      count: num(r.n),
    })),
    repositories: (repositories ?? []).map((r) => ({
      name: str(r.name),
      experiences: num(r.experiences),
      evidence: num(r.evidence),
      techniques: strList(r.techs),
    })),
    depthMix: (depthMix ?? []).map((r) => ({
      depth: str(r.depth),
      count: num(r.n),
    })),
    skills: (skills ?? []).map((r) => ({
      name: str(r.name),
      level: str(r.level),
      score: num(r.score),
    })),
    activity: (activity ?? [])
      .map((r) => ({ month: str(r.month), count: num(r.n) }))
      .filter((r) => /^\d{4}-\d{2}$/.test(r.month))
      .slice(-14),
  };
}

export async function readExperiencesByCapability(
  graph: Graph,
  developerId: string,
  capabilityIds: string[],
): Promise<Map<string, ExperienceBrief[]>> {
  const out = new Map<string, ExperienceBrief[]>();
  if (!capabilityIds.length) return out;

  const result = await tryRows(
    graph,
    "experiences by capability",
    `
    UNWIND $ids AS cid
    MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:DEMONSTRATES_CAPABILITY]->(c:Capability {id: cid})
    ${EXPERIENCE_DETAIL}
    WITH cid, e, p,
         collect(DISTINCT coalesce(r.full_name, r.name)) AS repos,
         collect(DISTINCT tech.name) AS techs,
         collect(DISTINCT ctx.name) AS ctxs
    ORDER BY e.evidence_count DESC
    WITH cid, collect(${EXPERIENCE_MAP}) AS exps
    RETURN cid AS capability_id, exps[0..3] AS experiences
    `,
    { dev: developerId, ids: capabilityIds },
  );

  for (const r of result ?? []) {
    out.set(str(r.capability_id), mapList(r.experiences).map(toExperience));
  }
  return out;
}

export async function readProofs(
  graph: Graph,
  experienceIds: string[],
): Promise<Map<string, ProofRef>> {
  const out = new Map<string, ProofRef>();
  if (!experienceIds.length) return out;

  const result = await tryRows(
    graph,
    "experience proofs",
    `
    UNWIND $ids AS eid
    MATCH (e:Experience {id: eid})-[:SUPPORTED_BY]->(x:Demonstration)
    OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
    WITH eid, x, r
    ORDER BY x.depth_rank DESC, x.created_at DESC
    WITH eid, collect({
      repository: coalesce(r.full_name, r.name, ""),
      path: coalesce(x.path, ""),
      start_line: coalesce(x.start_line, 0),
      end_line: coalesce(x.end_line, 0),
      permalink: coalesce(x.permalink, ""),
      snippet: coalesce(x.snippet, ""),
      commit_subject: coalesce(x.commit_subject, ""),
      depth: coalesce(x.depth, "usage"),
      modifiers: coalesce(x.modifiers, "")
    }) AS proofs
    RETURN eid AS id, proofs[0] AS proof
    `,
    { ids: experienceIds },
  );

  for (const r of result ?? []) {
    const p = r.proof;
    if (!p || typeof p !== "object") continue;
    out.set(str(r.id), toProof(p));
  }
  return out;
}

export async function readCapabilityProofs(
  graph: Graph,
  developerId: string,
  capabilityIds: string[],
): Promise<Map<string, ProofRef[]>> {
  const out = new Map<string, ProofRef[]>();
  if (!capabilityIds.length) return out;

  const result = await tryRows(
    graph,
    "capability proofs",
    `
    UNWIND $ids AS cid
    MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability {id: cid})
    OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
    WITH cid, x, r
    ORDER BY x.depth_rank DESC, x.created_at DESC
    WITH cid, collect({
      repository: coalesce(r.full_name, r.name, ""),
      path: coalesce(x.path, ""),
      start_line: coalesce(x.start_line, 0),
      end_line: coalesce(x.end_line, 0),
      permalink: coalesce(x.permalink, ""),
      snippet: coalesce(x.snippet, ""),
      commit_subject: coalesce(x.commit_subject, ""),
      depth: coalesce(x.depth, "usage"),
      modifiers: coalesce(x.modifiers, "")
    }) AS proofs
    RETURN cid AS capability_id, proofs[0..3] AS proofs
    `,
    { dev: developerId, ids: capabilityIds },
  );

  for (const r of result ?? []) {
    out.set(str(r.capability_id), mapList(r.proofs).map(toProof));
  }
  return out;
}

export async function readCapabilityRows(
  graph: Graph,
  developerId: string,
): Promise<BuiltCapability[] | null> {
  const [caps, techs] = await Promise.all([
    tryRows(
      graph,
      "built capabilities",
      `
      MATCH (d:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c:Capability)
      WHERE c.parent_id <> ""
      OPTIONAL MATCH (c)-[:SPECIALIZES]->(dom:Capability)
      RETURN c.id AS capability_id,
             c.name AS name,
             coalesce(c.description, "") AS description,
             coalesce(dom.id, "") AS domain_id,
             coalesce(dom.name, "") AS domain,
             coalesce(hc.level, "missing") AS level,
             coalesce(hc.recency, "") AS recency,
             coalesce(hc.best_depth, "usage") AS best_depth,
             coalesce(hc.evidence_count, 0) AS evidence_count,
             coalesce(hc.commit_count, 0) AS commit_count,
             coalesce(hc.repo_count, 0) AS repo_count,
             coalesce(hc.active_days, 0) AS active_days,
             coalesce(hc.first_seen, "") AS first_seen,
             coalesce(hc.last_seen, "") AS last_seen
      `,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "built techniques",
      `
      MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
      RETURN c.id AS capability_id,
             x.rule_id AS rule_id,
             x.technique AS technique,
             count(x) AS times_built,
             max(x.depth_rank) AS best_rank,
             collect(x.modifiers) AS mods
      `,
      { dev: developerId },
    ),
  ]);

  if (!caps) return null;

  const techByCap = new Map<string, BuiltTechnique[]>();
  for (const r of techs ?? []) {
    const counts = new Map<string, number>();
    for (const m of strList(r.mods)) {
      for (const label of m.split(" | ")) {
        const l = label.trim();
        if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
      }
    }
    const hardening = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([label, count]) => ({ label, count }));

    const id = str(r.capability_id);
    const list = techByCap.get(id) ?? [];
    list.push({
      ruleId: str(r.rule_id),
      technique: str(r.technique),
      timesBuilt: num(r.times_built),
      bestDepth: DEPTH_BY_RANK[num(r.best_rank)] || "usage",
      hardening,
    });
    techByCap.set(id, list);
  }

  return caps
    .map((r): BuiltCapability => {
      const level = asLevel(r.level);
      const id = str(r.capability_id);
      return {
        capabilityId: id,
        name: str(r.name),
        description: str(r.description),
        domainId: str(r.domain_id),
        domain: str(r.domain),
        level,
        state: evidenceStateFor(level),
        recency: str(r.recency),
        bestDepth: str(r.best_depth) || "usage",
        evidenceCount: num(r.evidence_count),
        commitCount: num(r.commit_count),
        repoCount: num(r.repo_count),
        activeDays: num(r.active_days),
        firstSeen: str(r.first_seen),
        lastSeen: str(r.last_seen),
        techniques: (techByCap.get(id) ?? []).sort(
          (a, b) => b.timesBuilt - a.timesBuilt,
        ),
        experiences: [],
        proofs: [],
      };
    })
    .sort(
      (a, b) =>
        LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
        b.evidenceCount - a.evidenceCount ||
        a.name.localeCompare(b.name),
    );
}

export async function readBuiltCapabilities(
  graph: Graph,
  developerId: string,
  filter: { minLevel?: string; domainId?: string } = {},
): Promise<BuiltCapability[]> {
  await ensureJourneySchema(graph);
  const all = await readCapabilityRows(graph, developerId);
  if (!all) throw new Error("capability read failed");

  const min = filter.minLevel ? LEVEL_RANK[asLevel(filter.minLevel)] : -1;
  return all.filter(
    (c) =>
      LEVEL_RANK[c.level] >= min &&
      (!filter.domainId || c.domainId === filter.domainId),
  );
}

export async function readTimeline(
  graph: Graph,
  developerId: string,
): Promise<TimelinePoint[] | null> {
  const result = await tryRows(
    graph,
    "capability timeline",
    `
    MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
    WHERE x.created_at IS NOT NULL AND x.created_at <> "" AND c.parent_id <> ""
    RETURN substring(x.created_at, 0, 7) AS month,
           c.id AS capability_id,
           c.name AS name,
           count(x) AS n,
           max(x.depth_rank) AS best_rank
    ORDER BY month
    `,
    { dev: developerId },
  );
  if (!result) return null;

  return result
    .map((r) => ({
      month: str(r.month),
      capabilityId: str(r.capability_id),
      name: str(r.name),
      count: num(r.n),
      bestDepth: DEPTH_BY_RANK[num(r.best_rank)] || "usage",
    }))
    .filter((r) => /^\d{4}-\d{2}$/.test(r.month));
}

export async function readJourneyRepositories(
  graph: Graph,
  developerId: string,
): Promise<JourneyRepository[] | null> {
  const result = await tryRows(
    graph,
    "journey repositories",
    `
    MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:OCCURS_IN]->(r:Repository)
    OPTIONAL MATCH (e)-[:DEMONSTRATES_CAPABILITY]->(c:Capability)
    WITH r, e, c
    WITH r,
         count(DISTINCT e) AS experiences,
         sum(e.evidence_count) AS evidence,
         collect(DISTINCT c.name) AS caps,
         collect(DISTINCT e.technique) AS techs
    RETURN coalesce(r.full_name, r.name) AS name,
           experiences,
           evidence,
           caps,
           techs
    ORDER BY evidence DESC
    LIMIT 15
    `,
    { dev: developerId },
  );
  if (!result) return null;

  return result.map((r) => ({
    name: str(r.name),
    experiences: num(r.experiences),
    evidence: num(r.evidence),
    capabilities: strList(r.caps).sort((a, b) => a.localeCompare(b)),
    techniques: strList(r.techs).sort((a, b) => a.localeCompare(b)),
  }));
}

export async function readCoverage(
  graph: Graph,
  developerId: string,
): Promise<Coverage> {
  const unknown: Coverage = {
    known: false,
    source: "none",
    repositories: 0,
    incomplete: 0,
    incompleteNames: [],
  };

  const fromFileChanges = await tryRows(
    graph,
    "coverage (file changes)",
    `
    MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
    WITH fc.repository_id AS rid,
         count(fc) AS changes,
         sum(CASE WHEN fc.patch IS NULL OR fc.patch = "" THEN 1 ELSE 0 END) AS no_patch
    WHERE rid IS NOT NULL
    OPTIONAL MATCH (r:Repository {id: rid})
    RETURN toString(rid) AS rid,
           coalesce(r.full_name, r.name, toString(rid)) AS name,
           coalesce(r.analysis_status, "") AS status,
           changes,
           no_patch
    `,
    { dev: developerId },
  );

  if (fromFileChanges && fromFileChanges.length > 0) {
    const bad = fromFileChanges.filter(badRepo);
    return {
      known: true,
      source: "file_changes",
      repositories: fromFileChanges.length,
      incomplete: bad.length,
      incompleteNames: bad
        .map((r) => str(r.name))
        .filter(Boolean)
        .slice(0, 6),
    };
  }

  const fromEdge = await tryRows(
    graph,
    "coverage (contributed_to)",
    `
    MATCH (:Developer {id: $dev})-[:CONTRIBUTED_TO]->(r:Repository)
    OPTIONAL MATCH (fc:FileChange {repository_id: r.id})
    WITH r,
         count(fc) AS changes,
         sum(CASE WHEN fc IS NOT NULL AND (fc.patch IS NULL OR fc.patch = "")
                  THEN 1 ELSE 0 END) AS no_patch
    RETURN coalesce(r.full_name, r.name, "") AS name,
           coalesce(r.analysis_status, "") AS status,
           changes,
           no_patch
    `,
    { dev: developerId },
  );

  if (fromEdge && fromEdge.length > 0) {
    const bad = fromEdge.filter(badRepo);
    return {
      known: true,
      source: "contributed_to",
      repositories: fromEdge.length,
      incomplete: bad.length,
      incompleteNames: bad
        .map((r) => str(r.name))
        .filter(Boolean)
        .slice(0, 6),
    };
  }

  return unknown;
}

export async function readCapabilityTrace(
  graph: Graph,
  developerId: string,
  capabilityId: string,
  limit = 8,
): Promise<CapabilityTrace | { error: string }> {
  const cid = capabilityId.trim();
  if (!cid) return { error: "capability_id is required" };
  const n = Math.min(Math.max(Math.floor(limit) || 8, 1), 20);

  const [head, demos] = await Promise.all([
    tryRows(
      graph,
      "capability header",
      `
      MATCH (c:Capability {id: $cid})
      OPTIONAL MATCH (:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c)
      RETURN c.name AS name,
             coalesce(hc.level, "missing") AS level,
             coalesce(hc.evidence_count, 0) AS evidence_count
      LIMIT 1
      `,
      { dev: developerId, cid },
    ),
    tryRows(
      graph,
      "capability demonstrations",
      `
      MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
      WHERE c.id = $cid OR c.parent_id = $cid
      OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
      OPTIONAL MATCH (x)-[:IN_CONTEXT]->(ctx:EngineeringContext)
      OPTIONAL MATCH (x)-[:USES]->(s:Skill)
      WITH x, c, r, ctx, collect(DISTINCT s.name) AS skills
      RETURN x.id AS id,
             c.id AS capability_id,
             x.technique AS technique,
             coalesce(x.depth, "usage") AS depth,
             coalesce(x.modifiers, "") AS modifiers,
             coalesce(r.full_name, r.name, "") AS repository,
             coalesce(x.path, "") AS path,
             coalesce(x.start_line, 0) AS start_line,
             coalesce(x.end_line, 0) AS end_line,
             coalesce(x.permalink, "") AS permalink,
             coalesce(x.commit_subject, "") AS commit_subject,
             coalesce(x.change_intent, "") AS change_intent,
             coalesce(ctx.name, "") AS layer,
             coalesce(x.snippet, "") AS snippet,
             skills,
             coalesce(x.created_at, "") AS created_at
      ORDER BY x.depth_rank DESC, x.created_at DESC
      LIMIT ${n}
      `,
      { dev: developerId, cid },
    ),
  ]);

  if (!head || head.length === 0) {
    return { error: `unknown capability "${cid}"` };
  }
  if (!demos) return { error: "demonstration read failed" };

  const experiences =
    (await readExperiencesByCapability(graph, developerId, [cid])).get(cid) ??
    [];
  const proofs = await readProofs(
    graph,
    experiences.map((e) => e.id),
  );
  for (const e of experiences) e.proof = proofs.get(e.id) ?? null;

  const level = asLevel(head[0].level);
  return {
    capabilityId: cid,
    name: str(head[0].name),
    level,
    state: evidenceStateFor(level),
    evidenceCount: num(head[0].evidence_count),
    experiences,
    demonstrations: demos.map((r) => ({
      id: str(r.id),
      capabilityId: str(r.capability_id),
      technique: str(r.technique),
      depth: str(r.depth) || "usage",
      modifiers: str(r.modifiers).split(" | ").filter(Boolean),
      repository: str(r.repository),
      path: str(r.path),
      startLine: num(r.start_line),
      endLine: num(r.end_line),
      permalink: str(r.permalink),
      commitSubject: str(r.commit_subject),
      changeIntent: str(r.change_intent),
      layer: str(r.layer),
      snippet: str(r.snippet),
      skills: strList(r.skills),
      createdAt: str(r.created_at),
    })),
  };
}

export async function readRepositoryTrace(
  graph: Graph,
  developerId: string,
  repository: string,
): Promise<RepositoryTrace | { error: string }> {
  const q = repository.trim().toLowerCase();
  if (!q) return { error: "repository is required" };

  const result = await tryRows(
    graph,
    "repository trace",
    `
    MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:OCCURS_IN]->(r:Repository)
    WHERE toLower(coalesce(r.full_name, r.name, "")) CONTAINS $q
    OPTIONAL MATCH (e)-[:DEMONSTRATES_CAPABILITY]->(c:Capability)
    RETURN coalesce(r.full_name, r.name) AS repository,
           e.id AS id,
           e.technique AS technique,
           coalesce(c.id, "") AS capability_id,
           coalesce(c.name, "") AS capability,
           coalesce(e.best_depth, "usage") AS depth,
           coalesce(e.evidence_count, 0) AS evidence,
           coalesce(e.first_seen, "") AS first_seen,
           coalesce(e.last_seen, "") AS last_seen
    ORDER BY evidence DESC
    LIMIT 40
    `,
    { dev: developerId, q },
  );
  if (!result) return { error: "repository read failed" };

  const byRepo = new Map<string, RepositoryTrace["matches"][number]>();
  for (const r of result) {
    const name = str(r.repository);
    const entry = byRepo.get(name) ?? { repository: name, experiences: [] };
    entry.experiences.push({
      id: str(r.id),
      technique: str(r.technique),
      capabilityId: str(r.capability_id),
      capability: str(r.capability),
      depth: str(r.depth),
      evidenceCount: num(r.evidence),
      firstSeen: str(r.first_seen),
      lastSeen: str(r.last_seen),
    });
    byRepo.set(name, entry);
  }

  return { query: repository, matches: [...byRepo.values()] };
}

export async function readJourney(
  graph: Graph,
  developerId: string,
): Promise<Journey | null> {
  await ensureJourneySchema(graph);

  const exists = await tryRows(
    graph,
    "developer exists",
    `MATCH (d:Developer {id: $dev}) RETURN d.id AS id LIMIT 1`,
    { dev: developerId },
  );
  if (!exists || exists.length === 0) return null;

  const provenance: GraphStep[] = [];
  const step = (s: GraphStep) => provenance.push(s);

  const [self, capsRead, timelineRead, reposRead, coverage] = await Promise.all(
    [
      readSelf(graph, developerId),
      readCapabilityRows(graph, developerId),
      readTimeline(graph, developerId),
      readJourneyRepositories(graph, developerId),
      readCoverage(graph, developerId),
    ],
  );

  if (!capsRead) throw new Error("capability read failed");
  const capabilities = capsRead;

  step({
    section: "self",
    question: "What does this developer's work look like overall?",
    pattern:
      "(Developer)-[AUTHORED_CODE]->(FileChange); (Developer)-[EXPERIENCED]->(Experience)-[IN_CONTEXT|USES_TECHNOLOGY]->(...)",
    rows: self.topExperiences.length,
    why: "Totals and the shape of the work: layers, intents, technologies, strongest experiences.",
    explanation: explainSelf(self),
    falkordb: [
      "Property graph: Developer, FileChange, Experience and Technology are real nodes joined by stored edges",
      "Cypher aggregation (count, sum, collect) done inside the database",
      "Traversal starts at one indexed Developer node, so other developers are never touched",
    ],
  });

  step({
    section: "capabilities",
    question:
      "Which skills were detected in this developer's code, and at what level?",
    pattern:
      "(Developer)-[HAS_CAPABILITY]->(Capability)-[SPECIALIZES]->(domain); (Developer)-[DEMONSTRATED]->(Demonstration)-[OF_CAPABILITY]->(Capability)",
    rows: capabilities.length,
    why: "HAS_CAPABILITY is the roll-up level per skill; the Demonstration side shows which techniques were detected and which hardening behaviours were observed.",
    explanation: explainCapabilities(capabilities, self),
    falkordb: [
      "Relationship properties: level and evidence counts are stored on the HAS_CAPABILITY edge",
      "One-hop traversal from Developer to Capability, one more hop to the domain",
      "Group-by over Demonstration nodes to count techniques and hardening habits",
    ],
  });

  // proof: experiences and demonstrations for every capability with evidence
  const ids = capabilities.map((c) => c.capabilityId);
  const [expByCap, proofByCap] = await Promise.all([
    readExperiencesByCapability(graph, developerId, ids),
    readCapabilityProofs(graph, developerId, ids),
  ]);

  const experiencesShown: ExperienceBrief[] = [
    ...self.topExperiences,
    ...[...expByCap.values()].flat(),
  ];
  const expProofs = await readProofs(graph, [
    ...new Set(experiencesShown.map((e) => e.id)),
  ]);
  for (const e of experiencesShown) e.proof = expProofs.get(e.id) ?? null;

  for (const c of capabilities) {
    c.experiences = expByCap.get(c.capabilityId) ?? [];
    c.proofs = proofByCap.get(c.capabilityId) ?? [];
  }

  const proofCount = [...proofByCap.values()].reduce((n, p) => n + p.length, 0);
  step({
    section: "proof",
    question: "Which code triggered each detection?",
    pattern:
      "(Capability)<-[OF_CAPABILITY]-(Demonstration)-[IN_REPOSITORY]->(Repository); (Experience)-[SUPPORTED_BY]->(Demonstration)",
    rows: proofCount,
    why: "Every skill is walked down to concrete code: repository, file, line range, GitHub permalink, snippet.",
    explanation: explainProof(capabilities, proofCount),
    falkordb: [
      "Reverse traversal: edges can be followed from the skill back to its evidence",
      "ORDER BY and slicing inside the query keep only the strongest examples per skill",
      "Evidence nodes carry permalink, path and line range, so no second lookup is needed",
    ],
  });

  const strengths = deriveStrengths(capabilities);
  step({
    section: "strengths",
    question: "What does the evidence say this developer is strongest at?",
    pattern:
      "level + evidence/commit/repo/day counts on HAS_CAPABILITY (rules: strong=core, implementation=solid, repeated_usage=emerging)",
    rows: strengths.length,
    why: "Tiers are decided by deterministic rules over the developer's own code evidence, not by an LLM and not by a blended score. They are only as reliable as the detectors behind them.",
    explanation: explainStrengths(strengths),
    falkordb: [
      "Reuses properties already stored on HAS_CAPABILITY edges; no extra query",
    ],
  });

  const timeline = timelineRead ?? [];
  step({
    section: "timeline",
    question: "When did each skill first appear and grow?",
    pattern:
      "(Developer)-[DEMONSTRATED]->(Demonstration {created_at})-[OF_CAPABILITY]->(Capability), grouped by month",
    rows: timeline.length,
    why: "Shows when each skill was first detected and how deep it got over time.",
    explanation: explainTimeline(timeline),
    falkordb: [
      "Two-hop traversal with a filter on a node property (created_at)",
      "Grouping by month and skill is done in Cypher, so only summary rows leave the database",
    ],
  });

  const repositories = reposRead ?? [];
  step({
    section: "repositories",
    question: "What was detected in which project?",
    pattern:
      "(Developer)-[EXPERIENCED]->(Experience)-[OCCURS_IN]->(Repository); (Experience)-[DEMONSTRATES_CAPABILITY]->(Capability)",
    rows: repositories.length,
    why: "What was detected where: per project, the capabilities and techniques it contains.",
    explanation: explainRepositories(repositories, self.totals.repositories),
    falkordb: [
      "The same graph read from the project side",
      "collect(DISTINCT ...) gathers each project's skills and techniques in one pass",
    ],
  });

  step({
    section: "coverage",
    question: "Was any of the history unreadable?",
    pattern:
      coverage.source === "contributed_to"
        ? "(Developer)-[CONTRIBUTED_TO]->(Repository)<-(FileChange {patch})"
        : "(Developer)-[AUTHORED_CODE]->(FileChange {repository_id, patch}) grouped by repository",
    rows: coverage.repositories,
    why: "Tells you whether anything was skipped. Missing evidence means 'not seen', never 'cannot do it'.",
    explanation: explainCoverage(coverage, self.totals.repositories),
    falkordb: [
      "Grouping file changes by repository inside the query, so coverage is computed from the same nodes as the totals",
      "Optional match to attach each repository's sync status when the node exists",
    ],
  });

  return {
    developerId,
    self,
    summary: {
      capabilitiesWithEvidence: capabilities.length,
      built: capabilities.filter((c) => c.state === "demonstrated").length,
      partial: capabilities.filter((c) => c.state === "partial").length,
      strengths: strengths.filter((s) => s.tier !== "emerging").length,
      repositories: repositories.length,
      repositoriesTouched: self.totals.repositories,
    },
    capabilities,
    strengths,
    domains: summariseDomains(capabilities),
    timeline,
    repositories,
    coverage,
    howFalkorDBAnswered: explainWhole(self, capabilities, strengths),
    limitations: buildLimitations(
      self,
      capabilities,
      strengths,
      repositories,
      coverage,
    ),
    provenance,
  };
}

export function evaluateCapabilityCriteria(
  level: CapLevel,
  techniques: TechniqueCriterion[],
): { met: boolean; unmet: string[] } {
  const unmet: string[] = [];

  if (techniques.length === 0) {
    unmet.push("No explicit criteria exist for this capability");
  }
  if (evidenceStateFor(level) !== "demonstrated") {
    unmet.push("Build the mechanism yourself (only used or unseen so far)");
  }
  if (techniques.length > 0 && !techniques.some((t) => t.built > 0)) {
    unmet.push("Build at least one of the expected techniques");
  }
  for (const t of techniques) {
    if (t.built === 0) continue;
    for (const s of t.safeguards) {
      if (!s.seen) unmet.push(`${t.technique}: ${s.label}`);
    }
  }

  return { met: unmet.length === 0, unmet };
}

export function isGoalComplete(
  nodes: Array<{
    status: FrontierStatus;
    requiredByGoal: boolean;
    criteriaMet: boolean;
  }>,
  unsupported: string[],
): boolean {
  const required = nodes.filter((n) => n.requiredByGoal);
  return (
    nodes.length > 0 &&
    required.length > 0 &&
    unsupported.length === 0 &&
    nodes.every((n) => n.status === "demonstrated") &&
    required.every((n) => n.criteriaMet)
  );
}

export async function readFrontier(
  graph: Graph,
  developerId: string,
): Promise<FrontierNode[]> {
  return (await readFrontierChecked(graph, developerId)) ?? [];
}

export async function readFrontierChecked(
  graph: Graph,
  developerId: string,
): Promise<FrontierNode[] | null> {
  const result = await tryRows(graph, "goal frontier", FRONTIER_QUERY, {
    dev: developerId,
    satisfying: levelsInStates(PREREQUISITE_SATISFIED_BY),
    demonstrated: levelsInStates(["demonstrated"]),
  });
  if (!result) return null;

  const nodes: FrontierNode[] = result.map((r) => {
    const level = asLevel(r.level);
    const status = asStatus(r.status);
    const requiredByGoal = r.required_by_goal === true;

    const seenGoals = new Set<string>();
    const routes = mapList(r.routes).flatMap((route) => {
      const goalId = str(route.goal_id);
      if (!goalId || seenGoals.has(goalId)) return [];
      seenGoals.add(goalId);
      return [
        {
          goalCapabilityId: goalId,
          goalCapabilityName: str(route.goal_name),
          ids: strList(route.ids),
          names: strList(route.names),
        },
      ];
    });

    const node: FrontierNode = {
      capabilityId: str(r.capability_id),
      name: str(r.name),
      description: str(r.description),
      domain: str(r.domain),
      status,
      state: evidenceStateFor(level),
      level,
      evidenceCount: num(r.evidence_count),
      commitCount: num(r.commit_count),
      repoCount: num(r.repo_count),
      activeDays: num(r.active_days),
      firstSeen: str(r.first_seen),
      lastSeen: str(r.last_seen),
      recency: str(r.recency),
      requiredByGoal,
      priority: num(r.priority),
      reason: str(r.reason),
      criteriaMet: requiredByGoal ? false : status === "demonstrated",
      unmetCriteria: [],
      prerequisites: mapList(r.prereqs)
        .map((p) => {
          const pl = asLevel(p.level);
          return {
            capabilityId: str(p.id),
            name: str(p.name),
            level: pl,
            state: evidenceStateFor(pl),
            satisfied: p.met === true,
            evidenceCount: num(p.evidence),
            experiences: [] as ExperienceBrief[],
          };
        })
        .sort(byNameThenId),
      unlocks: [],
      routes,
    };

    const derived = deriveFrontierStatus(level, node.prerequisites);
    if (derived !== status) {
      log("frontier status mismatch", {
        capabilityId: node.capabilityId,
        cypher: status,
        derived,
      });
    }

    return node;
  });

  for (const node of nodes) {
    node.unlocks = nodes
      .filter((o) =>
        o.prerequisites.some((p) => p.capabilityId === node.capabilityId),
      )
      .map((o) => o.name)
      .sort((a, b) => a.localeCompare(b));
  }

  return nodes.sort(byNameThenId);
}

export function eligibleNextSteps(frontier: FrontierNode[]): FrontierNode[] {
  return frontier.filter((n) => n.status === "eligible");
}

export async function readDirections(
  graph: Graph,
  developerId: string,
): Promise<DirectionReadout[]> {
  await ensureJourneySchema(graph);

  const result = await tryRows(
    graph,
    "directions",
    `
    MATCH (d:Developer {id: $dev})
    OPTIONAL MATCH (d)-[done_edge:HAS_CAPABILITY]->(done_cap:Capability)
    WHERE done_edge.level IN $demonstrated
    WITH d, collect(done_cap.id) AS done

    MATCH (c:Capability)
    WHERE c.parent_id <> "" AND NOT c.id IN done
    OPTIONAL MATCH (c)-[:PREREQUISITE_OF*1..${MAX_PREREQUISITE_DEPTH}]->(later:Capability)
    WHERE later.id IN done
    WITH d, c, done, count(later) AS proven_later
    WHERE proven_later = 0

    OPTIONAL MATCH (d)-[hc:HAS_CAPABILITY]->(c)
    WITH d, c, coalesce(hc.level, "missing") AS lvl
    ${PREREQUISITE_CHECK("d, c, lvl")}
    WITH c, lvl, prereqs
    WHERE size([x IN prereqs WHERE NOT x.met]) = 0

    OPTIONAL MATCH (c)-[:PREREQUISITE_OF]->(nx:Capability)
    WITH c, lvl, prereqs, collect(DISTINCT nx.name) AS unlocks
    OPTIONAL MATCH (c)-[:SPECIALIZES]->(dom:Capability)
    RETURN c.id AS capability_id,
           c.name AS name,
           lvl AS level,
           coalesce(dom.id, "") AS domain_id,
           coalesce(dom.name, "") AS domain,
           prereqs,
           unlocks
    `,
    {
      dev: developerId,
      satisfying: levelsInStates(PREREQUISITE_SATISFIED_BY),
      demonstrated: levelsInStates(["demonstrated"]),
    },
  );

  const byDomain = new Map<string, DirectionReadout>();
  for (const r of result ?? []) {
    const domainId = str(r.domain_id);
    if (!domainId) continue;

    let direction = byDomain.get(domainId);
    if (!direction) {
      direction = { domainId, domain: str(r.domain), moves: [] };
      byDomain.set(domainId, direction);
    }

    const level = asLevel(r.level);
    const state = evidenceStateFor(level);
    direction.moves.push({
      capabilityId: str(r.capability_id),
      name: str(r.name),
      kind: state === "partial" ? "deepen" : "extend",
      state,
      level,
      builtOn: mapList(r.prereqs)
        .map((p) => ({
          id: str(p.id),
          name: str(p.name),
          level: asLevel(p.level),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      unlocks: strList(r.unlocks).sort((a, b) => a.localeCompare(b)),
    });
  }

  return [...byDomain.values()]
    .map((d) => ({
      ...d,
      moves: d.moves.sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          a.capabilityId.localeCompare(b.capabilityId),
      ),
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
}
