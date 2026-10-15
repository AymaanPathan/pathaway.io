



import { Developer } from "../src/types";

export type SkillLevel =
  | "novice"
  | "familiar"
  | "proficient"
  | "advanced"
  | "expert";
export type SkillTrend = "rising" | "steady" | "cooling" | "dormant";
export type SkillConfidence = "low" | "medium" | "high";

export interface ActivityPoint {
  month: string; 
  count: number; 
}


export interface SkillEvidence {
  slug: string;
  name: string;
  depthScore: number;
  level: SkillLevel;
  evidenceCount: number;
  strongEvidenceCount?: number;
  commitsCount?: number;
  reposCount?: number;
  activeDays?: number;
  firstSeen?: string;
  lastSeen?: string;
  recencyDays?: number;
  trend?: SkillTrend;
  confidence?: SkillConfidence;
  evidenceQuality?: number;
  activity?: ActivityPoint[];
  
  depth?: string;
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

export interface SkillProofItem {
  path: string;
  repositoryId: string;
  repositoryName: string;
  commitSha: string;
  commitUrl: string;
  additions: number;
  deletions: number;
  createdAt: string;
  strength: "strong" | "weak";
  implied: boolean;
}

export interface SkillRef {
  skillId: string;
  skillName: string;
}

export interface SkillDetail {
  skillId: string;
  skillName: string;
  categoryId: string;
  categoryName: string;
  depthScore: number;
  level: SkillLevel;
  filesTouched: number;
  strongFiles?: number;
  commitsCount: number;
  reposCount: number;
  linesAdded: number;
  linesDeleted: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  recencyDays?: number;
  recentCommits?: number;
  priorCommits?: number;
  trend?: SkillTrend;
  confidence?: SkillConfidence;
  evidenceQuality?: number;
  activity?: ActivityPoint[];
  repositories?: Array<{
    repositoryId: string;
    name: string;
    files: number;
    commits: number;
    lines: number;
  }>;
  related?: Array<SkillRef & { commits: number; affinity: number }>;
  implies?: SkillRef[];
  impliedBy?: SkillRef[];
  nextSteps?: SkillRef[];
  proof: SkillProofItem[];
}

export interface GraphSummaryResponse {
  developer: Developer | null;
  categories: Array<{
    id: string;
    label: string;
    score?: number;
    skillCount: number;
    evidenceCount: number;
    skills: SkillEvidence[];
  }>;
  insights?: SkillInsights;
}
