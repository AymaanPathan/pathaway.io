import { builtinModules } from "node:module";
import { createHmac, randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import { Daytona } from "@daytona/sdk";

import {
  dummyFor,
  MissionError,
  type EvalStepId,
  type ExecutionPlan,
  type StepStatus,
} from "../evaluations/mission-evaluation-agent.js";

const INSTALL_BUDGET_S = 480;
const INSTALL_ATTEMPT_MAX_S = 240;
const TEST_TIMEOUT_S = 180;
const DEV_TEST_TIMEOUT_S = 150;
const LOG_CAP = 200_000;
const PORT = 4100;
const BOOT_TRIES_BACKEND = 45;
// frontend boot includes `next build`, which can take minutes on one CPU
const BOOT_TRIES_FRONTEND = 180;
/** Hard wall-clock cap for everything that runs inside one sandbox (cleanup excluded). */
const OVERALL_BUDGET_S = 1500;
const DELETE_TRIES = 3;

const MAX_HEAL = 3;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const RESERVED_ENV = /^(PATH|HOME|SHELL|NODE_OPTIONS|PORT|CI)$/;

/* ------------------------------------------------------------------ */
/* explicit, test-only authentication                                  */
/* ------------------------------------------------------------------ */

/**
 * Authentication for HTTP missions is configured EXPLICITLY by the caller.
 * Nothing in the developer's code is patched, wrapped or guessed at: the real
 * auth middleware always runs. The mission test authenticates like a real client.
 *
 *  - "none": default. No credentials are provided; protected routes return 401
 *    and that is reported as a test failure.
 *  - "env":  the caller supplies exact env vars for the server and/or the test.
 *  - "jwt":  the runner mints a short-lived HS256 token with a per-run secret.
 *    The server receives the secret under `secretEnv`; the test receives the
 *    token (MISSION_AUTH_TOKEN) and the header value (MISSION_AUTH_HEADER).
 *
 * Credentials exist only inside the disposable sandbox, are never passed to
 * install / dev-test steps, and are redacted from every log.
 */
export type TestAuthSetup =
  | { kind: "none" }
  | {
      kind: "env";
      serverEnv?: Record<string, string>;
      testEnv?: Record<string, string>;
    }
  | {
      kind: "jwt";
      /** env var the server reads its signing secret from, e.g. JWT_SECRET */
      secretEnv: string;
      /** defaults to a random per-run secret */
      secret?: string;
      /** least privilege by default: no role is granted unless you pass one */
      claims?: Record<string, unknown>;
      /** env var the test reads the token from. Default MISSION_AUTH_TOKEN */
      tokenEnv?: string;
      /** default 3600 */
      expiresInS?: number;
    };

export interface BuiltTestAuth {
  serverEnv: Record<string, string>;
  testEnv: Record<string, string>;
  /** names only, never values */
  description: string;
}

function checkEnvMap(
  map: Record<string, string> | undefined,
  where: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map ?? {})) {
    if (!ENV_NAME.test(k) || RESERVED_ENV.test(k))
      throw new MissionError(`Invalid test auth env name "${k}" (${where}).`);
    out[k] = String(v);
  }
  return out;
}

const b64u = (value: Buffer | string) =>
  Buffer.from(value).toString("base64url");

export function signHs256Jwt(
  claims: Record<string, unknown>,
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
  ttlS = 3600,
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iat: nowS, exp: nowS + ttlS, ...claims };
  const data = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

export function buildTestAuth(spec?: TestAuthSetup): BuiltTestAuth {
  if (!spec || spec.kind === "none")
    return {
      serverEnv: {},
      testEnv: {},
      description: "none (real auth, no credentials)",
    };

  if (spec.kind === "env") {
    const serverEnv = checkEnvMap(spec.serverEnv, "serverEnv");
    const testEnv = checkEnvMap(spec.testEnv, "testEnv");
    return {
      serverEnv,
      testEnv,
      description: `env (server: ${Object.keys(serverEnv).join(",") || "-"}; test: ${Object.keys(testEnv).join(",") || "-"})`,
    };
  }

  const [secretEnv] = Object.keys(
    checkEnvMap({ [spec.secretEnv]: "x" }, "secretEnv"),
  );
  const tokenEnv = spec.tokenEnv ?? "MISSION_AUTH_TOKEN";
  checkEnvMap({ [tokenEnv]: "x" }, "tokenEnv");
  const secret = spec.secret || randomBytes(32).toString("hex");
  const ttl =
    Number.isFinite(spec.expiresInS) && (spec.expiresInS as number) > 0
      ? Math.floor(spec.expiresInS as number)
      : 3600;
  const token = signHs256Jwt(
    spec.claims ?? { sub: "pathway-test-user" },
    secret,
    Math.floor(Date.now() / 1000),
    ttl,
  );
  return {
    serverEnv: { [secretEnv]: secret },
    testEnv: { [tokenEnv]: token, MISSION_AUTH_HEADER: `Bearer ${token}` },
    description: `jwt (server secret: ${secretEnv}; test token: ${tokenEnv})`,
  };
}

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

// Sandboxes report the HOST cpu count while the container has a small memory
// limit. This preload makes Node see a single CPU so build workers are not OOM-killed.
const LIMIT_CPUS_JS = `const os = require("os");
const real = os.cpus;
os.cpus = () => real.call(os).slice(0, 1);
if (typeof os.availableParallelism === "function") os.availableParallelism = () => 1;
`;
const LIMIT_CPUS_PATH = "/tmp/limit-cpus.cjs";

const SERVER_TUNING = [
  `MAXB=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null)`,
  `case "$MAXB" in ''|max) HEAP=1536;; *) HEAP=$((MAXB/1024/1024*6/10));; esac`,
  `[ "$HEAP" -gt 6144 ] && HEAP=6144`,
  `[ "$HEAP" -lt 384 ] && HEAP=384`,
  `export NEXT_TELEMETRY_DISABLED=1`,
  `export NODE_OPTIONS="\${NODE_OPTIONS:-} --require ${LIMIT_CPUS_PATH} --max-old-space-size=$HEAP"`,
].join("; ");

const NPM_ENV: Record<string, string> = {
  npm_config_fetch_retries: "5",
  npm_config_fetch_retry_mintimeout: "2000",
  npm_config_fetch_retry_maxtimeout: "30000",
  npm_config_fetch_timeout: "120000",
  npm_config_maxsockets: "4",
  npm_config_progress: "false",
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
};

const RUNNER_INSTALL =
  "npm install --no-audit --no-fund --no-progress vitest@2";

// HTTP tests live under projectDir/__mission__ so source imports such as
// ../src/middleware/foo resolve relative to the repository, not mission-runner.
// Vitest itself remains installed in the separate runner folder.
const HTTP_RUNNER_CONFIG = `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["__mission__/mission.test.ts"], testTimeout: 20000, hookTimeout: 20000, environment: "node" } });
`;
// module mode: the test lives inside the project (__mission__/) so vi.mock()
// resolves the project's own node_modules.
const MODULE_RUNNER_CONFIG = `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["__mission__/mission.test.ts"], testTimeout: 20000, hookTimeout: 20000, environment: "node" } });
`;

/* ------------------------------------------------------------------ */
/* result types                                                        */
/* ------------------------------------------------------------------ */

/**
 *  none            the mission test ran to completion and exited 0
 *  tests_failed    the mission test ran and reported failures (a real test failure)
 *  project         the developer's project could not install / boot / compile
 *  timeout         a step exceeded its time budget (the code may hang)
 *  infrastructure  OUR environment failed (sandbox API, network, disk, memory, runner)
 *
 * Only "infrastructure" should be retried without the developer changing anything,
 * and it must never be counted as a failed mission attempt.
 */
export type FailureClass =
  | "none"
  | "tests_failed"
  | "project"
  | "timeout"
  | "infrastructure";

export type SandboxResult = {
  failedAt?: "install" | "extras" | "server";
  timedOut: boolean;
  /** true when the failure looks like OUR environment / network, not the developer's code */
  infra: boolean;
  failureClass: FailureClass;
  /** why the failure was classified as infrastructure; "" otherwise */
  infraReason: string;
  installExit: number;
  testExit: number | null;
  log: string;
  resultsRaw: string | null;
  /** the developer's own test command, run in their project */
  devTests: { ran: boolean; exit: number | null; out: string };
  durationMs: number;
  /** Mutated after the sandbox is torn down; check `deleted` before trusting the sandbox is gone. */
  cleanup: { deleted: boolean; attempts: number; error: string };
};

export type StepReporter = (
  id: EvalStepId,
  status: StepStatus,
  detail?: string,
  command?: string,
) => void;

/** The only parts of the Daytona client this module uses. Injectable for tests. */
export type SandboxClient = Pick<Daytona, "create" | "delete">;

let client: Daytona | null = null;
const daytona = () => (client ??= new Daytona());

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const secs = (ms: number) => (ms / 1000).toFixed(1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Sandbox = Awaited<ReturnType<Daytona["create"]>>;
type Step = {
  exitCode: number;
  out: string;
  timedOut: boolean;
  ms: number;
  /** the sandbox API call itself threw: nothing ran, so this is never the developer's fault */
  sandboxError: boolean;
};
type StepOpts = {
  /** also enforce the timeout INSIDE the sandbox so the process is killed, not just abandoned */
  enforce?: boolean;
  /** cleanup commands must run even when the overall budget is spent */
  ignoreDeadline?: boolean;
};
type Log = (m: string) => void;

const deadlines = new WeakMap<object, number>();

async function step(
  sandbox: Sandbox,
  command: string,
  cwd: string,
  timeoutS: number,
  opts: StepOpts = {},
): Promise<Step> {
  const started = Date.now();
  const deadline = deadlines.get(sandbox);
  if (deadline !== undefined && !opts.ignoreDeadline) {
    const left = Math.floor((deadline - started) / 1000);
    if (left <= 0)
      return {
        exitCode: -1,
        out: "overall sandbox time budget exhausted",
        timedOut: true,
        ms: 0,
        sandboxError: false,
      };
    timeoutS = Math.min(timeoutS, left);
  }

  const inner = `(${command}) 2>&1`;
  // `timeout` fires 6s before the API timeout, so the process tree is killed
  // by the sandbox and the API timeout is only a backstop.
  const innerLimit = Math.max(1, timeoutS - 6);
  const body = opts.enforce
    ? `if command -v timeout >/dev/null 2>&1; then timeout -k 5 ${innerLimit} bash -c ${shq(inner)}; else bash -c ${shq(inner)}; fi`
    : inner;

  try {
    const r = await sandbox.process.executeCommand(
      body,
      cwd,
      undefined,
      timeoutS,
    );
    const exitCode = typeof r.exitCode === "number" ? r.exitCode : -1;
    const ms = Date.now() - started;
    const threshold = opts.enforce ? timeoutS - 8 : timeoutS - 2;
    return {
      exitCode,
      out: String(r.result ?? ""),
      timedOut:
        (opts.enforce === true && exitCode === 124) ||
        (exitCode !== 0 && ms >= threshold * 1000),
      ms,
      sandboxError: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      exitCode: -1,
      out: msg,
      timedOut: /time(d)?\s?out/i.test(msg),
      ms: Date.now() - started,
      sandboxError: true,
    };
  }
}

const block = (label: string, cmd: string, out: string) =>
  `── ${label}\n$ ${cmd}\n${out}\n`;

const exportsOf = (env: Record<string, string>) =>
  Object.entries(env)
    .filter(([k]) => ENV_NAME.test(k))
    .map(([k, v]) => `export ${k}=${shq(v)}`)
    .join("; ");

const npmExports = () =>
  Object.entries(NPM_ENV)
    .map(([k, v]) => `export ${k}=${shq(v)}`)
    .join("; ");

const wrap = (env: Record<string, string>, cmd: string) => {
  const ex = exportsOf(env);
  return ex ? `${ex}; ${cmd}` : cmd;
};

const lastLines = (s: string, n: number) => s.split("\n").slice(-n).join("\n");

/** Replaces every env VALUE (len >= 6) with *** so secrets never reach the log the user sees. */
function redact(text: string, env: Record<string, string>): string {
  let out = text;
  const values = [...new Set(Object.values(env))]
    .filter((v) => v.length >= 6)
    .sort((a, b) => b.length - a.length);
  for (const v of values) out = out.split(v).join("***");
  return out;
}

const TREE_CMD =
  "find . -maxdepth 3 -not -path '*/node_modules*' -not -path '*/.git/*' -not -name '.git' | sort | head -120";

/* ------------------------------------------------------------------ */
/* failure classification                                              */
/* ------------------------------------------------------------------ */

// Errors that mean "npm itself or the network failed", not "your package.json is wrong".
const NPM_FLAKY =
  /Exit handler never called|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|ERR_SOCKET|Killed|ENOMEM|network/i;

// Resource exhaustion in the sandbox itself. Deliberately narrow: a test that
// cannot reach 127.0.0.1:5432 is the project's problem, not ours.
const RESOURCE_INFRA =
  /ENOSPC|No space left on device|ENOMEM|Cannot allocate memory|heap out of memory|JavaScript heap|\bKilled\b/i;

type Classified = {
  failureClass: FailureClass;
  infra: boolean;
  infraReason: string;
  timedOut: boolean;
};

const classified = (
  failureClass: FailureClass,
  infraReason = "",
  timedOut = false,
): Classified => ({
  failureClass,
  infra: failureClass === "infrastructure",
  infraReason: failureClass === "infrastructure" ? infraReason : "",
  timedOut,
});

/** Decides what a finished mission-test run means. */
export function classifyTestRun(
  test: Pick<Step, "exitCode" | "out" | "timedOut" | "sandboxError">,
  resultsRaw: string | null,
): Classified {
  if (test.sandboxError)
    return classified(
      "infrastructure",
      `sandbox command channel failed: ${test.out.slice(0, 200)}`,
    );
  if (test.timedOut) return classified("timeout", "", true);
  if (test.exitCode === 0) {
    return resultsRaw && resultsRaw.trim()
      ? classified("none")
      : classified(
          "infrastructure",
          "tests exited 0 but the runner wrote no results file",
        );
  }
  if (resultsRaw && resultsRaw.trim()) return classified("tests_failed");
  if (RESOURCE_INFRA.test(test.out))
    return classified("infrastructure", "sandbox ran out of memory or disk");
  return classified("project");
}

/* ------------------------------------------------------------------ */
/* dependency install: retry ladder                                    */
/* ------------------------------------------------------------------ */

const INSTALL_SYS_CMD = [
  'echo "node $(node -v) | npm $(npm -v)"',
  'echo "cpus: $(nproc 2>/dev/null)"',
  "(free -m 2>&1 | head -2) || true",
  "(df -h /tmp 2>&1 | tail -1) || true",
  `echo "cgroup memory limit: $(cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo unknown)"`,
].join("; ");

type InstallAttempt = { label: string; cmd: string };

function installLadder(plan: ExecutionPlan): InstallAttempt[] {
  if (plan.packageManager !== "npm") {
    return [
      { label: "primary", cmd: plan.installCommand },
      { label: "retry", cmd: plan.installCommand },
    ];
  }

  const hasLock = /\bnpm ci\b/.test(plan.installCommand);
  const flags = "--no-audit --no-fund --no-progress";
  const clean = "rm -rf node_modules";

  return [
    {
      label: "primary",
      cmd: hasLock ? `npm ci ${flags}` : `npm install ${flags}`,
    },
    {
      label: "clean retry (legacy peer deps, low concurrency)",
      cmd: `${clean}; npm cache verify >/dev/null 2>&1; npm install ${flags} --legacy-peer-deps --prefer-offline --maxsockets=2`,
    },
    {
      label: "newer npm (npm@10)",
      cmd: `${clean}; npx --yes npm@10 install ${flags} --legacy-peer-deps --maxsockets=2`,
    },
  ];
}

async function installDependencies(
  sandbox: Sandbox,
  plan: ExecutionPlan,
  cwd: string,
  dlog: Log,
): Promise<{
  exitCode: number;
  timedOut: boolean;
  flaky: boolean;
  ms: number;
  log: string;
}> {
  const started = Date.now();
  let log = "";

  const sys = await step(sandbox, INSTALL_SYS_CMD, cwd, 20);
  for (const l of sys.out.split("\n").filter(Boolean)) dlog(`install: ${l}`);
  log += block("install: environment", "node/npm/cpu/memory", sys.out);

  const ladder = installLadder(plan);
  let last: Step = {
    exitCode: -1,
    out: "",
    timedOut: false,
    ms: 0,
    sandboxError: false,
  };

  for (let i = 0; i < ladder.length; i++) {
    const remaining = INSTALL_BUDGET_S - (Date.now() - started) / 1000;
    if (remaining < 20) {
      dlog("install: time budget used up, no more attempts");
      break;
    }

    const attempt = ladder[i];
    const timeoutS = Math.floor(Math.min(INSTALL_ATTEMPT_MAX_S, remaining));
    dlog(
      `install: attempt ${i + 1}/${ladder.length} "${attempt.label}" (timeout ${timeoutS}s)`,
    );

    last = await step(
      sandbox,
      `${npmExports()}; ${attempt.cmd}`,
      cwd,
      timeoutS,
      { enforce: true },
    );
    dlog(
      `install: attempt ${i + 1} exit=${last.exitCode} in ${secs(last.ms)}s${last.timedOut ? " TIMED_OUT" : ""}`,
    );
    log += block(
      `install project dependencies (attempt ${i + 1}: ${attempt.label})`,
      attempt.cmd,
      lastLines(last.out, 80),
    );

    if (last.exitCode === 0)
      return {
        exitCode: 0,
        timedOut: false,
        flaky: false,
        ms: Date.now() - started,
        log,
      };

    if (last.timedOut) {
      dlog("install: attempt timed out, trying the next one if budget allows");
      continue;
    }

    if (!last.sandboxError && !NPM_FLAKY.test(last.out)) {
      dlog(
        "install: failed for a NON-flaky reason (bad package.json / lockfile / version). Not retrying.",
      );
      break;
    }

    dlog("install: npm or network failure looks transient, retrying");
    await sleep(2000 * (i + 1));
  }

  return {
    exitCode: last.exitCode === 0 ? 1 : last.exitCode,
    timedOut: last.timedOut,
    flaky: last.sandboxError || NPM_FLAKY.test(last.out),
    ms: Date.now() - started,
    log,
  };
}

/* ------------------------------------------------------------------ */
/* diagnostics helpers                                                 */
/* ------------------------------------------------------------------ */

const NETDIAG_JS = String.raw`const dns = require("dns");
const https = require("https");
const os = require("os");
const urls = process.argv.slice(2);
(async () => {
  console.log("node " + process.version + " | " + process.platform + " " + os.release());
  const keys = ["HTTP_PROXY","HTTPS_PROXY","NO_PROXY","http_proxy","https_proxy","no_proxy","PRISMA_ENGINES_MIRROR","PRISMA_BINARIES_MIRROR","NODE_EXTRA_CA_CERTS","NODE_TLS_REJECT_UNAUTHORIZED"];
  let any = false;
  for (const k of keys) {
    if (process.env[k]) {
      any = true;
      console.log("env " + k + "=" + String(process.env[k]).replace(/\/\/[^@\/]*@/, "//***@"));
    }
  }
  if (!any) console.log("env: no proxy / mirror / CA variables set");
  for (const u of urls) {
    const t0 = Date.now();
    let url;
    try { url = new URL(u); } catch (e) { console.log("PROBE " + u + " BAD_URL"); continue; }
    let ips = "?";
    try {
      const r = await dns.promises.lookup(url.hostname, { all: true });
      ips = r.map((x) => x.address).join(",");
    } catch (e) {
      console.log("PROBE " + u + " DNS_FAIL " + (e.code || e.message) + " " + (Date.now() - t0) + "ms");
      continue;
    }
    await new Promise((resolve) => {
      const req = https.request(u, { method: "HEAD", timeout: 10000 }, (res) => {
        console.log("PROBE " + u + " ips=" + ips + " HTTP " + res.statusCode + " " + (Date.now() - t0) + "ms");
        res.resume();
        resolve();
      });
      req.on("timeout", () => {
        console.log("PROBE " + u + " ips=" + ips + " TIMEOUT " + (Date.now() - t0) + "ms");
        req.destroy();
        resolve();
      });
      req.on("error", (e) => {
        console.log("PROBE " + u + " ips=" + ips + " ERROR " + (e.code || e.message) + " " + (Date.now() - t0) + "ms");
        resolve();
      });
      req.end();
    });
  }
})();
`;

const NET_PROBE_URLS = [
  "https://binaries.prisma.sh/",
  "https://registry.npmjs.org/",
  "https://github.com/",
  "https://registry.npmmirror.com/",
];

const SYS_DIAG_CMD = [
  "echo '--- uname'; uname -a",
  "echo '--- os-release'; head -3 /etc/os-release",
  "echo '--- openssl'; openssl version 2>&1",
  "echo '--- resolv.conf'; cat /etc/resolv.conf 2>&1",
  "echo '--- curl'; (curl --version 2>&1 | head -1) || echo 'curl not installed'",
  "echo '--- disk /tmp'; df -h /tmp 2>&1 | tail -1",
  "echo '--- memory'; free -m 2>&1 | head -2",
  "echo '--- date'; date -u",
].join("; ");

function classifyNet(out: string): string {
  if (/ENOTFOUND|EAI_AGAIN/.test(out))
    return "DNS resolution failed (the sandbox cannot resolve the host)";
  if (/ECONNRESET/.test(out))
    return "connection reset by peer (typical of an egress firewall / allowlist, or a flaky proxy)";
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|timed? ?out/i.test(out))
    return "connection timed out (packets dropped, typical of a firewall)";
  if (/ECONNREFUSED/.test(out))
    return "connection refused (host reachable but port closed / blocked)";
  if (/CERT_|SSL|TLS|self[- ]signed|unable to verify/i.test(out))
    return "TLS / certificate problem (possible intercepting proxy)";
  if (/\b(403|407)\b|Forbidden|Proxy Authentication/i.test(out))
    return "HTTP 403/407 (blocked by a proxy or policy)";
  if (/ENOSPC/.test(out)) return "sandbox disk is full";
  if (/ENOMEM|heap out of memory/i.test(out))
    return "sandbox ran out of memory";
  return "unknown (read the raw output above)";
}

function reachable(
  netdiagOut: string,
  host: string,
): "yes" | "no" | "not-probed" {
  const lines = netdiagOut.split("\n").filter((l) => l.includes(`//${host}`));
  if (!lines.length) return "not-probed";
  return lines.some((l) => /\bHTTP\s\d{3}\b/.test(l)) ? "yes" : "no";
}

/* ------------------------------------------------------------------ */
/* project setup: figure out what the repo needs, do it, self-heal     */
/* ------------------------------------------------------------------ */

const BUILTINS = new Set(builtinModules);
const SECRETISH =
  /(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|CLIENT_ID)/i;
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|0\.0\.0\.0|\[?::1\]?)$/;
const DUMMY_PG = "postgres://postgres:postgres@127.0.0.1:5432/mission";
const DUMMY_MYSQL = "mysql://mission:mission@127.0.0.1:3306/mission";
const SAFE_ID = /^[A-Za-z0-9_]{1,40}$/;
const SAFE_PASS = /^[A-Za-z0-9_.~-]{1,64}$/;

const SERVICE_DEPS: Record<string, string[]> = {
  redis: ["ioredis", "redis", "bullmq", "bull"],
  postgres: ["pg", "postgres", "pg-promise", "slonik"],
  mysql: ["mysql", "mysql2"],
  mongo: ["mongoose", "mongodb"],
};

const GEN_SCRIPTS = [
  "db:generate",
  "prisma:generate",
  "generate",
  "codegen",
  "gen",
];
const MIG_SCRIPTS = [
  "db:migrate",
  "migrate",
  "migrate:latest",
  "migrate:up",
  "migration:run",
  "db:push",
  "db:setup",
];
const BAD_SCRIPT = /\bseed\b|--watch|\bwatch\b|\bnodemon\b/i;

const CRASHED =
  /app crashed - waiting for file changes|\[ERROR\] \d{2}:\d{2}:\d{2} \w*Error|Failed to compile|ERR_MODULE_NOT_FOUND|Error: Cannot find module|did not initialize yet/;

const PRISMA_NET =
  /ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|binaries\.prisma\.sh/i;

// attempt 1+2: official host. attempt 3: community mirror (remove it if you
// do not want user code pulling engine binaries from a third party).
const ENGINE_MIRRORS = [
  "",
  "",
  "https://registry.npmmirror.com/-/binary/prisma",
];

type PrismaSchema = {
  path: string;
  provider: string;
  urlKey: string;
  hasMigrations: boolean;
};

const pkgName = (spec: string) =>
  spec.startsWith("@")
    ? spec.split("/").slice(0, 2).join("/")
    : spec.split("/")[0];

/* ---- prisma engines: download on OUR server, upload into the sandbox ---- */

const ENGINE_CACHE_DIR = nodePath.join(os.tmpdir(), "pathway-prisma-engines");
const PRISMA_CDN =
  process.env.PRISMA_ENGINES_CDN || "https://binaries.prisma.sh";
const ENGINE_DIR = "/tmp/prisma-engines";
const QUERY_ENGINE_PATH = `${ENGINE_DIR}/libquery_engine.so.node`;
const SCHEMA_ENGINE_PATH = `${ENGINE_DIR}/schema-engine`;

async function fetchEngine(
  commit: string,
  platform: string,
  file: string,
): Promise<Buffer> {
  const cacheFile = nodePath.join(
    ENGINE_CACHE_DIR,
    `${commit}-${platform}-${file}`,
  );
  try {
    return await fs.readFile(cacheFile);
  } catch {
    /* not cached yet */
  }
  const url = `${PRISMA_CDN}/all_commits/${commit}/${platform}/${file}.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = gunzipSync(Buffer.from(await res.arrayBuffer()));
  await fs.mkdir(ENGINE_CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile, buf).catch(() => {});
  return buf;
}

function makeSetup(
  sb: Sandbox,
  dir: string,
  env: Record<string, string>,
  plan: ExecutionPlan,
  dlog: Log,
) {
  let out = "";
  const done = new Set<string>();
  let sudoCache: string | null | undefined;
  let pkg: any;
  let pkgRead = false;
  let schemaCache: PrismaSchema | null | undefined;
  let netdiagUploaded = false;
  let preflightDone = false;
  let lastPreflightNet = "";

  const pmRun = (s: string) =>
    plan.packageManager === "pnpm"
      ? `npx --yes pnpm run ${s}`
      : plan.packageManager === "yarn"
        ? `npx --yes yarn ${s}`
        : `npm run ${s}`;

  const run = async (
    label: string,
    cmd: string,
    timeoutS = 120,
    tailN = 60,
  ) => {
    dlog(`setup: ${label} → start (timeout ${timeoutS}s)`);
    const r = await step(sb, wrap(env, cmd), dir, timeoutS);
    dlog(
      `setup: ${label} exit=${r.exitCode} in ${secs(r.ms)}s${r.timedOut ? " TIMED_OUT" : ""}`,
    );
    if (r.exitCode !== 0) {
      const errLines = r.out
        .split("\n")
        .filter((l) =>
          /error|fail|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|denied|refused|not found/i.test(
            l,
          ),
        )
        .slice(0, 6);
      for (const l of errLines)
        dlog(`setup: ${label} ! ${l.trim().slice(0, 300)}`);
    }
    out += block(`setup: ${label}`, cmd, lastLines(r.out, tailN));
    return r;
  };

  const once = async (key: string, fn: () => Promise<boolean>) => {
    if (done.has(key)) return false;
    done.add(key);
    return fn();
  };

  const getPkg = async () => {
    if (!pkgRead) {
      pkgRead = true;
      const r = await step(sb, "cat package.json", dir, 10);
      try {
        pkg = JSON.parse(r.out);
      } catch {
        pkg = null;
      }
    }
    return pkg;
  };

  const hasDep = (n: string) =>
    !!pkg &&
    (n in (pkg.dependencies ?? {}) || n in (pkg.devDependencies ?? {}));

  /* ---------- network + system diagnostics ---------- */

  const netDiag = async (label: string, urls: string[]): Promise<string> => {
    try {
      if (!netdiagUploaded) {
        await sb.fs.uploadFile(
          Buffer.from(NETDIAG_JS, "utf8"),
          "/tmp/netdiag.js",
        );
        netdiagUploaded = true;
      }
      const r = await step(
        sb,
        `node /tmp/netdiag.js ${urls.map(shq).join(" ")}`,
        dir,
        90,
      );
      dlog(`netdiag[${label}] exit=${r.exitCode} in ${secs(r.ms)}s`);
      for (const line of r.out.split("\n").filter(Boolean))
        dlog(`netdiag[${label}] ${line}`);
      out += block(
        `network diagnostics (${label})`,
        "node /tmp/netdiag.js …",
        r.out,
      );
      return r.out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dlog(`netdiag[${label}] could not run: ${msg}`);
      return "";
    }
  };

  const prismaPreflight = async () => {
    if (preflightDone) return;
    preflightDone = true;

    const sys = await step(sb, SYS_DIAG_CMD, dir, 20);
    dlog("preflight: system info");
    for (const l of sys.out.split("\n").filter(Boolean))
      dlog(`preflight: ${l}`);
    out += block(
      "preflight: system info",
      "uname/os-release/openssl/resolv.conf/…",
      sys.out,
    );

    const ver = await step(
      sb,
      `node -p ${shq(
        `const r=n=>{try{return require(n+'/package.json').version}catch(e){return 'NOT INSTALLED'}};'prisma='+r('prisma')+' | @prisma/client='+r('@prisma/client')+' | @prisma/engines='+r('@prisma/engines')`,
      )}`,
      dir,
      15,
    );
    dlog(`preflight: ${ver.out.trim()}`);
    out += block("preflight: prisma versions", "node -p …", ver.out);

    const gen = await step(
      sb,
      `p=$(find . -name schema.prisma -not -path '*/node_modules/*' | head -1); echo "schema: $p"; grep -n -A8 '^generator' "$p" 2>&1 | head -20`,
      dir,
      10,
    );
    for (const l of gen.out.split("\n").filter(Boolean))
      dlog(`preflight: ${l}`);
    out += block(
      "preflight: schema.prisma generator",
      "grep generator",
      gen.out,
    );

    const engines = await step(
      sb,
      `ls -la node_modules/@prisma/engines node_modules/.prisma/client 2>&1 | head -30`,
      dir,
      10,
    );
    for (const l of engines.out.split("\n").filter(Boolean))
      dlog(`preflight: ${l}`);
    out += block(
      "preflight: engine files before generate",
      "ls node_modules/…",
      engines.out,
    );

    lastPreflightNet = await netDiag("preflight", NET_PROBE_URLS);
    dlog(
      `preflight: reachable → binaries.prisma.sh=${reachable(lastPreflightNet, "binaries.prisma.sh")} | registry.npmjs.org=${reachable(lastPreflightNet, "registry.npmjs.org")} | github.com=${reachable(lastPreflightNet, "github.com")} | registry.npmmirror.com=${reachable(lastPreflightNet, "registry.npmmirror.com")}`,
    );
  };

  /* ---------- prisma engines staged from Pathway's server ---------- */

  let stagedEngines: boolean | undefined;

  const stagePrismaEngines = async (): Promise<boolean> => {
    if (stagedEngines !== undefined) return stagedEngines;
    stagedEngines = false;
    try {
      const ver = await step(
        sb,
        `node -e ${shq(
          `const p=require.resolve('@prisma/engines',{paths:[process.cwd()]});console.log(require(require.resolve('@prisma/engines-version',{paths:[p]})).enginesVersion)`,
        )}`,
        dir,
        20,
      );
      const commit = ver.out.trim().split("\n").pop()?.trim() ?? "";
      if (!/^[0-9a-f]{40}$/.test(commit)) {
        dlog(
          `prisma: could not read the engines commit (${commit.slice(0, 80) || "empty"}), not staging engines`,
        );
        return false;
      }

      const sys = await step(sb, "uname -m; openssl version 2>&1", dir, 10);
      const arm = /aarch64|arm64/.test(sys.out);
      const ssl = /OpenSSL 1\.1/.test(sys.out) ? "1.1.x" : "3.0.x";
      const platform = arm
        ? `linux-arm64-openssl-${ssl}`
        : `debian-openssl-${ssl}`;
      dlog(`prisma: staging engines commit=${commit} platform=${platform}`);

      const [query, schema] = await Promise.all([
        fetchEngine(commit, platform, "libquery_engine.so.node"),
        fetchEngine(commit, platform, "schema-engine"),
      ]);

      await step(sb, `mkdir -p ${ENGINE_DIR}`, dir, 10);
      await sb.fs.uploadFile(query, QUERY_ENGINE_PATH);
      await sb.fs.uploadFile(schema, SCHEMA_ENGINE_PATH);
      await step(
        sb,
        `chmod +x ${SCHEMA_ENGINE_PATH} ${QUERY_ENGINE_PATH}`,
        dir,
        10,
      );

      env.PRISMA_QUERY_ENGINE_LIBRARY = QUERY_ENGINE_PATH;
      env.PRISMA_SCHEMA_ENGINE_BINARY = SCHEMA_ENGINE_PATH;
      stagedEngines = true;
      dlog(
        `prisma: engines staged (${(query.length / 1e6).toFixed(1)} MB + ${(schema.length / 1e6).toFixed(1)} MB), sandbox will not download anything`,
      );
      return true;
    } catch (e) {
      dlog(
        `prisma: staging engines failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  };

  /* ---------- privileges + apt ---------- */

  const sudo = async (): Promise<string | null> => {
    if (sudoCache !== undefined) return sudoCache;
    const r = await step(
      sb,
      `if [ "$(id -u)" = 0 ]; then echo ROOT; elif sudo -n true 2>/dev/null; then echo SUDO; else echo NONE; fi`,
      dir,
      10,
    );
    sudoCache = r.out.includes("ROOT")
      ? ""
      : r.out.includes("SUDO")
        ? "sudo -n"
        : null;
    dlog(
      `setup: privileges=${sudoCache === null ? "none" : sudoCache || "root"}`,
    );
    return sudoCache;
  };

  const aptInstall = async (pkgs: string): Promise<boolean> => {
    const S = await sudo();
    if (S === null) {
      out += `cannot install ${pkgs}: no root or sudo in this sandbox\n`;
      dlog(`setup: cannot install ${pkgs}: no root or sudo`);
      return false;
    }
    const r = await run(
      `apt install ${pkgs}`,
      `${S} apt-get update -qq >/dev/null 2>&1; ${S} env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${pkgs} >/dev/null`,
      240,
    );
    return r.exitCode === 0;
  };

  /* ---------- env URL helpers ---------- */

  const urlsFor = (scheme: RegExp) => {
    const all: URL[] = [];
    for (const v of Object.values(env)) {
      if (!scheme.test(v)) continue;
      try {
        all.push(new URL(v));
      } catch {
        /* not a URL */
      }
    }
    return { all, local: all.filter((u) => LOCAL_HOST.test(u.hostname)) };
  };

  /* ---------- services ---------- */

  const ensureRedis = async (): Promise<boolean> => {
    const { all, local } = urlsFor(/^rediss?:\/\//);
    if (all.length && !local.length) {
      out +=
        "redis: your env points at a remote Redis, not starting a local one\n";
      dlog(
        "setup: redis env points at a remote host, not starting local redis",
      );
      return true;
    }
    const have = await step(sb, "command -v redis-server", dir, 5);
    if (have.exitCode !== 0 && !(await aptInstall("redis-server")))
      return false;
    const r = await run(
      "start redis",
      `redis-cli ping 2>/dev/null | grep -q PONG || redis-server --daemonize yes >/dev/null 2>&1; for i in 1 2 3 4 5 6 7 8; do redis-cli ping 2>/dev/null | grep -q PONG && echo "redis ready" && exit 0; sleep 1; done; exit 1`,
      40,
    );
    return r.exitCode === 0;
  };

  const ensurePostgres = async (): Promise<boolean> => {
    const { all, local } = urlsFor(/^postgres(ql)?:\/\//);
    if (all.length && !local.length) {
      out +=
        "postgres: your env points at a remote database, not starting a local one\n";
      dlog(
        "setup: postgres env points at a remote host, not starting local postgres",
      );
      return true;
    }
    let user = "postgres";
    let pass = "postgres";
    let db = "mission";
    const u = local[0];
    if (u) {
      const du = decodeURIComponent(u.username);
      const dp = decodeURIComponent(u.password);
      const dd = u.pathname.replace(/^\//, "");
      if (SAFE_ID.test(du)) user = du;
      if (SAFE_PASS.test(dp)) pass = dp;
      if (SAFE_ID.test(dd)) db = dd;
    }
    dlog(`setup: postgres will use user=${user} db=${db}`);

    const have = await step(
      sb,
      "ls /usr/lib/postgresql/*/bin/postgres >/dev/null 2>&1",
      dir,
      5,
    );
    if (
      have.exitCode !== 0 &&
      !(await aptInstall("postgresql postgresql-contrib"))
    )
      return false;

    const S = (await sudo()) ?? "";
    const sql = `DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${user}') THEN
    CREATE ROLE "${user}" LOGIN SUPERUSER PASSWORD '${pass}';
  ELSE
    ALTER ROLE "${user}" WITH LOGIN SUPERUSER PASSWORD '${pass}';
  END IF;
END $$;
SELECT 'CREATE DATABASE "${db}" OWNER "${user}"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db}')\\gexec
`;
    await sb.fs.uploadFile(Buffer.from(sql, "utf8"), "/tmp/pg-setup.sql");
    await step(sb, "chmod 644 /tmp/pg-setup.sql", dir, 5);

    const asPg =
      S === ""
        ? `su postgres -c 'cd /tmp && psql -f /tmp/pg-setup.sql'`
        : `cd /tmp && ${S} -u postgres psql -f /tmp/pg-setup.sql`;

    const r = await run(
      "start postgres",
      `${S} service postgresql start >/dev/null 2>&1 || ${S} pg_ctlcluster $(ls /etc/postgresql | head -1) main start; for i in $(seq 1 20); do pg_isready -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done; ${asPg}; PGPASSWORD=${shq(pass)} psql -h 127.0.0.1 -U ${user} -d ${db} -c 'select 1' >/dev/null && echo "postgres ready"`,
      90,
    );
    return r.exitCode === 0 && r.out.includes("postgres ready");
  };

  const ensureMysql = async (): Promise<boolean> => {
    const { all, local } = urlsFor(/^mysql:\/\//);
    if (all.length && !local.length) {
      out +=
        "mysql: your env points at a remote database, not starting a local one\n";
      dlog(
        "setup: mysql env points at a remote host, not starting local mysql",
      );
      return true;
    }
    let user = "mission";
    let pass = "mission";
    let db = "mission";
    const u = local[0];
    if (u) {
      const du = decodeURIComponent(u.username);
      const dp = decodeURIComponent(u.password);
      const dd = u.pathname.replace(/^\//, "");
      if (SAFE_ID.test(du) && du !== "root") user = du;
      if (SAFE_PASS.test(dp)) pass = dp;
      if (SAFE_ID.test(dd)) db = dd;
    }
    const have = await step(
      sb,
      "command -v mysqld || command -v mariadbd",
      dir,
      5,
    );
    if (have.exitCode !== 0 && !(await aptInstall("mariadb-server")))
      return false;
    const S = (await sudo()) ?? "";
    const sql = `CREATE DATABASE IF NOT EXISTS \`${db}\`;
CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY '${pass}';
CREATE USER IF NOT EXISTS '${user}'@'localhost' IDENTIFIED BY '${pass}';
GRANT ALL ON *.* TO '${user}'@'%';
GRANT ALL ON *.* TO '${user}'@'localhost';
FLUSH PRIVILEGES;
`;
    await sb.fs.uploadFile(Buffer.from(sql, "utf8"), "/tmp/my-setup.sql");
    await step(sb, "chmod 644 /tmp/my-setup.sql", dir, 5);
    const r = await run(
      "start mysql",
      `${S} service mariadb start >/dev/null 2>&1 || ${S} service mysql start >/dev/null 2>&1; for i in $(seq 1 20); do ${S} mysqladmin ping >/dev/null 2>&1 && break; sleep 1; done; ${S} mysql < /tmp/my-setup.sql && echo "mysql ready"`,
      90,
    );
    return r.exitCode === 0 && r.out.includes("mysql ready");
  };

  const ensureService = async (name: string): Promise<boolean> => {
    if (name === "redis") return ensureRedis();
    if (name === "postgres") return ensurePostgres();
    if (name === "mysql") return ensureMysql();
    out += `${name}: not supported in the sandbox yet\n`;
    dlog(`service ${name}: not supported in the sandbox yet`);
    return false;
  };

  /* ---------- prisma ---------- */

  const findSchema = async (): Promise<PrismaSchema | null> => {
    if (schemaCache !== undefined) return schemaCache;
    schemaCache = null;
    const f = await step(
      sb,
      `find . -name schema.prisma -not -path '*/node_modules/*' | head -1`,
      dir,
      15,
    );
    const path = f.out.trim().split("\n")[0]?.trim();
    if (!path) return null;
    const txt = (await step(sb, `cat ${shq(path)}`, dir, 10)).out;
    const provider =
      /datasource\s+\w+\s*\{[^}]*?provider\s*=\s*"(\w+)"/.exec(txt)?.[1] ?? "";
    const urlKey =
      /url\s*=\s*env\(\s*"(\w+)"\s*\)/.exec(txt)?.[1] ?? "DATABASE_URL";
    const mig = await step(
      sb,
      `[ -d "$(dirname ${shq(path)})/migrations" ] && echo yes`,
      dir,
      5,
    );
    schemaCache = {
      path,
      provider,
      urlKey,
      hasMigrations: mig.out.includes("yes"),
    };
    dlog(
      `setup: prisma schema ${path} provider=${provider || "?"} urlKey=${urlKey} migrations=${schemaCache.hasMigrations}`,
    );
    return schemaCache;
  };

  const PRISMA = `export PRISMA_HIDE_UPDATE_MESSAGE=1 CHECKPOINT_DISABLE=1; PRISMA=$([ -x node_modules/.bin/prisma ] && echo node_modules/.bin/prisma || echo "npx --yes prisma")`;

  const prismaRetry = async (
    label: string,
    body: string,
    timeoutS: number,
  ): Promise<boolean> => {
    await prismaPreflight();
    await stagePrismaEngines();

    let lastReason = "";
    for (let i = 0; i < ENGINE_MIRRORS.length; i++) {
      const mirror = ENGINE_MIRRORS[i];
      const tag =
        i === 0
          ? label
          : `${label} (retry ${i}${mirror ? `, mirror ${mirror}` : ""})`;

      const exports = [
        i > 0 ? `export DEBUG='prisma:*'` : "",
        mirror ? `export PRISMA_ENGINES_MIRROR=${shq(mirror)}` : "",
        "export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1",
      ]
        .filter(Boolean)
        .join("; ");

      dlog(
        `prisma: attempt ${i + 1}/${ENGINE_MIRRORS.length} of "${label}" using ${mirror || "official host (binaries.prisma.sh)"}`,
      );
      const r = await run(tag, `${PRISMA}; ${exports}; ${body}`, timeoutS, 150);

      if (r.exitCode === 0) {
        dlog(`prisma: "${label}" SUCCEEDED on attempt ${i + 1}`);
        return true;
      }

      lastReason = classifyNet(r.out);
      dlog(`prisma: "${tag}" FAILED. reason: ${lastReason}`);

      if (!PRISMA_NET.test(r.out)) {
        dlog(
          `prisma: "${label}" failed for a NON-network reason, not retrying. See the raw output block above.`,
        );
        return false;
      }

      if (i === 0) {
        const failedUrl = /https:\/\/[^\s'"]+/.exec(r.out)?.[0];
        const probe = await netDiag(
          `after first ${label} failure`,
          [failedUrl, ...NET_PROBE_URLS].filter(Boolean) as string[],
        );
        dlog(
          `prisma: after failure → binaries.prisma.sh=${reachable(probe, "binaries.prisma.sh")} | registry.npmjs.org=${reachable(probe, "registry.npmjs.org")} | registry.npmmirror.com=${reachable(probe, "registry.npmmirror.com")}`,
        );
      }

      if (i < ENGINE_MIRRORS.length - 1) {
        const wait = 2000 * (i + 1);
        dlog(`prisma: waiting ${wait}ms before the next attempt`);
        await sleep(wait);
      }
    }

    const bin = reachable(lastPreflightNet, "binaries.prisma.sh");
    const npm = reachable(lastPreflightNet, "registry.npmjs.org");
    const conclusion =
      bin === "no" && npm === "yes"
        ? "Prisma's CDN (binaries.prisma.sh) is unreachable from this sandbox while npm works. This is an egress / allowlist problem on the sandbox network, not a problem in the user's repo."
        : bin === "no" && npm === "no"
          ? "Neither binaries.prisma.sh nor registry.npmjs.org answered during preflight. The sandbox network itself looks broken."
          : bin === "yes"
            ? "binaries.prisma.sh answered during preflight, so the failure looks intermittent. Compare the timings in the netdiag blocks."
            : "Could not determine reachability. Read the netdiag blocks.";
    dlog(
      `prisma: ALL ${ENGINE_MIRRORS.length} attempts of "${label}" FAILED. Last reason: ${lastReason}`,
    );
    dlog(`prisma: CONCLUSION: ${conclusion}`);
    out += `── diagnosis (${label})\nlast reason: ${lastReason}\n${conclusion}\n\n`;
    return false;
  };

  const prismaGenerate = async (): Promise<boolean> => {
    const s = await findSchema();
    if (!s) return false;
    return prismaRetry(
      "prisma generate",
      `$PRISMA generate --schema ${shq(s.path)}`,
      180,
    );
  };

  const prismaSync = async (): Promise<boolean> => {
    const s = await findSchema();
    if (!s) return false;
    const p = shq(s.path);
    const push = `$PRISMA db push --skip-generate --accept-data-loss --schema ${p}`;
    const cmd =
      s.hasMigrations && s.provider !== "mongodb"
        ? `$PRISMA migrate deploy --schema ${p} || ${push}`
        : push;
    return prismaRetry("prisma database sync", cmd, 180);
  };

  /* ---------- generic codegen / migrations ---------- */

  const runScripts = async (
    names: string[],
    kind: string,
    handledPrisma: boolean,
  ) => {
    const scripts: Record<string, string> = pkg?.scripts ?? {};
    for (const n of names) {
      const body = String(scripts[n] ?? "");
      if (!body || BAD_SCRIPT.test(body)) continue;
      if (handledPrisma && /prisma/i.test(body)) {
        dlog(
          `setup: skipping script "${n}" (already handled by the prisma steps)`,
        );
        continue;
      }
      const r = await run(`${kind}: ${n}`, pmRun(n), 150);
      if (r.exitCode === 0) return true;
    }
    return false;
  };

  /* ---------- prepare: runs once, before the first boot ---------- */

  const detectServices = async (): Promise<string[]> => {
    const names = new Set<string>(plan.services);
    for (const [name, deps] of Object.entries(SERVICE_DEPS)) {
      if (deps.some(hasDep)) names.add(name);
    }
    const s = await findSchema();
    if (s) {
      if (/^(postgresql|cockroachdb)$/.test(s.provider)) names.add("postgres");
      else if (s.provider === "mysql") names.add("mysql");
      else if (s.provider === "mongodb") names.add("mongo");
      else if (s.provider === "sqlite") names.delete("postgres");
    }
    for (const v of Object.values(env)) {
      if (/^rediss?:\/\//.test(v)) names.add("redis");
      else if (/^postgres(ql)?:\/\//.test(v)) names.add("postgres");
      else if (/^mysql:\/\//.test(v)) names.add("mysql");
      else if (/^mongodb(\+srv)?:\/\//.test(v)) names.add("mongo");
    }
    return [...names];
  };

  /**
   * light = module mode: tests mock their clients, so no databases or
   * services are started. Only code generation runs (so imports resolve).
   */
  const prepare = async (opts: { light?: boolean } = {}) => {
    if (plan.track === "frontend") {
      dlog("setup: frontend mission — skipping backend infrastructure setup");
      await getPkg();
      return;
    }

    await getPkg();
    const s = await findSchema();

    if (opts.light) {
      dlog(
        "setup: module mode — code generation only, no services or migrations",
      );
      if (s) await once("prisma-generate", prismaGenerate);
      await runScripts(GEN_SCRIPTS, "codegen", !!s);
      return;
    }

    if (s) {
      const cur = env[s.urlKey] ?? "";
      if (s.provider === "sqlite" && !/^file:/.test(cur)) {
        env[s.urlKey] = "file:./mission.db";
        dlog(`setup: ${s.urlKey} set to a sqlite file url`);
      } else if (
        /^(postgresql|cockroachdb)$/.test(s.provider) &&
        !/^postgres(ql)?:\/\//.test(cur)
      ) {
        env[s.urlKey] = DUMMY_PG;
        dlog(`setup: ${s.urlKey} set to the local postgres dummy url`);
      } else if (s.provider === "mysql" && !/^mysql:\/\//.test(cur)) {
        env[s.urlKey] = DUMMY_MYSQL;
        dlog(`setup: ${s.urlKey} set to the local mysql dummy url`);
      } else {
        dlog(`setup: ${s.urlKey} already has a usable value`);
      }
    }

    const svcs = await detectServices();
    dlog(`setup: services needed=${svcs.join(",") || "(none)"}`);
    for (const svc of svcs) {
      const ok = await ensureService(svc);
      dlog(`setup: service ${svc} ${ok ? "ready" : "NOT available"}`);
    }

    if (s) {
      const ok = await once("prisma-generate", prismaGenerate);
      dlog(`setup: prisma generate overall result: ${ok ? "OK" : "FAILED"}`);
    }
    await runScripts(GEN_SCRIPTS, "codegen", !!s);

    if (s) {
      const ok = await once("prisma-sync", prismaSync);
      dlog(
        `setup: prisma database sync overall result: ${ok ? "OK" : "FAILED"}`,
      );
    } else {
      const ran = await runScripts(MIG_SCRIPTS, "migrate", false);
      if (!ran && hasDep("knex")) {
        const k = await step(sb, "ls knexfile.* 2>/dev/null", dir, 5);
        if (k.out.trim())
          await run("knex migrate", "npx --yes knex migrate:latest", 120);
      }
      if (!ran && hasDep("sequelize-cli")) {
        const q = await step(sb, "ls .sequelizerc 2>/dev/null", dir, 5);
        if (q.out.trim())
          await run(
            "sequelize migrate",
            "npx --yes sequelize-cli db:migrate",
            120,
          );
      }
    }
  };

  /* ---------- heal: read the crash log, fix what we can ---------- */

  const heal = async (logText: string): Promise<string[]> => {
    const actions: string[] = [];
    const act = async (
      key: string,
      label: string,
      fn: () => Promise<boolean>,
    ) => {
      if (done.has(key)) {
        dlog(`heal: "${label}" was already tried earlier, not repeating`);
        return;
      }
      done.add(key);
      dlog(`heal: trying "${label}"`);
      const ok = await fn();
      dlog(`heal: "${label}" ${ok ? "succeeded" : "FAILED"}`);
      actions.push(`${label}${ok ? "" : " (failed)"}`);
    };

    if (
      /@prisma\/client did not initialize|did not initialize yet|prisma generate|\.prisma\/client/i.test(
        logText,
      )
    ) {
      dlog("heal: crash log mentions an uninitialized prisma client");
      await act("prisma-generate", "prisma generate", prismaGenerate);
    }

    if (
      /P2021|P2022|does not exist in the current database|relation "[^"]+" does not exist|no such table/i.test(
        logText,
      )
    ) {
      dlog("heal: crash log mentions missing tables");
      await act("prisma-sync", "sync database schema", prismaSync);
    }

    if (
      /Can't reach database server|P1001|ECONNREFUSED[^\n]*:5432/.test(logText)
    ) {
      dlog("heal: crash log mentions an unreachable postgres");
      await act("svc-postgres", "start postgres", ensurePostgres);
      await act("prisma-sync-after-pg", "sync database schema", prismaSync);
    }
    if (/ECONNREFUSED[^\n]*:6379|redis[^\n]*ECONNREFUSED/i.test(logText)) {
      dlog("heal: crash log mentions an unreachable redis");
      await act("svc-redis", "start redis", ensureRedis);
    }
    if (/ECONNREFUSED[^\n]*:3306/.test(logText)) {
      dlog("heal: crash log mentions an unreachable mysql");
      await act("svc-mysql", "start mysql", ensureMysql);
    }

    // missing packages: only fix it when package.json already lists the
    // package (install was incomplete). If the user never declared it, that
    // is their bug and must stay visible.
    const missing = new Set<string>();
    for (const m of logText.matchAll(
      /Cannot find (?:module|package) '([^']+)'/g,
    )) {
      const spec = m[1];
      if (/^[./]/.test(spec) || spec.startsWith("node:")) continue;
      const name = pkgName(spec);
      if (BUILTINS.has(name) || !hasDep(name)) {
        dlog(
          `heal: "${name}" is missing but not declared in package.json, leaving it as the user's bug`,
        );
        continue;
      }
      missing.add(name);
    }
    if (missing.size) {
      const list = [...missing].slice(0, 5).join(" ");
      await act(`pkg-${list}`, `install ${list}`, async () => {
        const cmd =
          plan.packageManager === "pnpm"
            ? `npx --yes pnpm add ${list}`
            : plan.packageManager === "yarn"
              ? `npx --yes yarn add ${list}`
              : `npm install --no-audit --no-fund --no-progress ${list}`;
        return (await run("install missing packages", cmd, 180)).exitCode === 0;
      });
    }

    if (
      /Cannot find module '[^']*\b(?:dist|build)\//.test(logText) &&
      pkg?.scripts?.build
    ) {
      await act("build", "run build", async () => {
        return (await run("build", pmRun("build"), 240)).exitCode === 0;
      });
    }

    // env vars the code complains about. Real third-party secrets are NOT
    // faked here: the evaluation service already decided what to ask the user.
    const keys = new Set<string>();
    const res = [
      /Environment variable not found: ([A-Z_][A-Z0-9_]*)/g,
      /(?:[Mm]issing|[Rr]equired|[Uu]ndefined|not set)[^\n]{0,60}?\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g,
      /\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b[^\n]{0,40}?(?:is required|is not set|is missing|must be set|not defined|is undefined)/g,
    ];
    for (const re of res) for (const m of logText.matchAll(re)) keys.add(m[1]);
    const added: string[] = [];
    for (const k of keys) {
      if (!ENV_NAME.test(k) || RESERVED_ENV.test(k)) continue;
      if (env[k]) continue;
      const v = dummyFor(k, "", plan.allowSecretDummies === true);
      if (!v || (SECRETISH.test(k) && !plan.allowSecretDummies && !v)) continue;
      env[k] = v;
      added.push(k);
    }
    if (added.length) actions.push(`set placeholder env: ${added.join(", ")}`);

    if (!actions.length)
      dlog("heal: nothing in the crash log matched a known fix");

    return actions;
  };

  const flush = () => {
    const f = out;
    out = "";
    return f;
  };

  return {
    prepare,
    heal,
    flush,
    hasDep: async (n: string) => (await getPkg(), hasDep(n)),
  };
}

/* ------------------------------------------------------------------ */
/* server start + port discovery                                       */
/* ------------------------------------------------------------------ */

async function listening(sb: Sandbox, cwd: string): Promise<Set<number>> {
  const r = await step(
    sb,
    `(ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null | tail -n +3) | awk '{print $4}' | grep -Eo '[0-9]+$' | sort -u`,
    cwd,
    8,
  );
  return new Set(
    r.out
      .split("\n")
      .map((l) => Number(l.trim()))
      .filter(Boolean),
  );
}

async function probe(sb: Sandbox, cwd: string, port: number): Promise<boolean> {
  const js = `fetch("http://127.0.0.1:${port}/").then(r=>console.log("HTTP",r.status)).catch(()=>console.log("HTTP 0"))`;
  const r = await step(sb, `node -e ${shq(js)}`, cwd, 8);
  return /HTTP [1-5]\d\d/.test(r.out);
}

async function stopServer(sb: Sandbox, cwd: string) {
  await step(
    sb,
    `PID=$(cat /tmp/server.pid 2>/dev/null); if [ -n "$PID" ]; then kill -TERM -- -$PID 2>/dev/null; kill -TERM $PID 2>/dev/null; pkill -P $PID 2>/dev/null; sleep 1; kill -KILL -- -$PID 2>/dev/null; fi; true`,
    cwd,
    15,
    { ignoreDeadline: true },
  );
}

async function startServer(
  sb: Sandbox,
  startCommand: string,
  cwd: string,
  env: Record<string, string>,
  dlog: Log,
  tries: number,
): Promise<{ port: number | null; died: boolean }> {
  const before = await listening(sb, cwd);
  dlog(`server: starting with "${startCommand}" in ${cwd}`);
  dlog(
    `server: ports already listening before start: ${[...before].join(",") || "(none)"}`,
  );
  dlog(
    `server: env keys passed to the server: ${Object.keys(env).sort().join(", ") || "(none)"}`,
  );

  const ports = {
    PORT: String(PORT),
    SERVER_PORT: String(PORT),
    APP_PORT: String(PORT),
    HTTP_PORT: String(PORT),
  };
  const ex = exportsOf({ ...env, ...ports });

  await step(
    sb,
    `${ex}; ${npmExports()}; ${SERVER_TUNING}; setsid nohup bash -c ${shq(startCommand)} > /tmp/server.log 2>&1 < /dev/null & echo $! > /tmp/server.pid`,
    cwd,
    15,
  );

  for (let i = 0; i < tries; i++) {
    await sleep(1000);
    const nowListening = await listening(sb, cwd);
    const fresh = new Set([...nowListening].filter((p) => !before.has(p)));
    fresh.add(PORT);
    for (const p of fresh) {
      if (await probe(sb, cwd, p)) {
        dlog(`server answering on port ${p} after ~${i + 1}s`);
        return { port: p, died: false };
      }
    }
    // dev watchers stay alive after a crash, so the pid is not enough: read the log too.
    const st = await step(
      sb,
      "kill -0 $(cat /tmp/server.pid) 2>/dev/null && echo __alive__; tail -n 60 /tmp/server.log 2>/dev/null",
      cwd,
      8,
    );
    const alive = st.out.includes("__alive__");

    if (i % 5 === 4)
      dlog(`server: still waiting after ${i + 1}s | process alive=${alive}`);

    if (i >= 3 && !alive) {
      dlog("server process exited before it started listening");
      dlog(`server: last log lines:\n${lastLines(st.out, 20)}`);
      return { port: null, died: true };
    }
    if (i >= 2 && CRASHED.test(st.out)) {
      dlog("server logged a crash while starting");
      dlog(`server: crash marker matched: ${CRASHED.exec(st.out)?.[0] ?? "?"}`);
      dlog(`server: last log lines:\n${lastLines(st.out, 20)}`);
      return { port: null, died: true };
    }
  }
  dlog(`server: gave up after ${tries}s without an HTTP answer`);
  return { port: null, died: false };
}

/* ------------------------------------------------------------------ */
/* cleanup                                                             */
/* ------------------------------------------------------------------ */

/**
 * Stops the server, then deletes the sandbox with retries. Never throws.
 * A sandbox that cannot be deleted is reported loudly (it costs money and
 * holds the developer's code) and surfaced through `cleanup` on the result.
 */
async function destroySandbox(
  sandboxClient: SandboxClient,
  sandbox: Sandbox,
  dlog: Log,
  cleanup: SandboxResult["cleanup"],
): Promise<void> {
  await stopServer(sandbox, "/tmp").catch(() => {});
  const id = (sandbox as unknown as { id?: string }).id ?? "unknown";
  for (let attempt = 1; attempt <= DELETE_TRIES; attempt++) {
    cleanup.attempts = attempt;
    try {
      await sandboxClient.delete(sandbox);
      cleanup.deleted = true;
      cleanup.error = "";
      dlog(`sandbox deleted (attempt ${attempt})`);
      return;
    } catch (e) {
      cleanup.error = e instanceof Error ? e.message : String(e);
      dlog(
        `sandbox delete attempt ${attempt}/${DELETE_TRIES} failed: ${cleanup.error}`,
      );
      if (attempt < DELETE_TRIES) await sleep(1000 * attempt);
    }
  }
  const message = `SANDBOX LEAK: could not delete sandbox ${id} after ${DELETE_TRIES} attempts (${cleanup.error}). Remove it manually.`;
  dlog(message);
  console.error(`[sandbox] ${message}`);
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

export async function runInSandbox(opts: {
  plan: ExecutionPlan;
  tarball: Buffer;
  testContent: string;
  /**
   * @deprecated Ignored. Auth is no longer inferred from mission wording; pass
   * `testAuth` explicitly when the mission's tests need credentials.
   */
  missionText?: string;
  /** Explicit, test-only credentials for HTTP missions. Default: none (real auth, no credentials). */
  testAuth?: TestAuthSetup;
  skipDevTests?: boolean;
  /** resolved env (user-provided + generated). Values are redacted from the log. */
  env: Record<string, string>;
  onStep: StepReporter;
  /** Test seam. Production callers leave this unset. */
  daytona?: SandboxClient;
}): Promise<SandboxResult> {
  const { plan, tarball, testContent, env, onStep } = opts;
  if (!process.env.DAYTONA_API_KEY && !opts.daytona)
    throw new MissionError(
      "The test sandbox is not configured on the server (DAYTONA_API_KEY is missing).",
    );

  // Validate credentials BEFORE any sandbox exists, so a bad config can never leak one.
  const auth = buildTestAuth(opts.testAuth);
  const redactionEnv: Record<string, string> = {
    ...env,
    ...auth.serverEnv,
    ...auth.testEnv,
  };

  const started = Date.now();
  const d: SandboxClient = opts.daytona ?? daytona();
  const isHttp = plan.mode === "http";

  const diag: string[] = [];
  const dlog: Log = (m) => {
    const line = `[+${secs(Date.now() - started)}s] ${redact(m, redactionEnv)}`;
    diag.push(line);
    console.log(`[sandbox] ${line}`);
  };
  const diagBlock = () => `── sandbox diagnostics\n${diag.join("\n")}\n\n`;
  const clean = (s: string) => redact(s, redactionEnv);

  let log = "";
  const noDev = { ran: false, exit: null as number | null, out: "" };
  // Same object is returned in every result and mutated by destroySandbox().
  const cleanup: SandboxResult["cleanup"] = {
    deleted: false,
    attempts: 0,
    error: "",
  };
  const finish = (
    r: Omit<SandboxResult, "log" | "durationMs" | "cleanup">,
  ): SandboxResult => ({
    ...r,
    log: redact(diagBlock() + log, redactionEnv).slice(-LOG_CAP),
    durationMs: Date.now() - started,
    cleanup,
  });
  const bail = (
    failedAt: SandboxResult["failedAt"],
    o: {
      timedOut?: boolean;
      installExit?: number;
      failureClass: FailureClass;
      infraReason?: string;
      dev?: SandboxResult["devTests"];
    },
  ): SandboxResult =>
    finish({
      failedAt,
      timedOut: o.timedOut ?? false,
      infra: o.failureClass === "infrastructure",
      failureClass: o.failureClass,
      infraReason:
        o.failureClass === "infrastructure" ? (o.infraReason ?? "") : "",
      installExit: o.installExit ?? 0,
      testExit: null,
      resultsRaw: null,
      devTests: o.dev ?? noDev,
    });

  dlog(
    `plan: root="${plan.root}" pm=${plan.packageManager} mode=${plan.mode} track=${plan.track}`,
  );
  dlog(`plan: install=${plan.installCommand}`);
  dlog(`plan: start=${plan.startCommand || "(none)"}`);
  dlog(`plan: dev tests=${plan.projectTestCommand ?? "(no test script)"}`);
  // keys only: values may be secrets
  dlog(`mission env keys: ${Object.keys(env).sort().join(", ") || "(none)"}`);
  dlog(`test auth: ${auth.description}`);
  if (!isHttp && opts.testAuth && opts.testAuth.kind !== "none")
    dlog("test auth: ignored, module-mode missions do not start a server");
  dlog(`tarball: ${(tarball.length / 1024 / 1024).toFixed(1)} MB`);

  onStep(
    "sandbox",
    "running",
    "Creating an isolated Daytona sandbox. Your code never runs on our servers.",
  );
  let sandbox: Sandbox;
  try {
    sandbox = await d.create({
      language: plan.language,
      envVars: { CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
    });
  } catch (e) {
    onStep("sandbox", "failed", "Could not create the sandbox.");
    throw new MissionError(
      `Could not create the Daytona sandbox: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  deadlines.set(sandbox, started + OVERALL_BUDGET_S * 1000);
  dlog(
    `sandbox created (${(sandbox as unknown as { id?: string }).id ?? "no id"}); overall budget ${OVERALL_BUDGET_S}s`,
  );

  try {
    const home = (await sandbox.getWorkDir()) || "/home/daytona";
    const repoDir = `${home}/repo`;
    const projectDir = plan.root ? `${repoDir}/${plan.root}` : repoDir;
    const runnerDir = `${home}/mission-runner`;
    dlog(`paths: home=${home} project=${projectDir} runner=${runnerDir}`);

    await sandbox.fs.uploadFile(tarball, `${home}/repo.tgz`);
    const unpack = await step(
      sandbox,
      `mkdir -p repo && tar xzf repo.tgz --strip-components=1 -C repo && rm repo.tgz`,
      home,
      120,
    );
    if (unpack.exitCode !== 0) {
      dlog(`unpack FAILED: ${unpack.out.slice(0, 500)}`);
      throw new MissionError(
        "Could not unpack your branch inside the sandbox.",
      );
    }
    dlog(
      `repo tree:\n${(await step(sandbox, TREE_CMD, repoDir, 30)).out.trim()}`,
    );
    onStep("sandbox", "done", "Sandbox ready. Your commit is unpacked.");

    // ---- project dependencies (retry ladder) ----
    onStep(
      "install",
      "running",
      `Installing the dependencies your project declares, using ${plan.packageManager}. If the installer crashes or the network stalls, it retries with safer settings.`,
      plan.installCommand,
    );
    const install = await installDependencies(sandbox, plan, projectDir, dlog);
    dlog(`install exit=${install.exitCode} in ${secs(install.ms)}s`);
    log += install.log;
    if (install.exitCode !== 0 || install.timedOut) {
      onStep(
        "install",
        "failed",
        install.timedOut
          ? "Installing took too long and was stopped."
          : `The installer exited with code ${install.exitCode}. See the output below.`,
      );
      const infra = install.flaky || install.timedOut;
      return bail("install", {
        timedOut: install.timedOut,
        installExit: install.exitCode,
        failureClass: infra ? "infrastructure" : "project",
        infraReason: install.timedOut
          ? "dependency install exceeded its time budget (network or registry stall)"
          : "npm or the network failed while installing",
      });
    }
    onStep("install", "done", `Installed in ${secs(install.ms)}s.`);

    // Install-time and dev-test steps never see the test credentials.
    const bootEnv: Record<string, string> = { ...plan.bootEnv, ...env };
    const setup = makeSetup(sandbox, projectDir, { ...bootEnv }, plan, dlog);

    // ---- test runner ----
    if (isHttp) {
      onStep(
        "extras",
        "running",
        "Installing vitest in a separate folder. Your project is not touched.",
        RUNNER_INSTALL,
      );
      await step(sandbox, `mkdir -p ${shq(runnerDir)}`, home, 10);
      await sandbox.fs.uploadFile(
        Buffer.from(
          JSON.stringify({
            name: "mission-runner",
            private: true,
            type: "module",
          }),
        ),
        `${runnerDir}/package.json`,
      );
      await sandbox.fs.uploadFile(
        Buffer.from(HTTP_RUNNER_CONFIG, "utf8"),
        `${runnerDir}/vitest.config.mts`,
      );
      // Keep the runner dependency-isolated, but place the test beside the
      // repository so relative imports like ../src/middleware/rateLimiter
      // resolve against the actual project instead of /home/daytona/src.
      await step(
        sandbox,
        `mkdir -p ${shq(`${projectDir}/__mission__`)}`,
        home,
        10,
      );
      await sandbox.fs.uploadFile(
        Buffer.from(testContent, "utf8"),
        `${projectDir}/__mission__/mission.test.ts`,
      );
      const runner = await step(
        sandbox,
        `${npmExports()}; ${RUNNER_INSTALL}`,
        runnerDir,
        180,
        { enforce: true },
      );
      dlog(`runner install exit=${runner.exitCode} in ${secs(runner.ms)}s`);
      log += block("install test runner", RUNNER_INSTALL, runner.out);
      if (runner.exitCode !== 0) {
        onStep("extras", "failed", "Could not install the test runner.");
        return bail("extras", {
          timedOut: runner.timedOut,
          installExit: runner.exitCode,
          failureClass: "infrastructure",
          infraReason:
            "the isolated test runner (vitest) could not be installed",
        });
      }
      onStep("extras", "done", `Installed in ${secs(runner.ms)}s.`);
    } else {
      onStep(
        "extras",
        "running",
        "Checking that vitest is available in your project (it is installed without touching package.json if missing).",
      );
      const hasVitest = await step(
        sandbox,
        "[ -d node_modules/vitest ] && echo yes",
        projectDir,
        10,
      );
      if (!hasVitest.out.includes("yes")) {
        const cmd =
          plan.packageManager === "pnpm"
            ? "npx --yes pnpm add -D vitest@2"
            : plan.packageManager === "yarn"
              ? "npx --yes yarn add -D vitest@2"
              : "npm install --no-save --no-package-lock --no-audit --no-fund --no-progress vitest@2";
        const r = await step(
          sandbox,
          `${npmExports()}; ${cmd}`,
          projectDir,
          180,
          { enforce: true },
        );
        dlog(`vitest install exit=${r.exitCode} in ${secs(r.ms)}s`);
        log += block(
          "install vitest into the project",
          cmd,
          lastLines(r.out, 40),
        );
        if (r.exitCode !== 0) {
          onStep("extras", "failed", "Could not install vitest.");
          const infra = r.sandboxError || r.timedOut || NPM_FLAKY.test(r.out);
          return bail("extras", {
            timedOut: r.timedOut,
            installExit: r.exitCode,
            failureClass: infra ? "infrastructure" : "project",
            infraReason:
              "vitest could not be installed (npm or network failure)",
          });
        }
      }
      onStep("extras", "done", "Test runner ready.");
    }

    // ---- the developer's own tests (before the mission test is placed) ----
    let dev = noDev;
    if (plan.projectTestCommand && !opts.skipDevTests) {
      onStep(
        "devtests",
        "running",
        "Running the tests you wrote, with your project's own test command.",
        plan.projectTestCommand,
      );
      await setup.prepare({ light: true });
      log += setup.flush();
      const r = await step(
        sandbox,
        wrap(bootEnv, `${npmExports()}; ${plan.projectTestCommand}`),
        projectDir,
        DEV_TEST_TIMEOUT_S,
        { enforce: true },
      );
      dev = {
        ran: true,
        exit: r.exitCode,
        out: clean(lastLines(r.out, 120)),
      };
      dlog(`dev tests exit=${r.exitCode} in ${secs(r.ms)}s`);
      log += block(
        "your tests",
        plan.projectTestCommand,
        lastLines(r.out, 120),
      );
      onStep(
        "devtests",
        r.exitCode === 0 ? "done" : "failed",
        r.exitCode === 0
          ? `Your tests passed in ${secs(r.ms)}s.`
          : r.timedOut
            ? "Your tests did not finish in time."
            : "Your tests failed. See the output below.",
      );
    } else {
      dlog(
        opts.skipDevTests
          ? "dev tests: skipped by the caller"
          : "dev tests: package.json has no test script",
      );
      onStep(
        "devtests",
        "skipped",
        opts.skipDevTests
          ? "Skipped: only the mission tests run."
          : "package.json has no test script, so your own tests were not run.",
      );
    }

    // ---- place the mission test ----
    if (!isHttp) {
      await step(
        sandbox,
        `mkdir -p ${shq(`${projectDir}/__mission__`)}`,
        home,
        10,
      );
      await sandbox.fs.uploadFile(
        Buffer.from(MODULE_RUNNER_CONFIG, "utf8"),
        `${projectDir}/__mission__/vitest.config.mts`,
      );
      await sandbox.fs.uploadFile(
        Buffer.from(testContent, "utf8"),
        `${projectDir}/__mission__/mission.test.ts`,
      );
    }

    const readResults = async (path: string): Promise<string | null> => {
      try {
        const raw = (await sandbox.fs.downloadFile(path)).toString("utf8");
        dlog(`results file read (${raw.length} chars)`);
        return clean(raw);
      } catch {
        dlog(`results file NOT found at ${path}`);
        return null;
      }
    };

    // ================= module mode: no server =================
    if (!isHttp) {
      onStep(
        "server",
        "skipped",
        "This mission is verified by calling your code directly, so no server is started.",
      );
      await setup.prepare({ light: true });
      log += setup.flush();

      onStep(
        "test",
        "running",
        "Running the mission's test file against your code.",
        plan.testCommand,
      );
      const test = await step(
        sandbox,
        wrap(
          { ...bootEnv, NODE_ENV: bootEnv.NODE_ENV ?? "test" },
          `${npmExports()}; ${plan.testCommand}`,
        ),
        projectDir,
        TEST_TIMEOUT_S,
        { enforce: true },
      );
      dlog(
        `tests exit=${test.exitCode} timedOut=${test.timedOut} in ${secs(test.ms)}s`,
      );
      log += block("run tests", plan.testCommand, test.out);
      const resultsRaw = await readResults(`${projectDir}/${plan.resultsFile}`);
      const verdict = classifyTestRun(test, resultsRaw);
      dlog(
        `test run classified as ${verdict.failureClass}${verdict.infraReason ? `: ${verdict.infraReason}` : ""}`,
      );
      onStep(
        "test",
        test.timedOut ? "failed" : "done",
        test.timedOut
          ? "The tests did not finish in time and were stopped."
          : `Test run finished in ${secs(test.ms)}s.`,
      );
      return finish({
        timedOut: verdict.timedOut,
        infra: verdict.infra,
        failureClass: verdict.failureClass,
        infraReason: verdict.infraReason,
        installExit: install.exitCode,
        testExit: test.exitCode,
        resultsRaw,
        devTests: dev,
      });
    }

    // ================= http mode: boot the server =================
    if (!plan.startCommand) {
      onStep(
        "server",
        "failed",
        "Could not tell how to start your server. Add a `dev` or `start` script to package.json.",
      );
      return bail("server", { dev, failureClass: "project" });
    }

    const bootTries =
      plan.track === "frontend" ? BOOT_TRIES_FRONTEND : BOOT_TRIES_BACKEND;
    await sandbox.fs.uploadFile(
      Buffer.from(LIMIT_CPUS_JS, "utf8"),
      LIMIT_CPUS_PATH,
    );

    onStep(
      "server",
      "running",
      plan.track === "frontend"
        ? "Preparing the frontend application for a production web run."
        : "Preparing your project: code generation, databases, services and migrations, based on what your repo uses.",
      plan.startCommand,
    );
    await setup.prepare();
    log += setup.flush();

    let srv: { port: number | null; died: boolean } = {
      port: null,
      died: false,
    };
    let lastTail = "";

    for (let attempt = 0; attempt <= MAX_HEAL; attempt++) {
      onStep(
        "server",
        "running",
        attempt === 0
          ? "Starting your server inside the sandbox so the tests can call it over HTTP."
          : `Starting your server again (attempt ${attempt + 1}) after fixing what the last crash pointed at.`,
        plan.startCommand,
      );
      dlog(`boot attempt ${attempt + 1}/${MAX_HEAL + 1}`);
      // The developer's middleware is never modified. Explicit test credentials
      // (if any) are added to the server environment only. An explicit NODE_ENV
      // supplied by the project/environment is preserved.
      const serverEnv = {
        ...bootEnv,
        NODE_ENV:
          bootEnv.NODE_ENV ??
          (plan.track === "frontend" ? "production" : "test"),
        ...auth.serverEnv,
      };
      srv = await startServer(
        sandbox,
        plan.startCommand,
        projectDir,
        serverEnv,
        dlog,
        bootTries,
      );
      const tail = (
        await step(sandbox, "tail -n 200 /tmp/server.log", projectDir, 10)
      ).out;
      lastTail = tail;

      if (srv.port) {
        log += block("server output", plan.startCommand, lastLines(tail, 80));
        break;
      }

      dlog(
        `boot attempt ${attempt + 1} FAILED (${srv.died ? "crashed" : "no answer"}). server log tail:\n${lastLines(tail, 12)}`,
      );

      await stopServer(sandbox, projectDir);
      const last = attempt === MAX_HEAL;
      const actions = last ? [] : await setup.heal(tail);
      log += setup.flush();

      if (!actions.length) {
        dlog(
          last
            ? "no more boot attempts left"
            : "heal found nothing to fix, giving up on booting",
        );
        log += block("server output", plan.startCommand, lastLines(tail, 80));
        break;
      }
      dlog(`healing after crash: ${actions.join("; ")}`);
      log += block(
        `server output (attempt ${attempt + 1}, then: ${actions.join("; ")})`,
        plan.startCommand,
        lastLines(tail, 30),
      );
    }

    if (!srv.port) {
      onStep(
        "server",
        "failed",
        srv.died
          ? "Your server crashed while starting. See the server output below."
          : `Your server did not answer on any port within ${bootTries}s. See the server output below.`,
      );
      const resource = RESOURCE_INFRA.test(lastTail);
      return bail("server", {
        dev,
        failureClass: resource ? "infrastructure" : "project",
        infraReason:
          "the sandbox ran out of memory or disk while booting the server",
      });
    }
    onStep("server", "done", `Your server is answering on port ${srv.port}.`);

    onStep(
      "test",
      "running",
      `Running the mission's test file against http://127.0.0.1:${srv.port}.`,
      plan.testCommand,
    );
    // The test authenticates like a real client using the explicit test credentials.
    const testEnv = {
      ...env,
      ...auth.testEnv,
      MISSION_BASE_URL: `http://127.0.0.1:${srv.port}`,
    };
    // Run with the repository as Vitest's root so the test's relative imports
    // resolve from projectDir/__mission__. Keep the Vitest installation and
    // JSON result file in mission-runner, outside the developer's repository.
    const resultsPath = `${runnerDir}/${plan.resultsFile}`;
    const commandWithResults = plan.testCommand.replace(
      /--outputFile\.json=(?:"[^"]*"|'[^']*'|\S+)/,
      `--outputFile.json=${shq(resultsPath)}`,
    );
    const httpTestCommand = `${commandWithResults} --root ${shq(projectDir)} --config ${shq(`${runnerDir}/vitest.config.mts`)}`;
    const test = await step(
      sandbox,
      `${exportsOf(testEnv)}; ${httpTestCommand}`,
      runnerDir,
      TEST_TIMEOUT_S,
      { enforce: true },
    );
    dlog(
      `tests exit=${test.exitCode} timedOut=${test.timedOut} in ${secs(test.ms)}s`,
    );
    log += block("run tests", httpTestCommand, test.out);
    log += block(
      "server output after tests",
      "tail /tmp/server.log",
      (await step(sandbox, "tail -n 40 /tmp/server.log", projectDir, 10)).out,
    );
    const resultsRaw = await readResults(resultsPath);
    const verdict = classifyTestRun(test, resultsRaw);
    dlog(
      `test run classified as ${verdict.failureClass}${verdict.infraReason ? `: ${verdict.infraReason}` : ""}`,
    );
    onStep(
      "test",
      test.timedOut ? "failed" : "done",
      test.timedOut
        ? "The tests did not finish in time and were stopped."
        : `Test run finished in ${secs(test.ms)}s.`,
    );

    return finish({
      timedOut: verdict.timedOut,
      infra: verdict.infra,
      failureClass: verdict.failureClass,
      infraReason: verdict.infraReason,
      installExit: install.exitCode,
      testExit: test.exitCode,
      resultsRaw,
      devTests: dev,
    });
  } finally {
    await destroySandbox(d, sandbox, dlog, cleanup);
  }
}
