export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export function githubConnectUrl(): string {
  return `${API_URL}/auth/github`;
}

export interface MeResponse {
  authenticated: boolean;
  developerId?: string;
  githubLogin?: string;
  avatarUrl?: string;
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await fetch(`${API_URL}/auth/me`, { credentials: "include" });
  if (!res.ok) return { authenticated: false };
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}
