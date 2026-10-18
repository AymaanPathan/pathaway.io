import {
  CAPABILITY_BY_ID,
  LEARNABLE_CAPABILITIES,
  buildDiscoveredDemonstration,
  eligibleAddedLines,
  extractDemonstrations,
  type Demonstration,
  type EvidenceContext,
  type EvidenceInput,
} from "../graph/developer-knowledge-graph.js";
import {
  cerebrasLearningReasoner,
  discoverCandidates,
  type DiscoveryFileInput,
  type LearningReasoner,
} from "./learning-agent.js";

export type LearningFileChange = EvidenceInput;
export type LearningContext = EvidenceContext;

export interface DiscoveryOptions {
  reasoner?: LearningReasoner;
  /** Cost guard: most file changes sent to the model in one run. */
  maxFiles?: number;
  onSkip?: (fileChangeId: string, reason: string) => void;
}

export interface ExtractionOptions {
  /** Omit to run the deterministic detectors only. */
  discovery?: DiscoveryOptions;
}

const CODE_PATH =
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs|swift|sql|vue|svelte)$/i;
const MIN_ADDED_LINES = 3;
const MAX_PROMPT_CHARS = 8000;

/** Reuses Pathway's deterministic detectors; no second taxonomy. */
export function extractEvidenceDeterministic(
  fileChanges: LearningFileChange[],
  contextByCommit: Map<string, LearningContext>,
): Demonstration[] {
  const byId = new Map<string, Demonstration>();
  for (const change of fileChanges) {
    const context = contextByCommit.get(
      `${change.repositoryId}:${change.commitSha}`,
    );
    if (!context) continue;
    for (const demonstration of extractDemonstrations(change, context)) {
      byId.set(demonstration.id, demonstration);
    }
  }
  return [...byId.values()];
}

function numberedAddedCode(change: LearningFileChange): string {
  let used = 0;
  const lines: string[] = [];
  for (const l of eligibleAddedLines(change)) {
    const row = `${l.line}| ${l.text}`;
    if (used + row.length > MAX_PROMPT_CHARS) break;
    lines.push(row);
    used += row.length + 1;
  }
  return lines.join("\n");
}

/**
 * 1) deterministic detectors, 2) LLM scout for work they missed,
 * 3) every LLM claim is rebuilt locally from the real added lines. A claim
 * that fails any check (capability, line range, verbatim quote, provenance)
 * is dropped. Survivors still go through the reviewer and validator.
 */
export async function extractEvidence(
  fileChanges: LearningFileChange[],
  contextByCommit: Map<string, LearningContext>,
  options: ExtractionOptions = {},
): Promise<Demonstration[]> {
  const deterministic = extractEvidenceDeterministic(
    fileChanges,
    contextByCommit,
  );
  const discovery = options.discovery;
  if (!discovery) return deterministic;

  const detectedByFile = new Map<string, Set<string>>();
  for (const d of deterministic) {
    const set = detectedByFile.get(d.fileChangeId) ?? new Set<string>();
    set.add(d.capabilityId);
    detectedByFile.set(d.fileChangeId, set);
  }

  const changeById = new Map<string, LearningFileChange>();
  const inputs: DiscoveryFileInput[] = [];
  const maxFiles = Math.max(1, discovery.maxFiles ?? 20);

  for (const change of fileChanges) {
    if (inputs.length >= maxFiles) break;
    if (!CODE_PATH.test(change.path)) continue;
    const context = contextByCommit.get(
      `${change.repositoryId}:${change.commitSha}`,
    );
    if (!context) continue;
    if (eligibleAddedLines(change).length < MIN_ADDED_LINES) continue;

    changeById.set(change.id, change);
    inputs.push({
      fileChangeId: change.id,
      path: change.path,
      language: change.language,
      commitSubject: context.commitMessage.split("\n")[0].trim().slice(0, 140),
      numberedAddedCode: numberedAddedCode(change),
      alreadyDetected: [...(detectedByFile.get(change.id) ?? [])],
    });
  }
  if (!inputs.length) return deterministic;

  const claims = await discoverCandidates(
    inputs,
    LEARNABLE_CAPABILITIES.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
    })),
    discovery.reasoner ?? cerebrasLearningReasoner,
    discovery.onSkip,
  );

  const byId = new Map(deterministic.map((d) => [d.id, d]));
  for (const claim of claims) {
    if (!CAPABILITY_BY_ID.has(claim.capabilityId)) continue;
    const change = changeById.get(claim.fileChangeId);
    if (!change) continue;
    const context = contextByCommit.get(
      `${change.repositoryId}:${change.commitSha}`,
    );
    if (!context) continue;

    const demo = buildDiscoveredDemonstration(change, context, claim);
    if (!demo) continue;
    // One discovered demonstration per capability per file change; keep the deeper one.
    const prev = byId.get(demo.id);
    if (!prev || (prev.depth === "usage" && demo.depth === "implementation"))
      byId.set(demo.id, demo);
  }
  return [...byId.values()];
}
