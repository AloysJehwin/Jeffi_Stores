import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { queryOne, queryMany, query } from '@/lib/shared/db'
import { getSiteControls, SITE_CONTROLS_DEFAULTS, invalidateSiteControlsCache } from '@/lib/catalog/site-controls'
import { getDeliverySettings } from '@/lib/shipping/delivery-settings'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { hasPlanScope } from '@/lib/auth/plan-gate'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import {
  SectionCard,
  TextControl,
  TextAreaControl,
  NumberControl,
  ToggleControl,
  FullSpan,
  KeyboardShortcutControl,
} from '@/components/admin/site-controls/controls'
import LogoUploader from '@/components/admin/site-controls/LogoUploader'
import CustomShortcutsCard, { CustomShortcut } from '@/components/admin/site-controls/CustomShortcutsCard'
import DeliverySettingsForm from '@/components/admin/DeliverySettingsForm'
import CustomerTagDefinitionsCard from '@/components/admin/CustomerTagDefinitionsCard'
import TemplateVariablesPanel from '@/components/admin/site-controls/TemplateVariablesPanel'
import DeliveryEstimateCard from '@/components/admin/site-controls/DeliveryEstimateCard'
import GoogleTagCard from '@/components/admin/site-controls/GoogleTagCard'
import ProvidersCard from '@/components/admin/site-controls/ProvidersCard'
import SiteControlsTabs from '@/components/admin/site-controls/SiteControlsTabs'
import { Suspense } from 'react'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { BUILTIN_SHORTCUT_SCOPES } from '@/lib/auth/shortcut-scopes'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { getProviderPolicy } from '@/lib/providers/policy'
import { getReferralSettings } from '@/lib/referrals/settings'
import { PageHeader } from '@/components/admin/kit/layout'

const providerLabel = (p: string) => (p === 'aws' ? 'AWS' : 'Twilio')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const BUILTIN_SHORTCUT_KEYS: Record<string, string> = {
  shortcut_new_product: SITE_CONTROLS_DEFAULTS.shortcuts.newProduct,
  shortcut_cash_sale: SITE_CONTROLS_DEFAULTS.shortcuts.cashSale,
  shortcut_quotation: SITE_CONTROLS_DEFAULTS.shortcuts.quotation,
  shortcut_new_po: SITE_CONTROLS_DEFAULTS.shortcuts.newPo,
  shortcut_orders: SITE_CONTROLS_DEFAULTS.shortcuts.orders,
  shortcut_packing_slips: SITE_CONTROLS_DEFAULTS.shortcuts.packingSlips,
  shortcut_returns: SITE_CONTROLS_DEFAULTS.shortcuts.returns,
  shortcut_gst: SITE_CONTROLS_DEFAULTS.shortcuts.gst,
  shortcut_labels: SITE_CONTROLS_DEFAULTS.shortcuts.labels,
  shortcut_inventory: SITE_CONTROLS_DEFAULTS.shortcuts.inventory,
  shortcut_coupons: SITE_CONTROLS_DEFAULTS.shortcuts.coupons,
  shortcut_campaign: SITE_CONTROLS_DEFAULTS.shortcuts.campaign,
  shortcut_financial: SITE_CONTROLS_DEFAULTS.shortcuts.financial,
  shortcut_customers: SITE_CONTROLS_DEFAULTS.shortcuts.customers,
  shortcut_crm: SITE_CONTROLS_DEFAULTS.shortcuts.crm,
  shortcut_reviews: SITE_CONTROLS_DEFAULTS.shortcuts.reviews,
  shortcut_ai_agent: SITE_CONTROLS_DEFAULTS.shortcuts.aiAgent,
}

async function seedBuiltinShortcuts() {
  const rows = await queryMany<{ key: string; value: string }>(
    `SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`,
    [Object.keys(BUILTIN_SHORTCUT_KEYS)]
  )
  const existing = new Map(rows.map(r => [r.key, r.value]))
  let changed = false

  for (const [k, def] of Object.entries(BUILTIN_SHORTCUT_KEYS)) {
    const current = existing.get(k)
    // Insert if missing.
    if (current === undefined) {
      await query(
        `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO NOTHING`,
        [k, def]
      )
      changed = true
      continue
    }
    // Migrate rows still on the superseded plain "mod+<letter>" default to the
    // new "mod+shift+<letter>" default (Chrome reserves plain Ctrl/⌘ combos).
    if (def.startsWith('mod+shift+') && current === def.replace('mod+shift+', 'mod+')) {
      await query(`UPDATE site_settings SET value = $2, updated_at = NOW() WHERE key = $1`, [k, def])
      changed = true
    }
  }

  if (changed) invalidateSiteControlsCache()
}

async function loadInvoiceKeys(): Promise<Record<string, string>> {
  const rows = await queryMany<{ key: string; value: string }>(
    `SELECT key, value FROM site_settings WHERE key LIKE 'business_%' OR key LIKE 'bank_%' OR key IN ('invoice_prefix', 'min_order_amount')`
  )
  const m: Record<string, string> = {}
  for (const r of rows) m[r.key] = r.value ?? ''
  return m
}

export default async function SiteControlsPage() {
  const headersList = await headers()
  const adminId = headersList.get('x-user-id') || ''
  const host = await getHost()

  const admin = await queryOne<{ role: string; scopes: string[] }>(`SELECT role, scopes FROM admins WHERE id = $1`, [
    adminId,
  ])
  if (!admin || !hasScope(admin.role, admin.scopes || [], 'settings:write')) {
    redirect(ap('/admin/settings', host))
  }

  await seedBuiltinShortcuts()
  const [c, loyalty, referral, providerPolicy] = await Promise.all([
    getSiteControls(),
    getLoyaltySettings(),
    getReferralSettings(),
    getProviderPolicy(),
  ])
  const inv = await loadInvoiceKeys()
  const delivery = await getDeliverySettings()
  const isTenant = (await resolveTenant().catch(() => null)) != null
  const hasCrm = hasScope(admin.role, admin.scopes || [], 'crm:read')
  const hasInventory = hasScope(admin.role, admin.scopes || [], 'inventory:read')
  // Customer reward programs (loyalty / refer & earn / birthday) ship on the campaigns scope — Pro+
  // only. Gate on the PLAN, not the admin's role scopes: a tenant super_admin's stored scopes are a
  // full set, so hasScope alone would never lock them. hasPlanScope folds in getTenantPlan (and
  // returns true for the flagship, which has no plan limit).
  const hasCustomerPrograms = await hasPlanScope(admin.role, admin.scopes || [], 'campaigns:read')

  let customShortcuts: CustomShortcut[] = []
  try {
    customShortcuts = JSON.parse(c.shortcuts.customShortcuts || '[]')
  } catch {
    /* ignore */
  }
  // A shortcut is only offered if the admin can reach its destination — same scope map the
  // runtime handler binds against, so the editor never lists an action the session can't use.
  const canShortcut = (field: keyof typeof BUILTIN_SHORTCUT_SCOPES) =>
    hasScope(admin.role, admin.scopes || [], BUILTIN_SHORTCUT_SCOPES[field].scope)
  const uaHeader = headersList.get('user-agent') || ''
  const isMac = /mac/i.test(uaHeader) && !/iphone|ipad/i.test(uaHeader)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader
        title="Site Controls"
        description="One place to control your store: branding, contact info, feature toggles, delivery rules and storefront content. Changes take effect within 30 seconds."
      />

      <Suspense fallback={null}>
        <SiteControlsTabs
          tabs={[
            {
              id: 'store',
              label: 'Store',
              content: (
                <>
                  <div>
                    <SectionCard
                      title="Store Identity"
                      description="Name, logo and contact details used across the site, emails, invoices and documents."
                      columns
                    >
                      <FullSpan>
                        <LogoUploader initialUrl={c.identity.logoUrl} storeName={c.identity.name} />
                      </FullSpan>
                      <TextControl
                        settingKey="business_name"
                        label="Store name"
                        hint="Shown in the header, footer, emails ({store_name}) and page titles."
                        initial={c.identity.name}
                        placeholder="Your store name"
                      />
                      <TextControl
                        settingKey="business_email"
                        label="Contact email"
                        type="email"
                        initial={c.identity.email}
                        placeholder="hello@jeffistores.in"
                      />
                      <TextControl
                        settingKey="business_phone"
                        label="Contact phone"
                        initial={c.identity.phone}
                        placeholder="+91 96853 54099"
                      />
                      <TextControl
                        settingKey="business_web"
                        label="Website URL"
                        hint="Customer-facing site URL used in emails ({store_web})."
                        initial={c.identity.web}
                        placeholder="jeffistores.in"
                      />
                    </SectionCard>
                  </div>
                  <div>
                    <SectionCard
                      title="Legal & Banking"
                      description="Business identity and bank details printed on invoices, quotations and purchase orders."
                      columns
                    >
                      <TextControl
                        settingKey="business_legal_name"
                        label="Legal name"
                        initial={inv.business_legal_name || ''}
                      />
                      <TextControl
                        settingKey="business_trade_name"
                        label="Trade name"
                        initial={inv.business_trade_name || ''}
                      />
                      <TextControl settingKey="business_gstin" label="GSTIN" initial={inv.business_gstin || ''} />
                      <FullSpan>
                        <TextAreaControl
                          settingKey="business_address"
                          label="Registered address"
                          initial={inv.business_address || ''}
                          rows={3}
                        />
                      </FullSpan>
                      <TextControl settingKey="business_state" label="State" initial={inv.business_state || ''} />
                      <TextControl
                        settingKey="business_state_code"
                        label="State code"
                        hint="GST state code (e.g. 22 = Chhattisgarh). Used for CGST/SGST vs IGST determination."
                        initial={inv.business_state_code || c.values.businessStateCode}
                      />
                      <TextControl
                        settingKey="invoice_prefix"
                        label="Invoice number prefix"
                        initial={inv.invoice_prefix || 'JS'}
                      />
                      <FullSpan>
                        <div className="pt-2 border-t border-border-default" />
                      </FullSpan>
                      <TextControl settingKey="bank_name" label="Bank name" initial={inv.bank_name || ''} />
                      <TextControl settingKey="bank_account" label="Account number" initial={inv.bank_account || ''} />
                      <TextControl settingKey="bank_ifsc" label="IFSC code" initial={inv.bank_ifsc || ''} />
                      <TextControl settingKey="bank_branch" label="Branch" initial={inv.bank_branch || ''} />
                    </SectionCard>
                  </div>
                  <div>
                    <TemplateVariablesPanel />
                  </div>
                </>
              ),
            },
            {
              id: 'payments',
              label: 'Payments & tax',
              content: (
                <>
                  <div>
                    <SectionCard
                      title="Payments & Tax"
                      description="Toggle online payments and GST. These affect checkout and invoicing — verify after changing."
                      columns
                    >
                      <FullSpan>
                        <ToggleControl
                          settingKey="feature_razorpay_enabled"
                          label="Online payments (Razorpay)"
                          hint="When off, online card/UPI payment is hidden at checkout. Customers can still use COD if enabled."
                          initial={c.flags.razorpayEnabled}
                        />
                      </FullSpan>
                      <FullSpan>
                        <ToggleControl
                          settingKey="feature_cod_enabled"
                          label="Cash on delivery (COD)"
                          hint="Site-level COD switch. COD is offered only when this is on AND the product itself allows COD. When off, COD is hidden everywhere."
                          initial={c.flags.codEnabled}
                          locked={!c.ownDelhivery}
                          lockedHint="COD needs your own Delhivery account. Connect one in onboarding or on the Delhivery page to enable it."
                        />
                      </FullSpan>
                      <FullSpan>
                        <ToggleControl
                          settingKey="feature_gst_enabled"
                          label="GST calculation"
                          hint="When off, orders and invoices are created without tax lines."
                          initial={c.flags.gstEnabled}
                        />
                      </FullSpan>
                      <NumberControl
                        settingKey="cod_surcharge_flat"
                        label="COD surcharge (flat)"
                        prefix="₹"
                        initial={c.values.codSurchargeFlat}
                      />
                      <NumberControl
                        settingKey="cod_surcharge_pct"
                        label="COD surcharge (percentage)"
                        suffix="%"
                        step={0.5}
                        initial={c.values.codSurchargePct}
                      />
                    </SectionCard>
                  </div>
                </>
              ),
            },
            {
              id: 'orders',
              label: 'Orders & delivery',
              content: (
                <>
                  <div>
                    <SectionCard title="Orders" description="Order lifecycle rules." columns>
                      <NumberControl
                        settingKey="min_order_amount"
                        label="Minimum order amount"
                        hint="Minimum cart subtotal required to checkout. 0 disables."
                        prefix="₹"
                        initial={parseFloat(inv.min_order_amount || '0') || 0}
                      />
                      <NumberControl
                        settingKey="order_auto_cancel_minutes"
                        label="Auto-cancel unpaid orders after"
                        suffix="min"
                        min={1}
                        initial={c.values.orderAutoCancelMinutes}
                      />
                      <NumberControl
                        settingKey="return_standard_charge"
                        label="Return standard charge"
                        hint="Flat fee deducted from a return refund (covers reverse pickup). Net refund = returned value − this, floored at 0."
                        prefix="₹"
                        initial={c.values.returnStandardCharge}
                      />
                      <FullSpan>
                        <ToggleControl
                          settingKey="feature_inventory_validation_enabled"
                          label="Stock validation on order creation"
                          hint="When on, orders with insufficient stock are saved as drafts. Requires Growth plan."
                          initial={hasInventory ? c.flags.inventoryValidationEnabled : false}
                          locked={!hasInventory}
                          lockedHint="Requires Growth plan — stock validation is disabled for Basic plan."
                        />
                      </FullSpan>
                    </SectionCard>
                  </div>
                  <div>
                    <SectionCard
                      title="Delivery & Shipping"
                      description="Free-delivery thresholds, shipping charge caps and default weights. The default warehouse origin and pickup identity are below (also editable under Delhivery)."
                      columns
                    >
                      <FullSpan>
                        <DeliverySettingsForm initial={delivery} />
                      </FullSpan>
                      <FullSpan>
                        <div className="pt-2 border-t border-border-default" />
                      </FullSpan>
                      <NumberControl
                        settingKey="delivery_rate_per_kg"
                        label="Shipping rate per kg"
                        hint="Leave 0 to charge the live Delhivery rate. Set a value to price shipping as rate × charged weight instead, where charged weight is the greater of actual and volumetric weight. Still bounded by the min/max charge below."
                        prefix="₹"
                        initial={delivery.ratePerKg}
                      />
                      <NumberControl
                        settingKey="delivery_free_weight_ceiling_kg"
                        label="Free-weight ceiling"
                        hint="Weight below which the free-shipping threshold applies."
                        suffix="kg"
                        min={0}
                        step={0.5}
                        initial={delivery.freeWeightCeilingKg}
                      />
                      <FullSpan>
                        <div className="pt-2 border-t border-border-default" />
                      </FullSpan>
                      <NumberControl
                        settingKey="shipping_min_charge"
                        label="Minimum shipping charge"
                        hint="Floor applied to computed shipping (0 = none)."
                        prefix="₹"
                        initial={c.values.shippingMinCharge}
                      />
                      <NumberControl
                        settingKey="shipping_max_charge"
                        label="Maximum shipping charge"
                        hint="Cap applied to computed shipping (0 = none)."
                        prefix="₹"
                        initial={c.values.shippingMaxCharge}
                      />
                      <NumberControl
                        settingKey="default_product_weight_g"
                        label="Default product weight"
                        hint="Assumed weight for products with no weight set."
                        suffix="g"
                        min={1}
                        initial={c.values.defaultProductWeightG}
                      />
                      <NumberControl
                        settingKey="default_weight_g"
                        label="Default weight (low-weight items)"
                        hint="Used when a product's weight is 50g or less, so under-weighed items still price against a realistic parcel."
                        suffix="g"
                        min={1}
                        initial={c.values.defaultWeightG}
                      />
                    </SectionCard>
                  </div>
                  <div>
                    <SectionCard
                      title="Default warehouse"
                      description="The default ship-from warehouse. Its pincode is the origin the buyer delivery charge and expected-delivery date are computed against. Shared with the Delhivery page."
                      columns
                    >
                      <TextControl
                        settingKey="delhivery_pickup_location"
                        label="Pickup location name"
                        hint="Registered Delhivery pickup location name."
                        initial={c.values.pickupLocation}
                      />
                      <TextControl
                        settingKey="delhivery_seller_name"
                        label="Seller name"
                        hint="Seller/return name on shipments."
                        initial={c.values.sellerName}
                      />
                      <FullSpan>
                        <TextAreaControl
                          settingKey="delhivery_seller_address"
                          label="Pickup / return address"
                          hint="Warehouse address used for pickups and returns."
                          initial={c.values.sellerAddress}
                          rows={2}
                        />
                      </FullSpan>
                      <TextControl
                        settingKey="delhivery_seller_phone"
                        label="Pickup / return phone"
                        initial={c.values.sellerPhone}
                      />
                      <TextControl
                        settingKey="delhivery_origin_pincode"
                        label="Ship-from pincode"
                        hint="Origin pincode used for the Delhivery rate, shipment creation and expected-delivery date."
                        initial={c.values.delhiveryOriginPincode}
                      />
                    </SectionCard>
                  </div>
                  <div>
                    <DeliveryEstimateCard />
                  </div>
                </>
              ),
            },
            ...(hasCrm
              ? [
                  {
                    id: 'notifications',
                    label: 'Notifications',
                    content: (
                      <>
                        <div>
                          <SectionCard
                            title="Notifications"
                            description="SMS, WhatsApp and app push channels for customer OTP, order updates and marketing. Growth plan and above."
                            columns
                          >
                            <FullSpan>
                              <ToggleControl
                                settingKey="feature_sms_enabled"
                                label="SMS notifications"
                                hint="When off, SMS channel is hidden from signin/signup and no SMS messages are sent."
                                initial={c.flags.smsEnabled}
                              />
                            </FullSpan>
                            <FullSpan>
                              <ToggleControl
                                settingKey="feature_whatsapp_enabled"
                                label="WhatsApp notifications"
                                hint="When off, WhatsApp channel is hidden from signin/signup and no WhatsApp messages are sent."
                                initial={c.flags.whatsappEnabled}
                              />
                            </FullSpan>
                            <FullSpan>
                              <ToggleControl
                                settingKey="feature_push_enabled"
                                label="App push notifications"
                                hint="Order updates pushed to the mobile app. When off, nothing is pushed; customers still see every update in the app's inbox."
                                initial={c.flags.pushEnabled}
                              />
                            </FullSpan>
                            <FullSpan>
                              <ToggleControl
                                settingKey="feature_marketing_push_enabled"
                                label="Marketing push notifications"
                                hint="Offers and price alerts pushed to the app. Needs app push on; each customer's own notification settings still apply."
                                initial={c.flags.marketingPushEnabled}
                              />
                            </FullSpan>
                            <FullSpan>
                              <p className="text-xs text-foreground-muted">
                                SMS is sent through {providerLabel(providerPolicy.smsProvider)} and WhatsApp through{' '}
                                {providerLabel(providerPolicy.whatsappProvider)}. Providers are managed by the platform.
                              </p>
                            </FullSpan>
                          </SectionCard>
                        </div>
                      </>
                    ),
                  },
                ]
              : []),
            {
              id: 'customers',
              label: 'Customers',
              content: (
                <>
                  <div>
                    <SectionCard
                      title="Customer programs"
                      description="Switch customer-facing reward programs on or off for the whole store."
                      columns
                    >
                      <FullSpan>
                        <ToggleControl
                          settingKey="loyalty_enabled"
                          label="Loyalty"
                          hint="Customers earn points on delivered online orders, climb tiers and redeem points for coupons from a Rewards page. The first time it's switched on, past orders are counted without emailing anyone and tier-upgrade emails are switched on. Settings are under Marketing > Customer Programs."
                          initial={hasCustomerPrograms ? loyalty.enabled : false}
                          locked={!hasCustomerPrograms}
                          lockedHint="Requires the Pro plan — customer reward programs are not included in Basic or Growth."
                          refreshOnSave
                        />
                      </FullSpan>
                      <FullSpan>
                        <ToggleControl
                          settingKey="referral_enabled"
                          label="Refer & Earn"
                          hint="Customers get a personal link and earn loyalty points when a friend's first order is delivered. Reward size and yearly limit are under Marketing > Customer Programs."
                          initial={hasCustomerPrograms ? referral.enabled : false}
                          locked={!hasCustomerPrograms || (!loyalty.enabled && !referral.enabled)}
                          lockedHint={
                            !hasCustomerPrograms
                              ? 'Requires the Pro plan — customer reward programs are not included in Basic or Growth.'
                              : 'Turn on Loyalty first. Referral rewards are paid in loyalty points.'
                          }
                        />
                      </FullSpan>
                      <FullSpan>
                        <ToggleControl
                          settingKey="feature_birthday_enabled"
                          label="Birthday rewards"
                          hint="Shows the 'add your birthday' prompt and the birthday link page, and lets the Birthday and Birthday Collection campaigns run. Each campaign is still switched on in Marketing > Campaigns; coverage is under Marketing > Customer Programs."
                          initial={hasCustomerPrograms ? c.flags.birthdayEnabled : false}
                          locked={!hasCustomerPrograms}
                          lockedHint="Requires the Pro plan — customer reward programs are not included in Basic or Growth."
                        />
                      </FullSpan>
                    </SectionCard>
                  </div>
                  <div>
                    <CustomerTagDefinitionsCard isSuperAdmin={isPlatformOwner(admin.role)} />
                  </div>
                </>
              ),
            },
            {
              id: 'storefront',
              label: 'Storefront',
              content: (
                <>
                  <div>
                    <SectionCard title="Storefront Content" description="Homepage layout and copy." columns>
                      <NumberControl
                        settingKey="storefront_featured_limit"
                        label="Featured products count"
                        min={1}
                        max={24}
                        initial={c.storefront.featuredLimit}
                      />
                      <NumberControl
                        settingKey="storefront_new_arrivals_limit"
                        label="New arrivals count"
                        min={1}
                        max={24}
                        initial={c.storefront.newArrivalsLimit}
                      />
                      <FullSpan>
                        <TextAreaControl
                          settingKey="storefront_about_copy"
                          label="About section copy"
                          hint="Default story for the homepage About section; Settings > Homepage > About can replace it. Leave empty for the default."
                          initial={c.storefront.aboutCopy}
                          rows={4}
                          ai={{
                            context: "The store's story for the homepage About section; one or two short paragraphs.",
                          }}
                        />
                      </FullSpan>
                      <FullSpan>
                        <TextAreaControl
                          settingKey="storefront_stats_json"
                          label="Homepage stats (JSON)"
                          hint={`Default About stats, an array like [{"label":"Years in Business","value":"10+"}]; Settings > Homepage > About can replace them. Leave empty for defaults.`}
                          initial={c.storefront.statsJson}
                          rows={4}
                        />
                      </FullSpan>
                    </SectionCard>
                  </div>
                  <div>
                    <GoogleTagCard
                      isTenant={isTenant}
                      initial={{
                        google_tag_id: c.marketing.googleTagId,
                        google_ads_conversion_id: c.marketing.googleAdsConversionId,
                        google_ads_conversion_label: c.marketing.googleAdsConversionLabel,
                      }}
                    />
                  </div>
                </>
              ),
            },
            {
              id: 'ai',
              label: 'AI & shortcuts',
              content: (
                <>
                  <div>
                    <SectionCard title="Admin Assistant" description="The AI assistant in the admin panel." columns>
                      <FullSpan>
                        <ToggleControl
                          settingKey="feature_agent_dock_enabled"
                          label="Floating assistant button"
                          hint="A chat button at the bottom-right of every admin page. When off, the assistant still opens from the robot icon in the top bar."
                          initial={c.flags.agentDockEnabled}
                        />
                      </FullSpan>
                    </SectionCard>
                  </div>
                  <div>
                    <SectionCard title="Customer replies" description="When the store asks a customer something (order changes, a quotation, a payment), they can answer by replying to the WhatsApp or email." columns>
                      <FullSpan>
                        <ToggleControl
                          settingKey="feature_reply_actions_enabled"
                          label="Act on customer replies"
                          hint="The AI reads the reply, links it to the order or quotation, and acts on it. Off: replies go to the support inbox only."
                          initial={c.flags.replyActionsEnabled}
                        />
                      </FullSpan>
                      <FullSpan>
                        <ToggleControl
                          settingKey="feature_reply_auto_apply"
                          label="Apply clear answers automatically"
                          hint="A clear yes/no on something low-risk (approving an order change with no extra payment, accepting a quotation) is applied straight away. Refunds and anything unusual always wait for an admin. Off: an admin approves every reply."
                          initial={c.flags.replyAutoApply}
                        />
                      </FullSpan>
                    </SectionCard>
                  </div>
                  <div>
                    <SectionCard
                      title="On-device AI"
                      description="Experimental browser-based AI features. Per-platform switches control where the in-browser model runs; when it's off (or unsupported) on a platform, that device falls back to server-generated AI instead."
                      columns
                    >
                      <FullSpan>
                        <ToggleControl
                          settingKey="feature_ondevice_summary_enabled"
                          label="On-device summaries"
                          hint="AI cart/product/order summaries computed in the customer's browser. Master switch — turn on, then choose the platforms below."
                          initial={c.flags.ondeviceSummaryEnabled}
                        />
                      </FullSpan>
                      <FullSpan>
                        <div className="pl-4 border-l-2 border-border-default ml-1 space-y-3">
                          <ToggleControl
                            settingKey="feature_ondevice_summary_desktop_enabled"
                            label="↳ Summaries on Desktop / System"
                            hint="Run the in-browser model on desktop computers."
                            initial={c.flags.ondeviceSummaryDesktopEnabled}
                          />
                          <ToggleControl
                            settingKey="feature_ondevice_summary_mobile_enabled"
                            label="↳ Summaries on Mobile"
                            hint="Run the in-browser model on phones. Off by default — the ~400MB model is heavy on mobile, so phones use the server instead."
                            initial={c.flags.ondeviceSummaryMobileEnabled}
                          />
                        </div>
                      </FullSpan>
                      <FullSpan>
                        <div className="pt-2 border-t border-border-default" />
                      </FullSpan>
                      <FullSpan>
                        <ToggleControl
                          settingKey="feature_ondevice_finetune_enabled"
                          label="On-device fine-tuning"
                          hint="Experimental on-device model fine-tuning worker. Master switch."
                          initial={c.flags.ondeviceFinetuneEnabled}
                        />
                      </FullSpan>
                      <FullSpan>
                        <div className="pl-4 border-l-2 border-border-default ml-1 space-y-3">
                          <ToggleControl
                            settingKey="feature_ondevice_finetune_desktop_enabled"
                            label="↳ Fine-tuning on Desktop / System"
                            hint="Run the fine-tuning worker on desktop computers."
                            initial={c.flags.ondeviceFinetuneDesktopEnabled}
                          />
                          <ToggleControl
                            settingKey="feature_ondevice_finetune_mobile_enabled"
                            label="↳ Fine-tuning on Mobile"
                            hint="Run the fine-tuning worker on phones. Off by default (too heavy for mobile)."
                            initial={c.flags.ondeviceFinetuneMobileEnabled}
                          />
                        </div>
                      </FullSpan>
                    </SectionCard>
                  </div>
                  <div>
                    <SectionCard
                      title="Keyboard Shortcuts"
                      description="Assign a shortcut to each quick action. Choose a modifier (⌘/Ctrl, ⌘/Ctrl+Shift, or a standalone F-key), then click the key box and press any letter or number to record it."
                      columns
                    >
                      {canShortcut('newProduct') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_new_product"
                          label="New Product"
                          initial={c.shortcuts.newProduct}
                        />
                      )}
                      {canShortcut('cashSale') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_cash_sale"
                          label="Cash Sale"
                          initial={c.shortcuts.cashSale}
                        />
                      )}
                      {canShortcut('quotation') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_quotation"
                          label="Quotation"
                          initial={c.shortcuts.quotation}
                        />
                      )}
                      {canShortcut('newPo') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_new_po"
                          label="New PO"
                          initial={c.shortcuts.newPo}
                        />
                      )}
                      {canShortcut('orders') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_orders"
                          label="Orders"
                          initial={c.shortcuts.orders}
                        />
                      )}
                      {canShortcut('packingSlips') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_packing_slips"
                          label="Packing Slips"
                          initial={c.shortcuts.packingSlips}
                        />
                      )}
                      {canShortcut('returns') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_returns"
                          label="Returns"
                          initial={c.shortcuts.returns}
                        />
                      )}
                      {canShortcut('gst') && (
                        <KeyboardShortcutControl settingKey="shortcut_gst" label="GST" initial={c.shortcuts.gst} />
                      )}
                      {canShortcut('labels') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_labels"
                          label="Labels"
                          initial={c.shortcuts.labels}
                        />
                      )}
                      {canShortcut('inventory') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_inventory"
                          label="Inventory"
                          initial={c.shortcuts.inventory}
                        />
                      )}
                      {canShortcut('coupons') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_coupons"
                          label="Coupons"
                          initial={c.shortcuts.coupons}
                        />
                      )}
                      {canShortcut('campaign') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_campaign"
                          label="Campaign"
                          initial={c.shortcuts.campaign}
                        />
                      )}
                      {canShortcut('financial') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_financial"
                          label="Financial"
                          initial={c.shortcuts.financial}
                        />
                      )}
                      {canShortcut('customers') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_customers"
                          label="Customers"
                          initial={c.shortcuts.customers}
                        />
                      )}
                      {canShortcut('crm') && (
                        <KeyboardShortcutControl settingKey="shortcut_crm" label="CRM" initial={c.shortcuts.crm} />
                      )}
                      {canShortcut('reviews') && (
                        <KeyboardShortcutControl
                          settingKey="shortcut_reviews"
                          label="Reviews"
                          initial={c.shortcuts.reviews}
                        />
                      )}
                      {canShortcut('aiAgent') && (
                        <FullSpan>
                          <KeyboardShortcutControl
                            settingKey="shortcut_ai_agent"
                            label="AI Agent"
                            initial={c.shortcuts.aiAgent}
                          />
                        </FullSpan>
                      )}
                      <FullSpan>
                        <div className="pt-2 border-t border-border-default">
                          <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-2">
                            Custom Shortcuts
                          </p>
                          <CustomShortcutsCard initial={customShortcuts} isMac={isMac} />
                        </div>
                      </FullSpan>
                    </SectionCard>
                  </div>
                </>
              ),
            },
            ...(!isTenant && isPlatformOwner(admin.role)
              ? [
                  {
                    id: 'platform',
                    label: 'Platform',
                    content: (
                      <>
                        <div>
                          <ProvidersCard />
                        </div>
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Suspense>
    </div>
  )
}
