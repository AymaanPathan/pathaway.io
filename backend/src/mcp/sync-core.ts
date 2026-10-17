import { Client } from "@modelcontextprotocol/client";
import type { Graph } from "../db/falkordb.js";
import type {
  AnyObject,
  FileChangeRecord,
  FileRole,
  GitHubCommit,
  GitHubCommitDetails,
  GitHubCommitFile,
  GitHubPullRequest,
  GitHubRepository,
  ProgressFn,
  RepoContext,
  SyncStats,
} from "./sync-types.js";
import { runLearningPipeline } from "../learning/learning-pipeline.js";
import { cerebrasLearningReasoner } from "../learning/learning-agent.js";

import {
  ANALYSIS_VERSION,
  COMMIT_CONCURRENCY,
  CONCURRENCY,
  CONFIG_BASENAME_RE,
  CONFIG_CODE_RE,
  CONFIG_FILENAMES,
  DB_BATCH_SIZE,
  DEBUG_GITHUB_PATCH,
  DEVELOPER_HISTORY_DAYS,
  EXCLUDED_REPOS,
  FETCH_ACTIVITY,
  FETCH_FULL_FILE_FALLBACK,
  FETCH_PRS,
  FETCH_PR_DETAILS,
  FETCH_PR_FILES,
  FILECHANGE_BATCH_SIZE,
  FULLTEXT_INDEXES,
  GENERATED_FILE_PATTERNS,
  IGNORE_EXTENSIONS,
  IGNORE_FILENAMES,
  IGNORE_PATH_SEGMENTS,
  INCLUDE_EXTENDED_EVIDENCE,
  INFRA_PATH_RE,
  INGESTION_INDEXES,
  LANGUAGE_MAP,
  MANIFEST_FILENAMES,
  MANIFEST_LANGUAGE,
  MAX_ACTIVITY_ITEMS,
  MAX_ADDED_CODE_CHARS,
  MAX_CONFIG_FILE_CHARS,
  MAX_DELETED_CODE_CHARS,
  MAX_DEPENDENCIES_PER_ECOSYSTEM,
  MAX_HUNKS_STORED,
  MAX_IMPORTS_STORED,
  MAX_INITIAL_COMMITS_PER_REPO,
  MAX_INITIAL_COMMITS_TOTAL,
  MAX_MANIFEST_FILE_CHARS,
  MAX_PATCH_CHARS,
  MAX_PR_DETAILS,
  MAX_README_CHARS,
  MAX_REVIEW_COMMENTS_STORED,
  MAX_SCOPES_STORED,
  MAX_SYMBOLS_STORED,
  MAX_WORKFLOW_FILES,
  MIGRATION_PATH_RE,
  PAGE_SIZE,
  PR_DETAIL_CONCURRENCY,
  REPAIR_INCOMPLETE_FILECHANGES,
  REPO_CONCURRENCY,
  REPO_CONTEXT_REFRESH_DAYS,
  SAFE_IDENTIFIER,
  SCHEMA_EXTENSIONS,
  SOURCE_EXTENSIONS,
  STYLE_EXTENSIONS,
  SYNC_OVERLAP_DAYS,
  TEST_PATH_RE,
  assertSafeIdentifier,
  ensureFulltextIndexes,
  ensureIngestionIndexes,
  envFlag,
  envNumber,
  isExcludedRepo,
} from "./sync-config.js";

import {
  CODE_SIGNALS,
  CONVENTIONAL_RE,
  DASH_COMMENT_LANGS,
  DEP_VERSION_LIKE,
  DependencyBuckets,
  DependencyChanges,
  FileClassification,
  HASH_COMMENT_LANGS,
  HUNK_HEADER,
  HunkInfo,
  IMPORT_PATTERNS,
  JS_TS_IMPORTS,
  JS_TS_SYMBOLS,
  LEADING_VERB_TYPES,
  MessageInfo,
  NON_DEP_KEYS,
  ParsedPatch,
  PatchAnalysis,
  QueryParamObject,
  QueryPrimitive,
  SLASH_COMMENT_LANGS,
  SYMBOL_KEYWORD_BLOCKLIST,
  SYMBOL_PATTERNS,
  SymbolPattern,
  analyzePatch,
  asQueryParams,
  chunkArray,
  classifyFile,
  computeCodeSignals,
  decodeFileContent,
  dependencyMapFromLines,
  detectDependencyChanges,
  extractImports,
  extractSymbols,
  getCommitDate,
  getCommitTimestamp,
  getExtension,
  getHistoryCutoff,
  indentDepth,
  isCommentLine,
  isIgnoredPath,
  isRateLimitError,
  jsonCapped,
  lastDefinedGroup,
  mapWithConcurrency,
  normalizeImport,
  normalizePatch,
  normalizePath,
  parseCommitMessage,
  parsePatch,
  parseToolResponse,
  safeNumber,
  safeString,
  selectInitialCommits,
  sleep,
  truncate,
} from "./sync-analysis.js";

import {
  CommitEnrichment,
  CommitResult,
  capEntries,
  parseManifestDependencies,
} from "./sync-manifest.js";
import {
  clientCall,
  getCommit,
  getFileContents,
  getMe,
  listCommits,
  listPullRequests,
  readPullRequest,
  searchIssues,
  searchRepositories,
  type GithubMcpCall,
} from "../github-mcp-tools/index.js";

export class GithubSync {
  private rateLimited = false;
  private retryCount = 0;

  constructor(
    private readonly mcp: Client,
    private readonly graph: Graph,
    private readonly owner: string,
    private readonly developerId: string,
    private readonly onProgress: ProgressFn,
    ) {
      this.mcpCall = clientCall(mcp);
    }

    private readonly mcpCall: GithubMcpCall;

    private async callGitHub(
      name: string,
      args: Record<string, unknown>,
      retries = 3,
  ): Promise<any> {
    if (this.rateLimited) {
      throw new Error(`GitHub rate limit previously hit — skipped "${name}"`);
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const tool = {
          get_me: getMe,
          search_repositories: searchRepositories,
          list_pull_requests: listPullRequests,
          pull_request_read: readPullRequest,
          list_commits: listCommits,
          get_commit: getCommit,
          get_file_contents: getFileContents,
          search_issues: searchIssues,
        }[name] as
          | ((call: GithubMcpCall, args: Record<string, unknown>) => Promise<unknown>)
          | undefined;
        if (!tool) throw new Error(`Unsupported GitHub MCP tool "${name}"`);

        return parseToolResponse(await tool(this.mcpCall, args));
      } catch (error) {
        lastError = error;

        if (isRateLimitError(error)) {
          this.rateLimited = true;

          if (DEBUG_GITHUB_PATCH) {
            console.error(
              `\n🛑 Rate limit hit on "${name}" — stopping retries and propagating immediately`,
            );
          }

          throw error;
        }

        if (attempt === retries) {
          break;
        }

        this.retryCount++;

        await sleep(
          Math.min(2_000 * 2 ** (attempt - 1), 8_000) +
            Math.floor(Math.random() * 500),
        );
      }
    }

    throw lastError;
  }

  get wasRateLimited(): boolean {
    return this.rateLimited;
  }

  get retries(): number {
    return this.retryCount;
  }

  private async getDeveloperInfo(): Promise<AnyObject> {
    return this.callGitHub("get_me", {});
  }

  private async getRepositories(): Promise<GitHubRepository[]> {
    const all: GitHubRepository[] = [];

    let page = 1;

    while (true) {
      const since = new Date(getHistoryCutoff()).toISOString().slice(0, 10);

      const data = await this.callGitHub("search_repositories", {
        query: `user:${this.owner} pushed:>=${since}`,
        perPage: PAGE_SIZE,
        page,
        minimal_output: false,
      });

      const items: GitHubRepository[] = Array.isArray(data)
        ? data
        : (data?.items ?? []);

      all.push(...items);

      if (items.length < PAGE_SIZE) {
        break;
      }

      page++;
    }

    return Array.from(
      new Map(
        all
          .filter((repo) => repo?.id != null)
          .filter((repo) => !isExcludedRepo(repo))
          .map((repo) => [String(repo.id), repo]),
      ).values(),
    );
  }

  private async getPullRequests(repo: string): Promise<GitHubPullRequest[]> {
    const all: GitHubPullRequest[] = [];
    const cutoff = getHistoryCutoff();

    let page = 1;

    while (true) {
      const data = await this.callGitHub("list_pull_requests", {
        owner: this.owner,
        repo,
        state: "all",
        sort: "created",
        direction: "desc",
        perPage: PAGE_SIZE,
        page,
      });

      const items: GitHubPullRequest[] = Array.isArray(data)
        ? data
        : (data?.items ?? []);

      all.push(...items);

      const oldest = items[items.length - 1];
      const oldestTs = oldest?.created_at
        ? new Date(oldest.created_at).getTime()
        : Number.POSITIVE_INFINITY;

      if (items.length < PAGE_SIZE || oldestTs < cutoff) {
        break;
      }

      page++;
    }

    return all;
  }

  private async getPullRequestFiles(
    repo: string,
    pullNumber: number,
  ): Promise<any[]> {
    const data = await this.callGitHub("pull_request_read", {
      owner: this.owner,
      repo,
      pullNumber,
      method: "get_files",
      perPage: PAGE_SIZE,
      page: 1,
    });

    return Array.isArray(data) ? data : (data?.files ?? []);
  }

  private async getCommits(
    repo: string,
    options?: {
      since?: string;
      until?: string;
      maxCommits?: number;
    },
  ): Promise<GitHubCommit[]> {
    const allCommits: GitHubCommit[] = [];
    let page = 1;

    const maxCommits = options?.maxCommits ?? Number.POSITIVE_INFINITY;

    while (allCommits.length < maxCommits) {
      const remaining = maxCommits - allCommits.length;

      const data = await this.callGitHub("list_commits", {
        owner: this.owner,
        repo,
        author: this.owner,
        perPage: Math.min(100, remaining),
        page,
        ...(options?.since ? { since: options.since } : {}),
        ...(options?.until ? { until: options.until } : {}),
      });

      const commits: GitHubCommit[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
          ? data.items
          : [];

      allCommits.push(...commits);

      if (commits.length < Math.min(100, remaining)) {
        break;
      }

      page++;
    }

    const seen = new Set<string>();

    return allCommits.filter((commit) => {
      if (!commit.sha || seen.has(commit.sha)) {
        return false;
      }

      seen.add(commit.sha);
      return true;
    });
  }

  private async getInitialCommits(repo: string): Promise<GitHubCommit[]> {
    const since = new Date(getHistoryCutoff()).toISOString();

    return this.getCommits(repo, {
      since,
      maxCommits: MAX_INITIAL_COMMITS_PER_REPO,
    });
  }

  private async getCommitDetails(
    repo: string,
    sha: string,
  ): Promise<GitHubCommitDetails | null> {
    try {
      const data = await this.callGitHub("get_commit", {
        owner: this.owner,
        repo,
        sha,
        detail: "full_patch",
      });

      const root: AnyObject = data?.files
        ? data
        : (data?.data ?? data?.result ?? data ?? {});

      const files: GitHubCommitFile[] = Array.isArray(root?.files)
        ? root.files
        : [];

      if (DEBUG_GITHUB_PATCH) {
        const firstFile = files[0] ?? null;

        console.log("\n🐙 GITHUB COMMIT DEBUG");
        console.log(`   repo: ${repo}`);
        console.log(`   sha: ${sha}`);
        console.log(`   files: ${files.length}`);

        if (firstFile) {
          console.log(`   first file: ${safeString(firstFile.filename)}`);
          console.log(`   patch chars: ${safeString(firstFile.patch).length}`);
          console.log(
            `   patch preview:\n${truncate(safeString(firstFile.patch), 1200)}`,
          );
        } else {
          console.log("   ⚠️ No files returned by get_commit");
        }
      }

      return {
        sha: safeString(root?.sha) || sha,
        files,
        stats: root?.stats,
        parents: Array.isArray(root?.parents) ? root.parents : [],
      };
    } catch (error) {
      if (DEBUG_GITHUB_PATCH) {
        console.error(`\n❌ get_commit failed for ${repo}@${sha}`, error);
      }

      if (isRateLimitError(error)) {
        throw error;
      }

      return null;
    }
  }

  private async getFileAtCommit(
    repo: string,
    path: string,
    sha: string,
  ): Promise<AnyObject | null> {
    try {
      const data = await this.callGitHub("get_file_contents", {
        owner: this.owner,
        repo,
        path,
        sha,
      });

      if (!data || Array.isArray(data) || typeof data === "string") {
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }

  private async listDirectory(
    repo: string,
    path: string,
    ref: string,
  ): Promise<Array<{ name: string; path: string; type: string }>> {
    try {
      const data = await this.callGitHub("get_file_contents", {
        owner: this.owner,
        repo,
        path,
        sha: ref,
      });

      const raw: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.entries)
          ? data.entries
          : Array.isArray(data?.items)
            ? data.items
            : [];

      return raw
        .map((entry) => ({
          name: safeString(
            entry?.name ?? safeString(entry?.path).split("/").pop(),
          ),
          path: safeString(entry?.path ?? entry?.name),
          type: safeString(entry?.type),
        }))
        .filter((entry) => entry.name);
    } catch {
      return [];
    }
  }

  private async getRepoContext(repo: GitHubRepository): Promise<RepoContext> {
    const branch = repo.default_branch || "main";

    const rootEntries = await this.listDirectory(repo.name, "/", branch);
    const rootNames = new Set(
      rootEntries.map((entry) => entry.name.toLowerCase()),
    );
    const hasListing = rootEntries.length > 0;

    const exists = (path: string): boolean =>
      !hasListing || rootNames.has((path.split("/")[0] ?? "").toLowerCase());

    const readmeName =
      rootEntries.find((entry) =>
        /^readme(?:\.(?:md|rst|txt))?$/i.test(entry.name),
      )?.name ?? "README.md";

    const workflowEntries = exists(".github")
      ? await this.listDirectory(repo.name, ".github/workflows", branch)
      : [];

    const workflowFiles = workflowEntries
      .filter((entry) => entry.type !== "dir" && /\.ya?ml$/i.test(entry.name))
      .slice(0, MAX_WORKFLOW_FILES);

    const manifestNames = MANIFEST_FILENAMES.filter(exists);
    const configNames = CONFIG_FILENAMES.filter(exists);

    const [readmeFile, manifestResults, configResults, workflowResults] =
      await Promise.all([
        this.getFileAtCommit(repo.name, readmeName, branch).catch(() => null),
        Promise.all(
          manifestNames.map((filename) =>
            this.getFileAtCommit(repo.name, filename, branch).catch(() => null),
          ),
        ),
        Promise.all(
          configNames.map((filename) =>
            this.getFileAtCommit(repo.name, filename, branch).catch(() => null),
          ),
        ),
        Promise.all(
          workflowFiles.map((entry) =>
            this.getFileAtCommit(
              repo.name,
              entry.path || `.github/workflows/${entry.name}`,
              branch,
            ).catch(() => null),
          ),
        ),
      ]);

    const readmeText = decodeFileContent(readmeFile);
    const readme = readmeText ? truncate(readmeText, MAX_README_CHARS) : "";

    const manifestFiles: Array<{ filename: string; content: string }> = [];
    const dependencies: RepoContext["dependencies"] = {};
    const tooling: Record<string, unknown> = {};

    manifestNames.forEach((filename, index) => {
      const text = decodeFileContent(manifestResults[index]);

      if (!text) {
        return;
      }

      const parsed = parseManifestDependencies(filename, text);

      if (parsed) {
        dependencies[parsed.ecosystem] = parsed.buckets;

        if (parsed.meta) {
          Object.assign(tooling, {
            package_scripts: parsed.meta.scripts,
            node_engines: parsed.meta.engines,
            package_workspaces: parsed.meta.workspaces,
            module_type: parsed.meta.type,
          });
        }
      }

      manifestFiles.push({
        filename,
        content: truncate(text, MAX_MANIFEST_FILE_CHARS),
      });
    });

    const configFiles: Array<{ filename: string; content: string }> = [];

    configNames.forEach((filename, index) => {
      const text = decodeFileContent(configResults[index]);

      if (text) {
        configFiles.push({
          filename,
          content: truncate(text, MAX_CONFIG_FILE_CHARS),
        });
      }
    });

    workflowFiles.forEach((entry, index) => {
      const text = decodeFileContent(workflowResults[index]);

      if (text) {
        configFiles.push({
          filename: `.github/workflows/${entry.name}`,
          content: truncate(text, MAX_CONFIG_FILE_CHARS),
        });
      }
    });

    const has = (re: RegExp): boolean =>
      rootEntries.some((entry) => re.test(entry.name));

    Object.assign(tooling, {
      has_docker: has(
        /^(dockerfile|docker-compose|compose\.ya?ml|\.dockerignore)/i,
      ),
      has_ci:
        workflowFiles.length > 0 ||
        has(/^(\.circleci|\.gitlab-ci\.yml|jenkinsfile|azure-pipelines)/i),
      ci_workflow_files: workflowFiles.map((entry) => entry.name),
      has_tests_dir: has(/^(tests?|__tests__|spec|e2e|cypress|playwright)$/i),
      has_linting: has(
        /^(\.eslintrc|eslint\.config|\.prettierrc|biome\.json|ruff\.toml|\.flake8|\.golangci)/i,
      ),
      has_typescript: has(/^tsconfig/i),
      is_monorepo: has(
        /^(packages|apps|pnpm-workspace\.yaml|turbo\.json|nx\.json|lerna\.json)$/i,
      ),
      has_iac: has(/^(terraform|helm|k8s|kubernetes|pulumi)/i),
      has_orm_schema: has(/^(prisma|drizzle|migrations)$/i),
      has_license: has(/^license/i),
      has_contributing: has(/^contributing/i),
      has_env_example: has(/^\.env\.example$/i),
    });

    return {
      readme,
      manifestFiles,
      configFiles,
      rootEntries: rootEntries.map((entry) => entry.name).slice(0, 200),
      tooling,
      dependencies,
    };
  }

  private async storeRepoContext(
    repositoryId: string,
    context: RepoContext,
  ): Promise<void> {
    await this.graph.query(
      `
      MATCH (r:Repository {id: $repository_id})
      SET
        r.readme_excerpt = $readme,
        r.manifest_json = $manifest_json,
        r.config_files_json = $config_json,
        r.root_entries_json = $root_entries_json,
        r.tooling_json = $tooling_json,
        r.dependencies_json = $dependencies_json,
        r.context_fetched_at = $fetched_at
      `,
      {
        params: {
          repository_id: repositoryId,
          readme: context.readme,
          manifest_json: JSON.stringify(context.manifestFiles),
          config_json: JSON.stringify(context.configFiles),
          root_entries_json: JSON.stringify(context.rootEntries),
          tooling_json: JSON.stringify(context.tooling),
          dependencies_json: JSON.stringify(context.dependencies),
          fetched_at: new Date().toISOString(),
        },
      },
    );
  }

  private async getLastSyncedAtBatch(
    repositoryIds: string[],
  ): Promise<Map<string, string>> {
    if (repositoryIds.length === 0) {
      return new Map();
    }

    try {
      const result = await this.graph.query(
        `
        UNWIND $ids AS repository_id

        MATCH (d:Developer {id: $developer_id})-[c:CONTRIBUTED_TO]->(r:Repository {id: repository_id})

        RETURN
          r.id AS repository_id,
          coalesce(c.last_synced_at, "") AS last_synced_at
        `,
        {
          params: {
            ids: repositoryIds,
            developer_id: this.developerId,
          },
        },
      );

      const rows = (result.data ?? []) as Array<{
        repository_id?: unknown;
        last_synced_at?: unknown;
      }>;

      return new Map(
        rows.map((row) => [
          safeString(row.repository_id),
          safeString(row.last_synced_at),
        ]),
      );
    } catch {
      return new Map();
    }
  }

  private async setLastSyncedAt(
    repositoryId: string,
    timestamp: string,
  ): Promise<void> {
    await this.graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[c:CONTRIBUTED_TO]->(r:Repository {id: $repository_id})

      SET c.last_synced_at = $timestamp
      `,
      {
        params: {
          developer_id: this.developerId,
          repository_id: repositoryId,
          timestamp,
        },
      },
    );
  }

  private async getIncompleteCommitsBatch(
    repositoryIds: string[],
  ): Promise<Map<string, Map<string, string>>> {
    if (!REPAIR_INCOMPLETE_FILECHANGES || repositoryIds.length === 0) {
      return new Map();
    }

    try {
      const result = await this.graph.query(
        `
        UNWIND $ids AS repository_id

        MATCH (r:Repository {id: repository_id})
              <-[:IN_REPOSITORY]-
              (c:Commit {developer_id: $developer_id})

        WHERE c.date >= $cutoff

        OPTIONAL MATCH (c)-[:CHANGED]->(fc:FileChange)

        WITH r, c, sum(
          CASE
            WHEN fc IS NOT NULL AND (
              fc.added_code IS NULL
              OR fc.patch IS NULL
              OR coalesce(fc.analysis_version, 0) < $analysis_version
            ) THEN 1
            ELSE 0
          END
        ) AS stale

        WHERE coalesce(c.evidence_status, "metadata_only") = "metadata_only"
           OR stale > 0

        RETURN r.id AS repository_id, c.sha AS sha, c.date AS date
        `,
        {
          params: {
            ids: repositoryIds,
            developer_id: this.developerId,
            cutoff: new Date(getHistoryCutoff()).toISOString(),
            analysis_version: ANALYSIS_VERSION,
          },
        },
      );

      const rows = (result.data ?? []) as Array<{
        repository_id?: unknown;
        sha?: unknown;
        date?: unknown;
      }>;

      const byRepo = new Map<string, Map<string, string>>();

      for (const row of rows) {
        const repositoryId = safeString(row.repository_id);
        const sha = safeString(row.sha);

        if (!repositoryId || !sha) {
          continue;
        }

        const map = byRepo.get(repositoryId) ?? new Map<string, string>();
        map.set(sha, safeString(row.date));
        byRepo.set(repositoryId, map);
      }

      if (DEBUG_GITHUB_PATCH && byRepo.size > 0) {
        const total = Array.from(byRepo.values()).reduce(
          (sum, map) => sum + map.size,
          0,
        );

        console.log(
          `\n🩹 Found ${total} incomplete commits to repair across ${byRepo.size} repositories`,
        );
      }

      return byRepo;
    } catch (error) {
      console.error("❌ Failed to batch-find incomplete commits:", error);

      return new Map();
    }
  }

  private async getProcessedCommitIds(
    commits: Array<{ commit: GitHubCommit; repo: GitHubRepository }>,
  ): Promise<Set<string>> {
    if (commits.length === 0) {
      return new Set();
    }

    const rows = commits
      .filter(({ commit }) => Boolean(commit.sha))
      .map(({ commit, repo }) => ({
        commit_id: `${repo.id}:commit:${commit.sha}`,
      }));

    if (rows.length === 0) {
      return new Set();
    }

    try {
      const processed = new Set<string>();

      for (const batch of chunkArray(rows, DB_BATCH_SIZE)) {
        const result = await this.graph.query(
          `
          UNWIND $rows AS row

          MATCH (c:Commit {id: row.commit_id})

          WHERE c.evidence_status IN ["full_patch", "no_source_changes"]

          OPTIONAL MATCH (c)-[:CHANGED]->(fc:FileChange)

          WITH c, sum(
            CASE
              WHEN fc IS NOT NULL AND (
                fc.added_code IS NULL
                OR fc.patch IS NULL
                OR coalesce(fc.analysis_version, 0) < $analysis_version
              ) THEN 1
              ELSE 0
            END
          ) AS stale

          WHERE stale = 0

          RETURN c.id AS commit_id
          `,
          {
            params: {
              rows: asQueryParams(batch),
              analysis_version: ANALYSIS_VERSION,
            },
          },
        );

        for (const row of (result.data ?? []) as Array<{
          commit_id?: unknown;
        }>) {
          processed.add(safeString(row.commit_id));
        }
      }

      return processed;
    } catch (error) {
      console.error("❌ Failed to batch-check processed commits:", error);

      return new Set();
    }
  }

  private async processCommit(
    commit: GitHubCommit,
    repo: GitHubRepository,
    processedCommitIds: Set<string>,
    repairShas: Set<string>,
  ): Promise<CommitResult> {
    const base: CommitResult = {
      commit,
      repo,
      changes: [],
      sourceFiles: 0,
      ignoredFiles: 0,
      emptyPatches: 0,
      skipped: false,
      failed: false,
      repaired: false,
      enrichment: null,
    };

    const sha = commit.sha;

    if (!sha || processedCommitIds.has(`${repo.id}:commit:${sha}`)) {
      return { ...base, skipped: true };
    }

    const details = await this.getCommitDetails(repo.name, sha);

    if (!details) {
      return { ...base, failed: true };
    }

    const files = Array.isArray(details.files) ? details.files : [];

    const commitId = `${repo.id}:commit:${sha}`;
    const commitDate = getCommitDate(commit);
    const commitTs = getCommitTimestamp(commit);

    const changes: FileChangeRecord[] = [];

    let sourceFiles = 0;
    let ignoredFiles = 0;
    let emptyPatches = 0;
    let testFiles = 0;
    let configFiles = 0;

    const languages: Record<string, number> = {};
    const roles: Record<string, number> = {};

    for (const file of files) {
      const path = normalizePath(safeString(file.filename));
      const classification = path ? classifyFile(path) : null;

      if (!classification) {
        ignoredFiles++;
        continue;
      }

      const { language, role, isSourceCode } = classification;

      const rawPatch = safeString(file.patch).replace(/\r\n?/g, "\n");

      if (!rawPatch.trim()) {
        if (safeNumber(file.changes) > 0) {
          emptyPatches++;
        }

        ignoredFiles++;
        continue;
      }

      const patch = normalizePatch(rawPatch);
      const analysis = analyzePatch(rawPatch, path, language);

      if (DEBUG_GITHUB_PATCH) {
        console.log(`\n📄 FILE PATCH`);
        console.log(`   path: ${path}`);
        console.log(`   language: ${language}  role: ${role}`);
        console.log(`   hunks: ${analysis.hunkCount}`);
        console.log(`   symbols added: ${analysis.symbolsAdded.length}`);
        console.log(`   imports added: ${analysis.importsAdded.length}`);
      }

      if (!analysis.addedCode.trim() && !analysis.deletedCode.trim()) {
        ignoredFiles++;
        continue;
      }

      sourceFiles++;

      languages[language] = (languages[language] ?? 0) + 1;
      roles[role] = (roles[role] ?? 0) + 1;

      if (role === "test") {
        testFiles++;
      }

      if (
        role === "config" ||
        role === "infra" ||
        role === "dependency_manifest"
      ) {
        configFiles++;
      }

      const additions = safeNumber(file.additions);
      const deletions = safeNumber(file.deletions);
      const previousPath = normalizePath(safeString(file.previous_filename));

      changes.push({
        id: `${repo.id}:commit:${sha}:file:${path}`,
        path,
        previous_path: previousPath,
        is_rename:
          safeString(file.status) === "renamed" ||
          (previousPath !== "" && previousPath !== path),
        language,
        file_role: role,
        is_test: role === "test",
        status: safeString(file.status),
        additions,
        deletions,
        changes: safeNumber(file.changes),
        net_lines: additions - deletions,
        patch,
        added_code: analysis.addedCode,
        deleted_code: analysis.deletedCode,
        commit_sha: sha,
        commit_id: commitId,
        repository_id: String(repo.id),
        developer_id: this.developerId,
        file_sha: safeString(file.sha),
        is_source_code: isSourceCode,
        evidence_type: "authored_diff",

        hunk_count: analysis.hunkCount,
        hunks_json: analysis.hunksJson,
        touched_scopes_json: analysis.touchedScopesJson,
        symbols_added_json: jsonCapped(analysis.symbolsAdded),
        symbols_modified_json: jsonCapped(analysis.symbolsModified),
        symbols_removed_json: jsonCapped(analysis.symbolsRemoved),
        imports_added_json: jsonCapped(analysis.importsAdded),
        imports_removed_json: jsonCapped(analysis.importsRemoved),
        relative_imports_added: analysis.relativeImportsAdded,
        code_signals_json: jsonCapped(analysis.signals, "{}"),
        comment_lines_added: analysis.commentLinesAdded,
        max_indent_depth: analysis.maxIndentDepth,
        dependency_changes_json: analysis.dependencyChanges
          ? jsonCapped(analysis.dependencyChanges, "")
          : "",

        analysis_version: ANALYSIS_VERSION,
        source: "github_mcp",
        source_version: "full_patch",
        ingested_at: new Date().toISOString(),

        created_at: commitDate,
        date_ts: commitTs,
        patch_available: patch.trim().length > 0,
        patch_truncated: rawPatch.length > MAX_PATCH_CHARS,
        added_code_chars: analysis.addedCode.length,
        deleted_code_chars: analysis.deletedCode.length,
      });
    }

    if (FETCH_FULL_FILE_FALLBACK && changes.length === 0 && files.length > 0) {
      const candidates = files
        .filter((file) => {
          const path = normalizePath(safeString(file.filename));
          return Boolean(path && classifyFile(path));
        })
        .slice(0, 3);

      for (const file of candidates) {
        const path = normalizePath(safeString(file.filename));

        await this.getFileAtCommit(repo.name, path, sha);

        this.onProgress("context_fetched", {
          repository: repo.name,
          path,
          commit: sha,
        });
      }
    }

    if (changes.length > 0) {
      this.onProgress("evidence_captured", {
        repo: repo.name,
        sha: sha.slice(0, 7),
        message: (commit.commit?.message ?? "").split("\n")[0].slice(0, 90),
        files: changes.length,
        paths: changes.slice(0, 3).map((c) => c.path),
      });
    }

    const parentCount = details.parents?.length ?? 0;

    const enrichment: CommitEnrichment = {
      id: commitId,
      status: changes.length > 0 ? "full_patch" : "no_source_changes",
      additions: safeNumber(details.stats?.additions),
      deletions: safeNumber(details.stats?.deletions),
      files_count: files.length,
      source_files_count: sourceFiles,
      test_files_count: testFiles,
      config_files_count: configFiles,
      parent_count: parentCount,
      is_merge: parentCount > 1,
      languages_json: jsonCapped(languages, "{}"),
      roles_json: jsonCapped(roles, "{}"),
    };

    return {
      ...base,
      changes,
      sourceFiles,
      ignoredFiles,
      emptyPatches,
      repaired: repairShas.has(sha),
      enrichment,
    };
  }

  private async getPullRequestDetail(
    repo: GitHubRepository,
    pr: GitHubPullRequest,
  ): Promise<QueryParamObject | null> {
    const call = (method: string) =>
      this.callGitHub("pull_request_read", {
        owner: this.owner,
        repo: repo.name,
        pullNumber: pr.number,
        method,
        perPage: PAGE_SIZE,
        page: 1,
      });

    try {
      const [detail, reviewsRaw, commentsRaw] = await Promise.all([
        call("get").catch((error) => {
          if (isRateLimitError(error)) throw error;
          return null;
        }),
        call("get_reviews").catch((error) => {
          if (isRateLimitError(error)) throw error;
          return [];
        }),
        call("get_review_comments").catch((error) => {
          if (isRateLimitError(error)) throw error;
          return [];
        }),
      ]);

      const d: AnyObject = detail && typeof detail === "object" ? detail : {};

      const reviews: AnyObject[] = Array.isArray(reviewsRaw)
        ? reviewsRaw
        : (reviewsRaw?.reviews ?? []);

      const comments: AnyObject[] = Array.isArray(commentsRaw)
        ? commentsRaw
        : (commentsRaw?.comments ?? commentsRaw?.review_comments ?? []);

      const me = this.owner.toLowerCase();

      const reviewStates: Record<string, number> = {};
      const reviewers = new Set<string>();

      for (const review of reviews) {
        const login = safeString(review?.user?.login);

        if (login.toLowerCase() === me) {
          continue;
        }

        const state = safeString(review?.state || "COMMENTED").toUpperCase();
        reviewStates[state] = (reviewStates[state] ?? 0) + 1;

        if (login) {
          reviewers.add(login);
        }
      }

      const feedback = comments
        .filter((c) => safeString(c?.user?.login).toLowerCase() !== me)
        .slice(0, MAX_REVIEW_COMMENTS_STORED)
        .map((c) => ({
          path: safeString(c?.path),
          author: safeString(c?.user?.login),
          body: safeString(c?.body).slice(0, 400),
        }));

      const createdTs = pr.created_at ? new Date(pr.created_at).getTime() : 0;
      const mergedTs = pr.merged_at ? new Date(pr.merged_at).getTime() : 0;

      return {
        id: `${repo.id}:pr:${pr.number}`,
        additions: safeNumber(d.additions),
        deletions: safeNumber(d.deletions),
        changed_files: safeNumber(d.changed_files),
        commit_count: safeNumber(d.commits),
        comment_count: safeNumber(d.comments),
        review_comment_count: safeNumber(d.review_comments ?? comments.length),
        draft: Boolean(d.draft ?? pr.draft),
        merged: Boolean(d.merged ?? pr.merged_at),
        merged_by: safeString(d.merged_by?.login),
        labels_json: jsonCapped(
          (Array.isArray(d.labels) ? d.labels : []).map((l: AnyObject) =>
            safeString(l?.name ?? l),
          ),
        ),
        review_states_json: jsonCapped(reviewStates, "{}"),
        reviewers_json: jsonCapped(Array.from(reviewers).slice(0, 20)),
        review_feedback_json: jsonCapped(feedback),
        time_to_merge_hours:
          createdTs > 0 && mergedTs > createdTs
            ? Number(((mergedTs - createdTs) / 3_600_000).toFixed(1))
            : null,
        closed_at: safeString(d.closed_at ?? pr.closed_at),
      };
    } catch (error) {
      if (isRateLimitError(error)) {
        return null;
      }

      return null;
    }
  }

  private async storePullRequestDetails(
    rows: QueryParamObject[],
  ): Promise<void> {
    for (const batch of chunkArray(rows, DB_BATCH_SIZE)) {
      await this.graph.query(
        `
        UNWIND $batch AS item

        MATCH (p:PullRequest {id: item.id})

        SET
          p.additions = item.additions,
          p.deletions = item.deletions,
          p.changed_files = item.changed_files,
          p.commit_count = item.commit_count,
          p.comment_count = item.comment_count,
          p.review_comment_count = item.review_comment_count,
          p.draft = item.draft,
          p.merged = item.merged,
          p.merged_by = item.merged_by,
          p.labels_json = item.labels_json,
          p.review_states_json = item.review_states_json,
          p.reviewers_json = item.reviewers_json,
          p.review_feedback_json = item.review_feedback_json,
          p.time_to_merge_hours = item.time_to_merge_hours,
          p.closed_at = item.closed_at,
          p.detail_fetched_at = $fetched_at
        `,
        {
          params: {
            batch,
            fetched_at: new Date().toISOString(),
          },
        },
      );
    }
  }

  private async searchIssuesPaged(
    query: string,
    maxItems: number,
  ): Promise<AnyObject[]> {
    const out: AnyObject[] = [];

    let page = 1;

    while (out.length < maxItems) {
      const data = await this.callGitHub("search_issues", {
        query,
        perPage: PAGE_SIZE,
        page,
        sort: "created",
        order: "desc",
      });

      const items: AnyObject[] = Array.isArray(data)
        ? data
        : (data?.items ?? data?.issues ?? []);

      out.push(...items);

      if (items.length < PAGE_SIZE) {
        break;
      }

      page++;
    }

    return out.slice(0, maxItems);
  }

  private repoFullNameFromItem(item: AnyObject): string {
    const fromApi = safeString(item?.repository_url).split("/repos/")[1];

    if (fromApi) {
      return fromApi;
    }

    if (item?.repository?.full_name) {
      return safeString(item.repository.full_name);
    }

    const match = /github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\//.exec(
      safeString(item?.html_url),
    );

    return match?.[1] ?? "";
  }

  private async syncActivity(): Promise<{ issues: number; reviewed: number }> {
    if (!FETCH_ACTIVITY || MAX_ACTIVITY_ITEMS === 0) {
      return { issues: 0, reviewed: 0 };
    }

    const since = new Date(getHistoryCutoff()).toISOString().slice(0, 10);

    const toRow = (item: AnyObject, prefix: string) => {
      const full = this.repoFullNameFromItem(item);

      return {
        id: `${prefix}:${full}#${safeNumber(item?.number)}`,
        number: safeNumber(item?.number),
        repo_full_name: full,
        is_own_repo: full
          .toLowerCase()
          .startsWith(`${this.owner.toLowerCase()}/`),
        title: safeString(item?.title).slice(0, 500),
        body: truncate(safeString(item?.body), 3000),
        state: safeString(item?.state),
        url: safeString(item?.html_url),
        author: safeString(item?.user?.login),
        created_at: safeString(item?.created_at),
        closed_at: safeString(item?.closed_at),
        comments: safeNumber(item?.comments),
        labels_json: jsonCapped(
          (Array.isArray(item?.labels) ? item.labels : []).map((l: AnyObject) =>
            safeString(l?.name ?? l),
          ),
        ),
      };
    };

    let issues = 0;
    let reviewed = 0;

    try {
      const issueItems = await this.searchIssuesPaged(
        `is:issue author:${this.owner} created:>=${since}`,
        MAX_ACTIVITY_ITEMS,
      );

      const rows = issueItems
        .map((item) => toRow(item, "issue"))
        .filter((row) => row.number > 0 && row.repo_full_name);

      for (const batch of chunkArray(rows, DB_BATCH_SIZE)) {
        const params = {
          batch: asQueryParams(batch),
          developer_id: this.developerId,
        };

        await this.graph.query(
          `
          UNWIND $batch AS item

          MERGE (i:Issue {id: item.id})

          SET
            i.number = item.number,
            i.repo_full_name = item.repo_full_name,
            i.is_own_repo = item.is_own_repo,
            i.title = item.title,
            i.body = item.body,
            i.state = item.state,
            i.url = item.url,
            i.author = item.author,
            i.created_at = item.created_at,
            i.closed_at = item.closed_at,
            i.comments = item.comments,
            i.labels_json = item.labels_json

          WITH i

          MATCH (d:Developer {id: $developer_id})

          MERGE (d)-[:OPENED]->(i)
          `,
          { params },
        );

        await this.graph.query(
          `
          UNWIND $batch AS item

          MATCH (i:Issue {id: item.id})
          MATCH (r:Repository {full_name: item.repo_full_name})

          MERGE (i)-[:IN_REPOSITORY]->(r)
          `,
          { params: { batch: params.batch } },
        );
      }

      issues = rows.length;
    } catch (error) {
      if (isRateLimitError(error)) {
        return { issues, reviewed };
      }

      console.error("⚠️ Issue activity sync failed (non-fatal):", error);
    }

    try {
      const reviewItems = await this.searchIssuesPaged(
        `is:pr reviewed-by:${this.owner} -author:${this.owner} created:>=${since}`,
        MAX_ACTIVITY_ITEMS,
      );

      const rows = reviewItems
        .map((item) => toRow(item, "review"))
        .filter((row) => row.number > 0 && row.repo_full_name);

      for (const batch of chunkArray(rows, DB_BATCH_SIZE)) {
        await this.graph.query(
          `
          UNWIND $batch AS item

          MERGE (p:ReviewedPullRequest {id: item.id})

          SET
            p.number = item.number,
            p.repo_full_name = item.repo_full_name,
            p.is_own_repo = item.is_own_repo,
            p.title = item.title,
            p.body = item.body,
            p.state = item.state,
            p.url = item.url,
            p.author = item.author,
            p.created_at = item.created_at,
            p.closed_at = item.closed_at,
            p.comments = item.comments,
            p.labels_json = item.labels_json

          WITH p

          MATCH (d:Developer {id: $developer_id})

          MERGE (d)-[:REVIEWED]->(p)
          `,
          {
            params: {
              batch: asQueryParams(batch),
              developer_id: this.developerId,
            },
          },
        );
      }

      reviewed = rows.length;
    } catch (error) {
      if (!isRateLimitError(error)) {
        console.error("⚠️ Review activity sync failed (non-fatal):", error);
      }
    }

    return { issues, reviewed };
  }

  private async storeDeveloper(user: AnyObject): Promise<void> {
    const details: AnyObject = user.details ?? {};

    await this.graph.query(
      `
      MERGE (d:Developer {id: $id})

      SET
        d.username = $username,
        d.name = $name,
        d.avatar_url = $avatar_url,
        d.profile_url = $profile_url,
        d.bio = $bio,
        d.company = $company,
        d.location = $location,
        d.blog = $blog,
        d.followers = $followers,
        d.following = $following,
        d.public_repos = $public_repos,
        d.account_created_at = $account_created_at
      `,
      {
        params: {
          id: this.developerId,
          username: user.login ?? this.owner,
          name: user.name ?? details.name ?? "",
          avatar_url: user.avatar_url ?? "",
          profile_url: user.html_url ?? user.profile_url ?? "",
          bio: safeString(user.bio ?? details.bio),
          company: safeString(user.company ?? details.company),
          location: safeString(user.location ?? details.location),
          blog: safeString(user.blog ?? details.blog),
          followers: safeNumber(user.followers ?? details.followers),
          following: safeNumber(user.following ?? details.following),
          public_repos: safeNumber(user.public_repos ?? details.public_repos),
          account_created_at: safeString(user.created_at ?? details.created_at),
        },
      },
    );
  }

  private async storeRepositories(
    repositories: GitHubRepository[],
  ): Promise<void> {
    for (const batch of chunkArray(repositories, DB_BATCH_SIZE)) {
      await this.graph.query(
        `
        UNWIND $batch AS item

        MERGE (r:Repository {id: item.id})

        SET
          r.name = item.name,
          r.full_name = item.full_name,
          r.description = item.description,
          r.language = item.language,
          r.url = item.url,
          r.homepage = item.homepage,
          r.stars = item.stars,
          r.forks = item.forks,
          r.open_issues = item.open_issues,
          r.size_kb = item.size_kb,
          r.topics_json = item.topics_json,
          r.license = item.license,
          r.created_at = item.created_at,
          r.updated_at = item.updated_at,
          r.pushed_at = item.pushed_at,
          r.private = item.private,
          r.archived = item.archived,
          r.fork = item.fork,
          r.default_branch = item.default_branch

        WITH r

        MATCH (d:Developer {id: $developer_id})

        MERGE (d)-[:CONTRIBUTED_TO]->(r)
        `,
        {
          params: {
            batch: asQueryParams(
              batch.map((repo) => ({
                id: String(repo.id),
                name: repo.name ?? "",
                full_name: repo.full_name ?? "",
                description: repo.description ?? "",
                language: repo.language ?? "",
                url: repo.html_url ?? "",
                homepage: safeString(repo.homepage),
                stars: safeNumber(repo.stargazers_count),
                forks: safeNumber(repo.forks_count),
                open_issues: safeNumber(repo.open_issues_count),
                size_kb: safeNumber(repo.size),
                topics_json: jsonCapped(repo.topics ?? []),
                license: safeString(
                  repo.license?.spdx_id ?? repo.license?.name,
                ),
                created_at: repo.created_at ?? "",
                updated_at: repo.updated_at ?? "",
                pushed_at: repo.pushed_at ?? "",
                private: Boolean(repo.private),
                archived: Boolean(repo.archived),
                fork: Boolean(repo.fork),
                default_branch: repo.default_branch ?? "",
              })),
            ),
            developer_id: this.developerId,
          },
        },
      );
    }
  }

  private async storePullRequests(
    records: Array<{
      pr: GitHubPullRequest;
      repo: GitHubRepository;
    }>,
  ): Promise<void> {
    for (const batch of chunkArray(records, DB_BATCH_SIZE)) {
      await this.graph.query(
        `
        UNWIND $batch AS item

        MERGE (p:PullRequest {id: item.id})

        SET
          p.number = item.number,
          p.title = item.title,
          p.body = item.body,
          p.state = item.state,
          p.draft = item.draft,
          p.url = item.url,
          p.created_at = item.created_at,
          p.updated_at = item.updated_at,
          p.closed_at = item.closed_at,
          p.merged_at = item.merged_at,
          p.author = item.author,
          p.head_ref = item.head_ref,
          p.base_ref = item.base_ref,
          p.head_sha = item.head_sha,
          p.base_sha = item.base_sha

        WITH p, item

        MATCH (r:Repository {id: item.repo_id})

        MERGE (p)-[:IN_REPOSITORY]->(r)

        WITH p

        MATCH (d:Developer {id: $developer_id})

        MERGE (d)-[:AUTHORED]->(p)
        `,
        {
          params: {
            batch: asQueryParams(
              batch.map(({ pr, repo }) => ({
                id: `${repo.id}:pr:${pr.number}`,
                number: safeNumber(pr.number),
                title: pr.title ?? "",
                body: truncate(safeString(pr.body), 6000),
                state: pr.state ?? "",
                draft: Boolean(pr.draft),
                url: pr.html_url ?? "",
                created_at: pr.created_at ?? "",
                updated_at: pr.updated_at ?? "",
                closed_at: pr.closed_at ?? "",
                merged_at: pr.merged_at ?? "",
                author: pr.user?.login ?? "",
                head_ref: pr.head?.ref ?? "",
                base_ref: pr.base?.ref ?? "",
                head_sha: pr.head?.sha ?? "",
                base_sha: pr.base?.sha ?? "",
                repo_id: String(repo.id),
              })),
            ),
            developer_id: this.developerId,
          },
        },
      );
    }
  }

  private async storePRFiles(
    records: Array<{
      file: AnyObject;
      repo: GitHubRepository;
      pr: GitHubPullRequest;
    }>,
  ): Promise<void> {
    for (const batch of chunkArray(records, DB_BATCH_SIZE)) {
      await this.graph.query(
        `
        UNWIND $batch AS item

        MERGE (f:File {id: item.id})

        SET
          f.path = item.path,
          f.status = item.status,
          f.additions = item.additions,
          f.deletions = item.deletions,
          f.changes = item.changes

        WITH f, item

        MATCH (p:PullRequest {id: item.pr_id})

        MERGE (p)-[:CHANGED]->(f)

        WITH f, item

        MATCH (r:Repository {id: item.repo_id})

        MERGE (f)-[:IN_REPOSITORY]->(r)
        `,
        {
          params: {
            batch: asQueryParams(
              batch.map(({ file, repo, pr }) => {
                const path = normalizePath(safeString(file.filename));

                return {
                  id: `${repo.id}:pr:${pr.number}:file:${path}`,
                  path,
                  status: safeString(file.status),
                  additions: safeNumber(file.additions),
                  deletions: safeNumber(file.deletions),
                  changes: safeNumber(file.changes),
                  pr_id: `${repo.id}:pr:${pr.number}`,
                  repo_id: String(repo.id),
                };
              }),
            ),
          },
        },
      );
    }
  }

  private async storeCommitMetadata(commits: GitHubCommit[], repoId: string) {
    if (!commits.length) return;

    const rows = commits.map((commit) => {
      const date =
        commit.commit?.author?.date ?? commit.commit?.committer?.date ?? null;
      const dateTs = date ? new Date(date).getTime() : null;
      const message = commit.commit?.message ?? "";
      const info = parseCommitMessage(message);
      const parsedDate = date ? new Date(date) : null;
      const validDate = parsedDate && Number.isFinite(parsedDate.getTime());

      return {
        id: `${repoId}:commit:${commit.sha}`,
        sha: commit.sha,
        message,
        subject: info.subject.slice(0, 300),
        body: truncate(info.body, 4000),
        commit_type: info.commitType,
        commit_scope: info.commitScope,
        is_breaking: info.isBreaking,
        is_revert: info.isRevert,
        is_merge_message: info.isMergeMessage,
        co_authors: info.coAuthors,
        pr_number: info.prNumber,
        url: commit.html_url ?? "",
        date,
        dateTs: Number.isFinite(dateTs) ? dateTs : null,
        date_day: validDate ? parsedDate!.toISOString().slice(0, 10) : null,
        utc_hour: validDate ? parsedDate!.getUTCHours() : null,
        utc_weekday: validDate ? parsedDate!.getUTCDay() : null,
        author: commit.author?.login ?? commit.commit?.author?.name ?? null,
        repoId,
        developerId: this.developerId,
      };
    });

    for (const batch of chunkArray(rows, DB_BATCH_SIZE)) {
      await this.graph.query(
        `
        UNWIND $rows AS row

        MERGE (c:Commit {id: row.id})
        SET
          c.sha = row.sha,
          c.message = row.message,
          c.subject = row.subject,
          c.body = row.body,
          c.commit_type = row.commit_type,
          c.commit_scope = row.commit_scope,
          c.is_breaking = row.is_breaking,
          c.is_revert = row.is_revert,
          c.is_merge_message = row.is_merge_message,
          c.co_authors = row.co_authors,
          c.pr_number = row.pr_number,
          c.url = row.url,
          c.date = row.date,
          c.date_ts = row.dateTs,
          c.date_day = row.date_day,
          c.utc_hour = row.utc_hour,
          c.utc_weekday = row.utc_weekday,
          c.author = row.author,
          c.repository_id = row.repoId,
          c.developer_id = row.developerId,
          c.evidence_status = coalesce(c.evidence_status, "metadata_only")

        WITH c, row

        MATCH (r:Repository {id: row.repoId})
        MERGE (c)-[:IN_REPOSITORY]->(r)

        WITH c, row

        MATCH (d:Developer {id: row.developerId})
        MERGE (d)-[:MADE]->(c)
        `,
        { params: { rows: asQueryParams(batch) } },
      );
    }
  }

  private async linkCommitsToPullRequests(
    items: Array<{ commits: GitHubCommit[]; repoId: string }>,
  ): Promise<void> {
    const rows: Array<{ commit_id: string; pr_id: string }> = [];

    for (const { commits, repoId } of items) {
      for (const commit of commits) {
        const info = parseCommitMessage(commit.commit?.message ?? "");

        if (info.prNumber != null) {
          rows.push({
            commit_id: `${repoId}:commit:${commit.sha}`,
            pr_id: `${repoId}:pr:${info.prNumber}`,
          });
        }
      }
    }

    for (const batch of chunkArray(rows, DB_BATCH_SIZE)) {
      await this.graph.query(
        `
        UNWIND $rows AS row

        MATCH (c:Commit {id: row.commit_id})
        MATCH (p:PullRequest {id: row.pr_id})

        MERGE (c)-[:IN_PR]->(p)
        `,
        { params: { rows: asQueryParams(batch) } },
      );
    }
  }

  private async storeCommitEnrichment(rows: CommitEnrichment[]): Promise<void> {
    for (const batch of chunkArray(rows, DB_BATCH_SIZE)) {
      await this.graph.query(
        `
        UNWIND $rows AS row

        MATCH (c:Commit {id: row.id})

        SET
          c.evidence_status = row.status,
          c.additions = row.additions,
          c.deletions = row.deletions,
          c.files_count = row.files_count,
          c.source_files_count = row.source_files_count,
          c.test_files_count = row.test_files_count,
          c.config_files_count = row.config_files_count,
          c.parent_count = row.parent_count,
          c.is_merge = row.is_merge,
          c.languages_json = row.languages_json,
          c.roles_json = row.roles_json,
          c.details_fetched_at = $fetched_at
        `,
        {
          params: {
            rows: asQueryParams(batch),
            fetched_at: new Date().toISOString(),
          },
        },
      );
    }
  }

  private async storeFileChanges(changes: FileChangeRecord[]): Promise<void> {
    if (changes.length === 0) {
      return;
    }

    if (DEBUG_GITHUB_PATCH) {
      console.log(`\n💾 WRITING ${changes.length} FileChange RECORDS`);
    }

    for (const batch of chunkArray(changes, FILECHANGE_BATCH_SIZE)) {
      await this.graph.query(
        `
        UNWIND $batch AS item

        MERGE (fc:FileChange {id: item.id})

        SET
          fc.path = item.path,
          fc.previous_path = item.previous_path,
          fc.is_rename = item.is_rename,
          fc.language = item.language,
          fc.file_role = item.file_role,
          fc.is_test = item.is_test,
          fc.status = item.status,
          fc.additions = item.additions,
          fc.deletions = item.deletions,
          fc.changes = item.changes,
          fc.net_lines = item.net_lines,

          fc.patch = item.patch,
          fc.added_code = item.added_code,
          fc.deleted_code = item.deleted_code,

          fc.commit_sha = item.commit_sha,
          fc.file_sha = item.file_sha,
          fc.repository_id = item.repository_id,
          fc.developer_id = item.developer_id,

          fc.is_source_code = item.is_source_code,
          fc.evidence_type = item.evidence_type,

          fc.hunk_count = item.hunk_count,
          fc.hunks_json = item.hunks_json,
          fc.touched_scopes_json = item.touched_scopes_json,
          fc.symbols_added_json = item.symbols_added_json,
          fc.symbols_modified_json = item.symbols_modified_json,
          fc.symbols_removed_json = item.symbols_removed_json,
          fc.imports_added_json = item.imports_added_json,
          fc.imports_removed_json = item.imports_removed_json,
          fc.relative_imports_added = item.relative_imports_added,
          fc.code_signals_json = item.code_signals_json,
          fc.comment_lines_added = item.comment_lines_added,
          fc.max_indent_depth = item.max_indent_depth,
          fc.dependency_changes_json = item.dependency_changes_json,

          fc.patch_available = item.patch_available,
          fc.patch_truncated = item.patch_truncated,
          fc.added_code_chars = item.added_code_chars,
          fc.deleted_code_chars = item.deleted_code_chars,

          fc.analysis_version = item.analysis_version,
          fc.source = item.source,
          fc.source_version = item.source_version,
          fc.ingested_at = item.ingested_at,

          fc.created_at = item.created_at,
          fc.date_ts = item.date_ts

        WITH fc, item

        MATCH (c:Commit {id: item.commit_id})

        MERGE (c)-[:CHANGED]->(fc)

        WITH fc, item

        MATCH (r:Repository {id: item.repository_id})

        MERGE (fc)-[:IN_REPOSITORY]->(r)

        WITH fc, item

        MATCH (d:Developer {id: item.developer_id})

        MERGE (d)-[:AUTHORED_CODE]->(fc)
        `,
        {
          params: {
            batch: asQueryParams(batch),
          },
        },
      );
    }

    if (DEBUG_GITHUB_PATCH) {
      console.log("   ✅ FileChange write complete");
    }
  }

  private async pruneOutsideHistoryWindow(): Promise<void> {
    const cutoff = new Date(getHistoryCutoff()).toISOString();
    const params = { developer_id: this.developerId, cutoff };

    await this.graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:AUTHORED_CODE]->(fc:FileChange)
      WHERE fc.created_at < $cutoff
      DETACH DELETE fc
      `,
      { params },
    );

    await this.graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[m:MADE]->(c:Commit)
      WHERE c.date < $cutoff
      DELETE m
      WITH c
      WHERE NOT (c)-[:CHANGED]->(:FileChange)
      DETACH DELETE c
      `,
      { params },
    );

    await this.graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[a:AUTHORED]->(p:PullRequest)
      WHERE p.created_at < $cutoff
      DELETE a
      WITH p
      WHERE NOT (p)-[:IN_REPOSITORY]->(:Repository)
         OR NOT (p)<-[:AUTHORED]-(:Developer)
      DETACH DELETE p
      `,
      { params },
    );

    await this.graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:OPENED]->(i:Issue)
      WHERE i.created_at < $cutoff
      DETACH DELETE i
      `,
      { params },
    );

    await this.graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:REVIEWED]->(p:ReviewedPullRequest)
      WHERE p.created_at < $cutoff
      DETACH DELETE p
      `,
      { params },
    );
  }

  private async pruneExcludedRepositories(): Promise<void> {
    const excluded = Array.from(EXCLUDED_REPOS);

    if (excluded.length === 0) {
      return;
    }

    const match = `
      MATCH (r:Repository)
      WHERE toLower(r.name) IN $excluded
         OR toLower(r.full_name) IN $excluded
         OR toLower(split(r.full_name, "/")[1]) IN $excluded
    `;

    const params = { excluded, developer_id: this.developerId };

    await this.graph.query(
      `${match}
       MATCH (fc:FileChange {repository_id: r.id, developer_id: $developer_id})
       DETACH DELETE fc`,
      { params },
    );

    await this.graph.query(
      `${match}
       MATCH (c:Commit {repository_id: r.id, developer_id: $developer_id})
       DETACH DELETE c`,
      { params },
    );

    await this.graph.query(
      `${match}
       MATCH (d:Developer {id: $developer_id})-[:AUTHORED]->(p:PullRequest)-[:IN_REPOSITORY]->(r)
       DETACH DELETE p`,
      { params },
    );

    await this.graph.query(
      `${match}
       MATCH (d:Developer {id: $developer_id})-[rel:CONTRIBUTED_TO]->(r)
       DELETE rel`,
      { params },
    );
  }

  private async pruneInactiveRepositoryLinks(): Promise<void> {
    const cutoff = new Date(getHistoryCutoff()).toISOString();

    await this.graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[rel:CONTRIBUTED_TO]->(r:Repository)

      OPTIONAL MATCH (d)-[:AUTHORED_CODE]->(fc:FileChange)-[:IN_REPOSITORY]->(r)
      WHERE fc.created_at >= $cutoff

      WITH d, r, rel, count(fc) AS recent_code

      OPTIONAL MATCH (d)-[:MADE]->(c:Commit)-[:IN_REPOSITORY]->(r)
      WHERE c.date >= $cutoff

      WITH r, rel, recent_code, count(c) AS recent_commits

      WHERE recent_code = 0 AND recent_commits = 0

      DELETE rel
      `,
      {
        params: {
          developer_id: this.developerId,
          cutoff,
        },
      },
    );
  }

  private async countGraph(): Promise<{
    nodes: number;
    relationships: number;
  }> {
    try {
      const nodes = await this.graph.query(`MATCH (n) RETURN count(n) AS c`);
      const rels = await this.graph.query(
        `MATCH ()-[r]->() RETURN count(r) AS c`,
      );

      const first = (result: any): number =>
        safeNumber(((result?.data ?? []) as Array<{ c?: unknown }>)[0]?.c);

      return { nodes: first(nodes), relationships: first(rels) };
    } catch {
      return { nodes: 0, relationships: 0 };
    }
  }

  async run(): Promise<SyncStats> {
    const startedAt = Date.now();

    await ensureIngestionIndexes(this.graph);
    await ensureFulltextIndexes(this.graph);

    await this.pruneOutsideHistoryWindow();
    await this.pruneExcludedRepositories();

    this.onProgress("connecting", {
      message: "Talking to GitHub",
    });

    const user = await this.getDeveloperInfo();

    await this.storeDeveloper(user);

    this.onProgress("fetching_repos", {
      message: "Listing repositories",
    });

    const repositories = await this.getRepositories();

    this.onProgress("repos_found", {
      count: repositories.length,
    });

    const stats: SyncStats = {
      repositories: 0,
      pullRequests: 0,
      pullRequestDetails: 0,
      issues: 0,
      reviewedPullRequests: 0,

      commitsDiscovered: 0,
      commitsProcessed: 0,
      commitsSkipped: 0,

      filesChanged: 0,
      sourceFiles: 0,
      testFiles: 0,
      filesIgnored: 0,

      patchesStored: 0,
      addedCodeChars: 0,
      deletedCodeChars: 0,

      hunksParsed: 0,
      symbolsExtracted: 0,
      importsExtracted: 0,
      dependencyChanges: 0,

      repairedCommits: 0,
      emptyPatches: 0,
      githubRetries: 0,

      dbNodes: 0,
      dbRelationships: 0,
    };

    const repositoryIds = repositories.map((repo) => String(repo.id));

    const [lastSyncedAtByRepo, incompleteByRepo] = await Promise.all([
      this.getLastSyncedAtBatch(repositoryIds),
      this.getIncompleteCommitsBatch(repositoryIds),
    ]);

    const overlapMs = SYNC_OVERLAP_DAYS * 24 * 60 * 60 * 1000;

    const repositoryResults = await mapWithConcurrency(
      repositories,
      async (repo) => {
        this.onProgress("repo_started", { repo: repo.name });

        const repoKey = String(repo.id);
        const lastSyncedAt = lastSyncedAtByRepo.get(repoKey) ?? "";
        const incomplete =
          incompleteByRepo.get(repoKey) ?? new Map<string, string>();

        let discoveryFailed = false;

        const checkpointTime = lastSyncedAt
          ? new Date(lastSyncedAt).getTime()
          : 0;

        const sinceMs = checkpointTime
          ? Math.max(checkpointTime - overlapMs, getHistoryCutoff())
          : getHistoryCutoff();

        const [prs, commits] = await Promise.all([
          FETCH_PRS || FETCH_PR_FILES
            ? this.getPullRequests(repo.name).catch(() => {
                discoveryFailed = true;
                return [] as GitHubPullRequest[];
              })
            : Promise.resolve([] as GitHubPullRequest[]),

          checkpointTime
            ? this.getCommits(repo.name, {
                since: new Date(sinceMs).toISOString(),
                maxCommits: MAX_INITIAL_COMMITS_PER_REPO,
              }).catch(() => {
                discoveryFailed = true;
                return [] as GitHubCommit[];
              })
            : this.getInitialCommits(repo.name).catch(() => {
                discoveryFailed = true;
                return [] as GitHubCommit[];
              }),
        ]);

        const cutoff = getHistoryCutoff();

        const ownPRs = prs.filter((pr) => {
          if (pr.user?.login?.toLowerCase() !== this.owner.toLowerCase()) {
            return false;
          }

          const timestamp = pr.created_at
            ? new Date(pr.created_at).getTime()
            : 0;

          return timestamp >= cutoff;
        });

        const baseCandidates = checkpointTime
          ? commits.filter((commit) => getCommitTimestamp(commit) > sinceMs - 1)
          : selectInitialCommits(commits);

        const candidateShas = new Set(baseCandidates.map((c) => c.sha));
        const repairStubs: GitHubCommit[] = [];

        for (const [sha, date] of incomplete) {
          if (!candidateShas.has(sha)) {
            repairStubs.push({
              sha,
              commit: { author: { date }, committer: { date } },
            });
          }
        }

        const candidateCommits = [...baseCandidates, ...repairStubs];

        if (DEBUG_GITHUB_PATCH) {
          console.log(`\n🧠 HISTORY SELECTION: ${repo.name}`);
          console.log(`   GitHub commits fetched: ${commits.length}`);
          console.log(`   base candidates: ${baseCandidates.length}`);
          console.log(`   repair/backfill stubs: ${repairStubs.length}`);
        }

        return {
          repo,
          prs: ownPRs,
          commits: candidateCommits,
          allCommits: commits,
          repairShas: new Set(incomplete.keys()),
          discoveryFailed,
        };
      },
      REPO_CONCURRENCY,
    );

    const activeResults = repositoryResults.filter(
      ({ commits }) => commits.length > 0,
    );

    const activeRepositories = activeResults.map(({ repo }) => repo);

    await this.storeRepositories(activeRepositories);
    stats.repositories = activeRepositories.length;

    await mapWithConcurrency(
      activeRepositories,
      async (repo) => {
        const lastSyncedAt = lastSyncedAtByRepo.get(String(repo.id)) ?? "";
        const needsContextRefresh =
          !lastSyncedAt ||
          Date.now() - new Date(lastSyncedAt).getTime() >
            REPO_CONTEXT_REFRESH_DAYS * 24 * 60 * 60 * 1000;

        if (!needsContextRefresh || this.rateLimited) {
          return;
        }

        const context = await this.getRepoContext(repo).catch(
          () =>
            ({
              readme: "",
              manifestFiles: [],
              configFiles: [],
              rootEntries: [],
              tooling: {},
              dependencies: {},
            }) as RepoContext,
        );

        await this.storeRepoContext(String(repo.id), context);

        this.onProgress("repo_context", {
          repo: repo.name,
          manifests: context.manifestFiles.length,
          configs: context.configFiles.length,
          ecosystems: Object.keys(context.dependencies),
        });
      },
      REPO_CONCURRENCY,
    );

    await this.pruneInactiveRepositoryLinks();

    await mapWithConcurrency(
      activeResults,
      async ({ repo, allCommits }) => {
        await this.storeCommitMetadata(allCommits, String(repo.id));
      },
      REPO_CONCURRENCY,
    );

    const allPRs = activeResults.flatMap(({ repo, prs }) =>
      prs.map((pr) => ({ repo, pr })),
    );

    stats.pullRequests = allPRs.length;

    await this.storePullRequests(allPRs);

    await this.linkCommitsToPullRequests(
      activeResults.map(({ repo, allCommits }) => ({
        commits: allCommits,
        repoId: String(repo.id),
      })),
    );

    if (FETCH_PR_DETAILS && MAX_PR_DETAILS > 0 && allPRs.length > 0) {
      const newest = [...allPRs]
        .sort(
          (a, b) =>
            new Date(b.pr.created_at ?? 0).getTime() -
            new Date(a.pr.created_at ?? 0).getTime(),
        )
        .slice(0, MAX_PR_DETAILS);

      const detailRows = (
        await mapWithConcurrency(
          newest,
          async ({ repo, pr }) =>
            this.rateLimited ? null : this.getPullRequestDetail(repo, pr),
          PR_DETAIL_CONCURRENCY,
        )
      ).filter((row): row is QueryParamObject => row !== null);

      await this.storePullRequestDetails(detailRows);

      stats.pullRequestDetails = detailRows.length;

      this.onProgress("pr_details_synced", { count: detailRows.length });
    }

    if (FETCH_PR_FILES && allPRs.length > 0) {
      const prFileResults = await mapWithConcurrency(
        allPRs,
        async ({ repo, pr }) => {
          try {
            const files = await this.getPullRequestFiles(repo.name, pr.number);

            return files.map((file) => ({ file, repo, pr }));
          } catch {
            return [];
          }
        },
        REPO_CONCURRENCY,
      );

      await this.storePRFiles(prFileResults.flat());
    }

    if (!this.rateLimited) {
      const activity = await this.syncActivity();

      stats.issues = activity.issues;
      stats.reviewedPullRequests = activity.reviewed;

      this.onProgress("activity_synced", activity);
    }

    const commitMap = new Map<
      string,
      {
        commit: GitHubCommit;
        repo: GitHubRepository;
        repairShas: Set<string>;
      }
    >();

    for (const { repo, commits, repairShas } of activeResults) {
      for (const commit of commits) {
        if (!commit.sha) {
          continue;
        }

        const commitKey = `${repo.id}:${commit.sha}`;

        if (!commitMap.has(commitKey)) {
          commitMap.set(commitKey, { commit, repo, repairShas });
        }
      }
    }

    let uniqueCommits = Array.from(commitMap.values());

    if (uniqueCommits.length > MAX_INITIAL_COMMITS_TOTAL) {
      const droppedCount = uniqueCommits.length - MAX_INITIAL_COMMITS_TOTAL;

      uniqueCommits = uniqueCommits
        .sort(
          (a, b) => getCommitTimestamp(b.commit) - getCommitTimestamp(a.commit),
        )
        .slice(0, MAX_INITIAL_COMMITS_TOTAL);

      this.onProgress("commit_budget_applied", {
        budget: MAX_INITIAL_COMMITS_TOTAL,
        dropped: droppedCount,
      });
    }

    stats.commitsDiscovered = uniqueCommits.length;

    this.onProgress("commits_discovered", {
      count: uniqueCommits.length,
    });

    const processedCommitIds = await this.getProcessedCommitIds(uniqueCommits);

    let completed = 0;

    const collected: CommitResult[] = [];
    const unprocessedRepoIds = new Set<string>();

    await mapWithConcurrency(
      uniqueCommits,
      async ({ commit, repo, repairShas }) => {
        if (this.rateLimited) {
          unprocessedRepoIds.add(String(repo.id));
          return;
        }

        try {
          const result = await this.processCommit(
            commit,
            repo,
            processedCommitIds,
            repairShas,
          );

          collected.push(result);

          if (result.failed) {
            unprocessedRepoIds.add(String(repo.id));
          }
        } catch (error) {
          if (!isRateLimitError(error)) {
            throw error;
          }

          this.rateLimited = true;
          unprocessedRepoIds.add(String(repo.id));
        }

        completed++;

        if (completed % 5 === 0 || completed === uniqueCommits.length) {
          this.onProgress("sync_progress", {
            processed: completed,
            total: uniqueCommits.length,
          });
        }
      },
      COMMIT_CONCURRENCY,
    );

    const rateLimited = this.rateLimited;

    if (rateLimited) {
      this.onProgress("rate_limited", {
        message: "GitHub rate limit hit — stopped further requests",
        processed: completed,
        total: uniqueCommits.length,
      });
    }

    const commitResults = collected;

    stats.commitsSkipped = commitResults.filter((r) => r.skipped).length;

    stats.commitsProcessed = commitResults.filter(
      (r) => !r.skipped && !r.failed && r.changes.length > 0,
    ).length;

    stats.repairedCommits = commitResults.filter(
      (r) => r.repaired && !r.skipped && !r.failed,
    ).length;

    const allFileChanges = commitResults.flatMap((r) => r.changes);

    stats.filesChanged = allFileChanges.length;

    stats.sourceFiles = commitResults.reduce((s, r) => s + r.sourceFiles, 0);

    stats.filesIgnored = commitResults.reduce((s, r) => s + r.ignoredFiles, 0);

    stats.emptyPatches = commitResults.reduce((s, r) => s + r.emptyPatches, 0);

    stats.patchesStored = allFileChanges.length;

    stats.testFiles = allFileChanges.filter((c) => c.is_test).length;

    for (const change of allFileChanges) {
      stats.addedCodeChars += change.added_code_chars;
      stats.deletedCodeChars += change.deleted_code_chars;
      stats.hunksParsed += change.hunk_count;

      stats.symbolsExtracted +=
        safeNumber(JSON.parse(change.symbols_added_json).length) +
        safeNumber(JSON.parse(change.symbols_modified_json).length);

      stats.importsExtracted += safeNumber(
        JSON.parse(change.imports_added_json).length,
      );

      if (change.dependency_changes_json) {
        const deps = JSON.parse(
          change.dependency_changes_json,
        ) as DependencyChanges;

        stats.dependencyChanges +=
          deps.added.length + deps.removed.length + deps.changed.length;
      }
    }

    this.onProgress("writing", {
      message: "Writing commits and code evidence to FalkorDB",
    });

    await this.storeFileChanges(allFileChanges);

    await this.storeCommitEnrichment(
      commitResults
        .map((r) => r.enrichment)
        .filter((e): e is CommitEnrichment => e !== null),
    );

    // Learn only from the file changes in this sync batch. Existing demonstration IDs
    // are skipped by the pipeline, preventing repeated LLM calls for overlap commits.
    try {
      const contextByCommit = new Map<
        string,
        { repositoryFullName: string; commitMessage: string }
      >();
      for (const item of commitResults) {
        const repositoryId = String(item.repo.id);
        const commitSha = safeString(item.commit.sha);
        if (!repositoryId || !commitSha) continue;
        contextByCommit.set(`${repositoryId}:${commitSha}`, {
          repositoryFullName: safeString(item.repo.full_name),
          commitMessage: safeString(item.commit.commit?.message),
        });
      }

      const learningResult = await runLearningPipeline({
        graph: this.graph,
        developerId: this.developerId,
        fileChanges: allFileChanges.map((change) => ({
          id: change.id,
          path: change.path,
          language: change.language,
          patch: change.patch,
          addedCode: change.added_code,
          commitSha: change.commit_sha,
          repositoryId: change.repository_id,
          createdAt: change.created_at,
        })),
        contextByCommit,
        reasoner: cerebrasLearningReasoner,
        buildId: `learning-${this.developerId}-${Date.now()}`,
      });
      this.onProgress(
        "learning_complete",
        learningResult as unknown as Record<string, unknown>,
      );
    } catch (error) {
      // Learning is an enrichment stage: a Cerebras outage must not invalidate a successful GitHub sync.
      const message = error instanceof Error ? error.message : String(error);
      console.error("[learning-pipeline] Failed after GitHub sync:", message);
      this.onProgress("learning_failed", { message });
    }

    const syncTimestamp = new Date().toISOString();

    const failedDiscovery = new Set(
      activeResults
        .filter((r) => r.discoveryFailed)
        .map((r) => String(r.repo.id)),
    );

    const repositoriesToCheckpoint = activeRepositories.filter((repo) => {
      const id = String(repo.id);
      return !failedDiscovery.has(id) && !unprocessedRepoIds.has(id);
    });

    await mapWithConcurrency(
      repositoriesToCheckpoint,
      async (repo) => {
        await this.setLastSyncedAt(String(repo.id), syncTimestamp);
      },
      REPO_CONCURRENCY,
    );

    const graphCounts = await this.countGraph();

    stats.dbNodes = graphCounts.nodes;
    stats.dbRelationships = graphCounts.relationships;
    stats.githubRetries = this.retryCount;

    const duration = (Date.now() - startedAt) / 1000;

    this.onProgress("sync_complete", {
      ...stats,
      durationSeconds: Number(duration.toFixed(1)),
      rateLimited,
    });

    return stats;
  }
}
