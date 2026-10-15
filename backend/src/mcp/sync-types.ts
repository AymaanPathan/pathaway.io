export type AnyObject = Record<string, any>;
export type ProgressFn = (stage: string, detail?: AnyObject) => void;

export interface GitHubRepository {
  id: number | string;
  name: string;
  full_name: string;
  description?: string;
  language?: string;
  html_url?: string;
  homepage?: string;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  size?: number;
  topics?: string[];
  license?: { spdx_id?: string; name?: string } | null;
  created_at?: string;
  updated_at?: string;
  pushed_at?: string;
  private?: boolean;
  archived?: boolean;
  fork?: boolean;
  default_branch?: string;
}

export interface GitHubCommit {
  sha: string;
  html_url?: string;

  commit?: {
    message?: string;
    author?: {
      name?: string;
      email?: string;
      date?: string;
    };
    committer?: {
      name?: string;
      email?: string;
      date?: string;
    };
  };

  author?: {
    login?: string;
    id?: number;
  };

  committer?: {
    login?: string;
    id?: number;
  };
}

export interface GitHubCommitFile {
  filename?: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
  sha?: string;
  blob_url?: string;
  raw_url?: string;
}

export interface GitHubCommitDetails {
  sha?: string;
  files?: GitHubCommitFile[];
  stats?: {
    additions?: number;
    deletions?: number;
    total?: number;
  };
  parents?: Array<{ sha?: string }>;
}

export interface GitHubPullRequest {
  number: number;
  title?: string;
  body?: string;
  state?: string;
  draft?: boolean;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  merged_at?: string;
  user?: {
    login?: string;
    id?: number;
  };
  head?: {
    sha?: string;
    ref?: string;
  };
  base?: {
    sha?: string;
    ref?: string;
  };
}

export type FileRole =
  | "source"
  | "test"
  | "migration"
  | "schema"
  | "style"
  | "markup"
  | "config"
  | "infra"
  | "dependency_manifest";

export interface FileChangeRecord {
  id: string;
  path: string;
  previous_path: string;
  is_rename: boolean;
  language: string;
  file_role: FileRole;
  is_test: boolean;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  net_lines: number;
  patch: string;
  added_code: string;
  deleted_code: string;
  commit_sha: string;
  commit_id: string;
  repository_id: string;
  developer_id: string;
  file_sha: string;
  is_source_code: boolean;
  evidence_type: "authored_diff";

  hunk_count: number;
  hunks_json: string;
  touched_scopes_json: string;
  symbols_added_json: string;
  symbols_modified_json: string;
  symbols_removed_json: string;
  imports_added_json: string;
  imports_removed_json: string;
  relative_imports_added: number;
  code_signals_json: string;
  comment_lines_added: number;
  max_indent_depth: number;
  dependency_changes_json: string;

  analysis_version: number;
  source: "github_mcp";
  source_version: "full_patch";
  ingested_at: string;

  created_at: string;
  date_ts: number;
  patch_available: boolean;
  patch_truncated: boolean;
  added_code_chars: number;
  deleted_code_chars: number;
}

export interface RepoContext {
  readme: string;
  manifestFiles: Array<{ filename: string; content: string }>;
  configFiles: Array<{ filename: string; content: string }>;
  rootEntries: string[];
  tooling: Record<string, unknown>;
  dependencies: Record<
    string,
    { runtime: Record<string, string>; dev: Record<string, string> }
  >;
}

export interface SyncStats {
  repositories: number;
  pullRequests: number;
  pullRequestDetails: number;
  issues: number;
  reviewedPullRequests: number;
  commitsDiscovered: number;
  commitsProcessed: number;
  commitsSkipped: number;
  filesChanged: number;
  sourceFiles: number;
  testFiles: number;
  filesIgnored: number;
  patchesStored: number;
  addedCodeChars: number;
  deletedCodeChars: number;
  hunksParsed: number;
  symbolsExtracted: number;
  importsExtracted: number;
  dependencyChanges: number;
  repairedCommits: number;
  emptyPatches: number;
  githubRetries: number;

  dbNodes: number;
  dbRelationships: number;
}
