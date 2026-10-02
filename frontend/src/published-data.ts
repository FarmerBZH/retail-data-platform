import {
  boolean,
  date,
  decimal,
  object,
  text,
  timestamp,
  uuid,
} from "./api-validation";
import { formatExact } from "./exact-values";
import { ApiError, pageQueryKey } from "./read-api";
import type { Query, Resource, ResourceName } from "./read-api";
import { publishedContract } from "./published-contract";
import { storeFields } from "./store-reference";

export type Node = Readonly<{
  kind: string;
  nullable?: boolean;
  maximum?: number;
  fields?: Readonly<Record<string, Node>>;
  item?: Node;
}>;
export type PublishedContract = Record<
  ResourceName,
  Readonly<{
    keys: readonly string[];
    filters: readonly string[];
    operations: boolean;
    fields: Readonly<Record<string, Node>>;
  }>
>;
export type Value =
  | string
  | number
  | boolean
  | null
  | readonly Value[]
  | { readonly [key: string]: Value };
export type PublishedRow = { readonly [key: string]: Value };

const labels: Record<string, string> = {
  period_from: "Mois de début",
  period_to: "Mois de fin",
  activity_ambiguous_types: "Types d’activité ambigus",
  activity_count: "Nombre d’activités",
  activity_details: "Détails des activités",
  activity_type: "Type d’activité",
  ambiguous: "Ambiguïté",
  assortment_id: "Identifiant assortiment",
  average_price: "Prix moyen",
  average_price_change_ratio: "Variation relative du prix moyen",
  average_price_currency: "Devise du prix moyen",
  average_unit_price: "Prix unitaire moyen",
  brand: "Marque",
  calls: "Appels",
  calls_previous_month: "Appels du mois précédent",
  category: "Catégorie",
  category_code: "Code catégorie",
  category_details: "Détails par catégorie",
  category_key: "Clé catégorie",
  category_name: "Nom de catégorie",
  company_value: "Valeur de l’entreprise",
  completed_at: "Fin d’exécution",
  content_quantity: "Quantité de contenu",
  content_unit: "Unité de contenu",
  crowdsourced_visits: "Visites participatives",
  crowdsourced_visits_previous_month:
    "Visites participatives du mois précédent",
  current_is_active: "Statut actif à la publication",
  current_region_code: "Code région à la publication",
  current_retailer_name: "Enseigne à la publication",
  current_store: "Référentiel magasin à la publication",
  current_store_format: "Format magasin à la publication",
  current_store_name: "Nom magasin à la publication",
  dataset: "Jeu de données",
  distribution_ambiguous_products: "Produits ambigus pour la présence",
  distribution_product_count: "Nombre de produits pour la présence",
  distribution_unmatched_products: "Produits non rapprochés pour la présence",
  exact_assortment_candidate_count: "Nombre de candidats exacts d’assortiment",
  field_visits: "Visites terrain",
  field_visits_previous_month: "Visites terrain du mois précédent",
  gtin: "GTIN",
  has_activity: "Activité disponible",
  has_category_data: "Données de catégorie disponibles",
  has_register: "Ventes disponibles",
  has_source_error: "Erreur source présente",
  has_typology: "Typologie disponible",
  inferred_absence_rows: "Lignes d’absence inférée",
  internal_code: "Code interne",
  legacy_erp_code: "Ancien code ERP",
  legacy_internal_code: "Ancien code interne",
  mapped_category_code: "Code catégorie rapproché",
  mapped_retailer_name: "Enseigne rapprochée",
  mapped_typology_value: "Valeur de typologie rapprochée",
  mapping_issue: "Anomalie de correspondance",
  market: "Marché",
  observation_ids: "Identifiants des observations",
  observed_presence_rate: "Taux de présence observé",
  period: "Mois",
  point_of_sale_id: "Identifiant du point de vente",
  presence_value: "Valeur de présence",
  present_products: "Produits présents",
  product_id: "Identifiant produit",
  product_key: "Clé produit",
  product_match_method: "Méthode de rapprochement produit",
  product_match_status: "Statut de rapprochement produit",
  rank: "Rang",
  rank_candidate_count: "Nombre de candidats de rang",
  rank_rule_ids: "Identifiants des règles de rang",
  raw_category_code: "Code catégorie source",
  raw_category_name: "Nom de catégorie source",
  raw_retailer_name: "Enseigne source",
  raw_typology_value: "Valeur de typologie source",
  register_ambiguous_products: "Produits ambigus dans les ventes",
  register_product_count: "Nombre de produits dans les ventes",
  register_revenue_product_count: "Produits avec CA renseigné",
  register_source_row_count: "Lignes sources des ventes",
  register_units_product_count: "Produits avec unités renseignées",
  register_unmatched_product_rows:
    "Lignes de ventes avec produit non rapproché",
  revenue: "CA observé",
  revenue_change_ratio: "Variation relative du CA",
  revenue_month_change: "Variation absolue mensuelle du CA",
  revenue_month_change_ratio: "Variation relative mensuelle du CA",
  revenue_per_unit: "CA par unité",
  revenue_previous_month: "CA du mois précédent",
  revenue_previous_year: "CA du même mois de l’année précédente",
  revenue_reported_rows: "Lignes avec CA renseigné",
  revenue_value: "Valeur du CA",
  revenue_year_change_ratio: "Variation relative annuelle du CA",
  rows_inserted: "Lignes insérées",
  rows_read: "Lignes lues",
  rows_rejected: "Lignes rejetées",
  segment: "Segment",
  share: "Part",
  shelf_ambiguous: "Ambiguïté du linéaire",
  shelf_company_value: "Valeur de linéaire de l’entreprise",
  shelf_share: "Part de linéaire",
  shelf_source_row_count: "Lignes sources de linéaire",
  shelf_total_value: "Valeur totale de linéaire",
  snapshot_id: "Identifiant instantané",
  source_brand: "Marque source",
  source_category_name: "Nom de catégorie source",
  source_customer_code: "Code client source",
  source_family: "Famille source",
  source_gtin: "GTIN source",
  source_info: "Informations sources",
  source_kind: "Type de source",
  source_kinds: "Types de sources",
  source_product_label: "Libellé produit source",
  source_product_name: "Nom produit source",
  source_product_reference: "Référence produit source",
  source_retailer_name: "Enseigne source",
  source_row_count: "Nombre de lignes sources",
  source_run_ids: "Identifiants des imports sources",
  source_snapshot_at: "Date de l’instantané source",
  source_store_label: "Libellé magasin source",
  source_store_reference: "Référence magasin source",
  source_store_secondary_reference: "Référence magasin secondaire source",
  source_typology_value: "Valeur de typologie source",
  started_at: "Début d’exécution",
  status: "Statut",
  store_id: "Identifiant magasin",
  store_match_method: "Méthode de rapprochement magasin",
  store_match_status: "Statut de rapprochement magasin",
  total_value: "Valeur totale",
  typology_details: "Détails des typologies",
  typology_mapping_rule_id:
    "Identifiant règle de correspondance des typologies",
  typology_match_method: "Méthode de rapprochement typologie",
  typology_match_status: "Statut de rapprochement typologie",
  typology_rank_rule_id: "Identifiant règle de rang des typologies",
  typology_snapshot_count: "Nombre d’instantanés de typologie",
  typology_snapshot_ids: "Identifiants des instantanés de typologie",
  typology_value: "Valeur de typologie",
  typology_value_id: "Identifiant valeur de typologie",
  typology_value_ids: "Identifiants des valeurs de typologie",
  unambiguous_reported_revenue: "CA renseigné non ambigu",
  unambiguous_reported_units: "Unités renseignées non ambiguës",
  units: "Unités observées",
  units_change_ratio: "Variation relative des unités",
  units_previous_month: "Unités du mois précédent",
  units_reported_rows: "Lignes avec unités renseignées",
  units_sold: "Unités vendues",
  unmatched_product_rows: "Lignes avec produit non rapproché",
  value_origin: "Origine de la valeur",
  volume: "Volume",
  volume_change_ratio: "Variation relative du volume",
  volume_value: "Valeur du volume",
};
export function fieldLabel(key: string): string {
  return (
    (storeFields as Record<string, { label: string }>)[key]?.label ??
    labels[key] ??
    "Champ publié"
  );
}
export function decodeValue(value: unknown, node: Node): Value {
  if (value === null && node.nullable) return null;
  switch (node.kind) {
    case "object": {
      const row = object(value);
      return Object.fromEntries(
        Object.entries(node.fields!).map(([key, child]) => {
          const decoded = decodeValue(row[key], child);
          if (
            key === "period" &&
            child.kind === "date" &&
            typeof decoded === "string" &&
            (decoded.startsWith("0000-") || !decoded.endsWith("-01"))
          )
            throw new Error("Invalid month");
          return [key, decoded];
        }),
      );
    }
    case "list":
      if (!Array.isArray(value)) throw new Error("Invalid response");
      return value.map((entry: unknown) => decodeValue(entry, node.item!));
    case "integer":
      if (typeof value !== "number" || !Number.isSafeInteger(value))
        throw new Error("Invalid response");
      return value;
    case "boolean":
      return boolean(value);
    case "uuid":
      return uuid(value);
    case "date":
      return date(value);
    case "date-time":
      return timestamp(value);
    case "decimal": {
      const result = decimal(value);
      formatExact(result);
      return result;
    }
    case "string":
      return text(value, node.maximum ?? 2_000_000);
    default:
      throw new Error("Invalid contract");
  }
}
export function availableResources(
  catalog: readonly Resource[],
): readonly Resource[] {
  return catalog
    .filter((resource) => !publishedContract[resource.name].operations)
    .map((resource) => {
      const contract = publishedContract[resource.name];
      if (
        resource.columns.some((key) => !Object.hasOwn(contract.fields, key)) ||
        JSON.stringify(resource.keys) !== JSON.stringify(contract.keys) ||
        resource.filters.some((key) => !contract.filters.includes(key))
      )
        throw new ApiError("invalid-response");
      return resource;
    });
}
export function rowDecoder(resource: Resource) {
  const fields = Object.fromEntries(
    resource.columns.map((key) => [
      key,
      publishedContract[resource.name].fields[key]!,
    ]),
  );
  return (value: unknown): PublishedRow =>
    decodeValue(value, { kind: "object", fields }) as PublishedRow;
}
export function rowKey(resource: Resource, row: PublishedRow): string {
  if (!resource.keys.length) throw new ApiError("invalid-response");
  return JSON.stringify(
    resource.keys.map((key) => {
      const value = row[key];
      if (typeof value !== "string") throw new ApiError("invalid-response");
      return value;
    }),
  );
}
export function detailQuery(resource: Resource, row: PublishedRow): Query {
  rowKey(resource, row);
  const result: Record<string, string | number> = { limit: 1 };
  for (const key of resource.keys) {
    if (!resource.filters.includes(key)) throw new ApiError("invalid-response");
    const value = row[key] as string;
    if (key === "period") {
      result.period_from = value;
      result.period_to = value;
    } else result[key] = value;
  }
  pageQueryKey(resource.name, result);
  return result;
}
export function filterQuery(
  resource: Resource,
  draft: Record<string, string>,
): Query {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (!value) continue;
    const field = key === "period_from" || key === "period_to" ? "period" : key;
    if (!resource.filters.includes(field))
      throw new ApiError("invalid-request");
    if (field === "period" && !/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(value))
      throw new ApiError("invalid-request");
    result[key] = field === "period" ? `${value}-01` : value;
  }
  pageQueryKey(resource.name, result);
  return result;
}
export function resourceGroup(name: ResourceName): string {
  return name.startsWith("analytics_")
    ? "Analyses mensuelles"
    : [
          "numeric_distribution_observations",
          "register_observations",
          "shelf_share_observations",
          "store_activity_metrics",
        ].includes(name)
      ? "Observations"
      : "Référentiels";
}
export const resourceLabels: Record<ResourceName, string> = {
  analytics_activity_month: "Activité mensuelle par type",
  analytics_assortment_candidates: "Candidats exacts d’assortiment",
  analytics_distribution_product_month: "Présence mensuelle par produit",
  analytics_monthly_link_quality: "Qualité mensuelle du rapprochement",
  analytics_refresh_runs: "Publications analytiques",
  analytics_register_product_month: "Ventes mensuelles par produit",
  analytics_retailer_assortment_month: "Assortiments mensuels par enseigne",
  analytics_shelf_category_month: "Linéaire mensuel par catégorie",
  analytics_store_category_month: "Synthèse mensuelle par catégorie",
  analytics_store_month: "Synthèse mensuelle du magasin",
  analytics_store_month_changes: "Évolutions mensuelles du magasin",
  analytics_typology_month: "Typologies mensuelles",
  assortments: "Assortiments",
  import_runs: "Imports",
  numeric_distribution_observations: "Observations de présence",
  products: "Produits",
  register_observations: "Observations de ventes",
  shelf_share_observations: "Observations de linéaire",
  store_activity_metrics: "Observations d’activité",
  store_typology_values: "Valeurs de typologie",
  stores: "Magasins",
  typology_mapping_rules: "Règles de correspondance des typologies",
  typology_rank_rules: "Règles de rang des typologies",
  typology_snapshots: "Instantanés des typologies",
};

// Validate visible filter values. The typology-value store filter is a server-side
// snapshot relation, not a published field; no extra relationship reads are made.
export function matchesQuery(
  resource: Resource,
  row: PublishedRow,
  query: Query,
): boolean {
  return Object.entries(query).every(([key, expected]) => {
    if (key === "limit" || key === "after") return true;
    if (resource.name === "store_typology_values" && key === "store_id")
      return true;
    const field = key.startsWith("period_")
      ? "period"
      : resource.name === "stores" && key === "store_id"
        ? "id"
        : key;
    if (!resource.columns.includes(field)) return true;
    const actual = row[field];
    if (typeof actual !== "string" || typeof expected !== "string")
      return false;
    if (key === "period_from") return actual >= expected;
    if (key === "period_to") return actual <= expected;
    return key === "id" || key.endsWith("_id")
      ? actual.toLowerCase() === expected.toLowerCase()
      : actual === expected;
  });
}
