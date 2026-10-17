import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { coverageManifest } from "../test/coverage-manifest";
import {
  businessDestinations,
  deferredDestinations,
} from "../test/coverage-destinations";
import { publishedContract } from "./published-contract";
import type { Node } from "./published-data";
import { resourceNames } from "./read-api";

type Schema = {
  $ref?: string;
  $defs?: Record<string, Schema>;
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  type?: string;
  format?: string;
  pattern?: string;
};
type ApiResource = {
  schema: Schema;
  keys: string[];
  filters: string[];
  operations: boolean;
};
// Import only public models. No app startup, database connection, env file or data read.
const api = JSON.parse(
  execFileSync(
    process.env.COVERAGE_PYTHON ?? "../.venv/bin/python",
    [
      "-I",
      "-c",
      `
import json
from retail_data_platform.api.resources import RESOURCES
print(json.dumps({name: {"schema": r.row_model.model_json_schema(mode="serialization"), "keys": r.keys, "filters": r.filters, "operations": r.operations} for name, r in RESOURCES.items()}))
`,
    ],
    { encoding: "utf8", timeout: 30000, maxBuffer: 2_000_000 },
  ),
) as Record<string, ApiResource>;

function schemaNodes(
  schema: Schema,
  root = schema,
  prefix = "",
): [string, Schema][] {
  return Object.entries(schema.properties ?? {}).flatMap(([key, original]) => {
    const path = `${prefix}${key}`;
    const candidates = original.anyOf ?? [original];
    let node = candidates.find((n) => n.type !== "null")!;
    if (node.$ref) node = root.$defs![node.$ref.split("/").at(-1)!]!;
    const result: [string, Schema][] = [[path, original]];
    if (node.properties) result.push(...schemaNodes(node, root, `${path}.`));
    if (node.items) {
      const item = node.items.$ref
        ? root.$defs![node.items.$ref.split("/").at(-1)!]!
        : node.items;
      result.push(...schemaNodes(item, root, `${path}[].`));
    }
    return result;
  });
}
function frontendNodes(
  fields: Readonly<Record<string, Node>>,
  prefix = "",
): [string, Node][] {
  return Object.entries(fields).flatMap(([field, node]) => {
    const path = `${prefix}${field}`;
    return [
      [path, node] as [string, Node],
      ...(node.fields ? frontendNodes(node.fields, `${path}.`) : []),
      ...(node.item?.fields
        ? frontendNodes(node.item.fields, `${path}[].`)
        : []),
    ];
  });
}
function compatibleNode(
  node: Node,
  schema: Schema,
  root: Schema,
  path: string,
) {
  const branches = schema.anyOf ?? [schema];
  expect(Boolean(node.nullable), `${path} nullable`).toBe(
    branches.some((s) => s.type === "null"),
  );
  let s = branches.find((s) => s.type !== "null")!;
  if (s.$ref) s = root.$defs![s.$ref.split("/").at(-1)!]!;
  const kind = s.properties
    ? "object"
    : s.items
      ? "list"
      : (s.format ?? (s.pattern ? "decimal" : s.type));
  expect(node.kind, `${path} type`).toBe(kind);
  if (s.items) compatibleNode(node.item!, s.items, root, `${path}[]`);
}
function sameSet(actual: readonly string[], expected: readonly string[]) {
  expect(new Set(actual).size).toBe(actual.length);
  expect([...actual].sort()).toEqual([...expected].sort());
}
const registry = JSON.parse(
  readFileSync("../src/retail_data_platform/api/resources.json", "utf8"),
) as Record<string, { columns: string[] }>;
const matrix: { resource: string; path: string; targets: string[] }[] = [];
let resource = "";
for (const line of readFileSync("../docs/saas/data-coverage.md", "utf8").split(
  "\n",
)) {
  if (line.startsWith("## Métadonnées")) break;
  const heading = /^### `([^`]+)`/.exec(line);
  if (heading) resource = heading[1]!;
  const row = /^\| `([^`]+)` \| ([^|]+) \|/.exec(line);
  if (row && resource)
    matrix.push({
      resource: Object.hasOwn(registry, resource)
        ? resource
        : "analytics_store_month",
      path: row[1]!,
      targets:
        row[2]!.match(
          /\b(?:M-SYN|M-VEN|M-PRE|M-ACT|M-TYP|M-REF|D-REF|D-OBS|OPS|Q|R|S)\b/g,
        ) ?? [],
    });
}

it("reconciles actual API models, registry, frontend paths, manifest and product matrix", () => {
  sameSet(Object.keys(api), resourceNames);
  sameSet(Object.keys(publishedContract), resourceNames);
  const expected: string[] = [];
  for (const name of resourceNames) {
    const model = api[name]!,
      contract = publishedContract[name];
    sameSet(Object.keys(model.schema.properties!), registry[name]!.columns);
    sameSet(Object.keys(contract.fields), registry[name]!.columns);
    expect(contract.keys).toEqual(model.keys);
    sameSet(contract.filters, model.filters);
    expect(contract.operations).toBe(model.operations);
    const backend = schemaNodes(model.schema),
      frontend = frontendNodes(contract.fields);
    sameSet(
      frontend.map(([path]) => path),
      backend.map(([path]) => path),
    );
    for (const [path, node] of frontend) {
      const schema = backend.find(([p]) => p === path)![1];
      compatibleNode(node, schema, model.schema, `${name}:${path}`);
      expected.push(`${name}:${path}`);
    }
  }
  sameSet(
    coverageManifest.map((e) => `${e.resource}:${e.path}`),
    expected,
  );
  sameSet(
    matrix.map((e) => `${e.resource}:${e.path}`),
    expected,
  );
  for (const entry of coverageManifest) {
    expect(entry.destinations).toEqual(businessDestinations[entry.resource]);
    expect(entry.fallback).toBe(
      publishedContract[entry.resource].operations ? "Quality" : "DataExplorer",
    );
  }
  for (const row of matrix) {
    expect(
      row.targets.length,
      `${row.resource}:${row.path} destination`,
    ).toBeGreaterThan(0);
    const implemented =
      businessDestinations[row.resource as keyof typeof businessDestinations];
    for (const target of row.targets)
      expect([...implemented, ...deferredDestinations]).toContain(target);
  }
});
it("detects an omitted, unexpected or duplicate field instead of trusting inventory counts", () => {
  const expected = coverageManifest.map((e) => `${e.resource}:${e.path}`);
  expect(() => sameSet(expected.slice(1), expected)).toThrow();
  expect(() =>
    sameSet([...expected.slice(1), "products:unpublished"], expected),
  ).toThrow();
  expect(() => sameSet([...expected, expected[0]!], expected)).toThrow();
});
