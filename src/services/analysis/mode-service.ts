export const MAX_COMMIT_FETCH_LIMIT = 1_000;
export const FULL_HISTORY_WINDOW_START = "1970-01-01T00:00:00.000Z";

export interface AnalysisModeSelection {
  analysisMode: "full";
  commitLimit: number;
  commitWindowStart: string;
  collapseDepth: null;
}

export function selectAnalysisMode(): AnalysisModeSelection {
  return {
    analysisMode: "full",
    commitLimit: MAX_COMMIT_FETCH_LIMIT,
    commitWindowStart: FULL_HISTORY_WINDOW_START,
    collapseDepth: null,
  };
}
