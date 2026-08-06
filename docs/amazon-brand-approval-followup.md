# Amazon Brand Approval — Follow-up (paused 2026-08-07)

Development on the Amazon push is **paused**. This is the resume checklist.

## Current state
- **`AMAZON_PUSH_DISABLED=true`** — nothing publishes. Integration code is complete and proven (auth + read + VALIDATION_PREVIEW all work live).
- Blocker is **not code** — it's **Amazon TVS brand approval**.

## The gate (confirmed live)
- TVS is **brand-gated** for the account → error **5461** "You may not create new ASINs for the brand TVS" (brandId 1759417).
- The GTIN-exemption flow and the brand approval are the **same wall**: the "Listing approval for TVS" form
  (`sellercentral.amazon.in/sq/approvalrequest?applicationId=...`) shows a banner:
  *"In order to approve your GTIN exemption, you must also be approved to create new ASINs for this brand."*

## The one open action (USER)
Complete the **"Listing approval for TVS"** application. Everything is fillable EXCEPT the photos.
- **Product ID:** leave blank (GTIN-exempt)
- **Product title:** `TVS UNC 1/4" Socket Countersunk Head Cap Screw, Grade 12.9, Zinc Phosphate Finish, Size 1/4" x 1"`
- **Manufacturer:** `TVS` (match exact name printed on packaging — maybe "Sundram Fasteners")
- **Product Description:** `TVS UNC 1/4" Socket Countersunk Head Cap Screw, Grade 12.9. UNC 2A thread as per BS:1580. Special grade alloy steel, hardness 36 HRc minimum. Zinc Phosphate (Grey/Black) finish, salt-spray life 72 hours for red rust. Sold per piece.`
- **Email:** `admin@jeffistores.in`  ·  **Phone:** Amazon seller-account number
- **Checkboxes:** tick "taken by you", "TVS legible", "GTIN exemption → all sides"; skip the two product-ID ones.
- **Photos (THE decisive item — user must take):** real, unedited photos of the actual TVS screw + packaging,
  ALL sides, "TVS" clearly legible. png/jpeg/jpg, ≤10 MB each. Tip: use "Save draft", then add photos + Submit.
- Amazon also offered an email/SQ fallback (support case) — reply with brand/SKUs/category/description/photos/
  5461 screenshot. Draft already prepared (items 1–8, 12 from catalog).

## Known issues to expect even after approval
1. **Minimum price:** single screw is ₹10–16, likely **below Amazon.in's min item price (~₹50–75)**. May need
   multi-pack listings (pack of 50/100) to be viable. Business decision, not code.
2. **Stock:** only the `1/4" x 1"` variant has stock (75 units); other 6 sizes are 0.
3. **SCREWS attributes** the mapper must add before a clean push (surfaced by VALIDATION_PREVIEW code 90220):
   `thread_size`, `thread_style` (Right Hand), `thread_coverage` (Fully Threaded), `head_style` (Countersunk),
   `drive_system` (Hex/Allen), `number_of_items` (1), `part_number` (SKU), item height unit.

## Resume steps (when TVS is approved)
1. Add the SCREWS attributes above to `src/lib/amazon/mapper.ts`.
2. Re-run VALIDATION_PREVIEW (`POST /api/admin/merchant/amazon/sync {mode:'validate', productId:'803ae40b-d59c-4974-88b5-6db6aead76d0'}`) → confirm status VALID, 0 errors.
3. Flip `AMAZON_PUSH_DISABLED=false`, restart dev.
4. Push one product (`{productId}`), verify it lands in Seller Central, then flip the flag back to `true`.

## Reference
- Candidate product: **TVS UNC 1/4" Socket CSK Cap Screw Grade 12.9** — `TVS-SCSK-12.9-UNC-14`
  (id `803ae40b-d59c-4974-88b5-6db6aead76d0`), 7 variants, HSN 7318.
- Full history: memory `project_amazon_sp_api_integration.md`.
- Invoice as JPGs (for the invoice-based app, NOT the photo app): `~/Downloads/tvs-invoice-img/JS177_page-{1,2,3}.jpg`.
