import type {
  MissionRepoPin,
  MissionSpec,
  Row,
} from "../graph/mission-graph.js";
import type {
  DataStore,
  DataStoreKind,
  ProjectTestInfo,
  RepoProfile,
  TestTool,
} from "./types.js";
import { SRC_FILE, TEST_FILE } from "./utils.js";

const FRONTEND_DEPS = [
  "next",
  "vite",
  "react-scripts",
  "@remix-run/dev",
  "nuxt",
  "astro",
];
const BACKEND_DEPS = [
  "express",
  "fastify",
  "koa",
  "@nestjs/core",
  "hono",
  "@hapi/hapi",
];

/** first match wins */
const FRAMEWORKS: Array<[string, string]> = [
  ["@nestjs/core", "nest"],
  ["next", "next"],
  ["fastify", "fastify"],
  ["express", "express"],
  ["koa", "koa"],
  ["hono", "hono"],
  ["@hapi/hapi", "hapi"],
  ["nuxt", "nuxt"],
  ["astro", "astro"],
  ["@remix-run/dev", "remix"],
  ["vite", "vite"],
  ["react-scripts", "cra"],
  ["react", "react"],
];

const STORE_DEPS: Array<[RegExp, DataStoreKind]> = [
  [
    /^(pg|postgres|pg-promise|@neondatabase\/serverless|@vercel\/postgres)$/,
    "postgres",
  ],
  [/^(mysql|mysql2)$/, "mysql"],
  [/^(mongodb|mongoose)$/, "mongodb"],
  [/^(redis|ioredis|@upstash\/redis|bullmq|bull)$/, "redis"],
  [/^(better-sqlite3|sqlite3|sqlite)$/, "sqlite"],
];

const EXTERNAL_DEPS =
  /^(openai|@anthropic-ai\/sdk|stripe|twilio|@sendgrid\/mail|nodemailer|resend|firebase-admin|firebase|@supabase\/supabase-js|cloudinary|@clerk\/.+|auth0|@sentry\/.+|@aws-sdk\/.+|aws-sdk|@google-cloud\/.+|googleapis|@slack\/.+|groq-sdk|@google\/generative-ai|cohere-ai|@mistralai\/mistralai|@pinecone-database\/pinecone)$/;

/** npm's default `echo "Error: no test specified" && exit 1` and friends */
const PLACEHOLDER_TEST = /no test specified|^\s*exit\s+1\s*$/i;

const SAFE_PATH = /^[A-Za-z0-9_@./-]+$/;

function directTestCommand(tools: TestTool[], file: string): string | null {
  if (!SAFE_PATH.test(file)) return null;
  if (tools.includes("vitest")) return `npx --yes vitest run ${file}`;
  if (tools.includes("jest")) return `npx --yes jest ${file}`;
  if (tools.includes("mocha")) return `npx --yes mocha ${file}`;
  return null;
}

export function analyzeRepository(
  files: Map<string, string>,
  spec: MissionSpec,
  pin: MissionRepoPin,
): RepoProfile {
  const root = pin.packageRoot ?? "";
  const at = (p: string) => (root ? `${root}/${p}` : p);
  const underRoot = (p: string) =>
    !root || p === root || p.startsWith(`${root}/`);
  const notes: string[] = [];

  /* ---- package.json ---- */
  let pkg: Row = {};
  const rawPkg = files.get(at("package.json"));
  if (rawPkg === undefined)
    notes.push("No package.json was found at the package root.");
  try {
    pkg = JSON.parse(rawPkg ?? "{}") ?? {};
  } catch {
    pkg = {};
    notes.push("package.json is not valid JSON.");
  }
  const depMap: Record<string, string> = {
    ...(typeof pkg.dependencies === "object" && pkg.dependencies
      ? pkg.dependencies
      : {}),
    ...(typeof pkg.devDependencies === "object" && pkg.devDependencies
      ? pkg.devDependencies
      : {}),
  };
  const deps = Object.keys(depMap);
  const has = (n: string) => n in depMap;
  const scripts: Record<string, string> =
    typeof pkg.scripts === "object" && pkg.scripts ? pkg.scripts : {};

  /* ---- package manager ---- */
  const lockfile =
    ["pnpm-lock.yaml", "yarn.lock", "package-lock.json"].find(
      (n) => files.has(at(n)) || files.has(n),
    ) ?? "";
  const packageManager: RepoProfile["packageManager"] =
    pin.packageManager === "pnpm" || pin.packageManager === "yarn"
      ? pin.packageManager
      : lockfile === "pnpm-lock.yaml"
        ? "pnpm"
        : lockfile === "yarn.lock"
          ? "yarn"
          : "npm";
  const run = (s: string) =>
    packageManager === "pnpm"
      ? `npx --yes pnpm run ${s}`
      : packageManager === "yarn"
        ? `npx --yes yarn ${s}`
        : `npm run ${s}`;
  const installCommand =
    packageManager === "pnpm"
      ? "npx --yes pnpm install"
      : packageManager === "yarn"
        ? "npx --yes yarn install"
        : lockfile === "package-lock.json"
          ? "npm ci --no-audit --no-fund --no-progress"
          : "npm install --no-audit --no-fund --no-progress";

  /* ---- framework + track ---- */
  const framework = FRAMEWORKS.find(([d]) => has(d))?.[1] ?? "none";
  const track: RepoProfile["track"] =
    FRONTEND_DEPS.some(has) && !BACKEND_DEPS.some(has) ? "frontend" : "backend";

  /* ---- how to boot ---- */
  let startCommand = "";
  const start = String(scripts.start ?? "");
  const dev = String(scripts.dev ?? "");
  if (track === "frontend" && scripts.build && start)
    startCommand = `${run("build")} && ${run("start")}`;
  else if (start && !/\b(dist|build)\//.test(start))
    startCommand = run("start");
  else if (dev) startCommand = run("dev");
  else if (start && scripts.build)
    startCommand = `${run("build")} && ${run("start")}`;
  else if (start) startCommand = run("start");

  /* ---- test tools ---- */
  const testTools: TestTool[] = [];
  if (has("vitest")) testTools.push("vitest");
  if (has("jest") || has("ts-jest") || has("@jest/globals"))
    testTools.push("jest");
  if (has("mocha")) testTools.push("mocha");
  if (has("@playwright/test") || has("playwright"))
    testTools.push("playwright");
  if (has("cypress")) testTools.push("cypress");
  if (has("supertest")) testTools.push("supertest");
  if (
    (pin.testRunner === "vitest" ||
      pin.testRunner === "jest" ||
      pin.testRunner === "mocha") &&
    !testTools.includes(pin.testRunner)
  )
    testTools.push(pin.testRunner);

  /* ---- data stores ---- */
  const stores: DataStore[] = [];
  const addStore = (kind: DataStoreKind, via: string) => {
    if (!stores.some((s) => s.kind === kind)) stores.push({ kind, via });
  };
  for (const d of deps)
    for (const [re, kind] of STORE_DEPS) if (re.test(d)) addStore(kind, d);

  const usesPrisma = has("prisma") || has("@prisma/client");
  if (usesPrisma) {
    const schemaPath = [...files.keys()].find(
      (p) => underRoot(p) && /(^|\/)prisma\/schema\.prisma$/.test(p),
    );
    const schema = schemaPath ? (files.get(schemaPath) ?? "") : "";
    const provider = /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/.exec(
      schema,
    )?.[1];
    if (provider === "postgresql" || provider === "postgres")
      addStore("postgres", "prisma");
    else if (provider === "mysql") addStore("mysql", "prisma");
    else if (provider === "sqlite") addStore("sqlite", "prisma");
    else if (provider === "mongodb") addStore("mongodb", "prisma");
    else
      notes.push(
        "Prisma is used but its datasource provider could not be read.",
      );
  }

  /* ---- third-party SDKs ---- */
  const externalServices = deps.filter((d) => EXTERNAL_DEPS.test(d));

  /* ---- the developer's own tests ---- */
  const script = String(scripts.test ?? "");
  const scriptStatus: ProjectTestInfo["status"] = !script.trim()
    ? "none"
    : PLACEHOLDER_TEST.test(script)
      ? "placeholder"
      : "configured";
  let projectTest: ProjectTestInfo = {
    status: scriptStatus,
    script,
    command: scriptStatus === "configured" ? run("test") : null,
    source: scriptStatus === "configured" ? "script" : "none",
  };
  if (scriptStatus !== "configured" && spec.verify.testFile) {
    const tf = spec.verify.testFile;
    if (files.has(tf)) {
      const rel =
        root && tf.startsWith(`${root}/`) ? tf.slice(root.length + 1) : tf;
      const command = directTestCommand(testTools, rel);
      if (command) projectTest = { ...projectTest, command, source: "direct" };
    }
  }
  if (scriptStatus === "placeholder")
    notes.push(
      "package.json still has npm's placeholder test script; it is reported as unconfigured, not as a failing test.",
    );

  /* ---- size ---- */
  let sourceFileCount = 0;
  for (const p of files.keys())
    if (underRoot(p) && SRC_FILE.test(p) && !TEST_FILE.test(p))
      sourceFileCount += 1;

  return {
    root,
    language:
      has("typescript") || files.has(at("tsconfig.json"))
        ? "typescript"
        : "javascript",
    packageManager,
    lockfile,
    framework,
    track,
    deps,
    scripts,
    testTools,
    installCommand,
    startCommand,
    dataStores: stores,
    usesPrisma,
    externalServices,
    projectTest,
    sourceFileCount,
    notes,
  };
}
