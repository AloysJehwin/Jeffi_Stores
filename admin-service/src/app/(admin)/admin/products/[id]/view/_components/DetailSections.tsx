import { Badge, Field } from '@/components/admin/kit'
import UnitsManager from '@/components/admin/UnitsManager'
import { formatINR } from '@/lib/shared/format'
import { CollapsibleCard, FieldGrid, Row } from './CollapsibleCard'
import { SubscriptionDetails } from './SubscriptionDetails'
import { GREEN, ORANGE, RED, listOrNull } from './product-view'

const money = (v: unknown) => (v != null ? formatINR(Number(v)) : null)
const day = (v: unknown) => (v ? new Date(v as string).toLocaleDateString('en-IN') : null)

function Details({ p }: { p: any }) {
  return (
    <CollapsibleCard title="Details" defaultOpen>
      <FieldGrid>
        <Row label="Category" value={p.categories?.name} />
        <Row label="Brand" value={p.brands?.name} />
        <Row label="GST" value={p.gst_percentage != null ? `${Number(p.gst_percentage).toFixed(2)}%` : null} />
        <Row label="HSN Code" value={p.hsn_code} mono />
        <Row label="MPN" value={p.mpn} mono />
        <Row label="GTIN" value={p.gtin} mono />
        <Row label="Barcode" value={p.barcode} mono />
        <Row label="ISBN" value={p.isbn} mono />
        <Row label="ASIN" value={p.asin} mono />
        <Row label="Brand Part No." value={p.brand_part_number} mono />
        <Row label="Variant Type" value={p.variant_type} />
        <Row label="Sub-Variant Type" value={p.sub_variant_type} />
        <Row label="Condition" value={p.condition} />
        <Row label="Grade" value={p.grade} />
        <Row label="Slug" value={p.slug} mono wide />
      </FieldGrid>
    </CollapsibleCard>
  )
}

function StockShipping({ p }: { p: any }) {
  const inventoryQty = p.has_variants ? Number(p.variant_inventory_total || 0) : Number(p.inventory_quantity || 0)
  const listedQty = Number(p.variant_stock_total || 0)
  const stockColor = inventoryQty === 0 ? RED : p.stock_status === 'Low Stock' ? ORANGE : GREEN
  return (
    <CollapsibleCard title="Stock & Shipping" defaultOpen>
      <FieldGrid>
        <Field
          label="Inventory Stock"
          value={
            <span className={`font-semibold ${stockColor}`}>
              {inventoryQty}
              {p.has_variants ? ' (variants)' : ''}
            </span>
          }
        />
        {p.has_variants && <Field label="Listed (Online)" value={<span className="font-semibold">{listedQty}</span>} />}
        <Row label="Stock Status" value={p.stock_status} />
        <Row label="Weight" value={p.weight ? `${p.weight} kg` : null} />
        <Row label="Weight (g)" value={p.weight_grams} />
        <Row label="Net Weight (g)" value={p.net_weight_grams} />
        <Row label="Volume (ml)" value={p.volume_ml} />
        <Row label="Dimensions" value={p.dimensions} />
        {(p.length_cm || p.breadth_cm || p.height_cm) && (
          <Field
            label="L × B × H"
            mono
            value={
              <>
                {p.length_cm} × {p.breadth_cm} × {p.height_cm} cm
              </>
            }
          />
        )}
        <Row label="Package Type" value={p.package_type} />
        <Row label="Handling Days" value={p.handling_days} />
        <Row label="Extra Delivery Days" value={p.extra_delivery_days} />
        <Row label="Shipping Class" value={p.shipping_class} />
        <Row label="Volumetric Weight (g)" value={p.volumetric_weight_grams} />
        {p.is_oversized && <Row label="Oversized" value="Yes" />}
        <Row label="Country of Origin" value={p.country_of_origin} />
      </FieldGrid>
    </CollapsibleCard>
  )
}

function PricingFinance({ p }: { p: any }) {
  return (
    <CollapsibleCard title="Pricing & Finance">
      <FieldGrid>
        <Row label="MRP (incl. GST)" value={money(p.mrp)} />
        <Row label="MRP (ex-GST)" value={money(p.mrp_ex_gst)} />
        <Row label="Selling Price" value={money(p.base_price)} />
        <Row label="Price (ex-GST)" value={money(p.price_ex_gst)} />
        <Row label="Cost Price" value={money(p.cost_price)} />
        <Row label="Discount %" value={p.discount_pct != null ? `${p.discount_pct}%` : null} />
        <Row label="Tax Class" value={p.tax_class} />
        <Row label="Inclusive Tax" value={p.inclusive_tax ? 'Yes' : 'No'} />
        <Row label="COD Allowed" value={p.is_cod_allowed ? 'Yes' : 'No'} />
        {p.is_subscription && <Row label="Subscription" value="Yes" />}
      </FieldGrid>
    </CollapsibleCard>
  )
}

function PhysicalCompliance({ p }: { p: any }) {
  const hasCertifications = Array.isArray(p.certifications) && p.certifications.length
  const empty =
    !p.material &&
    !p.finish &&
    !p.size &&
    !p.color &&
    !p.shelf_life_days &&
    !hasCertifications &&
    !p.compliance_standard &&
    !p.safety_rating &&
    !p.warranty_months &&
    !p.fragile &&
    !p.hazardous &&
    !p.flammable &&
    !p.perishable &&
    !p.serialized
  return (
    <CollapsibleCard title="Physical & Compliance">
      {empty ? (
        <p className="text-xs italic text-foreground-muted">No physical or compliance data configured.</p>
      ) : (
        <div className="space-y-3">
          <FieldGrid>
            <Row label="Material" value={p.material} />
            <Row label="Finish" value={p.finish} />
            <Row label="Size" value={p.size} />
            <Row label="Color" value={p.color} />
            <Row label="Color Hex" value={p.color_hex} mono />
            <Row label="Shelf Life (days)" value={p.shelf_life_days} />
            <Row label="Certifications" value={listOrNull(p.certifications)} wide />
            <Row label="Compliance Standard" value={p.compliance_standard} />
            <Row label="Safety Rating" value={p.safety_rating} />
            <Row
              label="Warranty"
              value={p.warranty_months ? `${p.warranty_months} months${p.warranty_type ? ` (${p.warranty_type})` : ''}` : null}
            />
          </FieldGrid>
          <div className="flex flex-wrap gap-2">
            {p.fragile && <Badge tone="amber">Fragile</Badge>}
            {p.hazardous && <Badge tone="red">Hazardous</Badge>}
            {p.flammable && <Badge tone="amber">Flammable</Badge>}
            {p.perishable && <Badge tone="green">Perishable</Badge>}
            {p.serialized && <Badge tone="blue">Serialized</Badge>}
          </div>
        </div>
      )}
    </CollapsibleCard>
  )
}

function Lifecycle({ p }: { p: any }) {
  return (
    <CollapsibleCard title="Lifecycle & Merchandising">
      <FieldGrid>
        <Row label="Launch Date" value={day(p.launch_date)} />
        <Row label="Discontinue Date" value={day(p.discontinue_date)} />
        <Row label="Sort Order" value={p.sort_order} />
        <Row label="Views" value={p.views_count} />
        <Row label="Sales" value={p.sales_count} />
        {p.is_bundle && <Row label="Bundle" value="Yes" />}
        {p.is_digital && (
          <>
            <Row label="Digital Product" value="Yes" />
            <Row label="Downloadable by Default" value={p.downloadable ? 'Yes' : null} />
            <Row label="License Type" value={p.license_type} />
            <Row label="File Format" value={p.file_format} />
            <Row label="Platform Compat." value={listOrNull(p.platform_compatibility)} />
          </>
        )}
      </FieldGrid>
    </CollapsibleCard>
  )
}

const text = (v: unknown) => (v ? <span className="whitespace-pre-line">{String(v)}</span> : null)

function Commercial({ p }: { p: any }) {
  const keys = ['model_number', 'series', 'pack_size', 'moq', 'lead_time_days', 'return_window_days', 'replacement_policy']
  if (!keys.some(k => p[k] != null && p[k] !== '')) return null
  return (
    <CollapsibleCard title="Commercial">
      <FieldGrid>
        <Row label="Model No." value={p.model_number} mono />
        <Row label="Series" value={p.series} />
        <Row label="Pack Size" value={p.pack_size} />
        <Row label="MOQ" value={p.moq} />
        <Row label="Lead Time (days)" value={p.lead_time_days} />
        <Row label="Return Window (days)" value={p.return_window_days} />
        <Row label="Replacement Policy" value={text(p.replacement_policy)} wide />
      </FieldGrid>
    </CollapsibleCard>
  )
}

function LegalMetrology({ p }: { p: any }) {
  const keys = ['manufacturer_name', 'packer_name', 'importer_name', 'consumer_care', 'mfg_month_year', 'net_quantity', 'best_before']
  if (!keys.some(k => p[k] != null && p[k] !== '')) return null
  return (
    <CollapsibleCard title="Legal Metrology">
      <FieldGrid>
        <Row label="Manufacturer" value={p.manufacturer_name} />
        <Row label="Manufacturer Address" value={text(p.manufacturer_address)} wide />
        <Row label="Packer" value={p.packer_name} />
        <Row label="Packer Address" value={text(p.packer_address)} wide />
        <Row label="Importer" value={p.importer_name} />
        <Row label="Importer Address" value={text(p.importer_address)} wide />
        <Row label="Net Quantity" value={p.net_quantity != null ? `${Number(p.net_quantity)} ${p.net_quantity_unit ?? ''}`.trim() : null} />
        <Row label="Mfg. Month/Year" value={p.mfg_month_year} />
        <Row label="Best Before" value={p.best_before} />
        <Row label="Consumer Care" value={text(p.consumer_care)} wide />
      </FieldGrid>
    </CollapsibleCard>
  )
}

function Usage({ p }: { p: any }) {
  if (!p.in_the_box && !p.usage_instructions && !p.care_instructions && !p.safety_warnings) return null
  return (
    <CollapsibleCard title="Usage & Care">
      <FieldGrid>
        <Row label="In the Box" value={text(p.in_the_box)} wide />
        <Row label="Usage" value={text(p.usage_instructions)} wide />
        <Row label="Care" value={text(p.care_instructions)} wide />
        <Row label="Safety Warnings" value={text(p.safety_warnings)} wide />
      </FieldGrid>
    </CollapsibleCard>
  )
}

function Faqs({ faqs }: { faqs: any[] }) {
  if (!faqs?.length) return null
  return (
    <CollapsibleCard title={`FAQs (${faqs.length})`}>
      <dl className="space-y-3">
        {faqs.map(f => (
          <div key={f.id}>
            <dt className="text-sm font-medium text-foreground">
              {f.question}
              {f.published === false && <span className="ml-2 text-xs font-normal text-foreground-muted">(hidden)</span>}
            </dt>
            <dd className="mt-0.5 whitespace-pre-line text-sm text-foreground-secondary">{f.answer}</dd>
          </div>
        ))}
      </dl>
    </CollapsibleCard>
  )
}

function Internal({ p }: { p: any }) {
  if (!p.internal_notes && !p.source_url) return null
  return (
    <CollapsibleCard title="Internal">
      <FieldGrid>
        <Row label="Notes" value={text(p.internal_notes)} wide />
        <Row label="Source URL" value={p.source_url} mono wide />
      </FieldGrid>
    </CollapsibleCard>
  )
}

function SeoAudience({ p }: { p: any }) {
  return (
    <CollapsibleCard title="SEO & Audience">
      <FieldGrid>
        <Row label="Meta Title" value={p.meta_title} wide />
        <Row label="Meta Description" value={p.meta_description} wide />
        <Row label="Meta Keywords" value={listOrNull(p.meta_keywords)} wide />
        <Row label="Age Rating" value={p.age_rating} />
        <Row label="Searchable" value={p.is_searchable ? 'Yes' : 'No'} />
        <Row label="Target Gender" value={p.target_gender} />
        <Row label="Target Audience" value={listOrNull(p.target_audience)} />
        <Row label="Age Range" value={p.age_min != null || p.age_max != null ? `${p.age_min ?? '—'} – ${p.age_max ?? '—'}` : null} />
      </FieldGrid>
    </CollapsibleCard>
  )
}

/** The two-up grid of collapsed attribute cards. */
export function DetailSections({ p, variants }: { p: any; variants: any[] }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
      <Details p={p} />
      <StockShipping p={p} />
      <PricingFinance p={p} />
      {p.is_subscription && (
        <CollapsibleCard title="Subscription">
          <SubscriptionDetails p={p} variants={variants} />
        </CollapsibleCard>
      )}
      {p.description && (
        <CollapsibleCard title="Description">
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{p.description}</p>
        </CollapsibleCard>
      )}
      <CollapsibleCard title="Selling Units">
        <UnitsManager productId={p.id} basePrice={p.base_price} readOnly />
      </CollapsibleCard>
      <PhysicalCompliance p={p} />
      <Commercial p={p} />
      <LegalMetrology p={p} />
      <Usage p={p} />
      <Faqs faqs={p.faqs} />
      <Lifecycle p={p} />
      <SeoAudience p={p} />
      <Internal p={p} />
    </div>
  )
}

export function Specifications({ specs }: { specs: Record<string, unknown> }) {
  return (
    <CollapsibleCard title="Specifications">
      <FieldGrid>
        {Object.entries(specs).map(([k, v]) => (
          <Field key={k} label={k} value={<>{String(v)}</>} mono />
        ))}
      </FieldGrid>
    </CollapsibleCard>
  )
}
