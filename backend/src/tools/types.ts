import type { Graph } from "../db/falkordb.js";
import type {
  Authenticity,
  Confidence,
  DepthLevel,
} from "../graph/depth-analyzer-graph.js";
import type { UiBlock } from "./ui.js";

export type Row = Record<string, any>;


export interface DevTopic {
  slug: string;
  name: string;
  domain: string;
  level: DepthLevel;
  levelRank: number;
  score: number;
  baselineScore: number;
  confidence: Confidence;
  authenticity: Authenticity;
  verdict: string;
  files: number;
  commits: number;
  repos: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  approachCount: number;
  foundationRank: number | null;
  bridgeScore: number | null;
  clusterId: number | null;
  componentId: number | null;
}

export interface MetricResult {
  scores: Map<string, number>;
  
  source: string;
  live: boolean;
}

export interface ResolvedTopic {
  slug: string;
  name: string;
  assessed: boolean;
}


export interface ToolContext {
  graph: Graph;
  developerId: string;
  selectedTopic: string | null;
  
  topics(): Promise<DevTopic[]>;
  
  neighbors(): Promise<Map<string, { name: string; domain: string }>>;
  
  pageRank(): Promise<MetricResult>;
  
  betweenness(): Promise<MetricResult>;
  
  resolveTopic(text: string): Promise<ResolvedTopic | null>;
}

export interface ParamSpec {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  
  defaultSelected?: boolean;
}

export interface ToolResult {
  
  summary: string;
  
  facts: Row;
  
  blocks: UiBlock[];
  
  slugs: string[];
  how?: string[];
}

export interface TopicTool<A = any> {
  name: string;
  title: string;
  
  description: string;
  
  whenToUse: string;
  
  features: string[];
  params: Record<string, ParamSpec>;
  run(ctx: ToolContext, args: A): Promise<ToolResult>;
}
