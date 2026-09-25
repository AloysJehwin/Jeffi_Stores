<!-- converted from product-import-template.xlsx -->

## Sheet: Field Guide
| How to use this workbook |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Fill the Products sheet first (sku is the key). Then Variants (link each to a product by parent_sku), then Sub-variants (parent_sku + variant_sku). Attribute sheets extend a product by its sku. Removing a product row and re-syncing DELETES that product from the store (sheet-sourced products only). |  |  |  |  |  |
| Sheet | Field | Required | Type | Accepted values | Notes |
| Products | image_urls |  | text |  | Pipe-delimited image URLs: a.jpg|b.jpg — fetched and uploaded on import |
| Products | sku | yes | text |  | Unique product SKU — matches an existing product to update, else creates |
| Products | name | yes | text |  |  |
| Products | slug |  | text |  | Optional — kept/derived if blank |
| Products | category |  | text |  | Existing category name (resolved to id) |
| Products | brand |  | text |  | Existing brand name (resolved to id) |
| Products | supplier |  | text |  | Existing supplier name (resolved to id) |
| Products | description |  | text |  |  |
| Products | short_description |  | text |  |  |
| Products | base_price |  | number |  |  |
| Products | price_ex_gst |  | number |  |  |
| Products | currency |  | text |  |  |
| Products | mrp |  | number |  |  |
| Products | mrp_ex_gst |  | number |  |  |
| Products | gst_percentage |  | number | 0, 5, 12, 18, 28 |  |
| Products | cost_price |  | number |  |  |
| Products | discount_pct |  | number |  |  |
| Products | material |  | text |  |  |
| Products | finish |  | text |  |  |
| Products | size |  | text |  |  |
| Products | color |  | text |  |  |
| Products | color_hex |  | text |  |  |
| Products | is_featured |  | bool | TRUE, FALSE |  |
| Products | has_variants |  | bool | TRUE, FALSE | true when the product has variant rows below it |
| Products | variant_type |  | text |  |  |
| Products | sub_variant_type |  | text |  |  |
| Products | mpn |  | text |  |  |
| Products | gtin |  | text |  |  |
| Products | barcode |  | text |  |  |
| Products | isbn |  | text |  |  |
| Products | asin |  | text |  |  |
| Products | brand_part_number |  | text |  |  |
| Products | inventory_quantity |  | number |  | Ignored for variant products (rolled up from children) |
| Products | inventory_sync |  | bool | TRUE, FALSE |  |
| Products | low_stock_threshold |  | number |  |  |
| Products | stock_status |  | text | In Stock, Low Stock, Out of Stock |  |
| Products | is_cod_allowed |  | bool | TRUE, FALSE |  |
| Products | launch_date |  | date |  |  |
| Products | discontinue_date |  | date |  |  |
| Products | sort_order |  | int |  |  |
| Product · Shipping | sku | yes | text | must match a SKU on the linked sheet | Product SKU this row extends (from the Products sheet) |
| Product · Shipping | weight |  | number |  |  |
| Product · Shipping | dimensions |  | text |  |  |
| Product · Shipping | weight_grams |  | int |  |  |
| Product · Shipping | net_weight_grams |  | int |  |  |
| Product · Shipping | volume_ml |  | number |  |  |
| Product · Shipping | length_cm |  | number |  |  |
| Product · Shipping | breadth_cm |  | number |  |  |
| Product · Shipping | height_cm |  | number |  |  |
| Product · Shipping | package_type |  | text | flat_poly_auto, flat_poly_s, flat_poly_m, flat_poly_l, flat_poly_xl, drill_bit_tube, drill_bit_set_case, corrugated_box, long_tube |  |
| Product · Shipping | extra_delivery_days |  | int |  |  |
| Product · Shipping | handling_days |  | int |  |  |
| Product · Shipping | shipping_class |  | text | standard, express, freight, cold_chain |  |
| Product · Shipping | is_oversized |  | bool | TRUE, FALSE |  |
| Product · Shipping | volumetric_weight_grams |  | int |  |  |
| Product · Shipping | fragile |  | bool | TRUE, FALSE |  |
| Product · Shipping | hazardous |  | bool | TRUE, FALSE |  |
| Product · Shipping | flammable |  | bool | TRUE, FALSE |  |
| Product · Shipping | perishable |  | bool | TRUE, FALSE |  |
| Product · Shipping | shelf_life_days |  | int |  |  |
| Product · Compliance | sku | yes | text | must match a SKU on the linked sheet | Product SKU this row extends (from the Products sheet) |
| Product · Compliance | hsn_code |  | text |  |  |
| Product · Compliance | country_of_origin |  | text |  |  |
| Product · Compliance | serialized |  | bool | TRUE, FALSE |  |
| Product · Compliance | certifications |  | csv |  |  |
| Product · Compliance | compliance_standard |  | text |  |  |
| Product · Compliance | safety_rating |  | text |  |  |
| Product · Compliance | warranty_months |  | int |  |  |
| Product · Compliance | warranty_type |  | text | , manufacturer, seller |  |
| Product · Compliance | condition |  | text | new, refurbished, used, open_box |  |
| Product · Compliance | grade |  | text |  |  |
| Product · Compliance | tax_class |  | text | standard, reduced, zero, exempt |  |
| Product · Compliance | inclusive_tax |  | bool | TRUE, FALSE |  |
| Product · Digital | sku | yes | text | must match a SKU on the linked sheet | Product SKU this row extends (from the Products sheet) |
| Product · Digital | is_digital |  | bool | TRUE, FALSE |  |
| Product · Digital | download_url |  | text |  |  |
| Product · Digital | license_type |  | text |  |  |
| Product · Digital | file_format |  | text |  |  |
| Product · Digital | platform_compatibility |  | csv |  |  |
| Product · Digital | is_subscription |  | bool | TRUE, FALSE |  |
| Product · Digital | subscription_interval |  | text | , daily, weekly, monthly, quarterly, yearly |  |
| Product · Digital | subscription_price |  | number |  |  |
| Product · Digital | is_bundle |  | bool | TRUE, FALSE |  |
| Product · SEO & Audience | sku | yes | text | must match a SKU on the linked sheet | Product SKU this row extends (from the Products sheet) |
| Product · SEO & Audience | meta_title |  | text |  |  |
| Product · SEO & Audience | meta_description |  | text |  |  |
| Product · SEO & Audience | meta_keywords |  | csv |  |  |
| Product · SEO & Audience | is_searchable |  | bool | TRUE, FALSE |  |
| Product · SEO & Audience | age_min |  | int |  |  |
| Product · SEO & Audience | age_max |  | int |  |  |
| Product · SEO & Audience | target_gender |  | text | , male, female, unisex |  |
| Product · SEO & Audience | target_audience |  | csv |  |  |
| Variants | parent_sku | yes | text | must match a SKU on the linked sheet | Product SKU this variant belongs to (from the Products sheet) |
| Variants | variant.sku | yes | text |  |  |
| Variants | variant.variant_name | yes | text |  |  |
| Variants | variant.image_urls |  | text |  | Pipe-delimited image URLs for this variant: a.jpg|b.jpg — matches the product-edit variant images |
| Variants | variant.price |  | number |  |  |
| Variants | variant.mrp |  | number |  |  |
| Variants | variant.price_ex_gst |  | number |  |  |
| Variants | variant.mrp_ex_gst |  | number |  |  |
| Variants | variant.inventory_quantity |  | number |  |  |
| Variants | variant.stock_status |  | text | In Stock, Low Stock, Out of Stock |  |
| Variants | variant.mpn |  | text |  |  |
| Variants | variant.gtin |  | text |  |  |
| Variants | variant.asin |  | text |  |  |
| Variants | variant.isbn |  | text |  |  |
| Variants | variant.unit |  | text | pcs, pair, set, box, pack, roll, sheet |  |
| Variants | variant.numeric_value |  | number |  |  |
| Variants | variant.weight_grams |  | int |  |  |
| Variants | variant.package_type |  | text | flat_poly_auto, flat_poly_s, flat_poly_m, flat_poly_l, flat_poly_xl, drill_bit_tube, drill_bit_set_case, corrugated_box, long_tube |  |
| Variants | variant.length_cm |  | number |  |  |
| Variants | variant.breadth_cm |  | number |  |  |
| Variants | variant.height_cm |  | number |  |  |
| Variants | variant.cost_price |  | number |  |  |
| Variants | variant.sub_variant_type_on |  | bool | TRUE, FALSE | true when this variant has sub-variant rows |
| Sub-variants | parent_sku | yes | text | must match a SKU on the linked sheet | Product SKU (from the Products sheet) |
| Sub-variants | variant_sku | yes | text | must match a SKU on the linked sheet | Variant SKU (from the Variants sheet) |
| Sub-variants | parent_sku |  | text |  | SKU of the product this row belongs to |
| Sub-variants | variant_sku |  | text |  | SKU of the variant this sub-variant belongs to |
| Sub-variants | sub_variant.sku |  | text |  |  |
| Sub-variants | sub_variant.sub_variant_name | yes | text |  |  |
| Sub-variants | sub_variant.price |  | number |  |  |
| Sub-variants | sub_variant.mrp |  | number |  |  |
| Sub-variants | sub_variant.price_ex_gst |  | number |  |  |
| Sub-variants | sub_variant.mrp_ex_gst |  | number |  |  |
| Sub-variants | sub_variant.stock_status |  | text | In Stock, Low Stock, Out of Stock |  |
## Sheet: Products
| image_urls | sku | name | slug | category | brand | supplier | description | short_description | base_price | price_ex_gst | currency | mrp | mrp_ex_gst | gst_percentage | cost_price | discount_pct | material | finish | size | color | color_hex | is_featured | has_variants | variant_type | sub_variant_type | mpn | gtin | barcode | isbn | asin | brand_part_number | inventory_quantity | inventory_sync | low_stock_threshold | stock_status | is_cod_allowed | launch_date | discontinue_date | sort_order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pipe-delimited image URLs: a.jpg|b.jpg — fetched and uploaded on import | Unique product SKU — matches an existing product to update, else creates |  | Optional — kept/derived if blank | Existing category name (resolved to id) | Existing brand name (resolved to id) | Existing supplier name (resolved to id) |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | true when the product has variant rows below it |  |  |  |  |  |  |  |  | Ignored for variant products (rolled up from children) |  |  |  |  |  |  |  |
| https://example.com/front.jpg|https://example.com/back.jpg | TSHIRT-001 | Cotton T-Shirt |  | Apparel | Acme |  |  |  | 499 |  |  | 699 |  | 5 |  |  |  |  |  |  |  |  | TRUE | Color |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
## Sheet: Product · Shipping
| sku | weight | dimensions | weight_grams | net_weight_grams | volume_ml | length_cm | breadth_cm | height_cm | package_type | extra_delivery_days | handling_days | shipping_class | is_oversized | volumetric_weight_grams | fragile | hazardous | flammable | perishable | shelf_life_days |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Product SKU this row extends (from the Products sheet) |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| TSHIRT-001 |  |  | 200 |  |  | 25 | 20 | 2 |  |  |  |  |  |  | FALSE |  |  |  |  |
## Sheet: Product · Compliance
| sku | hsn_code | country_of_origin | serialized | certifications | compliance_standard | safety_rating | warranty_months | warranty_type | condition | grade | tax_class | inclusive_tax |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Product SKU this row extends (from the Products sheet) |  |  |  |  |  |  |  |  |  |  |  |  |
| TSHIRT-001 |  |  |  |  |  |  |  |  |  |  |  |  |
## Sheet: Product · Digital
| sku | is_digital | download_url | license_type | file_format | platform_compatibility | is_subscription | subscription_interval | subscription_price | is_bundle |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Product SKU this row extends (from the Products sheet) |  |  |  |  |  |  |  |  |  |
| TSHIRT-001 |  |  |  |  |  |  |  |  |  |
## Sheet: Product · SEO & Audience
| sku | meta_title | meta_description | meta_keywords | is_searchable | age_min | age_max | target_gender | target_audience |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Product SKU this row extends (from the Products sheet) |  |  |  |  |  |  |  |  |
| TSHIRT-001 |  |  |  |  |  |  |  |  |
## Sheet: Variants
| parent_sku | variant.sku | variant.variant_name | variant.image_urls | variant.price | variant.mrp | variant.price_ex_gst | variant.mrp_ex_gst | variant.inventory_quantity | variant.stock_status | variant.mpn | variant.gtin | variant.asin | variant.isbn | variant.unit | variant.numeric_value | variant.weight_grams | variant.package_type | variant.length_cm | variant.breadth_cm | variant.height_cm | variant.cost_price | variant.sub_variant_type_on |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Product SKU this variant belongs to (from the Products sheet) |  |  | Pipe-delimited image URLs for this variant: a.jpg|b.jpg — matches the product-edit variant images |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | true when this variant has sub-variant rows |
| TSHIRT-001 | TSHIRT-001-RED | Red | https://example.com/red-1.jpg|https://example.com/red-2.jpg | 499 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | TRUE |
| TSHIRT-001 | TSHIRT-001-BLU | Blue | https://example.com/blue-1.jpg | 499 |  |  |  | 30 | In Stock |  |  |  |  |  |  |  |  |  |  |  |  |  |
## Sheet: Sub-variants
| parent_sku | variant_sku | parent_sku | variant_sku | sub_variant.sku | sub_variant.sub_variant_name | sub_variant.price | sub_variant.mrp | sub_variant.price_ex_gst | sub_variant.mrp_ex_gst | sub_variant.stock_status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Product SKU (from the Products sheet) | Variant SKU (from the Variants sheet) | SKU of the product this row belongs to | SKU of the variant this sub-variant belongs to |  |  |  |  |  |  |  |
|  |  | TSHIRT-001 | TSHIRT-001-RED | TSHIRT-001-RED-M | Red / M | 499 |  |  |  | In Stock |
|  |  | TSHIRT-001 | TSHIRT-001-RED | TSHIRT-001-RED-L | Red / L | 499 |  |  |  | In Stock |