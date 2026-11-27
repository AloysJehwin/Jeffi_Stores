# Outreach agents: task agents built from a Markdown playbook, typed inputs and a site-wide tool catalog

Status: v1 built 2026-11-27 on `feat/feature-release` (founder approved the recommended defaults in §8). Builds on
[`OUTREACH_AGENT_SKILLS.md`](OUTREACH_AGENT_SKILLS.md). What changed while building is in §10.

## Why

Outreach today is one program: the Showcase offer to business owners from a CSV or Sheet. Skills changed how the agent
talks, but the contact is always a business lead and 15 of the 21 tools are about Showcase sites. The founder wants a
general agent:

- **Create an agent for a task** from the Outreach page: upload a `.md` file or write one there.
- **The agent declares its inputs.** A post-order review call takes the order, the customer's number and when the order
  was placed. Showcase takes business rows from a CSV. Each agent gets a record per job, validated against its inputs.
- **The agent acts through tools from the whole site:** look up the order, call, take a rating, send the review link on
  WhatsApp, send a payment or checkout link, check delivery, open a ticket.
- **It runs on the go:** the playbook says how many calls, when to fall back to WhatsApp, what to do with each answer; the
  runtime enforces the hard limits.

## 1. Concepts

| Concept | What | Stored in |
|---|---|---|
| **Agent** | A versioned Markdown playbook whose frontmatter declares purpose, channels, inputs, trigger, outcomes, tools and limits. The `.md` is the whole agent: upload one and it is complete. | `outreach_skills` + `outreach_skill_versions` (kept; the UI says "Agents"), plus `status` (draft, active, paused) |
| **Job** | One task for one person: the agent, its pinned version, the validated inputs, where it came from, its status and outcome. A review call for order #1042 is one job. | new `outreach_jobs` |
| **Contact** | The person reached (phone, name, language, consent, opt-out, DND, WhatsApp window). One row per phone per program, shared by every job for that phone, so opt-out and limits hold across agents. | `outreach_contacts` (generalised: a business lead or a shopper) |
| **Run** | The live conversation of a job across calls, WhatsApp and follow-ups. | `outreach_agent_runs` (gains `job_id`) |
| **Tool** | A typed capability with server-side checks. The agent can only act through tools. | code: `agent/catalog.ts` + `agent/tools/*` |

One conversation at a time per phone: a second job for a phone waits until the first one ends, so inbound WhatsApp
always routes to the one live job and nobody is called by two agents on the same day.

## 2. The agent file

```markdown
---
name: post-order-review
title: Post-order review call
purpose: transactional              # transactional | promotional (decides DND and marketing-consent gates)
flow: one_call                      # one_call | two_call | whatsapp_only
channels: [voice, whatsapp]
languages: [en, hi, ta]
persona: { en: Priya, hi: Priya }
inputs:
  customer_phone: { type: phone, required: true, role: contact }
  customer_name:  { type: text, role: name }
  order_number:   { type: order_ref, required: true }   # resolved on the server into {{order.*}}
  ordered_at:     { type: datetime, required: true }
trigger:
  event: order.delivered            # or: manual (CSV, Sheet, form, API)
  delay: 2d
  dedupe: order_number              # one job per order
outcomes: [review_link_sent, rated_on_call, complaint, declined, unreachable]
tools:
  voice:     [getJob, getOrder, recordRating, recordConsent, sendReviewLink, createSupportTicket, scheduleCallback, setOutcome, endCall]
  follow_up: [sendReviewLink, setOutcome]
limits: { max_call_attempts: 2 }
---

You are calling {{inputs.customer_name}} about order {{order.number}} ({{order.items_short}}), delivered {{order.delivered_ago}}.

## Voice
1. Greet, say why you are calling, and confirm the order arrived.
2. Ask for a rating from 1 to 5.
3. 4 or 5: thank them, ask if you may send the review link on WhatsApp (recordConsent), then sendReviewLink.
   1 to 3: ask what went wrong, recordRating with their words, createSupportTicket, tell them the team will call back.
4. setOutcome before you end the call.

## Follow-up
If the call was unanswered twice and WhatsApp consent exists, sendReviewLink once and setOutcome unreachable.
```

New frontmatter keys (the rest are unchanged from skills):

- **`purpose`**: `promotional` adds DND, the marketing opt-out (`users.marketing_opt_out` / `canSendMarketing`) and the
  promotional DLT rules. `transactional` keeps opt-out, suppression and the calling window.
- **`inputs`**: name → `{type, required, role, description, enum}`.
  - Types: `text`, `phone`, `email`, `number`, `money`, `date`, `datetime`, `url`, `enum`, `boolean`, `language`, and
    references `order_ref`, `checkout_ref`, `product_ref`, `customer_ref`, `quotation_ref`, `invoice_ref`.
  - Roles: `contact` (the phone to reach; exactly one), `name`, `language`.
  - A reference is resolved on the server when the job starts into a safe summary the prompt can use (`{{order.number}}`,
    `{{order.items_short}}`, `{{order.status}}`, `{{order.delivered_ago}}`, …) and tools receive the id, never raw PII.
- **`trigger`**: `manual` or an event with `delay`, `dedupe` and optional `when` conditions (order value, payment method).
- **`outcomes`**: the codes `setOutcome` accepts; they drive the job list and reports.

Validation adds: inputs well-formed, exactly one `contact` input, placeholders refer to declared inputs or resolved
references, the trigger's event supplies every required input, each listed outcome is a slug, a tool's required
references are present (`getOrder` needs an `order_ref` input or `findOrders`). The existing checks stay (AI-denial
wording, PII, unknown tools, channel sections).

## 3. Where jobs come from

| Source | How |
|---|---|
| CSV / Google Sheet | Today's list import, with a column → input mapping step; rows that fail the input schema are reported, not imported. |
| Single job form | A form generated from the inputs, for a one-off or a test. |
| API | `POST /api/admin/ecom/outreach/agents/{id}/jobs` with inputs (admin token, `ecom_outreach:write`). |
| Event trigger | A new `outreach-triggers` cron polls each active agent's event like the campaign scenarios do (SQL with delay, lookback and dedupe; there is no event bus). v1 events: `order.delivered`, `order.placed` (with `payment_method = cod`), `checkout.abandoned`, `payment.failed`, `review.missing` (delivered, no review after N days). Later: `trial.ending`, `invoice.overdue`, `quotation.sent`. |

`dedupe` makes a job unique per agent and key (`outreach_jobs (skill_id, source_ref)`), so a re-run never calls twice.

## 4. Tool catalog

Today's 21 tools stay with their names (voice-service, transcripts and tests depend on them). **v1** marks the first
build. Effects: read / write / send / call. Every send and call goes through the gates in §5.

**Core (every agent)**

| Tool | Effect | What | |
|---|---|---|---|
| `getJob` | read | the job's inputs and resolved references (order, checkout, lead) | v1 |
| `getContact`, `updateContact` | read, write | today's `getLead` / `updateLead`, for any contact (aliases kept) | v1 |
| `recordConsent` | write | WhatsApp consent and the recording notice | exists |
| `optOut`, `handOff` | write | mandatory | exist |
| `setOutcome` | write | one of the agent's outcomes; closes the job | v1 |
| `logNote` | write | today's `logOutcome` | exists |
| `scheduleCallback`, `scheduleFollowUp`, `placeCall`, `endCall`, `switchLanguage`, `readMessages` | call, write, read | | exist |

**Messaging**

| Tool | Effect | What | |
|---|---|---|---|
| `sendWhatsAppTemplate` | send | any approved template the agent allows; variables from the job; URLs built on the server | v1 (generalised) |
| `sendWhatsAppText` | send | free text inside the 24 h window | exists |
| `sendSms` | send | a DLT-registered template | v1 |
| `sendEmail` | send | a template email | later |

**Orders**

| Tool | Effect | What | |
|---|---|---|---|
| `getOrder` | read | items, totals, payment, status, delivery date for the job's order | v1 |
| `findOrders` | read | the contact's recent orders by phone (new service function on `users.phone` / `orders.customer_phone`) | v1 |
| `trackShipment` | read | live Delhivery status and expected delivery (`trackOrder`, `computeEdd`) | v1 |
| `confirmCodOrder` | write | the customer confirmed (or refused) a COD order on the call; logs it and clears the staff COD task | v1 |
| `sendInvoiceLink` | send | the order invoice's view link on WhatsApp | later |
| `requestCancellation` | write | a cancellation request for staff review (never an automatic cancel) | later |
| `requestReturn` | write | a refund or replacement request with the reason (`createReturnRequest`) | later |
| `getRefundStatus` | read | refund records for the order | later |

**Reviews**

| Tool | Effect | What | |
|---|---|---|---|
| `sendReviewLink` | send | mints the no-login review token per product (`generateReviewToken`) and sends `feedback/request` with that link (today the WhatsApp copy points at the login page) | v1 |
| `recordRating` | write | the rating and comment given on the call, stored as feedback (a low score also creates a staff task) | v1 |
| `getReviewStatus` | read | whether this order's products are reviewed | v1 |

**Checkout and payments**

| Tool | Effect | What | |
|---|---|---|---|
| `getAbandonedCheckout` | read | the abandoned cart or failed checkout: items, total, when | v1 |
| `sendCheckoutLink` | send | the cart or product link (a signed checkout intent where possible) | v1 |
| `sendPaymentLink` | send | a Razorpay payment link for an unpaid order (`createOrderPaymentLink`) | v1 |
| `checkDelivery` | read | courier serviceability and EDD for a pincode | v1 |
| `offerCoupon` | write | a single-use coupon within the agent's `max_discount` and a hard cap | later |

**Catalog, store, support**

| Tool | Effect | What | |
|---|---|---|---|
| `searchProducts`, `getProduct` | read | the customer agent's search and product tools | v1 |
| `sendProductLink` | send | a product page link | v1 |
| `getStoreInfo` | read | name, contact, hours, policies | v1 |
| `getLoyalty` | read | points and tier | later |
| `createSupportTicket` | write | a support session with the conversation summary, for the team | v1 |
| `createStaffTask` | write | a `customer_tasks` row | v1 |

**B2B and platform (later)**: `getQuotation`, `sendQuotationLink`, `sendInvoiceReminder` (needs an overdue cron),
`getTrialStatus`, `sendTrialReminder`.

**Showcase**: `getSiteStatus`, `startPreview`, `addDetails`, `requestChange`, `publishSite`, `sendLink` (unchanged).

v1 is 26 new or generalised tools on top of today's 21.

## 5. Safety (in code, never in the playbook)

Everything in `OUTREACH_AGENT_SKILLS.md` §4 stays: persona rule and recording notice, consent before WhatsApp,
mandatory opt-out and hand-off, calling window 09:30–20:30 IST, DND, suppression, attempt caps, rate and spend limits.
New for task agents:

- **Purpose gates:** `promotional` jobs need a clear DND status and no marketing opt-out; `transactional` jobs still
  honour opt-out and suppression.
- **WhatsApp for shoppers:** a business-initiated template needs the shopper's opt-in (order updates on WhatsApp, or
  consent recorded on the call); free text only inside the 24 h window, tracked from the last inbound message.
- **Money and irreversible actions** are requests for staff (cancellation, return) or capped by code (coupons). A payment
  link only goes out for an unpaid order of the job's own contact.
- **Scope:** a tool only touches the job's own entities (its order, its checkout, its contact's orders); references are
  checked against the contact's phone.
- **Spend:** messages debit the wallet as today; gateway turns and calls keep the per-contact and per-program caps.

## 6. Admin

Outreach gets an **Agents** tab (today's Skills tab, renamed and extended):

1. **New agent:** start from a template (Showcase offer, Post-order review call, COD confirmation, Abandoned checkout
   recovery, Payment reminder, Blank) or upload a `.md`.
2. **Editor:** the Markdown with live validation and preview (today's editor), plus side panels for **Inputs** (parsed
   from the frontmatter, with a sample record), **Tools** (the catalog grouped by area with effects; ticking a tool edits
   the frontmatter) and **Trigger**.
3. **Test:** preview the exact prompt for a sample job; a test call or WhatsApp to the program's test numbers.
4. **Activate / pause.** Versions as today; a running job keeps its pinned version.

Each agent has a **Jobs** view: add jobs (CSV or Sheet with column mapping, the single-job form, the API endpoint), filter
by status and outcome, open a job to see its inputs, calls (transcript, recording), messages and tool calls.

## 7. Data model (platform-only, flagship DB; new tables and columns, no migration)

- `outreach_skills`: `status` (draft | active | paused), `purpose`, `trigger` (from frontmatter, for the cron to query).
- `outreach_jobs`: id, skill_id, skill_version_id, contact_id, inputs jsonb, refs jsonb (resolved reference ids),
  source (csv | sheet | form | api | event | test), source_ref, status (queued | waiting | active | completed | failed |
  cancelled | handed_off), outcome, due_at, attempts, result jsonb, created_by, created_at, updated_at, ended_at; unique
  (skill_id, source_ref).
- `outreach_contacts`: `kind` (lead | shopper), `business_name` becomes nullable (a shopper has a name, not a business),
  `user_id` (the shopper's account when known).
- `outreach_agent_runs.job_id`; one open run per job.
- `outreach_lists.skill_id` stays (a list is a CSV source for an agent).

## 8. Decisions for the founder

1. **Scope.** v1 runs agents for the flagship: platform admins, against the flagship store's orders and customers. The
   tables and tools are tenant-ready (`tenant_id`, tenant context in the tool context) so store owners can get the same
   builder later. *Recommended: flagship first.*
2. **Money and irreversible actions.** Cancellations and returns become staff requests; coupons are capped in code.
   *Recommended: as described.*
3. **First batch.** Core + messaging + orders (`getOrder`, `findOrders`, `trackShipment`, `confirmCodOrder`) + reviews +
   checkout and payments (without coupons) + catalog/store/support, with the builtin agents Post-order review call, COD
   confirmation and Abandoned checkout recovery next to Showcase. *Recommended.*

## 9. Build order

1. Contracts: frontmatter (`purpose`, `inputs`, `trigger`, `outcomes`), types, validation, the `outreach_jobs` table,
   `job_id` on runs, contact generalisation.
2. Jobs: creation from CSV/Sheet (mapping), form, API; reference resolution; the scheduler picks jobs (one live job per
   phone); the runtime renders `{{inputs.*}}` and references.
3. Tools: the v1 store tools as thin wrappers over the existing store-core functions, run in the flagship tenant context.
4. Triggers: the `outreach-triggers` cron with the v1 events.
5. Admin: Agents tab, editor panels, Jobs view, templates.
6. Tests: validation and rendering units; each tool's guard; an E2E like `outreach-agent-e2e.test.ts` where a
   post-order review job goes call → rating → consent → review link, with a scripted model and nothing sent.

## 10. As built (2026-11-27)

- **Programs.** Every agent keeps `program = 'showcase-offer'` (the registered outreach program); `audience` lives in its
  own column. Shopper contacts use program `store`; their calling window, enabled switch, caps and test numbers come
  from the showcase-offer program state (`settingsProgram`). While a shopper's job is live the contact is `interested`
  (so callbacks and follow-ups work) and goes back to `queued` when the job ends.
- **Draft first.** A new task agent is created as `draft`: no jobs (except test jobs) and no trigger until Activate,
  which re-validates the current version.
- **DND.** A promotional job that starts with a call needs a checked-clear DND status (test numbers excepted), the same
  rule as the Showcase dialler; it is cancelled `dnd_unchecked` otherwise. No DND checker exists yet, so promotional call
  agents (Abandoned checkout) only run for numbers marked clear.
- **WhatsApp opt-in** for a shopper is `users.notification_channel = 'whatsapp'` on the verified account for the phone,
  or consent recorded on the call. Free text still needs recorded consent and the 24 h window.
- **Ratings** are a customer note (tag `complaint` for 1–3) plus a staff task for 1–3, not `product_reviews` (that table
  is per product and needs a comment). `recordRating` only promises a follow-up when the task exists.
- **COD confirmation** appends a line to `orders.admin_notes` (a repeat is a no-op); a refusal adds a high-priority staff
  task. It never changes status or payment.
- **Payment link** goes out by SMS on the `order/payment-failed` DLT template (no WhatsApp template carries a link yet).
  `sendProductLink` works only inside the 24 h window (no `product/link` template yet).
- **Triggers** poll every 10 minutes (`outreach_triggers` cron, k8s only). A cart's dedupe key includes the day of its
  last change, so one customer can get one cart job per abandoned cart, not one ever.
- **Tool manifest.** `agent/tool-manifest.ts` holds each tool's channels, effect, mandatory flag and group with no
  imports; validation and parsing read it instead of `catalog.ts`, because Turbopack handed `validate.ts` an
  unresolved async catalog in the preview route. The catalog test keeps the two equal.
- **Tests.** `controller-service/integration-tests/api-db/outreach-jobs-e2e.test.ts` (jeffi_test): the post-order review
  agent end to end (create, activate, job with the order resolved and deduped, scheduler, call with rating 5 → consent →
  review link → completed; rating 2 → staff task → complaint).

Open: a DND checker for shopper numbers; WhatsApp templates that carry a payment, checkout or product link; the
"add input" form in the editor; store-owner (tenant) agents.
