import {
  asDepthLevel,
  readTopicPath,
} from "../graph/depth-analyzer-graph.js";
import { bySlugMap, cypher, notFound, refItem, str } from "./shared.js";
import type { TopicTool } from "./types.js";


export const connectTopicsTool: TopicTool<{ from: string; to: string }> = {
  name: "connect_topics",
  title: "How two topics connect",
  description:
    "Finds the shortest chain of BUILDS_ON / RELATED_TOPIC links between two topics (Cypher shortestPath, then algo.SPpaths) and labels every hop.",
  whenToUse:
    "How is X connected to Y, path between X and Y, relationship between two topics, how does X lead to Y.",
  features: ["Cypher shortestPath", "algo.SPpaths"],
  params: {
    from: { type: "string", description: "Start topic name or slug", required: true, defaultSelected: true },
    to: { type: "string", description: "End topic name or slug", required: true },
  },
  async run(ctx, args) {
    const [a, b] = await Promise.all([
      ctx.resolveTopic(args.from),
      ctx.resolveTopic(args.to),
    ]);
    if (!a) return notFound(args.from);
    if (!b) return notFound(args.to);
    const by = bySlugMap(await ctx.topics());

    let slugs = await readTopicPath(ctx.graph, a.slug, b.slug).catch(() => []);
    let engine = "Cypher shortestPath";
    if (!slugs.length) {
      const rows = await cypher(
        ctx.graph,
        "SPpaths",
        `
        MATCH (a:Topic {slug: $a}), (b:Topic {slug: $b})
        CALL algo.SPpaths({sourceNode: a, targetNode: b,
                           relTypes: ['BUILDS_ON', 'RELATED_TOPIC'], pathCount: 1})
        YIELD path
        RETURN [n IN nodes(path) | n.slug] AS slugs
        LIMIT 1
        `,
        { a: a.slug, b: b.slug },
      );
      const found = rows?.[0]?.slugs;
      if (Array.isArray(found) && found.length) {
        slugs = found.map((x) => str(x));
        engine = "algo.SPpaths";
      }
    }

    if (slugs.length < 2) {
      return {
        summary: `No taxonomy path connects ${a.name} and ${b.name}.`,
        facts: { from: a.name, to: b.name, connected: false },
        blocks: [
          {
            type: "callout",
            tone: "warn",
            title: "Not connected",
            text: `${a.name} and ${b.name} have no BUILDS_ON or RELATED_TOPIC chain within 6 hops.`,
          },
        ],
        slugs: [a.slug, b.slug],
      };
    }

    const edges =
      (await cypher(
        ctx.graph,
        "path edges",
        `
        MATCH (x:Topic)-[r:BUILDS_ON|RELATED_TOPIC]->(y:Topic)
        WHERE x.slug IN $s AND y.slug IN $s
        RETURN x.slug AS a, y.slug AS b, type(r) AS type
        `,
        { s: slugs },
      )) ?? [];
    const edgeLabel = (from: string, to: string): string => {
      const fwd = edges.find((e) => str(e.a) === from && str(e.b) === to);
      if (fwd) return str(fwd.type) === "BUILDS_ON" ? "builds on" : "related to";
      const back = edges.find((e) => str(e.a) === to && str(e.b) === from);
      if (back) return str(back.type) === "BUILDS_ON" ? "is foundation of" : "related to";
      return "linked to";
    };

    const names = await cypher(
      ctx.graph,
      "path names",
      `MATCH (t:Topic) WHERE t.slug IN $s RETURN t.slug AS slug, t.name AS name`,
      { s: slugs },
    );
    const nameBy = new Map((names ?? []).map((r) => [str(r.slug), str(r.name)]));

    const steps = slugs.map((slug, i) => {
      const item = refItem(by, slug, nameBy.get(slug));
      return {
        slug,
        name: item.name,
        level: item.level ? asDepthLevel(item.level) : null,
        assessed: item.assessed,
        edge: i < slugs.length - 1 ? edgeLabel(slug, slugs[i + 1]!) : undefined,
      };
    });

    return {
      summary: `${a.name} reaches ${b.name} in ${slugs.length - 1} hop(s) via ${engine}.`,
      facts: {
        engine,
        hops: slugs.length - 1,
        chain: steps.map((s) => `${s.name}${s.edge ? ` (${s.edge})` : ""}`),
      },
      blocks: [{ type: "path", title: `${a.name} → ${b.name}`, steps }],
      slugs,
    };
  },
};
