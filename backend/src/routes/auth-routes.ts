import crypto from "node:crypto";
import { Router } from "express";
import { getGraphForDeveloper } from "../db/falkordb.js";
import {
  getGithubAuthorizeUrl,
  exchangeCodeForToken,
  fetchGithubUser,
} from "../auth/github-oauth.js";
import {
  signSession,
  verifySession,
  SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
} from "../auth/session.js";
import { FRONTEND_URL } from "./route-context.js";

export const authRouter = Router();
authRouter.get("/auth/github", (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(getGithubAuthorizeUrl(state));
});
authRouter.get("/auth/github/callback", async (req, res) => {
  const code = String(req.query.code ?? ""),
    state = String(req.query.state ?? "");
  const expectedState = req.cookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE);
  if (!code || !state || state !== expectedState)
    return res.redirect(`${FRONTEND_URL}/?auth_error=invalid_state`);
  try {
    const accessToken = await exchangeCodeForToken(code),
      githubUser = await fetchGithubUser(accessToken);
    const developerId = String(githubUser.id),
      graph = await getGraphForDeveloper(developerId);
    await graph.query(
      `MERGE (d:Developer {id: $id}) SET d.username = $username, d.name = $name, d.avatar_url = $avatar_url, d.github_access_token = $token`,
      {
        params: {
          id: developerId,
          username: githubUser.login,
          name: githubUser.name ?? "",
          avatar_url: githubUser.avatar_url,
          token: accessToken,
        },
      },
    );
    const session = signSession({
      developerId,
      githubLogin: githubUser.login,
      avatarUrl: githubUser.avatar_url,
    });
    res.cookie(SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.redirect(`${FRONTEND_URL}/onboarding`);
  } catch (err) {
    console.error(err);
    return res.redirect(`${FRONTEND_URL}/?auth_error=oauth_failed`);
  }
});
authRouter.get("/auth/me", (req, res) => {
  const session = req.cookies?.[SESSION_COOKIE]
    ? verifySession(req.cookies[SESSION_COOKIE])
    : null;
  if (!session) return res.status(401).json({ authenticated: false });
  return res.json({
    authenticated: true,
    developerId: session.developerId,
    githubLogin: session.githubLogin,
    avatarUrl: session.avatarUrl,
  });
});
authRouter.post("/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});
