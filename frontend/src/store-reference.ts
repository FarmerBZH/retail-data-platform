import { formatExact } from "./exact-values";
import {
  boolean,
  decimal,
  nullable,
  object,
  text,
  timestamp,
  uuid,
} from "./api-validation";

function integer(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 2147483647
  )
    throw new Error("Invalid response");
  return value;
}
const string = (maximum: number) => nullable((v: unknown) => text(v, maximum));
const count = nullable(integer);
const amount = nullable(decimal);

// Published store contract only. Unknown fields are not retained or rendered.
export const storeFields = {
  id: { label: "Identifiant", decode: uuid },
  source_key: {
    label: "Clé du référentiel",
    decode: (v: unknown) => text(v, 128),
  },
  external_network_code: { label: "Code réseau externe", decode: string(64) },
  crm_code: { label: "Code CRM", decode: string(64) },
  erp_code: { label: "Code ERP", decode: string(32) },
  legacy_store_id: { label: "Ancien identifiant", decode: string(64) },
  retail_panel_code: { label: "Code panel", decode: string(32) },
  data_sharing_code: { label: "Code de partage", decode: string(64) },
  name: { label: "Nom actuel", decode: string(255) },
  legal_name: { label: "Raison sociale", decode: string(255) },
  address_line_1: { label: "Adresse, ligne 1", decode: string(255) },
  address_line_2: { label: "Adresse, ligne 2", decode: string(255) },
  department_code: { label: "Code département", decode: string(8) },
  postal_code: { label: "Code postal", decode: string(16) },
  city: { label: "Ville actuelle", decode: string(128) },
  retailer_code: { label: "Code enseigne", decode: string(32) },
  retailer_name: { label: "Enseigne actuelle", decode: string(128) },
  store_format: { label: "Format actuel", decode: string(64) },
  region_code: { label: "Code région", decode: string(32) },
  region_name: { label: "Région actuelle", decode: string(128) },
  sales_representative_code: { label: "Code représentant", decode: string(32) },
  sales_representative_name: { label: "Représentant", decode: string(128) },
  promoter_code: { label: "Code promoteur", decode: string(32) },
  promoter_name: { label: "Promoteur", decode: string(128) },
  secondary_representative_code: {
    label: "Code représentant secondaire",
    decode: string(32),
  },
  secondary_representative_name: {
    label: "Représentant secondaire",
    decode: string(128),
  },
  sales_area_sqm: { label: "Surface de vente (m²)", decode: count },
  classification: { label: "Classification", decode: string(64) },
  segmentation: { label: "Segmentation", decode: string(64) },
  distribution_model: { label: "Modèle de distribution", decode: string(64) },
  has_direct_sales_potential: {
    label: "Potentiel de vente directe",
    decode: nullable(boolean),
  },
  survey_validity_days: {
    label: "Validité des relevés (jours)",
    decode: count,
  },
  planned_sales_visits: {
    label: "Visites commerciales prévues",
    decode: count,
  },
  sales_visit_minutes: {
    label: "Durée des visites commerciales (minutes)",
    decode: count,
  },
  planned_promoter_visits: {
    label: "Visites promoteur prévues",
    decode: count,
  },
  promoter_visit_minutes: {
    label: "Durée des visites promoteur (minutes)",
    decode: count,
  },
  planned_total_visits: { label: "Total des visites prévues", decode: count },
  checkout_count: { label: "Nombre de caisses", decode: count },
  annual_turnover_2025_millions: {
    label: "CA déclaré 2025 (millions)",
    decode: amount,
  },
  annual_turnover_2024_millions: {
    label: "CA déclaré 2024 (millions)",
    decode: amount,
  },
  annual_turnover_2023_millions: {
    label: "CA déclaré 2023 (millions)",
    decode: amount,
  },
  october_2023_turnover_millions: {
    label: "CA déclaré octobre 2023 (millions)",
    decode: amount,
  },
  is_active: { label: "Statut actif actuel", decode: boolean },
  created_at: { label: "Création technique", decode: timestamp },
  updated_at: { label: "Mise à jour technique", decode: timestamp },
} as const;
export type StoreReference = Record<
  keyof typeof storeFields,
  string | number | boolean | null
>;

export function storeReference(value: unknown): StoreReference {
  const row = object(value);
  return Object.fromEntries(
    Object.entries(storeFields).map(([key, field]) => [
      key,
      field.decode(row[key]),
    ]),
  ) as StoreReference;
}

export function referenceValue(
  value: StoreReference[keyof StoreReference],
): string {
  if (value === null) return "Indisponible";
  if (value === "") return "Texte vide";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  return typeof value === "number" ? formatExact(String(value)) : value;
}
