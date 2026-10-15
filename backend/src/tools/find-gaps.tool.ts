import {
  broadButShallow,
  cypher,
  FOUNDATION_LIFT,
  FOUNDATION_WEAK_RANK,
  liftOf,
  metricMeta,
  num,
  round,
  str,
  topicItem,
} from "./shared.js";
import type { TopicTool } from "./types.js";
import type { UiBlock } from "./ui.js";


export const findGapsTool: TopicTool<{ limit?: number }> = {
  name: "find_gaps",
  title: "Find skill gaps",
  description:
    "Finds weak spots: strong topics that stand on weak or unassessed foundations (BUILDS_ON traversal up to 3 hops joined to the developer's KNOWS_TOPIC edges, weighted by PageRank over the developer's own topics) and topics that are broad but shallow relative to the developer's other topics.",
  whenToUse:
    "Gaps, weaknesses, what is missing, what holds me back, what to improve, foundations I lack.",
  features: [
    "Cypher BUILDS_ON*1..3 traversal",
    "KNOWS_TOPIC join",
    "PageRank over your topic subgraph",
  ],
  params: {
    limit: {
      type: "number",
      description: "Maximum gaps to return (default 8)",
      min: 1,
      max: 15,
    },
  },
  async run(ctx, args) {
    const limit = args.limit ?? 8;
    const [topics, pr] = await Promise.all([ctx.topics(), ctx.pageRank()]);
    const prMeta = metricMeta(pr);

    const scopeRows =
      (await cypher(
        ctx.graph,
        "gap scope",
        `
        MATCH (:Developer {id: $dev})-[ku:KNOWS_TOPIC]->(upper:Topic)
        WHERE ku.level_rank >= 3
        OPTIONAL MATCH (upper)-[b:BUILDS_ON]->(:Topic)
        RETURN count(DISTINCT upper) AS uppers, count(b) AS edges
        `,
        { dev: ctx.developerId },
      )) ?? [];
    const uppers = num(scopeRows[0]?.uppers);
    const edgesChecked = num(scopeRows[0]?.edges);
    const verifiable = edgesChecked > 0;

    const rows =
      (await cypher(
        ctx.graph,
        "gap traversal",
        `
        MATCH (:Developer {id: $dev})-[ku:KNOWS_TOPIC]->(upper:Topic)
        WHERE ku.level_rank >= 3
        MATCH path = (upper)-[:BUILDS_ON*1..3]->(f:Topic)
        WITH upper, ku, f, min(length(path)) AS hops
        OPTIONAL MATCH (:Developer {id: $dev})-[kf:KNOWS_TOPIC]->(f)
        RETURN upper.slug AS upper_slug, upper.name AS upper_name,
               ku.level AS upper_level, ku.level_rank AS upper_rank,
               f.slug AS f_slug, f.name AS f_name, hops,
               coalesce(kf.level, "") AS f_level,
               coalesce(kf.level_rank, -1) AS f_rank
        `,
        { dev: ctx.developerId },
      )) ?? [];

    const weakRows = rows.filter(
      (r) => num(r.f_rank, -1) <= FOUNDATION_WEAK_RANK,
    );
    const gaps = weakRows
      .map((r) => {
        const lift = liftOf(pr, str(r.f_slug));
        const hops = num(r.hops, 1);
        const unassessed = str(r.f_level) === "";
        const veryWeak = num(r.f_rank, -1) <= 1;
        const points =
          (hops === 1 ? 2 : 1) +
          (lift >= FOUNDATION_LIFT ? 1 : 0) +
          (num(r.upper_rank) >= 4 ? 1 : 0) +
          (veryWeak ? 1 : 0);
        return {
          upperSlug: str(r.upper_slug),
          upperName: str(r.upper_name),
          upperLevel: str(r.upper_level),
          fSlug: str(r.f_slug),
          fName: str(r.f_name),
          fLevel: str(r.f_level),
          hops,
          unassessed,
          lift: round(lift, 2),
          severity: (points >= 4 ? "high" : points === 3 ? "medium" : "low") as
            | "high"
            | "medium"
            | "low",
          points,
        };
      })
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.lift - a.lift ||
          a.upperName.localeCompare(b.upperName),
      )
      .slice(0, limit);

    const { items: shallowAll, bar } = broadButShallow(topics);
    const shallow = shallowAll.slice(0, 6);

    const blocks: UiBlock[] = [];
    if (gaps.length) {
      blocks.push({
        type: "issues",
        title: "Foundation gaps",
        items: gaps.map((g) => ({
          severity: g.severity,
          title: `${g.upperName} → ${g.fName}`,
          detail: `${g.upperName} is ${g.upperLevel}, but its foundation ${g.fName} ${
            g.unassessed ? "has not been assessed yet" : `is only ${g.fLevel}`
          }${g.hops > 1 ? ` (${g.hops} hops down)` : ""}.`,
          slugs: [g.upperSlug, g.fSlug],
        })),
      });
    }
    if (shallow.length) {
      blocks.push({
        type: "topics",
        title: "Broad but shallow",
        subtitle: `Working level or below with at least ${bar} files`,
        items: shallow.map((t) =>
          topicItem(
            t,
            `${t.files} files, ${t.levelRank <= 1 ? "surface" : "working"}`,
          ),
        ),
      });
    }
    if (!gaps.length && !verifiable) {
      blocks.push({
        type: "callout",
        tone: "info",
        title: "Foundation gaps can't be checked",
        text: `None of your ${uppers} proficient or deep topics has a BUILDS_ON link recorded, so there is nothing to test. This is not evidence that no gaps exist.`,
      });
    } else if (!gaps.length) {
      blocks.push({
        type: "callout",
        tone: "good",
        title: "No foundation gaps found",
        text: `Checked ${edgesChecked} BUILDS_ON link(s) from ${uppers} proficient or deep topic(s); every foundation reached is at least proficient.`,
      });
    }

    const how = [
      `Read your ${uppers} proficient or deep topics (KNOWS_TOPIC level rank 3 or higher) and the ${edgesChecked} BUILDS_ON link(s) leaving them.`,
      verifiable
        ? `Followed BUILDS_ON up to 3 hops: ${rows.length} foundation link(s) reached, ${weakRows.length} of them working level or below, or not assessed.`
        : "No BUILDS_ON link leaves those topics, so the foundation check could not run.",
      `Weighted foundations by lift (${prMeta.scope === "developer" ? "PageRank over your topic subgraph" : prMeta.scope + " PageRank"}; 1.0 = average topic, ${FOUNDATION_LIFT} or more counts as heavily relied on).`,
      `Flagged ${shallowAll.length} broad-but-shallow topic(s): working level or below with at least ${bar} files (that is the larger of 5 and your median).`,
    ];

    const slugs = [
      ...gaps.flatMap((g) => [g.upperSlug, g.fSlug]),
      ...shallow.map((t) => t.slug),
    ];

    return {
      summary: `${gaps.length} foundation gap(s) found${
        verifiable
          ? ` (checked ${edgesChecked} BUILDS_ON link(s) from ${uppers} strong topic(s))`
          : " (unverifiable: no BUILDS_ON links to check)"
      } and ${shallow.length} broad-but-shallow topic(s).`,
      facts: {
        source: pr.source,
        verifiable,
        buildsOnLinksChecked: edgesChecked,
        strongTopics: uppers,
        foundationGaps: gaps.map((g) => ({
          topic: g.upperName,
          topicLevel: g.upperLevel,
          foundation: g.fName,
          foundationLevel: g.unassessed ? "not assessed" : g.fLevel,
          hops: g.hops,
          severity: g.severity,
          foundationLift: g.lift,
        })),
        broadButShallow: shallow.map((t) => t.name),
      },
      blocks,
      slugs,
      how,
    };
  },
};
