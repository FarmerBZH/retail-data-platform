import { useEffect, useState } from "react";
import type {
  AnalysisQuery,
  AnalysisResult,
  AnalysisRoute,
} from "./analysis-contract";
import type { ReadQueries } from "./read-queries";
import { ApiError } from "./read-api";
import { analysisMessage } from "./analysis-state";
export type AnalysisReads = Pick<ReadQueries, "analysis">;
export function useAnalysis<R extends AnalysisRoute>(
  reads: AnalysisReads,
  route: R,
  query: AnalysisQuery | undefined,
  onConflict: () => void,
) {
  const [revision, retry] = useState(0);
  const key = JSON.stringify([route, query, revision]);
  const [state, setState] = useState<{
    key: string;
    data?: AnalysisResult<R>;
    error?: string;
  }>();
  useEffect(() => {
    const [, snapshot] = JSON.parse(key) as [
      string,
      AnalysisQuery | undefined,
      number,
    ];
    if (!snapshot) return;
    const controller = new AbortController();
    void reads
      .analysis(route, snapshot, { signal: controller.signal, refresh: true })
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.code === "publication-changed") {
          onConflict();
          return;
        }
        setState({ key, error: analysisMessage(error) });
      });
    return () => controller.abort();
  }, [reads, route, key, onConflict]);
  return {
    data: state?.key === key ? state.data : undefined,
    error: state?.key === key ? state.error : undefined,
    retry: () => retry((n) => n + 1),
  };
}
