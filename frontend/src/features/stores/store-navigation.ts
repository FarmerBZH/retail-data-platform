import { initialStoreContext } from "../../shared/month-period";
import type { StoreContext } from "../../shared/month-period";

export type StoreNavigation = {
  position: { index: number; cursors: (string | undefined)[] };
  selected: Set<string>;
  opened: string | undefined;
  context: StoreContext;
  sort: string;
};
export function initialStoreNavigation(): StoreNavigation {
  return {
    position: { index: 0, cursors: [undefined] },
    selected: new Set(),
    opened: undefined,
    context: initialStoreContext,
    sort: "api",
  };
}
