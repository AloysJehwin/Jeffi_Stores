'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import clsx from 'clsx'
import { Package, Plus, Check, Tag, Boxes, ImageIcon, Rocket, Store } from 'lucide-react'
import { BrowserFrame } from '@/app/ecom/BrowserFrame'
import ProductArt from '@/app/ecom/_demo/ProductArt'

// Standalone interactive mock of the Products & variants admin flow. In-memory only, no network.
// Mirrors the real ProductForm: name, SKU, base_price/mrp, GST, HSN, stock_status, variants, publish.

type StepId = 'details' | 'variants' | 'publish' | 'live'
const STEPS: { id: StepId; label: string; icon: typeof Package }[] = [
  { id: 'details', label: 'Product details', icon: Package },
  { id: 'variants', label: 'Add variants', icon: Boxes },
  { id: 'publish', label: 'Publish', icon: Rocket },
  { id: 'live', label: 'Live on storefront', icon: Store },
]

interface Variant { name: string; sku: string; price: number; mrp: number; stock: string }
const SEED_VARIANTS: Variant[] = [
  { name: 'Black', sku: 'NS-HD-01-BLK', price: 2499, mrp: 3199, stock: 'In Stock' },
  { name: 'White', sku: 'NS-HD-01-WHT', price: 2499, mrp: 3199, stock: 'Low Stock' },
]

const rs = (n: number) => 'Rs. ' + n.toLocaleString('en-IN')
const STOCK_TONE: Record<string, string> = {
  'In Stock': 'bg-green-100 text-green-800',
  'Low Stock': 'bg-amber-100 text-amber-800',
  'Out of Stock': 'bg-red-100 text-red-800',
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-foreground-muted">{label}</span>
      <div className="mt-1 flex items-center justify-between rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground">
        <span className="truncate">{value}</span>
        {hint && <span className="ml-2 shrink-0 text-[11px] text-foreground-muted">{hint}</span>}
      </div>
    </label>
  )
}

export default function ProductsDemo() {
  const [step, setStep] = useState<StepId>('details')
  const [variants, setVariants] = useState<Variant[]>([SEED_VARIANTS[0]])
  const [published, setPublished] = useState(false)

  const idx = STEPS.findIndex((s) => s.id === step)
  const go = useCallback((s: StepId) => setStep(s), [])

  const addVariant = () => {
    setVariants((v) => (v.length < SEED_VARIANTS.length ? SEED_VARIANTS.slice(0, v.length + 1) : v))
  }

  return (
    <div className="ecom-clean w-full">
      {/* stepper */}
      <div className="flex items-center overflow-x-auto pb-4">
        {STEPS.map((s, i) => {
          const done = i < idx
          const active = i === idx
          const Icon = s.icon
          return (
            <div key={s.id} className="flex items-center shrink-0">
              <button type="button" onClick={() => go(s.id)} className="group flex items-center gap-2">
                <span className={clsx('grid place-items-center w-7 h-7 rounded-full border text-[11px] font-bold transition',
                  (active || done) ? 'ecom-accent-bg ecom-accent-border text-white' : 'border-border-default bg-surface-elevated text-foreground-muted')}>
                  {done ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                </span>
                <span className={clsx('whitespace-nowrap text-xs font-medium', active ? 'text-foreground' : 'text-foreground-muted group-hover:text-foreground-secondary')}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <span className="mx-2 h-px w-8 bg-border-default" />}
            </div>
          )
        })}
      </div>

      <BrowserFrame alt="Products admin" caption={step === 'live' ? 'novastore.jeffistores.in' : 'admin - products'} className="w-full">
        <div className="bg-surface h-[520px] overflow-hidden p-4 sm:p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="h-full"
            >
              {step === 'details' && (
                <div className="h-full flex flex-col sm:flex-row gap-6">
                  <div className="shrink-0 w-full sm:w-56 rounded-xl border border-border-default bg-surface-secondary p-4 grid place-items-center">
                    <ProductArt category="Electronics" className="w-40 h-40" />
                    <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-foreground-muted"><ImageIcon className="w-3.5 h-3.5" /> 3 images</span>
                  </div>
                  <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
                    <div className="sm:col-span-2"><Field label="Product name" value="Wireless Headphones" /></div>
                    <Field label="SKU" value="NS-HD-01" hint="auto" />
                    <Field label="Category" value="Electronics" />
                    <Field label="Selling price (incl. GST)" value={rs(2499)} />
                    <Field label="MRP" value={rs(3199)} hint="22% off" />
                    <Field label="GST" value="18%" />
                    <Field label="HSN code" value="85183000" />
                    <div className="sm:col-span-2 flex flex-wrap gap-2 pt-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-secondary px-2.5 py-1 text-xs text-foreground-secondary"><Tag className="w-3 h-3" /> Featured</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-secondary px-2.5 py-1 text-xs text-foreground-secondary"><Boxes className="w-3 h-3" /> Has variants</span>
                    </div>
                  </div>
                </div>
              )}

              {step === 'variants' && (
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between shrink-0">
                    <h3 className="text-sm font-bold text-foreground">Variants</h3>
                    <button type="button" onClick={addVariant} disabled={variants.length >= SEED_VARIANTS.length}
                      className="ecom-accent-bg inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                      <Plus className="w-3.5 h-3.5" /> Add variant
                    </button>
                  </div>
                  <div className="mt-3 flex-1 min-h-0 overflow-hidden rounded-xl border border-border-default">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-secondary text-foreground-secondary">
                        <tr>{['Variant', 'SKU', 'Price', 'MRP', 'Stock'].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold">{h}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {variants.map((v) => (
                          <tr key={v.sku}>
                            <td className="px-3 py-2.5 font-medium text-foreground">{v.name}</td>
                            <td className="px-3 py-2.5 text-foreground-muted">{v.sku}</td>
                            <td className="px-3 py-2.5 text-foreground">{rs(v.price)}</td>
                            <td className="px-3 py-2.5 text-foreground-muted line-through">{rs(v.mrp)}</td>
                            <td className="px-3 py-2.5"><span className={clsx('rounded-full px-2 py-0.5 text-xs font-semibold', STOCK_TONE[v.stock])}>{v.stock}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {step === 'publish' && (
                <div className="h-full grid place-items-center text-center">
                  <div className="max-w-sm">
                    {published ? (
                      <>
                        <span className="ecom-accent-bg mx-auto grid place-items-center w-14 h-14 rounded-full text-white"><Check className="w-7 h-7" /></span>
                        <h3 className="mt-4 text-lg font-bold text-foreground">Published</h3>
                        <p className="mt-1 text-sm text-foreground-secondary">Wireless Headphones is now live with {variants.length} variant{variants.length > 1 ? 's' : ''}.</p>
                        <button type="button" onClick={() => go('live')} className="ecom-accent-bg mt-5 rounded-lg px-5 py-2.5 text-sm font-semibold text-white">See it on the storefront</button>
                      </>
                    ) : (
                      <>
                        <span className="mx-auto grid place-items-center w-14 h-14 rounded-full bg-surface-secondary text-foreground-muted"><Rocket className="w-7 h-7" /></span>
                        <h3 className="mt-4 text-lg font-bold text-foreground">Ready to publish</h3>
                        <p className="mt-1 text-sm text-foreground-secondary">Drafts stay hidden until you publish. One click makes it live on your storefront.</p>
                        <button type="button" onClick={() => setPublished(true)} className="ecom-accent-bg mt-5 rounded-lg px-5 py-2.5 text-sm font-semibold text-white">Publish product</button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {step === 'live' && (
                <div className="h-full grid place-items-center">
                  <div className="w-full max-w-xs rounded-2xl border border-border-default bg-surface overflow-hidden">
                    <div className="aspect-square bg-surface-secondary grid place-items-center"><ProductArt category="Electronics" className="w-32 h-32" /></div>
                    <div className="p-4">
                      <span className="text-[11px] text-foreground-muted">Electronics</span>
                      <p className="text-sm font-semibold text-foreground">Wireless Headphones</p>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-base font-black text-foreground">{rs(2499)}</span>
                        <span className="text-xs text-foreground-muted line-through">{rs(3199)}</span>
                        <span className="text-xs font-semibold text-green-700">22% off</span>
                      </div>
                      <button className="ecom-accent-bg mt-3 w-full rounded-lg py-2 text-sm font-semibold text-white">Add to cart</button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </BrowserFrame>

      <div className="mt-4 flex items-center justify-between">
        <button type="button" onClick={() => go(STEPS[Math.max(0, idx - 1)].id)} disabled={idx === 0}
          className="rounded-lg border border-border-default bg-surface px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-40">Back</button>
        <button type="button" onClick={() => go(STEPS[Math.min(STEPS.length - 1, idx + 1)].id)} disabled={idx === STEPS.length - 1}
          className="ecom-accent-bg rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Next step</button>
      </div>
    </div>
  )
}
