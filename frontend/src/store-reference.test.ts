import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { syntheticStore } from "../test/store-fixture";
import { referenceValue, storeFields, storeReference } from "./store-reference";

describe("published store reference", () => {
  it("covers exactly the public store contract and discards unknown fields", () => {
    const registry = JSON.parse(
      readFileSync("../src/retail_data_platform/api/resources.json", "utf8"),
    ) as { stores: { columns: string[] } };
    const reference = storeReference({
      ...syntheticStore(),
      unlisted: "synthetic-hidden",
    });
    expect(Object.keys(storeFields).sort()).toEqual(
      [...registry.stores.columns].sort(),
    );
    expect(Object.keys(reference).sort()).toEqual(
      [...registry.stores.columns].sort(),
    );
    expect(Object.keys(syntheticStore()).sort()).toEqual(
      [...registry.stores.columns].sort(),
    );
    expect(
      Object.values(storeFields).every((field) => field.label.length > 0),
    ).toBe(true);
  });
  it("preserves exact decimals, identifiers, zero, absence and false", () => {
    const reference = storeReference(
      syntheticStore({
        postal_code: "00123",
        annual_turnover_2025_millions: "1234567890.12",
        checkout_count: 0,
        has_direct_sales_potential: false,
      }),
    );
    expect(reference.postal_code).toBe("00123");
    expect(referenceValue(reference.annual_turnover_2025_millions)).toBe(
      "1234567890.12",
    );
    expect(referenceValue(reference.checkout_count)).toBe("0");
    expect(referenceValue(reference.has_direct_sales_potential)).toBe("Non");
    expect(referenceValue(reference.city)).toBe("Indisponible");
    expect(referenceValue("")).toBe("Texte vide");
    expect(referenceValue(1234)).toBe("1\u202f234");
  });
  it.each([
    { checkout_count: 0.5 },
    { checkout_count: 2147483648 },
    { has_direct_sales_potential: "false" },
    { annual_turnover_2025_millions: 0.1 },
    { created_at: "invalid" },
    { source_key: undefined },
  ])("rejects malformed published values", (values) => {
    expect(() => storeReference(syntheticStore(values))).toThrow();
  });
});
