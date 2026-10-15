/**
 * Pathway goal-graph behavior test.
 *
 * Purpose: see how the goal graph behaves for different kinds of goals, with
 * NO LLM involved:
 *   A. specific topic typed in words     "I want to improve my <topic>"
 *   B. specific topic named by the agent goalTopics: [slug]
 *   C. agent invents a topic             must be rejected, not trusted
 *   D. vague area                        "I want to improve my <domain> skills"
 *   E. unresolvable / empty wishes       must ask for clarification
 * plus pure unit checks of Personalized PageRank, and an OPTIONAL write test
 * of storeNextMove.
 *
 * Read-only by default. Nothing is created or changed unless
 * GOAL_TEST_WRITE=1 (then it writes one clearly named test Goal + NextMove and
 * deletes them again unless GOAL_TEST_KEEP=1).
 *
 * Run from backend:
 *   npx tsx src/tests/goal-graph.behavior.test.ts
 *
 * Optional environment variables:
 *   DEVELOPER_ID=118355098
 *   GOAL_TEST_TOPIC=rate_limit_handling     (slug or name; default: best assessed topic)
 *   GOAL_TEST_AREA=frontend                 (a Topic.domain; default: most common domain)
 *   GOAL_TEST_WRITE=1                       also test storeNextMove
 *   GOAL_TEST_KEEP=1                        keep the test Goal/NextMove
 *   GOAL_TEST_VERBOSE=1                     print full results
 */
import assert from "node:assert/strict";
import { getGraphForDeveloper } from "../db/falkordb.js";
import {
  briefForAgent,
  buildGoalGraph,
  levelRank,
  personalizedPageRank,
  storeNextMove,
  type GoalGraphResult,
} from "../graph/goal-graph.js";

const DEVELOPER_ID = process.env.DEVELOPER_ID?.trim() || "118355098";
const VERBOSE = process.env.GOAL_TEST_VERBOSE === "1";
const WRITE = process.env.GOAL_TEST_WRITE === "1";
const KEEP = process.env.GOAL_TEST_KEEP === "1";

type Row = Record<string, any>;
type Graph = Awaited<ReturnType<typeof getGraphForDeveloper>>;
type Status = "PASS" | "WARN" | "FAIL";

const failures: string[] = [];
const warnings: string[] = [];
const observations: Array<{ check: string; status: Status; detail: string }> =
  [];

function record(check: string, status: Status, detail: string): void {
  observations.push({ check, status, detail });
  const line = `[${status}] ${check}: ${detail}`;
  if (status === "FAIL") failures.push(line);
  if (status === "WARN") warnings.push(line);
  console.log(line);
}

/** PASS when the condition holds, otherwise FAIL (hard invariant). */
function must(check: string, ok: boolean, detail: string): void {
  record(check, ok ? "PASS" : "FAIL", detail);
}
/** PASS when the condition holds, otherwise WARN (data / coverage question). */
function should(check: string, ok: boolean, detail: string): void {
  record(check, ok ? "PASS" : "WARN", detail);
}

async function queryRows(
  graph: Graph,
  query: string,
  params: Record<string, any> = {},
): Promise<Row[]> {
  const result = await graph.query(query, { params });
  return (result.data ?? []) as Row[];
}

function section(title: string, value: unknown): void {
  console.log(`\n--- ${title} ---`);
  if (VERBOSE)
    console.dir(value, { depth: 5, colors: true, maxArrayLength: 30 });
  else console.log(JSON.stringify(value, null, 2));
}

const names = (list: Array<{ name: string }>): string[] =>
  list.map((s) => s.name);

// ------------------------------------------------------------
// 1. pure unit checks: Personalized PageRank
// ------------------------------------------------------------

function testPersonalizedPageRank(): void {
  console.log("\n=== Unit: personalizedPageRank (no database) ===");
  const sum = (m: Map<string, number>) =>
    [...m.values()].reduce((a, b) => a + b, 0);

  // chain a - b - c - d, restart on a: closer to a means higher score
  const chain = personalizedPageRank(
    ["a", "b", "c", "d"],
    [
      { from: "a", to: "b", weight: 1 },
      { from: "b", to: "c", weight: 1 },
      { from: "c", to: "d", weight: 1 },
    ],
    ["a"],
  );
  must(
    "PPR scores sum to 1",
    Math.abs(sum(chain) - 1) < 1e-6,
    `sum=${sum(chain).toFixed(8)}`,
  );
  // On an undirected graph, PageRank settles roughly in proportion to a node's
  // number of connections, so compare the score PER CONNECTION.
  const degree: Record<string, number> = { a: 1, b: 2, c: 2, d: 1 };
  const norm = (k: string) => (chain.get(k) ?? 0) / (degree[k] ?? 1);
  must(
    "PPR decays with distance from the restart node (per connection)",
    norm("a") > norm("b") && norm("b") > norm("c") && norm("c") > norm("d"),
    ["a", "b", "c", "d"].map((k) => `${k}=${norm(k).toFixed(3)}`).join(" "),
  );

  // two clusters joined by one weak bridge: restart decides which cluster wins
  const nodes = ["x1", "x2", "x3", "y1", "y2", "y3"];
  const edges = [
    { from: "x1", to: "x2", weight: 1 },
    { from: "x2", to: "x3", weight: 1 },
    { from: "x1", to: "x3", weight: 1 },
    { from: "y1", to: "y2", weight: 1 },
    { from: "y2", to: "y3", weight: 1 },
    { from: "y1", to: "y3", weight: 1 },
    { from: "x3", to: "y3", weight: 0.1 },
  ];
  const fromX = personalizedPageRank(nodes, edges, ["x1"]);
  const fromY = personalizedPageRank(nodes, edges, ["y1"]);
  const mass = (m: Map<string, number>, p: string) =>
    ["1", "2", "3"].reduce((n, i) => n + (m.get(p + i) ?? 0), 0);
  must(
    "PPR is personalized: restart in X favors X, restart in Y favors Y",
    mass(fromX, "x") > mass(fromX, "y") && mass(fromY, "y") > mass(fromY, "x"),
    `restart x1 -> X=${mass(fromX, "x").toFixed(3)} Y=${mass(fromX, "y").toFixed(3)}; restart y1 -> X=${mass(fromY, "x").toFixed(3)} Y=${mass(fromY, "y").toFixed(3)}`,
  );

  // heavier edge pulls more rank
  const weighted = personalizedPageRank(
    ["s", "heavy", "light"],
    [
      { from: "s", to: "heavy", weight: 1 },
      { from: "s", to: "light", weight: 0.1 },
    ],
    ["s"],
  );
  must(
    "PPR respects edge weight",
    (weighted.get("heavy") ?? 0) > (weighted.get("light") ?? 0),
    `heavy=${(weighted.get("heavy") ?? 0).toFixed(3)} light=${(weighted.get("light") ?? 0).toFixed(3)}`,
  );

  // a restart node with no edges at all must not break normalization
  const lonely = personalizedPageRank(
    ["a", "b", "lonely"],
    [{ from: "a", to: "b", weight: 1 }],
    ["lonely"],
  );
  must(
    "PPR handles a restart node with no edges",
    Math.abs(sum(lonely) - 1) < 1e-6 && (lonely.get("lonely") ?? 0) > 0.99,
    `lonely=${(lonely.get("lonely") ?? 0).toFixed(3)} sum=${sum(lonely).toFixed(6)}`,
  );
}

// ------------------------------------------------------------
// 2. invariants every GoalGraphResult must satisfy
// ------------------------------------------------------------

async function checkResult(
  graph: Graph,
  label: string,
  r: GoalGraphResult,
): Promise<void> {
  console.log(`\n--- invariants: ${label} ---`);
  const bySlug = new Map(r.topics.map((t) => [t.slug, t]));
  const uniqueSlugs =
    new Set(r.topics.map((t) => t.slug)).size === r.topics.length;
  must(
    `${label}: topics are unique`,
    uniqueSlugs,
    `${r.topics.length} topic(s)`,
  );

  const missingSeeds = r.resolution.seeds.filter((s) => !bySlug.has(s.slug));
  should(
    `${label}: every seed is in the topic list`,
    missingSeeds.length === 0 || r.truncated,
    `${r.resolution.seeds.length} seed(s), ${missingSeeds.length} missing`,
  );
  const badSeedShape = r.topics.filter(
    (t) =>
      (t.role === "seed") !== r.resolution.seeds.some((s) => s.slug === t.slug),
  );
  must(
    `${label}: role "seed" matches the resolved seeds`,
    badSeedShape.length === 0,
    `${badSeedShape.length} mismatch(es)`,
  );
  must(
    `${label}: seeds sit at hop 0, others at hop >= 1`,
    r.topics.every((t) => (t.role === "seed" ? t.hops === 0 : t.hops >= 1)),
    "hop distances checked",
  );
  must(
    `${label}: relevance is within 0..1`,
    r.topics.every((t) => t.relevance >= 0 && t.relevance <= 1),
    `max relevance ${Math.max(0, ...r.topics.map((t) => t.relevance))}`,
  );
  const seedRel = r.topics
    .filter((t) => t.role === "seed")
    .map((t) => t.relevance);
  should(
    `${label}: seeds carry rank (restart nodes)`,
    seedRel.length === 0 || seedRel.every((v) => v > 0),
    `seed relevance: ${seedRel.join(", ")}`,
  );

  // PageRank mass
  const mass = r.context.nodes.reduce((n, x) => n + x.score, 0);
  must(
    `${label}: PageRank over the retrieved subgraph sums to ~1`,
    r.context.nodes.length === 0 || Math.abs(mass - 1) < 0.01,
    `sum=${mass.toFixed(4)} over ${r.context.nodes.length} node(s)`,
  );
  const keys = new Set(r.context.nodes.map((n) => n.key));
  const danglingEdges = r.context.edges.filter(
    (e) => !keys.has(e.from) || !keys.has(e.to),
  );
  must(
    `${label}: context edges connect existing nodes`,
    danglingEdges.length === 0,
    `${r.context.edges.length} edge(s), ${danglingEdges.length} dangling`,
  );
  must(
    `${label}: ranking is sorted by score`,
    r.ranking.every(
      (n, i) => i === 0 || (r.ranking[i - 1]?.score ?? 0) >= n.score,
    ),
    `top ${r.ranking.length} node(s)`,
  );

  // BUILDS_ON must not appear anywhere
  const leaked =
    JSON.stringify(r.operations).includes("BUILDS_ON") ||
    r.links.some((l) => (l.type as string) === "BUILDS_ON");
  must(
    `${label}: BUILDS_ON is not used`,
    !leaked,
    "operations and links checked",
  );

  // operations
  const failedOps = r.operations.filter((o) => o.status === "failed");
  must(
    `${label}: no graph operation failed`,
    failedOps.length === 0,
    failedOps.length
      ? failedOps.map((o) => `${o.id}: ${o.result}`).join(" | ")
      : `${r.operations.length} operation(s) ok/empty`,
  );
  const emptyOps = r.operations
    .filter((o) => o.status === "empty")
    .map((o) => o.id);
  if (emptyOps.length)
    record(
      `${label}: empty operations`,
      "WARN",
      `returned nothing: ${emptyOps.join(", ")}`,
    );

  // evidence
  const ids = r.evidence.map((e) => e.id);
  must(
    `${label}: evidence ids are unique and sequential (E1..En)`,
    ids.every((id, i) => id === `E${i + 1}`),
    `${ids.length} item(s)`,
  );
  must(
    `${label}: every evidence item belongs to a topic in the result`,
    r.evidence.every((e) => bySlug.has(e.topicSlug)),
    "topic membership checked",
  );
  const perTopic = new Map<string, number>();
  for (const e of r.evidence)
    perTopic.set(e.topicSlug, (perTopic.get(e.topicSlug) ?? 0) + 1);
  must(
    `${label}: at most 3 evidence items per topic`,
    [...perTopic.values()].every((n) => n <= 3),
    `max ${Math.max(0, ...perTopic.values())}`,
  );
  if (r.evidence.length) {
    const demoIds = [...new Set(r.evidence.map((e) => e.demonstrationId))];
    const rows = await queryRows(
      graph,
      `MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)
       WHERE x.id IN $ids
       RETURN count(DISTINCT x) AS n`,
      { dev: DEVELOPER_ID, ids: demoIds },
    );
    must(
      `${label}: cited demonstrations really belong to this developer`,
      Number(rows[0]?.n ?? 0) === demoIds.length,
      `${rows[0]?.n}/${demoIds.length} found in FalkorDB`,
    );
  }

  // signals
  const { strengths, unproven, opportunities } = r.signals;
  const strengthSlugs = new Set(strengths.map((s) => s.slug));
  const unprovenSlugs = new Set(unproven.map((s) => s.slug));
  must(
    `${label}: a topic is never both strength and unproven`,
    ![...strengthSlugs].some((s) => unprovenSlugs.has(s)),
    `${strengths.length} strength(s), ${unproven.length} unproven`,
  );
  must(
    `${label}: every strength is traceable to evidence ids`,
    strengths.every((s) => s.evidenceIds.length > 0),
    "a strength without linked demonstrations belongs in unproven",
  );
  must(
    `${label}: every strength is at least working depth`,
    strengths.every((s) => levelRank(s.level) >= 2),
    strengths.map((s) => `${s.name}=${s.level}`).join(", ") || "none",
  );
  must(
    `${label}: opportunities are a subset of unproven`,
    opportunities.every((o) => unprovenSlugs.has(o.slug)),
    `${opportunities.length} opportunit(ies)`,
  );
  const evidenceIdSet = new Set(ids);
  must(
    `${label}: signal evidence ids exist`,
    [...strengths, ...unproven, ...opportunities].every((s) =>
      s.evidenceIds.every((id) => evidenceIdSet.has(id)),
    ),
    "all cited ids resolve",
  );
  if (r.resolution.method !== "domain" && r.resolution.seeds.length) {
    const domains = new Set(
      r.resolution.seeds.map((s) => s.domain.toLowerCase()).filter(Boolean),
    );
    if (domains.size) {
      const outside = [...unproven, ...opportunities].filter(
        (s) => !domains.has(s.domain.toLowerCase()),
      );
      must(
        `${label}: specific goal stays inside the seeds' area`,
        outside.length === 0,
        `area=${[...domains].join(",")}; ${outside.length} outside: ${names(outside).join(", ") || "none"}`,
      );
    }
  }

  // brief for the agent
  const brief = briefForAgent(r);
  const text = JSON.stringify(brief);
  must(
    `${label}: agent brief serializes`,
    text.length > 2,
    `${text.length} chars`,
  );
  should(
    `${label}: agent brief stays compact`,
    text.length <= 40_000,
    `${text.length} chars (~${Math.round(text.length / 4)} tokens)`,
  );
}

function summarize(label: string, r: GoalGraphResult): Row {
  return {
    scenario: label,
    wish: r.wish,
    method: r.resolution.method,
    confidence: r.resolution.confidence,
    needsClarification: r.resolution.needsClarification,
    seeds: r.resolution.seeds.map((s) => `${s.name} [${s.domain}]`),
    topics: r.topics.length,
    links: r.links.length,
    evidence: r.evidence.length,
    contextNodes: r.context.nodes.length,
    strengths: r.signals.strengths.map((s) => `${s.name} (${s.level})`),
    unproven: r.signals.unproven.map(
      (s) => `${s.name} (${s.level}, rel ${s.relevance})`,
    ),
    opportunities: r.signals.opportunities.map(
      (s) => `${s.name} (rel ${s.relevance})`,
    ),
    topRanked: r.ranking
      .slice(0, 6)
      .map((n) => `${n.kind}:${n.label} ${n.score}`),
  };
}

function showOperations(label: string, r: GoalGraphResult): void {
  console.log(`\nOperations for ${label}:`);
  console.table(
    r.operations.map((o) => ({
      id: o.id,
      kind: o.kind,
      status: o.status,
      ms: o.durationMs,
      result: o.result.length > 110 ? `${o.result.slice(0, 107)}...` : o.result,
    })),
  );
}

// ------------------------------------------------------------
// main
// ------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n============================================================");
  console.log("PATHWAY GOAL GRAPH: BEHAVIOR TEST");
  console.log(
    `Developer: ${DEVELOPER_ID} | write test: ${WRITE ? "ON" : "off"}`,
  );
  console.log("No LLM. Goals are resolved and expanded from FalkorDB only.");
  console.log("============================================================");

  testPersonalizedPageRank();

  const graph = await getGraphForDeveloper(DEVELOPER_ID);
  const ping = await queryRows(graph, "RETURN 1 AS ok");
  assert.equal(Number(ping[0]?.ok), 1, "FalkorDB query/ping failed");
  const dev = await queryRows(
    graph,
    `MATCH (d:Developer {id: $dev}) RETURN d.id AS id LIMIT 1`,
    { dev: DEVELOPER_ID },
  );
  assert.equal(
    String(dev[0]?.id ?? ""),
    DEVELOPER_ID,
    `Developer ${DEVELOPER_ID} not found`,
  );
  record(
    "FalkorDB and developer",
    "PASS",
    "connection works and the developer exists",
  );

  // ---- discover real topics/domains instead of hardcoding them ----
  const assessed = await queryRows(
    graph,
    `MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[:OF_TOPIC]->(t:Topic)
     RETURN t.slug AS slug, t.name AS name, coalesce(t.domain, "") AS domain,
            a.level AS level, coalesce(a.score, 0) AS score
     ORDER BY score DESC`,
    { dev: DEVELOPER_ID },
  );
  const domainRows = await queryRows(
    graph,
    `MATCH (t:Topic) WHERE coalesce(t.domain, "") <> ""
     RETURN toLower(t.domain) AS domain, count(t) AS topics
     ORDER BY topics DESC`,
  );
  section("Discovered test inputs", {
    assessedTopics: assessed.length,
    topAssessed: assessed.slice(0, 5),
    domains: domainRows,
  });
  assert.ok(
    assessed.length > 0,
    "Developer has no assessed topics; nothing to test against",
  );

  const envTopic = process.env.GOAL_TEST_TOPIC?.trim().toLowerCase();
  const topicRow =
    (envTopic &&
      assessed.find(
        (t) =>
          String(t.slug).toLowerCase() === envTopic ||
          String(t.name).toLowerCase() === envTopic,
      )) ||
    assessed[0];
  const otherRow = assessed.find((t) => t.slug !== topicRow.slug);
  const topicSlug = String(topicRow.slug);
  const topicName = String(topicRow.name);

  const nonGeneral = domainRows.filter((d) => d.domain !== "general");
  const area =
    process.env.GOAL_TEST_AREA?.trim().toLowerCase() ||
    String((nonGeneral[0] ?? domainRows[0])?.domain ?? "");
  assert.ok(
    area,
    "No Topic.domain values exist; cannot test the vague-area scenario",
  );
  console.log(`\nSpecific topic: ${topicName} (${topicSlug}) | Area: ${area}`);

  const results = new Map<string, GoalGraphResult>();
  const run = async (
    label: string,
    input: Parameters<typeof buildGoalGraph>[1],
  ) => {
    const r = await buildGoalGraph(graph, input);
    results.set(label, r);
    section(`Scenario ${label}`, summarize(label, r));
    showOperations(label, r);
    return r;
  };

  // A. specific topic, typed in words
  const a = await run("A specific topic (words)", {
    developerId: DEVELOPER_ID,
    wish: `I want to improve my ${topicName}`,
  });
  must(
    "A: wish resolved (no clarification needed)",
    !a.resolution.needsClarification,
    `method=${a.resolution.method}, confidence=${a.resolution.confidence}`,
  );
  should(
    "A: the intended topic is among the seeds",
    a.resolution.seeds.some((s) => s.slug === topicSlug),
    `seeds: ${a.resolution.seeds.map((s) => s.slug).join(", ") || "none"}`,
  );
  should(
    "A: a specific wish gives a narrow scope (<= 6 seeds)",
    a.resolution.seeds.length <= 6,
    `${a.resolution.seeds.length} seed(s)`,
  );
  await checkResult(graph, "A", a);

  // B. same topic, named by the goal agent
  const b = await run("B agent-named topic", {
    developerId: DEVELOPER_ID,
    wish: "get better at this",
    goalTopics: [topicSlug],
  });
  must(
    "B: agent topic accepted",
    b.resolution.method === "agent_topics",
    `method=${b.resolution.method}`,
  );
  must(
    "B: exactly the named topic is the seed",
    b.resolution.seeds.length === 1 &&
      b.resolution.seeds[0]?.slug === topicSlug,
    `seeds: ${b.resolution.seeds.map((s) => s.slug).join(", ")}`,
  );
  await checkResult(graph, "B", b);
  const seedB = b.topics.find((t) => t.slug === topicSlug);
  should(
    "B: the seed carries the highest topic relevance",
    Boolean(seedB) &&
      b.topics.every((t) => t.relevance <= (seedB?.relevance ?? 0)),
    `seed relevance=${seedB?.relevance}; best other=${Math.max(0, ...b.topics.filter((t) => t.slug !== topicSlug).map((t) => t.relevance))}`,
  );

  // C. the agent invents a topic: it must not be trusted
  const c = await run("C invented agent topic", {
    developerId: DEVELOPER_ID,
    wish: `I want to improve my ${topicName}`,
    goalTopics: ["totally_made_up_topic_xyz", "quantum gardening"],
  });
  must(
    "C: invented topics are not accepted as seeds",
    c.resolution.method !== "agent_topics" &&
      !c.resolution.seeds.some((s) => /made_up|quantum/.test(s.slug)),
    `method=${c.resolution.method}; seeds: ${c.resolution.seeds.map((s) => s.slug).join(", ") || "none"}`,
  );
  should(
    "C: falls back to the wording and still resolves",
    !c.resolution.needsClarification,
    `method=${c.resolution.method}`,
  );
  await checkResult(graph, "C", c);

  // D. vague area
  const d = await run("D vague area", {
    developerId: DEVELOPER_ID,
    wish: `I want to improve my ${area} skills`,
  });
  must(
    "D: area wish resolved",
    !d.resolution.needsClarification,
    `method=${d.resolution.method}`,
  );
  must(
    "D: resolved as a whole area (domain)",
    d.resolution.method === "domain",
    `method=${d.resolution.method}`,
  );
  must(
    "D: every seed belongs to the named area",
    d.resolution.seeds.every((s) => s.domain.toLowerCase() === area),
    `seeds: ${d.resolution.seeds.map((s) => `${s.slug}[${s.domain}]`).join(", ")}`,
  );
  should(
    "D: an area wish gives a broader scope than a topic wish",
    d.resolution.seeds.length >= a.resolution.seeds.length,
    `area seeds=${d.resolution.seeds.length}, topic seeds=${a.resolution.seeds.length}`,
  );
  await checkResult(graph, "D", d);

  // E. wishes that cannot be mapped must ask, not guess
  const unresolvable: Array<[string, string]> = [
    ["E1 nonsense", "make me a better person"],
    ["E2 only stopwords", "I want to get better at it"],
    ["E3 unknown area", "improve my quantum_gardening skills"],
    ["E4 empty", ""],
  ];
  for (const [label, wish] of unresolvable) {
    const e = await run(label, { developerId: DEVELOPER_ID, wish });
    must(
      `${label}: asks for clarification instead of guessing`,
      e.resolution.needsClarification &&
        e.clarification !== null &&
        e.topics.length === 0,
      `method=${e.resolution.method}; topics=${e.topics.length}`,
    );
    should(
      `${label}: offers suggestions to choose from`,
      (e.clarification?.suggestions.length ?? 0) > 0,
      `${e.clarification?.suggestions.length ?? 0} suggestion(s): ${(e.clarification?.suggestions ?? []).map((s) => s.name).join(", ")}`,
    );
  }

  // ---- comparisons between scenarios ----
  console.log("\n=== Cross-scenario behavior ===");
  should(
    "A vs B: typing the topic and naming it give the same seed topic",
    a.resolution.seeds.some((s) => s.slug === topicSlug) &&
      b.resolution.seeds[0]?.slug === topicSlug,
    `A seeds=${a.resolution.seeds.map((s) => s.slug).join(",")} | B seed=${b.resolution.seeds[0]?.slug}`,
  );
  if (otherRow) {
    const other = await buildGoalGraph(graph, {
      developerId: DEVELOPER_ID,
      wish: "x",
      goalTopics: [String(otherRow.slug)],
    });
    const topA = b.ranking
      .slice(0, 5)
      .map((n) => n.key)
      .join("|");
    const topO = other.ranking
      .slice(0, 5)
      .map((n) => n.key)
      .join("|");
    should(
      "Personalization: a different goal topic produces a different ranking",
      topA !== topO,
      `${topicSlug} vs ${String(otherRow.slug)}: ${topA === topO ? "identical top-5" : "top-5 differ"}`,
    );
  } else {
    record(
      "Personalization across topics",
      "WARN",
      "only one assessed topic; cannot compare rankings",
    );
  }
  should(
    "Evidence exists for the specific topic's neighbourhood",
    b.evidence.length > 0,
    `${b.evidence.length} demonstration(s); empty means no Topic-MAPS_TO->Capability<-Demonstration path for this developer`,
  );
  const stillUnproven = [d, b].flatMap((r) => r.signals.unproven);
  should(
    "Unproven areas are explained with reasons",
    stillUnproven.every((u) => u.reasons.length > 0),
    `${stillUnproven.length} unproven signal(s) checked`,
  );

  // ---- optional: storeNextMove ----
  if (WRITE) await testStoreNextMove(graph, b);
  else
    console.log(
      "\n(storeNextMove skipped: set GOAL_TEST_WRITE=1 to test writing a NextMove)",
    );

  // ---- summary ----
  section(
    "Scenario overview",
    [...results.entries()].map(([k, v]) => ({
      scenario: k,
      method: v.resolution.method,
      seeds: v.resolution.seeds.length,
      topics: v.topics.length,
      evidence: v.evidence.length,
      strengths: v.signals.strengths.length,
      unproven: v.signals.unproven.length,
      opportunities: v.signals.opportunities.length,
    })),
  );
  console.log("\nInterpretation guide:");
  console.log(
    "- signals are facts from the graph; the agent decides the next move.",
  );
  console.log(
    "- 'relevance' is Personalized PageRank closeness to the goal, it only orders context.",
  );
  console.log(
    "- no assessment or no demonstration means unproven, not unskilled.",
  );
  console.log(
    "- a vague wish must either resolve to a real area or ask for clarification.",
  );

  console.log("\n================ FINAL RESULT ================");
  console.table(observations.filter((o) => o.status !== "PASS"));
  console.log(
    `Checks: ${observations.length} | Warnings: ${warnings.length} | Failures: ${failures.length}`,
  );
  if (failures.length) {
    console.error("\nFAILED INVARIANTS:");
    for (const f of failures) console.error(f);
    throw new Error(`${failures.length} goal-graph invariant(s) failed`);
  }
  console.log(
    "PASS  Critical invariants hold. Review WARN findings as graph-data/coverage questions.",
  );
  console.log("==============================================\n");
}

// ------------------------------------------------------------
// optional write test
// ------------------------------------------------------------

async function testStoreNextMove(
  graph: Graph,
  base: GoalGraphResult,
): Promise<void> {
  console.log("\n=== storeNextMove (writes a clearly named test goal) ===");
  // unique wish so the test goal can never collide with a real one
  const testResult: GoalGraphResult = {
    ...base,
    wish: `__goal_graph_test__ ${Date.now()}`,
  };
  const strength = testResult.signals.strengths[0];
  const gap = testResult.signals.unproven[0];
  const focus = testResult.resolution.seeds[0]?.slug ?? null;
  const goodEvidence = testResult.evidence.slice(0, 2).map((e) => e.id);
  // a topic claimed as strength although none of its evidence is cited
  const uncitedStrength = testResult.signals.strengths.find(
    (s) => !testResult.evidence.slice(0, 2).some((e) => e.topicSlug === s.slug),
  );

  const outcome = await storeNextMove(graph, testResult, {
    title: "Test next move",
    summary: "Created by goal-graph.behavior.test.ts; safe to delete.",
    focusSlug: focus,
    strengthSlugs: [
      ...(strength ? [strength.slug] : []),
      ...(uncitedStrength ? [uncitedStrength.slug] : []),
      "not_a_real_topic",
    ],
    gapSlugs: gap ? [gap.slug] : [],
    evidenceIds: [...goodEvidence, "E9999"],
  });
  section("storeNextMove outcome", outcome);

  try {
    must("NextMove stored", outcome.stored, `goal=${outcome.goalId}`);
    must(
      "Unknown evidence id rejected",
      outcome.rejected.some((r) => r.includes("E9999")),
      outcome.rejected.join(" | "),
    );
    must(
      "Unknown topic rejected",
      outcome.rejected.some((r) => r.includes("not_a_real_topic")),
      "topic outside the goal graph was not linked",
    );
    if (uncitedStrength)
      must(
        "Strength without cited evidence rejected",
        outcome.rejected.some(
          (r) =>
            r.includes(uncitedStrength.slug) && r.includes("no cited evidence"),
        ),
        `${uncitedStrength.slug} was claimed but not backed`,
      );
    must(
      "Cited demonstrations were linked",
      outcome.links.demonstrations ===
        new Set(
          goodEvidence.map(
            (id) =>
              testResult.evidence.find((e) => e.id === id)?.demonstrationId,
          ),
        ).size,
      `${outcome.links.demonstrations} BACKED_BY demonstration edge(s) for ${goodEvidence.length} cited id(s)`,
    );

    const check = await queryRows(
      graph,
      `MATCH (d:Developer {id: $dev})-[:HAS_GOAL]->(g:Goal {id: $goal})-[:PROPOSES]->(m:NextMove)
       OPTIONAL MATCH (m)-[r]->(x)
       RETURN m.title AS title, type(r) AS rel, labels(x) AS labels, count(*) AS n
       ORDER BY rel`,
      { dev: DEVELOPER_ID, goal: outcome.goalId },
    );
    section("Stored path: Developer -> Goal -> NextMove -> ...", check);
    must(
      "Developer -> Goal -> NextMove path exists",
      check.length > 0,
      `${check.length} outgoing relation group(s)`,
    );
    must(
      "NextMove uses no BUILDS_ON",
      !check.some((r) => r.rel === "BUILDS_ON"),
      `relations: ${check.map((r) => r.rel).join(", ")}`,
    );

    // a second store replaces the move instead of stacking
    await storeNextMove(graph, testResult, {
      title: "Test next move (second)",
      summary: "replacement",
      focusSlug: focus,
      strengthSlugs: [],
      gapSlugs: [],
      evidenceIds: goodEvidence,
    });
    const moves = await queryRows(
      graph,
      `MATCH (:Goal {id: $goal})-[:PROPOSES]->(m:NextMove) RETURN count(m) AS n`,
      { goal: outcome.goalId },
    );
    must(
      "A goal keeps exactly one current NextMove",
      Number(moves[0]?.n ?? 0) === 1,
      `${moves[0]?.n} NextMove node(s)`,
    );
  } finally {
    if (KEEP) {
      console.log(`Keeping test goal ${outcome.goalId} (GOAL_TEST_KEEP=1).`);
    } else {
      await queryRows(
        graph,
        `MATCH (g:Goal {id: $goal})
         OPTIONAL MATCH (g)-[:PROPOSES]->(m:NextMove)
         DETACH DELETE m, g`,
        { goal: outcome.goalId },
      );
      const left = await queryRows(
        graph,
        `MATCH (g:Goal {id: $goal}) RETURN count(g) AS n`,
        { goal: outcome.goalId },
      );
      record(
        "Test goal cleaned up",
        Number(left[0]?.n ?? 0) === 0 ? "PASS" : "WARN",
        `${left[0]?.n} test Goal node(s) remain`,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error("\nFAIL  Pathway goal-graph behavior test failed:");
  console.error(error);
  process.exitCode = 1;
});
