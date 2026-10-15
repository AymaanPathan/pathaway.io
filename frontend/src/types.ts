// Shared types for the developer-knowledge-graph 3D scene.

export type Vec3 = [number, number, number];

// ------------------------------------------------------------
// Skill vocabulary (mirrors skill-category-graph.ts on the backend)
// ------------------------------------------------------------

export type SkillLevel =
  | "novice"
  | "familiar"
  | "proficient"
  | "advanced"
  | "expert";

export type SkillTrend = "rising" | "steady" | "cooling" | "dormant";

export type SkillConfidence = "low" | "medium" | "high";

export interface ActivityPoint {
  /** YYYY-MM */
  month: string;
  /** distinct commits that month */
  count: number;
}

/**
 * One entry of Area.skills — what GET /api/graph/summary returns per skill.
 */
export interface SkillEvidence {
  slug: string;
  name: string;

  /** 0..100 */
  depthScore: number;
  level: SkillLevel;

  /** files touched (all evidence) */
  evidenceCount: number;
  /** files that are direct proof (imports, config, real usage) */
  strongEvidenceCount?: number;
  commitsCount?: number;
  reposCount?: number;
  activeDays?: number;
  firstSeen?: string;
  lastSeen?: string;
  recencyDays?: number;

  trend?: SkillTrend;
  confidence?: SkillConfidence;
  /** 0.6..1 — share of evidence that is direct */
  evidenceQuality?: number;
  /** commits per month, oldest -> newest (max 18) */
  activity?: ActivityPoint[];

  // ---- legacy fields (no longer sent by /api/graph/summary) ----
  demonstrationLevel?: string;
  repositoryCount?: number;
  recentActivity?: "recent" | "historical" | "inactive";
  depth?: string;
  capabilities?: string[];

  // Skill-specific AI review
  buildSummary?: string | null;
  constructionLevel?: string | null;
  demonstratedCapabilities?: string[];
  proof?: string[];
  reasoning?: string | null;
}

export interface Area {
  id: string;
  label: string;
  /** mean depth score of the category's top 3 skills (0..100) */
  score?: number;
  skillCount: number;
  evidenceCount: number;
  skills: SkillEvidence[];
  position: Vec3;
}

export interface Developer {
  id?: string;
  developerId?: string;
  username: string;
  avatarUrl?: string | null;
  name?: string | null;
}

export interface DeliveryPackage {
  id: string;
  areaId: string;
  startTime: number;
  duration: number;
}

export interface WorldContextValue {
  areas: Area[];
  areaMap: Record<string, Area>;
  developer: Developer | null;
  hubPosition: Vec3;
  focusedAreaId: string | null;
  focusArea: (areaId: string) => void;
  focusHub: () => void;
  packages: DeliveryPackage[];
  pulses: Record<string, number>;
  simulate: () => void;
  deliverPackage: (pkgId: string, areaId: string) => void;
  isSimulating: boolean;

  // areaId -> Date.now() when its build animation started
  // Absent for an area = render it already fully built.
  constructions: Record<string, number>;

  generateAreas: () => void;
  isGenerating: boolean;
  isLoading: boolean;
  error: string | null;
  refreshGraph: () => Promise<void>;
}

// ------------------------------------------------------------
// GET /api/graph/summary
// ------------------------------------------------------------

export interface GraphSummaryCategory {
  id: string;
  label: string;
  score?: number;
  skillCount: number;
  evidenceCount: number;
  skills: SkillEvidence[];
}

export interface InsightSkill {
  skillId: string;
  skillName: string;
  categoryName: string;
  depthScore: number;
  level: SkillLevel;
  trend: SkillTrend;
  confidence: SkillConfidence;
}

/** Whole-profile insights, also in GET /api/skills/insights. */
export interface SkillInsights {
  headline: {
    totalSkills: number;
    advancedOrExpert: number;
    averageScore: number;
    strongestCategory: string;
    freshestSkill: string;
  };
  strengths: InsightSkill[];
  rising: InsightSkill[];
  cooling: InsightSkill[];
  thinEvidence: InsightSkill[];
  adjacent: Array<{
    skillId: string;
    skillName: string;
    categoryName: string;
    because: string[];
  }>;
  categoryBalance: Array<{
    categoryId: string;
    categoryName: string;
    score: number;
    skills: number;
  }>;
}

export interface GraphSummaryResponse {
  developer: Developer | null;
  categories: GraphSummaryCategory[];
  insights?: SkillInsights;
}

// ------------------------------------------------------------
// GET /api/skills/graph?repos=1  (nodes + edges for a graph view)
// ------------------------------------------------------------

export interface SkillGraphNode {
  id: string;
  type: "category" | "skill" | "repository";
  label: string;
  categoryId?: string;
  score?: number;
  level?: SkillLevel;
  trend?: SkillTrend;
  confidence?: SkillConfidence;
  commits?: number;
}

export interface SkillGraphEdge {
  source: string;
  target: string;
  type: "contains" | "co_occurs" | "implies" | "used_in";
  weight: number;
}

export interface SkillGraphView {
  nodes: SkillGraphNode[];
  edges: SkillGraphEdge[];
}

// ------------------------------------------------------------
// Skill detail sidebar
// GET /api/skills/:slug
// ------------------------------------------------------------

export interface SkillProofItem {
  path: string;
  repositoryId: string;
  repositoryName: string;
  commitSha: string;
  /** https://github.com/<repo>/commit/<sha>, empty if unknown */
  commitUrl: string;
  additions: number;
  deletions: number;
  createdAt: string;
  strength: "strong" | "weak";
  /** true when the file only counts because another skill implies this one */
  implied: boolean;
}

export interface SkillRef {
  skillId: string;
  skillName: string;
}

export interface SkillEvidenceFile {
  id: string;
  path: string | null;
  repository: string | null;
  language: string | null;
  date: string | null;

  /** Actual authored code (added_code), truncated for payload size. */
  codeSnippet: string;
  codeTruncated: boolean;

  /** Present only when this file also backs a tracked capability. */
  capability: string | null;
  observedBehavior: string | null;
}

/**
 * Same evidence dimensions analyze-skills.ts computes per skill.
 *
 * This explains the reliability percentage.
 * It is NOT a proficiency score.
 */
export interface ReliabilityFactors {
  directness: string | null;
  complexity: string | null;
  breadth: string | null;
  repetition: string | null;
  independence: string | null;
  duration: string | null;
  recency: string | null;
}

export interface SkillReliability {
  /** 0..1 */
  score: number;
  factors: ReliabilityFactors;
}

export interface SkillInsightNotableFile {
  path: string;
  repo: string;
  note: string;
}

// ------------------------------------------------------------
// Skill Build Agent
// GET /api/skills/:slug/build
//
// Backed by build-memory-agent.ts's Project/Technology/Feature/
// Concept graph — see skill-build-insight.ts (backend) for the
// adapter that resolves a skill down to this shape.
// ------------------------------------------------------------

export interface SkillInsightBuiltThingEvidence {
  repo: string;
  file: string;
  commit: string;
}

export interface SkillInsightBuiltThing {
  title: string;
  description: string;
  evidence: SkillInsightBuiltThingEvidence[];
  confidence: "low" | "medium" | "high";
}

export interface SkillInsight {
  skillId: string;
  skillName: string;

  /** Short overall description of the work done with this skill. */
  headline: string;

  /** High-level answer to "what did I build with this skill?" */
  whatYouBuilt: string;

  /**
   * Distinct things the developer actually built.
   * This is generated from GitHub evidence by the Skill Build Agent.
   */
  thingsBuilt: SkillInsightBuiltThing[];

  /** Important contributions identified from the evidence. */
  keyContributions: string[];

  /** Representative files used as supporting evidence. */
  notableFiles: SkillInsightNotableFile[];

  /** Overall confidence in the generated insight. */
  confidence: "low" | "medium" | "high";

  generatedAt: string;
  cached: boolean;
}

export interface SkillDetail {
  skillId: string;
  skillName: string;
  categoryId: string;
  categoryName: string;

  depthScore: number;
  level: SkillLevel;

  filesTouched: number;
  /** files that are direct proof rather than inferred */
  strongFiles?: number;
  commitsCount: number;
  reposCount: number;

  linesAdded: number;
  linesDeleted: number;

  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  /** days since last use; -1 if unknown */
  recencyDays?: number;
  /** distinct commits in the last 90 days / the 90 days before that */
  recentCommits?: number;
  priorCommits?: number;

  trend?: SkillTrend;
  confidence?: SkillConfidence;
  evidenceQuality?: number;

  /** commits per month, oldest -> newest (max 24) */
  activity?: ActivityPoint[];

  repositories?: Array<{
    repositoryId: string;
    name: string;
    files: number;
    commits: number;
    lines: number;
  }>;

  /** skills usually changed in the same commits */
  related?: Array<SkillRef & { commits: number; affinity: number }>;
  /** skills this one also counts toward (Next.js -> React) */
  implies?: SkillRef[];
  /** skills that partly prove this one */
  impliedBy?: SkillRef[];
  /** related skills the developer has not used yet */
  nextSteps?: SkillRef[];

  proof: SkillProofItem[];
  reliability?: SkillReliability;
}

// ------------------------------------------------------------
// Builds world
//
// A second "world" alongside Areas/Skills, surfacing
// build-memory-agent.ts's own graph directly: Project pods with
// Technology/Feature/Concept satellites orbiting each one, instead
// of skill categories with skill satellites.
//
// GET /api/builds/summary  -> BuildsSummaryResponse
// GET /api/builds/generate -> SSE, "project_ready" events carry
//                              ProjectSummaryData
// ------------------------------------------------------------

export interface BuildEntitySummary {
  name: string;
  evidenceCount: number;
}

// A Project as returned by GET /api/builds/summary — everything the
// backend knows about it, minus a 3D position (the frontend assigns
// that once it has the full list, same as Area does for skills).
export interface ProjectSummaryData {
  id: string;
  name: string;
  description: string;
  aiConfidence: number;
  evidenceCommitCount: number;
  technologies: BuildEntitySummary[];
  features: BuildEntitySummary[];
  concepts: BuildEntitySummary[];
}

// ProjectSummaryData plus the 3D position the world assigns it — the
// "Builds" analogue of Area.
export interface ProjectPod extends ProjectSummaryData {
  position: Vec3;
}

export interface BuildsSummaryResponse {
  builds: ProjectSummaryData[];
}

export type WorldViewMode = "skills" | "builds";

// One satellite orbiting a focused Project — a Technology, Feature,
// or Concept node. Mirrors SkillEvidence's role for Satelities.tsx,
// but for the Builds world.
export interface ProjectEntitySatellite {
  key: string;
  kind: "technology" | "feature" | "concept";
  name: string;
  evidenceCount: number;
  position: Vec3;
}
