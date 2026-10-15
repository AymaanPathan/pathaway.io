import type { Graph } from "../../db/falkordb.js";

import { Domain as _constants } from "./constants.js";
import { Domain as _helpers } from "./helpers.js";
import { Domain as _queries } from "./queries.js";
import { Domain as _types } from "./types.js";
import { Domain as _writers } from "./writers.js";

export namespace Domain {
  import LOG_PREFIX = _constants.LOG_PREFIX;
  import LEVELS = _constants.LEVELS;
  import levelRank = _constants.levelRank;
  import log = _helpers.log;
  import str = _helpers.str;
  import num = _helpers.num;
  import numOrNull = _helpers.numOrNull;
  import round = _helpers.round;
  import uniq = _helpers.uniq;
  import slugify = _helpers.slugify;
  import parseList = _helpers.parseList;
  import parseObjects = _helpers.parseObjects;
  import query = _helpers.query;
  import asLevel = _helpers.asLevel;
  import STOPWORDS = _helpers.STOPWORDS;
  import wishTokens = _helpers.wishTokens;
  import phraseVariants = _helpers.phraseVariants;
  import tokenCoverage = _helpers.tokenCoverage;
  import seedFrom = _helpers.seedFrom;
  import resolveSeeds = _helpers.resolveSeeds;
  import MAX_HOPS = _helpers.MAX_HOPS;
  import MAX_TOPICS = _helpers.MAX_TOPICS;
  import MAX_EVIDENCE = _helpers.MAX_EVIDENCE;
  import EVIDENCE_PER_TOPIC = _helpers.EVIDENCE_PER_TOPIC;
  import linkKey = _helpers.linkKey;
  import expandTopics = _helpers.expandTopics;
  import MISSING_DEPTH = _helpers.MISSING_DEPTH;
  import MAX_CODE = _helpers.MAX_CODE;
  import CODE_CHARS = _helpers.CODE_CHARS;
  import excerptAround = _helpers.excerptAround;
  import K = _helpers.K;
  import buildContext = _helpers.buildContext;
  import buildSignals = _helpers.buildSignals;
  import clarificationSuggestions = _helpers.clarificationSuggestions;
  import topicId = _helpers.topicId;
  import assessmentId = _helpers.assessmentId;
  import Row = _types.Row;
  import DepthLevel = _types.DepthLevel;
  import GraphOperation = _types.GraphOperation;
  import Approach = _types.Approach;
  import DeveloperDepth = _types.DeveloperDepth;
  import TopicRole = _types.TopicRole;
  import GraphTopic = _types.GraphTopic;
  import TopicLink = _types.TopicLink;
  import CapabilityCoverage = _types.CapabilityCoverage;
  import EvidenceItem = _types.EvidenceItem;
  import CodeContext = _types.CodeContext;
  import ContextKind = _types.ContextKind;
  import ContextNode = _types.ContextNode;
  import ContextEdge = _types.ContextEdge;
  import Signal = _types.Signal;
  import ResolutionMethod = _types.ResolutionMethod;
  import Resolution = _types.Resolution;
  import GoalGraphResult = _types.GoalGraphResult;
  import GoalGraphInput = _types.GoalGraphInput;
  import SeedRow = _types.SeedRow;
  import NextMoveInput = _types.NextMoveInput;
  import NextMoveStored = _types.NextMoveStored;
  import writeBatch = _writers.writeBatch;
  import storeNextMove = _writers.storeNextMove;

  export const READY_RANK = 2;

  export async function readDepth(
    graph: Graph,
    developerId: string,
    slugs: string[],
  ): Promise<Map<string, DeveloperDepth> | null> {
    const [assess, approaches] = await Promise.all([
      query(
        graph,
        "depth assessments",
        `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[:OF_TOPIC]->(t:Topic)
      WHERE t.slug IN $slugs
      RETURN t.slug AS slug, a.level AS level, a.score AS score,
             coalesce(a.confidence, "") AS confidence,
             coalesce(a.authenticity, "") AS authenticity,
             coalesce(a.verdict, "") AS verdict,
             coalesce(a.strengths_json, "[]") AS strengths,
             coalesce(a.gaps_json, "[]") AS gaps,
             coalesce(a.files, 0) AS files, coalesce(a.commits, 0) AS commits,
             coalesce(a.repos, 0) AS repos, coalesce(a.last_seen, "") AS last_seen,
             coalesce(a.safeguards_json, "[]") AS safeguards,
             coalesce(a.implementations_json, "[]") AS implementations,
             coalesce(a.rationale, "") AS rationale
      `,
        { dev: developerId, slugs },
      ),
      query(
        graph,
        "depth approaches",
        `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[u:USES_APPROACH]->(ap:Approach)
      WHERE a.topic_slug IN $slugs
      RETURN a.topic_slug AS slug, ap.name AS name,
             coalesce(u.is_primary, false) AS is_primary,
             coalesce(u.depth, "") AS depth,
             coalesce(u.how_implemented, "") AS how
      ORDER BY coalesce(u.depth_rank, 0) DESC
      `,
        { dev: developerId, slugs },
      ),
    ]);
    if (assess === null) return null;
    const byTopic = new Map<string, Approach[]>();
    for (const r of approaches ?? []) {
      const list = byTopic.get(str(r.slug)) ?? [];
      list.push({
        name: str(r.name),
        isPrimary: r.is_primary === true || r.is_primary === "true",
        depth: asLevel(r.depth),
        howImplemented: str(r.how).slice(0, 400),
      });
      byTopic.set(str(r.slug), list);
    }
    const out = new Map<string, DeveloperDepth>();
    for (const r of assess) {
      const slug = str(r.slug);
      out.set(slug, {
        assessed: true,
        level: asLevel(r.level),
        score: numOrNull(r.score),
        confidence: str(r.confidence),
        authenticity: str(r.authenticity),
        verdict: str(r.verdict).slice(0, 400),
        strengths: parseList(r.strengths).slice(0, 5),
        gaps: parseList(r.gaps).slice(0, 5),
        files: num(r.files),
        commits: num(r.commits),
        repos: num(r.repos),
        lastSeen: str(r.last_seen),
        approaches: (byTopic.get(slug) ?? []).slice(0, 4),
        safeguards: parseList(r.safeguards).slice(0, 6),
        built: parseObjects(r.implementations)
          .slice(0, 5)
          .map((o) => ({ what: str(o.what).slice(0, 200), path: str(o.path) })),
        rationale: str(r.rationale).slice(0, 400),
      });
    }
    return out;
  }

  export async function readCoverage(
    graph: Graph,
    developerId: string,
    slugs: string[],
  ): Promise<CapabilityCoverage[] | null> {
    const rows = await query(
      graph,
      "capability coverage",
      `
    MATCH (t:Topic)-[m:MAPS_TO]->(c:Capability)
    WHERE t.slug IN $slugs
    OPTIONAL MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c)
    RETURN t.slug AS slug, c.id AS id, coalesce(c.name, c.id) AS name,
           coalesce(m.weight, 0.5) AS weight, count(DISTINCT x) AS demos
    `,
      { dev: developerId, slugs },
    );
    if (rows === null) return null;
    return rows.map((r) => ({
      topicSlug: str(r.slug),
      capabilityId: str(r.id),
      capability: str(r.name),
      weight: Math.max(0.1, Math.min(1, num(r.weight, 0.5))),
      demonstrations: num(r.demos),
    }));
  }

  export async function readEvidence(
    graph: Graph,
    developerId: string,
    slugs: string[],
  ): Promise<EvidenceItem[] | null> {
    if (!slugs.length) return [];
    const rows = await query(
      graph,
      "evidence chain",
      `
    MATCH (t:Topic)-[:MAPS_TO]->(c:Capability)
    WHERE t.slug IN $slugs
    MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c)
    OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
    OPTIONAL MATCH (x)-[:EVIDENCED_BY]->(fc:FileChange)
    RETURN t.slug AS slug, c.id AS capability_id, coalesce(c.name, c.id) AS capability,
           x.id AS id,
           coalesce(x.technique, "") AS technique,
           coalesce(x.summary, "") AS summary,
           coalesce(x.depth, "") AS depth,
           coalesce(x.depth_rank, 0) AS depth_rank,
           coalesce(r.full_name, r.name, "") AS repository,
           coalesce(x.path, "") AS path,
           coalesce(x.commit_sha, "") AS commit_sha,
           coalesce(x.commit_subject, "") AS commit_subject,
           coalesce(x.permalink, "") AS permalink,
           coalesce(fc.id, "") AS file_change_id,
           coalesce(x.modifiers, "") AS modifiers,
           coalesce(fc.is_test, false) AS is_test
    ORDER BY depth_rank DESC
    LIMIT 400
    `,
      { dev: developerId, slugs },
    );
    if (rows === null) return null;
    const seen = new Set<string>();
    const perTopic = new Map<string, number>();
    const items: EvidenceItem[] = [];
    for (const r of rows) {
      if (items.length >= MAX_EVIDENCE) break;
      const slug = str(r.slug);
      const key = `${slug}|${str(r.id)}`;
      if (seen.has(key)) continue;
      if ((perTopic.get(slug) ?? 0) >= EVIDENCE_PER_TOPIC) continue;
      seen.add(key);
      perTopic.set(slug, (perTopic.get(slug) ?? 0) + 1);
      items.push({
        id: `E${items.length + 1}`,
        topicSlug: slug,
        capabilityId: str(r.capability_id),
        capability: str(r.capability),
        demonstrationId: str(r.id),
        technique: str(r.technique),
        summary: str(r.summary).slice(0, 300),
        depth: str(r.depth),
        repository: str(r.repository),
        path: str(r.path),
        commitSha: str(r.commit_sha),
        commitSubject: str(r.commit_subject).slice(0, 160),
        permalink: str(r.permalink),
        fileChangeId: str(r.file_change_id),
        hardening: str(r.modifiers)
          .split(" | ")
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 6),
        isTest: r.is_test === true || r.is_test === "true",
      });
    }
    return items;
  }

  export async function readCode(
    graph: Graph,
    evidence: EvidenceItem[],
    seedSlugs: Set<string>,
  ): Promise<CodeContext[] | null> {
    const usable = evidence.filter((e) => !e.isTest && e.fileChangeId);
    const ordered = [
      ...usable.filter((e) => seedSlugs.has(e.topicSlug)),
      ...usable.filter((e) => !seedSlugs.has(e.topicSlug)),
    ];
    const perTopic = new Map<string, number>();
    const picked: EvidenceItem[] = [];
    for (const e of ordered) {
      if (picked.length >= MAX_CODE) break;
      const n = perTopic.get(e.topicSlug) ?? 0;
      if (n >= 2) continue;
      perTopic.set(e.topicSlug, n + 1);
      picked.push(e);
    }
    if (!picked.length) return [];
    const [codeRows, snippetRows] = await Promise.all([
      query(
        graph,
        "evidence code",
        `MATCH (fc:FileChange) WHERE fc.id IN $ids
       RETURN fc.id AS id, coalesce(fc.added_code, "") AS code`,
        { ids: uniq(picked.map((e) => e.fileChangeId)) },
      ),
      query(
        graph,
        "evidence snippets",
        `MATCH (x:Demonstration) WHERE x.id IN $ids
       RETURN x.id AS id, coalesce(x.snippet, "") AS snippet`,
        { ids: uniq(picked.map((e) => e.demonstrationId)) },
      ),
    ]);
    if (codeRows === null) return null;
    const codeBy = new Map(
      codeRows.map((r) => [str(r.id), String(r.code ?? "")]),
    );
    const snippetBy = new Map(
      (snippetRows ?? []).map((r) => [
        str(r.id),
        String(r.snippet ?? "").trim(),
      ]),
    );
    const out: CodeContext[] = [];
    for (const e of picked) {
      const excerpt = excerptAround(
        codeBy.get(e.fileChangeId) ?? "",
        snippetBy.get(e.demonstrationId) ?? "",
      );
      if (excerpt.length >= 40)
        out.push({ evidenceId: e.id, path: e.path, excerpt });
    }
    return out;
  }

  export function personalizedPageRank(
    nodes: string[],
    edges: Array<{ from: string; to: string; weight: number }>,
    restart: string[],
    options: { damping?: number; iterations?: number; tolerance?: number } = {},
  ): Map<string, number> {
    const damping = options.damping ?? 0.85;
    const iterations = options.iterations ?? 80;
    const tolerance = options.tolerance ?? 1e-9;

    const adj = new Map<string, Array<[string, number]>>();
    const outSum = new Map<string, number>();
    for (const n of nodes) {
      adj.set(n, []);
      outSum.set(n, 0);
    }
    for (const e of edges) {
      if (!adj.has(e.from) || !adj.has(e.to) || e.weight <= 0) continue;
      adj.get(e.from)!.push([e.to, e.weight]);
      adj.get(e.to)!.push([e.from, e.weight]);
      outSum.set(e.from, (outSum.get(e.from) ?? 0) + e.weight);
      outSum.set(e.to, (outSum.get(e.to) ?? 0) + e.weight);
    }

    const start = restart.filter((r) => adj.has(r));
    const r0 = new Map<string, number>(
      (start.length ? start : nodes).map((n) => [
        n,
        1 / (start.length || nodes.length || 1),
      ]),
    );

    let score = new Map<string, number>(r0);
    for (let i = 0; i < iterations; i++) {
      const next = new Map<string, number>();
      let dangling = 0;
      for (const n of nodes) {
        const p = score.get(n) ?? 0;
        const total = outSum.get(n) ?? 0;
        if (total === 0) {
          dangling += p;
          continue;
        }
        for (const [m, w] of adj.get(n) ?? []) {
          next.set(m, (next.get(m) ?? 0) + damping * p * (w / total));
        }
      }
      let diff = 0;
      for (const n of nodes) {
        const restartMass = r0.get(n) ?? 0;
        const v =
          (next.get(n) ?? 0) + restartMass * (1 - damping + damping * dangling);
        diff += Math.abs(v - (score.get(n) ?? 0));
        next.set(n, v);
      }
      score = next;
      if (diff < tolerance) break;
    }
    return score;
  }

  export async function buildGoalGraph(
    graph: Graph,
    input: GoalGraphInput,
  ): Promise<GoalGraphResult> {
    const { developerId } = input;
    const wish = input.wish.trim();
    const operations: GraphOperation[] = [];

    // ---- 1. START ----
    const resolution = await resolveSeeds(
      graph,
      { ...input, wish },
      operations,
    );
    if (resolution.needsClarification) {
      return {
        developerId,
        wish,
        resolution,
        topics: [],
        links: [],
        coverage: [],
        evidence: [],
        context: { nodes: [], edges: [] },
        ranking: [],
        signals: { strengths: [], unproven: [], opportunities: [] },
        operations,
        code: [],
        previousMove: null,
        clarification: {
          reason: `"${wish}" could not be tied to any topic in your knowledge graph reliably.`,
          suggestions: await clarificationSuggestions(graph, developerId),
        },
        truncated: false,
      };
    }
    const seeds = resolution.seeds.map((s) => s.slug);

    // ---- 2. EXPAND ----
    const { places, links: allLinks } = await expandTopics(
      graph,
      seeds,
      operations,
    );
    const ordered = [...places.entries()]
      .sort((a, b) => a[1].hops - b[1].hops)
      .map(([s]) => s);
    const truncated = ordered.length > MAX_TOPICS;
    const slugs = ordered.slice(0, MAX_TOPICS);
    const inScope = new Set(slugs);
    const links = allLinks.filter((l) => inScope.has(l.a) && inScope.has(l.b));

    let t0 = Date.now();
    const [topicRows, depth, coverageRows, evidenceRows] = await Promise.all([
      query(
        graph,
        "topic details",
        `
      MATCH (t:Topic)
      WHERE t.slug IN $slugs
      RETURN t.slug AS slug, t.name AS name, coalesce(t.domain, "") AS domain,
             coalesce(t.description, "") AS description,
             t.foundation_rank AS pr, t.cluster_id AS cl
      `,
        { slugs },
      ),
      readDepth(graph, developerId, slugs),
      readCoverage(graph, developerId, slugs),
      readEvidence(graph, developerId, slugs),
    ]);
    const readMs = Date.now() - t0;
    const coverage = coverageRows ?? [];
    const evidence = evidenceRows ?? [];
    const detail = new Map((topicRows ?? []).map((r) => [str(r.slug), r]));
    const present = slugs.filter((s) => detail.has(s));

    const assessedCount = present.filter((s) => depth?.has(s)).length;
    operations.push({
      id: "depth",
      kind: "cypher",
      purpose:
        "Read Developer -> DepthAssessment -> Topic for every topic in the neighbourhood (level, authenticity, approaches, gaps).",
      status: depth === null ? "failed" : assessedCount ? "ok" : "empty",
      result: `${present.length} topic(s); ${assessedCount} assessed, ${present.length - assessedCount} with no assessment.`,
      durationMs: readMs,
    });
    operations.push({
      id: "evidence",
      kind: "cypher",
      purpose:
        "Trace Topic -> Capability <- Demonstration -> FileChange / Repository, and count demonstrations per mapped capability.",
      status:
        evidenceRows === null ? "failed" : evidence.length ? "ok" : "empty",
      result: `${evidence.length} demonstration(s) across ${uniq(evidence.map((e) => e.repository).filter(Boolean)).length} repositor(ies); ${coverage.length} topic-capability mapping(s), ${coverage.filter((c) => c.demonstrations === 0).length} with no demonstration.`,
      durationMs: readMs,
    });

    // ---- 3. RANK ----
    t0 = Date.now();
    const draftTopics = present.map((slug) => ({
      slug,
      name: str(detail.get(slug)?.name, slug),
      depth: depth?.get(slug) ?? MISSING_DEPTH,
    }));
    const context = buildContext(draftTopics, links, coverage, evidence);
    const ppr = personalizedPageRank(
      context.nodes.map((n) => n.key),
      context.edges,
      seeds.map(K.topic),
    );
    for (const n of context.nodes) n.score = round(ppr.get(n.key) ?? 0, 6);
    const maxTopicScore = Math.max(
      1e-12,
      ...context.nodes.filter((n) => n.kind === "topic").map((n) => n.score),
    );
    const ranking = [...context.nodes]
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, 25);
    operations.push({
      id: "ppr",
      kind: "personalized_pagerank",
      purpose:
        "Rank the retrieved subgraph by closeness to the seed topics (restart on seeds). Orders context for the agent; it does not choose the goal.",
      status: context.nodes.length ? "ok" : "empty",
      result: `${context.nodes.length} node(s), ${context.edges.length} edge(s); top: ${ranking
        .slice(0, 3)
        .map((n) => n.label)
        .join(", ")}.`,
      durationMs: Date.now() - t0,
    });

    const topics: GraphTopic[] = present.map((slug) => {
      const r = detail.get(slug) as Row;
      const place = places.get(slug) as { role: TopicRole; hops: number };
      return {
        slug,
        name: str(r.name, slug),
        domain: str(r.domain),
        description: str(r.description).slice(0, 240),
        role: place.role,
        hops: place.hops,
        foundationRank: numOrNull(r.pr),
        clusterId: numOrNull(r.cl),
        relevance: round((ppr.get(K.topic(slug)) ?? 0) / maxTopicScore, 3),
        depth: depth?.get(slug) ?? MISSING_DEPTH,
      };
    });

    // ---- 3b. CODE + PREVIOUS MOVE (provider data for the agent) ----
    t0 = Date.now();
    const codeRows = await readCode(graph, evidence, new Set(seeds));
    const code = codeRows ?? [];
    operations.push({
      id: "code",
      kind: "cypher",
      purpose:
        "Read the code behind the strongest evidence (FileChange.added_code) so the agent works from what was actually built.",
      status: codeRows === null ? "failed" : code.length ? "ok" : "empty",
      result: `${code.length} code excerpt(s) for ${evidence.length} demonstration(s).`,
      durationMs: Date.now() - t0,
    });
    const prevRows = await query(
      graph,
      "previous move",
      `MATCH (:Goal {id: $goal_id})-[:PROPOSES]->(m:NextMove)
     RETURN m.title AS title, coalesce(m.done_when, "") AS done_when LIMIT 1`,
      { goal_id: `goal:${developerId}:${slugify(wish) || "goal"}` },
    );
    const previousMove = prevRows?.[0]
      ? { title: str(prevRows[0].title), doneWhen: str(prevRows[0].done_when) }
      : null;

    // ---- 4. SIGNALS ----
    const seedDomains = new Set(
      resolution.seeds.map((s) => s.domain.toLowerCase()).filter(Boolean),
    );
    const signals = buildSignals(topics, links, coverage, evidence, {
      domains: seedDomains,
      // a whole-area wish spans domains; a specific topic should stay in its area
      strict: resolution.method !== "domain" && seedDomains.size > 0,
    });

    log("goal graph built", {
      method: resolution.method,
      seeds: seeds.length,
      topics: topics.length,
      links: links.length,
      evidence: evidence.length,
      nodes: context.nodes.length,
      strengths: signals.strengths.length,
      unproven: signals.unproven.length,
      opportunities: signals.opportunities.length,
    });

    return {
      developerId,
      wish,
      resolution,
      topics,
      links,
      coverage,
      evidence,
      context,
      ranking,
      signals,
      operations,
      code,
      previousMove,
      clarification: null,
      truncated,
    };
  }

  export function briefForAgent(result: GoalGraphResult): Row {
    const name = (slug: string) =>
      result.topics.find((t) => t.slug === slug)?.name ?? slug;
    const codeIds = new Set(result.code.map((c) => c.evidenceId));

    const groups = new Map<number, string[]>();
    for (const t of result.topics) {
      if (t.clusterId == null) continue;
      groups.set(t.clusterId, [...(groups.get(t.clusterId) ?? []), t.name]);
    }

    return {
      goal: result.wish,
      howToUse:
        "This is data read from the developer's knowledge graph. The graph does not choose anything: you decide the next move. Cite evidence ids (E1...) for every claim about what the developer has built. Use only topic slugs, capability ids and evidence ids listed here. 'relevance' is Personalized PageRank closeness to the goal and only orders the data. A capability with 0 demonstrations means no evidence was found, not that the developer cannot do it.",
      resolvedBy: {
        method: result.resolution.method,
        confidence: result.resolution.confidence,
        seeds: result.resolution.seeds.map((s) => s.slug),
      },
      topics: result.topics.slice(0, 40).map((t) => ({
        slug: t.slug,
        name: t.name,
        domain: t.domain,
        role: t.role,
        hops: t.hops,
        relevance: t.relevance,
        assessed: t.depth.assessed,
        level: t.depth.level,
        authenticity: t.depth.authenticity || null,
        confidence: t.depth.confidence || null,
        files: t.depth.files,
        commits: t.depth.commits,
        repos: t.depth.repos,
        lastSeen: t.depth.lastSeen || null,
        strengths: t.depth.strengths,
        gaps: t.depth.gaps,
        verdict: t.depth.verdict || null,
        rationale: t.depth.rationale || null,
        safeguards: t.depth.safeguards,
        built: t.depth.built,
        approaches: t.depth.approaches.map((a) => ({
          name: a.name,
          primary: a.isPrimary,
          depth: a.depth,
          how: a.howImplemented,
        })),
      })),
      relatedTopics: result.links
        .filter((l) => l.type === "RELATED_TOPIC")
        .slice(0, 60)
        .map((l) => ({
          a: name(l.a),
          b: name(l.b),
          reason: l.reason || undefined,
        })),
      groups: [...groups.entries()]
        .filter(([, names]) => names.length > 1)
        .map(([id, names]) => ({ group: id, topics: names.slice(0, 12) })),
      capabilities: result.coverage.slice(0, 60).map((c) => ({
        id: c.capabilityId,
        name: c.capability,
        topic: c.topicSlug,
        weight: c.weight,
        demonstrations: c.demonstrations,
      })),
      evidence: result.evidence.map((e) => ({
        id: e.id,
        topic: e.topicSlug,
        capability: e.capability,
        capabilityId: e.capabilityId,
        repository: e.repository,
        path: e.path,
        technique: e.technique,
        summary: e.summary,
        depth: e.depth,
        hardening: e.hardening,
        commit: e.commitSubject,
        hasCode: codeIds.has(e.id),
      })),
      signals: {
        note: "pre-computed facts about the neighbourhood, not recommendations",
        strengths: result.signals.strengths.map((s) => s.name),
        unproven: result.signals.unproven.map((s) => ({
          name: s.name,
          reasons: s.reasons,
        })),
        nearStrengths: result.signals.opportunities.map((s) => ({
          name: s.name,
          nearStrengths: s.nearStrengths,
        })),
      },
      previousMove: result.previousMove,
      code: result.code,
    };
  }
}
