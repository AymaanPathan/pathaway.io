import { useEffect, useState } from "react";
import { Loader2, Check, AlertTriangle } from "lucide-react";
import { useLocation } from "react-router-dom";

import { API_URL } from "../lib/api";

type OverviewStatus = "idle" | "preparing" | "running" | "complete" | "error";

type StatusResponse = {
  status?: OverviewStatus;
  error?: string | null;
};

export default function OverviewSyncIndicator() {
  const location = useLocation();
  const [status, setStatus] = useState<OverviewStatus>("idle");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      try {
        const response = await fetch(`${API_URL}/api/overview/status`, {
          credentials: "include",
        });

        if (!response.ok) {
          if (!cancelled) setStatus("idle");
          return;
        }

        const data = (await response.json()) as StatusResponse;
        const next = data.status ?? "idle";

        if (cancelled) return;

        setStatus(next);

        if (next === "preparing" || next === "running") {
          setVisible(true);
          timer = setTimeout(check, 1500);
          return;
        }

        if (next === "complete") {
          setVisible(true);
          timer = setTimeout(() => {
            if (!cancelled) setVisible(false);
          }, 2200);
          return;
        }

        if (next === "error") {
          setVisible(true);
          return;
        }

        setVisible(false);
      } catch {
        if (!cancelled) {
          setStatus("idle");
          setVisible(false);
        }
      }
    };

    void check();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [location.pathname]);

  if (!visible) return null;

  const active = status === "preparing" || status === "running";
  const complete = status === "complete";

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex items-center gap-2 rounded-full px-3 py-2 text-[11px] font-semibold"
      style={{
        background: "#101210",
        color: "#fff",
        border: "2px solid #101210",
        boxShadow: "4px 4px 0 0 #101210",
      }}
      title={
        active
          ? "Developer overview is being generated"
          : complete
            ? "Developer overview is ready"
            : "Developer overview generation failed"
      }
    >
      {active ? (
        <Loader2
          size={13}
          className="animate-spin"
          style={{ color: "#F5C542" }}
        />
      ) : complete ? (
        <Check size={13} style={{ color: "#3FA24A" }} />
      ) : (
        <AlertTriangle size={13} style={{ color: "#F2704F" }} />
      )}

      <span>
        {status === "preparing"
          ? "Preparing overview…"
          : status === "running"
            ? "Building overview…"
            : status === "complete"
              ? "Overview ready"
              : "Overview failed"}
      </span>
    </div>
  );
}
