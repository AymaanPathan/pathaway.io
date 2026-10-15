import type { Request, Response, NextFunction } from "express";
import {
  verifySession,
  SESSION_COOKIE,
  type SessionPayload,
} from "../auth/session.js";

export interface AuthedRequest extends Request {
  developer?: SessionPayload;
}

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? verifySession(token) : null;

  if (!session) {
    res.status(401).json({ error: "Not authenticated. Connect GitHub first." });
    return;
  }

  req.developer = session;
  next();
}
