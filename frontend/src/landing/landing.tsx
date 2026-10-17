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
  ChevronDown,
  CircleDot,
  GitBranch,
  GitPullRequest,
  Goal,
  Network,
  Route,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { githubConnectUrl } from "../lib/api";
import { FaGithub } from "react-icons/fa";

/* -------------------------------------------------------------------------- */
/* TOKENS                                                                     */
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
const ease =
  "transition-all duration-300 ease-out motion-reduce:transition-none";

/* -------------------------------------------------------------------------- */
/* GLOBAL MOTION CSS                                                          */
/* -------------------------------------------------------------------------- */

const CSS = `
html { scroll-behavior: smooth; }
section[id], div[id="top"] { scroll-margin-top: 72px; }

:root {
  --pw-ease: cubic-bezier(.22,1,.36,1);
  --pw-spring: cubic-bezier(.34,1.56,.64,1);
}

/* ---------- scroll reveal ---------- */
.pw-reveal {
  opacity: 0;
  transform: translate3d(0, 28px, 0) scale(.985);
  transition: opacity .8s var(--pw-ease), transform .9s var(--pw-ease);
  transition-delay: var(--d, 0ms);
  will-change: opacity, transform;
}
.pw-reveal.pw-left { transform: translate3d(-32px, 0, 0); }
.pw-reveal.pw-right { transform: translate3d(32px, 0, 0); }
.pw-reveal.pw-pop { transform: scale(.88); }
.pw-reveal.pw-in { opacity: 1; transform: none; }

/* ---------- headline word rise ---------- */
.pw-word { display: inline-block; overflow: hidden; vertical-align: top; padding-bottom: .12em; margin-bottom: -.12em; }
.pw-word > span {
  display: inline-block;
  transform: translateY(110%) rotate(3deg);
  animation: pw-rise .9s var(--pw-ease) forwards;
  animation-delay: var(--d, 0ms);
}
@keyframes pw-rise { to { transform: translateY(0) rotate(0); } }

/* ---------- entrance ---------- */
.pw-fade-up { opacity: 0; animation: pw-fade-up .9s var(--pw-ease) forwards; animation-delay: var(--d, 0ms); }
@keyframes pw-fade-up { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: none; } }

/* ---------- press-feel buttons ---------- */
.pw-btn {
  --sh: 3px;
  position: relative;
  box-shadow: var(--sh) var(--sh) 0 0 ${INK};
  transform: translate(0, 0);
  transition: transform .18s var(--pw-ease), box-shadow .18s var(--pw-ease), background-color .2s ease;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}
.pw-btn:active {
  transform: translate(var(--sh), var(--sh));
  box-shadow: 0 0 0 0 ${INK};
  transition-duration: .06s;
}
.pw-btn .pw-arrow { transition: transform .25s var(--pw-ease); }

/* flat pill press (no shadow, for chips/tabs) */
.pw-chip { transition: transform .2s var(--pw-spring), background-color .25s ease, box-shadow .25s ease; }
.pw-chip:active { transform: translateY(1px) scale(.95); transition-duration: .06s; }

/* ---------- cards ---------- */
.pw-card {
  box-shadow: 3px 3px 0 0 ${INK};
  transition: transform .35s var(--pw-ease), box-shadow .35s var(--pw-ease);
}
.pw-card.pw-lift:hover { transform: translate(-3px, -3px); box-shadow: 6px 6px 0 0 ${INK}; }
.pw-card.pw-lift:active { transform: translate(1px, 1px); box-shadow: 2px 2px 0 0 ${INK}; transition-duration: .08s; }

/* ---------- progress bar ---------- */
.pw-progress { position: fixed; top: 0; left: 0; right: 0; height: 4px; z-index: 60; transform-origin: 0 50%; transform: scaleX(0); background: ${YELLOW}; border-bottom: 1px solid ${INK}; }

/* ---------- floating ---------- */
@keyframes pw-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.pw-float { animation: pw-float 4.5s ease-in-out infinite; }

/* ---------- graph draw + pop ---------- */
.pw-draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: pw-draw 1.1s var(--pw-ease) forwards; animation-delay: var(--d, 0ms); }
@keyframes pw-draw { to { stroke-dashoffset: 0; } }
.pw-node { opacity: 0; transform-box: fill-box; transform-origin: center; animation: pw-node .7s var(--pw-spring) forwards; animation-delay: var(--d, 0ms); }
@keyframes pw-node { from { opacity: 0; transform: scale(.2); } to { opacity: 1; transform: scale(1); } }
@keyframes pw-ping { 0% { transform: scale(1); opacity: .7; } 100% { transform: scale(2.1); opacity: 0; } }
.pw-ping { transform-box: fill-box; transform-origin: center; animation: pw-ping 2s ease-out infinite; }
@keyframes pw-dash { to { stroke-dashoffset: -20; } }
.pw-flow { stroke-dasharray: 5 5; animation: pw-dash 1s linear infinite; }

/* ---------- swap (goal change) ---------- */
@keyframes pw-swap { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
.pw-swap { animation: pw-swap .5s var(--pw-ease) both; animation-delay: var(--d, 0ms); }
@keyframes pw-pop-in { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: scale(1); } }
.pw-pop-in { animation: pw-pop-in .5s var(--pw-spring) both; animation-delay: var(--d, 0ms); }

/* ---------- circuit ---------- */
@keyframes pw-circuit { to { stroke-dashoffset: -60; } }
.pw-circuit path { stroke-dasharray: 6 8; animation: pw-circuit 3s linear infinite; }

/* ---------- blink dot ---------- */
@keyframes pw-blink { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
.pw-blink { animation: pw-blink 1.6s ease-in-out infinite; }

/* ---------- nav underline ---------- */
.pw-link { position: relative; }
.pw-link::after { content: ""; position: absolute; left: 12px; right: 12px; bottom: 4px; height: 2px; background: ${INK}; transform: scaleX(0); transform-origin: left; transition: transform .3s var(--pw-ease); }
.pw-link:hover::after { transform: scaleX(1); }

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .pw-reveal, .pw-word > span, .pw-fade-up, .pw-draw, .pw-node, .pw-swap, .pw-pop-in { opacity: 1 !important; transform: none !important; animation: none !important; transition: none !important; stroke-dashoffset: 0 !important; }
  .pw-float, .pw-ping, .pw-flow, .pw-circuit path, .pw-blink { animation: none !important; }
}
`;

/* -------------------------------------------------------------------------- */
/* HOOKS                                                                      */
/* -------------------------------------------------------------------------- */

function useInView<T extends HTMLElement>(threshold = 0.15) {
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
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

function Reveal({
  children,
  delay = 0,
  from = "up",
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  from?: "up" | "left" | "right" | "pop";
  className?: string;
}) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const dir =
    from === "left"
      ? "pw-left"
      : from === "right"
        ? "pw-right"
        : from === "pop"
          ? "pw-pop"
          : "";
  return (
    <div
      ref={ref}
      className={`pw-reveal ${dir} ${seen ? "pw-in" : ""} ${className}`}
      style={{ "--d": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

function CountUp({ to, duration = 1300 }: { to: number; duration?: number }) {
  const [ref, seen] = useInView<HTMLSpanElement>(0.4);
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!seen) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setV(Math.round((1 - Math.pow(1 - p, 4)) * to));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, to, duration]);
  return <span ref={ref}>{v}</span>;
}

function Headline({
  text,
  baseDelay = 0,
  step = 70,
}: {
  text: string;
  baseDelay?: number;
  step?: number;
}) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span key={i} className="pw-word">
          <span style={{ "--d": `${baseDelay + i * step}ms` } as CSSProperties}>
            {w}&nbsp;
          </span>
        </span>
      ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* DATA                                                                       */
/* -------------------------------------------------------------------------- */

const faqs = [
  {
    q: "What does Pathway actually learn from GitHub?",
    a: "Pathway turns your authored code into evidence-backed demonstrations. A demonstration points to the capability it proves and the file change that produced the evidence, so recommendations can be traced back to real work.",
  },
  {
    q: "Is this just another GitHub activity dashboard?",
    a: "No. Activity is only the input. The useful part is the graph reasoning: Pathway connects your demonstrated capabilities to a goal, finds underdeveloped areas, and uses those gaps to choose what you should build next.",
  },
  {
    q: "How does it choose a next mission?",
    a: "The graph first narrows the search using your goal, required capabilities, evidence strength, prerequisites and related capabilities. The mission layer can then connect the gap to a real contribution instead of inventing a generic learning task.",
  },
  {
    q: "Why use a graph?",
    a: "Because developer capability is connected. A graph can represent evidence, capabilities, prerequisites, goals, repositories and contributions as relationships and traverse those relationships when deciding what comes next.",
  },
  {
    q: "Do I have to self-report my skills?",
    a: "No. Self-reported skills can be useful context, but Pathway's core profile is based on what your code demonstrates.",
  },
];

/* -------------------------------------------------------------------------- */
/* PAGE                                                                       */
/* -------------------------------------------------------------------------- */

export default function PathwayLanding() {
  return (
    <div
      id="top"
      className="min-h-screen overflow-x-clip bg-white"
      style={{ fontFamily: BODY, color: INK }}
    >
      <style>{CSS}</style>
      <ScrollProgress />
      <Nav />
      <Hero />
      <Problem />
      <HowItWorks />
      <EvidenceGraph />
      <GoalToMission />
      <MissionPreview />
      <WhyGraph />
      <Faq />
      <FinalCta />
      <Footer />
    </div>
  );
}

function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const p = max > 0 ? h.scrollTop / max : 0;
      if (ref.current) ref.current.style.transform = `scaleX(${p})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return <div ref={ref} className="pw-progress" aria-hidden />;
}

/* -------------------------------------------------------------------------- */
/* NAV                                                                        */
/* -------------------------------------------------------------------------- */

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className="sticky top-0 z-40 backdrop-blur transition-all duration-300"
      style={{
        borderBottom: `2px solid ${INK}`,
        backgroundColor: scrolled
          ? "rgba(255,255,255,.96)"
          : "rgba(255,255,255,.85)",
        boxShadow: scrolled ? "0 6px 0 -4px rgba(16,18,16,.12)" : "none",
      }}
    >
      <div
        className="mx-auto flex max-w-7xl items-center justify-between px-5 sm:px-6"
        style={{
          paddingBlock: scrolled ? 8 : 14,
          transition: "padding .3s cubic-bezier(.22,1,.36,1)",
        }}
      >
        <a href="#top" className={`group flex items-center gap-2 ${focus}`}>
          <span className="transition-transform duration-500 group-hover:rotate-[360deg]">
            <Mark />
          </span>
          <span
            className="text-[18px] font-bold tracking-tight"
            style={{ fontFamily: DISPLAY }}
          >
            pathway.io
          </span>
        </a>

        <nav className="hidden items-center gap-1 text-[13px] font-medium md:flex">
          {[
            ["How it works", "#how"],
            ["Evidence graph", "#graph"],
            ["Mission", "#mission"],
            ["FAQ", "#faq"],
          ].map(([label, href]) => (
            <a
              key={label}
              href={href}
              className={`pw-link rounded-full px-3 py-1.5 text-neutral-500 hover:text-neutral-900 ${ease} ${focus}`}
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
    <section className="relative overflow-hidden px-5 pb-20 pt-14 sm:px-6 md:pt-20">
      {/* soft background dots */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[.5]"
        style={{
          backgroundImage: `radial-gradient(${INK} 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
          maskImage:
            "radial-gradient(ellipse at 70% 30%, rgba(0,0,0,.22), transparent 65%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 70% 30%, rgba(0,0,0,.22), transparent 65%)",
        }}
      />
      <div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <span
            className="pw-fade-up inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
            style={
              {
                ...border,
                backgroundColor: YELLOW,
                "--d": "0ms",
              } as CSSProperties
            }
          >
            <Sparkles size={12} />
            Developer memory → next mission
          </span>

          <h1
            className="mt-5 max-w-3xl text-[50px] font-bold leading-[0.94] tracking-tight sm:text-[70px] lg:text-[78px]"
            style={{ fontFamily: DISPLAY }}
          >
            <Headline
              text="Stop guessing what to build next."
              baseDelay={120}
            />
          </h1>

          <p
            className="pw-fade-up mt-6 max-w-xl text-[17px] leading-relaxed text-neutral-600"
            style={{ "--d": "700ms" } as CSSProperties}
          >
            Pathway learns what you have actually demonstrated in code, maps it
            against where you want to go, and turns the gap into a concrete
            engineering mission.
          </p>

          <div
            className="pw-fade-up mt-8 flex flex-wrap items-center gap-5"
            style={{ "--d": "850ms" } as CSSProperties}
          >
            <Btn href={githubConnectUrl()} variant="primary" size="md">
              <FaGithub size={16} />
              Build my developer graph
            </Btn>
            <Link
              to="/graph"
              className={`group inline-flex items-center gap-1.5 text-[13px] font-bold underline underline-offset-4 ${focus}`}
            >
              Explore the graph
              <ArrowRight size={14} />
            </Link>
          </div>

          <div
            className="pw-fade-up mt-10 flex flex-wrap gap-x-7 gap-y-3 text-[12px] font-semibold text-neutral-500"
            style={{ "--d": "1000ms" } as CSSProperties}
          >
            <span className="flex items-center gap-2">
              <span
                className="pw-blink h-2 w-2 rounded-full"
                style={{ backgroundColor: GREEN }}
              />
              Evidence-backed
            </span>
            <span className="flex items-center gap-2">
              <span
                className="pw-blink h-2 w-2 rounded-full"
                style={{ backgroundColor: YELLOW, animationDelay: ".3s" }}
              />
              Goal-driven
            </span>
            <span className="flex items-center gap-2">
              <span
                className="pw-blink h-2 w-2 rounded-full bg-black"
                style={{ animationDelay: ".6s" }}
              />
              Graph-native
            </span>
          </div>
        </div>

        <div className="pw-fade-up" style={{ "--d": "400ms" } as CSSProperties}>
          <HeroProduct />
        </div>
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

function HeroProduct() {
  const [sel, setSel] = useState<string | null>("async");
  const [accepted, setAccepted] = useState(false);
  const active = HERO_LAYOUT.find((t) => t.id === sel) ?? null;
  const hasGap = !!active?.leaves.some((l) => l.gap);
  const total = HERO_TOPICS.reduce((s, t) => s + t.proofs, 0);
  const toggle = (id: string) => setSel((cur) => (cur === id ? null : id));
  const dim = (id: string) => (sel === null || sel === id ? 1 : 0.16);

  return (
    <div className="relative">
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
            <CountUp to={total} /> PROOFS FROM YOUR CODE
          </span>
        </div>

        {/* graph */}
        <div className="bg-[#111311] px-3 pb-2 pt-4 text-white sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold text-neutral-400">
              YOUR GITHUB → TOPICS → SKILLS
            </span>
            <span
              className="pw-pop-in rounded-full px-2 py-1 text-[10px] font-bold"
              style={
                {
                  backgroundColor: YELLOW,
                  color: INK,
                  "--d": "2000ms",
                } as CSSProperties
              }
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
            {/* ring guides */}
            <ellipse
              cx={HCX}
              cy={HCY}
              rx={135}
              ry={92}
              fill="none"
              stroke="#fff"
              strokeOpacity=".08"
              strokeDasharray="3 6"
            />
            <ellipse
              cx={HCX}
              cy={HCY}
              rx={275}
              ry={185}
              fill="none"
              stroke="#fff"
              strokeOpacity=".06"
              strokeDasharray="3 6"
            />

            {/* edges: account -> topic -> skill */}
            {HERO_LAYOUT.map((t, ti) => (
              <g
                key={`e-${t.id}`}
                style={{ opacity: dim(t.id), transition: "opacity .4s ease" }}
              >
                <line
                  x1={HCX}
                  y1={HCY}
                  x2={t.x}
                  y2={t.y}
                  pathLength={1}
                  stroke="#d8d5c8"
                  strokeWidth="2.2"
                  className="pw-draw"
                  style={{ "--d": `${250 + ti * 120}ms` } as CSSProperties}
                />
                {t.leaves.map((l, li) => (
                  <line
                    key={l.name}
                    x1={t.x}
                    y1={t.y}
                    x2={l.x}
                    y2={l.y}
                    pathLength={1}
                    stroke={l.gap ? YELLOW : "#8a8d85"}
                    strokeWidth={l.gap ? 2 : 1.4}
                    className={l.gap ? "pw-flow" : "pw-draw"}
                    style={
                      {
                        "--d": `${800 + ti * 120 + li * 90}ms`,
                      } as CSSProperties
                    }
                  />
                ))}
              </g>
            ))}

            {/* skill nodes */}
            {HERO_LAYOUT.map((t, ti) =>
              t.leaves.map((l, li) => {
                const right = l.x > HCX + 30;
                const left = l.x < HCX - 30;
                const above = l.y < HCY;
                const tx = right ? l.x + 13 : left ? l.x - 13 : l.x;
                const ty =
                  right || left ? l.y + 3.5 : above ? l.y - 13 : l.y + 21;
                return (
                  <g
                    key={`${t.id}-${l.name}`}
                    style={{
                      opacity: dim(t.id),
                      transition: "opacity .4s ease",
                    }}
                  >
                    <g
                      className="pw-node"
                      style={
                        {
                          "--d": `${1000 + ti * 120 + li * 90}ms`,
                          cursor: "pointer",
                        } as CSSProperties
                      }
                      onClick={() => toggle(t.id)}
                    >
                      {l.gap && (
                        <circle
                          cx={l.x}
                          cy={l.y}
                          r={8}
                          fill="none"
                          stroke={YELLOW}
                          strokeWidth="2"
                          className="pw-ping"
                        />
                      )}
                      <circle
                        cx={l.x}
                        cy={l.y}
                        r={8}
                        fill={l.gap ? YELLOW : "#e8e4d6"}
                        stroke={l.gap ? "#fff" : INK}
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
                        fill={l.gap ? YELLOW : "#e8e4d6"}
                        style={{
                          paintOrder: "stroke",
                          stroke: "#111311",
                          strokeWidth: 3,
                          strokeLinejoin: "round",
                        }}
                      >
                        {l.name}
                        {l.gap ? " · gap" : ""}
                      </text>
                    </g>
                  </g>
                );
              }),
            )}

            {/* topic nodes */}
            {HERO_LAYOUT.map((t, ti) => {
              const gap = t.leaves.some((l) => l.gap);
              const on = sel === t.id;
              return (
                <g
                  key={t.id}
                  style={{ opacity: dim(t.id), transition: "opacity .4s ease" }}
                >
                  <g
                    className="pw-node"
                    tabIndex={0}
                    role="button"
                    aria-pressed={on}
                    aria-label={`${t.name}, ${t.proofs} proofs`}
                    onClick={() => toggle(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle(t.id);
                      }
                    }}
                    style={
                      {
                        "--d": `${500 + ti * 120}ms`,
                        cursor: "pointer",
                        outline: "none",
                      } as CSSProperties
                    }
                  >
                    {on && (
                      <circle
                        cx={t.x}
                        cy={t.y}
                        r={t.r + 7}
                        fill="none"
                        stroke={YELLOW}
                        strokeWidth="3"
                      />
                    )}
                    <circle
                      cx={t.x}
                      cy={t.y}
                      r={t.r}
                      fill={gap ? YELLOW : "#ffffff"}
                      stroke={INK}
                      strokeWidth="3"
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
                      fill="#ffffff"
                      style={{
                        paintOrder: "stroke",
                        stroke: "#111311",
                        strokeWidth: 4,
                        strokeLinejoin: "round",
                      }}
                    >
                      {t.name}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* account node (centre) */}
            <g className="pw-node" style={{ "--d": "0ms" } as CSSProperties}>
              <circle
                cx={HCX}
                cy={HCY}
                r={36}
                fill="none"
                stroke={GREEN}
                strokeWidth="2"
                className="pw-ping"
              />
              <circle
                cx={HCX}
                cy={HCY}
                r={36}
                fill={GREEN}
                stroke="#fff"
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
              <text
                x={HCX}
                y={HCY + 54}
                textAnchor="middle"
                fontSize="10"
                fontWeight={700}
                fontFamily={BODY}
                fill="#bdbab0"
              >
                Your GitHub account
              </text>
            </g>
          </svg>
        </div>

        {/* legend */}
        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5 text-[11px] font-semibold text-neutral-600"
          style={{ borderBlock: `2px solid ${INK}`, backgroundColor: SOFT }}
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
              style={{ backgroundColor: "#e8e4d6", border: `2px solid ${INK}` }}
            />
            Skill seen in code
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
          <div key={sel ?? "none"} className="pw-swap">
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
                      {l.gap ? " · missing" : ""}
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
      style={{ borderBottom: `2px solid ${INK}`, backgroundColor: SOFT }}
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <Reveal>
            <Eyebrow>THE PROBLEM</Eyebrow>
            <h2
              className="mt-3 text-[38px] font-bold leading-none tracking-tight sm:text-[52px]"
              style={{ fontFamily: DISPLAY }}
            >
              Your GitHub has the answer.
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="max-w-2xl text-[16px] leading-relaxed text-neutral-600">
              Most developer tools can tell you what you touched. Pathway asks a
              different question:{" "}
              <strong>
                what does your work prove, what does your goal require, and what
                should you build next?
              </strong>
            </p>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {[
            {
              number: "01",
              title: "Activity is not capability",
              body: "500 commits do not tell you which engineering capabilities you have actually demonstrated.",
            },
            {
              number: "02",
              title: "Skills are connected",
              body: "Async processing, concurrency, data layers and reliability are not isolated checklist items.",
            },
            {
              number: "03",
              title: "Learning needs a next action",
              body: "A gap is useful only when it becomes something concrete you can implement, review and ship.",
            },
          ].map((p, i) => (
            <Reveal key={p.number} delay={i * 120}>
              <ProblemCard {...p} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProblemCard({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <Card className="h-full p-6">
      <span
        className="text-[11px] font-bold text-neutral-400"
        style={{ fontFamily: MONO }}
      >
        {number}
      </span>
      <h3
        className="mt-7 text-[21px] font-bold leading-tight"
        style={{ fontFamily: DISPLAY }}
      >
        {title}
      </h3>
      <p className="mt-3 text-[13px] leading-relaxed text-neutral-600">
        {body}
      </p>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* HOW IT WORKS                                                               */
/* -------------------------------------------------------------------------- */

function HowItWorks() {
  const steps = [
    {
      icon: FaGithub,
      title: "Connect GitHub",
      body: "Read your repositories and authored changes through the GitHub integration.",
      chip: "SOURCE",
    },
    {
      icon: Brain,
      title: "Build evidence",
      body: "Turn code changes into demonstrations connected to capabilities and their provenance.",
      chip: "PROOF",
    },
    {
      icon: Goal,
      title: "Choose a goal",
      body: "Tell Pathway where you want to go. The graph maps the capabilities that goal requires.",
      chip: "DIRECTION",
    },
    {
      icon: Route,
      title: "Get one mission",
      body: "Pathway finds an underdeveloped capability and turns it into a concrete contribution.",
      chip: "ACTION",
    },
  ];

  const [ref, seen] = useInView<HTMLDivElement>(0.2);

  return (
    <section id="how" className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
      <Reveal>
        <Eyebrow>HOW IT WORKS</Eyebrow>
        <h2
          className="mt-3 max-w-3xl text-[40px] font-bold leading-none tracking-tight sm:text-[56px]"
          style={{ fontFamily: DISPLAY }}
        >
          From what you shipped to what you should ship next.
        </h2>
      </Reveal>

      <div ref={ref} className="relative mt-14 grid gap-5 md:grid-cols-4">
        <div
          className="absolute left-[12%] right-[12%] top-7 hidden h-0 border-t-2 border-dashed md:block"
          style={{
            borderColor: INK,
            transformOrigin: "left",
            transform: seen ? "scaleX(1)" : "scaleX(0)",
            transition: "transform 1.6s cubic-bezier(.22,1,.36,1) .3s",
            opacity: 0.35,
          }}
        />
        {steps.map((step, i) => (
          <Reveal key={step.title} delay={i * 140} className="relative">
            <div
              className="group relative z-10 flex h-14 w-14 items-center justify-center rounded-full transition-transform duration-300 hover:-rotate-6 hover:scale-110 active:scale-90"
              style={{
                ...border,
                backgroundColor: i === 3 ? GREEN : YELLOW,
                boxShadow: shadow(2),
              }}
            >
              <step.icon size={21} />
            </div>
            <Card className="mt-5 p-5">
              <span
                className="text-[10px] font-bold text-neutral-400"
                style={{ fontFamily: MONO }}
              >
                {String(i + 1).padStart(2, "0")} / {step.chip}
              </span>
              <h3
                className="mt-4 text-[20px] font-bold"
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
/* EVIDENCE GRAPH                                                             */
/* -------------------------------------------------------------------------- */

const FLOW: Array<[string, string, string]> = [
  ["Developer", "DEMONSTRATED", "Demonstration"],
  ["Demonstration", "OF_CAPABILITY", "Capability"],
  ["Demonstration", "EVIDENCED_BY", "FileChange"],
  ["FileChange", "CHANGED", "Commit"],
];

function EvidenceGraph() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(
      () => setActive((a) => (a + 1) % FLOW.length),
      2000,
    );
    return () => window.clearInterval(t);
  }, [paused]);

  return (
    <section
      id="graph"
      className="px-5 py-24 sm:px-6"
      style={{ borderBlock: `2px solid ${INK}`, backgroundColor: INK }}
    >
      <div className="mx-auto max-w-7xl text-white">
        <Reveal>
          <Eyebrow dark>THE EVIDENCE GRAPH</Eyebrow>
        </Reveal>
        <div className="mt-3 grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
          <Reveal delay={80}>
            <h2
              className="text-[40px] font-bold leading-none tracking-tight sm:text-[56px]"
              style={{ fontFamily: DISPLAY }}
            >
              Every capability has a trail back to code.
            </h2>
          </Reveal>
          <Reveal delay={200}>
            <p className="max-w-xl text-[15px] leading-relaxed text-neutral-400">
              Pathway does not stop at “you know Redis.” It can preserve the
              relationship between a developer, a demonstration, the capability
              it proves, and the file change that produced the evidence.
            </p>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <Reveal from="left">
            <div
              className="overflow-hidden rounded-2xl bg-[#171917] p-5 sm:p-7"
              style={{ ...border, boxShadow: `5px 5px 0 0 ${YELLOW}` }}
            >
              <GraphEvidenceVisual active={active} />
            </div>
          </Reveal>

          <div
            className="space-y-4"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            {FLOW.map(([a, rel, b], i) => {
              const on = active === i;
              return (
                <Reveal key={`${a}-${rel}-${b}`} delay={i * 110} from="right">
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
                        boxShadow: undefined,
                      } as CSSProperties
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold">
                      <span>{a}</span>
                      <span
                        className="rounded-full px-2 py-1 transition-colors duration-300"
                        style={{
                          backgroundColor: on ? "#fff" : SOFT,
                          fontFamily: MONO,
                        }}
                      >
                        {rel}
                      </span>
                      <ArrowRight size={13} className="pw-arrow" />
                      <span>{b}</span>
                    </div>
                  </button>
                </Reveal>
              );
            })}
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
          <path d="M0,0 L0,6 L7,3 z" fill="#F5C542" />
        </marker>
      </defs>

      <GraphLine
        on={active === 0}
        x1={105}
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
        on={active === 0 || active === 1 || active === 2}
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
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={YELLOW}
        strokeWidth={on ? 3.5 : 2}
        markerEnd="url(#arrow)"
        className={on ? "pw-flow" : ""}
        style={{
          opacity: on ? 1 : 0.35,
          transition: "opacity .4s ease, stroke-width .4s ease",
        }}
      />
      <text
        x={mx}
        y={my - 9}
        textAnchor="middle"
        fill={on ? "#fff" : "#999"}
        fontSize="9"
        fontFamily={MONO}
        style={{ transition: "fill .4s ease" }}
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
    <g
      style={{
        transformBox: "fill-box",
        transformOrigin: "center",
        transform: on ? "scale(1.08)" : "scale(1)",
        transition: "transform .5s cubic-bezier(.34,1.56,.64,1)",
      }}
    >
      {on && (
        <circle
          cx={x}
          cy={y}
          r="43"
          fill="none"
          stroke={YELLOW}
          strokeWidth="2"
          className="pw-ping"
        />
      )}
      <circle cx={x} cy={y} r="43" fill={fill} stroke={INK} strokeWidth="3" />
      <text
        x={x}
        y={y - 2}
        textAnchor="middle"
        fill={fill === INK ? "#fff" : INK}
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
        fill={fill === INK ? "#ddd" : "#555"}
        fontSize="8"
        fontFamily={MONO}
      >
        {sub}
      </text>
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* GOAL -> MISSION                                                            */
/* -------------------------------------------------------------------------- */

function GoalToMission() {
  const [goal, setGoal] = useState("Backend Engineer");
  const data: Record<
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
        "Your graph has strong data-layer and reliability evidence, but only one asynchronous-processing demonstration. Queue/worker work is the next connected capability gap.",
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

  const current = data[goal];

  return (
    <section className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <Reveal>
          <Eyebrow>GOAL → GAP → MISSION</Eyebrow>
          <h2
            className="mt-3 text-[40px] font-bold leading-none tracking-tight sm:text-[56px]"
            style={{ fontFamily: DISPLAY }}
          >
            Your next step depends on where you want to go.
          </h2>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-neutral-600">
            The same developer can need completely different next steps. Change
            the goal and the graph changes the reasoning.
          </p>

          <div className="mt-8 flex flex-wrap gap-2.5">
            {Object.keys(data).map((item) => {
              const active = item === goal;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setGoal(item)}
                  aria-pressed={active}
                  className={`pw-btn rounded-full px-4 py-2 text-[12px] font-bold ${focus}`}
                  style={
                    {
                      ...border,
                      "--sh": "2px",
                      backgroundColor: active ? YELLOW : "#fff",
                    } as CSSProperties
                  }
                >
                  {item}
                </button>
              );
            })}
          </div>
        </Reveal>

        <Reveal from="right" delay={120}>
          <Card className="p-6 sm:p-8" lift={false}>
            <div key={goal}>
              <div className="pw-swap flex items-center justify-between gap-3">
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
                  {current.required.map((item, i) => (
                    <span
                      key={item}
                      className="pw-pop-in rounded-full px-3 py-1.5 text-[11px] font-semibold"
                      style={
                        {
                          border: `1.5px solid ${INK}`,
                          backgroundColor:
                            item === current.gap || item === "Async Processing"
                              ? YELLOW
                              : "#fff",
                          "--d": `${i * 70}ms`,
                        } as CSSProperties
                      }
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="my-7 border-t" style={{ borderColor: LINE }} />

              <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
                <div
                  className="pw-swap"
                  style={{ "--d": "150ms" } as CSSProperties}
                >
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
                  className="pw-swap rounded-xl p-4"
                  style={
                    {
                      ...border,
                      backgroundColor: SOFT,
                      "--d": "250ms",
                    } as CSSProperties
                  }
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
/* MISSION PREVIEW                                                            */
/* -------------------------------------------------------------------------- */

function MissionPreview() {
  const [started, setStarted] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  return (
    <section
      id="mission"
      className="px-5 py-24 sm:px-6"
      style={{ borderBlock: `2px solid ${INK}`, backgroundColor: SOFT }}
    >
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-3xl">
          <Eyebrow>THE OUTPUT</Eyebrow>
          <h2
            className="mt-3 text-[40px] font-bold leading-none tracking-tight sm:text-[56px]"
            style={{ fontFamily: DISPLAY }}
          >
            Not “learn queues.”
            <br />
            <span className="underline decoration-4 underline-offset-4">
              Ship this.
            </span>
          </h2>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-neutral-600">
            Pathway should end in an action you can take in the real engineering
            world: a GitHub issue, contribution or focused implementation.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <Reveal from="left">
            <Card className="p-7 sm:p-9" lift={false}>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full px-2.5 py-1 text-[10px] font-bold"
                  style={{
                    ...border,
                    backgroundColor: started ? GREEN : YELLOW,
                    color: started ? "#fff" : INK,
                    transition: "background-color .3s ease",
                  }}
                >
                  {started ? "MISSION IN PROGRESS" : "RECOMMENDED MISSION"}
                </span>
                <span
                  className="text-[11px] text-neutral-400"
                  style={{ fontFamily: MONO }}
                >
                  github · issue #184
                </span>
              </div>

              <h3
                className="mt-5 text-[30px] font-bold leading-tight"
                style={{ fontFamily: DISPLAY }}
              >
                Build a durable background job queue
              </h3>

              <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-neutral-600">
                Add a worker-backed queue with retries, idempotency and failure
                handling. Keep the implementation small enough to review as one
                contribution.
              </p>

              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                <MissionMeta label="Closes" value="Async gap" />
                <MissionMeta label="Practices" value="Workers + retries" />
                <MissionMeta label="Proof" value="New evidence" />
              </div>

              <div className="mt-7 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setStarted((v) => !v)}
                  aria-pressed={started}
                  className={`pw-btn inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[12px] font-bold ${focus}`}
                  style={
                    {
                      ...border,
                      "--sh": "3px",
                      backgroundColor: started ? GREEN : INK,
                      color: "#fff",
                    } as CSSProperties
                  }
                >
                  {started ? (
                    <>
                      <Check size={14} /> Mission started
                    </>
                  ) : (
                    <>
                      Start mission
                      <ArrowRight size={14} className="pw-arrow" />
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowWhy((v) => !v)}
                  aria-expanded={showWhy}
                  className={`pw-btn inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[12px] font-bold ${focus}`}
                  style={{ ...border, "--sh": "3px" } as CSSProperties}
                >
                  View reasoning
                  <ChevronDown
                    size={14}
                    className={`${ease} ${showWhy ? "rotate-180" : ""}`}
                  />
                </button>
              </div>

              <div
                className={`grid ${ease} ${showWhy ? "mt-5 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
              >
                <div className="overflow-hidden">
                  <div
                    className="rounded-xl p-4 text-[12px] leading-relaxed"
                    style={{ ...border, backgroundColor: SOFT }}
                  >
                    Goal <b>Backend Engineer</b> requires asynchronous
                    processing. Your graph holds <b>1</b> async demonstration
                    against <b>26</b> data-layer ones, so queue and worker
                    evidence is the thinnest connected capability. A real issue
                    produces that missing proof.
                  </div>
                </div>
              </div>
            </Card>
          </Reveal>

          <div className="space-y-5">
            {[
              {
                n: "01",
                title: "Evidence",
                body: "Your graph shows exactly which demonstrations support the current capability profile.",
              },
              {
                n: "02",
                title: "Gap",
                body: "Goal requirements are compared against demonstrated capability depth and connected prerequisites.",
              },
              {
                n: "03",
                title: "Action",
                body: "A real issue becomes the vehicle for producing the missing evidence.",
              },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 130} from="right">
                <ReasonStep {...s} />
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function MissionMeta({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl p-3 transition-transform duration-300 hover:-translate-y-1"
      style={{ border: `1.5px solid ${LINE}` }}
    >
      <div
        className="text-[10px] font-bold text-neutral-400"
        style={{ fontFamily: MONO }}
      >
        {label}
      </div>
      <div className="mt-1 text-[12px] font-bold">{value}</div>
    </div>
  );
}

function ReasonStep({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <div
      className="pw-card pw-lift flex gap-4 rounded-2xl bg-white p-5"
      style={border}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ ...border, backgroundColor: YELLOW, fontFamily: MONO }}
      >
        {n}
      </span>
      <div>
        <h3 className="text-[18px] font-bold" style={{ fontFamily: DISPLAY }}>
          {title}
        </h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-600">
          {body}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* WHY GRAPH                                                                  */
/* -------------------------------------------------------------------------- */

function WhyGraph() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
      <Reveal>
        <Eyebrow>WHY A GRAPH</Eyebrow>
      </Reveal>
      <div className="mt-3 grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal delay={80}>
          <h2
            className="text-[40px] font-bold leading-none tracking-tight sm:text-[54px]"
            style={{ fontFamily: DISPLAY }}
          >
            A list tells you what.
            <br />A graph tells you why.
          </h2>
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              icon: Network,
              title: "Relationships",
              body: "Goals require capabilities. Capabilities have prerequisites. Demonstrations point to evidence. Those connections matter.",
            },
            {
              icon: CircleDot,
              title: "Provenance",
              body: "Recommendations can trace back to the code changes that created the underlying evidence.",
            },
            {
              icon: Route,
              title: "Traversal",
              body: "Pathway can move through prerequisite and related-capability edges instead of treating every skill as independent.",
            },
            {
              icon: GitBranch,
              title: "Living memory",
              body: "When you ship again, the graph can update rather than forcing you to rebuild a profile from scratch.",
            },
          ].map((c, i) => (
            <Reveal key={c.title} delay={i * 110} from="pop">
              <WhyCard {...c} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhyCard({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <Card className="group h-full p-5">
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-500 group-hover:rotate-[360deg] group-hover:scale-110"
        style={{ ...border, backgroundColor: YELLOW }}
      >
        <Icon size={16} />
      </span>
      <h3
        className="mt-4 text-[18px] font-bold"
        style={{ fontFamily: DISPLAY }}
      >
        {title}
      </h3>
      <p className="mt-2 text-[12.5px] leading-relaxed text-neutral-600">
        {body}
      </p>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* FAQ                                                                        */
/* -------------------------------------------------------------------------- */

function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section
      id="faq"
      className="px-5 py-24 sm:px-6"
      style={{ borderTop: `2px solid ${INK}` }}
    >
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.75fr_1.25fr]">
        <Reveal>
          <Eyebrow>FAQ</Eyebrow>
          <h2
            className="mt-3 text-[40px] font-bold leading-none tracking-tight sm:text-[54px]"
            style={{ fontFamily: DISPLAY }}
          >
            Built for developers who want to keep getting better.
          </h2>
        </Reveal>

        <div className="space-y-3">
          {faqs.map((faq, i) => {
            const active = open === i;
            return (
              <Reveal key={faq.q} delay={i * 80}>
                <div
                  className="overflow-hidden rounded-xl bg-white"
                  style={{
                    ...border,
                    boxShadow: active ? shadow(3) : shadow(0),
                    transform: active ? "translate(-1px,-1px)" : "none",
                    transition:
                      "box-shadow .35s cubic-bezier(.22,1,.36,1), transform .35s cubic-bezier(.22,1,.36,1)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setOpen(active ? null : i)}
                    aria-expanded={active}
                    className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors duration-200 active:bg-neutral-100 ${focus}`}
                  >
                    <span
                      className="text-[15px] font-bold"
                      style={{ fontFamily: DISPLAY }}
                    >
                      {faq.q}
                    </span>
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-300"
                      style={{
                        ...border,
                        backgroundColor: active ? YELLOW : "#fff",
                      }}
                    >
                      <ChevronDown
                        size={15}
                        className={`${ease} ${active ? "rotate-180" : ""}`}
                      />
                    </span>
                  </button>
                  <div
                    className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${active ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                  >
                    <div className="overflow-hidden">
                      <p className="px-5 pb-5 text-[13px] leading-relaxed text-neutral-600">
                        {faq.a}
                      </p>
                    </div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
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
              Build the graph.
              <br />
              Find the gap.
              <br />
              Ship the next thing.
            </h2>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-neutral-300">
              Connect GitHub and let Pathway turn your engineering history into
              a living map of evidence, goals and next actions.
            </p>
            <div className="mt-8">
              <Btn href={githubConnectUrl()} variant="accent" size="md">
                <FaGithub size={16} />
                Connect GitHub
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
            An AI developer-memory system that turns demonstrated capability
            into your next engineering mission.
          </p>
        </div>

        <div className="flex flex-wrap gap-4 text-[12px] font-semibold">
          <a href="#how" className={`hover:underline ${focus}`}>
            How it works
          </a>
          <a href="#graph" className={`hover:underline ${focus}`}>
            Evidence graph
          </a>
          <a href="#mission" className={`hover:underline ${focus}`}>
            Mission
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
  bg = "#fff",
  lift = true,
}: {
  children: ReactNode;
  className?: string;
  bg?: string;
  lift?: boolean;
}) {
  return (
    <div
      className={`pw-card ${lift ? "pw-lift" : ""} rounded-2xl ${className}`}
      style={{ ...border, backgroundColor: bg }}
    >
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
    size === "sm" ? "px-4 py-2" : "px-6 py-3"
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
      className="pw-circuit pointer-events-none absolute -right-6 -top-6 h-52 w-52 opacity-25"
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
      width="24"
      height="24"
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
