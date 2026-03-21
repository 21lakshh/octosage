import type { AnalysisMode } from "@/src/types/domain";

const SMALL_REPOSITORY_FILE_THRESHOLD = 3_000;
const LARGE_REPOSITORY_FILE_THRESHOLD = 12_000;

export interface AnalysisModeSelection {
  analysisMode: AnalysisMode;
  commitLimit: number;
  windowDays: number;
  collapseDepth: number | null;
  degradedReason: string | null;
}

export function selectAnalysisMode(fileCount: number): AnalysisModeSelection {
  if (fileCount > LARGE_REPOSITORY_FILE_THRESHOLD) {
    return {
      analysisMode: "degraded",
      commitLimit: 300,
      windowDays: 45,
      collapseDepth: 1,
      degradedReason: "Repository exceeded the large-repo threshold, so ownership was collapsed to shallow module depth.",
    };
  }

  if (fileCount > SMALL_REPOSITORY_FILE_THRESHOLD) {
    return {
      analysisMode: "reduced",
      commitLimit: 600,
      windowDays: 75,
      collapseDepth: null,
      degradedReason: null,
    };
  }

  return {
    analysisMode: "full",
    commitLimit: 1_000,
    windowDays: 120,
    collapseDepth: null,
    degradedReason: null,
  };
}
