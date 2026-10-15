import type { ReadOptions, Collection, ReadQueries } from "./read-queries";
import type { Decoder } from "./api-validation";
import type { Query, ResourceName, Resource } from "./read-api";
import { ApiError } from "./read-api";
import { availableResources, rowDecoder } from "./published-data";
import type { PublishedRow } from "./published-data";
import type { MonthPeriod } from "./month-period";
import { periodQuery } from "./month-period";
import { publishedContract } from "./published-contract";

export class NetworkError extends Error {}

export type NetworkMode = "overview" | "month" | "year";
export type NetworkSelection = { mode: NetworkMode; period?: MonthPeriod };
export type NetworkReads = Pick<ReadQueries, "status" | "resources"> & {
  collect: (
    name: ResourceName,
    query: Query,
    decode: Decoder<PublishedRow>,
    options?: ReadOptions & { maxItems?: number; maxPages?: number },
  ) => Promise<Collection<PublishedRow>>;
};
export const networkMeasures = [
  "revenue",
  "units",
  "calls",
  "field_visits",
  "crowdsourced_visits",
] as const;
export const amount = (row: PublishedRow, key: string): string | null =>
  row[key] as string | null;
export const count = (row: PublishedRow, key: string): number =>
  row[key] as number;

export async function loadNetwork(
  reads: NetworkReads,
  selection: NetworkSelection,
  signal: AbortSignal,
) {
  const options = { signal, refresh: true };
  const before = await reads.status(options);
  if (before.state === "uninitialized")
    throw new NetworkError("Aucune publication analytique initialisée.");
  const catalog = availableResources(await reads.resources(options));
  const name = `analytics_network_${selection.mode}` as const;
  let query: Query = { scope: "network" };
  if (selection.mode !== "overview") {
    if (!selection.period) throw new NetworkError("Choisissez une période.");
    query = periodQuery(selection.period);
    if (selection.mode === "year")
      query = {
        period_from: `${selection.period.from.slice(0, 4)}-01-01`,
        period_to: `${selection.period.to.slice(0, 4)}-01-01`,
      };
  }
  async function collect(
    resourceName: typeof name | "analytics_network_month_changes",
  ) {
    const resource = catalog.find((r) => r.name === resourceName);
    if (
      !resource ||
      Object.keys(publishedContract[resourceName].fields).some(
        (field) => !resource.columns.includes(field),
      )
    )
      throw new NetworkError(
        "Les vues réseau ne sont pas disponibles dans votre catalogue autorisé.",
      );
    const result = await reads.collect(
      resourceName,
      { ...query, limit: 50 },
      rowDecoder(resource),
      { ...options, maxItems: 120, maxPages: 5 },
    );
    if (!result.complete)
      throw new NetworkError(
        result.reason === "freshness-changed"
          ? "La publication a changé. Relisez les résultats."
          : "Lecture incomplète : les résultats réseau sont indisponibles. Réessayez.",
      );
    const seen = new Set<string>();
    for (const row of result.items) {
      const key = String(row.period ?? row.scope);
      if (seen.has(key)) throw new ApiError("invalid-response");
      seen.add(key);
      if (resourceName === "analytics_network_overview") {
        if (row.scope !== "network") throw new ApiError("invalid-response");
      } else if (
        typeof row.period !== "string" ||
        row.period < query.period_from! ||
        row.period > query.period_to! ||
        (selection.mode === "year" && !row.period.endsWith("-01-01"))
      )
        throw new ApiError("invalid-response");
      if (resourceName !== "analytics_network_month_changes") {
        const expected = count(row, "expected_cell_count");
        if (expected < 0) throw new ApiError("invalid-response");
        for (const metric of networkMeasures) {
          const covered = count(row, `${metric}_covered_cell_count`);
          if (
            covered < 0 ||
            covered > expected ||
            (row[metric] !== null && (!expected || covered !== expected))
          )
            throw new ApiError("invalid-response");
        }
      }
    }
    return {
      resource,
      rows: [...result.items].sort((a, b) =>
        String(a.period).localeCompare(String(b.period)),
      ),
    };
  }
  const primary = await collect(name);
  let changes: { resource: Resource; rows: PublishedRow[] } | undefined;
  let comparisonError: string | undefined;
  if (selection.mode === "month") {
    try {
      changes = await collect("analytics_network_month_changes");
    } catch {
      comparisonError =
        "Comparaisons indisponibles ; la synthèse reste consultable.";
    }
  }
  const after = await reads.status(options);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new NetworkError("La publication a changé. Relisez les résultats.");
  return { ...primary, changes, comparisonError, freshness: after };
}

export type NetworkContext = {
  mode: NetworkMode;
  from: string;
  to: string;
  applied: NetworkSelection;
};
export const initialNetworkContext: NetworkContext = {
  mode: "overview",
  from: "",
  to: "",
  applied: { mode: "overview" },
};
