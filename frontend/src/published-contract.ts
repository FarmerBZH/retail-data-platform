// Public projection snapshot from resources.json and resources.py row models.
// No database-only fields; update with the coverage contract when the API changes.
import type { PublishedContract } from "./published-data";
export const publishedContract: PublishedContract = {
  analytics_activity_month: {
    keys: ["store_id", "period", "activity_type"],
    filters: ["store_id", "period", "activity_type"],
    operations: false,
    fields: {
      store_id: {
        kind: "uuid",
      },
      period: {
        kind: "date",
      },
      activity_type: {
        kind: "string",
        maximum: 32,
      },
      source_row_count: {
        kind: "integer",
        nullable: true,
      },
      ambiguous: {
        kind: "boolean",
        nullable: true,
      },
      activity_count: {
        kind: "integer",
        nullable: true,
      },
      observation_ids: {
        kind: "list",
        item: {
          kind: "uuid",
        },
        nullable: true,
      },
    },
  },
  analytics_assortment_candidates: {
    keys: ["store_id", "period", "assortment_id"],
    filters: ["store_id", "product_id", "period", "assortment_id"],
    operations: false,
    fields: {
      store_id: {
        kind: "uuid",
      },
      period: {
        kind: "date",
      },
      assortment_id: {
        kind: "uuid",
      },
      product_id: {
        kind: "uuid",
        nullable: true,
      },
      gtin: {
        kind: "string",
        nullable: true,
        maximum: 14,
      },
      typology_rank_rule_id: {
        kind: "uuid",
        nullable: true,
      },
      typology_value_ids: {
        kind: "list",
        item: {
          kind: "uuid",
        },
        nullable: true,
      },
    },
  },
  analytics_distribution_product_month: {
    keys: ["store_id", "period", "category_code", "product_key"],
    filters: [
      "store_id",
      "product_id",
      "period",
      "category_code",
      "product_key",
    ],
    operations: false,
    fields: {
      store_id: {
        kind: "uuid",
      },
      period: {
        kind: "date",
      },
      category_code: {
        kind: "string",
        maximum: 32,
      },
      product_key: {
        kind: "string",
      },
      product_id: {
        kind: "uuid",
        nullable: true,
      },
      source_row_count: {
        kind: "integer",
        nullable: true,
      },
      ambiguous: {
        kind: "boolean",
        nullable: true,
      },
      presence_value: {
        kind: "integer",
        nullable: true,
      },
      inferred_absence_rows: {
        kind: "integer",
        nullable: true,
      },
      observation_ids: {
        kind: "list",
        item: {
          kind: "uuid",
        },
        nullable: true,
      },
    },
  },
  analytics_monthly_link_quality: {
    keys: ["dataset", "period", "store_match_status"],
    filters: ["period", "dataset", "store_match_status"],
    operations: false,
    fields: {
      dataset: {
        kind: "string",
      },
      period: {
        kind: "date",
      },
      store_match_status: {
        kind: "string",
        maximum: 16,
      },
      source_row_count: {
        kind: "integer",
        nullable: true,
      },
    },
  },
  analytics_refresh_runs: {
    keys: ["id"],
    filters: ["id"],
    operations: true,
    fields: {
      id: {
        kind: "uuid",
      },
      status: {
        kind: "string",
        maximum: 16,
      },
      started_at: {
        kind: "date-time",
      },
      source_snapshot_at: {
        kind: "date-time",
        nullable: true,
      },
      completed_at: {
        kind: "date-time",
        nullable: true,
      },
      source_run_ids: {
        kind: "list",
        item: {
          kind: "uuid",
        },
        nullable: true,
      },
    },
  },
  analytics_register_product_month: {
    keys: ["store_id", "period", "source_gtin"],
    filters: ["store_id", "product_id", "period", "source_gtin"],
    operations: false,
    fields: {
      store_id: {
        kind: "uuid",
      },
      period: {
        kind: "date",
      },
      source_gtin: {
        kind: "string",
        maximum: 14,
      },
      product_id: {
        kind: "uuid",
        nullable: true,
      },
      source_row_count: {
        kind: "integer",
        nullable: true,
      },
      ambiguous: {
        kind: "boolean",
        nullable: true,
      },
      unmatched_product_rows: {
        kind: "integer",
        nullable: true,
      },
      observation_ids: {
        kind: "list",
        item: {
          kind: "uuid",
        },
        nullable: true,
      },
      source_kinds: {
        kind: "list",
        item: {
          kind: "string",
        },
        nullable: true,
      },
      revenue: {
        kind: "decimal",
        nullable: true,
      },
      units: {
        kind: "integer",
        nullable: true,
      },
      volume: {
        kind: "decimal",
        nullable: true,
      },
      revenue_reported_rows: {
        kind: "integer",
        nullable: true,
      },
      units_reported_rows: {
        kind: "integer",
        nullable: true,
      },
    },
  },
  analytics_retailer_assortment_month: {
    keys: ["store_id", "period", "assortment_id"],
    filters: ["store_id", "product_id", "period", "assortment_id"],
    operations: false,
    fields: {
      store_id: {
        kind: "uuid",
      },
      period: {
        kind: "date",
      },
      assortment_id: {
        kind: "uuid",
      },
      product_id: {
        kind: "uuid",
        nullable: true,
      },
      gtin: {
        kind: "string",
        nullable: true,
        maximum: 14,
      },
      product_match_status: {
        kind: "string",
        nullable: true,
        maximum: 16,
      },
      typology_match_status: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
    },
  },
  analytics_shelf_category_month: {
    keys: ["store_id", "period", "category_code"],
    filters: ["store_id", "period", "category_code"],
    operations: false,
    fields: {
      store_id: {
        kind: "uuid",
      },
      period: {
        kind: "date",
      },
      category_code: {
        kind: "string",
        maximum: 32,
      },
      source_row_count: {
        kind: "integer",
        nullable: true,
      },
      ambiguous: {
        kind: "boolean",
        nullable: true,
      },
      company_value: {
        kind: "decimal",
        nullable: true,
      },
      total_value: {
        kind: "decimal",
        nullable: true,
      },
      shelf_share: {
        kind: "decimal",
        nullable: true,
      },
      observation_ids: {
        kind: "list",
        item: {
          kind: "uuid",
        },
        nullable: true,
      },
    },
  },
  analytics_store_category_month: {
    keys: ["store_id", "period", "category_code"],
    filters: ["store_id", "period", "category_code"],
    operations: false,
    fields: {
      store_id: {
        kind: "uuid",
      },
      period: {
        kind: "date",
      },
      category_code: {
        kind: "string",
        maximum: 32,
      },
      distribution_product_count: {
        kind: "integer",
        nullable: true,
      },
      distribution_ambiguous_products: {
        kind: "integer",
        nullable: true,
      },
      distribution_unmatched_products: {
        kind: "integer",
        nullable: true,
      },
      inferred_absence_rows: {
        kind: "decimal",
        nullable: true,
      },
      present_products: {
        kind: "integer",
        nullable: true,
      },
      observed_presence_rate: {
        kind: "decimal",
        nullable: true,
      },
      shelf_source_row_count: {
        kind: "integer",
        nullable: true,
      },
      shelf_ambiguous: {
        kind: "boolean",
        nullable: true,
      },
      shelf_company_value: {
        kind: "decimal",
        nullable: true,
      },
      shelf_total_value: {
        kind: "decimal",
        nullable: true,
      },
      shelf_share: {
        kind: "decimal",
        nullable: true,
      },
      exact_assortment_candidate_count: {
        kind: "integer",
        nullable: true,
      },
    },
  },
  analytics_store_month: {
    keys: ["store_id", "period"],
    filters: ["store_id", "period"],
    operations: false,
    fields: {
      store_id: {
        kind: "uuid",
      },
      period: {
        kind: "date",
      },
      current_store_name: {
        kind: "string",
        nullable: true,
        maximum: 255,
      },
      current_retailer_name: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      current_store_format: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      current_region_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      current_is_active: {
        kind: "boolean",
        nullable: true,
      },
      current_store: {
        kind: "object",
        fields: {
          id: {
            kind: "uuid",
          },
          source_key: {
            kind: "string",
          },
          external_network_code: {
            kind: "string",
            nullable: true,
          },
          crm_code: {
            kind: "string",
            nullable: true,
          },
          erp_code: {
            kind: "string",
            nullable: true,
          },
          legacy_store_id: {
            kind: "string",
            nullable: true,
          },
          retail_panel_code: {
            kind: "string",
            nullable: true,
          },
          data_sharing_code: {
            kind: "string",
            nullable: true,
          },
          name: {
            kind: "string",
            nullable: true,
          },
          legal_name: {
            kind: "string",
            nullable: true,
          },
          address_line_1: {
            kind: "string",
            nullable: true,
          },
          address_line_2: {
            kind: "string",
            nullable: true,
          },
          department_code: {
            kind: "string",
            nullable: true,
          },
          postal_code: {
            kind: "string",
            nullable: true,
          },
          city: {
            kind: "string",
            nullable: true,
          },
          retailer_code: {
            kind: "string",
            nullable: true,
          },
          retailer_name: {
            kind: "string",
            nullable: true,
          },
          store_format: {
            kind: "string",
            nullable: true,
          },
          region_code: {
            kind: "string",
            nullable: true,
          },
          region_name: {
            kind: "string",
            nullable: true,
          },
          sales_representative_code: {
            kind: "string",
            nullable: true,
          },
          sales_representative_name: {
            kind: "string",
            nullable: true,
          },
          promoter_code: {
            kind: "string",
            nullable: true,
          },
          promoter_name: {
            kind: "string",
            nullable: true,
          },
          secondary_representative_code: {
            kind: "string",
            nullable: true,
          },
          secondary_representative_name: {
            kind: "string",
            nullable: true,
          },
          sales_area_sqm: {
            kind: "integer",
            nullable: true,
          },
          classification: {
            kind: "string",
            nullable: true,
          },
          segmentation: {
            kind: "string",
            nullable: true,
          },
          distribution_model: {
            kind: "string",
            nullable: true,
          },
          has_direct_sales_potential: {
            kind: "boolean",
            nullable: true,
          },
          survey_validity_days: {
            kind: "integer",
            nullable: true,
          },
          planned_sales_visits: {
            kind: "integer",
            nullable: true,
          },
          sales_visit_minutes: {
            kind: "integer",
            nullable: true,
          },
          planned_promoter_visits: {
            kind: "integer",
            nullable: true,
          },
          promoter_visit_minutes: {
            kind: "integer",
            nullable: true,
          },
          planned_total_visits: {
            kind: "integer",
            nullable: true,
          },
          checkout_count: {
            kind: "integer",
            nullable: true,
          },
          annual_turnover_2025_millions: {
            kind: "decimal",
            nullable: true,
          },
          annual_turnover_2024_millions: {
            kind: "decimal",
            nullable: true,
          },
          annual_turnover_2023_millions: {
            kind: "decimal",
            nullable: true,
          },
          october_2023_turnover_millions: {
            kind: "decimal",
            nullable: true,
          },
          is_active: {
            kind: "boolean",
          },
          created_at: {
            kind: "date-time",
          },
          updated_at: {
            kind: "date-time",
          },
        },
        nullable: true,
      },
      register_product_count: {
        kind: "integer",
        nullable: true,
      },
      register_source_row_count: {
        kind: "decimal",
        nullable: true,
      },
      register_ambiguous_products: {
        kind: "integer",
        nullable: true,
      },
      register_unmatched_product_rows: {
        kind: "decimal",
        nullable: true,
      },
      register_revenue_product_count: {
        kind: "integer",
        nullable: true,
      },
      register_units_product_count: {
        kind: "integer",
        nullable: true,
      },
      revenue: {
        kind: "decimal",
        nullable: true,
      },
      units: {
        kind: "decimal",
        nullable: true,
      },
      revenue_per_unit: {
        kind: "decimal",
        nullable: true,
      },
      unambiguous_reported_revenue: {
        kind: "decimal",
        nullable: true,
      },
      unambiguous_reported_units: {
        kind: "decimal",
        nullable: true,
      },
      calls: {
        kind: "integer",
        nullable: true,
      },
      field_visits: {
        kind: "integer",
        nullable: true,
      },
      crowdsourced_visits: {
        kind: "integer",
        nullable: true,
      },
      activity_ambiguous_types: {
        kind: "integer",
        nullable: true,
      },
      activity_details: {
        kind: "list",
        item: {
          kind: "object",
          fields: {
            activity_type: {
              kind: "string",
            },
            source_row_count: {
              kind: "integer",
              nullable: true,
            },
            ambiguous: {
              kind: "boolean",
              nullable: true,
            },
            activity_count: {
              kind: "integer",
              nullable: true,
            },
            observation_ids: {
              kind: "list",
              item: {
                kind: "uuid",
              },
              nullable: true,
            },
          },
        },
        nullable: true,
      },
      category_details: {
        kind: "list",
        item: {
          kind: "object",
          fields: {
            category_code: {
              kind: "string",
            },
            distribution_product_count: {
              kind: "integer",
              nullable: true,
            },
            distribution_ambiguous_products: {
              kind: "integer",
              nullable: true,
            },
            distribution_unmatched_products: {
              kind: "integer",
              nullable: true,
            },
            inferred_absence_rows: {
              kind: "decimal",
              nullable: true,
            },
            present_products: {
              kind: "integer",
              nullable: true,
            },
            observed_presence_rate: {
              kind: "decimal",
              nullable: true,
            },
            shelf_source_row_count: {
              kind: "integer",
              nullable: true,
            },
            shelf_ambiguous: {
              kind: "boolean",
              nullable: true,
            },
            shelf_company_value: {
              kind: "decimal",
              nullable: true,
            },
            shelf_total_value: {
              kind: "decimal",
              nullable: true,
            },
            shelf_share: {
              kind: "decimal",
              nullable: true,
            },
            exact_assortment_candidate_count: {
              kind: "integer",
              nullable: true,
            },
          },
        },
        nullable: true,
      },
      typology_details: {
        kind: "list",
        item: {
          kind: "object",
          fields: {
            typology_value_id: {
              kind: "uuid",
            },
            snapshot_id: {
              kind: "uuid",
              nullable: true,
            },
            retailer_name: {
              kind: "string",
              nullable: true,
            },
            region_code: {
              kind: "string",
              nullable: true,
            },
            sales_representative_code: {
              kind: "string",
              nullable: true,
            },
            category_key: {
              kind: "string",
              nullable: true,
            },
            category_name: {
              kind: "string",
              nullable: true,
            },
            typology_value: {
              kind: "string",
              nullable: true,
            },
            rank_rule_ids: {
              kind: "list",
              item: {
                kind: "uuid",
              },
              nullable: true,
            },
            rank_candidate_count: {
              kind: "integer",
              nullable: true,
            },
            mapping_issue: {
              kind: "boolean",
              nullable: true,
            },
          },
        },
        nullable: true,
      },
      typology_snapshot_count: {
        kind: "integer",
        nullable: true,
      },
      typology_snapshot_ids: {
        kind: "list",
        item: {
          kind: "uuid",
        },
        nullable: true,
      },
      has_register: {
        kind: "boolean",
        nullable: true,
      },
      has_activity: {
        kind: "boolean",
        nullable: true,
      },
      has_category_data: {
        kind: "boolean",
        nullable: true,
      },
      has_typology: {
        kind: "boolean",
        nullable: true,
      },
    },
  },
  analytics_store_month_changes: {
    keys: ["store_id", "period"],
    filters: ["store_id", "period"],
    operations: false,
    fields: {
      store_id: {
        kind: "uuid",
      },
      period: {
        kind: "date",
      },
      revenue: {
        kind: "decimal",
        nullable: true,
      },
      units: {
        kind: "decimal",
        nullable: true,
      },
      calls: {
        kind: "integer",
        nullable: true,
      },
      field_visits: {
        kind: "integer",
        nullable: true,
      },
      crowdsourced_visits: {
        kind: "integer",
        nullable: true,
      },
      revenue_previous_month: {
        kind: "decimal",
        nullable: true,
      },
      revenue_previous_year: {
        kind: "decimal",
        nullable: true,
      },
      units_previous_month: {
        kind: "decimal",
        nullable: true,
      },
      calls_previous_month: {
        kind: "integer",
        nullable: true,
      },
      field_visits_previous_month: {
        kind: "integer",
        nullable: true,
      },
      crowdsourced_visits_previous_month: {
        kind: "integer",
        nullable: true,
      },
      revenue_month_change: {
        kind: "decimal",
        nullable: true,
      },
      revenue_month_change_ratio: {
        kind: "decimal",
        nullable: true,
      },
      revenue_year_change_ratio: {
        kind: "decimal",
        nullable: true,
      },
    },
  },
  analytics_typology_month: {
    keys: ["typology_value_id"],
    filters: ["store_id", "period", "typology_value_id"],
    operations: false,
    fields: {
      store_id: {
        kind: "uuid",
        nullable: true,
      },
      period: {
        kind: "date",
        nullable: true,
      },
      typology_value_id: {
        kind: "uuid",
      },
      snapshot_id: {
        kind: "uuid",
        nullable: true,
      },
      retailer_name: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      region_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      sales_representative_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      category_key: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      category_name: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      typology_value: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      rank_rule_ids: {
        kind: "list",
        item: {
          kind: "uuid",
        },
        nullable: true,
      },
      rank_candidate_count: {
        kind: "integer",
        nullable: true,
      },
      mapping_issue: {
        kind: "boolean",
        nullable: true,
      },
    },
  },
  assortments: {
    keys: ["id"],
    filters: ["id", "product_id", "period"],
    operations: false,
    fields: {
      id: {
        kind: "uuid",
      },
      source_key: {
        kind: "string",
        maximum: 64,
      },
      period: {
        kind: "date",
      },
      product_id: {
        kind: "uuid",
        nullable: true,
      },
      product_match_status: {
        kind: "string",
        maximum: 16,
      },
      typology_mapping_rule_id: {
        kind: "uuid",
        nullable: true,
      },
      typology_rank_rule_id: {
        kind: "uuid",
        nullable: true,
      },
      typology_match_status: {
        kind: "string",
        maximum: 32,
      },
      typology_match_method: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      source_retailer_name: {
        kind: "string",
        maximum: 128,
      },
      source_category_name: {
        kind: "string",
        maximum: 128,
      },
      source_product_name: {
        kind: "string",
        maximum: 255,
      },
      gtin: {
        kind: "string",
        maximum: 14,
      },
      source_typology_value: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
    },
  },
  import_runs: {
    keys: ["id"],
    filters: ["id"],
    operations: true,
    fields: {
      id: {
        kind: "uuid",
      },
      dataset: {
        kind: "string",
        maximum: 64,
      },
      status: {
        kind: "string",
        maximum: 16,
      },
      rows_read: {
        kind: "integer",
      },
      rows_inserted: {
        kind: "integer",
      },
      rows_rejected: {
        kind: "integer",
      },
      started_at: {
        kind: "date-time",
      },
      completed_at: {
        kind: "date-time",
        nullable: true,
      },
    },
  },
  numeric_distribution_observations: {
    keys: ["id"],
    filters: ["id", "store_id", "product_id", "period"],
    operations: false,
    fields: {
      id: {
        kind: "uuid",
      },
      source_key: {
        kind: "string",
        maximum: 64,
      },
      period: {
        kind: "date",
      },
      category_code: {
        kind: "string",
        maximum: 32,
      },
      store_id: {
        kind: "uuid",
        nullable: true,
      },
      store_match_status: {
        kind: "string",
        maximum: 16,
      },
      store_match_method: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      product_id: {
        kind: "uuid",
        nullable: true,
      },
      product_match_status: {
        kind: "string",
        maximum: 16,
      },
      product_match_method: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      presence_value: {
        kind: "integer",
      },
      value_origin: {
        kind: "string",
        maximum: 24,
      },
      source_category_name: {
        kind: "string",
        maximum: 128,
      },
      source_store_reference: {
        kind: "string",
        maximum: 128,
      },
      source_store_label: {
        kind: "string",
        maximum: 512,
      },
      source_product_reference: {
        kind: "string",
        maximum: 128,
      },
      source_product_label: {
        kind: "string",
        maximum: 512,
      },
    },
  },
  products: {
    keys: ["id"],
    filters: ["id"],
    operations: false,
    fields: {
      id: {
        kind: "uuid",
      },
      gtin: {
        kind: "string",
        maximum: 14,
      },
      erp_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      legacy_erp_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      internal_code: {
        kind: "string",
        maximum: 64,
      },
      legacy_internal_code: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      name: {
        kind: "string",
        maximum: 255,
      },
      brand: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      market: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      category: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      segment: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      content_quantity: {
        kind: "decimal",
        nullable: true,
      },
      content_unit: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      average_price: {
        kind: "decimal",
        nullable: true,
      },
      average_price_currency: {
        kind: "string",
        nullable: true,
        maximum: 3,
      },
      category_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      is_active: {
        kind: "boolean",
      },
      created_at: {
        kind: "date-time",
      },
      updated_at: {
        kind: "date-time",
      },
    },
  },
  register_observations: {
    keys: ["id"],
    filters: ["id", "store_id", "product_id", "period"],
    operations: false,
    fields: {
      id: {
        kind: "uuid",
      },
      period: {
        kind: "date",
      },
      source_kind: {
        kind: "string",
        maximum: 16,
      },
      source_store_reference: {
        kind: "string",
        maximum: 64,
      },
      source_store_secondary_reference: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      source_store_label: {
        kind: "string",
        nullable: true,
        maximum: 255,
      },
      store_id: {
        kind: "uuid",
        nullable: true,
      },
      store_match_status: {
        kind: "string",
        maximum: 16,
      },
      store_match_method: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      source_gtin: {
        kind: "string",
        maximum: 14,
      },
      source_product_label: {
        kind: "string",
        nullable: true,
        maximum: 255,
      },
      source_brand: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      source_family: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      product_id: {
        kind: "uuid",
        nullable: true,
      },
      product_match_status: {
        kind: "string",
        maximum: 16,
      },
      revenue_value: {
        kind: "decimal",
        nullable: true,
      },
      revenue_change_ratio: {
        kind: "decimal",
        nullable: true,
      },
      units_sold: {
        kind: "integer",
        nullable: true,
      },
      units_change_ratio: {
        kind: "decimal",
        nullable: true,
      },
      average_unit_price: {
        kind: "decimal",
        nullable: true,
      },
      average_price_change_ratio: {
        kind: "decimal",
        nullable: true,
      },
      volume_value: {
        kind: "decimal",
        nullable: true,
      },
      volume_change_ratio: {
        kind: "decimal",
        nullable: true,
      },
    },
  },
  shelf_share_observations: {
    keys: ["id"],
    filters: ["id", "store_id", "period"],
    operations: false,
    fields: {
      id: {
        kind: "uuid",
      },
      source_key: {
        kind: "string",
        maximum: 64,
      },
      period: {
        kind: "date",
      },
      category_code: {
        kind: "string",
        maximum: 32,
      },
      store_id: {
        kind: "uuid",
        nullable: true,
      },
      store_match_status: {
        kind: "string",
        maximum: 16,
      },
      store_match_method: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      company_value: {
        kind: "decimal",
        nullable: false,
      },
      total_value: {
        kind: "decimal",
        nullable: false,
      },
      share: {
        kind: "decimal",
        nullable: true,
      },
      source_row_count: {
        kind: "integer",
      },
      source_category_name: {
        kind: "string",
        maximum: 128,
      },
      source_store_reference: {
        kind: "string",
        maximum: 128,
      },
      source_store_label: {
        kind: "string",
        maximum: 512,
      },
    },
  },
  store_activity_metrics: {
    keys: ["id"],
    filters: ["id", "store_id", "period"],
    operations: false,
    fields: {
      id: {
        kind: "uuid",
      },
      source_key: {
        kind: "string",
        maximum: 64,
      },
      period: {
        kind: "date",
      },
      store_id: {
        kind: "uuid",
        nullable: true,
      },
      store_match_status: {
        kind: "string",
        maximum: 16,
      },
      store_match_method: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      activity_type: {
        kind: "string",
        maximum: 32,
      },
      activity_count: {
        kind: "integer",
      },
      source_store_reference: {
        kind: "string",
        maximum: 128,
      },
      source_store_label: {
        kind: "string",
        maximum: 512,
      },
    },
  },
  store_typology_values: {
    keys: ["id"],
    filters: ["id", "store_id"],
    operations: false,
    fields: {
      id: {
        kind: "uuid",
      },
      snapshot_id: {
        kind: "uuid",
      },
      category_key: {
        kind: "string",
        maximum: 128,
      },
      category_name: {
        kind: "string",
        maximum: 128,
      },
      typology_value: {
        kind: "string",
        maximum: 128,
      },
    },
  },
  stores: {
    keys: ["id"],
    filters: ["id", "store_id"],
    operations: false,
    fields: {
      id: {
        kind: "uuid",
      },
      source_key: {
        kind: "string",
        maximum: 128,
      },
      external_network_code: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      crm_code: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      erp_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      legacy_store_id: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      retail_panel_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      data_sharing_code: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      name: {
        kind: "string",
        nullable: true,
        maximum: 255,
      },
      legal_name: {
        kind: "string",
        nullable: true,
        maximum: 255,
      },
      address_line_1: {
        kind: "string",
        nullable: true,
        maximum: 255,
      },
      address_line_2: {
        kind: "string",
        nullable: true,
        maximum: 255,
      },
      department_code: {
        kind: "string",
        nullable: true,
        maximum: 8,
      },
      postal_code: {
        kind: "string",
        nullable: true,
        maximum: 16,
      },
      city: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      retailer_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      retailer_name: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      store_format: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      region_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      region_name: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      sales_representative_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      sales_representative_name: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      promoter_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      promoter_name: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      secondary_representative_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      secondary_representative_name: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      sales_area_sqm: {
        kind: "integer",
        nullable: true,
      },
      classification: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      segmentation: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      distribution_model: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      has_direct_sales_potential: {
        kind: "boolean",
        nullable: true,
      },
      survey_validity_days: {
        kind: "integer",
        nullable: true,
      },
      planned_sales_visits: {
        kind: "integer",
        nullable: true,
      },
      sales_visit_minutes: {
        kind: "integer",
        nullable: true,
      },
      planned_promoter_visits: {
        kind: "integer",
        nullable: true,
      },
      promoter_visit_minutes: {
        kind: "integer",
        nullable: true,
      },
      planned_total_visits: {
        kind: "integer",
        nullable: true,
      },
      checkout_count: {
        kind: "integer",
        nullable: true,
      },
      annual_turnover_2025_millions: {
        kind: "decimal",
        nullable: true,
      },
      annual_turnover_2024_millions: {
        kind: "decimal",
        nullable: true,
      },
      annual_turnover_2023_millions: {
        kind: "decimal",
        nullable: true,
      },
      october_2023_turnover_millions: {
        kind: "decimal",
        nullable: true,
      },
      is_active: {
        kind: "boolean",
      },
      created_at: {
        kind: "date-time",
      },
      updated_at: {
        kind: "date-time",
      },
    },
  },
  typology_mapping_rules: {
    keys: ["id"],
    filters: ["id"],
    operations: false,
    fields: {
      id: {
        kind: "uuid",
      },
      source_key: {
        kind: "string",
        maximum: 64,
      },
      raw_retailer_name: {
        kind: "string",
        maximum: 128,
      },
      raw_category_name: {
        kind: "string",
        maximum: 128,
      },
      raw_category_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      raw_typology_value: {
        kind: "string",
        maximum: 128,
      },
      mapped_retailer_name: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      mapped_category_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      mapped_typology_value: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      has_source_error: {
        kind: "boolean",
      },
    },
  },
  typology_rank_rules: {
    keys: ["id"],
    filters: ["id"],
    operations: false,
    fields: {
      id: {
        kind: "uuid",
      },
      retailer_name: {
        kind: "string",
        maximum: 128,
      },
      category_name: {
        kind: "string",
        maximum: 128,
      },
      category_code: {
        kind: "string",
        maximum: 32,
      },
      rank: {
        kind: "integer",
      },
      typology_value: {
        kind: "string",
        maximum: 128,
      },
    },
  },
  typology_snapshots: {
    keys: ["id"],
    filters: ["id", "store_id", "period"],
    operations: false,
    fields: {
      id: {
        kind: "uuid",
      },
      source_key: {
        kind: "string",
        maximum: 64,
      },
      period: {
        kind: "date",
      },
      store_id: {
        kind: "uuid",
        nullable: true,
      },
      store_match_status: {
        kind: "string",
        maximum: 16,
      },
      store_match_method: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      retail_panel_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      source_customer_code: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      point_of_sale_id: {
        kind: "string",
        nullable: true,
        maximum: 64,
      },
      region_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      sales_representative_code: {
        kind: "string",
        nullable: true,
        maximum: 32,
      },
      retailer_name: {
        kind: "string",
        nullable: true,
        maximum: 128,
      },
      source_info: {
        kind: "string",
        nullable: true,
        maximum: 255,
      },
      postal_code: {
        kind: "string",
        nullable: true,
        maximum: 16,
      },
    },
  },
};
