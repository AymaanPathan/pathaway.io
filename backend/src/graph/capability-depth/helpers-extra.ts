import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers_extra2 } from './readers-extra2.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import FILE_PAGE_SIZE = _constants.FILE_PAGE_SIZE;
import DB_BATCH_SIZE = _constants.DB_BATCH_SIZE;
import DEMO_LIMIT = _constants.DEMO_LIMIT;
import TAXONOMY_TTL_MS = _constants.TAXONOMY_TTL_MS;
import DEPTH_ANALYSIS_VERSION = _constants.DEPTH_ANALYSIS_VERSION;
import DEPTH_RANK = _constants.DEPTH_RANK;
import DEPTH_LEVELS = _constants.DEPTH_LEVELS;
import DEPTH_BANDS = _constants.DEPTH_BANDS;
import TOPIC_DOMAINS = _constants.TOPIC_DOMAINS;
import PREREQ_MET_RANK = _constants.PREREQ_MET_RANK;
import schemaReady = _constants.schemaReady;
import log = _helpers.log;
import raw = _helpers.raw;
import str = _helpers.str;
import num = _helpers.num;
import bool = _helpers.bool;
import strList = _helpers.strList;
import mapList = _helpers.mapList;
import unique = _helpers.unique;
import round = _helpers.round;
import clamp01 = _helpers.clamp01;
import parseJson = _helpers.parseJson;
import chunk = _helpers.chunk;
import slugify = _helpers.slugify;
import envInt = _helpers.envInt;
import DAY_MS = _helpers.DAY_MS;
import toParams = _helpers.toParams;
import rows = _helpers.rows;
import tryRows = _helpers.tryRows;
import runCounted = _helpers.runCounted;
import ignoreExists = _helpers.ignoreExists;
import levelForScore = _helpers.levelForScore;
import asDepthLevel = _helpers.asDepthLevel;
import AUTHENTICITY = _helpers.AUTHENTICITY;
import asAuthenticity = _helpers.asAuthenticity;
import asConfidence = _helpers.asConfidence;
import DOMAIN_SYNONYMS = _helpers.DOMAIN_SYNONYMS;
import asTopicDomain = _helpers.asTopicDomain;
import SUPPORTED_TOPIC_RELATIONS = _helpers.SUPPORTED_TOPIC_RELATIONS;
import MIN_MAPPING_WEIGHT = _helpers.MIN_MAPPING_WEIGHT;
import GENERIC_RELATION_TEMPLATE = _helpers.GENERIC_RELATION_TEMPLATE;
import setupSchema = _helpers.setupSchema;
import listTopicCatalog = _readers_extra2.listTopicCatalog;
import listCapabilityCatalog = _readers_extra2.listCapabilityCatalog;
import findTopicsByText = _readers_extra2.findTopicsByText;
import readTaxonomyEdges = _readers_extra2.readTaxonomyEdges;
import readTopicMeta = _readers_extra2.readTopicMeta;
import readDeveloperDepthMap = _readers_extra2.readDeveloperDepthMap;
import isPrereqMet = _readers_extra2.isPrereqMet;
import readTopicContext = _readers_extra2.readTopicContext;
import readTopicPath = _readers_extra2.readTopicPath;
import readTopicPathDetailed = _readers_extra2.readTopicPathDetailed;
import readTopicEvidenceTraversal = _readers_extra2.readTopicEvidenceTraversal;
import readTopicLearningGraph = _readers_extra2.readTopicLearningGraph;
import readLearningFrontier = _readers_extra2.readLearningFrontier;
import readTopicsForBackfill = _readers_extra2.readTopicsForBackfill;
import readOrphanReport = _readers_extra2.readOrphanReport;
import readDeveloperTopicProfile = _readers_extra2.readDeveloperTopicProfile;
import readTopicDepthDetail = _readers_extra2.readTopicDepthDetail;
import readStoredTopicSpec = _readers_extra2.readStoredTopicSpec;
import readDeveloperKnowledgeGraph = _readers_extra2.readDeveloperKnowledgeGraph;
import readDeveloperTopicEvidenceGraph = _readers_extra2.readDeveloperTopicEvidenceGraph;
import isSpecificRationale = _readers.isSpecificRationale;
import isoDay = _readers.isoDay;
import fetchFileRecords = _readers.fetchFileRecords;
import fetchDemonstrations = _readers.fetchDemonstrations;
import readEvidenceAtlas = _readers.readEvidenceAtlas;
import Row = _types.Row;
import ProgressFn = _types.ProgressFn;
import Primitive = _types.Primitive;
import DepthLevel = _types.DepthLevel;
import Authenticity = _types.Authenticity;
import Confidence = _types.Confidence;
import TopicDomain = _types.TopicDomain;
import TopicRelationType = _types.TopicRelationType;
import RelationStrength = _types.RelationStrength;
import RelationBasis = _types.RelationBasis;
import FileRecord = _types.FileRecord;
import DemoRow = _types.DemoRow;
import FileIndex = _types.FileIndex;
import PackageAtom = _types.PackageAtom;
import SignalAtom = _types.SignalAtom;
import VocabAtom = _types.VocabAtom;
import AtomCluster = _types.AtomCluster;
import AtlasCapability = _types.AtlasCapability;
import AtlasExperience = _types.AtlasExperience;
import AtlasSkill = _types.AtlasSkill;
import AtlasRepository = _types.AtlasRepository;
import EvidenceAtlas = _types.EvidenceAtlas;
import ApproachSpec = _types.ApproachSpec;
import CapabilityMappingSpec = _types.CapabilityMappingSpec;
import RelationDetail = _types.RelationDetail;
import TopicSpec = _types.TopicSpec;
import EvidenceTotals = _types.EvidenceTotals;
import EvidenceRef = _types.EvidenceRef;
import BaselineDepth = _types.BaselineDepth;
import ApproachEvidence = _types.ApproachEvidence;
import CodeSample = _types.CodeSample;
import DemoNote = _types.DemoNote;
import ExperienceNote = _types.ExperienceNote;
import CommitNote = _types.CommitNote;
import EvidenceBrief = _types.EvidenceBrief;
import DeveloperTopicDepth = _types.DeveloperTopicDepth;
import TopicContext = _types.TopicContext;
import TopicFootprint = _types.TopicFootprint;
import TopicEvidence = _types.TopicEvidence;
import Acc = _types.Acc;
import Compiled = _types.Compiled;
import MatchInfo = _types.MatchInfo;
import BaselineInput = _types.BaselineInput;
import GatherOptions = _types.GatherOptions;
import TopicCatalogEntry = _types.TopicCatalogEntry;
import CapabilityCatalogEntry = _types.CapabilityCatalogEntry;
import TaxonomyEdge = _types.TaxonomyEdge;
import TopicMeta = _types.TopicMeta;
import TaxonomyCache = _types.TaxonomyCache;
import WalkNode = _types.WalkNode;
import TopicPathHop = _types.TopicPathHop;
import TopicEvidencePath = _types.TopicEvidencePath;
import LearningEdge = _types.LearningEdge;
import LearningNode = _types.LearningNode;
import RelatedLearningNode = _types.RelatedLearningNode;
import TopicLearningGraph = _types.TopicLearningGraph;
import LearningFrontierEntry = _types.LearningFrontierEntry;
import TopicGraphMetrics = _types.TopicGraphMetrics;
import ApproachRecord = _types.ApproachRecord;
import ImplementationNote = _types.ImplementationNote;
import DepthAssessmentRecord = _types.DepthAssessmentRecord;
import TopicRelationInput = _types.TopicRelationInput;
import TopicRelationRejection = _types.TopicRelationRejection;
import StoreDepthInput = _types.StoreDepthInput;
import StoreDepthResult = _types.StoreDepthResult;
import TopicMetadataInput = _types.TopicMetadataInput;
import TopicCapabilityMapping = _types.TopicCapabilityMapping;
import BackfillTopicRow = _types.BackfillTopicRow;
import DepthProfileSummary = _types.DepthProfileSummary;
import OrphanReport = _types.OrphanReport;
import TopicDepthSummary = _types.TopicDepthSummary;
import DeveloperTopicProfile = _types.DeveloperTopicProfile;
import TopicDepthDetail = _types.TopicDepthDetail;
import DeveloperKnowledgeNode = _types.DeveloperKnowledgeNode;
import DeveloperKnowledgeEdge = _types.DeveloperKnowledgeEdge;
import DeveloperKnowledgeGraph = _types.DeveloperKnowledgeGraph;
import ensureDepthSchema = _writers.ensureDepthSchema;
import ensureTexts = _writers.ensureTexts;
import writeTopicMetric = _writers.writeTopicMetric;
import refreshTopicGraphMetrics = _writers.refreshTopicGraphMetrics;
import refreshTopicGraphMetricsImpl = _writers.refreshTopicGraphMetricsImpl;
import writeTopicMetadata = _writers.writeTopicMetadata;
import writeTopicCapabilityMappings = _writers.writeTopicCapabilityMappings;
import writeTopicRelations = _writers.writeTopicRelations;
import writeTopicRelationsImpl = _writers.writeTopicRelationsImpl;
import storeDepthAssessments = _writers.storeDepthAssessments;
import storeDepthProfileSummary = _writers.storeDepthProfileSummary;
import deleteWhere = _writers.deleteWhere;
import cleanupOrphans = _writers.cleanupOrphans;

export const NON_CODE_ROLES = new Set(["config", "infra", "dependency_manifest"]);

export const GENERIC_SIGNALS = new Set([
  "async_await",
  "error_handling",
  "generics",
  "hook_calls",
  "decorators",
  "todo_markers",
  "any_usage",
  "lint_type_suppressions",
  "comment_markers",
]);

export const GENERIC_SIGNAL_MIN = 3;

export const DEFINING_KINDS = new Set([
  "class",
  "function",
  "component",
  "interface",
  "type",
  "enum",
  "struct",
  "trait",
  "impl",
  "method",
  "module",
  "model",
  "route",
  "ddl",
  "contract",
  "resource",
]);

export const VOCAB_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "get",
  "set",
  "use",
  "new",
  "index",
  "main",
  "app",
  "src",
  "lib",
  "libs",
  "util",
  "utils",
  "helper",
  "helpers",
  "common",
  "shared",
  "types",
  "type",
  "test",
  "tests",
  "spec",
  "data",
  "item",
  "items",
  "list",
  "value",
  "values",
  "handler",
  "handlers",
  "props",
  "state",
  "default",
  "config",
  "file",
  "files",
  "page",
  "pages",
  "component",
  "components",
  "function",
  "class",
  "const",
  "init",
  "args",
  "result",
  "results",
  "error",
  "errors",
  "async",
  "await",
  "from",
  "into",
  "all",
  "one",
  "two",
  "tsx",
  "jsx",
  "json",
  "map",
  "key",
  "keys",
  "name",
  "names",
  "string",
  "number",
  "object",
  "array",
  "param",
  "params",
  "options",
  "option",
  "context",
  "service",
  "services",
  "model",
  "models",
  "request",
  "response",
  "req",
  "res",
]);

export function splitIdentifier(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(
      (t) => t.length >= 3 && !/^\d+$/.test(t) && !VOCAB_STOPWORDS.has(t),
    );
}

export function symbolName(symbol: string): string {
  const i = symbol.indexOf(":");
  return i === -1 ? symbol : symbol.slice(i + 1);
}

export function symbolKind(symbol: string): string {
  const i = symbol.indexOf(":");
  return i === -1 ? "" : symbol.slice(0, i);
}

export const newAcc = (): Acc => ({
  files: 0,
  commits: new Set(),
  repos: new Set(),
  days: new Set(),
  first: Number.POSITIVE_INFINITY,
  last: 0,
  count: 0,
});

export function touch(acc: Acc, f: FileRecord, count = 1): void {
  acc.files += 1;
  acc.count += count;
  acc.commits.add(f.commitId);
  if (f.repositoryId) acc.repos.add(f.repositoryId);
  if (f.ts) {
    acc.first = Math.min(acc.first, f.ts);
    acc.last = Math.max(acc.last, f.ts);
    acc.days.add(isoDay(f.ts));
  }
}

export function propagateLabels(
  nodes: string[],
  edges: Array<[string, string, number]>,
  maxIterations = 15,
): Map<string, string> {
  const adjacency = new Map<string, Map<string, number>>();
  for (const n of nodes) adjacency.set(n, new Map());
  for (const [a, b, w] of edges) {
    adjacency.get(a)?.set(b, w);
    adjacency.get(b)?.set(a, w);
  }
  const labels = new Map(nodes.map((n) => [n, n]));
  const order = [...nodes].sort();

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    for (const node of order) {
      const weights = new Map<string, number>();
      for (const [neighbor, w] of adjacency.get(node) ?? []) {
        const label = labels.get(neighbor) as string;
        weights.set(label, (weights.get(label) ?? 0) + w);
      }
      if (weights.size === 0) continue;
      let best = labels.get(node) as string;
      let bestWeight = -1;
      for (const [label, w] of [...weights.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )) {
        if (w > bestWeight) {
          best = label;
          bestWeight = w;
        }
      }
      if (best !== labels.get(node)) {
        labels.set(node, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return labels;
}

export function buildClusters(files: FileRecord[]): AtomCluster[] {
  const commitAtoms = new Map<string, Set<string>>();
  for (const f of files) {
    if (f.isTest || NON_CODE_ROLES.has(f.role)) continue;
    let set = commitAtoms.get(f.commitId);
    if (!set) {
      set = new Set();
      commitAtoms.set(f.commitId, set);
    }
    for (const p of f.packages) set.add(`pkg:${p}`);
    for (const [s, c] of Object.entries(f.signals)) {
      if (!GENERIC_SIGNALS.has(s) && c >= 1) set.add(`sig:${s}`);
    }
  }

  const freq = new Map<string, number>();
  for (const set of commitAtoms.values()) {
    for (const a of set) freq.set(a, (freq.get(a) ?? 0) + 1);
  }

  const pairs = new Map<string, number>();
  for (const set of commitAtoms.values()) {
    if (set.size < 2 || set.size > 40) continue;
    const atoms = [...set].filter((a) => (freq.get(a) ?? 0) >= 2).sort();
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const key = `${atoms[i]}\u0000${atoms[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const edges: Array<[string, string, number]> = [];
  const nodeSet = new Set<string>();
  for (const [key, co] of pairs) {
    if (co < 2) continue;
    const [a, b] = key.split("\u0000") as [string, string];
    const w = co / Math.min(freq.get(a) ?? co, freq.get(b) ?? co);
    if (w < 0.4) continue;
    edges.push([a, b, w]);
    nodeSet.add(a);
    nodeSet.add(b);
  }
  if (edges.length === 0) return [];

  const labels = propagateLabels([...nodeSet], edges);
  const groups = new Map<string, string[]>();
  for (const [node, label] of labels) {
    const list = groups.get(label) ?? [];
    list.push(node);
    groups.set(label, list);
  }

  const clusters: AtomCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const set = new Set(members);
    const inside = edges.filter(([a, b]) => set.has(a) && set.has(b));
    clusters.push({
      id: "",
      members: members
        .sort(
          (a, b) =>
            (freq.get(b) ?? 0) - (freq.get(a) ?? 0) || a.localeCompare(b),
        )
        .slice(0, 10),
      commits: members.reduce((n, m) => n + (freq.get(m) ?? 0), 0),
      cohesion: inside.length
        ? round(inside.reduce((n, e) => n + e[2], 0) / inside.length)
        : 0,
    });
  }
  return clusters
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 20)
    .map((c, i) => ({ ...c, id: `cl${i + 1}` }));
}

export function parseDeclared(json: unknown): Set<string> {
  const out = new Set<string>();
  const parsed = parseJson<Record<string, any>>(json, {});
  for (const bucket of Object.values(parsed)) {
    if (!bucket || typeof bucket !== "object") continue;
    for (const group of [bucket.runtime, bucket.dev]) {
      if (group && typeof group === "object") {
        for (const name of Object.keys(group)) out.add(name.toLowerCase());
      }
    }
  }
  return out;
}

export const atlasCache = new Map<string, { at: number; atlas: EvidenceAtlas }>();

export function invalidateAtlasCache(developerId?: string): void {
  if (developerId) atlasCache.delete(developerId);
  else atlasCache.clear();
}

export const normalizeKeyword = (k: string): string =>
  k
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

export function compileAtoms(
  atoms: { packages: string[]; signals: string[]; keywords: string[] },
  pinned: string[] = [],
): Compiled {
  return {
    packages: new Set(atoms.packages.map((p) => p.toLowerCase())),
    signals: new Set(atoms.signals),
    keywords: unique(
      atoms.keywords.map(normalizeKeyword).filter((k) => k.length >= 3),
    ),
    pinned: new Set(pinned),
  };
}

export function packageMatches(pkg: string, wanted: Set<string>): boolean {
  if (wanted.has(pkg)) return true;
  for (const w of wanted) {
    if (pkg.startsWith(`${w}/`)) return true;
  }
  return false;
}

export function matchFile(f: FileRecord, c: Compiled): MatchInfo | null {
  const packages = f.packages.filter((p) => packageMatches(p, c.packages));
  const signals = Object.entries(f.signals)
    .filter(
      ([s, n]) =>
        c.signals.has(s) &&
        n >= (GENERIC_SIGNALS.has(s) ? GENERIC_SIGNAL_MIN : 1),
    )
    .map(([s]) => s);

  ensureTexts(f);
  const symbolText = f.symbolText as string;
  const pathText = f.pathText as string;
  const symbolHits = c.keywords.filter((k) => symbolText.includes(k));
  const pathHits = c.keywords.filter((k) => pathText.includes(k));

  let strength = 0;
  if (packages.length) strength += 2;
  if (signals.length) strength += 1;
  if (symbolHits.length) strength += 1;
  if (pathHits.length) strength += 0.5;
  if (c.pinned.has(f.id)) strength = Math.max(strength, 1);

  const threshold = f.isTest ? 0.5 : 1;
  if (strength < threshold) return null;

  return {
    strength,
    packages,
    signals,
    keywords: unique([...symbolHits, ...pathHits]),
  };
}

export function totalsFor(files: FileRecord[]): EvidenceTotals {
  const commits = new Set<string>();
  const repos = new Set<string>();
  const days = new Set<string>();
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    commits.add(f.commitId);
    if (f.repositoryId) repos.add(f.repositoryId);
    if (f.ts) {
      first = Math.min(first, f.ts);
      last = Math.max(last, f.ts);
      days.add(isoDay(f.ts));
    }
    additions += f.additions;
    deletions += f.deletions;
  }
  return {
    files: files.length,
    commits: commits.size,
    repos: repos.size,
    activeDays: days.size,
    spanDays:
      Number.isFinite(first) && last ? Math.round((last - first) / DAY_MS) : 0,
    additions,
    deletions,
    testFiles: 0,
    firstSeen: Number.isFinite(first) ? isoDay(first) : "",
    lastSeen: isoDay(last),
  };
}

export function definedSymbolsFor(files: FileRecord[], needles: string[]): string[] {
  const out = new Set<string>();
  const wanted = needles.map(normalizeKeyword).filter((n) => n.length >= 3);
  if (wanted.length === 0) return [];
  for (const f of files) {
    if (f.isTest) continue;
    for (const symbol of f.symbols) {
      if (!DEFINING_KINDS.has(symbolKind(symbol))) continue;
      const name = symbolName(symbol);
      const flat = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (wanted.some((w) => flat.includes(w))) out.add(name);
    }
  }
  return [...out].slice(0, 12);
}

export function revisitStats(files: FileRecord[]): {
  groups: number;
  revisited: number;
} {
  const byFile = new Map<string, Set<string>>();
  for (const f of files) {
    const key = `${f.repositoryId}:${f.path}`;
    const set = byFile.get(key) ?? new Set<string>();
    set.add(f.commitId);
    byFile.set(key, set);
  }
  let revisited = 0;
  for (const set of byFile.values()) if (set.size >= 2) revisited += 1;
  return { groups: byFile.size, revisited };
}

export function computeBaselineDepth(i: BaselineInput): BaselineDepth {
  const c: Record<string, number> = {
    volume: Math.min(Math.log10(i.additions + 1) / 3.5, 1) * 12,
    breadth: Math.sqrt(Math.min(i.files / 20, 1)) * 14,
    commits: Math.sqrt(Math.min(i.commits / 25, 1)) * 14,
    sustained:
      (0.6 * Math.min(i.activeDays / 15, 1) +
        0.4 * Math.min(i.spanDays / 120, 1)) *
      14,
    repos: Math.min(i.repos / 3, 1) * 5,
    ownImplementation:
      Math.min(i.definedSymbols / 5, 1) * 8 +
      (Math.min(i.demoBestRank, 3) / 3) * 12,
    hardening: Math.min(i.hardeningCount / 6, 1) * 8,
    maturation:
      Math.min(i.revisitRatio * 2, 1) * 4 +
      Math.min(i.followUpCommits / 4, 1) * 3,
    tests: Math.min(i.testFiles / 3, 1) * 5,
    approachDiversity: i.approachesWithEvidence >= 2 ? 5 : 0,
  };

  let score = Object.values(c).reduce((a, b) => a + b, 0);
  const caps: string[] = [];
  const reasons: string[] = [];

  if (i.scaffoldShare >= 0.6) {
    score *= 0.6;
    caps.push(
      `${Math.round(i.scaffoldShare * 100)}% of the evidence sits in scaffold-like commits (x0.6)`,
    );
  }
  if (i.commits <= 1 && score > 25) {
    score = 25;
    caps.push("only one commit touches this topic (capped at 25)");
  }
  if (i.files <= 1 && score > 20) {
    score = 20;
    caps.push("only one file touches this topic (capped at 20)");
  }
  if (i.files === 0) score = 0;

  const final = Math.max(0, Math.min(100, Math.round(score)));
  if (i.demoBestRank >= 2)
    reasons.push("a built mechanism was detected (implementation depth)");
  if (i.definedSymbols > 0)
    reasons.push(`${i.definedSymbols} own definitions match the topic`);
  if (i.hardeningCount > 0)
    reasons.push(`${i.hardeningCount} hardening behaviours observed`);
  if (i.revisitRatio >= 0.25)
    reasons.push("files were revisited in later commits");
  if (i.testFiles > 0) reasons.push("related test files exist");
  if (i.approachesWithEvidence >= 2)
    reasons.push("more than one approach was used");

  return {
    score: final,
    level: levelForScore(final),
    components: Object.fromEntries(
      Object.entries(c).map(([k, v]) => [k, round(v, 1)]),
    ),
    reasons,
    caps,
  };
}

export const SCAFFOLD_SUBJECT =
  /\b(initial commit|first commit|init(ial)? project|scaffold\w*|boilerplate|bootstrap\w*|create[- ]?(react|next|vite|t3)[- ]?app|starter)\b/i;

export const SCAFFOLD_FILE_COUNT = 25;

export function excerptAround(
  code: string,
  needles: string[],
  maxChars = 900,
): string {
  const lines = code.split("\n");
  const wanted = needles.map((n) => n.toLowerCase()).filter(Boolean);
  let at = -1;
  if (wanted.length) {
    at = lines.findIndex((l) => {
      const lower = l.toLowerCase();
      return wanted.some((n) => lower.includes(n));
    });
  }
  const start = at === -1 ? 0 : Math.max(0, at - 3);
  const end =
    at === -1 ? Math.min(lines.length, 18) : Math.min(lines.length, at + 15);
  const text = lines.slice(start, end).join("\n").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}

export async function gatherTopicEvidence(
  graph: Graph,
  atlas: EvidenceAtlas,
  spec: TopicSpec,
  options: GatherOptions = {},
): Promise<TopicEvidence> {
  const maxSamples = options.maxSamples ?? 8;
  const maxDemos = options.maxDemos ?? 10;
  const { index } = atlas;
  const developerId = atlas.developerId;
  const commitMeta = index.commitMeta ?? (index.commitMeta = new Map());

  const topicCompiled = compileAtoms(spec, spec.pinnedFileIds);
  const approachCompiled = spec.approaches.map((a) => ({
    spec: a,
    compiled: compileAtoms(a),
  }));

  // allow topic-level atoms OR any approach atoms to qualify a file
  const unionCompiled: Compiled = {
    packages: new Set([
      ...topicCompiled.packages,
      ...approachCompiled.flatMap((a) => [...a.compiled.packages]),
    ]),
    signals: new Set([
      ...topicCompiled.signals,
      ...approachCompiled.flatMap((a) => [...a.compiled.signals]),
    ]),
    keywords: unique([
      ...topicCompiled.keywords,
      ...approachCompiled.flatMap((a) => a.compiled.keywords),
    ]),
    pinned: topicCompiled.pinned,
  };

  // ---- match files -----------------------------------------------------------
  const matchedCode: Array<{ f: FileRecord; m: MatchInfo }> = [];
  const matchedTests: FileRecord[] = [];
  const perApproach = new Map<string, Array<{ f: FileRecord; m: MatchInfo }>>();
  for (const a of approachCompiled) perApproach.set(a.spec.slug, []);
  const dependencyEvents: TopicEvidence["dependencyEvents"] = [];

  for (const f of index.files) {
    if (f.depChanges) {
      for (const [event, names] of [
        ["added", f.depChanges.added],
        ["removed", f.depChanges.removed],
        ["changed", f.depChanges.changed],
      ] as const) {
        for (const name of names) {
          if (packageMatches(name, unionCompiled.packages)) {
            dependencyEvents.push({
              package: name,
              event,
              day: isoDay(f.ts),
              repository: index.repoNames.get(f.repositoryId) ?? "",
            });
          }
        }
      }
    }

    if (NON_CODE_ROLES.has(f.role)) continue;
    const m = matchFile(f, unionCompiled);
    if (!m) continue;
    if (f.isTest) {
      matchedTests.push(f);
      continue;
    }
    matchedCode.push({ f, m });
    for (const a of approachCompiled) {
      const am = matchFile(f, a.compiled);
      if (am && !f.isTest) perApproach.get(a.spec.slug)?.push({ f, m: am });
    }
  }

  const codeFiles = matchedCode.map((x) => x.f);
  const attributed = new Set<string>();
  for (const list of perApproach.values())
    for (const x of list) attributed.add(x.f.id);

  const topicTotals = totalsFor(codeFiles);
  topicTotals.testFiles = matchedTests.length;

  // ---- commit notes (metadata cached across topics) ---------------------------
  const commitIds = unique(codeFiles.map((f) => f.commitId));
  const idsForQuery = [...commitIds].sort().slice(0, 800);
  const missingIds = idsForQuery.filter((id) => !commitMeta.has(id));
  for (const part of chunk(missingIds, 300)) {
    const r = await tryRows(
      graph,
      "topic commits",
      `
      MATCH (c:Commit)
      WHERE c.id IN $ids
      RETURN c.id AS id, coalesce(c.subject, "") AS subject,
             coalesce(c.commit_type, "other") AS type,
             coalesce(c.date_day, "") AS day,
             coalesce(c.files_count, 0) AS files_count
      `,
      { ids: part },
    );
    if (!r) continue; // failed: leave uncached so a later topic retries
    for (const row of r) commitMeta.set(str(row.id), row);
    // negative cache: asked for, not found
    for (const id of part) if (!commitMeta.has(id)) commitMeta.set(id, {});
  }
  const commitById = commitMeta;

  const isScaffoldCommit = (id: string): boolean => {
    const row = commitById.get(id);
    const filesCount =
      num(row?.files_count) || index.commitFileCount.get(id) || 0;
    return (
      filesCount >= SCAFFOLD_FILE_COUNT ||
      SCAFFOLD_SUBJECT.test(str(row?.subject))
    );
  };
  const scaffoldCommitIds = commitIds.filter(isScaffoldCommit);
  const scaffoldSet = new Set(scaffoldCommitIds);
  const commitTs = new Map<string, number>();
  for (const f of codeFiles) {
    commitTs.set(f.commitId, Math.max(commitTs.get(f.commitId) ?? 0, f.ts));
  }
  const scaffoldFiles = codeFiles.filter((f) => scaffoldSet.has(f.commitId));
  const scaffoldShare = codeFiles.length
    ? scaffoldFiles.length / codeFiles.length
    : 0;

  // ---- footprint: where the topic lives (scaffold commits excluded) ----------
  const fpCommits = new Set<string>();
  const fpRepos = new Set<string>();
  const fpDirs = new Set<string>();
  for (const f of codeFiles) {
    if (scaffoldSet.has(f.commitId)) continue;
    fpCommits.add(f.commitId);
    if (!f.repositoryId) continue;
    fpRepos.add(f.repositoryId);
    const dir = f.path.split("/").slice(0, -1).slice(0, 3).join("/");
    if (dir) fpDirs.add(`${f.repositoryId}:${dir}`);
  }
  const footprint: TopicFootprint = {
    commitIds: [...fpCommits],
    repoIds: [...fpRepos],
    dirs: [...fpDirs],
  };

  // ---- maturation -----------------------------------------------------------
  const revisit = revisitStats(codeFiles);
  let firstTs = Number.POSITIVE_INFINITY;
  for (const f of codeFiles) firstTs = Math.min(firstTs, f.ts || firstTs);
  const commitTypes: Record<string, number> = {};
  let followUpCommits = 0;
  for (const id of commitIds) {
    const row = commitById.get(id);
    const type = str(row?.type, "other");
    commitTypes[type] = (commitTypes[type] ?? 0) + 1;
    const ts = commitTs.get(id) ?? 0;
    if (["fix", "perf", "refactor"].includes(type) && ts > firstTs)
      followUpCommits += 1;
  }

  // ---- demonstrations (existing detector evidence) --------------------------
  // The persisted Topic -[:MAPS_TO]-> Capability edges are taxonomy only. They
  // tell us WHICH demonstrations to read; they are never proof of depth.
  const mappedCapRows =
    (await tryRows(
      graph,
      "topic mapped capabilities",
      `MATCH (:Topic {slug: $slug})-[:MAPS_TO]->(c:Capability) RETURN c.id AS id`,
      { slug: spec.slug },
    )) ?? [];
  const capabilityIds = unique([
    ...spec.capabilityIds,
    ...mappedCapRows.map((r) => str(r.id)).filter(Boolean),
  ]);
  const demoKeywords = unique(
    [...unionCompiled.keywords, ...spec.name.toLowerCase().split(/\W+/)].filter(
      (k) => k.length >= 4,
    ),
  ).slice(0, 12);

  let demoRows: Row[];
  if (index.demos) {
    // preloaded once per atlas: filter in memory, no per-topic graph query
    const capSet = new Set(capabilityIds);
    demoRows = [];
    for (const d of index.demos) {
      const byCap = capSet.has(d.capabilityId);
      if (
        !byCap &&
        !demoKeywords.some(
          (k) => d.techniqueLower.includes(k) || d.summaryLower.includes(k),
        )
      ) {
        continue;
      }
      demoRows.push({
        id: d.id,
        capability_id: d.capabilityId,
        matched_by: byCap ? "capability" : "keyword",
        technique: d.technique,
        depth: d.depth,
        depth_rank: d.depthRank,
        modifiers: d.modifiers,
        repository: d.repository,
        path: d.path,
        permalink: d.permalink,
        commit_subject: d.commitSubject,
        snippet: d.snippet,
      });
      if (demoRows.length >= 200) break;
    }
  } else {
    demoRows =
      (await tryRows(
        graph,
        "topic demonstrations",
        `
        MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
        WHERE c.id IN $cap_ids
           OR any(k IN $keywords WHERE toLower(coalesce(x.technique, "")) CONTAINS k
                                    OR toLower(coalesce(x.summary, "")) CONTAINS k)
        OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
        RETURN x.id AS id, c.id AS capability_id,
               CASE WHEN c.id IN $cap_ids THEN "capability" ELSE "keyword" END AS matched_by,
               coalesce(x.technique, "") AS technique,
               coalesce(x.depth, "usage") AS depth,
               coalesce(x.depth_rank, 1) AS depth_rank,
               coalesce(x.modifiers, "") AS modifiers,
               coalesce(r.full_name, r.name, "") AS repository,
               coalesce(x.path, "") AS path,
               coalesce(x.permalink, "") AS permalink,
               coalesce(x.commit_subject, "") AS commit_subject,
               coalesce(x.snippet, "") AS snippet
        ORDER BY depth_rank DESC
        LIMIT 200
        `,
        { dev: developerId, cap_ids: capabilityIds, keywords: demoKeywords },
      )) ?? [];
  }

  const hardeningCounts = new Map<string, number>();
  let demoBestRank = 0;
  for (const r of demoRows) {
    const rank = num(r.depth_rank);
    // a text-only match can show usage, never an implementation
    const effective =
      str(r.matched_by) === "capability" ? rank : Math.min(rank, 1);
    demoBestRank = Math.max(demoBestRank, effective);
    for (const label of str(r.modifiers).split(" | ")) {
      const l = label.trim();
      if (l) hardeningCounts.set(l, (hardeningCounts.get(l) ?? 0) + 1);
    }
  }
  // Discovery != depth: detector demonstrations need authored code behind them.
  if (codeFiles.length < 2) demoBestRank = Math.min(demoBestRank, 1);
  const hardening = [...hardeningCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // ---- experiences & rollups (from the atlas, no query) --------------------
  const techWords = unique(
    [
      ...unionCompiled.packages,
      ...approachCompiled.map((a) => a.spec.name.toLowerCase()),
    ].map((s) => s.toLowerCase()),
  );
  const experiences = atlas.experiences.filter((e) => {
    if (capabilityIds.includes(e.capabilityId)) return true;
    const t = e.technique.toLowerCase();
    if (demoKeywords.some((k) => t.includes(k))) return true;
    return e.technologies.some((tech) =>
      techWords.some(
        (w) => w.includes(tech.toLowerCase()) || tech.toLowerCase().includes(w),
      ),
    );
  });
  const capabilityRollups = atlas.capabilities.filter((c) =>
    capabilityIds.includes(c.id),
  );

  // ---- per-approach stats ------------------------------------------------
  const topicNeedles = unique([
    ...unionCompiled.keywords,
    ...spec.name
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length >= 4),
  ]);

  const approachEvidence: ApproachEvidence[] = approachCompiled.map(
    ({ spec: a, compiled }) => {
      const list = perApproach.get(a.slug) ?? [];
      const files = list.map((x) => x.f);
      const t = totalsFor(files);
      const needles = unique([
        ...a.keywords,
        ...a.name
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length >= 4),
      ]);
      const defined = definedSymbolsFor(files, needles);
      const rv = revisitStats(files);
      const testFiles = matchedTests.filter(
        (tf) => matchFile(tf, compiled) !== null,
      ).length;

      const matchedPackages = unique(list.flatMap((x) => x.m.packages));
      const matchedSignals: Record<string, number> = {};
      for (const x of list) {
        for (const s of x.m.signals) {
          matchedSignals[s] = (matchedSignals[s] ?? 0) + (x.f.signals[s] ?? 1);
        }
      }
      const appCommitScaffold = files.filter((f) =>
        scaffoldSet.has(f.commitId),
      ).length;

      return {
        slug: a.slug,
        name: a.name,
        files: t.files,
        commits: t.commits,
        repos: t.repos,
        activeDays: t.activeDays,
        firstSeen: t.firstSeen,
        lastSeen: t.lastSeen,
        additions: t.additions,
        testFiles,
        matchedPackages,
        matchedSignals,
        definedSymbols: defined,
        revisitedFiles: rv.revisited,
        baseline: computeBaselineDepth({
          files: t.files,
          commits: t.commits,
          repos: t.repos,
          activeDays: t.activeDays,
          spanDays: t.spanDays,
          additions: t.additions,
          testFiles,
          definedSymbols: defined.length,
          demoBestRank: files.length ? Math.min(demoBestRank, 2) : 0,
          hardeningCount: files.length ? Math.min(hardening.length, 4) : 0,
          revisitRatio: rv.groups ? rv.revisited / rv.groups : 0,
          followUpCommits: 0,
          approachesWithEvidence: 1,
          scaffoldShare: files.length ? appCommitScaffold / files.length : 0,
        }),
      };
    },
  );

  const topicDefined = definedSymbolsFor(codeFiles, topicNeedles);
  const baseline = computeBaselineDepth({
    files: topicTotals.files,
    commits: topicTotals.commits,
    repos: topicTotals.repos,
    activeDays: topicTotals.activeDays,
    spanDays: topicTotals.spanDays,
    additions: topicTotals.additions,
    testFiles: matchedTests.length,
    definedSymbols: topicDefined.length,
    demoBestRank,
    hardeningCount: hardening.length,
    revisitRatio: revisit.groups ? revisit.revisited / revisit.groups : 0,
    followUpCommits,
    approachesWithEvidence: approachEvidence.filter((a) => a.files > 0).length,
    scaffoldShare,
  });

  // ---- declared but never imported ------------------------------------------
  // every imported package plus each of its "/"-prefixes, so a wanted package
  // is "imported" when it equals one of them (same rule as packageMatches)
  const importedPrefixes = new Set<string>();
  for (const f of index.files) {
    for (const i of f.packages) {
      importedPrefixes.add(i);
      let at = i.indexOf("/");
      while (at !== -1) {
        importedPrefixes.add(i.slice(0, at));
        at = i.indexOf("/", at + 1);
      }
    }
  }
  const authoredRepos = new Set(index.files.map((f) => f.repositoryId));
  const declaredOnly: string[] = [];
  for (const p of unionCompiled.packages) {
    if (importedPrefixes.has(p)) continue;
    for (const repoId of authoredRepos) {
      if (index.repoDeclared.get(repoId)?.has(p)) {
        declaredOnly.push(p);
        break;
      }
    }
  }

  // ---- refs: commits, samples, demonstrations, experiences ------------------
  const refs: EvidenceRef[] = [];

  const commitNotes: CommitNote[] = [];
  const byTs = [...commitIds].sort(
    (a, b) => (commitTs.get(a) ?? 0) - (commitTs.get(b) ?? 0),
  );
  const chosen = new Set<string>([...byTs.slice(0, 3), ...byTs.slice(-3)]);
  for (const id of byTs) {
    if (chosen.size >= 14) break;
    const type = str(commitById.get(id)?.type, "other");
    if (["fix", "perf", "refactor", "test"].includes(type)) chosen.add(id);
  }
  let ci = 0;
  for (const id of byTs.filter((x) => chosen.has(x))) {
    const row = commitById.get(id);
    ci += 1;
    const ref = `C${ci}`;
    const note: CommitNote = {
      ref,
      id,
      subject: str(row?.subject).slice(0, 160),
      type: str(row?.type, "other"),
      day: str(row?.day),
      filesCount: num(row?.files_count) || index.commitFileCount.get(id) || 0,
      scaffold: scaffoldSet.has(id),
    };
    commitNotes.push(note);
    refs.push({
      key: ref,
      kind: "commit",
      id,
      label: note.subject,
      repository: "",
      path: "",
      permalink: "",
      snippet: "",
    });
  }

  // code samples: best files per approach (+ unattributed), strongest first
  const pickFrom = (list: Array<{ f: FileRecord; m: MatchInfo }>, n: number) =>
    [...list]
      .sort(
        (a, b) =>
          b.m.strength - a.m.strength ||
          b.f.additions - a.f.additions ||
          a.f.path.localeCompare(b.f.path),
      )
      .slice(0, n);

  const sampleSources: Array<{
    approach: string;
    item: { f: FileRecord; m: MatchInfo };
  }> = [];
  const usedIds = new Set<string>();
  const addSample = (
    approach: string,
    item: { f: FileRecord; m: MatchInfo },
  ) => {
    if (usedIds.has(item.f.id) || sampleSources.length >= maxSamples) return;
    usedIds.add(item.f.id);
    sampleSources.push({ approach, item });
  };
  for (const a of approachCompiled) {
    for (const item of pickFrom(perApproach.get(a.spec.slug) ?? [], 2)) {
      addSample(a.spec.slug, item);
    }
  }
  for (const item of pickFrom(
    matchedCode.filter((x) => !attributed.has(x.f.id)),
    2,
  )) {
    addSample("", item);
  }
  for (const item of pickFrom(matchedCode, maxSamples)) addSample("", item);

  const codeRows = sampleSources.length
    ? ((await tryRows(
        graph,
        "topic samples",
        `MATCH (fc:FileChange) WHERE fc.id IN $ids RETURN fc.id AS id, fc.added_code AS code`,
        { ids: sampleSources.map((s) => s.item.f.id) },
      )) ?? [])
    : [];
  const codeById = new Map(codeRows.map((r) => [str(r.id), raw(r.code)]));

  const samples: CodeSample[] = [];
  let si = 0;
  for (const { approach, item } of sampleSources) {
    const code = codeById.get(item.f.id) ?? "";
    if (!code.trim()) continue;
    si += 1;
    const ref = `S${si}`;
    const repository = index.repoNames.get(item.f.repositoryId) ?? "";
    const matched = unique([...item.m.packages, ...item.m.keywords]);
    const excerpt = excerptAround(code, matched);
    const subject = str(commitById.get(item.f.commitId)?.subject).slice(0, 140);
    samples.push({
      ref,
      approach,
      repository,
      path: item.f.path,
      commitSubject: subject,
      date: isoDay(item.f.ts),
      matched,
      excerpt,
    });
    refs.push({
      key: ref,
      kind: "code",
      id: item.f.id,
      label: `${item.f.path}${subject ? ` (${subject})` : ""}`,
      repository,
      path: item.f.path,
      permalink:
        repository && item.f.commitSha
          ? `https://github.com/${repository}/blob/${item.f.commitSha}/${item.f.path
              .split("/")
              .map(encodeURIComponent)
              .join("/")}`
          : "",
      snippet: excerpt.slice(0, 500),
    });
  }

  const demonstrations: DemoNote[] = [];
  demoRows.slice(0, maxDemos).forEach((r, i) => {
    const ref = `D${i + 1}`;
    const note: DemoNote = {
      ref,
      capabilityId: str(r.capability_id),
      matchedBy: str(r.matched_by) === "capability" ? "capability" : "keyword",
      technique: str(r.technique),
      depth: str(r.depth),
      modifiers: str(r.modifiers).split(" | ").filter(Boolean),
      repository: str(r.repository),
      path: str(r.path),
      commitSubject: str(r.commit_subject).slice(0, 140),
      snippet: raw(r.snippet).slice(0, 400),
    };
    demonstrations.push(note);
    refs.push({
      key: ref,
      kind: "demonstration",
      id: str(r.id),
      label: `${note.technique} (${note.depth})`,
      repository: note.repository,
      path: note.path,
      permalink: str(r.permalink),
      snippet: note.snippet.slice(0, 500),
    });
  });

  const experienceNotes: ExperienceNote[] = experiences
    .slice(0, 6)
    .map((e, i) => {
      const ref = `E${i + 1}`;
      refs.push({
        key: ref,
        kind: "experience",
        id: e.id,
        label: `${e.technique} (${e.depth})`,
        repository: e.repositories[0] ?? "",
        path: "",
        permalink: "",
        snippet: e.summary.slice(0, 300),
      });
      return {
        ref,
        capabilityId: e.capabilityId,
        technique: e.technique,
        summary: e.summary.slice(0, 300),
        depth: e.depth,
        evidenceCount: e.evidence,
        commitCount: e.commits,
        repoCount: e.repos,
        technologies: e.technologies,
        repositories: e.repositories.slice(0, 4),
      };
    });

  // timeline by month
  const months = new Map<string, number>();
  for (const f of codeFiles) {
    const m = f.createdAt.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) months.set(m, (months.get(m) ?? 0) + 1);
  }
  const timeline = [...months.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([month, files]) => ({ month, files }));

  const context = await readTopicContext(graph, developerId, spec.slug);

  return {
    spec,
    matched: codeFiles.length > 0,
    totals: topicTotals,
    approaches: approachEvidence,
    unattributedFiles: codeFiles.filter((f) => !attributed.has(f.id)).length,
    maturation: {
      revisitedFiles: revisit.revisited,
      revisitRatio: revisit.groups
        ? round(revisit.revisited / revisit.groups)
        : 0,
      followUpCommits,
      commitTypes,
    },
    scaffold: {
      commits: scaffoldCommitIds.length,
      share: round(scaffoldShare),
    },
    declaredOnly,
    dependencyEvents: dependencyEvents
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(0, 10),
    capabilityRollups,
    demonstrations,
    experiences: experienceNotes,
    samples,
    commits: commitNotes,
    timeline,
    hardening: hardening.slice(0, 12),
    baseline,
    refs,
    context,
    footprint,
  };
}

export function probeAtlas(
  atlas: EvidenceAtlas,
  atoms: { packages?: string[]; keywords?: string[]; signals?: string[] },
): { packages: string[]; keywords: string[]; signals: string[] } {
  const known = new Set(atlas.packages.map((p) => p.name));
  const knownSignals = new Set(atlas.signals.map((s) => s.name));
  const vocab = new Set(atlas.vocabulary.map((v) => v.term));
  return {
    packages: unique(
      (atoms.packages ?? [])
        .map((p) => p.toLowerCase())
        .filter((p) => known.has(p)),
    ),
    signals: unique((atoms.signals ?? []).filter((s) => knownSignals.has(s))),
    keywords: unique(
      (atoms.keywords ?? [])
        .map(normalizeKeyword)
        .filter(
          (k) =>
            k.length >= 3 &&
            [...vocab].some((v) => v.includes(k) || k.includes(v)),
        ),
    ),
  };
}

export async function probeKeywords(
  graph: Graph,
  developerId: string,
  keywords: string[],
  limitPerKeyword = 30,
): Promise<Array<{ keyword: string; fileIds: string[]; paths: string[] }>> {
  const out: Array<{ keyword: string; fileIds: string[]; paths: string[] }> =
    [];
  for (const keyword of unique(keywords.map(normalizeKeyword)).slice(0, 8)) {
    if (keyword.length < 3) continue;
    const q = keyword.length >= 4 ? `${keyword}*` : keyword;
    const result = await tryRows(
      graph,
      `fulltext probe ${keyword}`,
      `
      CALL db.idx.fulltext.queryNodes('FileChange', $q) YIELD node, score
      WHERE node.developer_id = $dev AND coalesce(node.is_test, false) = false
      RETURN node.id AS id, node.path AS path, score
      ORDER BY score DESC
      LIMIT ${Math.min(Math.max(Math.floor(limitPerKeyword), 1), 100)}
      `,
      { q, dev: developerId },
    );
    if (result && result.length) {
      out.push({
        keyword,
        fileIds: result.map((r) => str(r.id)),
        paths: result.slice(0, 5).map((r) => str(r.path)),
      });
    }
  }
  return out;
}

export const taxCaches = new WeakMap<object, TaxonomyCache>();

export function taxCache(graph: Graph): TaxonomyCache {
  let c = taxCaches.get(graph as unknown as object);
  if (!c) {
    c = { edges: new Map(), meta: null };
    taxCaches.set(graph as unknown as object, c);
  }
  return c;
}

export function invalidateTaxonomyCache(graph: Graph): void {
  taxCaches.delete(graph as unknown as object);
}

export function wouldCreateBuildsOnCycle(
  edges: Array<{ from: string; to: string }>,
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
  }
  const stack = [to];
  const visited = new Set<string>();
  while (stack.length) {
    const node = stack.pop() as string;
    if (node === from) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const next of adjacency.get(node) ?? []) stack.push(next);
  }
  return false;
}

export const parseEvidenceBrief = (value: unknown, max = 3): EvidenceBrief[] =>
  mapList(parseJson<unknown>(value, []))
    .slice(0, max)
    .map((e) => ({
      ref: str(e.key),
      kind: str(e.kind),
      label: str(e.label).slice(0, 200),
      repository: str(e.repository),
      path: str(e.path),
      permalink: str(e.permalink),
    }));

export function walkBuildsOn(
  edges: TaxonomyEdge[],
  direction: "out" | "in",
  start: string,
  maxHops: number,
): WalkNode[] {
  const adjacency = new Map<string, TaxonomyEdge[]>();
  for (const e of edges) {
    const key = direction === "out" ? e.from : e.to;
    const list = adjacency.get(key) ?? [];
    list.push(e);
    adjacency.set(key, list);
  }
  for (const list of adjacency.values()) {
    list.sort((a, b) => {
      const an = direction === "out" ? a.to : a.from;
      const bn = direction === "out" ? b.to : b.from;
      return b.confidence - a.confidence || an.localeCompare(bn);
    });
  }

  const out: WalkNode[] = [];
  const visited = new Set<string>([start]);
  let frontier: WalkNode[] = [
    {
      slug: start,
      hops: 0,
      via: [],
      edge: undefined as unknown as TaxonomyEdge,
      requiredPath: true,
    },
  ];
  for (let hop = 1; hop <= maxHops; hop++) {
    const next: WalkNode[] = [];
    for (const node of frontier) {
      for (const e of adjacency.get(node.slug) ?? []) {
        const target = direction === "out" ? e.to : e.from;
        if (visited.has(target)) continue;
        visited.add(target);
        const child: WalkNode = {
          slug: target,
          hops: hop,
          via: [...node.via, target],
          edge: e,
          requiredPath: node.requiredPath && e.strength === "required",
        };
        out.push(child);
        next.push(child);
      }
    }
    if (!next.length) break;
    frontier = next;
  }
  return out;
}

export const toLearningEdge = (e: TaxonomyEdge): LearningEdge => ({
  reason: e.reason,
  confidence: e.confidence,
  strength: e.strength,
  basis: e.basis,
  buildId: e.buildId,
  model: e.model,
  updatedAt: e.updatedAt,
});

export function buildLearningNodes(
  walked: WalkNode[],
  meta: Map<string, TopicMeta>,
  depth: Map<string, DeveloperTopicDepth>,
): LearningNode[] {
  return walked.map((n) => {
    const m = meta.get(n.slug);
    const d = depth.get(n.slug) ?? null;
    const met = isPrereqMet(d);
    return {
      slug: n.slug,
      name: m?.name ?? n.slug,
      domain: m?.domain ?? "",
      hops: n.hops,
      via: n.via,
      edge: toLearningEdge(n.edge),
      requiredPath: n.requiredPath,
      foundationRank: m?.foundationRank ?? null,
      developer: d,
      met,
      blocking: n.requiredPath && !met,
    };
  });
}

export const TOPIC_METRIC_PROPS = new Set([
  "foundation_rank",
  "bridge_score",
  "cluster_id",
  "component_id",
]);

export const topicId = (slug: string) => `topic:${slug}`;

export const approachId = (topic: string, slug: string) => `approach:${topic}:${slug}`;

export const assessmentId = (dev: string, slug: string) => `depth:${dev}:${slug}`;

export async function repairTopicEdges(
  graph: Graph,
  options: { now: string },
): Promise<{ selfLoopsRemoved: number; reverseAdded: number }> {
  const loops = await tryRows(
    graph,
    "count self loops",
    `MATCH (a:Topic)-[r:BUILDS_ON|RELATED_TOPIC]->(b:Topic) WHERE a.id = b.id RETURN count(r) AS n`,
  );
  const selfLoopsRemoved = num(loops?.[0]?.n);
  if (selfLoopsRemoved > 0) {
    await tryRows(
      graph,
      "remove self loops",
      `MATCH (a:Topic)-[r:BUILDS_ON|RELATED_TOPIC]->(b:Topic) WHERE a.id = b.id DELETE r`,
    );
  }

  const missing = await tryRows(
    graph,
    "asymmetric related edges",
    `
    MATCH (a:Topic)-[r:RELATED_TOPIC]->(b:Topic)
    WHERE NOT (b)-[:RELATED_TOPIC]->(a)
    RETURN a.id AS a_id, b.id AS b_id, coalesce(r.reason, "") AS reason,
           coalesce(r.confidence, 0) AS confidence,
           coalesce(r.basis, "llm_inferred") AS basis,
           coalesce(r.build_id, "") AS build_id,
           coalesce(r.model, "") AS model
    `,
  );
  const reverseAdded = await runCounted(
    graph,
    "RELATED_TOPIC symmetry",
    `
    UNWIND $batch AS item
    MATCH (a:Topic {id: item.a_id})
    MATCH (b:Topic {id: item.b_id})
    MERGE (b)-[r:RELATED_TOPIC]->(a)
    ON CREATE SET r.created_at = $now
    SET r.basis = item.basis, r.reason = item.reason, r.confidence = item.confidence,
        r.build_id = item.build_id, r.model = item.model, r.updated_at = $now
    RETURN count(r) AS n
    `,
    (missing ?? []).map((m) => ({
      a_id: str(m.a_id),
      b_id: str(m.b_id),
      reason: str(m.reason),
      confidence: num(m.confidence),
      basis: str(m.basis, "llm_inferred"),
      build_id: str(m.build_id),
      model: str(m.model),
    })),
    { params: { now: options.now } },
  );
  invalidateTaxonomyCache(graph);
  return { selfLoopsRemoved, reverseAdded };
}
}
