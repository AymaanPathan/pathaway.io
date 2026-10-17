import type { Graph } from "../db/falkordb.js";
import { cerebras, CEREBRAS_MODEL } from "../ai-models/cerebras.js";
import { listTopicCatalog } from "../graph/depth-analyzer-graph.js";
import {
  briefForAgent,
  buildGoalGraph,
  storeNextMove,
  type EvidenceItem,
  type GoalGraphResult,
  type NextMoveStored,
  type Resolution,
} from "../graph/goal-graph.js";

type Row = Record<string, any>;

const LOG_PREFIX = "[goal-agent]";
function log(message: string, detail?: Row): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

const str = (v: unknown, fallback = ""): string =>
  v == null || typeof v === "object" ? fallback : String(v).trim();
const uniq = <T>(items: T[]): T[] => [...new Set(items)];
const clip = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
const strList = (v: unknown, max = 6): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => str(x))
    .filter(Boolean)
    .slice(0, max);

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  json?: boolean;
  signal?: AbortSignal;
}
export interface LlmClient {
  complete(req: LlmRequest): Promise<string>;
}

export function cerebrasClient(): LlmClient {
  const call = async (req: LlmRequest, json: boolean): Promise<string> => {
    const response = await cerebras.chat.completions.create(
      {
        model: CEREBRAS_MODEL,
        temperature: 0.3,
        max_tokens: req.maxTokens,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        ...(json ? { response_format: { type: "json_object" } } : {}),
      },
      { signal: req.signal },
    );
    const content = response.choices[0]?.message?.content;
    return typeof content === "string" ? content : "";
  };
  return {
    async complete(req: LlmRequest): Promise<string> {
      try {
        const out = await call(req, Boolean(req.json));
        if (out.trim() || !req.json) return out;

        return await call(req, false);
      } catch (error) {
        if (req.json && /response_format|json/i.test(String(error)))
          return call(req, false);
        throw error;
      }
    },
  };
}

async function callLlm(
  llm: LlmClient,
  req: Omit<LlmRequest, "signal">,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await llm.complete({ ...req, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function extractJson(text: string): Row | null {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const body = cleaned.slice(start, end + 1);
  for (const candidate of [body, body.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Row;
    } catch {}
  }
  return null;
}

export interface Decision {
  focusSlug: string;
  capabilityId: string | null;
  /** the approach of the focus topic this move changes; null when it adds an approach not yet built */
  approachSlug: string | null;
  /** what the graph shows, what the agent infers, and what has no evidence */
  basis: { observed: string; inferred: string; missing: string };

  buildsOnSlugs: string[];

  gapSlugs: string[];
  why: string;
  evidenceIds: string[];

  considered: Array<{ option: string; whyNot: string }>;
}

interface Draft {
  decision: Decision;
  challenge: {
    mechanism: string;
    existingEvidenceId: string;
    observedInCode: string;
    limitation: string;
  };
  task: {
    objective: string;
    startPath: string;
    steps: string[];
    doneWhen: string;
  };
}

export interface PlannedTask {
  title: string;
  decision: Decision;
  challenge: Draft["challenge"];
  startingPoint: {
    repository: string;
    path: string;
    permalink: string;
    commit: string;
  };
  steps: string[];

  doneWhen: string;
  why: string;
  focus: { slug: string; name: string; domain: string; level: string };
  /** the assessed approach this move builds on, with its own depth and authenticity */
  approach: {
    slug: string;
    name: string;
    depth: string;
    authenticity: string;
  } | null;
  targetCapability: { id: string; name: string } | null;
  evidence: Array<{
    id: string;
    repository: string;
    path: string;
    technique: string;
    depth: string;
    commit: string;
    permalink: string;
  }>;
  evidenceIds: string[];
  strengthSlugs: string[];
  gapSlugs: string[];
}

export interface GoalPlan {
  status:
    | "planned"
    | "needs_clarification"
    | "needs_evidence"
    | "generation_failed"
    | "llm_unavailable";
  wish: string;
  resolution: Resolution;
  task: PlannedTask | null;
  source: "llm" | "llm_repaired" | "none";
  stored: NextMoveStored | null;
  clarification:
    | GoalGraphResult["clarification"]
    | { reason: string; suggestions: [] }
    | null;

  errors: string[];

  graph: {
    seeds: string[];
    topics: number;
    evidence: number;
    codeExcerpts: number;
    operations: GoalGraphResult["operations"];

    topicNodes: Array<{
      slug: string;
      name: string;
      domain: string;
      role: string;
      hops: number;
      relevance: number;
      level: string;
      assessed: boolean;
      authenticity: string;
    }>;

    links: GoalGraphResult["links"];

    context: GoalGraphResult["context"];

    ranking: GoalGraphResult["ranking"];
  } | null;
  llmCalls: number;
  timingsMs: { graph: number; llm: number; store: number; total: number };
  notes: string[];
}

export interface PlanGoalInput {
  developerId: string;
  wish: string;
  goalTopics?: string[];
  persist?: boolean;
  timeoutMs?: number;
}

const SYSTEM = `You are the decision maker of a developer-growth agent. A knowledge graph gives you DATA about one developer: topics, related topics, groups of topics, assessed depth, what they built, safeguards, capabilities with demonstration counts, and real code. The graph never chooses. You do.

Your job: decide the ONE next engineering move that moves this developer toward their goal, then turn it into a concrete task.

How to decide:
1. Read what the developer has actually built (evidence + code) and how deep it is.
2. Look at related topics, groups and capabilities for the real options: deepen a mechanism they already built, add a capability that is missing, or extend into a related topic.
3. Weigh at least two options against each other. Prefer a move that builds on something they proved, targets a concrete limitation you can see in their code, and is a real step forward.
4. Do NOT choose because a number is high (files, commits, repos, relevance). Those only describe volume.
5. "0 demonstrations" or "not assessed" means no evidence was found. It is NOT a proven weakness.
6. The developer named a topic (see resolvedBy.seeds). Your focusSlug MUST be one of those seed topics, unless resolvedBy.method is "domain". Related topics are context: use them in buildsOnSlugs or gapSlugs, never as the focus. Evidence with no capability or technique is still real authored code: you may start from it.
7. Reason approach by approach. Each topic lists its approaches with their own depth, authenticity, hardening and gaps. The overall topic level hides this: a developer can be deep in one approach and have none in another. Pick the approach your move changes (decision.approachSlug, copied from the data) or, when the move adds an approach the developer has not built, set it to null and say which approach is absent in basis.missing. Evidence items list the approaches they demonstrate; prefer evidence linked to the approach you are changing.
8. Separate what you know. basis.observed: what the data and code show, citing evidence ids. basis.inferred: what you conclude from it. basis.missing: what has no evidence yet. Missing evidence is not proof of weakness; never state a weakness as fact unless the code shows it.
9. completedMoves lists missions this developer already verified on these topics. Do not repeat or lightly reword one.

Reply with JSON only, exactly this shape:
{
 "decision": {
  "focusSlug": "<topic slug from the data>",
  "capabilityId": "<capability id from the data or null>",
  "approachSlug": "<approach slug of the focus topic from the data that this move changes, or null when adding a new approach>",
  "buildsOnSlugs": ["<proven topic slugs this builds on>"],
  "gapSlugs": ["<topic slugs whose gap this closes, may be empty>"],
  "why": "<2-3 sentences: why THIS move, citing evidence ids like E4>",
  "evidenceIds": ["E#", "..."],
  "basis": {"observed": "<what the data and code show, citing E# ids>", "inferred": "<what you conclude from it>", "missing": "<what has no evidence yet, or empty>"},
  "considered": [{"option": "<alternative you weighed>", "whyNot": "<why you did not take it>"}]
 },
 "challenge": {
  "mechanism": "<the exact mechanism being changed or added, one sentence>",
  "existingEvidenceId": "<E# of code you are starting from; must have code in CODE>",
  "observedInCode": "<VERBATIM fragment, 12-140 chars, copied from that evidence's code>",
  "limitation": "<what that code does not do yet that matters, 1-2 sentences, behaviour not 'no tests'>"
 },
 "task": {
  "objective": "<starts with a verb, 12-120 chars, names the specific mechanism>",
  "startPath": "<exactly the path of existingEvidenceId>",
  "steps": ["<3 to 5 specific steps; step 1 opens startPath and names functions/behaviour from the code>"],
  "doneWhen": "<ONE observable condition a test, command or review can check>"
 }
}
Rules:
- Use only slugs, capability ids and evidence ids that appear in the data. Every slug in buildsOnSlugs needs at least one of its evidence ids in decision.evidenceIds.
- Do not invent files, functions or capabilities. Only reference code shown in CODE.
- Do not repeat something already built (see evidence techniques), the previousMove or a completedMoves entry. Compare your move against at least one alternative in decision.considered and say why this mechanism is the better step.
- Forbidden phrases: "one level deeper", "add a test for the new case", "close this gap", "best practices", generic refactors.`;

function renderUser(brief: Row): string {
  const { code, ...data } = brief;
  const blocks = (
    code as Array<{ evidenceId: string; path: string; excerpt: string }>
  )
    .map((c) => `[${c.evidenceId}] ${c.path}\n\`\`\`\n${c.excerpt}\n\`\`\``)
    .join("\n\n");
  return `DATA:\n${JSON.stringify(data)}\n\nCODE (the only code you may quote):\n${blocks || "(none)"}`;
}

const GENERIC =
  /one level deeper|add a test for the new case|close this gap|best practices?|refactor for (clarity|readability)|improve (the )?(error handling|performance|code quality)/i;
const CHECKABLE =
  /\b(test|asserts?|returns?|responds?|status|header|logs?|emits?|throws?|rejects?|retries|retried|fails?|passes|exits?|calls?|equals?|within|at most|at least|exactly)\b/i;
const PATH_TOKEN = /[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,6}/g;

function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/&/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}
export function nearDuplicate(a: string, b: string): boolean {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  return shared / Math.min(A.size, B.size) >= 0.8;
}

function readDraft(raw: Row | null): Draft | null {
  if (!raw) return null;
  const d = (raw.decision ?? {}) as Row;
  const c = (raw.challenge ?? {}) as Row;
  const t = (raw.task ?? {}) as Row;
  const considered = (Array.isArray(d.considered) ? d.considered : [])
    .map((x: Row) => ({ option: str(x?.option), whyNot: str(x?.whyNot) }))
    .filter((x: { option: string; whyNot: string }) => x.option && x.whyNot)
    .slice(0, 4);
  return {
    decision: {
      focusSlug: str(d.focusSlug),
      capabilityId:
        str(d.capabilityId) && str(d.capabilityId) !== "null"
          ? str(d.capabilityId)
          : null,
      approachSlug:
        str(d.approachSlug) && str(d.approachSlug) !== "null"
          ? str(d.approachSlug)
          : null,
      basis: {
        observed: str((d.basis as Row | undefined)?.observed),
        inferred: str((d.basis as Row | undefined)?.inferred),
        missing: str((d.basis as Row | undefined)?.missing),
      },
      buildsOnSlugs: strList(d.buildsOnSlugs, 4),
      gapSlugs: strList(d.gapSlugs, 4),
      why: str(d.why),
      evidenceIds: strList(d.evidenceIds, 8).map((x) => x.toUpperCase()),
      considered,
    },
    challenge: {
      mechanism: str(c.mechanism),
      existingEvidenceId: str(c.existingEvidenceId).toUpperCase(),
      observedInCode: str(c.observedInCode),
      limitation: str(c.limitation),
    },
    task: {
      objective: clip(str(t.objective).replace(/\s+/g, " "), 140),
      startPath: str(t.startPath),
      steps: strList(t.steps, 6),
      doneWhen: str(t.doneWhen ?? t.done_when),
    },
  };
}

function validate(
  raw: Row | null,
  result: GoalGraphResult,
): { ok: true; draft: Draft } | { ok: false; errors: string[] } {
  const draft = readDraft(raw);
  if (!draft) return { ok: false, errors: ["the reply was not valid JSON"] };
  const errors: string[] = [];
  const { decision: d, challenge: c, task: t } = draft;

  const topics = new Map(result.topics.map((x) => [x.slug, x]));
  const evidence = new Map(result.evidence.map((e) => [e.id, e]));
  const codeBy = new Map(result.code.map((x) => [x.evidenceId, x]));
  const capabilities = new Set(result.coverage.map((x) => x.capabilityId));

  if (!topics.has(d.focusSlug))
    errors.push(
      `decision.focusSlug "${d.focusSlug}" is not a topic slug in the data`,
    );

  const seedSlugs = result.resolution.seeds.map((s) => s.slug);
  if (
    result.resolution.method !== "domain" &&
    topics.has(d.focusSlug) &&
    !seedSlugs.includes(d.focusSlug)
  )
    errors.push(
      `decision.focusSlug must be one of the topics the developer asked about (${seedSlugs.join(", ")}); use related topics only in buildsOnSlugs or gapSlugs`,
    );

  if (d.capabilityId && !capabilities.has(d.capabilityId))
    errors.push(
      `decision.capabilityId "${d.capabilityId}" is not a capability id in the data (use null if none)`,
    );
  for (const s of d.buildsOnSlugs)
    if (!topics.has(s))
      errors.push(`buildsOnSlugs "${s}" is not a topic slug in the data`);
  for (const s of d.gapSlugs)
    if (!topics.has(s))
      errors.push(`gapSlugs "${s}" is not a topic slug in the data`);

  const badIds = d.evidenceIds.filter((id) => !evidence.has(id));
  if (badIds.length)
    errors.push(`evidenceIds not in the data: ${badIds.join(", ")}`);
  if (!d.evidenceIds.length)
    errors.push("decision.evidenceIds must cite at least one evidence id");
  for (const s of d.buildsOnSlugs) {
    if (!topics.has(s)) continue;
    const backed = d.evidenceIds.some(
      (id) => evidence.get(id)?.topicSlug === s,
    );
    if (!backed)
      errors.push(
        `buildsOnSlugs "${s}" has no evidence id from that topic in decision.evidenceIds`,
      );
  }
  if (d.why.length < 30) errors.push("decision.why is missing or too short");

  // approach-aware: the move must name the approach it changes
  const focusApproaches = topics.get(d.focusSlug)?.depth.approaches ?? [];
  if (d.approachSlug) {
    if (!focusApproaches.some((a) => a.slug === d.approachSlug))
      errors.push(
        `decision.approachSlug "${d.approachSlug}" is not an approach of ${d.focusSlug} in the data (${focusApproaches.map((a) => a.slug).join(", ") || "none assessed"}); use null when adding a new approach`,
      );
  } else if (focusApproaches.length && d.basis.missing.length < 15) {
    errors.push(
      "the focus topic has assessed approaches: set decision.approachSlug to the one you change, or use null and name the absent approach in decision.basis.missing",
    );
  }
  // observed vs inferred vs missing, with evidence ids behind the observation
  const observedIds = (d.basis.observed.match(/\bE\d+\b/gi) ?? []).map((x) =>
    x.toUpperCase(),
  );
  if (d.basis.observed.length < 20 || !observedIds.length)
    errors.push(
      "decision.basis.observed must state what the data shows and cite at least one evidence id (E#)",
    );
  else if (observedIds.some((id) => !evidence.has(id)))
    errors.push(
      "decision.basis.observed cites an evidence id that is not in the data",
    );
  if (d.basis.inferred.length < 15)
    errors.push(
      "decision.basis.inferred must state what you conclude from the observation",
    );
  if (!d.considered.length)
    errors.push(
      "decision.considered must list at least one alternative you weighed, with whyNot",
    );

  const code = codeBy.get(c.existingEvidenceId);
  if (!code)
    errors.push(
      `challenge.existingEvidenceId must be one of the ids that have code: ${result.code.map((x) => x.evidenceId).join(", ") || "none"}`,
    );
  else {
    const quote = norm(c.observedInCode);
    if (quote.length < 12 || !norm(code.excerpt).includes(quote))
      errors.push(
        `challenge.observedInCode must be a verbatim fragment (12-140 chars) copied from ${c.existingEvidenceId}'s code; "${clip(c.observedInCode, 60)}" does not appear in it`,
      );
    if (t.startPath.toLowerCase() !== code.path.toLowerCase())
      errors.push(
        `task.startPath must be exactly "${code.path}" (the path of ${c.existingEvidenceId})`,
      );
    if (!d.evidenceIds.includes(c.existingEvidenceId))
      errors.push(`decision.evidenceIds must include ${c.existingEvidenceId}`);
  }
  if (c.mechanism.length < 15) errors.push("challenge.mechanism is missing");
  if (c.limitation.length < 20)
    errors.push(
      "challenge.limitation must describe what the existing code does not do yet",
    );

  if (t.objective.length < 12)
    errors.push("task.objective is missing or too short");
  if (t.steps.length < 3) errors.push("task.steps needs 3 to 5 steps");
  if (t.steps.some((s) => s.length < 20))
    errors.push("every step must be specific (20+ chars)");
  if (t.doneWhen.length < 30 || !CHECKABLE.test(t.doneWhen))
    errors.push(
      "task.doneWhen must be an observable condition a test, command or review can check",
    );
  if ([t.objective, t.doneWhen, ...t.steps].some((s) => GENERIC.test(s)))
    errors.push(
      "the task uses a generic phrase; name the specific mechanism and behaviour instead",
    );

  const known = result.evidence
    .map((e) => e.path.toLowerCase())
    .filter(Boolean);
  const stray = (
    [t.objective, ...t.steps, t.doneWhen].join(" ").match(PATH_TOKEN) ?? []
  ).filter((tok) => {
    const x = tok.toLowerCase();
    return !known.some((k) => k.endsWith(x) || x.endsWith(k) || k.includes(x));
  });
  if (stray.length)
    errors.push(
      `files mentioned that are not in the evidence: ${stray.slice(0, 3).join(", ")}`,
    );

  if (
    result.evidence.some(
      (e) => e.technique && nearDuplicate(t.objective, e.technique),
    )
  )
    errors.push(
      "the objective repeats a technique the developer already demonstrated; propose new behaviour",
    );
  if (
    result.previousMove?.title &&
    nearDuplicate(t.objective, result.previousMove.title)
  )
    errors.push("the objective repeats the previously proposed move");
  const repeated = result.completedMoves.find(
    (m) => m.title && nearDuplicate(t.objective, m.title),
  );
  if (repeated)
    errors.push(
      `the objective repeats a mission the developer already verified ("${clip(repeated.title, 80)}")`,
    );

  return errors.length ? { ok: false, errors } : { ok: true, draft };
}

const MAP_SYSTEM = `Pick the topics from the list that best match the developer's goal.
Reply with JSON only: {"slugs":["slug1","slug2"]}
Use ONLY slugs from the list. At most 4. If nothing fits, reply {"slugs":[]}.`;

async function mapWishWithLlm(
  graph: Graph,
  llm: LlmClient,
  wish: string,
  timeoutMs: number,
  notes: string[],
): Promise<string[]> {
  const catalog = await listTopicCatalog(graph, 120);
  if (!catalog.length) return [];
  const known = new Map<string, string>();
  for (const t of catalog) {
    known.set(t.slug.toLowerCase(), t.slug);
    known.set(t.name.toLowerCase(), t.slug);
  }
  const list = catalog
    .map((t) => `${t.slug} | ${t.name} (${t.domain || "general"})`)
    .join("\n");
  try {
    const out = await callLlm(
      llm,
      {
        system: MAP_SYSTEM,
        user: `Goal: ${clip(wish, 200)}\n\nTopics:\n${list}`,
        maxTokens: 300,
        json: true,
      },
      timeoutMs,
    );
    const raw = extractJson(out)?.slugs;
    const slugs = uniq(
      (Array.isArray(raw) ? raw : [])
        .map((s: unknown) => known.get(str(s).toLowerCase()))
        .filter((s): s is string => Boolean(s)),
    );
    notes.push(`LLM mapped the wish to: ${slugs.join(", ") || "nothing"}`);
    return slugs.slice(0, 4);
  } catch (error) {
    notes.push(
      `topic mapping failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

const MAX_ATTEMPTS = 3;

export async function planGoal(
  graph: Graph,
  llm: LlmClient | null,
  input: PlanGoalInput,
): Promise<GoalPlan> {
  const started = Date.now();
  const timeoutMs =
    input.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS ?? 30_000);
  const notes: string[] = [];
  const timings = { graph: 0, llm: 0, store: 0, total: 0 };
  let llmCalls = 0;
  let wish = input.wish.trim();
  let goalTopics = input.goalTopics;

  const finishPlan = (
    p: Partial<GoalPlan> & Pick<GoalPlan, "status" | "wish" | "resolution">,
  ): GoalPlan => {
    timings.total = Date.now() - started;
    return {
      task: null,
      source: "none",
      stored: null,
      clarification: null,
      errors: [],
      graph: null,
      llmCalls,
      timingsMs: timings,
      notes,
      ...p,
    };
  };

  if (!wish && !goalTopics?.length) {
    const rows = await graph.query(
      `MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[:OF_TOPIC]->(t:Topic)
       RETURN t.slug AS slug ORDER BY coalesce(a.score, 0) DESC LIMIT 3`,
      { params: { dev: input.developerId } },
    );
    goalTopics = ((rows.data ?? []) as Row[])
      .map((r) => str(r.slug))
      .filter(Boolean);
    wish = "auto goal";
    notes.push(
      `no wish given: started from your strongest topics (${goalTopics.join(", ")})`,
    );
  }

  let t0 = Date.now();
  let result = await buildGoalGraph(graph, {
    developerId: input.developerId,
    wish,
    goalTopics,
  });
  timings.graph += Date.now() - t0;

  if (result.resolution.needsClarification && llm) {
    t0 = Date.now();
    llmCalls += 1;
    const slugs = await mapWishWithLlm(graph, llm, wish, timeoutMs, notes);
    timings.llm += Date.now() - t0;
    if (slugs.length) {
      t0 = Date.now();
      result = await buildGoalGraph(graph, {
        developerId: input.developerId,
        wish,
        goalTopics: slugs,
      });
      timings.graph += Date.now() - t0;
    }
  }
  if (result.resolution.needsClarification)
    return finishPlan({
      status: "needs_clarification",
      wish: result.wish,
      resolution: result.resolution,
      clarification: result.clarification,
    });

  const graphInfo: GoalPlan["graph"] = {
    seeds: result.resolution.seeds.map((s) => s.slug),
    topics: result.topics.length,
    evidence: result.evidence.length,
    codeExcerpts: result.code.length,
    operations: result.operations,
    topicNodes: result.topics.map((t) => ({
      slug: t.slug,
      name: t.name,
      domain: t.domain,
      role: t.role,
      hops: t.hops,
      relevance: t.relevance,
      level: t.depth.level,
      assessed: t.depth.assessed,
      authenticity: t.depth.authenticity,
    })),
    links: result.links,
    context: result.context,
    ranking: result.ranking,
  };

  if (!result.code.length) {
    notes.push(
      result.evidence.length
        ? "evidence exists but none has readable, non-test code behind it"
        : "no demonstration, assessment-cited code or matching authored file is linked to this topic or its neighbourhood",
    );
    return finishPlan({
      status: "needs_evidence",
      wish: result.wish,
      resolution: result.resolution,
      graph: graphInfo,
      clarification: {
        reason: `The graph has no readable code for "${result.resolution.seeds.map((s) => s.name).join(", ")}" or its related topics to build a verified task from. Sync or analyse the relevant repositories, or name a topic you have already built.`,
        suggestions: [],
      },
    });
  }

  if (!llm)
    return finishPlan({
      status: "llm_unavailable",
      wish: result.wish,
      resolution: result.resolution,
      graph: graphInfo,
      notes: [
        ...notes,
        "no LLM configured: the agent makes the decision, so no task was produced",
      ],
    });

  const user = renderUser(briefForAgent(result));
  let previous = "";
  let errors: string[] = [];
  let draft: Draft | undefined;
  let repaired = false;
  t0 = Date.now();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const prompt =
      attempt === 0
        ? user
        : `${user}\n\nYour previous reply was rejected for these reasons:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nPrevious reply:\n${clip(previous, 900)}\n\nReturn corrected JSON only. Keep the decision if it is sound; fix only what was rejected.`;
    try {
      llmCalls += 1;
      previous = await callLlm(
        llm,
        { system: SYSTEM, user: prompt, maxTokens: 2200, json: true },
        timeoutMs,
      );
    } catch (error) {
      errors = [
        `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
      ];
      notes.push(errors[0] as string);
      break;
    }
    const checked = validate(extractJson(previous), result);
    if (checked.ok) {
      draft = checked.draft;
      repaired = attempt > 0;
      break;
    }
    errors = checked.errors;
    notes.push(
      `attempt ${attempt + 1} rejected: ${errors.join(" | ")}${errors[0]?.includes("not valid JSON") ? ` (raw: ${clip(previous.trim(), 200) || "empty"})` : ""}`,
    );
  }
  timings.llm += Date.now() - t0;

  if (!draft)
    return finishPlan({
      status: "generation_failed",
      wish: result.wish,
      resolution: result.resolution,
      graph: graphInfo,
      errors,
    });

  const { decision, challenge, task: t } = draft;
  const topic = result.topics.find((x) => x.slug === decision.focusSlug)!;
  const anchor = result.evidence.find(
    (e) => e.id === challenge.existingEvidenceId,
  ) as EvidenceItem;
  const cap = decision.capabilityId
    ? result.coverage.find((c) => c.capabilityId === decision.capabilityId)
    : undefined;
  const evidenceIds = uniq(decision.evidenceIds);

  const task: PlannedTask = {
    title: t.objective,
    decision,
    challenge,
    startingPoint: {
      repository: anchor.repository,
      path: anchor.path,
      permalink: anchor.permalink,
      commit: anchor.commitSubject,
    },
    steps: t.steps,
    doneWhen: t.doneWhen,
    why: decision.why,
    focus: {
      slug: topic.slug,
      name: topic.name,
      domain: topic.domain,
      level: topic.depth.level,
    },
    approach: (() => {
      const a = topic.depth.approaches.find(
        (x) => x.slug === decision.approachSlug,
      );
      return a
        ? {
            slug: a.slug,
            name: a.name,
            depth: a.depth,
            authenticity: a.authenticity,
          }
        : null;
    })(),
    targetCapability: cap
      ? { id: cap.capabilityId, name: cap.capability }
      : null,
    evidence: evidenceIds
      .map((id) => result.evidence.find((e) => e.id === id))
      .filter((e): e is EvidenceItem => e !== undefined)
      .map((e) => ({
        id: e.id,
        repository: e.repository,
        path: e.path,
        technique: e.technique,
        depth: e.depth,
        commit: e.commitSubject,
        permalink: e.permalink,
      })),
    evidenceIds,
    strengthSlugs: decision.buildsOnSlugs,
    gapSlugs: decision.gapSlugs,
  };

  let stored: NextMoveStored | null = null;
  if (input.persist !== false) {
    t0 = Date.now();
    const summary = `${task.why}\n\nChallenge: ${challenge.limitation}\n\nSteps:\n${task.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nDone when: ${task.doneWhen}`;
    stored = await storeNextMove(graph, result, {
      title: task.title,
      summary,
      focusSlug: task.focus.slug,
      strengthSlugs: task.strengthSlugs,
      gapSlugs: task.gapSlugs,
      evidenceIds: task.evidenceIds,
      capabilityId: task.targetCapability?.id ?? null,
      startFileChangeId: anchor.fileChangeId || null,
      doneWhen: task.doneWhen,
      details: {
        decision,
        challenge,
        startingPoint: task.startingPoint,
        steps: task.steps,
      },
    });
    timings.store = Date.now() - t0;
    if (stored.rejected.length)
      notes.push(...stored.rejected.map((r) => `store: ${r}`));
  }

  log("goal planned", {
    method: result.resolution.method,
    focus: task.focus.slug,
    capability: task.targetCapability?.id ?? null,
    llmCalls,
    ms: Date.now() - started,
  });

  return finishPlan({
    status: "planned",
    wish: result.wish,
    resolution: result.resolution,
    task,
    source: repaired ? "llm_repaired" : "llm",
    stored,
    graph: graphInfo,
  });
}
