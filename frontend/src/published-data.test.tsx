import { readFileSync } from "node:fs";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { coverageManifest } from "../test/coverage-manifest";
import type { Node, PublishedRow, Value } from "./published-data";
import { formatExact } from "./exact-values";
import { publishedContract } from "./published-contract";
import {
  availableResources,
  detailQuery,
  fieldLabel,
  filterQuery,
  matchesQuery,
  rowDecoder,
  rowKey,
} from "./published-data";
import { PublishedDetail } from "./PublishedDetail";
import { resourceNames } from "./read-api";
import {
  syntheticResource,
  syntheticRow,
  syntheticId,
} from "../test/published-fixture";

afterEach(cleanup);
function checkValue(value: Value, node: Node, element: Element) {
  if (node.kind === "object") {
    const fields = Object.entries(node.fields!);
    const children = element.querySelectorAll(":scope > dl > div");
    expect(children).toHaveLength(fields.length);
    fields.forEach(([key, child], index) => {
      const entry = children[index]!;
      expect(entry.querySelector("dt")?.textContent).toContain(`(${key})`);
      expect(fieldLabel(key)).not.toBe("Champ publié");
      checkValue(
        (value as PublishedRow)[key]!,
        child,
        entry.querySelector("dd")!,
      );
    });
  } else if (node.kind === "list") {
    const children = element.querySelectorAll(":scope > details > ol > li");
    expect(children).toHaveLength((value as readonly Value[]).length);
    (value as readonly Value[]).forEach((entry, index) =>
      checkValue(entry, node.item!, children[index]!),
    );
  } else
    expect(element.textContent).toBe(
      node.kind === "boolean"
        ? value
          ? "Oui"
          : "Non"
        : node.kind === "decimal"
          ? formatExact(value as string)
          : String(value),
    );
}
describe("public projection and full recursive detail", () => {
  it("matches every published registry field, with no database field", () => {
    const registry = JSON.parse(
      readFileSync("../src/retail_data_platform/api/resources.json", "utf8"),
    ) as Record<string, { columns: string[]; operations: boolean }>;
    expect(Object.keys(publishedContract)).toEqual(Object.keys(registry));
    let count = 0;
    for (const name of resourceNames) {
      expect(Object.keys(publishedContract[name].fields)).toEqual(
        registry[name]!.columns,
      );
      expect(publishedContract[name].operations).toBe(
        registry[name]!.operations,
      );
      count += registry[name]!.columns.length;
    }
    expect(count).toBe(325);
    const sources = {
      current_store: "stores",
      activity_details: "analytics_activity_month",
      category_details: "analytics_store_category_month",
      typology_details: "analytics_typology_month",
    } as const;
    let children = 0;
    for (const [key, source] of Object.entries(sources)) {
      const node = publishedContract.analytics_store_month.fields[key]!;
      const fields = node.kind === "list" ? node.item!.fields! : node.fields!;
      const expected = registry[source]!.columns.filter(
        (field) =>
          key === "current_store" || !["store_id", "period"].includes(field),
      );
      expect(Object.keys(fields)).toEqual(expected);
      children += expected.length;
    }
    expect(children).toBe(74);
    expect(coverageManifest).toHaveLength(399);
    expect(
      new Set(
        coverageManifest.map((entry) => `${entry.resource}:${entry.path}`),
      ).size,
    ).toBe(399);
  });
  for (const name of resourceNames) {
    it(`renders every field and nested path of ${name} using synthetic values`, () => {
      const resource = syntheticResource(name);
      const raw = syntheticRow(name, { unpublished: "secret-test-field" });
      const row = rowDecoder(resource)(raw);
      const { container } = render(
        <PublishedDetail resource={resource} row={row} />,
      );
      for (const key of resource.columns) {
        expect(fieldLabel(key)).not.toBe("Champ publié");
        expect(container.textContent).toContain(`(${key})`);
        expect(Object.hasOwn(row, key)).toBe(true);
      }
      checkValue(
        row,
        { kind: "object", fields: publishedContract[name].fields },
        container,
      );
      expect(container.textContent).not.toContain("secret-test-field");
      expect(container.querySelector("b")).toBeNull();
    });
  }
  it("preserves null, zero, empty text and empty lists independently", () => {
    const resource = syntheticResource("analytics_activity_month");
    const row = rowDecoder(resource)(
      syntheticRow(resource.name, {
        activity_count: 0,
        source_row_count: null,
        observation_ids: [],
        activity_type: "",
      }),
    );
    render(<PublishedDetail resource={resource} row={row} />);
    expect(screen.getByText("Indisponible")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Texte vide")).toBeInTheDocument();
    expect(screen.getByText("Liste vide")).toBeInTheDocument();
  });
  it("projects only permitted nested properties and exact decimal strings", () => {
    const raw = syntheticRow("analytics_store_month");
    (raw.current_store as Record<string, unknown>).unpublished = "hidden";
    (raw.current_store as Record<string, unknown>).name =
      "<b>texte synthétique</b>";
    const resource = syntheticResource("analytics_store_month");
    const row = rowDecoder(resource)(raw);
    render(<PublishedDetail resource={resource} row={row} />);
    expect(screen.queryByText("hidden")).not.toBeInTheDocument();
    expect(document.body.textContent).toContain(
      "12\u202f345\u202f678\u202f901\u202f234\u202f567\u202f890,0123",
    );
    expect(document.querySelectorAll("li").length).toBeGreaterThan(2);
  });
  it("rejects missing fields, unsafe integers and numeric decimal coercion", () => {
    const decode = rowDecoder(syntheticResource("analytics_activity_month"));
    const row = syntheticRow("analytics_activity_month");
    delete row.activity_count;
    expect(() => decode(row)).toThrow();
    expect(() =>
      decode(
        syntheticRow("analytics_activity_month", {
          activity_count: Number.MAX_SAFE_INTEGER + 1,
        }),
      ),
    ).toThrow();
    expect(() =>
      rowDecoder(syntheticResource("analytics_store_month"))(
        syntheticRow("analytics_store_month", { revenue: 0.1 }),
      ),
    ).toThrow();
  });
  it("uses the whole composite key and preserves literal source codes", () => {
    const resource = syntheticResource("analytics_distribution_product_month");
    const row = rowDecoder(resource)(
      syntheticRow(resource.name, {
        category_code: "00",
        product_key: "GTIN:<b>001</b>",
      }),
    );
    expect(detailQuery(resource, row)).toEqual({
      limit: 1,
      store_id: syntheticId,
      period_from: "2026-01-01",
      period_to: "2026-01-01",
      category_code: "00",
      product_key: "GTIN:<b>001</b>",
    });
    expect(rowKey(resource, row)).not.toBe(
      rowKey(resource, { ...row, product_key: "other" }),
    );
  });
  it("refuses unknown catalogue fields, keys or filters and omits operations", () => {
    const resource = syntheticResource("products");
    expect(
      availableResources([
        resource,
        syntheticResource("import_runs"),
        syntheticResource("analytics_refresh_runs"),
      ]),
    ).toEqual([resource]);
    expect(() =>
      availableResources([
        { ...resource, columns: [...resource.columns, "unpublished"] },
      ]),
    ).toThrow();
    expect(() => availableResources([{ ...resource, keys: [] }])).toThrow();
    expect(() =>
      availableResources([{ ...resource, filters: ["category"] }]),
    ).toThrow();
  });
  it("offers only catalogue filters and validates dates and IDs", () => {
    const resource = syntheticResource("register_observations");
    expect(
      filterQuery(resource, {
        store_id: syntheticId,
        period_from: "2026-01",
        period_to: "2026-02",
      }),
    ).toEqual({
      store_id: syntheticId,
      period_from: "2026-01-01",
      period_to: "2026-02-01",
    });
    expect(() => filterQuery(resource, { category_code: "x" })).toThrow();
    expect(() => filterQuery(resource, { store_id: "invalid" })).toThrow();
    expect(() => filterQuery(resource, { period_from: "0000-01" })).toThrow();
    expect(() =>
      filterQuery(resource, { period_from: "2026-03", period_to: "2026-02" }),
    ).toThrow();
  });
});

it("rejects visible filter mismatches without inventing relationship reads", () => {
  const resource = syntheticResource("register_observations");
  const row = rowDecoder(resource)(syntheticRow(resource.name));
  expect(
    matchesQuery(resource, row, {
      store_id: syntheticId,
      period_from: "2026-01-01",
      period_to: "2026-01-01",
    }),
  ).toBe(true);
  expect(
    matchesQuery(resource, row, {
      store_id: "00000000-0000-4000-8000-000000000002",
    }),
  ).toBe(false);
  expect(matchesQuery(resource, row, { period_from: "2026-02-01" })).toBe(
    false,
  );
  const store = syntheticResource("stores");
  expect(
    matchesQuery(store, rowDecoder(store)(syntheticRow("stores")), {
      store_id: syntheticId,
    }),
  ).toBe(true);
  const values = syntheticResource("store_typology_values");
  expect(
    matchesQuery(values, rowDecoder(values)(syntheticRow(values.name)), {
      store_id: syntheticId,
    }),
  ).toBe(true);
});

it("rejects non-calendar publication months before opening a detail", () => {
  const resource = syntheticResource("analytics_activity_month");
  const decode = rowDecoder(resource);
  expect(() =>
    decode(syntheticRow(resource.name, { period: "2026-01-02" })),
  ).toThrow();
  expect(() =>
    decode(syntheticRow(resource.name, { period: "0000-01-01" })),
  ).toThrow();
});
