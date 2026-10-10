# Wallet relocation: top-nav badge + dedicated Wallet page

_Written 2026-10-10. Status: **plan, approved to build.**_

## Why
Today a tenant's prepaid shipping wallet is visible only on **one** screen —
`WalletCard` inside `src/app/(admin)/admin/delhivery/DelhiveryPageClient.tsx`. The balance drives
whether an AWB can be created, yet an admin has to go hunting for it. And soon other paid features
(campaigns, AI) will debit the same wallet, so it needs a home of its own, not a corner of the
Delhivery page.

## What exists now (don't rebuild)
- **Schema** (`database/control-plane/schema.sql`): `tenant_wallets` (balance, min_balance, currency)
  and `wallet_ledger` (`entry_type` recharge|debit|adjustment, signed `amount`, `order_ref`, `awb`,
  `external_ref`, `note`, `occurred_at`; unique on awb-debit and on external_ref-credit).
- **Lib** (`src/lib/payments/wallet.ts`): `getTenantWallet(tenantId, ledgerLimit)` returns
  `{ balance, minBalance, currency, ledger[] }`; `rechargeWallet`, `chargeDeliveryEstimate`,
  `refundEstimateForAwbs`, `correctWalletDebitForAwb`, `settleDelhiveryCostToWallet`,
  `checkWalletForShipment`, `FLAGSHIP_TENANT_ID`, `isFlagshipTenant`.
- **APIs:** platform-admin view `GET/POST /api/admin/ecom/[tenantId]/wallet`;
  tenant self top-up `POST /api/admin/financial/wallet/{topup,topup/create-order,topup/verify,recharge}`.
- **Top bar:** `src/components/admin/AdminShell.tsx` renders the right cluster (NotificationBell,
  ThemeToggle, agent, logout). This is where the badge goes.
- **Nav:** `src/app/(admin)/admin/layout.tsx` `navLinks[]`, filtered by scope.

## Build

### 1. Generic ledger categories (no breaking schema change)
`wallet_ledger.entry_type` is `varchar(24)`, so no column change is needed — only the allowed set
widens. Keep the three money-direction primitives and add a **`category`** column for *what* the
movement was, so future features classify cleanly without overloading `entry_type`:

- `database/control-plane/schema.sql`: add `category varchar(32)` to `wallet_ledger`
  (nullable; existing rows read as their `entry_type`). Suggested values:
  `shipping_forward | shipping_rvp | shipping_correction | shipping_cancel_credit |
   recharge | goodwill_credit | campaign | ai | adjustment`.
- `database/control-plane/schema.sql` (indexes section): index `(tenant_id, occurred_at desc)` for
  the ledger page; keep the existing awb/external_ref unique indexes.
- No migration file (control-plane schema is applied by the pipeline, per CLAUDE.md).
- `wallet.ts`: each writer sets `category`; `getTenantWallet` returns it; `WalletLedgerEntry` gains
  `category: string | null`. Backfill is unnecessary — the UI falls back to `entry_type` when
  `category` is null.

### 2. Balance badge in the top nav
- New client component `src/components/admin/WalletBadge.tsx`: a pill next to `NotificationBell`
  showing `₹<balance>`, amber when `balance < minBalance`, linking to `/admin/wallet`. Hidden
  entirely for own-Delhivery tenants and the flagship (no platform wallet), and for admins without
  `delhivery:read`. The shipping wallet applies to EVERY plan (not just Pro+), so it is gated on
  `delhivery:read` (which every plan has), NOT `financial:*`.
- Server passes the initial balance so there's no load flash: `AdminShell` gets a new optional prop
  `wallet?: { balance; minBalance; currency; show }`, computed in `layout.tsx` from
  `getTenantWallet(tenantId)` + the `own_delhivery` check (reuse `tenantShipsOnPlatform`).
- The badge refreshes on focus and after a top-up via a tiny `GET /api/admin/financial/wallet`
  (new thin read route returning `getTenantWallet(tenantId, 0)` — balance only, no ledger).

### 3. Dedicated `/admin/wallet` page
- `src/app/(admin)/admin/wallet/page.tsx` (server) + `WalletClient.tsx` (client).
- Header: current balance, min-balance, a **Recharge** button (reuses the existing
  `topup/create-order` → Razorpay → `topup/verify` flow already in the Delhivery page).
- Ledger table: date, category (badge), direction (in/out, coloured), amount, order/AWB ref, note.
  Filters: category multi-select, direction, date range, free-text ref. CSV **Export** of the
  filtered set (client-side from the fetched rows).
- Paginated read: extend `GET /api/admin/financial/wallet` to accept `?limit&before&category&…`
  (or a sibling `/ledger` route) returning rows + a `nextBefore` cursor.
- Scope: `delhivery:read` to view, `delhivery:write` to recharge (the same scopes the existing
  Delhivery top-up uses, so Basic/Growth tenants can manage the wallet their shipments depend on).
- Add to `navLinks` under **Fulfilment** (next to Delhivery): `{ href: '/admin/wallet',
  label: 'Wallet', scope: 'delhivery:read', group: 'Fulfilment' }`, shown only for
  platform-Delhivery tenants.

### 4. Leave the Delhivery `WalletCard` in place (links to `/admin/wallet`)
Don't delete it — shrink it to a balance summary that links to the new page, so the Delhivery
workflow still shows the balance in context.

## Out of scope (just leave hooks)
Campaign/AI debits aren't built — but a `debitWallet({ tenantId, amountInr, category, ref, note })`
helper in `wallet.ts` (thin wrapper over the existing debit insert, idempotent on `external_ref`)
gives those future features one call. Add the helper; don't wire any caller.

## Verification
- `tsc --noEmit`; eslint on changed files.
- Vitest: `getTenantWallet` returns `category`; the badge hides for own-Delhivery/flagship; the
  ledger route filters and paginates; `debitWallet` is idempotent on `external_ref`.
- Manual: a platform-Delhivery tenant sees the badge + page; an own-Delhivery tenant sees neither.

## Risk
UI + one additive, nullable schema column — no money-movement logic changes. The schema add is
backward-compatible (nullable, UI falls back to `entry_type`).
