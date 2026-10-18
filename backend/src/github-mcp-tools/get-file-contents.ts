import type { GithubMcpCall } from "./client.js";

const SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * get_file_contents resolves `ref` only as a branch / tag / refs/... name.
 * A commit SHA must be passed as `sha`, so a 40-hex `ref` is moved there.
 */
export function getFileContents(
  call: GithubMcpCall,
  args: Record<string, unknown>,
): Promise<any> {
  const { ref, ...rest } = args;
  const out: Record<string, unknown> = { ...rest };
  if (typeof ref === "string" && SHA_RE.test(ref) && out.sha === undefined)
    out.sha = ref;
  else if (ref !== undefined) out.ref = ref;
  return call("get_file_contents", out);
}
