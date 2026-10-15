import { getGraphForDeveloper } from "../db/falkordb.js";

export function getGithubAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: process.env.GITHUB_OAUTH_CALLBACK_URL!,
    scope: "read:user repo",
    state,
    allow_signup: "true",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_OAUTH_CALLBACK_URL,
    }),
  });

  const data = (await res.json()) as { access_token?: string; error?: string };

  if (!data.access_token) {
    throw new Error(
      `GitHub OAuth exchange failed: ${data.error ?? "unknown error"}`,
    );
  }

  return data.access_token;
}

export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

export async function fetchGithubUser(
  accessToken: string,
): Promise<GithubUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub /user failed: ${res.status}`);
  }

  return res.json() as Promise<GithubUser>;
}





export async function getGithubToken(
  developerId: string,
): Promise<string | null> {
  const graph = await getGraphForDeveloper(developerId);

  const result = await graph.query(
    `
      MATCH (d:Developer {id: $developerId})
      RETURN d.github_access_token AS token
      LIMIT 1
    `,
    { params: { developerId } },
  );

  const token = (result.data?.[0] as { token?: unknown } | undefined)?.token;

  return typeof token === "string" && token.length > 0
    ? token
    : null;
}
