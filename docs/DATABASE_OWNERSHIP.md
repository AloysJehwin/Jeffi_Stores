# Database ownership

Every table lives in the `database/` folder of the service that owns it; `scripts/db-files.mjs` assembles them in load
order for the release pipeline. One database still holds them all (see `MICROSERVICES.md`).

How the owner was picked (`scripts/db-split-by-service.mjs`, evidence from `scripts/db-ownership-evidence.mjs`):

1. Control-plane tables (the old `database/control-plane/schema.sql`) belong to `controller-service`.
2. `messaging.sql` belongs to `messaging-service`; `documents.sql` and `drive.sql` to `document-service`.
3. Otherwise the service whose code writes the table most: `INSERT`/`UPDATE`/`DELETE` statements in its own `src`, plus
   those in `packages/*` credited to the service whose routes import that file most closely. The B2B portal's API
   routes (`storefront-service/src/app/api/(public)/business`) count for `business-service`. The controller counts
   for a store table only when no store service writes it.
4. A close call (top two within one statement or 20%) or a table nobody writes follows the owner of most of its topic file.

A file under `platform-only/` is a platform-only table: the flagship DB only, never a store tenant's (`database/README.md`).

| Owner | Store tables | Control-plane tables |
| --- | ---: | ---: |
| admin-service | 196 | 0 |
| business-service | 3 | 0 |
| controller-service | 4 | 48 |
| document-service | 23 | 0 |
| messaging-service | 27 | 0 |
| storefront-service | 33 | 0 |

## admin-service

| Table | File | Evidence |
| --- | --- | --- |
| `_debug_log` | `tables/logs.sql` | writes: admin 3, storefront 1 |
| `aads_ad_groups` | `tables/amazon-ads.sql` | no writes found; follows amazon-ads.sql |
| `aads_campaigns` | `tables/amazon-ads.sql` | writes: admin 2 |
| `aads_daily_metrics` | `tables/amazon-ads.sql` | no writes found; follows amazon-ads.sql |
| `aads_keywords` | `tables/amazon-ads.sql` | writes: admin 3 |
| `aads_product_ads` | `tables/amazon-ads.sql` | no writes found; follows amazon-ads.sql |
| `aads_product_metrics` | `tables/amazon-ads.sql` | no writes found; follows amazon-ads.sql |
| `aads_profile` | `tables/amazon-ads.sql` | writes: admin 3 |
| `aads_report_requests` | `tables/amazon-ads.sql` | writes: admin 3 |
| `aads_search_terms` | `tables/amazon-ads.sql` | no writes found; follows amazon-ads.sql |
| `account_deletions` | `tables/users.sql` | writes: admin 1 |
| `admin_agent_attachments` | `tables/ai.sql` | writes: admin 2, controller 1 |
| `admin_agent_conversations` | `tables/ai.sql` | writes: admin 7 |
| `admin_agent_messages` | `tables/ai.sql` | writes: controller 7, admin 2 |
| `admin_agent_proposed_tools` | `tables/ai.sql` | writes: admin 2 |
| `admin_audit_log` | `tables/logs.sql` | close call (document 1, admin 1); logs.sql is mostly admin-service |
| `admin_certificates` | `tables/users.sql` | writes: admin 3, controller 2 |
| `admin_mfa_recovery_codes` | `tables/users.sql` | writes: admin 6 |
| `admin_notifications` | `tables/crm.sql` | writes: admin 3, document 1 |
| `admin_saved_views` | `tables/users.sql` | writes: admin 3 |
| `admins` | `tables/users.sql` | writes: admin 8, controller 3, storefront 1 |
| `ads_account` | `tables/ads.sql` | writes: admin 8 |
| `ads_ad_groups` | `tables/ads.sql` | writes: admin 2 |
| `ads_ads` | `tables/ads.sql` | writes: admin 4 |
| `ads_alerts` | `tables/ads.sql` | writes: admin 5 |
| `ads_audience_members` | `tables/ads.sql` | writes: admin 4 |
| `ads_audiences` | `tables/ads.sql` | writes: admin 5 |
| `ads_campaign_drafts` | `tables/ads.sql` | no writes found; follows ads.sql |
| `ads_campaigns` | `tables/ads.sql` | writes: admin 1 |
| `ads_change_events` | `tables/ads.sql` | writes: admin 1 |
| `ads_change_log` | `tables/ads.sql` | writes: admin 1 |
| `ads_conversion_requests` | `tables/ads.sql` | writes: admin 4 |
| `ads_conversion_uploads` | `tables/ads.sql` | writes: admin 6 |
| `ads_daily_metrics` | `tables/ads.sql` | no writes found; follows ads.sql |
| `ads_experiments` | `tables/ads.sql` | writes: admin 3 |
| `ads_geo_metrics` | `tables/ads.sql` | no writes found; follows ads.sql |
| `ads_keywords` | `tables/ads.sql` | writes: admin 4 |
| `ads_product_metrics` | `tables/ads.sql` | no writes found; follows ads.sql |
| `ads_recommendations` | `tables/ads.sql` | writes: admin 2 |
| `ads_search_terms` | `tables/ads.sql` | no writes found; follows ads.sql |
| `ads_sync_log` | `tables/ads.sql` | writes: admin 1 |
| `ai_briefing_log` | `tables/ai.sql` | writes: admin 2 |
| `ai_cache` | `platform-only/tables/ai.sql` | no writes found; follows ai.sql |
| `ai_prompt_presets` | `platform-only/tables/catalog.sql` | writes: admin 2 |
| `ai_usage` | `tables/ai.sql` | writes: admin 9 |
| `amazon_fee_estimates` | `tables/amazon.sql` | writes: admin 1 |
| `amazon_inventory_state` | `tables/amazon.sql` | writes: admin 4 |
| `amazon_listing_status` | `tables/amazon.sql` | writes: admin 2 |
| `amazon_offers` | `tables/amazon.sql` | writes: admin 2 |
| `amazon_order_items` | `tables/amazon.sql` | writes: admin 1 |
| `amazon_orders` | `tables/amazon.sql` | writes: admin 2 |
| `amazon_refresh_meta` | `tables/amazon.sql` | writes: admin 1 |
| `amazon_report_requests` | `tables/amazon.sql` | writes: admin 4 |
| `amazon_repricer_rules` | `tables/amazon.sql` | writes: admin 2 |
| `amazon_sales_traffic_asin` | `tables/amazon.sql` | writes: admin 2 |
| `amazon_sales_traffic_daily` | `tables/amazon.sql` | writes: admin 1 |
| `amazon_settlements` | `tables/amazon.sql` | writes: admin 1 |
| `amazon_sync_log` | `tables/amazon.sql` | writes: admin 1 |
| `auth_session_keys` | `tables/auth.sql` | writes: admin 2 |
| `auth_sessions` | `tables/auth.sql` | writes: admin 11 |
| `brand_drafts` | `tables/catalog.sql` | no writes found; follows catalog.sql |
| `brands` | `tables/catalog.sql` | writes: admin 6, storefront 2, controller 1 |
| `bulk_image_jobs` | `tables/catalog.sql` | writes: admin 4 |
| `business_discounts` | `tables/crm.sql` | writes: admin 2 |
| `business_profiles` | `tables/crm.sql` | close call (admin 2, business 2, storefront 1); crm.sql is mostly admin-service |
| `campaign_drafts` | `tables/marketing.sql` | writes: admin 9 |
| `campaign_send_counts` | `tables/marketing.sql` | writes: admin 1 |
| `campaigns` | `tables/marketing.sql` | writes: admin 12, controller 2 |
| `categories` | `tables/catalog.sql` | writes: admin 8, controller 2, storefront 1 |
| `category_drafts` | `tables/catalog.sql` | no writes found; follows catalog.sql |
| `channel_alerts` | `tables/channels.sql` | writes: admin 5 |
| `channel_change_log` | `tables/channels.sql` | writes: admin 1 |
| `channel_sync_log` | `tables/channels.sql` | writes: admin 2 |
| `controls_operation_log` | `tables/catalog.sql` | writes: admin 4 |
| `coupon_drafts` | `tables/marketing.sql` | no writes found; follows marketing.sql |
| `coupon_eligible_users` | `tables/marketing.sql` | writes: admin 5 |
| `coupons` | `tables/marketing.sql` | writes: admin 7, storefront 4, controller 2 |
| `custom_scenarios` | `tables/marketing.sql` | writes: admin 2 |
| `customer_health` | `tables/crm.sql` | writes: admin 1 |
| `customer_health_history` | `tables/crm.sql` | writes: admin 1 |
| `customer_profiles` | `tables/crm.sql` | writes: admin 2 |
| `customer_tag_definitions` | `tables/crm.sql` | writes: admin 2, controller 1 |
| `customer_tags` | `tables/crm.sql` | writes: admin 2, controller 2 |
| `customer_tasks` | `tables/crm.sql` | close call (admin 3, controller 2, storefront 2); crm.sql is mostly admin-service |
| `delhivery_pickup_requests` | `tables/orders.sql` | writes: admin 6 |
| `draft_locks` | `tables/editor-sessions.sql` | writes: admin 16 |
| `draft_presence` | `tables/editor-sessions.sql` | writes: admin 4 |
| `editor_sessions` | `tables/editor-sessions.sql` | writes: admin 11 |
| `email_campaign_logs` | `tables/marketing.sql` | writes: admin 8, messaging 1 |
| `email_campaigns` | `tables/marketing.sql` | writes: admin 15 |
| `email_campaigns_sent` | `tables/marketing.sql` | close call (storefront 4, admin 4); marketing.sql is mostly admin-service |
| `email_logs` | `tables/logs.sql` | writes: admin 2 |
| `embeddings` | `tables/ai.sql` | writes: admin 3 |
| `entity_revisions` | `tables/logs.sql` | writes: admin 1 |
| `expense_payments` | `tables/payments.sql` | writes: admin 1 |
| `expenses` | `tables/payments.sql` | close call (admin 2, document 1); payments.sql is mostly admin-service |
| `failed_login_attempts` | `tables/users.sql` | close call (storefront 1, admin 1); users.sql is mostly admin-service |
| `gallery_images` | `tables/catalog.sql` | close call (storefront 2, admin 2); catalog.sql is mostly admin-service |
| `gallery_videos` | `tables/catalog.sql` | writes: admin 2 |
| `gmc_account_issues` | `tables/merchant.sql` | no writes found; follows merchant.sql |
| `gmc_account_state` | `tables/merchant.sql` | writes: admin 2 |
| `gmc_best_sellers` | `tables/merchant.sql` | no writes found; follows merchant.sql |
| `gmc_issue_cache` | `tables/merchant.sql` | writes: admin 1 |
| `gmc_price_competitiveness` | `tables/merchant.sql` | no writes found; follows merchant.sql |
| `gmc_price_insights` | `tables/merchant.sql` | no writes found; follows merchant.sql |
| `gmc_product_performance` | `tables/merchant.sql` | no writes found; follows merchant.sql |
| `hero_slides` | `tables/catalog.sql` | controller 1; follows catalog.sql |
| `homepage_draft_branches` | `tables/catalog.sql` | writes: admin 4 |
| `homepage_sections` | `tables/catalog.sql` | controller 1; follows catalog.sql |
| `loyalty_accounts` | `tables/marketing.sql` | writes: admin 2 |
| `loyalty_ledger` | `tables/marketing.sql` | writes: admin 5, storefront 2 |
| `mads_account` | `tables/meta-ads.sql` | writes: admin 2 |
| `mads_ads` | `tables/meta-ads.sql` | writes: admin 2 |
| `mads_adsets` | `tables/meta-ads.sql` | no writes found; follows meta-ads.sql |
| `mads_breakdowns` | `tables/meta-ads.sql` | no writes found; follows meta-ads.sql |
| `mads_campaigns` | `tables/meta-ads.sql` | no writes found; follows meta-ads.sql |
| `mads_capi_events` | `tables/meta-ads.sql` | writes: admin 1 |
| `mads_daily_metrics` | `tables/meta-ads.sql` | no writes found; follows meta-ads.sql |
| `marketplace_ad_daily` | `tables/marketplace-ads.sql` | no writes found; follows marketplace-ads.sql |
| `marketplace_ad_imports` | `tables/marketplace-ads.sql` | writes: admin 1 |
| `marketplace_ad_products` | `tables/marketplace-ads.sql` | no writes found; follows marketplace-ads.sql |
| `marketplace_inventory_state` | `tables/marketplace.sql` | writes: admin 2 |
| `marketplace_listing_tasks` | `tables/marketplace.sql` | writes: admin 3 |
| `marketplace_listings` | `tables/marketplace.sql` | writes: admin 5 |
| `marketplace_order_items` | `tables/marketplace.sql` | writes: admin 1 |
| `marketplace_orders` | `tables/marketplace.sql` | writes: admin 4 |
| `marketplace_returns` | `tables/marketplace.sql` | writes: admin 2 |
| `marketplace_settlement_lines` | `tables/marketplace.sql` | writes: admin 2 |
| `marketplace_settlements` | `tables/marketplace.sql` | writes: admin 1 |
| `marketplace_shipments` | `tables/marketplace.sql` | writes: admin 6 |
| `marketplace_webhook_events` | `tables/marketplace.sql` | writes: admin 6 |
| `merchant_gmc_refresh_meta` | `tables/logs.sql` | writes: admin 1 |
| `merchant_gmc_status` | `tables/logs.sql` | writes: admin 2 |
| `merchant_sync_log` | `tables/logs.sql` | writes: admin 1 |
| `message_logs` | `tables/logs.sql` | writes: admin 2, controller 1 |
| `notification_preferences` | `tables/crm.sql` | writes: admin 3 |
| `notifications` | `tables/crm.sql` | close call (storefront 3, admin 2); crm.sql is mostly admin-service |
| `offer_display_settings` | `tables/marketing.sql` | writes: admin 1 |
| `offer_drafts` | `tables/catalog.sql` | writes: admin 5 |
| `order_adjustments` | `tables/orders.sql` | writes: admin 8, storefront 6 |
| `orders` | `tables/orders.sql` | writes: admin 53, storefront 32, document 14, controller 3 |
| `otp_verifications` | `tables/users.sql` | writes: admin 1 |
| `payment_disputes` | `tables/payments.sql` | writes: admin 1 |
| `payment_refunds` | `tables/payments.sql` | writes: admin 3 |
| `payments` | `tables/payments.sql` | writes: admin 17, storefront 11 |
| `price_inflation_log` | `tables/logs.sql` | writes: admin 3 |
| `product_ai_enrichment_log` | `tables/ai.sql` | writes: admin 8 |
| `product_batches` | `tables/catalog.sql` | writes: admin 21, document 9, storefront 1 |
| `product_drafts` | `tables/catalog.sql` | writes: admin 18, controller 1 |
| `product_files` | `tables/catalog.sql` | writes: admin 8 |
| `product_images` | `tables/catalog.sql` | writes: admin 23 |
| `product_offer_items` | `tables/catalog.sql` | writes: admin 9 |
| `product_offers` | `tables/catalog.sql` | writes: admin 8 |
| `product_serials` | `tables/catalog.sql` | writes: admin 14, document 3, storefront 1 |
| `product_sub_variants` | `tables/catalog.sql` | writes: admin 30, document 4, storefront 2 |
| `product_suppliers` | `tables/inventory.sql` | writes: admin 17, document 4 |
| `product_unit_rules` | `tables/catalog.sql` | writes: admin 6 |
| `product_units` | `tables/catalog.sql` | writes: admin 34, storefront 1 |
| `product_variants` | `tables/catalog.sql` | writes: admin 44, document 6, storefront 2 |
| `products` | `tables/catalog.sql` | writes: admin 63, controller 7, document 7, storefront 5 |
| `push_devices` | `tables/crm.sql` | writes: admin 4 |
| `push_queue` | `tables/crm.sql` | writes: admin 3 |
| `push_sends` | `tables/crm.sql` | writes: admin 1 |
| `razorpay_settlement_items` | `tables/payments.sql` | writes: admin 8 |
| `razorpay_settlements` | `tables/payments.sql` | writes: admin 2 |
| `referral_signups` | `tables/marketing.sql` | writes: admin 4, storefront 1 |
| `referrals` | `tables/marketing.sql` | close call (admin 2, storefront 1); marketing.sql is mostly admin-service |
| `reply_context_sends` | `tables/replies.sql` | close call (document 1, admin 1); replies.sql is mostly admin-service |
| `reply_contexts` | `tables/replies.sql` | writes: admin 4, document 2, controller 1 |
| `review_form_drafts` | `tables/reviews.sql` | writes: admin 1 |
| `review_forms` | `tables/reviews.sql` | writes: admin 5, storefront 1 |
| `rfq_reply_drafts` | `tables/quotations.sql` | writes: admin 4 |
| `scenario_audit_log` | `tables/marketing.sql` | writes: admin 10 |
| `scenario_drafts` | `tables/marketing.sql` | no writes found; follows marketing.sql |
| `scenarios` | `tables/marketing.sql` | writes: admin 3 |
| `schema_migrations` | `tables/logs.sql` | controller 1; follows logs.sql |
| `search_queries` | `tables/logs.sql` | no writes found; follows logs.sql |
| `service_accounts` | `tables/users.sql` | writes: admin 7 |
| `setup_guide_progress` | `tables/setup-guide.sql` | writes: admin 2 |
| `shelf_stock` | `tables/inventory.sql` | writes: admin 30, document 16, storefront 1 |
| `shipping_zones` | `tables/settings.sql` | no writes found; follows settings.sql |
| `site_control_drafts` | `tables/settings.sql` | writes: admin 2 |
| `site_settings` | `tables/settings.sql` | writes: admin 16, controller 2 |
| `supplier_drafts` | `tables/catalog.sql` | writes: admin 2 |
| `suppliers` | `tables/settings.sql` | writes: admin 3 |
| `support_ai_actions` | `tables/support.sql` | writes: controller 8, admin 4 |
| `support_message_attachments` | `tables/support.sql` | writes: admin 1 |
| `support_messages` | `tables/support.sql` | writes: admin 7, controller 2 |
| `support_sessions` | `tables/support.sql` | writes: admin 6 |
| `template_variables` | `tables/marketing.sql` | writes: admin 3 |
| `upi_bank_observations` | `tables/payments.sql` | writes: admin 3 |
| `upi_payment_intents` | `tables/payments.sql` | writes: admin 12 |
| `upload_sessions` | `tables/logs.sql` | writes: admin 3 |
| `variant_change_requests` | `tables/orders.sql` | writes: admin 8, storefront 4 |
| `variant_images` | `tables/catalog.sql` | writes: admin 13 |
| `websocket_connections` | `tables/logs.sql` | no writes found; follows logs.sql |

## business-service

| Table | File | Evidence |
| --- | --- | --- |
| `business_rfq_items` | `tables/quotations.sql` | writes: business 4, admin 1 |
| `business_rfqs` | `tables/quotations.sql` | writes: business 6, admin 2, document 2 |
| `rfq_messages` | `tables/quotations.sql` | writes: business 3, admin 1 |

## controller-service

| Table | File | Evidence |
| --- | --- | --- |
| `admin_agent_actions` | `tables/ai.sql` | writes: controller 8 |
| `admin_api_tokens` | `control-plane/tables/control-plane.sql` | control-plane set |
| `admin_mobiles` | `control-plane/tables/control-plane.sql` | control-plane set |
| `ai_price_list` | `control-plane/tables/control-plane.sql` | control-plane set |
| `ai_provider_identities` | `control-plane/tables/control-plane.sql` | control-plane set |
| `api_key_usage_daily` | `control-plane/tables/control-plane.sql` | control-plane set |
| `api_keys` | `control-plane/tables/control-plane.sql` | control-plane set |
| `compute_prices` | `control-plane/tables/control-plane.sql` | control-plane set |
| `delhivery_pickup_locations` | `tables/orders.sql` | writes: controller 2 |
| `import_jobs` | `control-plane/tables/control-plane.sql` | control-plane set |
| `linked_account_settlements` | `control-plane/tables/control-plane.sql` | control-plane set |
| `onboarding_drafts` | `control-plane/tables/control-plane.sql` | control-plane set |
| `owner_tenants` | `control-plane/tables/control-plane.sql` | control-plane set |
| `owners` | `control-plane/tables/control-plane.sql` | control-plane set |
| `plan_features` | `control-plane/tables/control-plane.sql` | control-plane set |
| `plans` | `control-plane/tables/control-plane.sql` | control-plane set |
| `platform_infra` | `control-plane/tables/control-plane.sql` | control-plane set |
| `platform_invoices` | `platform-only/tables/payments.sql` | writes: controller 2 |
| `platform_provider_settings` | `control-plane/tables/control-plane.sql` | control-plane set |
| `platform_setup_progress` | `control-plane/tables/control-plane.sql` | control-plane set |
| `portal_certs` | `control-plane/tables/control-plane.sql` | control-plane set |
| `provisioning_jobs` | `control-plane/tables/control-plane.sql` | control-plane set |
| `provisioning_step_events` | `control-plane/tables/control-plane.sql` | control-plane set |
| `razorpay_downtimes` | `control-plane/tables/control-plane.sql` | control-plane set |
| `razorpay_subscription_index` | `control-plane/tables/control-plane.sql` | control-plane set |
| `scheduled_social_posts` | `control-plane/tables/control-plane.sql` | control-plane set |
| `settlement_ledger` | `control-plane/tables/control-plane.sql` | control-plane set |
| `shared_db_hosts` | `control-plane/tables/control-plane.sql` | control-plane set |
| `sheet_product_links` | `control-plane/tables/control-plane.sql` | control-plane set |
| `social_autopost_rules` | `control-plane/tables/control-plane.sql` | control-plane set |
| `social_autopost_seen` | `control-plane/tables/control-plane.sql` | control-plane set |
| `social_inbox` | `control-plane/tables/control-plane.sql` | control-plane set |
| `social_post_insights` | `control-plane/tables/control-plane.sql` | control-plane set |
| `social_templates` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_admin_certs` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_bank_accounts` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_ca` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_compute` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_compute_periods` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_custom_domains` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_infra` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_integration_credentials` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_kyc` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_messaging_senders` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_metrics_daily` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_migration_runs` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_service_approvals` | `platform-only/tables/services.sql` | writes: controller 2 |
| `tenant_social_accounts` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_transactions` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenant_wallets` | `control-plane/tables/control-plane.sql` | control-plane set |
| `tenants` | `control-plane/tables/control-plane.sql` | control-plane set |
| `wallet_ledger` | `control-plane/tables/control-plane.sql` | control-plane set |

## document-service

| Table | File | Evidence |
| --- | --- | --- |
| `cash_sale_drafts` | `tables/invoices.sql` | writes: document 4 |
| `cash_sale_items` | `tables/invoices.sql` | writes: document 1 |
| `cash_sales` | `tables/invoices.sql` | close call (admin 1, document 1); invoices.sql is mostly document-service |
| `document_sequences` | `tables/documents.sql` | documents.sql belongs to document-service (writes: document 1, controller 1) |
| `document_settings` | `tables/documents.sql` | documents.sql belongs to document-service (writes: document 2) |
| `documents` | `tables/documents.sql` | documents.sql belongs to document-service (writes: document 1) |
| `drive_access_log` | `tables/drive.sql` | drive.sql belongs to document-service (writes: admin 1) |
| `drive_files` | `tables/drive.sql` | drive.sql belongs to document-service (writes: admin 7) |
| `drive_folders` | `tables/drive.sql` | drive.sql belongs to document-service (writes: admin 6) |
| `drive_shares` | `tables/drive.sql` | drive.sql belongs to document-service (writes: admin 3) |
| `grn_items` | `tables/inventory.sql` | close call (document 1, admin 1); inventory.sql is mostly document-service |
| `grns` | `tables/inventory.sql` | writes: document 1 |
| `inventory_transactions` | `tables/inventory.sql` | close call (admin 2, document 1); inventory.sql is mostly document-service |
| `invoices` | `tables/invoices.sql` | writes: document 10, admin 2 |
| `po_drafts` | `tables/inventory.sql` | writes: document 4, admin 2 |
| `po_receive_drafts` | `tables/inventory.sql` | close call (document 3, admin 2); inventory.sql is mostly document-service |
| `purchase_order_items` | `tables/quotations.sql` | close call (document 2, admin 1); quotations.sql is mostly document-service |
| `purchase_orders` | `tables/quotations.sql` | writes: document 3 |
| `quotation_items` | `tables/quotations.sql` | writes: document 3, admin 1 |
| `quotations` | `tables/quotations.sql` | writes: document 5, controller 1 |
| `shelf_locations` | `tables/inventory.sql` | close call (document 4, admin 4); inventory.sql is mostly document-service |
| `shelf_stock_transactions` | `tables/inventory.sql` | close call (admin 5, document 4); inventory.sql is mostly document-service |
| `warehouses` | `tables/inventory.sql` | close call (document 3, admin 3); inventory.sql is mostly document-service |

## messaging-service

| Table | File | Evidence |
| --- | --- | --- |
| `brand_theme` | `tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `bulk_job_items` | `platform-only/tables/bulk.sql` | writes: messaging 9 |
| `bulk_jobs` | `platform-only/tables/bulk.sql` | writes: messaging 6 |
| `message_events` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: messaging 3) |
| `messages` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: messaging 10) |
| `messaging_tenant_settings` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: controller 1, messaging 1) |
| `platform_template` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `platform_template_family` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `platform_template_variant` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `platform_template_version` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `pub_short_link` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `pub_template` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `pub_template_asset` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `pub_template_family` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `pub_template_variant` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `pub_template_version` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `short_link` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: messaging 3, storefront 2) |
| `sms_dlt` | `tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `sms_dlt_template` | `tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `template` | `tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: messaging 3) |
| `template_asset` | `tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `template_family` | `tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: messaging 1) |
| `template_variable` | `tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `template_variant` | `tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: messaging 14) |
| `template_version` | `tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: messaging 4) |
| `wa_pricing` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |
| `waba_capacity` | `platform-only/tables/messaging.sql` | messaging.sql belongs to messaging-service (writes: no writes found) |

## storefront-service

| Table | File | Evidence |
| --- | --- | --- |
| `address_change_requests` | `tables/orders.sql` | close call (admin 2, storefront 2); orders.sql is mostly storefront-service |
| `addresses` | `tables/users.sql` | writes: storefront 7, document 5, admin 2 |
| `ai_feedback` | `tables/ai.sql` | writes: storefront 2 |
| `ai_queries` | `tables/ai.sql` | writes: storefront 1 |
| `back_in_stock_notify` | `tables/orders.sql` | close call (storefront 1, admin 1); orders.sql is mostly storefront-service |
| `cart_items` | `tables/orders.sql` | writes: storefront 11, admin 4 |
| `coupon_usage` | `tables/marketing.sql` | writes: storefront 3 |
| `customer_activity_log` | `tables/crm.sql` | writes: storefront 1 |
| `customer_note_attachments` | `tables/crm.sql` | writes: storefront 1 |
| `customer_notes` | `tables/crm.sql` | writes: storefront 3, controller 1 |
| `order_adjustment_lines` | `tables/orders.sql` | writes: storefront 1 |
| `order_items` | `tables/orders.sql` | close call (document 13, storefront 11, admin 6); orders.sql is mostly storefront-service |
| `order_status_history` | `tables/orders.sql` | no writes found; follows orders.sql |
| `page_events` | `tables/logs.sql` | writes: storefront 1 |
| `pending_payment_intents` | `tables/payments.sql` | writes: storefront 5, admin 2 |
| `product_reviews` | `tables/reviews.sql` | writes: storefront 5, admin 2 |
| `product_views` | `tables/reviews.sql` | writes: storefront 1 |
| `return_request_items` | `tables/orders.sql` | writes: storefront 1 |
| `return_requests` | `tables/orders.sql` | writes: storefront 7, admin 4 |
| `review_form_submissions` | `tables/reviews.sql` | close call (admin 1, storefront 1); reviews.sql is mostly storefront-service |
| `reward_game_plays` | `tables/marketing.sql` | writes: storefront 2 |
| `search_logs` | `tables/logs.sql` | writes: storefront 1 |
| `subscription_cycle_orders` | `tables/orders.sql` | writes: storefront 2 |
| `subscription_plans_cache` | `tables/payments.sql` | writes: storefront 1 |
| `subscription_redemptions` | `tables/orders.sql` | writes: storefront 9 |
| `subscriptions` | `tables/marketing.sql` | writes: storefront 13, controller 1 |
| `user_oauth_identities` | `tables/auth.sql` | writes: storefront 1 |
| `user_search_history` | `tables/logs.sql` | writes: storefront 4 |
| `users` | `tables/users.sql` | writes: storefront 26, admin 7, business 6, controller 6 |
| `vault_access_log` | `tables/logs.sql` | writes: storefront 1 |
| `vault_entitlements` | `tables/orders.sql` | writes: storefront 3 |
| `vault_tickets` | `tables/auth.sql` | writes: storefront 2 |
| `wishlist_items` | `tables/reviews.sql` | writes: storefront 2 |
