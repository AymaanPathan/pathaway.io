import type { Demonstration } from "../graph/developer-knowledge-graph.js";

export interface EvidenceAssessment {
  demonstrationId: string;
  accepted: boolean;
  confidence: number;
  rationale: string;
}

/** Adapter for whichever LLM provider Pathway already uses. Keep provider code outside this module. */
export interface LearningReasoner {
  complete(input: { system: string; user: string }): Promise<string>;
}

const SYSTEM_PROMPT = `You are Pathway's code-evidence reviewer. Review detector-produced engineering demonstrations, not the developer as a person. Accept only evidence clearly supported by the supplied code snippet and metadata. Do not invent capabilities, techniques, repository facts, or source locations. You may only accept/reject each supplied demonstration; never change its ID or capability. Return ONLY JSON: {"assessments":[{"demonstrationId":"...","accepted":true,"confidence":0.0,"rationale":"..."}]}. confidence must be between 0 and 1.`;

function parseAssessments(raw: string): EvidenceAssessment[] {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(text) as { assessments?: unknown };
  if (!Array.isArray(parsed.assessments))
    throw new Error("Learning agent returned no assessments array");
  return parsed.assessments.map((item: any) => ({
    demonstrationId: String(item?.demonstrationId ?? ""),
    accepted: item?.accepted === true,
    confidence: Number(item?.confidence),
    rationale: String(item?.rationale ?? "").slice(0, 1000),
  }));
}

/**
 * Agent can judge only detector findings. It cannot create new graph entities or
 * rewrite detector-selected capability IDs. Missing/invalid model results fail closed.
 */
export async function assessDemonstrations(
  demonstrations: Demonstration[],
  reasoner: LearningReasoner,
  batchSize = 12,
): Promise<EvidenceAssessment[]> {
  const output: EvidenceAssessment[] = [];
  const size = Math.max(1, Math.min(30, Math.floor(batchSize)));

  for (let i = 0; i < demonstrations.length; i += size) {
    const batch = demonstrations.slice(i, i + size).map((d) => ({
      demonstrationId: d.id,
      capabilityId: d.capabilityId,
      technique: d.technique,
      summary: d.summary,
      modifiers: d.modifiers,
      depth: d.depth,
      path: d.path,
      language: d.language,
      snippet: d.snippet,
      commitSubject: d.commitSubject,
      permalink: d.permalink,
    }));
    const raw = await reasoner.complete({
      system: SYSTEM_PROMPT,
      user: JSON.stringify({ demonstrations: batch }),
    });
    const parsed = parseAssessments(raw);
    const allowed = new Set(batch.map((d) => d.demonstrationId));
    output.push(...parsed.filter((a) => allowed.has(a.demonstrationId)));
  }
  return output;
}
