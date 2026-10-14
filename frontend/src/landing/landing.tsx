import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Brain,
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

const capabilities = [
  { name: "Data Layer Engineering", level: "strong", evidence: 26 },
  { name: "Reliability & Resilience", level: "strong", evidence: 24 },
  { name: "API Design & Security", level: "implementation", evidence: 8 },
  { name: "Concurrency & Consistency", level: "implementation", evidence: 3 },
  { name: "Asynchronous Processing", level: "implementation", evidence: 1 },
];

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

export default function PathwayLanding() {
  return (
    <div
      id="top"
      className="min-h-screen bg-white"
      style={{ fontFamily: BODY, color: INK }}
    >
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

function Nav() {
  return (
    <header
      className="sticky top-0 z-40 bg-white/90 backdrop-blur"
      style={{ borderBottom: `2px solid ${INK}` }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-6">
        <a href="#top" className={`flex items-center gap-2 ${focus}`}>
          <Mark />
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
              className={`rounded-full px-3 py-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 ${ease} ${focus}`}
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

function Hero() {
  return (
    <section className="overflow-hidden px-5 pb-20 pt-14 sm:px-6 md:pt-20">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
            style={{ ...border, backgroundColor: YELLOW }}
          >
            <Sparkles size={12} />
            Developer memory → next mission
          </span>

          <h1
            className="mt-5 max-w-3xl text-[50px] font-bold leading-[0.94] tracking-tight sm:text-[70px] lg:text-[78px]"
            style={{ fontFamily: DISPLAY }}
          >
            Stop guessing what to build next.
          </h1>

          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-neutral-600">
            Pathway learns what you have actually demonstrated in code, maps it
            against where you want to go, and turns the gap into a concrete
            engineering mission.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
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
            <span className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: GREEN }}
              />
              Evidence-backed
            </span>
            <span className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: YELLOW }}
              />
              Goal-driven
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-black" />
              Graph-native
            </span>
          </div>
        </div>

        <HeroProduct />
      </div>
    </section>
  );
}

function HeroProduct() {
  return (
    <div className="relative">
      <div
        className="overflow-hidden rounded-3xl bg-white"
        style={{ ...border, boxShadow: shadow(6) }}
      >
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
            pathway / developer / next
          </span>
          <span className="ml-auto hidden text-[10px] font-bold text-neutral-500 sm:block">
            GOAL · BACKEND ENGINEER
          </span>
        </div>

        <div className="grid md:grid-cols-[1.15fr_0.85fr]">
          <div className="min-h-[350px] bg-[#111311] p-5 text-white">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-neutral-400">
                CAPABILITY GRAPH
              </span>
              <span
                className="rounded-full px-2 py-1 text-[10px] font-bold"
                style={{ backgroundColor: YELLOW, color: INK }}
              >
                1 gap found
              </span>
            </div>
            <GraphPreview />
          </div>

          <div className="flex flex-col justify-between p-5">
            <div>
              <div className="text-[11px] font-semibold text-neutral-400">
                YOUR EVIDENCE
              </div>
              <div className="mt-3 space-y-2">
                {capabilities.slice(0, 3).map((c) => (
                  <div
                    key={c.name}
                    className="flex items-center justify-between rounded-lg px-3 py-2"
                    style={{ ...border, backgroundColor: "#fff" }}
                  >
                    <span className="max-w-[150px] text-[11px] font-bold">
                      {c.name}
                    </span>
                    <span
                      className="text-[10px] text-neutral-500"
                      style={{ fontFamily: MONO }}
                    >
                      {c.evidence} proofs
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="mt-6 rounded-xl p-4"
              style={{
                ...border,
                backgroundColor: YELLOW,
                boxShadow: shadow(3),
              }}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider">
                NEXT MISSION
              </div>
              <div
                className="mt-1 text-[18px] font-bold"
                style={{ fontFamily: DISPLAY }}
              >
                Build a job queue
              </div>
              <p className="mt-2 text-[11px] leading-relaxed">
                You have async processing evidence, but almost no queue/worker
                evidence. This contribution closes that gap.
              </p>
              <div className="mt-3 flex items-center gap-2 text-[10px] font-bold">
                <GitPullRequest size={12} />
                Real GitHub issue
                <ArrowRight size={11} />
                Personalized mission
              </div>
            </div>
          </div>
        </div>
      </div>

      <span
        className="absolute -bottom-4 -left-3 hidden rounded-full bg-white px-3 py-1.5 text-[11px] font-bold sm:flex"
        style={{ ...border, boxShadow: shadow(2) }}
      >
        <span
          className="mr-1.5 h-2 w-2 self-center rounded-full"
          style={{ backgroundColor: GREEN }}
        />
        63 demonstrations
      </span>
    </div>
  );
}

function GraphPreview() {
  const nodes = [
    { x: 48, y: 80, label: "Developer", type: "dev" },
    { x: 150, y: 45, label: "Data Layer", type: "strong" },
    { x: 150, y: 125, label: "Reliability", type: "strong" },
    { x: 255, y: 80, label: "Async", type: "mid" },
    { x: 345, y: 45, label: "Queues", type: "gap" },
    { x: 345, y: 125, label: "Workers", type: "gap" },
    { x: 255, y: 180, label: "Goal", type: "goal" },
  ];

  const byLabel = Object.fromEntries(nodes.map((n) => [n.label, n]));

  const links = [
    ["Developer", "Data Layer"],
    ["Developer", "Reliability"],
    ["Data Layer", "Async"],
    ["Reliability", "Async"],
    ["Async", "Queues"],
    ["Async", "Workers"],
    ["Goal", "Async"],
  ];

  return (
    <svg
      viewBox="0 0 400 230"
      className="mt-8 w-full"
      role="img"
      aria-label="Developer capability graph showing a gap between asynchronous processing and queue workers"
    >
      {links.map(([a, b]) => {
        const A = byLabel[a];
        const B = byLabel[b];
        return (
          <line
            key={`${a}-${b}`}
            x1={A.x}
            y1={A.y}
            x2={B.x}
            y2={B.y}
            stroke="#777"
            strokeWidth="1.5"
            strokeDasharray={a === "Async" || a === "Goal" ? "5 5" : "0"}
          />
        );
      })}

      {nodes.map((n) => {
        const fill =
          n.type === "gap"
            ? YELLOW
            : n.type === "goal"
              ? GREEN
              : n.type === "strong"
                ? "#ffffff"
                : n.type === "mid"
                  ? "#b8b8b8"
                  : "#101210";
        const text = n.type === "dev" ? "#ffffff" : INK;

        return (
          <g key={n.label}>
            <circle
              cx={n.x}
              cy={n.y}
              r={n.type === "dev" ? 24 : 19}
              fill={fill}
              stroke={n.type === "dev" ? YELLOW : "#ffffff"}
              strokeWidth="2"
            />
            <text
              x={n.x}
              y={n.y + 4}
              textAnchor="middle"
              fontSize="8"
              fontWeight="700"
              fill={text}
              fontFamily={MONO}
            >
              {n.type === "gap" ? "GAP" : n.type === "goal" ? "GOAL" : "✓"}
            </text>
            <text
              x={n.x}
              y={n.y + 34}
              textAnchor="middle"
              fontSize="10"
              fontWeight="700"
              fill="#ffffff"
              fontFamily={DISPLAY}
            >
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Problem() {
  return (
    <section
      className="px-5 py-20 sm:px-6"
      style={{ borderBlock: `2px solid ${INK}`, backgroundColor: SOFT }}
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <div>
            <Eyebrow>THE PROBLEM</Eyebrow>
            <h2
              className="mt-3 text-[38px] font-bold leading-none tracking-tight sm:text-[52px]"
              style={{ fontFamily: DISPLAY }}
            >
              Your GitHub has the answer.
            </h2>
          </div>
          <p className="max-w-2xl text-[16px] leading-relaxed text-neutral-600">
            Most developer tools can tell you what you touched. Pathway asks a
            different question:{" "}
            <strong>
              what does your work prove, what does your goal require, and what
              should you build next?
            </strong>
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          <ProblemCard
            number="01"
            title="Activity is not capability"
            body="500 commits do not tell you which engineering capabilities you have actually demonstrated."
          />
          <ProblemCard
            number="02"
            title="Skills are connected"
            body="Async processing, concurrency, data layers and reliability are not isolated checklist items."
          />
          <ProblemCard
            number="03"
            title="Learning needs a next action"
            body="A gap is useful only when it becomes something concrete you can implement, review and ship."
          />
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
    <Card className="p-6">
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

  return (
    <section id="how" className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
      <Eyebrow>HOW IT WORKS</Eyebrow>
      <h2
        className="mt-3 max-w-3xl text-[40px] font-bold leading-none tracking-tight sm:text-[56px]"
        style={{ fontFamily: DISPLAY }}
      >
        From what you shipped to what you should ship next.
      </h2>

      <div className="relative mt-14 grid gap-5 md:grid-cols-4">
        <div
          className="absolute left-[12%] right-[12%] top-7 hidden border-t-2 border-dashed md:block"
          style={{ borderColor: LINE }}
        />
        {steps.map((step, i) => (
          <div key={step.title} className="relative">
            <div
              className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full"
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
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidenceGraph() {
  return (
    <section
      id="graph"
      className="px-5 py-24 sm:px-6"
      style={{ borderBlock: `2px solid ${INK}`, backgroundColor: INK }}
    >
      <div className="mx-auto max-w-7xl text-white">
        <Eyebrow dark>THE EVIDENCE GRAPH</Eyebrow>
        <div className="mt-3 grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
          <h2
            className="text-[40px] font-bold leading-none tracking-tight sm:text-[56px]"
            style={{ fontFamily: DISPLAY }}
          >
            Every capability has a trail back to code.
          </h2>
          <p className="max-w-xl text-[15px] leading-relaxed text-neutral-400">
            Pathway does not stop at “you know Redis.” It can preserve the
            relationship between a developer, a demonstration, the capability it
            proves, and the file change that produced the evidence.
          </p>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <div
            className="overflow-hidden rounded-2xl bg-[#171917] p-5 sm:p-7"
            style={{ ...border, boxShadow: `5px 5px 0 0 ${YELLOW}` }}
          >
            <GraphEvidenceVisual />
          </div>

          <div className="space-y-4">
            {[
              ["Developer", "DEMONSTRATED", "Demonstration"],
              ["Demonstration", "OF_CAPABILITY", "Capability"],
              ["Demonstration", "EVIDENCED_BY", "FileChange"],
              ["FileChange", "CHANGED", "Commit"],
            ].map(([a, rel, b]) => (
              <div
                key={`${a}-${rel}-${b}`}
                className="rounded-xl p-4"
                style={{ ...border, backgroundColor: "#ffffff", color: INK }}
              >
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold">
                  <span>{a}</span>
                  <span
                    className="rounded-full px-2 py-1"
                    style={{ backgroundColor: SOFT, fontFamily: MONO }}
                  >
                    {rel}
                  </span>
                  <ArrowRight size={13} />
                  <span>{b}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function GraphEvidenceVisual() {
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

      <GraphLine x1={105} y1={100} x2={270} y2={100} label="DEMONSTRATED" />
      <GraphLine x1={370} y1={100} x2={535} y2={100} label="OF_CAPABILITY" />
      <GraphLine x1={320} y1={125} x2={220} y2={230} label="EVIDENCED_BY" />
      <GraphLine x1={220} y1={270} x2={385} y2={270} label="CHANGED" />

      <GraphNode x={70} y={100} title="Developer" sub="you" fill={GREEN} />
      <GraphNode
        x={320}
        y={100}
        title="Demonstration"
        sub="retry_with_backoff"
        fill="#fff"
      />
      <GraphNode
        x={585}
        y={100}
        title="Capability"
        sub="Reliability"
        fill={YELLOW}
      />
      <GraphNode
        x={170}
        y={250}
        title="FileChange"
        sub="worker.ts"
        fill="#fff"
      />
      <GraphNode x={435} y={250} title="Commit" sub="8f2c..." fill="#fff" />
    </svg>
  );
}

function GraphLine({
  x1,
  y1,
  x2,
  y2,
  label,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
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
        strokeWidth="2"
        markerEnd="url(#arrow)"
      />
      <text
        x={mx}
        y={my - 9}
        textAnchor="middle"
        fill="#999"
        fontSize="9"
        fontFamily={MONO}
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
}: {
  x: number;
  y: number;
  title: string;
  sub: string;
  fill: string;
}) {
  return (
    <g>
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
        <div>
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

          <div className="mt-8 flex flex-wrap gap-2">
            {Object.keys(data).map((item) => {
              const active = item === goal;
              return (
                <button
                  key={item}
                  onClick={() => setGoal(item)}
                  aria-pressed={active}
                  className={`rounded-full px-4 py-2 text-[12px] font-bold ${ease} ${focus}`}
                  style={{
                    ...border,
                    backgroundColor: active ? YELLOW : "#fff",
                    boxShadow: active ? shadow(2) : "none",
                  }}
                >
                  {item}
                </button>
              );
            })}
          </div>
        </div>

        <Card className="p-6 sm:p-8">
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
                      item === current.gap || item === "Async Processing"
                        ? YELLOW
                        : "#fff",
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
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}

function MissionPreview() {
  return (
    <section
      id="mission"
      className="px-5 py-24 sm:px-6"
      style={{ borderBlock: `2px solid ${INK}`, backgroundColor: SOFT }}
    >
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl">
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
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <Card className="p-7 sm:p-9">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-bold"
                style={{ ...border, backgroundColor: YELLOW }}
              >
                RECOMMENDED MISSION
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
                className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[12px] font-bold ${focus}`}
                style={{
                  ...border,
                  backgroundColor: INK,
                  color: "#fff",
                  boxShadow: shadow(2),
                }}
              >
                Start mission
                <ArrowRight size={14} />
              </button>
              <button
                className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[12px] font-bold ${focus}`}
                style={border}
              >
                View reasoning
              </button>
            </div>
          </Card>

          <div className="space-y-5">
            <ReasonStep
              n="01"
              title="Evidence"
              body="Your graph shows exactly which demonstrations support the current capability profile."
            />
            <ReasonStep
              n="02"
              title="Gap"
              body="Goal requirements are compared against demonstrated capability depth and connected prerequisites."
            />
            <ReasonStep
              n="03"
              title="Action"
              body="A real issue becomes the vehicle for producing the missing evidence."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function MissionMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ border: `1.5px solid ${LINE}` }}>
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
    <div className="flex gap-4 rounded-2xl bg-white p-5" style={border}>
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

function WhyGraph() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
      <Eyebrow>WHY A GRAPH</Eyebrow>
      <div className="mt-3 grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <h2
          className="text-[40px] font-bold leading-none tracking-tight sm:text-[54px]"
          style={{ fontFamily: DISPLAY }}
        >
          A list tells you what.
          <br />A graph tells you why.
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <WhyCard
            icon={Network}
            title="Relationships"
            body="Goals require capabilities. Capabilities have prerequisites. Demonstrations point to evidence. Those connections matter."
          />
          <WhyCard
            icon={CircleDot}
            title="Provenance"
            body="Recommendations can trace back to the code changes that created the underlying evidence."
          />
          <WhyCard
            icon={Route}
            title="Traversal"
            body="Pathway can move through prerequisite and related-capability edges instead of treating every skill as independent."
          />
          <WhyCard
            icon={GitBranch}
            title="Living memory"
            body="When you ship again, the graph can update rather than forcing you to rebuild a profile from scratch."
          />
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
    <Card className={`p-5 hover:-translate-y-1 ${ease}`}>
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full"
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

function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section
      id="faq"
      className="px-5 py-24 sm:px-6"
      style={{ borderTop: `2px solid ${INK}` }}
    >
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.75fr_1.25fr]">
        <div>
          <Eyebrow>FAQ</Eyebrow>
          <h2
            className="mt-3 text-[40px] font-bold leading-none tracking-tight sm:text-[54px]"
            style={{ fontFamily: DISPLAY }}
          >
            Built for developers who want to keep getting better.
          </h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, i) => {
            const active = open === i;
            return (
              <div
                key={faq.q}
                className="overflow-hidden rounded-xl bg-white"
                style={{ ...border, boxShadow: active ? shadow(2) : "none" }}
              >
                <button
                  type="button"
                  onClick={() => setOpen(active ? null : i)}
                  aria-expanded={active}
                  className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left ${focus}`}
                >
                  <span
                    className="text-[15px] font-bold"
                    style={{ fontFamily: DISPLAY }}
                  >
                    {faq.q}
                  </span>
                  <ChevronDown
                    size={17}
                    className={`${ease} ${active ? "rotate-180" : ""}`}
                  />
                </button>
                <div
                  className={`grid ${ease} ${active ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 pb-5 text-[13px] leading-relaxed text-neutral-600">
                      {faq.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-5 pb-24 sm:px-6">
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
            Connect GitHub and let Pathway turn your engineering history into a
            living map of evidence, goals and next actions.
          </p>
          <div className="mt-8">
            <Btn href={githubConnectUrl()} variant="accent" size="md">
              <FaGithub size={16} />
              Connect GitHub
            </Btn>
          </div>
        </div>
      </div>
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
}: {
  children: ReactNode;
  className?: string;
  bg?: string;
}) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{ ...border, backgroundColor: bg, boxShadow: shadow(3) }}
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
    boxShadow: shadow(3),
  };

  const cls = `inline-flex items-center gap-1.5 rounded-full font-bold text-[13px] ${
    size === "sm" ? "px-4 py-2" : "px-6 py-3"
  } transition-[transform,box-shadow] duration-150 ease-out hover:-translate-x-px hover:-translate-y-px ${focus}`;

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
