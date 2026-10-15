import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

import { HUB_POSITION, computeAreaPositions } from "./mockGraph";
import { computeRoomLayout } from "./cityKit";

import type {
  Area,
  BuildsSummaryResponse,
  DeliveryPackage,
  Developer,
  GraphSummaryResponse,
  ProjectPod,
  ProjectSummaryData,
  SkillDetail,
  SkillInsight,
  SkillInsights,
  WorldContextValue,
  WorldViewMode,
} from "../src/types";

export interface SkillEvidenceItem {
  id: string;
  path?: string;
  repository?: string;
  capability?: string;
  observedBehavior?: string;
}

type WorldContextValueWithSkill = WorldContextValue & {
  insights: SkillInsights | null;
  selectedSkillSlug: string | null;
  skillDetail: SkillDetail | null;
  isSkillLoading: boolean;
  skillError: string | null;
  selectSkill: (slug: string) => void;
  clearSelectedSkill: () => void;

  skillInsight: SkillInsight | null;
  isInsightLoading: boolean;
  insightError: string | null;
  loadInsight: (forceRefresh?: boolean) => void;
};

type WorldContextValueWithBuilds = WorldContextValueWithSkill & {
  viewMode: WorldViewMode;
  setViewMode: (mode: WorldViewMode) => void;

  projects: ProjectPod[];
  projectMap: Record<string, ProjectPod>;
  isBuildsLoading: boolean;
  buildsError: string | null;
  refreshBuilds: () => void;

  focusedProjectId: string | null;
  focusProject: (projectId: string) => void;
  focusBuildHub: () => void;

  buildConstructions: Record<string, number>;
  isGeneratingBuilds: boolean;
  generateBuilds: () => void;
};

const WorldContext = createContext<WorldContextValueWithBuilds | null>(null);

const API_BASE: string =
  (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env
    ?.VITE_API_URL ?? "http://localhost:4000";

const DELIVERY_DURATION = 1900;
const DELIVERY_STAGGER = 260;

export const CONSTRUCTION_DURATION_MS = 3200;
export const CONSTRUCTION_STAGGER_MS = 260;

interface WorldProviderProps {
  children: ReactNode;
}

export function WorldProvider({ children }: WorldProviderProps) {
  const [focusedAreaId, setFocusedAreaId] = useState<string | null>(null);

  const [areas, setAreas] = useState<Area[]>([]);
  const [developer, setDeveloper] = useState<Developer | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [insights, setInsights] = useState<SkillInsights | null>(null);

  const [packages, setPackages] = useState<DeliveryPackage[]>([]);
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [constructions, setConstructions] = useState<Record<string, number>>(
    {},
  );
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const regenerateSourceRef = useRef<EventSource | null>(null);

  const [selectedSkillSlug, setSelectedSkillSlug] = useState<string | null>(
    null,
  );
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
  const [isSkillLoading, setIsSkillLoading] = useState<boolean>(false);
  const [skillError, setSkillError] = useState<string | null>(null);

  const [skillInsight, setSkillInsight] = useState<SkillInsight | null>(null);
  const [isInsightLoading, setIsInsightLoading] = useState<boolean>(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  const selectedSkillSlugRef = useRef<string | null>(null);
  useEffect(() => {
    selectedSkillSlugRef.current = selectedSkillSlug;
  }, [selectedSkillSlug]);

  const [viewMode, setViewMode] = useState<WorldViewMode>("skills");

  const [projects, setProjects] = useState<ProjectPod[]>([]);
  const [isBuildsLoading, setIsBuildsLoading] = useState<boolean>(false);
  const [buildsError, setBuildsError] = useState<string | null>(null);
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null);
  const [buildConstructions, setBuildConstructions] = useState<
    Record<string, number>
  >({});
  const [isGeneratingBuilds, setIsGeneratingBuilds] = useState<boolean>(false);

  const buildsSourceRef = useRef<EventSource | null>(null);
  const hasLoadedBuildsRef = useRef<boolean>(false);

  const projectMap = useMemo<Record<string, ProjectPod>>(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects],
  );

  const loadGraph = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/graph/summary`, {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }

      const data: GraphSummaryResponse = await res.json();

      const categories = data.categories ?? [];
      const positions = computeRoomLayout(categories.length);

      setAreas(
        categories.map((category, i) => ({
          id: category.id,
          label: category.label,
          skillCount: category.skillCount,
          evidenceCount: category.evidenceCount,
          score: category.score,
          skills: category.skills,
          position: positions[i],
        })),
      );

      setDeveloper(data.developer ?? null);
      setInsights(data.insights ?? null);
    } catch (err) {
      console.error("Failed to load knowledge graph:", err);

      setError(
        err instanceof Error ? err.message : "Failed to load knowledge graph",
      );

      setAreas([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const loadBuilds = useCallback(async (): Promise<void> => {
    setIsBuildsLoading(true);
    setBuildsError(null);

    try {
      const res = await fetch(`${API_BASE}/api/builds/summary`, {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }

      const data: BuildsSummaryResponse = await res.json();
      const list = data.builds ?? [];
      const positions = computeAreaPositions(list.length);

      setProjects(
        list.map((project: ProjectSummaryData, i: number) => ({
          ...project,
          position: positions[i],
        })),
      );
    } catch (err) {
      console.error("Failed to load build memory summary:", err);

      setBuildsError(
        err instanceof Error
          ? err.message
          : "Failed to load build memory summary",
      );

      setProjects([]);
    } finally {
      setIsBuildsLoading(false);
      hasLoadedBuildsRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (viewMode === "builds" && !hasLoadedBuildsRef.current) {
      loadBuilds();
    }
  }, [viewMode, loadBuilds]);

  useEffect(() => {
    return () => {
      regenerateSourceRef.current?.close();
      regenerateSourceRef.current = null;
      buildsSourceRef.current?.close();
      buildsSourceRef.current = null;
    };
  }, []);

  const areaMap = useMemo<Record<string, Area>>(
    () => Object.fromEntries(areas.map((area) => [area.id, area])),
    [areas],
  );

  const resetSkillSidebar = useCallback(() => {
    setSelectedSkillSlug(null);
    setSkillDetail(null);
    setSkillError(null);
    setSkillInsight(null);
    setInsightError(null);
  }, []);

  const focusArea = useCallback(
    (areaId: string) => {
      setFocusedAreaId(areaId);
      resetSkillSidebar();
    },
    [resetSkillSidebar],
  );

  const focusHub = useCallback(() => {
    setFocusedAreaId(null);
    resetSkillSidebar();
  }, [resetSkillSidebar]);

  const focusProject = useCallback((projectId: string) => {
    setFocusedProjectId(projectId);
  }, []);

  const focusBuildHub = useCallback(() => {
    setFocusedProjectId(null);
  }, []);

  const handleSetViewMode = useCallback(
    (mode: WorldViewMode) => {
      setViewMode(mode);
      if (mode === "builds") {
        setFocusedAreaId(null);
        resetSkillSidebar();
      } else {
        setFocusedProjectId(null);
      }
    },
    [resetSkillSidebar],
  );

  const simulate = useCallback(() => {
    if (areas.length === 0) return;

    const now = Date.now();

    setPackages((prev) => [
      ...prev,
      ...areas.map(
        (area, i): DeliveryPackage => ({
          id: `${area.id}-${now}-${i}`,
          areaId: area.id,
          startTime: now + i * DELIVERY_STAGGER,
          duration: DELIVERY_DURATION,
        }),
      ),
    ]);
  }, [areas]);

  const deliverPackage = useCallback((pkgId: string, areaId: string) => {
    setPackages((prev) => prev.filter((pkg) => pkg.id !== pkgId));
    setPulses((prev) => ({ ...prev, [areaId]: Date.now() }));
  }, []);

  const generateAreas = useCallback(() => {
    if (isGenerating) return;
    if (regenerateSourceRef.current) return;

    setIsGenerating(true);
    setError(null);

    let positions: [number, number, number][] = [];
    let receivedCount = 0;
    let source: EventSource;

    try {
      source = new EventSource(`${API_BASE}/api/graph/regenerate`, {
        withCredentials: true,
      });
    } catch (err) {
      console.error("Failed to open regenerate stream:", err);
      setError("Could not start graph regeneration");
      setIsGenerating(false);
      return;
    }

    regenerateSourceRef.current = source;

    const finishRun = () => {
      source.close();
      regenerateSourceRef.current = null;
    };

    source.onopen = () => {
      console.debug("[generateAreas] SSE connection open");
    };

    source.onmessage = (event: MessageEvent<string>) => {
      let data: any;

      try {
        data = JSON.parse(event.data);
      } catch (err) {
        console.warn(
          "[generateAreas] failed to parse SSE payload",
          event.data,
          err,
        );
        return;
      }

      console.debug("[generateAreas] stage:", data.stage, data);

      switch (data.stage) {
        case "resetting": {
          setAreas([]);
          setInsights(null);
          setConstructions({});
          setPulses({});
          resetSkillSidebar();
          break;
        }

        case "areas_total": {
          const count = Number(data.count) || 0;
          positions = computeRoomLayout(count);
          receivedCount = 0;
          break;
        }

        case "area_ready": {
          const raw = data.area;
          if (!raw) break;

          const index = receivedCount++;
          const position = positions[index] ?? HUB_POSITION;

          const newArea: Area = {
            id: raw.id,
            label: raw.label,
            skillCount: raw.skillCount,
            evidenceCount: raw.evidenceCount,
            score: raw.score,
            skills: raw.skills,
            position,
          };

          const startTime = Date.now() + index * CONSTRUCTION_STAGGER_MS;

          setAreas((prev) => [...prev, newArea]);
          setConstructions((prev) => ({
            ...prev,
            [newArea.id]: startTime,
          }));

          break;
        }

        case "complete": {
          if (data.developer) {
            setDeveloper(data.developer);
          }

          if (data.insights) {
            setInsights(data.insights);
          }

          finishRun();

          const totalMs =
            receivedCount * CONSTRUCTION_STAGGER_MS +
            CONSTRUCTION_DURATION_MS +
            300;

          window.setTimeout(() => setIsGenerating(false), totalMs);

          break;
        }

        case "error": {
          console.error("Regenerate failed:", data.message);
          setError(data.message ?? "Failed to regenerate knowledge graph");
          finishRun();
          setIsGenerating(false);
          break;
        }

        default:
          break;
      }
    };

    source.onerror = (event) => {
      console.error(
        "[generateAreas] SSE error",
        event,
        "readyState:",
        source.readyState,
      );

      setError(
        (prev) => prev ?? "Lost connection while regenerating the graph",
      );

      finishRun();
      setIsGenerating(false);
    };
  }, [isGenerating, resetSkillSidebar]);

  const generateBuilds = useCallback(() => {
    if (isGeneratingBuilds) return;
    if (buildsSourceRef.current) return;

    setIsGeneratingBuilds(true);
    setBuildsError(null);

    let positions: [number, number, number][] = [];
    let receivedCount = 0;
    let source: EventSource;

    try {
      source = new EventSource(`${API_BASE}/api/builds/generate`, {
        withCredentials: true,
      });
    } catch (err) {
      console.error("Failed to open builds generate stream:", err);
      setBuildsError("Could not start build memory generation");
      setIsGeneratingBuilds(false);
      return;
    }

    buildsSourceRef.current = source;

    const finishRun = () => {
      source.close();
      buildsSourceRef.current = null;
    };

    source.onmessage = (event: MessageEvent<string>) => {
      let data: any;

      try {
        data = JSON.parse(event.data);
      } catch (err) {
        console.warn(
          "[generateBuilds] failed to parse SSE payload",
          event.data,
          err,
        );
        return;
      }

      console.debug("[generateBuilds] stage:", data.stage, data);

      switch (data.stage) {
        case "resetting": {
          setProjects([]);
          setBuildConstructions({});
          setFocusedProjectId(null);
          hasLoadedBuildsRef.current = true;
          break;
        }

        case "projects_total": {
          const count = Number(data.count) || 0;
          positions = computeAreaPositions(count);
          receivedCount = 0;
          break;
        }

        case "project_ready": {
          const raw = data.project as ProjectSummaryData | undefined;
          if (!raw) break;

          const index = receivedCount++;
          const position = positions[index] ?? HUB_POSITION;

          const newProject: ProjectPod = { ...raw, position };
          const startTime = Date.now() + index * CONSTRUCTION_STAGGER_MS;

          setProjects((prev) => [...prev, newProject]);
          setBuildConstructions((prev) => ({
            ...prev,
            [newProject.id]: startTime,
          }));

          break;
        }

        case "complete": {
          finishRun();

          const totalMs =
            receivedCount * CONSTRUCTION_STAGGER_MS +
            CONSTRUCTION_DURATION_MS +
            300;

          window.setTimeout(() => setIsGeneratingBuilds(false), totalMs);

          break;
        }

        case "error": {
          console.error("Builds generate failed:", data.message);
          setBuildsError(
            data.message ?? "Failed to generate build memory graph",
          );
          finishRun();
          setIsGeneratingBuilds(false);
          break;
        }

        default:
          break;
      }
    };

    source.onerror = (event) => {
      console.error(
        "[generateBuilds] SSE error",
        event,
        "readyState:",
        source.readyState,
      );

      setBuildsError(
        (prev) => prev ?? "Lost connection while generating build memory",
      );

      finishRun();
      setIsGeneratingBuilds(false);
    };
  }, [isGeneratingBuilds]);

  const selectSkill = useCallback((slug: string) => {
    setSelectedSkillSlug(slug);
    setSkillDetail(null);
    setSkillError(null);
    setIsSkillLoading(true);

    setSkillInsight(null);
    setInsightError(null);
    setIsInsightLoading(false);

    fetch(`${API_BASE}/api/skills/${encodeURIComponent(slug)}`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`);
        }

        const data: SkillDetail = await res.json();

        if (slug === selectedSkillSlugRef.current) {
          setSkillDetail(data);
        }
      })
      .catch((err) => {
        console.error("Failed to load skill evidence:", err);

        if (slug === selectedSkillSlugRef.current) {
          setSkillError(
            err instanceof Error
              ? err.message
              : "Failed to load skill evidence",
          );
        }
      })
      .finally(() => {
        if (slug === selectedSkillSlugRef.current) {
          setIsSkillLoading(false);
        }
      });
  }, []);

  const clearSelectedSkill = useCallback(() => {
    resetSkillSidebar();
  }, [resetSkillSidebar]);

  const loadInsight = useCallback((forceRefresh = false) => {
    const slug = selectedSkillSlugRef.current;

    if (!slug) return;

    setIsInsightLoading(true);
    setInsightError(null);

    const url = `${API_BASE}/api/skills/${encodeURIComponent(slug)}/build${
      forceRefresh ? "?refresh=true" : ""
    }`;

    fetch(url, {
      credentials: "include",
    })
      .then(async (res) => {
        if (res.status === 404) {
          if (slug === selectedSkillSlugRef.current) {
            setSkillInsight(null);
          }

          return;
        }

        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`);
        }

        const data: SkillInsight = await res.json();

        if (slug === selectedSkillSlugRef.current) {
          setSkillInsight(data);
        }
      })
      .catch((err) => {
        console.error("Failed to load skill build insight:", err);

        if (slug === selectedSkillSlugRef.current) {
          setInsightError(
            err instanceof Error
              ? err.message
              : "Failed to analyze what you built with this skill",
          );
        }
      })
      .finally(() => {
        if (slug === selectedSkillSlugRef.current) {
          setIsInsightLoading(false);
        }
      });
  }, []);

  const value: WorldContextValueWithBuilds = {
    areas,
    areaMap,
    developer,
    insights,

    hubPosition: HUB_POSITION,

    focusedAreaId,
    focusArea,
    focusHub,

    packages,
    pulses,

    simulate,
    deliverPackage,

    isSimulating: packages.length > 0,

    constructions,

    generateAreas,
    isGenerating,

    isLoading,
    error,

    refreshGraph: loadGraph,

    selectedSkillSlug,
    skillDetail,
    isSkillLoading,
    skillError,

    selectSkill,
    clearSelectedSkill,

    skillInsight,
    isInsightLoading,
    insightError,
    loadInsight,

    viewMode,
    setViewMode: handleSetViewMode,

    projects,
    projectMap,
    isBuildsLoading,
    buildsError,
    refreshBuilds: loadBuilds,

    focusedProjectId,
    focusProject,
    focusBuildHub,

    buildConstructions,
    isGeneratingBuilds,
    generateBuilds,
  };

  return (
    <WorldContext.Provider value={value}>{children}</WorldContext.Provider>
  );
}

export function useWorld(): WorldContextValueWithBuilds {
  const ctx = useContext(WorldContext);

  if (!ctx) {
    throw new Error("useWorld must be used within a WorldProvider");
  }

  return ctx;
}
