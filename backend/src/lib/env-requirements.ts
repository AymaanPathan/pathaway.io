import { readRepoFile } from "../service/github.service.js";
import { dummyFor } from "../evaluations/mission-evaluation-agent.js";

export type Requirement = {
  key: string;
  reason: string;
  sensitive: boolean;
};

export type DepScan = {
  /** placeholder values Pathway fills in itself */
  auto: Record<string, string>;
  /** values only the user can provide */
  ask: Requirement[];
  /** every env key the source reads (used to match crash logs) */
  keys: string[];
};

/* ------------------------------------------------------------------ */
/* patterns                                                            */
/* ------------------------------------------------------------------ */

const CODE_FILE = /\.[cm]?[jt]s$/;
const SKIP_PATH =
  /(^|\/)(node_modules|dist|build|coverage|tests?|__tests__|scripts?)\/|\.(test|spec)\.|\.d\.ts$/;

// env reads usually live in these files, so scan them first
const PRIORITY =
  /(^|\/)(config|env|settings|constants|db|database|redis|server|index|app|main)[^/]*\.[cm]?[jt]s$/;
const MAX_FILES = 120;

// process.env.X, process.env["X"], with an optional `|| fallback` / `?? fallback`
const DIRECT =
  /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])(?:\s*(\|\||\?\?)\s*([^\n;]{0,80}))?/g;
// const { A, B = "x" } = process.env
const DESTRUCT = /\{([^}]+)\}\s*=\s*process\.env\b/g;
// import.meta.env.X
const IMPORT_META = /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g;
// Deno.env.get("X") ?? fallback
const DENO =
  /Deno\.env\.get\(\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\)(?:\s*(\|\||\?\?)\s*([^\n;]{0,80}))?/g;
// env("X") or env("X", default)  (config helpers, Laravel-style, etc.)
const ENV_FN =
  /\benv\(\s*['"]([A-Z][A-Z0-9_]*)['"]\s*(?:,\s*([^)\n]{0,80}))?\)/g;

const IGNORE = new Set(["NODE_ENV", "PORT", "HOST", "CI"]);
const KEY = /^[A-Z][A-Z0-9_]*$/;

/* ------------------------------------------------------------------ */
/* what a placeholder can never satisfy                                */
/* ------------------------------------------------------------------ */

// databases: the server connects at boot
const DB_KEY = /(DATABASE|DB|POSTGRES|PG|MONGO).*(URL|URI|STRING)$/;

// third-party services: a dummy boots fine, then fails on the first request
const THIRD_PARTY =
  /^(STRIPE|OPENAI|ANTHROPIC|SENDGRID|TWILIO|AWS|GOOGLE|GITHUB|FIREBASE|SUPABASE|CLERK|AUTH0|RESEND|MAILGUN|SLACK|DISCORD|CLOUDINARY|S3)_/;
const THIRD_PARTY_SECRET = /(KEY|SECRET|TOKEN|DSN|URL)$/;

const isDbKey = (k: string) => DB_KEY.test(k);
const isThirdPartyKey = (k: string) =>
  THIRD_PARTY.test(k) && THIRD_PARTY_SECRET.test(k);
const needsReal = (k: string) => isDbKey(k) || isThirdPartyKey(k);

// a fallback pointing at this machine is no fallback inside the sandbox
const LOCAL_FALLBACK = /localhost|127\.0\.0\.1|0\.0\.0\.0/i;
const EMPTY_FALLBACK = /^(""|''|``)/;

const isSensitive = (k: string) =>
  /(SECRET|KEY|TOKEN|PASSWORD|URL|URI|DSN|STRING)/.test(k);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ------------------------------------------------------------------ */
/* static scan                                                         */
/* ------------------------------------------------------------------ */

export async function analyzeDependencies(o: {
  token: string;
  repo: string;
  sha: string;
  root: string;
  paths: string[];
  provided: Record<string, string>;
  bootKeys: string[];
}): Promise<DepScan> {
  const files = o.paths
    .filter(
      (p) =>
        (!o.root || p.startsWith(o.root + "/")) &&
        CODE_FILE.test(p) &&
        !SKIP_PATH.test(p),
    )
    .sort(
      (a, b) =>
        Number(PRIORITY.test(b)) - Number(PRIORITY.test(a)) ||
        a.split("/").length - b.split("/").length,
    )
    .slice(0, MAX_FILES);

  // key -> true when EVERY use has a usable fallback
  const used = new Map<string, boolean>();
  const note = (key: string, fallback: boolean, fallbackText = "") => {
    if (!KEY.test(key)) return;
    const text = fallbackText.trim();
    // for databases and third-party keys, `|| "postgres://localhost/app"`
    // or `|| ""` does not help once the code runs in the sandbox
    const usable =
      fallback &&
      !(
        needsReal(key) &&
        (LOCAL_FALLBACK.test(text) || EMPTY_FALLBACK.test(text))
      );
    used.set(key, (used.get(key) ?? true) && usable);
  };

  for (let i = 0; i < files.length; i += 8) {
    const batch = await Promise.all(
      files
        .slice(i, i + 8)
        .map((f) => readRepoFile(o.token, o.repo, f, o.sha).catch(() => null)),
    );
    for (const src of batch) {
      if (!src) continue;

      for (const m of src.matchAll(DIRECT))
        note(m[1] ?? m[2], !!m[3], m[4] ?? "");

      for (const m of src.matchAll(DESTRUCT)) {
        for (const part of m[1].split(",")) {
          const name = part.split(/[:=]/)[0].trim();
          const eq = part.indexOf("=");
          note(name, eq >= 0, eq >= 0 ? part.slice(eq + 1) : "");
        }
      }

      for (const m of src.matchAll(IMPORT_META)) note(m[1], false);
      for (const m of src.matchAll(DENO)) note(m[1], !!m[2], m[3] ?? "");
      for (const m of src.matchAll(ENV_FN))
        note(m[1], m[2] !== undefined, m[2] ?? "");
    }
  }

  const auto: Record<string, string> = {};
  const ask: Requirement[] = [];

  for (const [key, hasFallback] of used) {
    if (IGNORE.has(key) || key in o.provided) continue;

    // Checked before bootKeys on purpose: a dummy value from .env.example
    // does not make a database or a third-party key work.
    if (needsReal(key) && !hasFallback) {
      ask.push({
        key,
        sensitive: true,
        reason: isDbKey(key)
          ? "Your server connects to this at startup, and Pathway can't host it for you. A free dev database (Neon, Atlas, Upstash) works."
          : "Your server uses this third-party service. A placeholder lets it boot but fails on the first request. If this mission never touches that service, try without it.",
      });
      continue;
    }

    if (!hasFallback && !o.bootKeys.includes(key)) {
      const v = dummyFor(key, "");
      if (v) auto[key] = v;
    }
  }

  // .env.example keys count too, so crash logs that mention them can be matched
  const keys = [
    ...new Set([...used.keys(), ...o.bootKeys.filter((k) => KEY.test(k))]),
  ];

  return { auto, ask, keys };
}

/* ------------------------------------------------------------------ */
/* crash log                                                           */
/* ------------------------------------------------------------------ */

// tokens that look like env names but are error codes, signals, etc.
const NOT_ENV = /^(E[A-Z]{3,}|ERR_.*|NODE_.*|TS\d+|SIG[A-Z]+|UTF_?8)$/;

/** Reads the server's own output and returns what the user must provide. */
export function needsFromServerLog(
  fullLog: string,
  known: string[],
  provided: Record<string, string>,
): Requirement[] {
  const i = fullLog.indexOf("── server output");
  const log = i >= 0 ? fullLog.slice(i) : fullLog;
  const knownSet = new Set(known);
  const out = new Map<string, Requirement>();

  const add = (key: string, reason: string) => {
    if (!KEY.test(key) || IGNORE.has(key)) return;
    if (out.has(key)) return;
    // a value the user already gave that still fails: ask again, say why
    const retry = key in provided;
    out.set(key, {
      key,
      sensitive: isSensitive(key),
      reason: retry
        ? "The value you gave didn't work. The server still failed on it. Check it and try again."
        : reason,
    });
  };

  const REFUSED = "Your server refused to start without this value.";

  // "X is required", "X is not set", "X must be defined", "X undefined"
  const PATTERN_A =
    /\b([A-Z][A-Z0-9_]{2,})\b[^\n]{0,40}(?:is required|not set|not defined|is missing|must be (?:set|defined)|undefined)/g;
  // "missing env X", "required: X", "undefined ... X"
  const PATTERN_B =
    /(?:missing|required|undefined|not set)[^\n]{0,40}\b([A-Z][A-Z0-9_]{2,})\b/gi;

  for (const m of log.matchAll(PATTERN_A))
    if (knownSet.has(m[1])) add(m[1], REFUSED);

  for (const m of log.matchAll(PATTERN_B)) {
    const k = m[1].toUpperCase() === m[1] ? m[1] : "";
    if (k && knownSet.has(k)) add(k, REFUSED);
  }

  // a placeholder was rejected at boot
  for (const k of known) {
    if (
      new RegExp(
        `${escapeRe(k)}[^\\n]{0,60}(invalid|unauthori[sz]ed|\\b401\\b)`,
        "i",
      ).test(log)
    )
      add(
        k,
        "A placeholder was rejected. Your server validates this at startup.",
      );
  }

  // unreachable database
  const pick = (re: RegExp, fallback: string) =>
    known.find((k) => re.test(k) && isDbKey(k)) ?? fallback;
  if (/ECONNREFUSED[^\n]{0,60}:5432/.test(log))
    add(
      pick(/DATABASE|POSTGRES|PG/, "DATABASE_URL"),
      "Your server needs a reachable Postgres database at boot.",
    );
  if (/ECONNREFUSED[^\n]{0,60}:27017/.test(log))
    add(
      pick(/MONGO/, "MONGODB_URI"),
      "Your server needs a reachable MongoDB at boot.",
    );

  // Last resort: the static scan missed the key, but the server names it clearly.
  // Only accept names that look like env variables (contain "_"), not error codes.
  if (out.size === 0) {
    for (const m of log.matchAll(PATTERN_A)) {
      const k = m[1];
      if (k.includes("_") && !NOT_ENV.test(k))
        add(k, "Not found in the code scan, but your server asked for it.");
    }
  }

  return [...out.values()];
}
