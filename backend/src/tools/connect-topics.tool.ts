import { asDepthLevel, readTopicPath } from "../graph/depth-analyzer-graph.js";
import { exploreNeighborhoodTool } from "./explore-neighborhood.tool.js";
import { tagged } from "./facade.js";
import { bySlugMap, cypher, notFound, refItem, str } from "./shared.js";
import type { TopicTool } from "./types.js";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

interface Hop {
  type: "BUILDS_ON" | "RELATED_TOPIC" | "LINKED";
  label: string;
  /** a BUILDS_ON edge exists between this pair AND a RELATED_TOPIC one too */
  alsoRelated: boolean;
  reason: string | null;
}

export const topicConnectionsTool: TopicTool<{ from: string; to?: string }> = {
  name: "topic_connections",
  title: "How topics connect",
  description:
    "With two topics: the shortest chain between them, every hop labelled as a prerequisite (BUILDS_ON) or an association (RELATED_TOPIC), plus whether a prerequisite chain exists and how many hops it is. With one topic: its neighbourhood and its full dependency chains, intermediate topics included.",
  whenToUse:
    "How is X connected to Y, how many hops between X and Y, does X build on Y, is Y a prerequisite of X, what does X depend on, what is around X.",
  features: [
    "Cypher shortestPath",
    "algo.SPpaths",
    "BUILDS_ON variable-length traversal",
  ],
  params: {
    from: {
      type: "string",
      description: "Start topic slug",
      required: true,
      defaultSelected: true,
    },
    to: {
      type: "string",
      description:
        "End topic slug. Leave empty to explore one topic's surroundings.",
    },
  },
  async run(ctx, args) {
    const a = await ctx.resolveTopic(args.from);
    if (!a) return notFound(args.from);

    /* ------- one topic: neighbourhood + dependency chains with every intermediate topic ------- */
    if (!args.to) {
      const base = await tagged(ctx, exploreNeighborhoodTool, {
        topic: a.slug,
      });
      const deps =
        (await cypher(
          ctx.graph,
          "dependencies",
          `
          MATCH p = (t:Topic {slug: $s})-[:BUILDS_ON*1..4]->(f:Topic)
          RETURN f.name AS name, f.slug AS slug, length(p) AS hops,
                 [n IN nodes(p) | n.name] AS chain
          ORDER BY hops ASC
          LIMIT 20
          `,
          { s: a.slug },
        )) ?? [];
      return {
        ...base,
        facts: {
          ...((base.facts ?? {}) as Record<string, unknown>),
          dependencies: deps.map((d) => ({
            topic: str(d.name),
            slug: str(d.slug),
            hops: Number(d.hops) || 1,
            relation: Number(d.hops) === 1 ? "direct" : "multi_hop",
            chain: Array.isArray(d.chain) ? d.chain.map((x) => str(x)) : [],
          })),
        },
      };
    }

    /* ------- two topics ------- */
    const b = await ctx.resolveTopic(args.to);
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

    /* every edge between consecutive path nodes, not just the first one the database returns */
    const edges =
      (await cypher(
        ctx.graph,
        "path edges",
        `
        MATCH (x:Topic)-[r:BUILDS_ON|RELATED_TOPIC]->(y:Topic)
        WHERE x.slug IN $s AND y.slug IN $s
        RETURN x.slug AS a, y.slug AS b, type(r) AS type, r.reason AS reason
        `,
        { s: slugs },
      )) ?? [];

    const hopOf = (from: string, to: string): Hop => {
      const here = edges.filter(
        (e) =>
          (str(e.a) === from && str(e.b) === to) ||
          (str(e.a) === to && str(e.b) === from),
      );
      const builds = here.find((e) => str(e.type) === "BUILDS_ON");
      const related = here.find((e) => str(e.type) === "RELATED_TOPIC");
      if (builds)
        return {
          type: "BUILDS_ON",
          label: str(builds.a) === from ? "builds on" : "is foundation of",
          alsoRelated: Boolean(related),
          reason: builds.reason ? str(builds.reason) : null,
        };
      if (related)
        return {
          type: "RELATED_TOPIC",
          label: "goes with",
          alsoRelated: false,
          reason: related.reason ? str(related.reason) : null,
        };
      return {
        type: "LINKED",
        label: "linked to",
        alsoRelated: false,
        reason: null,
      };
    };

    const names = await cypher(
      ctx.graph,
      "path names",
      `MATCH (t:Topic) WHERE t.slug IN $s RETURN t.slug AS slug, t.name AS name`,
      { s: slugs },
    );
    const nameBy = new Map(
      (names ?? []).map((r) => [str(r.slug), str(r.name)]),
    );

    const hops = slugs.slice(0, -1).map((s, i) => hopOf(s, slugs[i + 1]!));
    const steps = slugs.map((slug, i) => {
      const item = refItem(by, slug, nameBy.get(slug));
      const h = hops[i];
      return {
        slug,
        name: item.name,
        level: item.level ? asDepthLevel(item.level) : null,
        assessed: item.assessed,
        edge: h?.label,
        type: h?.type,
        alsoRelated: h?.alsoRelated,
        reason: h?.reason ?? undefined,
      };
    });

    /* is there a PREREQUISITE chain between the two, in either direction, and how long is it? */
    const prereq = async (from: string, to: string): Promise<number | null> => {
      const rows = await cypher(
        ctx.graph,
        "prerequisite chain",
        `
        MATCH (a:Topic {slug: $a}), (b:Topic {slug: $b})
        MATCH p = shortestPath((a)-[:BUILDS_ON*1..6]->(b))
        RETURN length(p) AS hops
        `,
        { a: from, b: to },
      );
      const n = Number(rows?.[0]?.hops);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const [fwd, back] = await Promise.all([
      prereq(a.slug, b.slug),
      prereq(b.slug, a.slug),
    ]);
    const prerequisite =
      fwd != null && (back == null || fwd <= back)
        ? { direction: `${a.name} builds on ${b.name}`, hops: fwd }
        : back != null
          ? { direction: `${b.name} builds on ${a.name}`, hops: back }
          : null;

    const total = slugs.length - 1;
    const foundationHops = hops.filter((h) => h.type === "BUILDS_ON").length;
    const prereqText = prerequisite
      ? ` ${prerequisite.direction}: a prerequisite chain of ${prerequisite.hops} ${plural(prerequisite.hops, "hop", "hops")}.`
      : " No prerequisite chain exists between them; the link is an association only.";

    return {
      summary: `${a.name} reaches ${b.name} in ${total} ${plural(total, "hop", "hops")} via ${engine}.${prereqText}`,
      facts: {
        engine,
        hops: total,
        foundationHops,
        associationHops: total - foundationHops,
        prerequisite,
        chain: steps.map((s) => `${s.name}${s.edge ? ` (${s.edge})` : ""}`),
      },
      blocks: [{ type: "path", title: `${a.name} → ${b.name}`, steps }],
      slugs,
    };
  },
};
