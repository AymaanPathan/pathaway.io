import type {
  AnyObject,
  FileChangeRecord,
  GitHubCommit,
  GitHubRepository,
} from "./sync-types.js";
import { MAX_DEPENDENCIES_PER_ECOSYSTEM } from "./sync-config.js";
import { dependencyMapFromLines } from "./sync-analysis.js";

export type DependencyBuckets = {
  runtime: Record<string, string>;
  dev: Record<string, string>;
};

export function capEntries(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).slice(0, MAX_DEPENDENCIES_PER_ECOSYSTEM),
  );
}

export function parseManifestDependencies(
  filename: string,
  content: string,
): {
  ecosystem: string;
  buckets: DependencyBuckets;
  meta?: Record<string, unknown>;
} | null {
  const base = filename.toLowerCase();
  const runtime: Record<string, string> = {};
  const dev: Record<string, string> = {};

  try {
    if (base === "package.json" || base === "composer.json") {
      const json = JSON.parse(content) as AnyObject;
      const isNpm = base === "package.json";

      const runtimeSources = isNpm
        ? [json.dependencies, json.peerDependencies, json.optionalDependencies]
        : [json.require];
      const devSources = isNpm ? [json.devDependencies] : [json["require-dev"]];

      for (const source of runtimeSources) {
        Object.assign(runtime, source ?? {});
      }

      for (const source of devSources) {
        Object.assign(dev, source ?? {});
      }

      return {
        ecosystem: isNpm ? "npm" : "composer",
        buckets: { runtime: capEntries(runtime), dev: capEntries(dev) },
        meta: isNpm
          ? {
              scripts: Object.keys(json.scripts ?? {}).slice(0, 40),
              engines: json.engines ?? {},
              workspaces: Boolean(json.workspaces),
              type: json.type ?? "",
            }
          : undefined,
      };
    }
  } catch {
    return null;
  }

  const lines = content.split("\n");

  if (base === "requirements.txt") {
    const map = dependencyMapFromLines("requirements.txt", lines);

    for (const [name, version] of map) {
      runtime[name] = version;
    }

    return { ecosystem: "pip", buckets: { runtime: capEntries(runtime), dev } };
  }

  if (base === "go.mod") {
    const map = dependencyMapFromLines("go.mod", lines);

    for (const [name, version] of map) {
      runtime[name] = version;
    }

    return { ecosystem: "go", buckets: { runtime: capEntries(runtime), dev } };
  }

  if (base === "gemfile") {
    const map = dependencyMapFromLines("gemfile", lines);

    for (const [name, version] of map) {
      runtime[name] = version;
    }

    return { ecosystem: "gem", buckets: { runtime: capEntries(runtime), dev } };
  }

  if (base === "pyproject.toml" || base === "cargo.toml") {
    let section = "";
    let inArray = false;

    for (const raw of lines) {
      const line = raw.trim();
      const header = /^\[([^\]]+)\]$/.exec(line);

      if (header) {
        section = header[1].toLowerCase();
        inArray = false;
        continue;
      }

      const isDevSection = /dev|test|lint|docs/.test(section);
      const isDepSection = /dependencies$/.test(section);

      if (
        /^dependencies\s*=\s*\[/.test(line) ||
        /^[\w-]+\s*=\s*\[$/.test(line)
      ) {
        inArray = true;
      }

      if (isDepSection || inArray) {
        const map = dependencyMapFromLines(base, [line]);

        for (const [name, version] of map) {
          (isDevSection ? dev : runtime)[name] = version;
        }
      }

      if (inArray && line.includes("]")) {
        inArray = false;
      }
    }

    return {
      ecosystem: base === "cargo.toml" ? "cargo" : "pyproject",
      buckets: { runtime: capEntries(runtime), dev: capEntries(dev) },
    };
  }

  return null;
}


export interface CommitEnrichment {
  id: string;
  status: "full_patch" | "no_source_changes";
  additions: number;
  deletions: number;
  files_count: number;
  source_files_count: number;
  test_files_count: number;
  config_files_count: number;
  parent_count: number;
  is_merge: boolean;
  languages_json: string;
  roles_json: string;
}

export interface CommitResult {
  commit: GitHubCommit;
  repo: GitHubRepository;
  changes: FileChangeRecord[];
  sourceFiles: number;
  ignoredFiles: number;
  emptyPatches: number;
  skipped: boolean;
  failed: boolean;
  repaired: boolean;
  enrichment: CommitEnrichment | null;
}
