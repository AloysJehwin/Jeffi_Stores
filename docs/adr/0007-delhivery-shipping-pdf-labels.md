# ADR-0007: Delhivery as primary shipping carrier with PDF label generation

- **Status**: Accepted
- **Date**: 2026-06-18
- **Authors**: engineering

## Context

Jeffi Stores ships hardware products (fasteners, tools, industrial components) across India. The requirements for a shipping carrier integration are:

- Pan-India coverage including tier-2 and tier-3 cities where industrial buyers are concentrated.
- Programmatic shipment creation, tracking, and label retrieval via an API.
- 4R thermal label format (100 mm × 150 mm) compatible with Zebra/Citizen label printers used in the warehouse.

Carriers evaluated: Delhivery, Shiprocket (aggregator), BlueDart, Ekart.

Delhivery was selected because it offers direct API access (not an aggregator that adds latency and margin), covers 18,000+ pin codes, and has a well-documented REST API for shipment creation and tracking. BlueDart has comparable coverage but no self-service API access at the volume tier Jeffi qualifies for. Shiprocket was rejected because it is an aggregator — it adds per-shipment markup and introduces a dependency on a third-party routing engine that could change carrier assignment without notice.

A secondary issue was label availability. Delhivery's label portal generates labels correctly when their systems are healthy, but the portal has periodic outages that block physical label printing and therefore delay dispatch. This created a hard dependency on Delhivery uptime for a step (printing the label) that should be completable offline.

## Decision

Use the Delhivery API for:

- Shipment creation (`POST /api/backend/clientnow/waybill/fetchwaybill/` for waybill generation, then shipment manifest).
- Tracking status polling (`GET /api/v1/packages/json/`).
- Label fetch from Delhivery's own endpoint when available.

Additionally, generate labels locally as a fallback using `pdfkit` (PDF generation) and `bwip-js` (barcode rendering). The fallback label:

- Renders the Delhivery waybill number as a Code 128 barcode.
- Includes shipper name, consignee name and address, pin code, weight, and order reference.
- Is sized to 4R thermal (100 mm × 150 mm at 203 DPI).
- Is generated entirely in-process in the Next.js API route (`/api/admin/labels/products`) — no external service call.

The admin label-printing workflow attempts Delhivery's label endpoint first. If that returns an error or times out (4-second threshold), it falls back to the locally generated PDF. The fallback is byte-for-byte reproducible for the same input, so it can be regenerated at any time from the DB without re-calling Delhivery.

## Consequences

**Positive**

- Label printing is never blocked by Delhivery portal downtime. Dispatch can proceed during Delhivery incidents.
- Direct Delhivery API (not an aggregator) keeps per-shipment cost lower and carrier assignment predictable.
- Local label generation is stateless — no additional service to deploy or maintain.
- `bwip-js` renders barcodes server-side to PNG/SVG; no browser-side rendering required.

**Negative**

- Two code paths for labels must be kept in sync as label layout requirements evolve (e.g. if Delhivery changes their required fields).
- Switching carriers requires replacing both the API integration and the barcode/address field mapping in the fallback generator.
- Delhivery API credentials are a single point of failure for shipment creation — no secondary carrier is wired in for creation, only for label rendering.
- `pdfkit` and `bwip-js` add ~2 MB to the server bundle. This is acceptable given they are used only in admin API routes, not in the customer-facing path.

**Revisit trigger**: if Delhivery API SLA degrades materially, or if business volume reaches a tier where a multi-carrier aggregator pricing advantage outweighs the routing-control benefit of a direct integration.
