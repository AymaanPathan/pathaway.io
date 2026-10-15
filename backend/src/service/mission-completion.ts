import type { Graph } from "../db/falkordb.js";
import { MissionError, type Mission } from "../agents/plan-mission-agent.js";
import {
  CAPABILITY_BY_ID,
  findCapabilityGaps,
  getDeveloperGoal,
  loadDemonstrationRows,
  rollUpDemonstrations,
  storeDeveloperCapabilities,
} from "../graph/developer-knowledge-graph.js";
import { SKILL_TAXONOMY } from "../graph/skill-category-graph.js";

type AnyObject = Record<string, any>;

export type NodeState = "created" | "updated" | "existing";

export type CompletionNode = {
  id: string;
  kind:
    | "developer"
    | "mission"
    | "demonstration"
    | "capability"
    | "domain"
    | "repository"
    | "skill"
    | "goal";
  label: string;
  state: NodeState;
};

export type CompletionEdge = {
  from: string;
  to: string;
  type: string;
  state: NodeState;
};

type LevelState = { level: string; evidenceCount: number };

export type MissionCompletionResult = {
  fresh: boolean;
  completedAt: string;
  sha: string;
  commitMessage: string;
  checks: number;
  capability: {
    id: string;
    name: string;
    domainId: string;
    domainName: string;
    before: LevelState;
    after: LevelState;
    depth: "implementation" | "strong";
  };
  goal: {
    name: string;
    metBefore: number;
    metAfter: number;
    total: number;
  } | null;
  delta: { nodes: CompletionNode[]; edges: CompletionEdge[] };
  counts: { nodesCreated: number; relationshipsWritten: number };
  nextGap: {
    capabilityId: string;
    capabilityName: string;
    reason: string;
  } | null;
};

export type CompletionRun = {
  runId: string;
  sha: string;
  commitMessage: string;
  checks: number;
};

const MET_LEVELS = new Set(["implementation", "strong"]);
const locks = new Set<string>();
const listeners: Array<(developerId: string) => void> = [];

/** Lets index.ts invalidate its in-memory overview/opportunity caches. */
export function onMissionCompleted(fn: (developerId: string) => void) {
  listeners.push(fn);
}

async function q(
  graph: Graph,
  query: string,
  params: AnyObject = {},
): Promise<AnyObject[]> {
  const result = await graph.query(query, { params });
  return (result.data ?? []) as AnyObject[];
}

async function capabilityStates(
  graph: Graph,
  developerId: string,
  ids: string[],
): Promise<Map<string, LevelState>> {
  const rows = await q(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_CAPABILITY]->(c:Capability)
    WHERE c.id IN $ids
    RETURN c.id AS id, r.level AS level, r.evidence_count AS evidence_count
    `,
    { developer_id: developerId, ids },
  );
  const out = new Map<string, LevelState>(
    ids.map((id) => [id, { level: "missing", evidenceCount: 0 }]),
  );
  for (const r of rows) {
    out.set(String(r.id), {
      level: String(r.level || "missing"),
      evidenceCount: Number(r.evidence_count) || 0,
    });
  }
  return out;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "Express", "Node.js", "PostgreSQL" -> Skill ids from the taxonomy. */
function skillsFromStack(stack: string[]): string[] {
  const out = new Set<string>();
  for (const raw of stack) {
    const s = squash(raw);
    if (!s) continue;
    for (const def of SKILL_TAXONOMY) {
      const id = squash(def.id);
      const name = squash(def.name);
      if (s === id || s === name || (s.length >= 4 && name.startsWith(s))) {
        out.add(def.id);
      }
    }
  }
  return [...out].slice(0, 4);
}

/** Only returns completions that finished writing (result_json is set last). */
export async function getStoredCompletion(
  graph: Graph,
  developerId: string,
  missionId: string,
): Promise<MissionCompletionResult | null> {
  const rows = await q(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:COMPLETED]->(m:MissionCompletion {id: $mission_id})
    RETURN m.result_json AS json
    LIMIT 1
    `,
    { developer_id: developerId, mission_id: missionId },
  );
  const json = rows[0]?.json;
  if (!json || typeof json !== "string") return null;
  try {
    return { ...(JSON.parse(json) as MissionCompletionResult), fresh: false };
  } catch {
    return null;
  }
}

export async function completeMission(
  graph: Graph,
  developerId: string,
  mission: Mission,
  run: CompletionRun,
): Promise<MissionCompletionResult> {
  const stored = await getStoredCompletion(graph, developerId, mission.id);
  if (stored) return stored;

  if (locks.has(developerId)) {
    throw new MissionError("Your mission is already being recorded.");
  }
  locks.add(developerId);

  try {
    const ws = mission.workspace;
    if (!ws) throw new MissionError("Mission has no workspace.");

    const capId = mission.capabilityId;
    const cap = CAPABILITY_BY_ID.get(capId);
    if (!cap) throw new MissionError(`Unknown capability "${capId}".`);
    const domainId = cap.parentId ?? cap.id;
    const domainName = CAPABILITY_BY_ID.get(domainId)?.name ?? domainId;

    const now = new Date().toISOString();
    const missionNodeId = mission.id;
    const demoId = `mission:${mission.id}`;
    const repoId = `mission-fork:${ws.forkFullName}`;
    const commitUrl = `https://github.com/${ws.forkFullName}/commit/${run.sha}`;
    const skillIds = skillsFromStack(mission.repo.stack ?? []);

    // ---------- BEFORE ----------
    const beforeStates = await capabilityStates(graph, developerId, [
      capId,
      domainId,
    ]);
    const goalBefore = await getDeveloperGoal(graph, developerId);
    const prior = await q(
      graph,
      `
      MATCH (d:Developer {id: $developer_id})-[:COMPLETED]->(m:MissionCompletion)
      WHERE m.capability_id = $capability_id
        AND m.id <> $mission_id
        AND m.result_json IS NOT NULL
      RETURN count(m) AS n
      `,
      {
        developer_id: developerId,
        capability_id: capId,
        mission_id: missionNodeId,
      },
    );
    const depth: "implementation" | "strong" =
      Number(prior[0]?.n) > 0 ? "strong" : "implementation";
    const repoExisted =
      Number(
        (
          await q(
            graph,
            `MATCH (r:Repository {id: $id}) RETURN count(r) AS n`,
            {
              id: repoId,
            },
          )
        )[0]?.n,
      ) > 0;

    // ---------- WRITE (every statement is MERGE, so retries are safe) ----------
    await q(
      graph,
      `
      MATCH (d:Developer {id: $developer_id})
      MATCH (c:Capability {id: $capability_id})
      MERGE (m:MissionCompletion {id: $mission_id})
      SET m.developer_id = $developer_id,
          m.capability_id = $capability_id,
          m.capability_name = $capability_name,
          m.repo_full_name = $repo_full_name,
          m.fork_full_name = $fork_full_name,
          m.branch = $branch,
          m.sha = $sha,
          m.commit_message = $commit_message,
          m.checks_passed = $checks,
          m.run_id = $run_id,
          m.completed_at = $now
      WITH d, m, c
      MERGE (d)-[:COMPLETED]->(m)
      MERGE (m)-[:FOR_CAPABILITY]->(c)
      `,
      {
        developer_id: developerId,
        capability_id: capId,
        mission_id: missionNodeId,
        capability_name: mission.capabilityName,
        repo_full_name: mission.repo.fullName,
        fork_full_name: ws.forkFullName,
        branch: ws.branchName,
        sha: run.sha,
        commit_message: run.commitMessage,
        checks: run.checks,
        run_id: run.runId,
        now,
      },
    );

    await q(
      graph,
      `
      MATCH (d:Developer {id: $developer_id})
      MATCH (m:MissionCompletion {id: $mission_id})
      MATCH (c:Capability {id: $capability_id})
      MERGE (r:Repository {id: $repo_id})
      SET r.name = $repo_name,
          r.full_name = $fork_full_name,
          r.url = $fork_url,
          r.language = $language
      WITH d, m, c, r
      MERGE (e:EngineeringContext {id: "application_logic"})
      SET e.name = coalesce(e.name, "Application logic")
      WITH d, m, c, r, e
      MERGE (x:Demonstration {id: $demo_id})
      SET x.rule_id = "mission_verified",
          x.source = "mission",
          x.technique = $technique,
          x.summary = $summary,
          x.modifiers = "",
          x.depth = $depth,
          x.depth_rank = $depth_rank,
          x.commit_sha = $sha,
          x.file_change_id = "",
          x.repository_id = $repo_id,
          x.path = $path,
          x.language = $language,
          x.start_line = 0,
          x.end_line = 0,
          x.snippet = $snippet,
          x.permalink = $commit_url,
          x.change_intent = "feature",
          x.commit_subject = $commit_message,
          x.created_at = $now,
          x.developer_id = $developer_id,
          x.build_id = "mission"
      WITH d, m, c, r, e, x
      MERGE (d)-[:DEMONSTRATED]->(x)
      MERGE (x)-[:OF_CAPABILITY]->(c)
      MERGE (x)-[:IN_REPOSITORY]->(r)
      MERGE (x)-[:IN_CONTEXT]->(e)
      MERGE (m)-[:VERIFIED_BY]->(x)
      `,
      {
        developer_id: developerId,
        mission_id: missionNodeId,
        capability_id: capId,
        repo_id: repoId,
        repo_name: ws.forkFullName.split("/")[1] ?? ws.forkFullName,
        fork_full_name: ws.forkFullName,
        fork_url: ws.forkUrl,
        language: mission.repo.language ?? "",
        demo_id: demoId,
        technique: `Verified mission: ${mission.capabilityName}`,
        summary: `Passed ${run.checks} automated checks — ${mission.test.summary}`,
        depth,
        depth_rank: depth === "strong" ? 3 : 2,
        sha: run.sha,
        path: mission.test.filePath,
        snippet: ((mission.test as any).core?.map((c: any) => c.title) ?? [])
          .join("\n")
          .slice(0, 700),
        commit_url: commitUrl,
        commit_message: run.commitMessage.split("\n")[0].slice(0, 140),
        now,
      },
    );

    const linkedSkills = skillIds.length
      ? await q(
          graph,
          `
          MATCH (x:Demonstration {id: $demo_id})
          MATCH (r:Repository {id: $repo_id})
          MATCH (s:Skill)
          WHERE s.id IN $skill_ids
          MERGE (x)-[:USES]->(s)
          MERGE (s)-[sr:DEMONSTRATED_IN]->(r)
          SET sr.evidence_count = coalesce(sr.evidence_count, 1),
              sr.commit_count = coalesce(sr.commit_count, 1),
              sr.first_seen = coalesce(sr.first_seen, $now),
              sr.last_seen = $now,
              sr.evidence_path = $path,
              sr.commit_sha = $sha,
              sr.build_id = "mission"
          RETURN s.id AS id, s.name AS name
          `,
          {
            demo_id: demoId,
            repo_id: repoId,
            skill_ids: skillIds,
            now,
            path: mission.test.filePath,
            sha: run.sha,
          },
        )
      : [];

    if (goalBefore) {
      await q(
        graph,
        `
        MATCH (m:MissionCompletion {id: $mission_id})
        MATCH (g:Goal {id: $goal_id})
        MERGE (m)-[:ADVANCES]->(g)
        `,
        { mission_id: missionNodeId, goal_id: goalBefore.id },
      );
    }

    // Recompute this capability and its domain from ALL demonstrations.
    const allDemos = await loadDemonstrationRows(graph, developerId);
    const rollups = rollUpDemonstrations(allDemos).filter(
      (r) => r.capabilityId === capId || r.capabilityId === domainId,
    );
    await storeDeveloperCapabilities(graph, developerId, rollups);

    // ---------- AFTER ----------
    const afterStates = await capabilityStates(graph, developerId, [
      capId,
      domainId,
    ]);
    const goalAfter = await getDeveloperGoal(graph, developerId);
    const gaps = await findCapabilityGaps(graph, developerId, 5);
    const nextGap = gaps.find((g) => g.capabilityId !== capId) ?? null;

    const b = beforeStates.get(capId)!;
    const a = afterStates.get(capId)!;
    const bd = beforeStates.get(domainId)!;
    const ad = afterStates.get(domainId)!;
    const capChanged =
      b.level !== a.level || b.evidenceCount !== a.evidenceCount;
    const domChanged =
      bd.level !== ad.level || bd.evidenceCount !== ad.evidenceCount;
    const capState: NodeState = capChanged ? "updated" : "existing";
    const domState: NodeState = domChanged ? "updated" : "existing";

    // ---------- DELTA (drives the animation) ----------
    const nid = {
      dev: `dev:${developerId}`,
      mission: `mission:${missionNodeId}`,
      demo: demoId,
      cap: `cap:${capId}`,
      dom: `cap:${domainId}`,
      repo: repoId,
      goal: goalBefore ? `goal:${goalBefore.id}` : "",
    };

    const nodes: CompletionNode[] = [
      { id: nid.dev, kind: "developer", label: "You", state: "existing" },
      {
        id: nid.mission,
        kind: "mission",
        label: "Mission complete",
        state: "created",
      },
      {
        id: nid.demo,
        kind: "demonstration",
        label: "Verified proof",
        state: "created",
      },
      { id: nid.cap, kind: "capability", label: cap.name, state: capState },
      ...(domainId !== capId
        ? [
            {
              id: nid.dom,
              kind: "domain" as const,
              label: domainName,
              state: domState,
            },
          ]
        : []),
      {
        id: nid.repo,
        kind: "repository",
        label: ws.forkFullName.split("/")[1] ?? ws.forkFullName,
        state: repoExisted ? "existing" : "created",
      },
      ...linkedSkills.map((s) => ({
        id: `skill:${s.id}`,
        kind: "skill" as const,
        label: String(s.name),
        state: "existing" as NodeState,
      })),
      ...(goalBefore
        ? [
            {
              id: nid.goal,
              kind: "goal" as const,
              label: goalBefore.name,
              state: "updated" as NodeState,
            },
          ]
        : []),
    ];

    const edges: CompletionEdge[] = [
      { from: nid.dev, to: nid.mission, type: "COMPLETED", state: "created" },
      {
        from: nid.mission,
        to: nid.cap,
        type: "FOR_CAPABILITY",
        state: "created",
      },
      {
        from: nid.dev,
        to: nid.demo,
        type: "DEMONSTRATED",
        state: "created",
      },
      {
        from: nid.demo,
        to: nid.cap,
        type: "OF_CAPABILITY",
        state: "created",
      },
      {
        from: nid.demo,
        to: nid.repo,
        type: "IN_REPOSITORY",
        state: "created",
      },
      {
        from: nid.dev,
        to: nid.cap,
        type: "HAS_CAPABILITY",
        state: b.level === "missing" ? "created" : capState,
      },
      ...(domainId !== capId
        ? [
            {
              from: nid.cap,
              to: nid.dom,
              type: "SPECIALIZES",
              state: "existing" as NodeState,
            },
          ]
        : []),
      ...linkedSkills.flatMap((s) => [
        {
          from: nid.demo,
          to: `skill:${s.id}`,
          type: "USES",
          state: "created" as NodeState,
        },
        {
          from: `skill:${s.id}`,
          to: nid.repo,
          type: "DEMONSTRATED_IN",
          state: "created" as NodeState,
        },
      ]),
      ...(goalBefore
        ? [
            {
              from: nid.mission,
              to: nid.goal,
              type: "ADVANCES",
              state: "created" as NodeState,
            },
          ]
        : []),
    ];

    const countMet = (g: typeof goalBefore) =>
      g?.requirements.filter((r) => MET_LEVELS.has(r.level)).length ?? 0;

    const result: MissionCompletionResult = {
      fresh: true,
      completedAt: now,
      sha: run.sha,
      commitMessage: run.commitMessage,
      checks: run.checks,
      capability: {
        id: capId,
        name: cap.name,
        domainId,
        domainName,
        before: b,
        after: a,
        depth,
      },
      goal: goalAfter
        ? {
            name: goalAfter.name,
            metBefore: countMet(goalBefore),
            metAfter: countMet(goalAfter),
            total: goalAfter.requirements.length,
          }
        : null,
      delta: { nodes, edges },
      counts: {
        nodesCreated: nodes.filter((n) => n.state === "created").length,
        relationshipsWritten: edges.filter((e) => e.state === "created").length,
      },
      nextGap: nextGap
        ? {
            capabilityId: nextGap.capabilityId,
            capabilityName: nextGap.capabilityName,
            reason: nextGap.reason,
          }
        : null,
    };

    // Written LAST: its presence means everything above finished.
    await q(
      graph,
      `MATCH (m:MissionCompletion {id: $id}) SET m.result_json = $json`,
      { id: missionNodeId, json: JSON.stringify(result) },
    );

    for (const fn of listeners) {
      try {
        fn(developerId);
      } catch (err) {
        console.error("[mission-completion] listener failed:", err);
      }
    }

    console.log("[mission-completion] recorded", {
      developerId,
      missionId: missionNodeId,
      capability: capId,
      level: `${b.level} -> ${a.level}`,
      nodes: result.counts.nodesCreated,
      relationships: result.counts.relationshipsWritten,
    });

    return result;
  } finally {
    locks.delete(developerId);
  }
}
