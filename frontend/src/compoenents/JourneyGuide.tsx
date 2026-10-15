/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Compass,
  MessageCircle,
  RefreshCw,
  Send,
  Wand2,
} from "lucide-react";

const DISPLAY_FONT = '"Space Grotesk", "Arial Black", sans-serif';
const YELLOW = "#F5C542";
const CORAL = "#F2704F";
const SKY = "#5FA0D8";
const GREEN = "#3FA24A";
const PURPLE = "#8B72D9";
const LAVENDER = "#D8D0F2";
const INK = "#101210";
const CARD = "#E9E5DB";
const WHITE = "#FFFDF8";
const PAPER = "#F1EEE7";
const border = { border: `2px solid ${INK}` };
const shadow = (n = 4) => `${n}px ${n}px 0 0 ${INK}`;

const COLOR_CHIP: Record<string, string> = {
  yellow: YELLOW,
  purple: PURPLE,
  blue: SKY,
  coral: CORAL,
  green: GREEN,
  white: WHITE,
  grey: CARD,
  lavender: LAVENDER,
};
const TONE_DOT: Record<string, string> = {
  info: SKY,
  good: GREEN,
  caution: CORAL,
};
const CONF: Record<string, { label: string; bg: string }> = {
  solid: { label: "Well backed", bg: GREEN },
  building: { label: "Building up", bg: SKY },
  tentative: { label: "Thin evidence", bg: WHITE },
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  const b = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      String(
        (b as any).error ?? (b as any).message ?? `Request failed: ${r.status}`,
      ),
    );
  return b as T;
}
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(String((b as any).error ?? `Request failed: ${r.status}`));
  return b as T;
}

function Chip({
  text,
  background = CARD,
}: {
  text: string;
  background?: string;
}) {
  return (
    <span
      className="inline-flex rounded-full px-3 py-1 text-[12px] font-black"
      style={{ backgroundColor: background, color: INK, ...border }}
    >
      {text}
    </span>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{ backgroundColor: WHITE, ...border }}
    >
      <div className="text-[12px] font-bold">{label}</div>
      <div
        className="mt-0.5 text-[22px] font-black leading-none"
        style={{ fontFamily: DISPLAY_FONT }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-black transition-transform hover:-translate-y-0.5"
      style={{ backgroundColor: active ? YELLOW : WHITE, ...border }}
    >
      {children}
    </button>
  );
}
function Loading({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl p-4"
      style={{ backgroundColor: CARD, ...border }}
    >
      <RefreshCw size={15} className="animate-spin" />
      <span className="text-[13px] font-bold">{label}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* EXPLAIN CARD: drop it anywhere you have a selection                         */
/* -------------------------------------------------------------------------- */

export function ExplainCard({ kind, id }: { kind: string; id: string }) {
  const [ex, setEx] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [simple, setSimple] = useState(false);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    setSimple(false);
    setAsked(false);
    getJson<any>(
      `/api/journey/guide/explain?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
    )
      .then((r) => live && setEx(r))
      .catch(
        (e) =>
          live &&
          setErr(e instanceof Error ? e.message : "Could not explain this."),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [kind, id]);

  const makeSimpler = async () => {
    setSimple(true);
    if (ex?.friendly || asked) return;
    setAsked(true);
    try {
      const r = await getJson<any>(
        `/api/journey/guide/explain?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&friendly=1`,
      );
      setEx(r);
    } catch {
      /* keep the plain explanation */
    }
  };

  if (loading) return <Loading label="Explaining…" />;
  if (err || !ex)
    return (
      <p className="text-[12px] text-neutral-600">
        {err ?? "Nothing to explain here."}
      </p>
    );

  const conf = ex.confidence ? CONF[ex.confidence] : null;
  return (
    <div
      className="space-y-3 rounded-2xl p-4"
      style={{ backgroundColor: PAPER, ...border }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip text="In plain words" background={YELLOW} />
        {conf && <Chip text={conf.label} background={conf.bg} />}
      </div>
      <p className="text-[14px] font-semibold leading-6">{ex.summary}</p>

      {Array.isArray(ex.numbers) && ex.numbers.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {ex.numbers.map((n: any) => (
            <Stat key={n.label} label={n.label} value={Number(n.value) || 0} />
          ))}
        </div>
      )}

      <div className="space-y-2">
        {(ex.sections ?? []).map((s: any, i: number) => (
          <details
            key={s.heading}
            open={i < 2}
            className="rounded-xl p-3"
            style={{ backgroundColor: WHITE, ...border }}
          >
            <summary className="flex cursor-pointer items-center gap-2 text-[13px] font-black">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: TONE_DOT[s.tone ?? "info"],
                  border: `1.5px solid ${INK}`,
                }}
              />
              {s.heading}
            </summary>
            {s.body && (
              <p className="mt-2 text-[13px] leading-5 text-neutral-700">
                {s.body}
              </p>
            )}
            {Array.isArray(s.bullets) && s.bullets.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {s.bullets.map((b: string, j: number) => (
                  <li
                    key={j}
                    className="text-[13px] leading-5 text-neutral-700"
                  >
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </details>
        ))}
      </div>

      {simple ? (
        ex.friendly ? (
          <div
            className="rounded-xl p-3"
            style={{ backgroundColor: LAVENDER, ...border }}
          >
            <div className="text-[12px] font-black">Even simpler</div>
            <p className="mt-1 text-[13px] leading-5">{ex.friendly.simple}</p>
            {ex.friendly.analogy && (
              <p className="mt-1.5 text-[12px] italic leading-5">
                {ex.friendly.analogy}
              </p>
            )}
          </div>
        ) : asked ? (
          <Loading label="Making it simpler…" />
        ) : null
      ) : (
        <button
          type="button"
          onClick={() => void makeSimpler()}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-black transition-transform hover:-translate-y-0.5"
          style={{ backgroundColor: LAVENDER, ...border }}
        >
          <Wand2 size={13} /> Explain it even simpler
        </button>
      )}
      {simple && asked && !ex.friendly && (
        <p className="text-[11px] text-neutral-500">
          Simple mode isn't available right now. The explanation above is the
          full one.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* GUIDE PANEL                                                                */
/* -------------------------------------------------------------------------- */

type Tab = "tour" | "read" | "ask";

export function JourneyGuide({
  onShowStage,
  onShowCapability,
}: {
  onShowStage?: (stage: string) => void;
  onShowCapability?: (capabilityId: string) => void;
}) {
  const [guide, setGuide] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("tour");
  const [step, setStep] = useState(0);

  useEffect(() => {
    let live = true;
    getJson<any>("/api/journey/guide")
      .then((g) => live && setGuide(g))
      .catch(
        (e) =>
          live &&
          setError(
            e instanceof Error ? e.message : "Could not load the guide.",
          ),
      );
    return () => {
      live = false;
    };
  }, []);

  const show = (focus: any) => {
    if (focus?.kind === "stage" && focus.id) onShowStage?.(focus.id);
    if (focus?.kind === "capability" && focus.id) onShowCapability?.(focus.id);
  };

  const go = (i: number) => {
    if (!guide) return;
    const next = Math.max(0, Math.min(guide.tour.length - 1, i));
    setStep(next);
    show(guide.tour[next]?.focus);
  };

  return (
    <section
      className="rounded-3xl p-5 sm:p-6"
      style={{ backgroundColor: WHITE, ...border, boxShadow: shadow(4) }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: LAVENDER, ...border }}
          >
            <Compass size={17} />
          </div>
          <div>
            <h2
              className="text-[20px] font-black tracking-tight"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              {guide?.headline ?? "Your guide"}
            </h2>
            <p className="mt-0.5 max-w-3xl text-[13px] leading-5 text-neutral-600">
              New to graphs? Take the 2-minute tour, learn how to read the
              picture, or just ask a question.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill active={tab === "tour"} onClick={() => setTab("tour")}>
            <Compass size={13} /> Tour
          </Pill>
          <Pill active={tab === "read"} onClick={() => setTab("read")}>
            <BookOpen size={13} /> How to read it
          </Pill>
          <Pill active={tab === "ask"} onClick={() => setTab("ask")}>
            <MessageCircle size={13} /> Ask
          </Pill>
        </div>
      </div>

      <div className="mt-4">
        {error && (
          <p className="text-[13px] font-bold" style={{ color: CORAL }}>
            {error}
          </p>
        )}
        {!guide && !error && <Loading label="Preparing your guide…" />}

        {guide && (
          <>
            <div className="mb-4 grid gap-2 md:grid-cols-3">
              {guide.summary.map((s: string, i: number) => (
                <p
                  key={i}
                  className="rounded-xl p-3 text-[13px] font-semibold leading-5"
                  style={{ backgroundColor: CARD, ...border }}
                >
                  {s}
                </p>
              ))}
            </div>

            {tab === "tour" && <Tour guide={guide} step={step} go={go} />}
            {tab === "read" && <ReadGuide guide={guide} />}
            {tab === "ask" && <Ask guide={guide} />}
          </>
        )}
      </div>
    </section>
  );
}

function Tour({
  guide,
  step,
  go,
}: {
  guide: any;
  step: number;
  go: (i: number) => void;
}) {
  const s = guide.tour[step];
  if (!s) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {guide.tour.map((t: any, i: number) => (
          <button
            key={t.id}
            type="button"
            onClick={() => go(i)}
            aria-label={`Step ${i + 1}: ${t.title}`}
            className="h-3 rounded-full transition-all"
            style={{
              width: i === step ? 28 : 12,
              backgroundColor: i === step ? YELLOW : i < step ? GREEN : WHITE,
              ...border,
            }}
          />
        ))}
        <span className="ml-1 text-[12px] font-bold text-neutral-600">
          Step {step + 1} of {guide.tour.length}
        </span>
      </div>

      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{ backgroundColor: YELLOW, ...border, boxShadow: shadow(4) }}
      >
        <h3
          className="text-[22px] font-black leading-tight"
          style={{ fontFamily: DISPLAY_FONT }}
        >
          {s.title}
        </h3>
        <p className="mt-2 max-w-3xl text-[14px] font-medium leading-6">
          {s.say}
        </p>

        {s.numbers.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {s.numbers.map((n: any) => (
              <Stat
                key={n.label}
                label={n.label}
                value={Number(n.value) || 0}
              />
            ))}
          </div>
        )}

        <div
          className="mt-3 rounded-xl p-3"
          style={{ backgroundColor: WHITE, ...border }}
        >
          <div className="text-[12px] font-black">Where to look</div>
          <ul className="mt-1 space-y-1">
            {s.look.map((l: string, i: number) => (
              <li key={i} className="text-[13px] leading-5">
                {l}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => go(step - 1)}
          disabled={step === 0}
          className="inline-flex items-center gap-1 rounded-full px-4 py-2 text-[13px] font-black disabled:opacity-40"
          style={{ backgroundColor: CARD, ...border }}
        >
          <ChevronLeft size={14} strokeWidth={3} /> Back
        </button>
        <button
          type="button"
          onClick={() => go(step + 1)}
          disabled={step >= guide.tour.length - 1}
          className="inline-flex items-center gap-1 rounded-full px-4 py-2 text-[13px] font-black transition-transform hover:-translate-y-0.5 disabled:opacity-40"
          style={{ backgroundColor: YELLOW, ...border, boxShadow: shadow(2) }}
        >
          Next <ChevronRight size={14} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}

function ReadGuide({ guide }: { guide: any }) {
  const r = guide.readGraph;
  const [allRels, setAllRels] = useState(false);
  const [rel, setRel] = useState<string | null>(null);
  const rels = allRels ? guide.relationships : guide.relationships.slice(0, 8);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <div>
          <div className="text-[13px] font-black">What each shape is</div>
          <ul className="mt-2 space-y-1.5">
            {r.nodes.map((n: any) => (
              <li
                key={n.kind}
                className="flex items-center gap-2.5 text-[12px] leading-4"
              >
                <span
                  className="h-4 w-8 shrink-0 rounded-full"
                  style={{
                    backgroundColor: COLOR_CHIP[n.color] ?? CARD,
                    ...border,
                  }}
                />
                <span className="min-w-0">
                  <b>{n.kind}</b>{" "}
                  <span className="text-neutral-600">{n.meaning}</span>
                  {typeof n.count === "number" && n.count > 0 && (
                    <span className="font-bold">
                      {" "}
                      · {n.count.toLocaleString()} in your graph
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="text-[13px] font-black">What the lines mean</div>
          <ul className="mt-2 space-y-1.5">
            {r.lines.map((l: any) => (
              <li
                key={l.style}
                className="flex items-center gap-2.5 text-[12px]"
              >
                <svg width="38" height="8" aria-hidden="true">
                  <line
                    x1="0"
                    y1="4"
                    x2="38"
                    y2="4"
                    stroke={INK}
                    strokeWidth="2.5"
                    strokeDasharray={l.style === "dashed" ? "6 4" : undefined}
                  />
                </svg>
                {l.meaning}
              </li>
            ))}
          </ul>
        </div>

        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: CARD, ...border }}
        >
          <div className="text-[13px] font-black">Reading tips</div>
          <ul className="mt-1.5 space-y-1">
            {r.tips.map((t: string, i: number) => (
              <li key={i} className="text-[12px] leading-5">
                • {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="text-[13px] font-black">
            Lines in your graph, in words
          </div>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            Tap a line name for more.
          </p>
          <div className="mt-2 space-y-1.5">
            {rels.map((e: any) => (
              <div
                key={`${e.from}|${e.rel}|${e.to}`}
                className="rounded-xl p-2.5"
                style={{ backgroundColor: WHITE, ...border }}
              >
                <button
                  type="button"
                  onClick={() => setRel(rel === e.rel ? null : e.rel)}
                  className="flex w-full flex-wrap items-center gap-2 text-left"
                >
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-black"
                    style={{ backgroundColor: PAPER, color: CORAL, ...border }}
                  >
                    {e.rel}
                  </span>
                  <span className="text-[12px] font-bold">
                    {e.from} → {e.to}
                  </span>
                  <span className="ml-auto text-[12px] font-black">
                    {e.count.toLocaleString()}
                  </span>
                </button>
                <p className="mt-1 text-[12px] text-neutral-600">
                  {e.plain}
                  {e.scope === "taxonomy" ? " (shared catalogue)" : ""}
                </p>
                {rel === e.rel && (
                  <div className="mt-2">
                    <ExplainCard kind="relationship" id={e.rel} />
                  </div>
                )}
              </div>
            ))}
          </div>
          {guide.relationships.length > 8 && (
            <button
              type="button"
              onClick={() => setAllRels((v) => !v)}
              className="mt-2 rounded-full px-3 py-1.5 text-[12px] font-black"
              style={{ backgroundColor: CARD, ...border }}
            >
              {allRels
                ? "Show fewer"
                : `Show all ${guide.relationships.length}`}
            </button>
          )}
        </div>

        <details
          className="rounded-xl p-3"
          style={{ backgroundColor: CARD, ...border }}
        >
          <summary className="cursor-pointer text-[13px] font-black">
            Glossary ({guide.glossary.length} terms)
          </summary>
          <dl className="mt-2 space-y-1.5">
            {guide.glossary.map((g: any) => (
              <div key={g.term}>
                <dt className="text-[12px] font-black">{g.term}</dt>
                <dd className="text-[12px] leading-5 text-neutral-700">
                  {g.meaning}
                </dd>
              </div>
            ))}
          </dl>
        </details>

        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: WHITE, ...border }}
        >
          <div className="text-[13px] font-black">How sure are we?</div>
          <div className="mt-2 space-y-1.5 text-[12px] leading-5">
            <div>
              <Chip text="Well backed" background={GREEN} />{" "}
              {guide.bigPicture.wellBacked.join(", ") || "none yet"}
            </div>
            <div>
              <Chip text="Building up" background={SKY} />{" "}
              {guide.bigPicture.building.join(", ") || "none"}
            </div>
            <div>
              <Chip text="Thin evidence" background={WHITE} />{" "}
              {guide.bigPicture.thin.join(", ") || "none"}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">
            {guide.bigPicture.note}
          </p>
        </div>
      </div>
    </div>
  );
}

function Ask({ guide }: { guide: any }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [turns, setTurns] = useState<Array<{ q: string; a: any }>>([]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (question.length < 2 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const history = turns.slice(-2).flatMap((t) => [
        { role: "user", content: t.q },
        { role: "assistant", content: t.a.answer },
      ]);
      const a = await postJson<any>("/api/journey/ask-simple", {
        question,
        history,
      });
      setTurns((t) => [...t, { q: question, a }]);
      setQ("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not answer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {guide.suggestedQuestions.map((s: string) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => void ask(s)}
            className="rounded-full px-3 py-1.5 text-[12px] font-black transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            style={{ backgroundColor: CARD, ...border }}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void ask(q)}
          maxLength={600}
          placeholder="Ask anything about your journey…"
          className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2.5 text-[13px] font-medium outline-none"
          style={border}
        />
        <button
          type="button"
          onClick={() => void ask(q)}
          disabled={busy || q.trim().length < 2}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 text-[13px] font-black disabled:opacity-50"
          style={{ backgroundColor: YELLOW, ...border, boxShadow: shadow(2) }}
        >
          <Send size={14} /> Ask
        </button>
      </div>

      {busy && <Loading label="Walking the graph to answer…" />}
      {err && (
        <p className="text-[13px] font-bold" style={{ color: CORAL }}>
          {err}
        </p>
      )}

      <div className="space-y-4">
        {[...turns].reverse().map((t, i) => (
          <div key={`${turns.length - i}`} className="space-y-2">
            <div
              className="inline-flex rounded-xl px-3 py-1.5 text-[13px] font-black"
              style={{ backgroundColor: LAVENDER, ...border }}
            >
              {t.q}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {t.a.sections.map((s: any, j: number) => (
                <div
                  key={j}
                  className="rounded-xl p-3"
                  style={{
                    backgroundColor: j === 0 ? YELLOW : WHITE,
                    ...border,
                  }}
                >
                  <div className="text-[13px] font-black">{s.heading}</div>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5">
                    {s.body}
                  </p>
                </div>
              ))}
            </div>
            {t.a.ungroundedLinks?.length > 0 && (
              <p className="text-[11px] font-bold" style={{ color: CORAL }}>
                Some links in the answer weren't in your graph and were removed.
              </p>
            )}
            {t.a.traversals?.length > 0 && (
              <p className="text-[11px] text-neutral-500">
                Answered by {t.a.traversals.length} graph{" "}
                {t.a.traversals.length === 1 ? "lookup" : "lookups"} (
                {t.a.traversals.reduce((s: number, x: any) => s + x.queries, 0)}{" "}
                queries).
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
