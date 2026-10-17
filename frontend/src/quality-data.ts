import { ApiError } from "./read-api";
import type { Resource } from "./read-api";
import { publishedContract } from "./published-contract";

export const qualityNames = [
  "analytics_monthly_link_quality",
  "import_runs",
  "analytics_refresh_runs",
] as const;
export type QualityName = (typeof qualityNames)[number];

// Server catalogue is the capability authority. Never infer rights from a token,
// requested scopes, cached user labels, or the mere existence of a route.
export function qualityResources(
  catalog: readonly Resource[],
): readonly Resource[] {
  return qualityNames.flatMap((name) => {
    const matches = catalog.filter((r) => r.name === name);
    if (!matches.length) return [];
    const resource = matches[0]!,
      contract = publishedContract[name];
    if (
      matches.length !== 1 ||
      resource.path !== `/v1/data/${name}` ||
      JSON.stringify(resource.keys) !== JSON.stringify(contract.keys) ||
      resource.filters.some((f) => !contract.filters.includes(f)) ||
      contract.filters.some((f) => !resource.filters.includes(f)) ||
      resource.columns.some((c) => !Object.hasOwn(contract.fields, c)) ||
      Object.keys(contract.fields).some((c) => !resource.columns.includes(c))
    )
      throw new ApiError("invalid-response");
    return [resource];
  });
}

export const qualityColumns: Record<QualityName, readonly string[]> = {
  analytics_monthly_link_quality: [
    "period",
    "dataset",
    "store_match_status",
    "source_row_count",
  ],
  import_runs: ["id", "dataset", "status", "started_at", "completed_at"],
  analytics_refresh_runs: ["id", "status", "started_at", "completed_at"],
};
