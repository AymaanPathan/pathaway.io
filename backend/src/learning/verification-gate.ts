import type { EvaluationOutcome } from "../evaluations/mission-evaluation-agent.js";

/**
 * The ONE gate that decides whether a mission may create capability evidence.
 * mission-learning.ts and mission-graph.ts must both call verifyMissionOutcome();
 * neither may check `verdict === "completed"` on its own.
 */
export interface VerificationInput {
  outcome: EvaluationOutcome;
  headSha: string;
  changedFilePaths: string[];
}

export interface VerificationDecision {
  verified: boolean;
  reasons: string[];
}

const FAILING_STATUSES = new Set([
  "failed",
  "fail",
  "failure",
  "error",
  "blocked",
  "pending",
  "timeout",
  "timed_out",
]);

function resultFailure(result: unknown, index: number): string | null {
  if (result === null || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const label = String(r.id ?? r.criterion ?? r.name ?? `#${index + 1}`);
  if (typeof r.passed === "boolean" && !r.passed)
    return `criterion ${label} did not pass`;
  if (typeof r.ok === "boolean" && !r.ok)
    return `criterion ${label} did not pass`;
  const status = String(r.status ?? r.verdict ?? r.outcome ?? "").toLowerCase();
  if (FAILING_STATUSES.has(status)) return `criterion ${label} is ${status}`;
  return null;
}

export function verifyMissionOutcome(
  input: VerificationInput,
): VerificationDecision {
  const { outcome, headSha, changedFilePaths } = input;
  const reasons: string[] = [];

  if (outcome.overall !== "passed")
    reasons.push(
      `overall result is "${String(outcome.overall)}", expected "passed"`,
    );
  if (outcome.verdict !== "completed")
    reasons.push(
      `verdict is "${String(outcome.verdict)}", expected "completed"`,
    );

  const results = (outcome as unknown as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) {
    reasons.push("evaluation has no criterion results");
  } else {
    results.forEach((result, index) => {
      const failure = resultFailure(result, index);
      if (failure) reasons.push(failure);
    });
  }

  if (!/^[0-9a-f]{7,64}$/i.test(headSha))
    reasons.push("head SHA is missing or malformed");
  if (!changedFilePaths.some(Boolean))
    reasons.push("no changed files to verify the evidence against");

  return { verified: reasons.length === 0, reasons };
}

export function isMissionVerified(input: VerificationInput): boolean {
  return verifyMissionOutcome(input).verified;
}

export function evaluationCiState(
  outcome: EvaluationOutcome,
): "success" | "pending" | "failure" {
  return outcome.overall === "passed"
    ? "success"
    : outcome.overall === "blocked"
      ? "pending"
      : "failure";
}
