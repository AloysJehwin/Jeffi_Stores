import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { queryOne, queryMany } from '@/lib/db'
import { getSiteControls } from '@/lib/site-controls'
import { getDeliverySettings } from '@/lib/delivery-settings'
import { hasScope } from '@/lib/scopes'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { SectionCard, TextControl, TextAreaControl, NumberControl, ToggleControl, FullSpan } from '@/components/admin/site-controls/controls'
import LogoUploader from '@/components/admin/site-controls/LogoUploader'
import HeroSlideManager from '@/components/admin/HeroSlideManager'
import DeliverySettingsForm from '@/components/admin/DeliverySettingsForm'
import CustomerTagDefinitionsCard from '@/components/admin/CustomerTagDefinitionsCard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function loadInvoiceKeys(): Promise<Record<string, string>> {
  const rows = await queryMany<{ key: string; value: string }>(
    `SELECT key, value FROM site_settings WHERE key LIKE 'business_%' OR key LIKE 'bank_%' OR key IN ('invoice_prefix', 'min_order_amount')`
  )
  const m: Record<string, string> = {}
  for (const r of rows) m[r.key] = r.value ?? ''
  return m
}

async function loadHeroData() {
  const [slides, cats, brands, grades, materials] = await Promise.all([
    queryMany<any>(`SELECT * FROM hero_slides ORDER BY display_order ASC, created_at ASC`),
    queryMany<{ slug: string; name: string }>(
      `SELECT slug, name FROM categories WHERE is_active = true AND slug IS NOT NULL ORDER BY name`
    ),
    queryMany<{ id: string; name: string }>(
      `SELECT id, name FROM brands WHERE is_active = true ORDER BY name`
    ),
    queryMany<{ grade: string }>(
      `SELECT DISTINCT grade FROM products WHERE grade IS NOT NULL AND grade != '' AND is_active = true ORDER BY grade`
    ),
    queryMany<{ material: string }>(
      `SELECT DISTINCT material FROM products WHERE material IS NOT NULL AND material != '' AND is_active = true ORDER BY material`
    ),
  ])
  return {
    slides,
    categoryOptions: cats.map(c => ({ value: c.slug, label: c.name })),
    brandOptions: brands.map(b => ({ value: b.id, label: b.name })),
    gradeOptions: grades.map(g => ({ value: g.grade, label: g.grade })),
    materialOptions: materials.map(m => ({ value: m.material, label: m.material })),
  }
}

export default async function SiteControlsPage() {
  const headersList = await headers()
  const adminId = headersList.get('x-user-id') || ''
  const host = await getHost()

  const admin = await queryOne<{ role: string; scopes: string[] }>(
    `SELECT role, scopes FROM admins WHERE id = $1`, [adminId]
  )
  if (!admin || !hasScope(admin.role, admin.scopes || [], 'settings:write')) {
    redirect(ap('/admin/settings', host))
  }

  const c = await getSiteControls()
  const inv = await loadInvoiceKeys()
  const delivery = await getDeliverySettings()
  const hasCrm = hasScope(admin.role, admin.scopes || [], 'crm:read')
  const hero = await loadHeroData()

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Site Controls</h1>
        <p className="text-sm text-foreground-muted mt-0.5">
          One place to control your store — branding, contact info, feature toggles, delivery rules and storefront content. Changes take effect within 30 seconds.
        </p>
      </div>

      {/* Full-width single-column stack — each section spans the page. */}
      <div className="space-y-6">
        <div>
          <SectionCard title="Store Identity" description="Name, logo and contact details used across the site, emails, invoices and documents." columns>
            <FullSpan><LogoUploader initialUrl={c.identity.logoUrl} /></FullSpan>
            <TextControl settingKey="business_name" label="Store name" hint="Shown in the header, footer, emails ({store_name}) and page titles." initial={c.identity.name} placeholder="Jeffi Stores" />
            <TextControl settingKey="business_email" label="Contact email" type="email" initial={c.identity.email} placeholder="hello@jeffistores.in" />
            <TextControl settingKey="business_phone" label="Contact phone" initial={c.identity.phone} placeholder="+91 96853 54099" />
            <TextControl settingKey="business_web" label="Website URL" hint="Customer-facing site URL used in emails ({store_web})." initial={c.identity.web} placeholder="jeffistores.in" />
          </SectionCard>
        </div>

        <div>
          <SectionCard title="Payments & Tax" description="Toggle online payments and GST. These affect checkout and invoicing — verify after changing." columns>
            <FullSpan><ToggleControl settingKey="feature_razorpay_enabled" label="Online payments (Razorpay)" hint="When off, customers see only manual/COD payment at checkout." initial={c.flags.razorpayEnabled} /></FullSpan>
            <FullSpan><ToggleControl settingKey="feature_gst_enabled" label="GST calculation" hint="When off, orders and invoices are created without tax lines." initial={c.flags.gstEnabled} /></FullSpan>
            <NumberControl settingKey="cod_surcharge_flat" label="COD surcharge (flat)" prefix="₹" initial={c.values.codSurchargeFlat} />
            <NumberControl settingKey="cod_surcharge_pct" label="COD surcharge (percentage)" suffix="%" step={0.5} initial={c.values.codSurchargePct} />
          </SectionCard>
        </div>

        <div>
          <SectionCard title="Orders" description="Order lifecycle rules." columns>
            <NumberControl settingKey="min_order_amount" label="Minimum order amount" hint="Minimum cart subtotal required to checkout. 0 disables." prefix="₹" initial={parseFloat(inv.min_order_amount || '0') || 0} />
            <NumberControl settingKey="order_auto_cancel_minutes" label="Auto-cancel unpaid orders after" suffix="min" min={1} initial={c.values.orderAutoCancelMinutes} />
          </SectionCard>
        </div>

        {hasCrm && (
        <div>
          <SectionCard title="Notifications" description="SMS and WhatsApp channels for customer OTP, order updates and marketing. Growth plan and above." columns>
            <FullSpan><ToggleControl settingKey="feature_sms_enabled" label="SMS notifications" hint="When off, SMS channel is hidden from signin/signup and no SMS messages are sent." initial={c.flags.smsEnabled} /></FullSpan>
            <FullSpan><ToggleControl settingKey="feature_whatsapp_enabled" label="WhatsApp notifications" hint="When off, WhatsApp channel is hidden from signin/signup and no WhatsApp messages are sent." initial={c.flags.whatsappEnabled} /></FullSpan>
          </SectionCard>
        </div>
        )}

        <div>
          <SectionCard title="On-device AI" description="Experimental browser-based AI features. Per-platform switches control where the in-browser model runs; when it's off (or unsupported) on a platform, that device falls back to server-generated AI instead." columns>
            <FullSpan><ToggleControl settingKey="feature_ondevice_summary_enabled" label="On-device summaries" hint="AI cart/product/order summaries computed in the customer's browser. Master switch — turn on, then choose the platforms below." initial={c.flags.ondeviceSummaryEnabled} /></FullSpan>
            <FullSpan><div className="pl-4 border-l-2 border-border-default ml-1 space-y-3">
              <ToggleControl settingKey="feature_ondevice_summary_desktop_enabled" label="↳ Summaries on Desktop / System" hint="Run the in-browser model on desktop computers." initial={c.flags.ondeviceSummaryDesktopEnabled} />
              <ToggleControl settingKey="feature_ondevice_summary_mobile_enabled" label="↳ Summaries on Mobile" hint="Run the in-browser model on phones. Off by default — the ~400MB model is heavy on mobile, so phones use the server instead." initial={c.flags.ondeviceSummaryMobileEnabled} />
            </div></FullSpan>
            <FullSpan><div className="pt-2 border-t border-border-default" /></FullSpan>
            <FullSpan><ToggleControl settingKey="feature_ondevice_finetune_enabled" label="On-device fine-tuning" hint="Experimental on-device model fine-tuning worker. Master switch." initial={c.flags.ondeviceFinetuneEnabled} /></FullSpan>
            <FullSpan><div className="pl-4 border-l-2 border-border-default ml-1 space-y-3">
              <ToggleControl settingKey="feature_ondevice_finetune_desktop_enabled" label="↳ Fine-tuning on Desktop / System" hint="Run the fine-tuning worker on desktop computers." initial={c.flags.ondeviceFinetuneDesktopEnabled} />
              <ToggleControl settingKey="feature_ondevice_finetune_mobile_enabled" label="↳ Fine-tuning on Mobile" hint="Run the fine-tuning worker on phones. Off by default (too heavy for mobile)." initial={c.flags.ondeviceFinetuneMobileEnabled} />
            </div></FullSpan>
          </SectionCard>
        </div>

        <div>
          <SectionCard title="Legal & Banking" description="Business identity and bank details printed on invoices, quotations and purchase orders." columns>
            <TextControl settingKey="business_legal_name" label="Legal name" initial={inv.business_legal_name || ''} />
            <TextControl settingKey="business_trade_name" label="Trade name" initial={inv.business_trade_name || ''} />
            <TextControl settingKey="business_gstin" label="GSTIN" initial={inv.business_gstin || ''} />
            <FullSpan><TextAreaControl settingKey="business_address" label="Registered address" initial={inv.business_address || ''} rows={3} /></FullSpan>
            <TextControl settingKey="business_state" label="State" initial={inv.business_state || ''} />
            <TextControl settingKey="business_state_code" label="State code" hint="GST state code (e.g. 22 = Chhattisgarh). Used for CGST/SGST vs IGST determination." initial={inv.business_state_code || c.values.businessStateCode} />
            <TextControl settingKey="invoice_prefix" label="Invoice number prefix" initial={inv.invoice_prefix || 'JS'} />
            <FullSpan><div className="pt-2 border-t border-border-default" /></FullSpan>
            <TextControl settingKey="bank_name" label="Bank name" initial={inv.bank_name || ''} />
            <TextControl settingKey="bank_account" label="Account number" initial={inv.bank_account || ''} />
            <TextControl settingKey="bank_ifsc" label="IFSC code" initial={inv.bank_ifsc || ''} />
            <TextControl settingKey="bank_branch" label="Branch" initial={inv.bank_branch || ''} />
          </SectionCard>
        </div>

        <div>
          <SectionCard title="Delivery & Shipping" description="Free-delivery thresholds, shipping charge caps, warehouse origin and default weight." columns>
            <FullSpan><DeliverySettingsForm initial={delivery} /></FullSpan>
            <FullSpan><div className="pt-2 border-t border-border-default" /></FullSpan>
            <NumberControl settingKey="shipping_min_charge" label="Minimum shipping charge" hint="Floor applied to computed shipping (0 = none)." prefix="₹" initial={c.values.shippingMinCharge} />
            <NumberControl settingKey="shipping_max_charge" label="Maximum shipping charge" hint="Cap applied to computed shipping (0 = none)." prefix="₹" initial={c.values.shippingMaxCharge} />
            <TextControl settingKey="delhivery_origin_pincode" label="Warehouse origin pincode" hint="Ship-from pincode used for Delhivery rate & shipment creation." initial={c.values.delhiveryOriginPincode} />
            <NumberControl settingKey="default_product_weight_g" label="Default product weight" hint="Assumed weight for products with no weight set." suffix="g" min={1} initial={c.values.defaultProductWeightG} />
            <FullSpan><div className="pt-2 border-t border-border-default" /></FullSpan>
            <TextControl settingKey="delhivery_pickup_location" label="Pickup location name" hint="Registered Delhivery pickup location name." initial={c.values.pickupLocation} />
            <TextControl settingKey="delhivery_seller_name" label="Seller name" hint="Seller/return name on shipments." initial={c.values.sellerName} />
            <FullSpan><TextAreaControl settingKey="delhivery_seller_address" label="Pickup / return address" hint="Warehouse address used for pickups and returns." initial={c.values.sellerAddress} rows={2} /></FullSpan>
            <TextControl settingKey="delhivery_seller_phone" label="Pickup / return phone" initial={c.values.sellerPhone} />
          </SectionCard>
        </div>

        <div>
          <SectionCard title="Storefront Content" description="Homepage layout and copy." columns>
            <NumberControl settingKey="storefront_featured_limit" label="Featured products count" min={1} max={24} initial={c.storefront.featuredLimit} />
            <NumberControl settingKey="storefront_new_arrivals_limit" label="New arrivals count" min={1} max={24} initial={c.storefront.newArrivalsLimit} />
            <FullSpan><TextAreaControl settingKey="storefront_about_copy" label="About section copy" hint="Body text for the homepage 'About' section. Leave empty for the default." initial={c.storefront.aboutCopy} rows={4} /></FullSpan>
            <FullSpan><TextAreaControl settingKey="storefront_stats_json" label="Homepage stats (JSON)" hint={`Array like [{"label":"Years in Business","value":"10+"}]. Leave empty for defaults.`} initial={c.storefront.statsJson} rows={4} /></FullSpan>
          </SectionCard>
        </div>

        <div>
          <SectionCard title="Hero Slides" description="Manage the homepage hero carousel. Upload a banner, set the badge and copy, and assign product filters so the slide links straight to the matching products.">
            <HeroSlideManager
              initialSlides={hero.slides}
              categoryOptions={hero.categoryOptions}
              brandOptions={hero.brandOptions}
              gradeOptions={hero.gradeOptions}
              materialOptions={hero.materialOptions}
            />
          </SectionCard>
        </div>

        <div>
          <CustomerTagDefinitionsCard isSuperAdmin={admin.role === 'super_admin'} />
        </div>
      </div>
    </div>
  )
}
