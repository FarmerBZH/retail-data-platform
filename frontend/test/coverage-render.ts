import { expect } from "vitest";
import { formatExact } from "../src/exact-values";
import { fieldLabel } from "../src/published-data";
import type { Node, PublishedRow, Value } from "../src/published-data";
import { publishedContract } from "../src/published-contract";
import { rowDecoder } from "../src/published-data";
import type { ResourceName } from "../src/read-api";
import { syntheticResource } from "./published-fixture";

export function assertDetail(name: ResourceName, raw: Record<string, unknown>) {
  const resource = syntheticResource(name);
  const root = [...document.querySelectorAll("dl")].find((dl) =>
    dl
      .querySelector(":scope > div > dt")
      ?.textContent?.includes(`(${resource.columns[0]})`),
  );
  expect(root, `${name} visible detail`).toBeDefined();
  assertValue(
    rowDecoder(resource)(raw),
    { kind: "object", fields: publishedContract[name].fields },
    root!.parentElement!,
  );
}

// Check each value in its own labelled field, rather than anywhere in the page.
export function assertValue(value: Value, node: Node, element: Element) {
  if (value === null) {
    expect(element.textContent).toBe("Indisponible");
  } else if (node.kind === "object") {
    const fields = Object.entries(node.fields!);
    const children = element.querySelectorAll(":scope > dl > div");
    expect(children).toHaveLength(fields.length);
    fields.forEach(([key, child], index) => {
      const entry = children[index]!;
      expect(entry.querySelector(":scope > dt")?.textContent).toContain(
        `(${key})`,
      );
      expect(fieldLabel(key)).not.toBe("Champ publié");
      assertValue(
        (value as PublishedRow)[key]!,
        child,
        entry.querySelector(":scope > dd")!,
      );
    });
  } else if (node.kind === "list") {
    const values = value as readonly Value[];
    const children = element.querySelectorAll(":scope > details > ol > li");
    expect(children).toHaveLength(values.length);
    if (!values.length)
      expect(element.textContent).toBe("Liste (0 éléments)Liste vide");
    values.forEach((entry, index) =>
      assertValue(entry, node.item!, children[index]!),
    );
  } else {
    expect(element.textContent).toBe(
      node.kind === "boolean"
        ? value
          ? "Oui"
          : "Non"
        : value === ""
          ? "Texte vide"
          : node.kind === "decimal"
            ? formatExact(value as string)
            : String(value),
    );
  }
}
