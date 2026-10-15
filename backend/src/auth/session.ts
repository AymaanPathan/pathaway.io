import jwt from "jsonwebtoken";

const SECRET = process.env.SESSION_JWT_SECRET ?? "dev-secret-change-me";

export const SESSION_COOKIE = "pathway_session";
export const OAUTH_STATE_COOKIE = "pathway_oauth_state";

export interface SessionPayload {
  developerId: string;
  githubLogin: string;
  avatarUrl: string;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: "7d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, SECRET) as SessionPayload;
  } catch {
    return null;
  }
}
