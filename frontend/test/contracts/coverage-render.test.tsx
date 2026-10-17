import { render, cleanup } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  PublishedDetail,
  PublishedValue,
} from "../../src/features/data-explorer/PublishedDetail";
import { publishedContract } from "../../src/features/data-explorer/published-contract";
import { resourceNames } from "../../src/api/read-api";
import {
  decodeValue,
  rowDecoder,
} from "../../src/features/data-explorer/published-data";
import type { Node } from "../../src/features/data-explorer/published-data";
import {
  syntheticResource,
  syntheticRow,
  syntheticValue,
} from "../fixtures/published-fixture";
import { assertValue } from "../support/coverage-render";

function nodes(fields: Readonly<Record<string, Node>>): Node[] {
  return Object.values(fields).flatMap((node) => [
    node,
    ...(node.fields ? nodes(node.fields) : []),
    ...(node.item?.fields ? nodes(node.item.fields) : []),
  ]);
}
for (const name of resourceNames) {
  it(`renders every admitted empty/null/boolean state of ${name}, including nested paths`, () => {
    for (const node of nodes(publishedContract[name].fields)) {
      const variants: unknown[] = [syntheticValue(node)];
      if (node.nullable) variants.push(null);
      if (node.kind === "list") variants.push([]);
      if (node.kind === "string") variants.push("");
      if (node.kind === "boolean") variants.push(true);
      for (const raw of variants) {
        const value = decodeValue(raw, node);
        const { container } = render(
          <PublishedValue value={value} node={node} />,
        );
        assertValue(value, node, container);
        cleanup();
      }
    }
  });
}
it("fails the recursive rendering assertion when a displayed field is removed", () => {
  const resource = syntheticResource("products"),
    row = rowDecoder(resource)(syntheticRow("products"));
  const { container } = render(
    <PublishedDetail resource={resource} row={row} />,
  );
  const node: Node = {
    kind: "object",
    fields: publishedContract.products.fields,
  };
  const decoded = decodeValue(row, node);
  assertValue(decoded, node, container);
  container.querySelector("dl > div")!.remove();
  expect(() => assertValue(decoded, node, container)).toThrow();
});
