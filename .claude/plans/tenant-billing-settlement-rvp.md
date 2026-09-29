# Tenant billing + settlement + RVP fixes

Branch: `fix/tenant-forms-host`. No commit/push without instruction. No schema changes unless noted.
Live control-plane RDS is VPC-locked -> reach via SSM into i-0b2466b2a540d6f23 (container jeffi-app-green,
reads jeffi/production from Secrets Manager, @aws-sdk/rds-signer). Razorpay LIVE keys in jeffi/production.

## Workstream 1 — Remove tenant-controlled account cards from admin billing (DECIDED: remove)
`src/app/admin/ecom/billing/[id]/page.tsx`: drop `<AccountModeToggle>` (Collection account / Switch to own
Razorpay) and `<DeliveryModeToggle>` (Delivery account / Switch to own Delhivery) from the tiles grid, and
their now-unused imports + the `hasOwnCreds` / `hasOwnDelhivery` fetches. Keep the files + the
`/api/admin/ecom/[tenantId]/account-mode` and `delivery-mode` routes (not exposed here anymore). Adjust the
grid col count (was lg:grid-cols-7). Matches memory: tenant creds/mode are managed in the store admin, not
the ecom console. Keep the DNS re-sync tile.

## Workstream 2 — Settlement stuck "captured", no prepaid ledger (DIAGNOSED LIVE)
Evidence (orders ORD-1789809580529-6PP2WH, ORD-1789665842559-BXX8E8):
- Rows store `gateway_txn_id = trf_...` correctly, status `captured`.
- Both transfers are `processed` in Razorpay live (one settled, one settlement pending).
- `transfer.processed` IS subscribed + routed to `handleTransferProcessed`.
- ROOT CAUSE: race — `fireRouteTransfer` creates the transfer THEN inserts the tenant_transactions row.
  Razorpay fires `transfer.processed` in the same second; if it lands before the INSERT, the
  `UPDATE ... WHERE gateway_txn_id=$1 AND status='captured'` matches 0 rows and never retries.
- SECOND GAP: prepaid never writes settlement_ledger (only COD does), so the ledger is always empty.

Fixes:
(a) Close the race — `handleTransferProcessed` records the processed transfer id durably even when the row
    is absent, and the transition is applied on whichever arrives last. Cleanest: keep an idempotent
    "settle" that both the webhook and `recordTenantTransaction` call — recordTenantTransaction, after
    INSERT, re-checks whether the transfer is already processed (live status) and self-settles; the webhook
    keeps its UPDATE. So order no longer matters.
(b) Reconciliation for existing stuck rows + ongoing safety net — a small reconcile function: for
    `captured` rows with a `trf_...` id older than N minutes, fetch the transfer's live status; if
    `processed`, flip to `settled` and write the ledger entries. Expose as (i) a cron
    `/api/cron/reconcile-settlements` and (ii) an on-demand "Reconcile" action on the billing page (platform
    admin only). Run it once for the two stuck orders.
(c) Write prepaid settlement_ledger at settle time — when a row settles, insert ledger rows mirroring COD:
    `order_capture` (+tenant_share), `commission` (-), `gateway_fee` (-). Idempotent per (tenant, order_ref).
    Backfill the ledger for already-settled prepaid rows in the reconcile pass.
Uses `settleTenantTransaction(tenantId, orderRef | transferId)` as the single idempotent primitive in
`razorpay-route.ts`; webhook + reconcile + post-insert check all call it. Verify live via SSM after.

## Workstream 3 — RVP creation must enforce + debit wallet (>= Rs 500 floor)
`assertWalletCanCoverPickup` + `WALLET_PICKUP_MIN_FLOOR_INR = 500` already exist in `wallet.ts` and are used
by forward pickup — RVP creation just never calls them.
`src/app/api/admin/orders/[id]/create-rvp-shipment/route.ts`: before `createRVPShipment`, for
platform-Delhivery tenants (own_delhivery exempt, as the helper already handles), assert the wallet can
cover the estimated RVP charge AND stay >= Rs 500 after; 402/409 with the existing message if not. The
actual debit stays admin-entered via the existing `rvp-charge` route (workstream 4) keyed to the AWB, so we
do not double-charge. Confirm estimate source (reuse the forward pickup estimate helper).

## Workstream 4 — RVP delivery charge adjustable by admin in the shipment view
Backend already exists: `POST /api/admin/returns/[id]/rvp-charge` + `correctWalletDebitForAwb` (net-to-new,
refund on cancel). Task is to ensure it is SURFACED like a forward shipment's admin charge adjust:
- Find the forward shipment admin charge-adjust UI and mirror it in the RVP/return shipment card on the
  admin order page so the main administrator can enter/adjust the RVP delivery charge there.
- If already surfaced, this workstream is a no-op + verification; confirm in the order detail UI.

## Workstream 5 — RVP tracking status not advancing (DIAGNOSED)
Screenshot: badge "Picked Up" but stepper stuck on "Pickup Scheduled".
- `DelhiveryTracking.tsx` reverse stepper uses `shipmentStatusToReverseStep(tracking.shipmentStatus)`, but
  the `track-rvp` route returns raw `status`/`statusType` and NO `shipmentStatus` -> null -> step 0.
- Forward `track` route already resolves via `resolveShipmentStatus(...)` and returns `shipmentStatus`.
Fixes:
(a) `src/app/api/admin/orders/[id]/track-rvp/route.ts` (and the customer `orders/[id]/track-rvp` route):
    map scans, call `resolveShipmentStatus(rawStatusType, scans, statusLabel)`, return `shipmentStatus`.
(b) `shipmentStatusToReverseStep` only advances on `rto_*` or `picked_up`. An RVP from the customer resolves
    to FORWARD statuses (`in_transit`, `out_for_delivery`, `delivered`). Extend the reverse-step map so those
    forward statuses also advance the reverse stepper (in_transit->2, out_for_delivery->3, delivered->4),
    keeping the rto_* mappings. Verify against the live RVP (AWB 54489410000545) via the Delhivery API.

## Sequencing
Settlement first (decided): (2) reconcile + settle the two stuck orders live, then ship the code fixes.
Then (1) remove cards, (5) RVP status, (3) RVP wallet, (4) RVP charge surfacing. Live verification for 2 & 5.

## Verification
- Live: reconcile flips ORD-...6PP2WH / ORD-...BXX8E8 to settled + writes ledger; billing balance reflects it.
- RVP: track-rvp returns shipmentStatus; stepper for AWB 54489410000545 shows Picked Up (step 1+), not step 0.
- Wallet: creating an RVP with < Rs 500 post-balance is blocked with the existing message.
- `npx tsc --noEmit` clean; run affected tests (wallet, shipment-status, billing, webhook).

## Constraints
One branch, no commit/push until asked, no emojis, files < 500 lines, schema via split files only + LOCAL db,
touch only what each workstream needs, live reads read-only via SSM.
