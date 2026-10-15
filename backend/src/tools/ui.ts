import type { DepthLevel } from "../graph/depth-analyzer-graph.js";



export interface TopicItem {
  slug: string;
  name: string;
  level: DepthLevel | null;
  score: number | null;
  assessed: boolean;
  note?: string;
}

export type Tone = "info" | "good" | "warn" | "bad";

export type UiBlock =
  | { type: "callout"; tone: Tone; title: string; text: string }
  | {
      type: "stats";
      title?: string;
      items: Array<{ label: string; value: string | number; hint?: string }>;
    }
  | { type: "topics"; title: string; subtitle?: string; items: TopicItem[] }
  | {
      type: "ranking";
      title: string;
      subtitle?: string;
      metric: string;
      items: Array<{
        slug: string;
        name: string;
        value: number;
        norm: number;
        display: string;
        level: DepthLevel | null;
        note?: string;
      }>;
    }
  | {
      type: "path";
      title: string;
      steps: Array<{
        slug: string;
        name: string;
        level: DepthLevel | null;
        assessed: boolean;
        edge?: string;
      }>;
    }
  | {
      type: "issues";
      title: string;
      items: Array<{
        severity: "high" | "medium" | "low";
        title: string;
        detail: string;
        slugs: string[];
      }>;
    }
  | {
      type: "groups";
      title: string;
      subtitle?: string;
      groups: Array<{
        key: string;
        label: string;
        note?: string;
        items: TopicItem[];
      }>;
    }
  | {
      type: "compare";
      title: string;
      columns: Array<{ slug: string; name: string; level: DepthLevel | null }>;
      rows: Array<{ label: string; values: string[]; best?: number }>;
    }
  | {
      type: "roadmap";
      title: string;
      steps: Array<{
        order: number;
        slug: string;
        name: string;
        why: string;
        assessed: boolean;
        level: DepthLevel | null;
        status: "known" | "todo" | "target";
      }>;
    }
  | { type: "bullets"; title: string; tone: "good" | "warn"; items: string[] }
  | {
      type: "approaches";
      title: string;
      items: Array<{
        name: string;
        depth: DepthLevel;
        primary: boolean;
        authenticity: string;
        how: string;
      }>;
    }
  | {
      type: "timeline";
      title: string;
      subtitle?: string;
      items: Array<{
        slug: string;
        label: string;
        value: number;
        display: string;
        note?: string;
      }>;
    };
