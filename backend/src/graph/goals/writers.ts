import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';

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
import READY_RANK = _readers.READY_RANK;
import readDepth = _readers.readDepth;
import readCoverage = _readers.readCoverage;
import readEvidence = _readers.readEvidence;
import readCode = _readers.readCode;
import personalizedPageRank = _readers.personalizedPageRank;
import buildGoalGraph = _readers.buildGoalGraph;
import briefForAgent = _readers.briefForAgent;
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

export async function writeBatch(
  graph: Graph,
  label: string,
  cypher: string,
  batch: Row[],
  params: Row = {},
): Promise<number> {
  if (!batch.length) return 0;
  const rows = await query(graph, label, cypher, { ...params, batch });
  return num(rows?.[0]?.n);
}

export async function storeNextMove(
  graph: Graph,
  result: GoalGraphResult,
  move: NextMoveInput,
): Promise<NextMoveStored> {
  const rejected: string[] = [];
  const dev = result.developerId;
  const goalId = `goal:${dev}:${slugify(result.wish) || "goal"}`;
  const nextMoveId = `nextmove:${goalId}`;
  const empty: NextMoveStored = {
    stored: false,
    goalId,
    nextMoveId,
    links: {
      targets: 0,
      focus: 0,
      leverages: 0,
      closesGap: 0,
      demonstrations: 0,
      fileChanges: 0,
      assessments: 0,
      capability: 0,
      startsAt: 0,
    },
    rejected,
  };
  if (!move.title.trim()) {
    rejected.push("NextMove has no title");
    return empty;
  }

  const topics = new Map(result.topics.map((t) => [t.slug, t]));
  const evidenceById = new Map(result.evidence.map((e) => [e.id, e]));

  const cited: EvidenceItem[] = [];
  for (const id of uniq(move.evidenceIds)) {
    const e = evidenceById.get(id);
    if (e) cited.push(e);
    else rejected.push(`unknown evidence id ${id}`);
  }
  const citedTopics = new Set(cited.map((e) => e.topicSlug));

  const known = (slug: string, role: string): boolean => {
    if (topics.has(slug)) return true;
    rejected.push(`${role} topic "${slug}" is not in the goal graph`);
    return false;
  };
  const focus =
    move.focusSlug && known(move.focusSlug, "focus") ? move.focusSlug : null;
  const strengths = uniq(move.strengthSlugs).filter((s) => {
    if (!known(s, "strength")) return false;
    if (!citedTopics.has(s)) {
      rejected.push(
        `strength "${s}" has no cited evidence, so it was not linked`,
      );
      return false;
    }
    return true;
  });
  const gaps = uniq(move.gapSlugs).filter((s) => known(s, "gap"));
  const seeds = result.resolution.seeds.map((s) => s.slug);
  const now = new Date().toISOString();

  // the target capability and starting file must come from this result too
  const capabilityId =
    move.capabilityId &&
    result.coverage.some((c) => c.capabilityId === move.capabilityId)
      ? move.capabilityId
      : null;
  if (move.capabilityId && !capabilityId)
    rejected.push(
      `capability "${move.capabilityId}" is not in the goal graph, so it was not linked`,
    );
  const startFileChangeId =
    move.startFileChangeId &&
    result.evidence.some((e) => e.fileChangeId === move.startFileChangeId)
      ? move.startFileChangeId
      : null;
  if (move.startFileChangeId && !startFileChangeId)
    rejected.push(
      `starting file "${move.startFileChangeId}" is not in the cited evidence, so it was not linked`,
    );

  const goalOk = await query(
    graph,
    "upsert goal",
    `
    MATCH (d:Developer {id: $dev})
    MERGE (g:Goal {id: $goal_id})
    SET g.developer_id = $dev, g.wish = $wish, g.resolved_by = $method,
        g.updated_at = $now
    MERGE (d)-[:HAS_GOAL]->(g)
    RETURN count(g) AS n
    `,
    {
      dev,
      goal_id: goalId,
      wish: result.wish,
      method: result.resolution.method,
      now,
    },
  );
  if (!goalOk || num(goalOk[0]?.n) === 0) {
    rejected.push("Developer node not found, nothing was written");
    return empty;
  }

  // replace the previous move of this goal
  await query(
    graph,
    "remove previous NextMove",
    `MATCH (:Goal {id: $goal_id})-[:PROPOSES]->(m:NextMove) DETACH DELETE m`,
    { goal_id: goalId },
  );
  const created = await query(
    graph,
    "create NextMove",
    `
    MATCH (g:Goal {id: $goal_id})
    MERGE (m:NextMove {id: $move_id})
    SET m.title = $title, m.summary = $summary, m.developer_id = $dev,
        m.created_at = $now, m.done_when = $done_when,
        m.details_json = $details
    MERGE (g)-[:PROPOSES]->(m)
    RETURN count(m) AS n
    `,
    {
      goal_id: goalId,
      move_id: nextMoveId,
      title: move.title.trim().slice(0, 200),
      summary: move.summary.trim().slice(0, 1200),
      done_when: (move.doneWhen ?? "").trim().slice(0, 400),
      details: JSON.stringify(move.details ?? {}).slice(0, 8000),
      dev,
      now,
    },
  );
  if (!created || num(created[0]?.n) === 0) return empty;

  const topicLink = (
    label: string,
    rel: string,
    from: "goal" | "move",
    list: string[],
  ) =>
    writeBatch(
      graph,
      label,
      `
      UNWIND $batch AS item
      MATCH (x:${from === "goal" ? "Goal {id: $goal_id}" : "NextMove {id: $move_id}"})
      MATCH (t:Topic {id: item.topic_id})
      MERGE (x)-[r:${rel}]->(t)
      RETURN count(r) AS n
      `,
      list.map((s) => ({ topic_id: topicId(s) })),
      { goal_id: goalId, move_id: nextMoveId },
    );

  const links = { ...empty.links };
  links.targets = await topicLink("TARGETS", "TARGETS", "goal", seeds);
  links.focus = await topicLink(
    "FOCUSES_ON",
    "FOCUSES_ON",
    "move",
    focus ? [focus] : [],
  );
  links.leverages = await topicLink(
    "LEVERAGES",
    "LEVERAGES",
    "move",
    strengths,
  );
  links.closesGap = await topicLink(
    "CLOSES_GAP_IN",
    "CLOSES_GAP_IN",
    "move",
    gaps,
  );

  const backedBy = (label: string, nodeLabel: string, batch: Row[]) =>
    writeBatch(
      graph,
      label,
      `
      UNWIND $batch AS item
      MATCH (m:NextMove {id: $move_id})
      MATCH (x:${nodeLabel} {id: item.id})
      MERGE (m)-[r:BACKED_BY]->(x)
      SET r.ref = item.ref
      RETURN count(r) AS n
      `,
      batch,
      { move_id: nextMoveId },
    );
  links.demonstrations = await backedBy(
    "BACKED_BY Demonstration",
    "Demonstration",
    cited.map((e) => ({ id: e.demonstrationId, ref: e.id })),
  );
  links.fileChanges = await backedBy(
    "BACKED_BY FileChange",
    "FileChange",
    cited
      .filter((e) => e.fileChangeId)
      .map((e) => ({ id: e.fileChangeId, ref: e.id })),
  );
  links.assessments = await backedBy(
    "BACKED_BY DepthAssessment",
    "DepthAssessment",
    strengths.map((s) => ({ id: assessmentId(dev, s), ref: s })),
  );

  // the capability the move advances, and the code it starts from
  const single = (
    label: string,
    rel: string,
    nodeLabel: string,
    id: string | null,
  ) =>
    id
      ? writeBatch(
          graph,
          label,
          `
          UNWIND $batch AS item
          MATCH (m:NextMove {id: $move_id})
          MATCH (x:${nodeLabel} {id: item.id})
          MERGE (m)-[r:${rel}]->(x)
          RETURN count(r) AS n
          `,
          [{ id }],
          { move_id: nextMoveId },
        )
      : Promise.resolve(0);
  links.capability = await single(
    "ADVANCES",
    "ADVANCES",
    "Capability",
    capabilityId,
  );
  links.startsAt = await single(
    "STARTS_AT",
    "STARTS_AT",
    "FileChange",
    startFileChangeId,
  );

  if (links.demonstrations < cited.length)
    rejected.push(
      `${cited.length - links.demonstrations} cited demonstration(s) no longer exist in the graph`,
    );
  log("next move stored", { nextMoveId, ...links, rejected: rejected.length });
  return { stored: true, goalId, nextMoveId, links, rejected };
}
}
