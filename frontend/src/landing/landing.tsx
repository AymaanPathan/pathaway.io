/* eslint-disable react-hooks/set-state-in-effect */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Brain,
  Check,
  CircleDot,
  GitBranch,
  GitPullRequest,
  Goal,
  MessageSquare,
  Network,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { githubConnectUrl } from "../lib/api";
import { FaGithub } from "react-icons/fa";

/* -------------------------------------------------------------------------- */
/* TOKENS (same as the overview page)                                         */
/* -------------------------------------------------------------------------- */

const DISPLAY = '"Space Grotesk", "Arial Black", sans-serif';
const BODY = '"Inter", "Helvetica Neue", sans-serif';
const MONO = '"IBM Plex Mono", "SF Mono", monospace';

const YELLOW = "#F5C542";
const GREEN = "#3FA24A";
const INK = "#101210";
const SOFT = "#FBF7EA";
const LINE = "#E4E0D4";

const shadow = (n: number) => `${n}px ${n}px 0 0 ${INK}`;
const border = { border: `2px solid ${INK}` };
const focus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#101210]";

/* -------------------------------------------------------------------------- */
/* CSS: calm. Only one soft reveal on scroll and press feedback on buttons.   */
/* No looping animation anywhere.                                             */
/* -------------------------------------------------------------------------- */

const CSS = `
html { scroll-behavior: smooth; }
section[id], div[id="top"] { scroll-margin-top: 64px; }
:root { --pw-ease: cubic-bezier(.22,1,.36,1); }

.pw-reveal { opacity: 0; transform: translate3d(0, 14px, 0); transition: opacity .6s var(--pw-ease), transform .6s var(--pw-ease); transition-delay: var(--d, 0ms); }
.pw-reveal.pw-in { opacity: 1; transform: none; }

.pw-btn { --sh: 3px; box-shadow: var(--sh) var(--sh) 0 0 ${INK}; transition: transform .1s ease, box-shadow .1s ease, background-color .2s ease; -webkit-tap-highlight-color: transparent; user-select: none; }
.pw-btn:active:not(:disabled) { transform: translate(var(--sh), var(--sh)); box-shadow: 0 0 0 0 ${INK}; }

.pw-card { box-shadow: 3px 3px 0 0 ${INK}; }

.pw-fade { animation: pw-fade .25s ease-out both; }
@keyframes pw-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .pw-reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
  .pw-fade { animation: none !important; }
}
`;

/* -------------------------------------------------------------------------- */
/* HOOKS                                                                      */
/* -------------------------------------------------------------------------- */

function useInView<T extends HTMLElement>(threshold = 0.12) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`pw-reveal ${seen ? "pw-in" : ""} ${className}`}
      style={{ "--d": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PAGE                                                                       */
/* -------------------------------------------------------------------------- */

export default function PathwayLanding() {
  return (
    <div
      id="top"
      className="min-h-screen overflow-x-clip bg-white"
      style={{ fontFamily: BODY, color: INK, fontWeight: 500 }}
    >
      <style>{CSS}</style>
      <Nav />
      <Hero />
      <Problem />
      <HowItWorks />
      <TheGraph />
      <EvidenceGraph />
      <Agents />
      <GoalToMission />
      <Verification />
      <WhyGraph />
      <Compare />
      <FinalCta />
      <Footer />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* NAV                                                                        */
/* -------------------------------------------------------------------------- */

function Nav() {
  return (
    <header
      className="sticky top-0 z-40"
      style={{
        borderBottom: `2px solid ${INK}`,
        backgroundColor: "rgba(255,255,255,.96)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-2.5 sm:px-6">
        <a href="#top" className={`flex items-center gap-2 ${focus}`}>
          <Mark />
          <span
            className="text-[16px] font-bold tracking-tight"
            style={{ fontFamily: DISPLAY }}
          >
            pathway.io
          </span>
        </a>

        <nav className="hidden items-center gap-1 text-[12px] font-bold md:flex">
          {[
            ["How it works", "#how"],
            ["The graph", "#graph"],
            ["Agents", "#agents"],
            ["Verification", "#verify"],
          ].map(([label, href]) => (
            <a
              key={label}
              href={href}
              className={`rounded-full px-3 py-1 text-neutral-500 hover:text-neutral-900 ${focus}`}
            >
              {label}
            </a>
          ))}
        </nav>

        <Btn href={githubConnectUrl()} variant="accent" size="sm">
          <FaGithub size={14} />
          Connect GitHub
        </Btn>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* HERO                                                                       */
/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden px-5 pb-20 pt-12 sm:px-6 md:pt-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[.5]"
        style={{
          backgroundImage: `radial-gradient(${INK} 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
          maskImage:
            "radial-gradient(ellipse at 70% 30%, rgba(0,0,0,.2), transparent 65%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 70% 30%, rgba(0,0,0,.2), transparent 65%)",
        }}
      />
      <div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
            style={{ ...border, backgroundColor: YELLOW }}
          >
            <Sparkles size={12} />
            Engineering intelligence from your entire GitHub
          </span>

          <h1
            className="mt-5 max-w-3xl text-[46px] font-bold leading-[0.96] tracking-tight sm:text-[62px] lg:text-[70px]"
            style={{ fontFamily: DISPLAY }}
          >
            Your GitHub is history. Pathway turns it into understanding.
          </h1>

          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-neutral-600">
            Pathway reads every repo, commit and file change, finds what your
            code actually proves, and wires it all into one living knowledge
            graph: what you are good at, how deep it goes, how it connects, and
            what to build next.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-5">
            <Btn href={githubConnectUrl()} variant="primary" size="md">
              <FaGithub size={16} />
              Build my developer graph
            </Btn>
            <Link
              to="/graph"
              className={`inline-flex items-center gap-1.5 text-[13px] font-bold underline underline-offset-4 ${focus}`}
            >
              Explore the graph
              <ArrowRight size={14} />
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-[12px] font-semibold text-neutral-500">
            {[
              ["Evidence for every claim", GREEN],
              ["Graph-native reasoning", YELLOW],
              ["Verified, not assumed", INK],
            ].map(([label, color]) => (
              <span key={label} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: color,
                    border: `1.5px solid ${INK}`,
                  }}
                />
                {label}
              </span>
            ))}
          </div>
        </div>

        <HeroProduct />
      </div>
    </section>
  );
}

type HeroLeaf = { name: string; gap?: boolean };
type HeroTopic = {
  id: string;
  name: string;
  proofs: number;
  angle: number;
  leaves: HeroLeaf[];
};

const HERO_TOPICS: HeroTopic[] = [
  {
    id: "data",
    name: "Data Layer",
    proofs: 26,
    angle: -90,
    leaves: [{ name: "Postgres" }, { name: "Redis" }, { name: "Prisma" }],
  },
  {
    id: "rel",
    name: "Reliability",
    proofs: 24,
    angle: -18,
    leaves: [{ name: "Retries" }, { name: "Circuit breaker" }],
  },
  {
    id: "api",
    name: "API Design",
    proofs: 8,
    angle: 54,
    leaves: [{ name: "REST routes" }, { name: "Auth" }, { name: "Validation" }],
  },
  {
    id: "conc",
    name: "Concurrency",
    proofs: 3,
    angle: 126,
    leaves: [{ name: "Locks" }, { name: "Transactions" }],
  },
  {
    id: "async",
    name: "Async Processing",
    proofs: 1,
    angle: 198,
    leaves: [
      { name: "Promises" },
      { name: "Job queue", gap: true },
      { name: "Workers", gap: true },
    ],
  },
];

const HW = 760;
const HH = 470;
const HCX = 380;
const HCY = 235;
const hpt = (deg: number, rx: number, ry: number) => ({
  x: HCX + Math.cos((deg * Math.PI) / 180) * rx,
  y: HCY + Math.sin((deg * Math.PI) / 180) * ry,
});

const HERO_LAYOUT = HERO_TOPICS.map((t) => {
  const p = hpt(t.angle, 135, 92);
  const offs =
    t.leaves.length === 3
      ? [-24, 0, 24]
      : t.leaves.length === 2
        ? [-17, 17]
        : [0];
  return {
    ...t,
    ...p,
    r: 17 + Math.min(t.proofs, 26) * 0.3,
    leaves: t.leaves.map((l, i) => ({
      ...l,
      ...hpt(t.angle + offs[i], 275, 185),
    })),
  };
});

const HERO_TOTAL = HERO_TOPICS.reduce((s, t) => s + t.proofs, 0);
const stroke = (c: string, w: number) =>
  ({
    paintOrder: "stroke",
    stroke: c,
    strokeWidth: w,
    strokeLinejoin: "round",
  }) as CSSProperties;

function HeroProduct() {
  const [sel, setSel] = useState<string | null>("async");
  const [hover, setHover] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const active = HERO_LAYOUT.find((t) => t.id === sel) ?? null;
  const hasGap = !!active?.leaves.some((l) => l.gap);
  const toggle = (id: string) => setSel((cur) => (cur === id ? null : id));
  const focusId = hover ?? sel;
  const dim = (id: string) => (focusId === null || focusId === id ? 1 : 0.2);

  return (
    <div
      className="overflow-hidden rounded-3xl bg-white"
      style={{ ...border, boxShadow: shadow(6) }}
    >
      {/* window chrome */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: `2px solid ${INK}` }}
      >
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-black bg-[#F0776B]" />
          <span
            className="h-3 w-3 rounded-full border-2 border-black"
            style={{ backgroundColor: YELLOW }}
          />
          <span
            className="h-3 w-3 rounded-full border-2 border-black"
            style={{ backgroundColor: GREEN }}
          />
        </div>
        <span
          className="text-[10px] text-neutral-500"
          style={{ fontFamily: MONO }}
        >
          pathway / your developer graph
        </span>
        <span className="ml-auto text-[10px] font-bold text-neutral-500">
          {HERO_TOTAL} PROOFS FROM YOUR CODE
        </span>
      </div>

      {/* graph (light, like the overview canvas) */}
      <div className="px-3 pb-2 pt-3 sm:px-5" style={{ backgroundColor: SOFT }}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold text-neutral-600">
            Your GitHub → topics → skills. Tap a topic.
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ ...border, backgroundColor: YELLOW }}
          >
            2 gaps found
          </span>
        </div>

        <svg
          viewBox={`0 0 ${HW} ${HH}`}
          className="mt-1 block w-full"
          role="group"
          aria-label="Your GitHub account in the centre, connected to engineering topics, each connected to the skills that back it"
        >
          <defs>
            <pattern
              id="hgrid"
              width="32"
              height="32"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="1" fill={INK} opacity=".11" />
            </pattern>
          </defs>
          <rect width={HW} height={HH} fill="url(#hgrid)" />

          {/* edges */}
          {HERO_LAYOUT.map((t) => (
            <g
              key={`e-${t.id}`}
              style={{ opacity: dim(t.id), transition: "opacity .3s ease" }}
            >
              <line
                x1={HCX}
                y1={HCY}
                x2={t.x}
                y2={t.y}
                stroke={INK}
                strokeOpacity=".45"
                strokeWidth="2"
              />
              {t.leaves.map((l) => (
                <line
                  key={l.name}
                  x1={t.x}
                  y1={t.y}
                  x2={l.x}
                  y2={l.y}
                  stroke={l.gap ? "#b8860b" : INK}
                  strokeOpacity={l.gap ? 0.9 : 0.35}
                  strokeWidth={l.gap ? 2 : 1.4}
                  strokeDasharray={l.gap ? "5 5" : undefined}
                />
              ))}
            </g>
          ))}

          {/* skills */}
          {HERO_LAYOUT.map((t) =>
            t.leaves.map((l) => {
              const right = l.x > HCX + 30;
              const left = l.x < HCX - 30;
              const above = l.y < HCY;
              const tx = right ? l.x + 13 : left ? l.x - 13 : l.x;
              const ty =
                right || left ? l.y + 3.5 : above ? l.y - 13 : l.y + 21;
              return (
                <g
                  key={`${t.id}-${l.name}`}
                  onClick={() => toggle(t.id)}
                  style={{
                    opacity: dim(t.id),
                    transition: "opacity .3s ease",
                    cursor: "pointer",
                  }}
                >
                  <circle
                    cx={l.x}
                    cy={l.y}
                    r={8}
                    fill={l.gap ? YELLOW : "#fff"}
                    stroke={INK}
                    strokeWidth="2"
                    strokeDasharray={l.gap ? "3 2" : undefined}
                  />
                  <text
                    x={tx}
                    y={ty}
                    textAnchor={right ? "start" : left ? "end" : "middle"}
                    fontSize="10.5"
                    fontWeight={700}
                    fontFamily={BODY}
                    fill={INK}
                    style={stroke(SOFT, 4)}
                  >
                    {l.name}
                    {l.gap ? " (gap)" : ""}
                  </text>
                </g>
              );
            }),
          )}

          {/* topics */}
          {HERO_LAYOUT.map((t) => {
            const gap = t.leaves.some((l) => l.gap);
            const on = sel === t.id;
            return (
              <g
                key={t.id}
                tabIndex={0}
                role="button"
                aria-pressed={on}
                aria-label={`${t.name}, ${t.proofs} proofs`}
                onClick={() => toggle(t.id)}
                onMouseEnter={() => setHover(t.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(t.id)}
                onBlur={() => setHover(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(t.id);
                  }
                }}
                style={{
                  opacity: dim(t.id),
                  transition: "opacity .3s ease",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {on && (
                  <circle
                    cx={t.x}
                    cy={t.y}
                    r={t.r + 7}
                    fill="none"
                    stroke={YELLOW}
                    strokeWidth="4"
                  />
                )}
                <circle
                  cx={t.x}
                  cy={t.y}
                  r={t.r}
                  fill={gap ? YELLOW : "#fff"}
                  stroke={INK}
                  strokeWidth={on ? 4 : 3}
                />
                <text
                  x={t.x}
                  y={t.y + 4}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight={800}
                  fontFamily={MONO}
                  fill={INK}
                >
                  {t.proofs}
                </text>
                <text
                  x={t.x}
                  y={t.y + t.r + 15}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight={700}
                  fontFamily={DISPLAY}
                  fill={INK}
                  style={stroke(SOFT, 5)}
                >
                  {t.name}
                </text>
              </g>
            );
          })}

          {/* account */}
          <g>
            <circle
              cx={HCX}
              cy={HCY}
              r={36}
              fill={GREEN}
              stroke={INK}
              strokeWidth="3"
            />
            <text
              x={HCX}
              y={HCY - 2}
              textAnchor="middle"
              fontSize="14"
              fontWeight={800}
              fontFamily={DISPLAY}
              fill="#fff"
            >
              YOU
            </text>
            <text
              x={HCX}
              y={HCY + 12}
              textAnchor="middle"
              fontSize="8.5"
              fontFamily={MONO}
              fill="#fff"
            >
              @github
            </text>
          </g>
        </svg>
      </div>

      {/* legend */}
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5 text-[11px] font-semibold text-neutral-600"
        style={{ borderBlock: `2px solid ${INK}`, backgroundColor: "#fff" }}
      >
        <span className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: GREEN, border: `2px solid ${INK}` }}
          />
          Account
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-full bg-white"
            style={{ border: `2px solid ${INK}` }}
          />
          Topic (number = proofs)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: YELLOW, border: `2px dashed ${INK}` }}
          />
          Gap
        </span>
      </div>

      {/* detail */}
      <div className="min-h-[148px] p-4 sm:p-5">
        <div key={sel ?? "none"} className="pw-fade">
          {active ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  className="text-[18px] font-bold"
                  style={{ fontFamily: DISPLAY }}
                >
                  {active.name}
                </h3>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{
                    ...border,
                    backgroundColor: hasGap ? YELLOW : "#fff",
                  }}
                >
                  {active.proofs} proof{active.proofs === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-600">
                {hasGap
                  ? "Almost no proof here, and it is part of your goal. These skills are missing from your code."
                  : `Backed by ${active.proofs} demonstrations in your repositories. Built from these skills:`}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {active.leaves.map((l) => (
                  <span
                    key={l.name}
                    className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={{
                      border: `1.5px ${l.gap ? "dashed" : "solid"} ${INK}`,
                      backgroundColor: l.gap ? YELLOW : "#fff",
                    }}
                  >
                    {l.name}
                    {l.gap ? " (missing)" : ""}
                  </span>
                ))}
              </div>

              {hasGap && (
                <div
                  className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl p-3"
                  style={{ ...border, backgroundColor: SOFT }}
                >
                  <div>
                    <div
                      className="text-[10px] font-bold text-neutral-500"
                      style={{ fontFamily: MONO }}
                    >
                      NEXT MISSION
                    </div>
                    <div
                      className="text-[14px] font-bold"
                      style={{ fontFamily: DISPLAY }}
                    >
                      Build a durable job queue
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-neutral-500">
                      <GitPullRequest size={11} /> Real GitHub issue
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAccepted((v) => !v)}
                    aria-pressed={accepted}
                    className={`pw-btn inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[11px] font-bold ${focus}`}
                    style={
                      {
                        ...border,
                        "--sh": "2px",
                        backgroundColor: accepted ? GREEN : INK,
                        color: "#fff",
                      } as CSSProperties
                    }
                  >
                    {accepted ? (
                      <>
                        <Check size={12} /> Accepted
                      </>
                    ) : (
                      <>
                        Accept mission <ArrowRight size={12} />
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="pt-2 text-[13px] leading-relaxed text-neutral-600">
              Tap any topic in the graph to see which skills it is built from
              and how much proof your code gives it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PROBLEM                                                                    */
/* -------------------------------------------------------------------------- */

function Problem() {
  return (
    <section
      className="px-5 py-20 sm:px-6"
      style={{
        borderBottom: `2px solid ${INK}`,
        backgroundColor: SOFT,
      }}
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <Reveal>
            <Eyebrow>THE PROBLEM</Eyebrow>
            <h2
              className="mt-3 text-[38px] font-bold leading-none tracking-tight sm:text-[52px]"
              style={{ fontFamily: DISPLAY }}
            >
              You have the data. Nobody has the understanding.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="max-w-2xl text-[16px] leading-relaxed text-neutral-600">
              Thousands of commits. Dozens of repos. Years of work. All of it
              scattered across files, PRs and projects.{" "}
              <strong>
                Nothing explains what it adds up to, how your skills connect, or
                what you should do next.
              </strong>
            </p>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              number: "01",
              title: "Commit counts lie",
              body: "Tweaking a config and building distributed coordination both look like one commit. Activity says nothing about capability.",
            },
            {
              number: "02",
              title: "Skill lists have no proof",
              body: "“Redis” on a résumé does not show you understand distributed rate limiting. Without the implementation, it is a claim.",
            },
            {
              number: "03",
              title: "Chatbots forget",
              body: "They summarize a repo once. They never build a persistent, queryable model of what your code knows.",
            },
            {
              number: "04",
              title: "Generic advice does not know you",
              body: "“Learn queues” fits everyone and no one. It cannot explain why a task fits what you have demonstrated.",
            },
          ].map((p, i) => (
            <Reveal key={p.number} delay={i * 80}>
              <Card className="h-full p-6">
                <span
                  className="text-[11px] font-bold text-neutral-400"
                  style={{ fontFamily: MONO }}
                >
                  {p.number}
                </span>
                <h3
                  className="mt-7 text-[21px] font-bold leading-tight"
                  style={{ fontFamily: DISPLAY }}
                >
                  {p.title}
                </h3>
                <p className="mt-3 text-[13px] leading-relaxed text-neutral-600">
                  {p.body}
                </p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* HOW IT WORKS                                                               */
/* -------------------------------------------------------------------------- */

function HowItWorks() {
  const steps = [
    {
      icon: FaGithub,
      title: "Read your GitHub",
      body: "Repositories, commits and the file changes inside them. The code itself, not just the log.",
      chip: "OBSERVE",
    },
    {
      icon: Brain,
      title: "Extract demonstrations",
      body: "Each change is analyzed for what it proves, then linked to the exact file change and commit behind it.",
      chip: "EVIDENCE",
    },
    {
      icon: Network,
      title: "Build the graph",
      body: "Demonstrations, capabilities, topics and prerequisites become one persistent FalkorDB knowledge graph.",
      chip: "MODEL",
    },
    {
      icon: Goal,
      title: "Reason and plan",
      body: "Agents traverse the graph to find your strengths, depth and gaps, then form a goal and a bounded mission.",
      chip: "INVESTIGATE",
    },
    {
      icon: ShieldCheck,
      title: "Verify and update",
      body: "Only verified work becomes new proof. The graph updates, and the next mission starts from there.",
      chip: "VERIFY",
    },
  ];

  return (
    <section id="how" className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
      <Reveal>
        <Eyebrow>HOW IT WORKS</Eyebrow>
        <h2
          className="mt-3 max-w-3xl text-[40px] font-bold leading-none tracking-tight sm:text-[56px]"
          style={{ fontFamily: DISPLAY }}
        >
          From raw commits to verified capability. In one loop.
        </h2>
      </Reveal>

      <div className="relative mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-5">
        <div
          className="absolute left-[8%] right-[8%] top-7 hidden h-0 border-t-2 border-dashed opacity-35 lg:block"
          style={{ borderColor: INK }}
        />
        {steps.map((step, i) => (
          <Reveal key={step.title} delay={i * 80} className="relative">
            <div
              className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full"
              style={{
                ...border,
                backgroundColor: i === steps.length - 1 ? GREEN : YELLOW,
                boxShadow: shadow(2),
              }}
            >
              <step.icon size={21} />
            </div>
            <Card className="mt-5 h-full p-5">
              <span
                className="text-[10px] font-bold text-neutral-400"
                style={{ fontFamily: MONO }}
              >
                {String(i + 1).padStart(2, "0")} / {step.chip}
              </span>
              <h3
                className="mt-4 text-[19px] font-bold leading-tight"
                style={{ fontFamily: DISPLAY }}
              >
                {step.title}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-neutral-600">
                {step.body}
              </p>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* THE GRAPH IS THE PRODUCT                                                   */
/* -------------------------------------------------------------------------- */

const ENTITIES: Array<[string, string]> = [
  ["Developer", "The engineer being analyzed"],
  ["Repository", "The codebase holding the history"],
  ["Commit", "A recorded change"],
  ["FileChange", "The implementation evidence"],
  ["Demonstration", "Proof that code exhibits a capability"],
  ["Capability", "A specific engineering ability or mechanism"],
  ["Topic", "A technical subject and its knowledge"],
  ["Technique", "An approach or correctness safeguard"],
  ["Prerequisite", "What builds on what"],
  ["Goal", "A concrete engineering objective"],
  ["Mission", "A bounded implementation task"],
  ["Verified outcome", "Work that passed verification"],
];

const ALGOS: Array<[string, string]> = [
  [
    "Graph traversal",
    "Follows edges to pull the right evidence, capabilities and prerequisites.",
  ],
  [
    "Personalized PageRank",
    "Ranks what matters around the topics a goal cares about.",
  ],
  [
    "Betweenness centrality",
    "Finds topics that bridge separate regions of your knowledge.",
  ],
  ["Community analysis", "Reveals clusters of related engineering knowledge."],
  [
    "Connectivity analysis",
    "Shows how topics and capabilities actually link up.",
  ],
  [
    "Directed prerequisites",
    "Keeps dependency direction so “builds on” stays true.",
  ],
];

function TheGraph() {
  return (
    <section
      id="graph"
      className="px-5 py-24 sm:px-6"
      style={{ borderBlock: `2px solid ${INK}`, backgroundColor: SOFT }}
    >
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-4xl">
          <Eyebrow>THE GRAPH IS THE PRODUCT</Eyebrow>
          <h2
            className="mt-3 text-[40px] font-bold leading-none tracking-tight sm:text-[56px]"
            style={{ fontFamily: DISPLAY }}
          >
            Not a database behind a chatbot. The model of what you know.
          </h2>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-neutral-600">
            FalkorDB holds your engineering knowledge as connected nodes and
            relationships. That is what lets Pathway walk from a claim to its
            proof, from a capability to what it builds on, and from a verified
            mission back into your profile.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal>
            <Card className="h-full p-6 sm:p-8">
              <div
                className="text-[10px] font-bold text-neutral-400"
                style={{ fontFamily: MONO }}
              >
                WHAT LIVES IN YOUR GRAPH
              </div>
              <div className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {ENTITIES.map(([name, desc]) => (
                  <div key={name} className="flex items-start gap-2.5">
                    <span
                      className="mt-1 h-3 w-3 shrink-0 rounded-full"
                      style={{
                        ...border,
                        backgroundColor:
                          name === "Verified outcome" ? GREEN : YELLOW,
                      }}
                    />
                    <div>
                      <div
                        className="text-[13px] font-bold"
                        style={{ fontFamily: DISPLAY }}
                      >
                        {name}
                      </div>
                      <div className="text-[12px] leading-snug text-neutral-600">
                        {desc}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap gap-1.5">
                {[
                  "CHANGED",
                  "EVIDENCED_BY",
                  "DEMONSTRATED_IN",
                  "SUPPORTED_BY",
                  "BUILDS_ON",
                ].map((r) => (
                  <span
                    key={r}
                    className="rounded-full px-2.5 py-1 text-[10px] font-bold"
                    style={{
                      border: `1.5px solid ${INK}`,
                      backgroundColor: SOFT,
                      fontFamily: MONO,
                    }}
                  >
                    {r}
                  </span>
                ))}
              </div>
            </Card>
          </Reveal>

          <Reveal delay={80}>
            <Card className="h-full p-6 sm:p-8">
              <div
                className="text-[10px] font-bold text-neutral-400"
                style={{ fontFamily: MONO }}
              >
                GRAPH ALGORITHMS, EACH WITH ONE JOB
              </div>
              <ul className="mt-5 space-y-3.5">
                {ALGOS.map(([name, job]) => (
                  <li key={name}>
                    <div
                      className="text-[14px] font-bold"
                      style={{ fontFamily: DISPLAY }}
                    >
                      {name}
                    </div>
                    <div className="text-[12px] leading-snug text-neutral-600">
                      {job}
                    </div>
                  </li>
                ))}
              </ul>
              <p
                className="mt-5 rounded-xl p-3 text-[12px] font-bold leading-snug"
                style={{ ...border, backgroundColor: YELLOW }}
              >
                Structure gives context. Evidence backs claims. Agents turn it
                into decisions.
              </p>
            </Card>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* EVIDENCE GRAPH (click to explore, no auto-cycling)                         */
/* -------------------------------------------------------------------------- */

const FLOW: Array<[string, string, string]> = [
  ["Developer", "DEMONSTRATED", "Demonstration"],
  ["Demonstration", "OF_CAPABILITY", "Capability"],
  ["Demonstration", "EVIDENCED_BY", "FileChange"],
  ["FileChange", "CHANGED", "Commit"],
];

function EvidenceGraph() {
  const [active, setActive] = useState(0);

  return (
    <section
      className="px-5 py-24 sm:px-6"
      style={{ borderBottom: `2px solid ${INK}`, backgroundColor: INK }}
    >
      <div className="mx-auto max-w-7xl text-white">
        <Reveal>
          <Eyebrow dark>PROVENANCE</Eyebrow>
        </Reveal>
        <div className="mt-3 grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
          <Reveal>
            <h2
              className="text-[40px] font-bold leading-none tracking-tight sm:text-[56px]"
              style={{ fontFamily: DISPLAY }}
            >
              Every claim has a trail back to a line of code.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="max-w-xl text-[15px] leading-relaxed text-neutral-400">
              Pathway never stops at “you know Redis.” It keeps the full chain:
              you, the demonstration, the capability it proves, the file change
              that produced it, and the commit it came from. Click a link to
              follow it.
            </p>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <Reveal>
            <div
              className="overflow-hidden rounded-2xl bg-white p-5 sm:p-7"
              style={{ ...border, boxShadow: `5px 5px 0 0 ${YELLOW}` }}
            >
              <GraphEvidenceVisual active={active} />
            </div>
          </Reveal>

          <div className="space-y-3">
            {FLOW.map(([a, rel, b], i) => {
              const on = active === i;
              return (
                <Reveal key={`${a}-${rel}-${b}`} delay={i * 60}>
                  <button
                    type="button"
                    onClick={() => setActive(i)}
                    aria-pressed={on}
                    className={`pw-btn block w-full rounded-xl p-4 text-left ${focus}`}
                    style={
                      {
                        ...border,
                        "--sh": "3px",
                        backgroundColor: on ? YELLOW : "#ffffff",
                        color: INK,
                      } as CSSProperties
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold">
                      <span>{a}</span>
                      <span
                        className="rounded-full px-2 py-1"
                        style={{
                          backgroundColor: on ? "#fff" : SOFT,
                          fontFamily: MONO,
                        }}
                      >
                        {rel}
                      </span>
                      <ArrowRight size={13} />
                      <span>{b}</span>
                    </div>
                  </button>
                </Reveal>
              );
            })}

            <Reveal delay={260}>
              <p className="pt-2 text-[12px] leading-relaxed text-neutral-400">
                The graph tells a directly supported claim from a possible
                inference, and shows missing evidence instead of counting it as
                proof.
              </p>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

function GraphEvidenceVisual({ active }: { active: number }) {
  return (
    <svg
      viewBox="0 0 720 330"
      className="w-full"
      role="img"
      aria-label="Evidence graph connecting developer, demonstration, capability, file change and commit"
    >
      <defs>
        <marker
          id="arrow"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L0,6 L7,3 z" fill={INK} />
        </marker>
        <pattern
          id="egrid"
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r="1" fill={INK} opacity=".11" />
        </pattern>
      </defs>
      <rect width="720" height="330" fill="url(#egrid)" />

      <GraphLine
        on={active === 0}
        x1={113}
        y1={100}
        x2={270}
        y2={100}
        label="DEMONSTRATED"
      />
      <GraphLine
        on={active === 1}
        x1={370}
        y1={100}
        x2={535}
        y2={100}
        label="OF_CAPABILITY"
      />
      <GraphLine
        on={active === 2}
        x1={320}
        y1={125}
        x2={220}
        y2={230}
        label="EVIDENCED_BY"
      />
      <GraphLine
        on={active === 3}
        x1={220}
        y1={270}
        x2={385}
        y2={270}
        label="CHANGED"
      />

      <GraphNode
        on={active === 0}
        x={70}
        y={100}
        title="Developer"
        sub="you"
        fill={GREEN}
      />
      <GraphNode
        on={active <= 2}
        x={320}
        y={100}
        title="Demonstration"
        sub="retry_with_backoff"
        fill="#fff"
      />
      <GraphNode
        on={active === 1}
        x={585}
        y={100}
        title="Capability"
        sub="Reliability"
        fill={YELLOW}
      />
      <GraphNode
        on={active === 2 || active === 3}
        x={170}
        y={250}
        title="FileChange"
        sub="worker.ts"
        fill="#fff"
      />
      <GraphNode
        on={active === 3}
        x={435}
        y={250}
        title="Commit"
        sub="8f2c..."
        fill="#fff"
      />
    </svg>
  );
}

function GraphLine({
  x1,
  y1,
  x2,
  y2,
  label,
  on,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  on: boolean;
}) {
  return (
    <>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={on ? "#c9503f" : INK}
        strokeWidth={on ? 3.5 : 1.8}
        markerEnd="url(#arrow)"
        style={{
          opacity: on ? 1 : 0.35,
          transition: "opacity .3s ease, stroke-width .3s ease",
        }}
      />
      <text
        x={(x1 + x2) / 2}
        y={(y1 + y2) / 2 - 9}
        textAnchor="middle"
        fill={INK}
        fontSize="9"
        fontWeight={on ? 700 : 500}
        fontFamily={MONO}
        style={{ opacity: on ? 1 : 0.5, transition: "opacity .3s ease" }}
      >
        {label}
      </text>
    </>
  );
}

function GraphNode({
  x,
  y,
  title,
  sub,
  fill,
  on,
}: {
  x: number;
  y: number;
  title: string;
  sub: string;
  fill: string;
  on: boolean;
}) {
  return (
    <g style={{ opacity: on ? 1 : 0.55, transition: "opacity .3s ease" }}>
      {on && (
        <circle
          cx={x}
          cy={y}
          r="50"
          fill="none"
          stroke={YELLOW}
          strokeWidth="4"
        />
      )}
      <circle
        cx={x}
        cy={y}
        r="43"
        fill={fill}
        stroke={INK}
        strokeWidth={on ? 3.5 : 2.5}
      />
      <text
        x={x}
        y={y - 2}
        textAnchor="middle"
        fill={fill === GREEN ? "#fff" : INK}
        fontSize="11"
        fontWeight="700"
        fontFamily={DISPLAY}
      >
        {title}
      </text>
      <text
        x={x}
        y={y + 14}
        textAnchor="middle"
        fill={fill === GREEN ? "#fff" : "#555"}
        fontSize="8"
        fontFamily={MONO}
      >
        {sub}
      </text>
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* AGENTS                                                                     */
/* -------------------------------------------------------------------------- */

type AgentDef = {
  id: string;
  icon: LucideIcon;
  name: string;
  job: string;
  body: string;
  outputs: string[];
  sample: string;
};

const AGENTS: AgentDef[] = [
  {
    id: "depth",
    icon: Brain,
    name: "Depth Analysis",
    job: "How deep do you go?",
    body: "Assesses each technical topic from code evidence, topic relationships and structured judgments. AI does the discovery and assessment; deterministic reconciliation, evidence-strength limits and relationship validation keep it honest.",
    outputs: [
      "Topic depth, not a flat tech list",
      "Evidence strength behind every rating",
      "Validated topic relationships",
    ],
    sample:
      "Data Layer: strong. 26 demonstrations across Postgres, Redis and Prisma. Async Processing: thin. 1 demonstration, no worker or queue evidence.",
  },
  {
    id: "goal",
    icon: Target,
    name: "Goal Agent",
    job: "What should you work toward?",
    body: "Investigates an objective using graph context, evidence, related capabilities, prerequisites and prior verified work. The result is a concrete goal grounded in your codebase, not “go learn a technology.”",
    outputs: [
      "What the graph directly establishes",
      "What the evidence only suggests",
      "What is unknown or unsupported",
    ],
    sample:
      "Goal: add retry-safe background processing to the payments service. Your reliability work supports it; no worker pattern exists yet.",
  },
  {
    id: "chat",
    icon: MessageSquare,
    name: "Chat Agent",
    job: "Ask anything about your engineering.",
    body: "Picks the right graph tools for your question, follows dependent findings and adapts instead of blindly calling everything. Every answer comes back with the receipts.",
    outputs: [
      "Evidence and graph paths",
      "Confidence and stated limitations",
      "Actionable conclusions",
    ],
    sample:
      "Q: Do I understand distributed rate limiting? A: Partially. Redis counters are demonstrated. Cross-node coordination has no supporting evidence.",
  },
  {
    id: "mission",
    icon: GitBranch,
    name: "Mission Planner",
    job: "Turn the goal into a shippable task.",
    body: "Converts an established goal into a bounded implementation task you can build and have evaluated against explicit requirements. Not an open-ended learning assignment.",
    outputs: [
      "Scope and relevant files",
      "Acceptance criteria",
      "Required mechanisms and constraints to preserve",
    ],
    sample:
      "Mission: durable job queue. Scope: worker + retry policy. Must keep idempotent handlers. Accepts when failed jobs retry and dead-letter correctly.",
  },
];

function Agents() {
  const [id, setId] = useState(AGENTS[0].id);
  const agent = AGENTS.find((a) => a.id === id) ?? AGENTS[0];

  return (
    <section id="agents" className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
      <Reveal className="max-w-4xl">
        <Eyebrow>GRAPH-BACKED AGENTS</Eyebrow>
        <h2
          className="mt-3 text-[40px] font-bold leading-none tracking-tight sm:text-[56px]"
          style={{ fontFamily: DISPLAY }}
        >
          Four agents. One shared model of you.
        </h2>
        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-neutral-600">
          Each agent has its own job, but they all read the same graph. None of
          them invents its own version of who you are.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-5 lg:grid-cols-[0.7fr_1.3fr]">
        <div className="space-y-3">
          {AGENTS.map((a) => {
            const on = a.id === id;
            return (
              <Reveal key={a.id}>
                <button
                  type="button"
                  onClick={() => setId(a.id)}
                  aria-pressed={on}
                  className={`pw-btn flex w-full items-center gap-3 rounded-xl p-4 text-left ${focus}`}
                  style={
                    {
                      ...border,
                      "--sh": "3px",
                      backgroundColor: on ? YELLOW : "#fff",
                    } as CSSProperties
                  }
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                    style={{
                      ...border,
                      backgroundColor: on ? "#fff" : SOFT,
                    }}
                  >
                    <a.icon size={17} />
                  </span>
                  <span>
                    <span
                      className="block text-[16px] font-bold"
                      style={{ fontFamily: DISPLAY }}
                    >
                      {a.name}
                    </span>
                    <span className="block text-[11px] font-semibold text-neutral-600">
                      {a.job}
                    </span>
                  </span>
                </button>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={80}>
          <Card className="h-full p-6 sm:p-8">
            <div key={agent.id} className="pw-fade">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-full"
                  style={{ ...border, backgroundColor: YELLOW }}
                >
                  <agent.icon size={19} />
                </span>
                <h3
                  className="text-[26px] font-bold"
                  style={{ fontFamily: DISPLAY }}
                >
                  {agent.name}
                </h3>
              </div>
              <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-neutral-600">
                {agent.body}
              </p>

              <div className="mt-6 grid gap-2.5 sm:grid-cols-3">
                {agent.outputs.map((o) => (
                  <div
                    key={o}
                    className="rounded-xl p-3 text-[12px] font-bold leading-snug"
                    style={{ border: `1.5px solid ${LINE}` }}
                  >
                    <Check size={13} className="mb-1.5" />
                    {o}
                  </div>
                ))}
              </div>

              <div
                className="mt-6 rounded-xl p-4"
                style={{ ...border, backgroundColor: SOFT }}
              >
                <div
                  className="text-[10px] font-bold text-neutral-500"
                  style={{ fontFamily: MONO }}
                >
                  EXAMPLE OUTPUT
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed">
                  {agent.sample}
                </p>
              </div>
            </div>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* GOAL -> MISSION                                                            */
/* -------------------------------------------------------------------------- */

const GOALS: Record<
  string,
  { required: string[]; gap: string; mission: string; reason: string }
> = {
  "Backend Engineer": {
    required: [
      "API Design & Security",
      "Async Processing",
      "Concurrency & Consistency",
      "Data Layer Engineering",
      "Reliability & Resilience",
    ],
    gap: "Job queues & workers",
    mission: "Build a durable background job queue",
    reason:
      "Your graph has strong data-layer and reliability evidence, but only one asynchronous-processing demonstration. Queue and worker work is the next connected capability gap.",
  },
  "Distributed Systems": {
    required: [
      "Async Processing",
      "Concurrency & Consistency",
      "Reliability & Resilience",
    ],
    gap: "Distributed locking",
    mission: "Implement a distributed lock with failure recovery",
    reason:
      "You have concurrency evidence, but the graph shows no demonstrated distributed-locking work yet.",
  },
  "AI Engineer": {
    required: [
      "API Design & Security",
      "Async Processing",
      "Data Layer Engineering",
    ],
    gap: "Async inference workers",
    mission: "Ship an async inference worker pipeline",
    reason:
      "The goal needs reliable asynchronous execution, and your graph has limited evidence around worker-based processing.",
  },
};

function GoalToMission() {
  const [goal, setGoal] = useState("Backend Engineer");
  const current = GOALS[goal];

  return (
    <section
      className="px-5 py-24 sm:px-6"
      style={{ borderBlock: `2px solid ${INK}`, backgroundColor: SOFT }}
    >
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <Reveal>
          <Eyebrow>GOAL → GAP → MISSION</Eyebrow>
          <h2
            className="mt-3 text-[40px] font-bold leading-none tracking-tight sm:text-[56px]"
            style={{ fontFamily: DISPLAY }}
          >
            Same code. Different goal. Different next move.
          </h2>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-neutral-600">
            Pathway compares what your goal requires against what your code has
            demonstrated, then follows prerequisites and related capabilities to
            the gap that matters most. Change the goal and the reasoning changes
            with it.
          </p>

          <div className="mt-8 flex flex-wrap gap-2.5">
            {Object.keys(GOALS).map((item) => {
              const on = item === goal;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setGoal(item)}
                  aria-pressed={on}
                  className={`pw-btn rounded-full px-4 py-2 text-[12px] font-bold ${focus}`}
                  style={
                    {
                      ...border,
                      "--sh": "2px",
                      backgroundColor: on ? YELLOW : "#fff",
                    } as CSSProperties
                  }
                >
                  {item}
                </button>
              );
            })}
          </div>
        </Reveal>

        <Reveal delay={80}>
          <Card className="p-6 sm:p-8">
            <div key={goal} className="pw-fade">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div
                    className="text-[10px] font-bold text-neutral-400"
                    style={{ fontFamily: MONO }}
                  >
                    SELECTED GOAL
                  </div>
                  <div
                    className="mt-1 text-[24px] font-bold"
                    style={{ fontFamily: DISPLAY }}
                  >
                    {goal}
                  </div>
                </div>
                <Target size={25} />
              </div>

              <div className="mt-7">
                <div
                  className="text-[10px] font-bold text-neutral-400"
                  style={{ fontFamily: MONO }}
                >
                  GOAL REQUIRES
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {current.required.map((item) => (
                    <span
                      key={item}
                      className="rounded-full px-3 py-1.5 text-[11px] font-semibold"
                      style={{
                        border: `1.5px solid ${INK}`,
                        backgroundColor:
                          item === "Async Processing" ? YELLOW : "#fff",
                      }}
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="my-7 border-t" style={{ borderColor: LINE }} />

              <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
                <div>
                  <div
                    className="text-[10px] font-bold text-neutral-400"
                    style={{ fontFamily: MONO }}
                  >
                    GRAPH GAP
                  </div>
                  <div
                    className="mt-2 text-[18px] font-bold"
                    style={{ fontFamily: DISPLAY }}
                  >
                    {current.gap}
                  </div>
                  <span
                    className="mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-bold"
                    style={{ ...border, backgroundColor: YELLOW }}
                  >
                    UNDERDEMONSTRATED
                  </span>
                </div>

                <div
                  className="rounded-xl p-4"
                  style={{ ...border, backgroundColor: SOFT }}
                >
                  <div className="flex items-center gap-2 text-[10px] font-bold text-neutral-500">
                    <Zap size={12} />
                    WHY THIS
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed">
                    {current.reason}
                  </p>
                  <p className="mt-3 text-[11px] font-bold">
                    → {current.mission}
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* VERIFICATION                                                               */
/* -------------------------------------------------------------------------- */

const STATES = [
  {
    id: "assigned",
    label: "Assigned",
    badge: "MISSION ASSIGNED",
    title: "A mission is planned. Nothing is proven.",
    body: "Pathway hands you a bounded task with scope, files and acceptance criteria. Assignment adds no evidence to your graph.",
    effect: "Graph unchanged",
  },
  {
    id: "evaluated",
    label: "Evaluated",
    badge: "SUBMISSION EVALUATED",
    title: "Your code is checked. Still not proof.",
    body: "The submission is evaluated against the mission's requirements. Being evaluated does not automatically make it verified.",
    effect: "Graph unchanged",
  },
  {
    id: "verified",
    label: "Verified",
    badge: "VERIFIED",
    title: "Verified work becomes a demonstration.",
    body: "Once acceptance criteria and verification evidence pass, the demonstration is recorded and related assessments refresh. This is the only path to new proof.",
    effect: "New demonstration added",
  },
  {
    id: "retracted",
    label: "Retracted",
    badge: "RETRACTED",
    title: "If the evidence changes, so does the graph.",
    body: "A later submission that fails verification retracts the demonstration and marks related assessments stale. Pathway does not stack up positive claims forever.",
    effect: "Demonstration retracted, assessments stale",
  },
];

const LOOP = [
  "Observe",
  "Model",
  "Investigate",
  "Plan",
  "Implement",
  "Verify",
  "Update",
];

function Verification() {
  const [sid, setSid] = useState("verified");
  const state = STATES.find((s) => s.id === sid) ?? STATES[2];
  const good = sid === "verified";
  const bad = sid === "retracted";

  return (
    <section id="verify" className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
      <Reveal className="max-w-4xl">
        <Eyebrow>VERIFIED, NOT ASSUMED</Eyebrow>
        <h2
          className="mt-3 text-[40px] font-bold leading-none tracking-tight sm:text-[56px]"
          style={{ fontFamily: DISPLAY }}
        >
          Not “learn queues.” Ship this, prove it, and the graph updates.
        </h2>
        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-neutral-600">
          Missions end in real engineering work: an issue, a contribution, a
          focused implementation. Pathway tracks four honest states, and only
          one of them adds to what you have proven.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <Reveal>
          <Card className="p-7 sm:p-9">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-bold"
                style={{
                  ...border,
                  backgroundColor: good ? GREEN : bad ? "#F0776B" : YELLOW,
                  color: good ? "#fff" : INK,
                }}
              >
                {state.badge}
              </span>
              <span
                className="text-[11px] text-neutral-400"
                style={{ fontFamily: MONO }}
              >
                mission · build a durable job queue
              </span>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {STATES.map((s) => {
                const on = s.id === sid;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSid(s.id)}
                    aria-pressed={on}
                    className={`pw-btn rounded-full px-4 py-2 text-[12px] font-bold ${focus}`}
                    style={
                      {
                        ...border,
                        "--sh": "2px",
                        backgroundColor: on ? YELLOW : "#fff",
                      } as CSSProperties
                    }
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>

            <div key={state.id} className="pw-fade">
              <h3
                className="mt-6 text-[28px] font-bold leading-tight"
                style={{ fontFamily: DISPLAY }}
              >
                {state.title}
              </h3>
              <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-neutral-600">
                {state.body}
              </p>

              <div
                className="mt-6 flex items-center gap-3 rounded-xl p-4"
                style={{ ...border, backgroundColor: SOFT }}
              >
                {bad ? <RefreshCw size={16} /> : <ShieldCheck size={16} />}
                <div>
                  <div
                    className="text-[10px] font-bold text-neutral-500"
                    style={{ fontFamily: MONO }}
                  >
                    EFFECT ON YOUR GRAPH
                  </div>
                  <div className="text-[13px] font-bold">{state.effect}</div>
                </div>
              </div>
            </div>
          </Card>
        </Reveal>

        <Reveal delay={80}>
          <Card className="h-full p-6 sm:p-7">
            <div
              className="text-[10px] font-bold text-neutral-400"
              style={{ fontFamily: MONO }}
            >
              THE LOOP
            </div>
            <ol className="mt-5 space-y-3">
              {LOOP.map((step, i) => (
                <li key={step} className="flex items-center gap-3">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{
                      ...border,
                      backgroundColor: i >= 5 ? GREEN : YELLOW,
                      color: i >= 5 ? "#fff" : INK,
                      fontFamily: MONO,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    className="text-[16px] font-bold"
                    style={{ fontFamily: DISPLAY }}
                  >
                    {step}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-[12px] leading-relaxed text-neutral-600">
              Verified work feeds straight back into step one. Every loop makes
              the model of you more accurate.
            </p>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* WHY GRAPH                                                                  */
/* -------------------------------------------------------------------------- */

function WhyGraph() {
  const cards: Array<{ icon: LucideIcon; title: string; body: string }> = [
    {
      icon: Network,
      title: "Relationships",
      body: "Goals need capabilities. Capabilities build on prerequisites. Demonstrations point to evidence. The links are the knowledge.",
    },
    {
      icon: CircleDot,
      title: "Provenance",
      body: "Every conclusion traces to the code change that created the evidence. Click through to the commit.",
    },
    {
      icon: Route,
      title: "Traversal",
      body: "Move through prerequisite and related-capability edges instead of treating every skill as an island.",
    },
    {
      icon: Sparkles,
      title: "Honest about gaps",
      body: "Supported, inferred and unknown stay separate. Missing evidence is shown, never quietly counted as proof.",
    },
    {
      icon: GitBranch,
      title: "Living memory",
      body: "Ship again and the graph updates. No rebuilding a profile from scratch, no stale snapshots.",
    },
    {
      icon: RefreshCw,
      title: "Self-correcting",
      body: "When evidence changes, demonstrations are retracted and related assessments go stale. The graph can be wrong less over time.",
    },
  ];

  return (
    <section
      className="px-5 py-24 sm:px-6"
      style={{ borderBlock: `2px solid ${INK}`, backgroundColor: SOFT }}
    >
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <Eyebrow>WHY A GRAPH</Eyebrow>
        </Reveal>
        <div className="mt-3 grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <Reveal>
            <h2
              className="text-[40px] font-bold leading-none tracking-tight sm:text-[54px]"
              style={{ fontFamily: DISPLAY }}
            >
              A list tells you what.
              <br />A graph tells you why.
            </h2>
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((c, i) => (
              <Reveal key={c.title} delay={i * 70}>
                <Card className="h-full p-5">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full"
                    style={{ ...border, backgroundColor: YELLOW }}
                  >
                    <c.icon size={16} />
                  </span>
                  <h3
                    className="mt-4 text-[18px] font-bold"
                    style={{ fontFamily: DISPLAY }}
                  >
                    {c.title}
                  </h3>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-neutral-600">
                    {c.body}
                  </p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* COMPARE                                                                    */
/* -------------------------------------------------------------------------- */

const COMPARE: Array<[string, string]> = [
  [
    "Tracks commits and pull requests",
    "Connects implementation history to demonstrated capability",
  ],
  ["Shows technology lists", "Models capabilities and how they relate"],
  [
    "Displays isolated scores",
    "Gives evidence and graph context behind every assessment",
  ],
  [
    "Returns generic recommendations",
    "Investigates goals using your engineering context",
  ],
  [
    "Generates tasks from prompts",
    "Plans bounded missions with explicit requirements",
  ],
  [
    "Treats completion as progress",
    "Separates completed work from verified proof",
  ],
  ["Starts every chat cold", "Reuses a persistent, structured model of you"],
];

function Compare() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
      <Reveal className="max-w-3xl">
        <Eyebrow>WHAT MAKES IT DIFFERENT</Eyebrow>
        <h2
          className="mt-3 text-[40px] font-bold leading-none tracking-tight sm:text-[54px]"
          style={{ fontFamily: DISPLAY }}
        >
          Other tools count your work. Pathway understands it.
        </h2>
      </Reveal>

      <Reveal delay={80}>
        <div
          className="mt-12 overflow-hidden rounded-2xl bg-white"
          style={{ ...border, boxShadow: shadow(4) }}
        >
          <div
            className="grid grid-cols-2 text-[11px] font-bold"
            style={{ borderBottom: `2px solid ${INK}` }}
          >
            <div
              className="px-5 py-3 text-neutral-500"
              style={{ borderRight: `2px solid ${INK}`, fontFamily: MONO }}
            >
              CONVENTIONAL TOOLS
            </div>
            <div
              className="px-5 py-3"
              style={{ backgroundColor: YELLOW, fontFamily: MONO }}
            >
              PATHWAY
            </div>
          </div>
          {COMPARE.map(([a, b], i) => (
            <div
              key={a}
              className="grid grid-cols-2 text-[13px]"
              style={{
                borderBottom:
                  i < COMPARE.length - 1 ? `1.5px solid ${LINE}` : "none",
              }}
            >
              <div
                className="px-5 py-4 text-neutral-500"
                style={{ borderRight: `2px solid ${INK}` }}
              >
                {a}
              </div>
              <div className="px-5 py-4 font-bold">{b}</div>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={120}>
        <p className="mt-5 max-w-2xl text-[12px] leading-relaxed text-neutral-500">
          Pathway does not claim to read your mind. Its conclusions depend on
          the repositories, evidence, graph relationships and verification data
          available to it, and it tells you where that evidence runs out.
        </p>
      </Reveal>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* FINAL CTA + FOOTER                                                         */
/* -------------------------------------------------------------------------- */

function FinalCta() {
  return (
    <section className="px-5 pb-24 sm:px-6">
      <Reveal>
        <div
          className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl p-8 text-white sm:p-14"
          style={{ ...border, backgroundColor: INK, boxShadow: shadow(7) }}
        >
          <Circuit />
          <div className="relative max-w-3xl">
            <span
              className="inline-flex rounded-full px-3 py-1 text-[10px] font-bold"
              style={{ ...border, backgroundColor: YELLOW, color: INK }}
            >
              YOUR CODE IS THE STARTING POINT
            </span>
            <h2
              className="mt-5 text-[42px] font-bold leading-[0.95] tracking-tight sm:text-[64px]"
              style={{ fontFamily: DISPLAY }}
            >
              See what your code
              <br />
              actually proves.
            </h2>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-neutral-300">
              Connect GitHub and get a living, evidence-backed model of your
              engineering: what you are good at, how it connects, where the gaps
              are and the one thing to ship next.
            </p>
            <div className="mt-8">
              <Btn href={githubConnectUrl()} variant="accent" size="md">
                <FaGithub size={16} />
                Build my developer graph
              </Btn>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer
      className="px-5 py-10 sm:px-6"
      style={{ borderTop: `2px solid ${INK}` }}
    >
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <Mark />
            <span
              className="text-[16px] font-bold"
              style={{ fontFamily: DISPLAY }}
            >
              pathway.io
            </span>
          </div>
          <p className="mt-3 max-w-sm text-[12px] text-neutral-500">
            A living, graph-backed model of the engineering knowledge in your
            code. Understand the engineering behind your commits.
          </p>
        </div>

        <div className="flex flex-wrap gap-4 text-[12px] font-semibold">
          <a href="#how" className={`hover:underline ${focus}`}>
            How it works
          </a>
          <a href="#graph" className={`hover:underline ${focus}`}>
            The graph
          </a>
          <a href="#agents" className={`hover:underline ${focus}`}>
            Agents
          </a>
          <a href="#verify" className={`hover:underline ${focus}`}>
            Verification
          </a>
          <Link to="/graph" className={`hover:underline ${focus}`}>
            Live graph
          </Link>
        </div>
      </div>
    </footer>
  );
}

/* -------------------------------------------------------------------------- */
/* PRIMITIVES                                                                 */
/* -------------------------------------------------------------------------- */

function Eyebrow({
  children,
  dark = false,
}: {
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={`text-[10px] font-bold tracking-[0.18em] ${dark ? "text-neutral-500" : "text-neutral-400"}`}
      style={{ fontFamily: MONO }}
    >
      {children}
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`pw-card rounded-2xl bg-white ${className}`} style={border}>
      {children}
    </div>
  );
}

function Btn({
  href,
  onClick,
  variant,
  size = "md",
  children,
}: {
  href?: string;
  onClick?: () => void;
  variant: "accent" | "primary";
  size?: "sm" | "md";
  children: ReactNode;
}) {
  const style = {
    ...border,
    backgroundColor: variant === "accent" ? YELLOW : INK,
    color: variant === "accent" ? INK : "#fff",
  };
  const cls = `pw-btn inline-flex items-center gap-1.5 rounded-full font-bold text-[13px] ${
    size === "sm" ? "px-4 py-1.5" : "px-6 py-3"
  } ${focus}`;

  return href ? (
    <a href={href} style={style} className={cls}>
      {children}
    </a>
  ) : (
    <button type="button" onClick={onClick} style={style} className={cls}>
      {children}
    </button>
  );
}

function Circuit() {
  return (
    <svg
      className="pointer-events-none absolute -right-6 -top-6 h-52 w-52 opacity-25"
      viewBox="0 0 160 160"
      fill="none"
      aria-hidden="true"
    >
      <path d="M20 0V60H80V160" stroke={YELLOW} strokeWidth="1.5" />
      <path d="M60 0V30H160" stroke={YELLOW} strokeWidth="1.5" />
      <path d="M100 0V90H140V160" stroke={YELLOW} strokeWidth="1.5" />
      <circle cx="20" cy="60" r="3" fill={YELLOW} />
      <circle cx="80" cy="160" r="3" fill={YELLOW} />
      <circle cx="100" cy="90" r="3" fill={YELLOW} />
    </svg>
  );
}

function Mark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="5" cy="19" r="2.4" fill={INK} />
      <circle cx="19" cy="5" r="2.4" fill={INK} />
      <circle cx="19" cy="19" r="2.4" fill={YELLOW} />
      <path d="M5 19L19 5M19 19L5 19" stroke={INK} strokeWidth="1.6" />
    </svg>
  );
}
