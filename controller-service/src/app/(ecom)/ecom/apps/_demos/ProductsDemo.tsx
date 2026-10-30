'use client'

import { useState } from 'react'
import { Package, Boxes, ImageIcon, Rocket, Store, Plus } from 'lucide-react'
import ProductArt from '@controller/app/(ecom)/ecom/_demo/ProductArt'
import { AppDemoShell, useSteps, Field, Panel, Btn, Table, Tag, Done, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'details', label: 'Product details', icon: Package },
  { id: 'variants', label: 'Add variants', icon: Boxes },
  { id: 'media', label: 'Images & SEO', icon: ImageIcon },
  { id: 'publish', label: 'Publish', icon: Rocket },
  { id: 'live', label: 'Live on storefront', icon: Store },
]
const VARIANTS = [
  { name: 'Black', sku: 'NS-HD-01-BLK', price: 2499, mrp: 3199, stock: 'ok', label: 'In stock' },
  { name: 'White', sku: 'NS-HD-01-WHT', price: 2499, mrp: 3199, stock: 'warn', label: 'Low stock' },
  { name: 'Sand', sku: 'NS-HD-01-SND', price: 2699, mrp: 3399, stock: 'ok', label: 'In stock' },
] as const

export default function ProductsDemo() {
  const s = useSteps(STEPS)
  const [count, setCount] = useState(1)
  const [published, setPublished] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption={s.step === 'live' ? 'novastore.jeffistores.in' : 'admin - products'}>
      {s.step === 'details' && (
        <div className="h-full flex flex-col sm:flex-row gap-4 sm:gap-6">
          <div className="shrink-0 w-full sm:w-56 rounded-2xl org-sand p-4 grid place-items-center">
            <ProductArt category="Electronics" className="w-28 h-28 sm:w-40 sm:h-40" />
          </div>
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
            <div className="sm:col-span-2"><Field label="Product name" value="Wireless Headphones" /></div>
            <Field label="SKU" value="NS-HD-01" hint="auto" />
            <Field label="Category" value="Electronics" />
            <Field label="Selling price (incl. GST)" value={rs(2499)} />
            <Field label="MRP" value={rs(3199)} hint="22% off" />
            <Field label="GST" value="18%" />
            <Field label="HSN code" value="85183000" />
          </div>
        </div>
      )}
      {s.step === 'variants' && (
        <Panel title="Variants" action={<Btn onClick={() => setCount(c => Math.min(3, c + 1))} disabled={count >= 3}><Plus className="w-3.5 h-3.5" /> Add variant</Btn>}>
          <Table cols={['Variant', 'SKU', 'Price', 'MRP', 'Stock']} rows={VARIANTS.slice(0, count).map(v => [v.name, v.sku, rs(v.price), <s key="m" className="opacity-60">{rs(v.mrp)}</s>, <Tag key="t" tone={v.stock}>{v.label}</Tag>])} />
        </Panel>
      )}
      {s.step === 'media' && (
        <div className="h-full grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          <div className="grid grid-cols-3 gap-3 content-start">
            {['var(--org-peach)', 'var(--org-sage)', 'var(--org-apricot)', 'var(--org-sand)', 'var(--org-sage)', 'var(--org-peach)'].map((c, i) => (
              <div key={i} className="aspect-square rounded-2xl grid place-items-center" style={{ background: c }}>{i === 0 && <ProductArt category="Electronics" className="w-16 h-16" />}</div>
            ))}
          </div>
          <div className="space-y-3">
            <Field label="SEO title" value="Wireless Headphones — Nova Shop" hint="52 chars" />
            <Field label="Meta description" value="Studio-grade wireless headphones with 40h battery…" hint="148" />
            <Field label="URL" value="/products/wireless-headphones" />
          </div>
        </div>
      )}
      {s.step === 'publish' && (
        <Done icon={Rocket} title="Ready to publish" copy={`Drafts stay hidden until you publish. ${count} variant${count > 1 ? 's' : ''} will go live.`} done={published} onAction={() => setPublished(true)} actionLabel="Publish product" doneLabel="Published" action={<Btn onClick={() => s.go('live')}>See it on the storefront</Btn>} />
      )}
      {s.step === 'live' && (
        <div className="h-full grid place-items-center">
          <div className="w-full max-w-xs rounded-[2rem] org-sand overflow-hidden">
            <div className="aspect-square org-peach grid place-items-center"><ProductArt category="Electronics" className="w-32 h-32" /></div>
            <div className="p-5">
              <span className="text-[11px] text-foreground-muted">Electronics</span>
              <p className="font-display font-black text-lg text-foreground">Wireless Headphones</p>
              <div className="mt-1 flex items-baseline gap-2"><span className="text-base font-bold">{rs(2499)}</span><s className="text-xs opacity-60">{rs(3199)}</s><Tag tone="ok">22% off</Tag></div>
              <Btn>Add to cart</Btn>
            </div>
          </div>
        </div>
      )}
    </AppDemoShell>
  )
}
