import type {
  DataStoreKind,
  EnvKey,
  EnvReport,
  EnvironmentPlan,
  EvalMode,
  MockPlan,
  RepoProfile,
  ResolvedEnv,
  ServiceSetup,
} from "./types.js";
import { PROVISIONABLE_STORES, SRC_FILE, TEST_FILE } from "./utils.js";

const SECRETISH =
  /(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|CLIENT_ID)/i;
const LOCAL_SECRET =
  /^(JWT|SESSION|COOKIE|CSRF|ENCRYPTION|SIGNING|HMAC|APP|AUTH|NEXTAUTH)_?(SECRET|KEY)(_[A-Z0-9]+)?$|^SECRET(_KEY)?$/i;
const EXTERNAL =
  /(OPENAI|ANTHROPIC|STRIPE|TWILIO|SENDGRID|AWS_|GCP_|GOOGLE_|GITHUB_|SLACK|FIREBASE|SUPABASE|CLOUDINARY|MAILGUN|RESEND|PAYPAL|AUTH0|CLERK|SENTRY|DAYTONA|PINECONE|GROQ|GEMINI|COHERE|MISTRAL|SMTP)/i;
const PLACEHOLDER = /(your|change|replace|xxx|<|todo|example|insert|here)/i;
const IGNORED_ENV =
  /^(NODE_ENV|PORT|CI|HOME|PATH|SHELL|TZ|PWD|USER|LANG|HOSTNAME|DEBUG|FORCE_COLOR|NO_COLOR|NODE_OPTIONS|npm_.*|NEXT_RUNTIME|VERCEL.*)$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

export function dummyFor(key: string, hint = "", allowSecret = false): string {
  const k = key.toUpperCase();
  const h = hint.trim();
  if (h && !PLACEHOLDER.test(h) && !SECRETISH.test(k)) return h;

  if (k === "NODE_ENV") return "development";
  if (k === "PORT") return "4100";
  if (/^DB_PORT$|^POSTGRES_PORT$|^PG_PORT$/.test(k)) return "5432";
  if (/^REDIS_PORT$/.test(k)) return "6379";
  if (/^MYSQL_PORT$/.test(k)) return "3306";
  if (/(DB|DATABASE|POSTGRES|PG|MYSQL|REDIS)_(PASSWORD|USER|NAME)$/.test(k))
    return "mission";
  if (/(DATABASE|POSTGRES|PG|DB)_?(URL|URI)$|^DIRECT_URL$/.test(k))
    return "postgres://postgres:postgres@127.0.0.1:5432/mission";
  if (/MYSQL.*(URL|URI)$/.test(k))
    return "mysql://mission:mission@127.0.0.1:3306/mission";
  if (/MONGO.*(URL|URI)$/.test(k)) return "mongodb://127.0.0.1:27017/mission";
  if (/REDIS.*(URL|URI)$/.test(k)) return "redis://127.0.0.1:6379";
  if (/(^|_)HOST$/.test(k)) return "127.0.0.1";
  if (
    /(BASE_URL|APP_URL|PUBLIC_URL|FRONTEND_URL|CLIENT_URL|API_URL|ORIGIN|SITE_URL)$/.test(
      k,
    )
  )
    return "http://127.0.0.1:4100";
  if (/(ENABLED|DISABLE|DISABLED)$/.test(k)) return "false";
  if (/^LOG_LEVEL$/.test(k)) return "info";
  if (/(TIMEOUT|TTL|_MS$|_SECONDS$)/.test(k)) return "30";
  if (LOCAL_SECRET.test(k)) return "mission-dummy-secret-0123456789abcdef";
  if (allowSecret && SECRETISH.test(k))
    return `mission-dummy-${k.toLowerCase()}`;
  return "";
}

const SKIP_PATH =
  /(^|\/)(node_modules|dist|build|\.next|coverage|__mission__|tests?|__tests__)\//;
const EXAMPLE_FILES = [
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.local.example",
  ".env.development",
];

const underRoot = (path: string, root: string): boolean =>
  !root || path === root || path.startsWith(`${root}/`);

export function analyzeEnv(
  files: Map<string, string>,
  root: string,
  mode: EvalMode,
): EnvReport {
  const example = new Map<string, string>();
  for (const [path, content] of files) {
    const base = path.split("/").pop() ?? "";
    if (!EXAMPLE_FILES.includes(base) || !underRoot(path, root)) continue;
    for (const line of content.split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m) example.set(m[1], m[2].trim().replace(/^["']|["']$/g, ""));
    }
  }

  const used = new Map<string, { fallback: boolean }>();
  const re =
    /(?:process\.env\.|process\.env\[\s*["'`]|import\.meta\.env\.)([A-Z][A-Z0-9_]*)(["'`]\s*\])?(!?)(\s*(?:\|\||\?\?))?/g;
  for (const [path, content] of files) {
    if (!underRoot(path, root) || !SRC_FILE.test(path)) continue;
    if (SKIP_PATH.test(path) || TEST_FILE.test(path)) continue;
    for (const m of content.matchAll(re)) {
      const name = m[1];
      if (IGNORED_ENV.test(name)) continue;
      const prev = used.get(name);
      used.set(name, { fallback: Boolean(m[4]) || Boolean(prev?.fallback) });
    }
  }
  for (const k of example.keys())
    if (!used.has(k) && !IGNORED_ENV.test(k)) used.set(k, { fallback: false });

  const keys: EnvKey[] = [];
  for (const [name, info] of used) {
    const exVal = example.get(name) ?? "";
    const exUsable = exVal !== "" && !PLACEHOLDER.test(exVal);
    const hasFallback = info.fallback || exUsable;
    const external =
      SECRETISH.test(name) && !LOCAL_SECRET.test(name) && EXTERNAL.test(name);
    const dummy = dummyFor(name, exVal);
    const kind: EnvKey["kind"] = external
      ? "external"
      : dummy || LOCAL_SECRET.test(name)
        ? "auto"
        : "unknown";
    // blocking: needs a REAL third-party credential, has no default, and the
    // server must boot (http mode). In module mode tests mock the client.
    const blocking = external && !hasFallback && mode === "http";
    keys.push({
      name,
      hasFallback,
      kind,
      dummy,
      blocking,
      reason: blocking
        ? "A real third-party credential with no default; the server needs it to boot."
        : kind === "external"
          ? "Third-party credential, but a placeholder is enough for this mission."
          : kind === "auto"
            ? "A generated value is fine."
            : "No default found; left unset unless the app crashes without it.",
    });
  }
  keys.sort((a, b) => a.name.localeCompare(b.name));
  return { keys, blocking: keys.filter((k) => k.blocking), mode };
}

export function resolveEnv(
  report: EnvReport,
  provided: Record<string, string>,
  allowDummy: boolean,
  base: Record<string, string> = {},
): ResolvedEnv {
  const env: Record<string, string> = {};
  const filled: string[] = [];
  const given: string[] = [];
  const missing: EnvKey[] = [];

  for (const [k, v] of Object.entries(base)) {
    if (!ENV_NAME.test(k)) continue;
    env[k] = v;
    filled.push(k);
  }

  for (const [k, v] of Object.entries(provided)) {
    if (!ENV_NAME.test(k) || typeof v !== "string" || v.length > 4000) continue;
    env[k] = v;
    given.push(k);
    const i = filled.indexOf(k);
    if (i >= 0) filled.splice(i, 1);
  }

  for (const key of report.keys) {
    if (env[key.name] !== undefined) continue;
    if (key.blocking && !allowDummy) {
      missing.push(key);
      continue;
    }
    // module mode or allowed dummies: fake everything so imports never throw
    const fake =
      key.dummy ||
      (report.mode === "module" || allowDummy || key.kind === "external"
        ? dummyFor(key.name, "", true)
        : "");
    if (fake) {
      env[key.name] = fake;
      filled.push(key.name);
    }
  }
  return { env, missing, filled, provided: given };
}

const SU = `[ "$(id -u)" = 0 ] && S="" || S="sudo";`;
const AS_POSTGRES = `[ "$(id -u)" = 0 ] && PGRUN="su postgres -c" || PGRUN="sudo -u postgres sh -c";`;

function serviceFor(kind: DataStoreKind): ServiceSetup | null {
  switch (kind) {
    case "redis":
      return {
        name: "redis",
        kind,
        setup: [
          `${SU} command -v redis-server >/dev/null 2>&1 || { $S apt-get update -qq && $S apt-get install -y -qq redis-server; }`,
          "redis-server --daemonize yes --port 6379",
        ],
        ready: "redis-cli -h 127.0.0.1 -p 6379 ping | grep -q PONG",
        postInstall: [],
        env: {
          REDIS_URL: "redis://127.0.0.1:6379",
          REDIS_HOST: "127.0.0.1",
          REDIS_PORT: "6379",
        },
      };
    case "postgres":
      return {
        name: "postgres",
        kind,
        setup: [
          `${SU} command -v pg_ctlcluster >/dev/null 2>&1 || { $S apt-get update -qq && $S apt-get install -y -qq postgresql; }`,
          `${SU} $S service postgresql start || $S pg_ctlcluster "$(ls /etc/postgresql | head -n1)" main start`,
          `${AS_POSTGRES} $PGRUN "psql -c \\"ALTER USER postgres PASSWORD 'postgres'\\""`,
          `${AS_POSTGRES} $PGRUN "createdb mission" || true`,
        ],
        ready: "pg_isready -h 127.0.0.1 -p 5432",
        postInstall: [],
        env: {
          DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/mission",
          POSTGRES_URL: "postgres://postgres:postgres@127.0.0.1:5432/mission",
          DB_HOST: "127.0.0.1",
          DB_PORT: "5432",
          DB_USER: "postgres",
          DB_PASSWORD: "postgres",
          DB_NAME: "mission",
        },
      };
    case "mysql":
      return {
        name: "mysql",
        kind,
        setup: [
          `${SU} command -v mysqld >/dev/null 2>&1 || { $S apt-get update -qq && $S apt-get install -y -qq mariadb-server; }`,
          `${SU} $S service mariadb start || $S service mysql start`,
          `${SU} $S mysql -e "CREATE DATABASE IF NOT EXISTS mission; CREATE USER IF NOT EXISTS 'mission'@'%' IDENTIFIED BY 'mission'; GRANT ALL ON mission.* TO 'mission'@'%'; FLUSH PRIVILEGES;"`,
        ],
        ready: "mysqladmin ping -h 127.0.0.1 --silent",
        postInstall: [],
        env: {
          DATABASE_URL: "mysql://mission:mission@127.0.0.1:3306/mission",
          MYSQL_URL: "mysql://mission:mission@127.0.0.1:3306/mission",
          DB_HOST: "127.0.0.1",
          DB_PORT: "3306",
          DB_USER: "mission",
          DB_PASSWORD: "mission",
          DB_NAME: "mission",
        },
      };
    case "sqlite":
      return {
        name: "sqlite",
        kind,
        setup: [],
        ready: "true",
        postInstall: [],
        env: { DATABASE_URL: "file:./mission.db" },
      };
    default:
      return null;
  }
}

const PRISMA_PUSH = [
  "npx --yes prisma generate",
  "npx --yes prisma db push --skip-generate --accept-data-loss",
];

/** Services are only started for HTTP runs; module runs mock the clients instead. */
export function planServices(
  profile: RepoProfile,
  mode: EvalMode,
): { services: ServiceSetup[]; unprovisioned: DataStoreKind[] } {
  const services: ServiceSetup[] = [];
  const unprovisioned: DataStoreKind[] = [];
  if (mode !== "http") return { services, unprovisioned };

  for (const store of profile.dataStores) {
    if (!PROVISIONABLE_STORES.includes(store.kind)) {
      unprovisioned.push(store.kind);
      continue;
    }
    const svc = serviceFor(store.kind);
    if (!svc) continue;
    if (store.via === "prisma") svc.postInstall = [...PRISMA_PUSH];
    services.push(svc);
  }
  return { services, unprovisioned };
}

export function planMocks(profile: RepoProfile, mode: EvalMode): MockPlan[] {
  const out: MockPlan[] = [];
  const seen = new Set<string>();
  const add = (m: MockPlan) => {
    if (!seen.has(m.name)) {
      seen.add(m.name);
      out.push(m);
    }
  };

  if (mode === "module") {
    for (const s of profile.dataStores)
      if (s.via !== "prisma")
        add({
          name: s.via,
          kind: "module-mock",
          note: `${s.kind} client: mock it, never connect.`,
        });
    for (const name of profile.externalServices)
      add({
        name,
        kind: "module-mock",
        note: "Third-party SDK: mock it, never call the network.",
      });
  } else {
    for (const name of profile.externalServices)
      add({
        name,
        kind: "dummy-credential",
        note: "Third-party SDK: runs with a fake credential.",
      });
  }
  return out;
}

export function buildEnvironment(
  files: Map<string, string>,
  profile: RepoProfile,
  mode: EvalMode,
): EnvironmentPlan {
  const report = analyzeEnv(files, profile.root, mode);
  const { services, unprovisioned } = planServices(profile, mode);
  const mocks = planMocks(profile, mode);

  const serviceEnv: Record<string, string> = {};
  for (const s of services)
    for (const [k, v] of Object.entries(s.env))
      if (!(k in serviceEnv)) serviceEnv[k] = v;

  const notes: string[] = [];
  if (services.length)
    notes.push(
      `Starting in the sandbox: ${services.map((s) => s.name).join(", ")}.`,
    );
  if (unprovisioned.length)
    notes.push(
      `${unprovisioned.join(", ")} cannot be provisioned in the sandbox yet; criteria that need it are blocked.`,
    );

  return { report, services, mocks, serviceEnv, unprovisioned, notes };
}
