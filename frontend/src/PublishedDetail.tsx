import { useState } from "react";
import { Box, Pagination, Typography } from "@mui/material";
import { fieldLabel } from "./published-data";
import type { Node, PublishedRow, Value } from "./published-data";
import { publishedContract } from "./published-contract";
import type { Resource } from "./read-api";
import { formatExact } from "./exact-values";

export function PublishedValue({ value, node }: { value: Value; node: Node }) {
  if (value === null)
    return <Typography component="span">Indisponible</Typography>;
  if (node.kind === "list")
    return (
      <PublishedList values={value as readonly Value[]} item={node.item!} />
    );
  if (node.kind === "object")
    return <Fields row={value as PublishedRow} fields={node.fields!} />;
  return (
    <Typography
      component="span"
      sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
    >
      {typeof value === "boolean"
        ? value
          ? "Oui"
          : "Non"
        : value === ""
          ? "Texte vide"
          : node.kind === "decimal"
            ? formatExact(value as string)
            : String(value)}
    </Typography>
  );
}
function Fields({
  row,
  fields,
}: {
  row: PublishedRow;
  fields: Readonly<Record<string, Node>>;
}) {
  return (
    <Box component="dl" sx={{ m: 0 }}>
      {Object.entries(fields).map(([key, node]) => (
        <Box key={key} sx={{ py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Typography
            component="dt"
            sx={{ fontWeight: 600, overflowWrap: "anywhere" }}
          >
            {fieldLabel(key)}{" "}
            <Typography component="span" variant="body2">
              ({key})
            </Typography>
          </Typography>
          <Box component="dd" sx={{ m: 0, minWidth: 0 }}>
            <PublishedValue value={row[key]!} node={node} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}
export function PublishedDetail({
  resource,
  row,
}: {
  resource: Resource;
  row: PublishedRow;
}) {
  const fields = Object.fromEntries(
    resource.columns.map((key) => [
      key,
      publishedContract[resource.name].fields[key]!,
    ]),
  );
  return <Fields row={row} fields={fields} />;
}

const LIST_PAGE_SIZE = 50;
function PublishedList({
  values,
  item,
}: {
  values: readonly Value[];
  item: Node;
}) {
  const [position, setPosition] = useState(1);
  const pages = Math.max(1, Math.ceil(values.length / LIST_PAGE_SIZE));
  const page = Math.min(position, pages);
  const start = (page - 1) * LIST_PAGE_SIZE;
  return (
    <Box component="details">
      <Box component="summary" sx={{ cursor: "pointer", py: 1 }}>
        Liste ({values.length} éléments)
      </Box>
      {values.length === 0 ? (
        <Typography>Liste vide</Typography>
      ) : (
        <>
          <Box component="ol" start={start + 1} sx={{ pl: 3 }}>
            {values.slice(start, start + LIST_PAGE_SIZE).map((entry, index) => (
              <Box component="li" key={start + index} sx={{ py: 1 }}>
                <PublishedValue value={entry} node={item} />
              </Box>
            ))}
          </Box>
          {pages > 1 && (
            <>
              <Typography>
                Éléments {start + 1} à{" "}
                {Math.min(start + LIST_PAGE_SIZE, values.length)} sur{" "}
                {values.length}. Pagination locale, sans lecture supplémentaire.
              </Typography>
              <Pagination
                count={pages}
                page={page}
                onChange={(_event, next) => setPosition(next)}
                showFirstButton
                showLastButton
                size="small"
                sx={{
                  "& .MuiPagination-ul": { flexWrap: "wrap" },
                  "& .MuiPaginationItem-root": { minWidth: 44, minHeight: 44 },
                }}
                getItemAriaLabel={(type, number, selected) =>
                  type === "page"
                    ? `${selected ? "Page actuelle" : "Aller à la page"} ${number} de la liste`
                    : {
                        first: "Première page de la liste",
                        last: "Dernière page de la liste",
                        next: "Page suivante de la liste",
                        previous: "Page précédente de la liste",
                        "start-ellipsis": "Pages précédentes",
                        "end-ellipsis": "Pages suivantes",
                      }[type]
                }
              />
            </>
          )}
        </>
      )}
    </Box>
  );
}
