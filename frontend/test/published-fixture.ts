import { publishedContract } from "../src/published-contract";
import type { Node } from "../src/published-data";
import type { Resource, ResourceName } from "../src/read-api";

export const syntheticId = "00000000-0000-4000-8000-000000000001";
export function syntheticValue(node: Node): unknown {
  switch (node.kind) {
    case "object":
      return Object.fromEntries(
        Object.entries(node.fields!).map(([key, child]) => [
          key,
          syntheticValue(child),
        ]),
      );
    case "list":
      return [syntheticValue(node.item!), syntheticValue(node.item!)];
    case "uuid":
      return syntheticId;
    case "integer":
      return 0;
    case "decimal":
      return "12345678901234567890.0123";
    case "boolean":
      return false;
    case "date":
      return "2026-01-01";
    case "date-time":
      return "2026-01-02T00:00:00Z";
    default:
      return "s".repeat(Math.min(node.maximum ?? 9, 9));
  }
}
export function syntheticResource(name: ResourceName): Resource {
  const contract = publishedContract[name];
  return {
    name,
    columns: Object.keys(contract.fields),
    keys: contract.keys,
    filters: contract.filters,
    path: `/v1/data/${name}`,
  };
}
export function syntheticRow(
  name: ResourceName,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...(syntheticValue({
      kind: "object",
      fields: publishedContract[name].fields,
    }) as Record<string, unknown>),
    ...overrides,
  };
}
