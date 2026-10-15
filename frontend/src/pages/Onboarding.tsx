import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import OnboardingLoader, {
  stagesFromEvents,
  type OnboardingStats,
  type EvidenceItem,
} from "../compoenents/OnboardingLoader";
import TopicsRunLoader, {
  EMPTY_TOPICS_RUN,
  type TopicsRun,
} from "../compoenents/TopicsRunLoader";
import { API_URL } from "../lib/api";

const MAX_FEED_ITEMS = 10;

export default function Onboarding() {
  const navigate = useNavigate();
  const [seenStages] = useState(() => new Set<string>());
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [liveDetail, setLiveDetail] = useState("");
  const [currentRepo, setCurrentRepo] = useState<string>();
  const [isComplete, setIsComplete] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [stats, setStats] = useState<OnboardingStats>({
    repositories: 0,
    commitsDiscovered: 0,
    commitsProcessed: 0,
    filesAnalyzed: 0,
  });
  const [evidenceFeed, setEvidenceFeed] = useState<EvidenceItem[]>([]);
  const [topicsRun, setTopicsRun] = useState<TopicsRun>(EMPTY_TOPICS_RUN);
  const [, forceRender] = useState(0);
  const sourceRef = useRef<EventSource | null>(null);
  const feedCounter = useRef(0);

  useEffect(() => {
    const source = new EventSource(`${API_URL}/api/onboard/stream`, {
      withCredentials: true,
    });
    sourceRef.current = source;

    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { stage: string } & Record<
        string,
        unknown
      >;

      if (payload.stage === "complete") {
        setIsComplete(true);
        source.close();
        setTimeout(() => navigate("/graph"), 1500);
        return;
      }

      if (payload.stage === "error") {
        setIsError(true);
        setErrorMessage(String(payload.message ?? "Something went wrong."));
        source.close();
        return;
      }

      // ---- topic analysis (runs after everything else) ----
      if (payload.stage.startsWith("topics:")) {
        const detail = payload;
        setTopicsRun((prev) => {
          const next: TopicsRun = {
            ...prev,
            active: true,
            stage: payload.stage,
            message:
              typeof detail.message === "string"
                ? detail.message
                : prev.message,
          };
          switch (payload.stage) {
            case "topics:depth_topics_proposed":
              next.proposed = Number(detail.count ?? 0);
              break;
            case "topics:depth_evidence_gathered":
              next.gathered = prev.gathered + 1;
              break;
            case "topics:depth_topic_assessed": {
              const slug = String(detail.topic ?? "");
              next.assessed = prev.assessed + 1;
              next.latest = slug || prev.latest;
              next.topics = [
                ...prev.topics.filter((t) => t.slug !== slug),
                {
                  slug,
                  level: String(detail.level ?? "none"),
                  score: Number(detail.score ?? 0),
                },
              ];
              break;
            }
            case "topics:done":
              next.done = true;
              next.metrics =
                (detail.metrics as Record<string, unknown>) ?? null;
              break;
            case "topics:warning":
              next.warning = String(detail.message ?? "");
              break;
          }
          return next;
        });
        return;
      }

      if (payload.stage === "sync:repo_started") {
        setCurrentRepo(String(payload.repo ?? ""));
        return;
      }

      if (payload.stage === "sync:evidence_captured") {
        const files = Number(payload.files ?? 0);
        setStats((prev) => ({
          ...prev,
          filesAnalyzed: prev.filesAnalyzed + files,
        }));

        feedCounter.current += 1;
        setEvidenceFeed((prev) => {
          const next: EvidenceItem = {
            id: `${feedCounter.current}`,
            repo: String(payload.repo ?? ""),
            sha: String(payload.sha ?? ""),
            message: String(payload.message ?? ""),
            files,
          };
          return [next, ...prev].slice(0, MAX_FEED_ITEMS);
        });
        return;
      }

      seenStages.add(payload.stage);
      setCurrentStage(payload.stage);

      if (payload.stage === "sync:repos_found") {
        setStats((prev) => ({
          ...prev,
          repositories: Number(payload.count ?? 0),
        }));
        setLiveDetail(`Found ${payload.count} repositories`);
      } else if (payload.stage === "sync:commits_discovered") {
        setStats((prev) => ({
          ...prev,
          commitsDiscovered: Number(payload.count ?? 0),
        }));
        setLiveDetail(`Found ${payload.count} commits to inspect`);
      } else if (payload.stage === "sync:sync_progress") {
        setStats((prev) => ({
          ...prev,
          commitsProcessed: Number(payload.processed ?? 0),
        }));
        setLiveDetail(
          `Processed ${payload.processed}/${payload.total} commits`,
        );
      } else if (payload.stage === "skills:loading_evidence") {
        setLiveDetail(
          `Loading ${payload.files ?? ""} files of authored code`.trim(),
        );
      } else if (payload.stage === "skills:classifying") {
        setLiveDetail(
          `Detected ${payload.matched ?? "some"} technology signals`,
        );
      } else if (payload.stage === "skills:scoring") {
        setLiveDetail("Scoring depth across your skills");
      } else if (payload.stage === "skills:saving") {
        setLiveDetail("Saving your skill graph");
      } else if (typeof payload.message === "string") {
        setLiveDetail(payload.message);
      }

      forceRender((n) => n + 1);
    };

    source.onerror = () => {
      setIsError(true);
      setErrorMessage("Lost connection while building your graph.");
      source.close();
    };

    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stages = stagesFromEvents(seenStages, currentStage, isError);

  if (topicsRun.active && !isError) {
    return <TopicsRunLoader run={topicsRun} isComplete={isComplete} />;
  }

  return (
    <OnboardingLoader
      stages={stages}
      liveDetail={liveDetail}
      isComplete={isComplete}
      isError={isError}
      errorMessage={errorMessage}
      stats={stats}
      currentRepo={currentRepo}
      evidenceFeed={evidenceFeed}
    />
  );
}
