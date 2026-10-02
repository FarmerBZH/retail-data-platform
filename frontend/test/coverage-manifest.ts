import { publishedContract } from "../src/published-contract";
import type { Node } from "../src/published-data";
import { resourceNames } from "../src/read-api";

// One entry per published field/path. Operations routes remain deferred to T20;
// rendering a synthetic component is not evidence that an operational screen exists.
export const coverageManifest = resourceNames.flatMap((resource) => {
  const entries: {
    resource: string;
    field: string;
    path: string;
    component: string;
    test: string;
    access: string;
  }[] = [];
  function visit(fields: Readonly<Record<string, Node>>, prefix = "") {
    for (const [field, node] of Object.entries(fields)) {
      const path = `${prefix}${field}`;
      entries.push({
        resource,
        field,
        path,
        component: "PublishedDetail / PublishedValue",
        test: `published-data.test.tsx: renders every field and nested path of ${resource} using synthetic values`,
        access: publishedContract[resource].operations
          ? "T20 pending; synthetic rendering only"
          : "DataExplorer",
      });
      if (node.kind === "object") visit(node.fields!, `${path}.`);
      if (node.kind === "list" && node.item?.kind === "object")
        visit(node.item.fields!, `${path}[].`);
    }
  }
  visit(publishedContract[resource].fields);
  return entries;
});
