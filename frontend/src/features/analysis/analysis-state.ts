import type { AnalysisQuery, AnalysisStore } from "../../api/analysis-contract";
import { ApiError } from "../../api/read-api";
export type AnalysisTab = "summary" | "ranking" | "compare";
export type AnalysisState = {
  revision: number;
  from: string;
  to: string;
  comparison: "previous" | "previous_year";
  scope: "all" | "selection";
  retailer_name: string | null;
  region_code: string | null;
  store_format: string | null;
  activity_status: "all" | "active" | "inactive";
  selected: AnalysisStore[];
  applied: AnalysisQuery | null;
  tab: AnalysisTab;
  cohort: boolean;
  publication?: string;
};
export function initialAnalysisState(): AnalysisState {
  return {
    revision: 0,
    from: "",
    to: "",
    comparison: "previous",
    scope: "all",
    retailer_name: null,
    region_code: null,
    store_format: null,
    activity_status: "all",
    selected: [],
    applied: null,
    tab: "summary",
    cohort: false,
  };
}
export function draftFilters(state: AnalysisState): AnalysisQuery {
  return {
    activity_status: state.activity_status,
    ...(state.retailer_name !== null
      ? { retailer_name: state.retailer_name }
      : {}),
    ...(state.region_code !== null ? { region_code: state.region_code } : {}),
    ...(state.store_format !== null
      ? { store_format: state.store_format }
      : {}),
  };
}
export function analysisMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "forbidden") return "Accès refusé à ces analyses.";
    if (error.code === "too-large")
      return "Réponse trop volumineuse. Réduisez la période ou la taille de page.";
    if (error.code === "invalid-response")
      return "Réponse analytique incohérente ou non reconnue. Aucun résultat affiché.";
    if (error.code === "invalid-request")
      return "Vérifiez la période, les filtres et la sélection.";
    if (error.code === "rate-limited")
      return "Budget de lecture atteint. Réessayez plus tard.";
    if (error.code === "unavailable")
      return "Analyses non initialisées ou service indisponible. Réessayez plus tard.";
  }
  return "Lecture analytique impossible. Réessayez.";
}
