'use client'

import { useState } from 'react'
import { FolderTree, FolderPlus, Link2, Store, Plus } from 'lucide-react'
import { AppDemoShell, useSteps, Field, Panel, Btn, Tag, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'create', label: 'Create category', icon: FolderPlus },
  { id: 'nest', label: 'Nest sub-categories', icon: FolderTree },
  { id: 'assign', label: 'Assign products', icon: Link2 },
  { id: 'live', label: 'Storefront navigation', icon: Store },
]
const TREE = ['Audio', 'Lighting', 'Textiles']
const SUBS = ['Headphones', 'Speakers', 'Earbuds']
const PRODUCTS = ['Wireless Headphones', 'Studio Monitors', 'Travel Earbuds', 'Brass Lamp']

export default function CategoriesDemo() {
  const s = useSteps(STEPS)
  const [subs, setSubs] = useState(1)
  const [assigned, setAssigned] = useState<string[]>([])
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption={s.step === 'live' ? 'novastore.jeffistores.in' : 'admin - categories'}>
      {s.step === 'create' && (
        <div className="h-full max-w-md space-y-3">
          <Field label="Category name" value="Audio" />
          <Field label="Slug" value="/audio" hint="auto" />
          <Field label="Brand" value="Nova Originals" />
          <Field label="Visible on storefront" value={<Tag tone="ok">Yes</Tag>} />
        </div>
      )}
      {s.step === 'nest' && (
        <Panel title="Catalogue tree" action={<Btn onClick={() => setSubs(n => Math.min(3, n + 1))} disabled={subs >= 3}><Plus className="w-3.5 h-3.5" /> Add sub-category</Btn>}>
          <ul className="space-y-2">
            {TREE.map((t, i) => (
              <li key={t} className="rounded-2xl org-sand p-3">
                <span className="font-semibold text-foreground">{t}</span>
                {i === 0 && <ul className="mt-2 ml-5 space-y-1">{SUBS.slice(0, subs).map(x => <li key={x} className="text-sm text-foreground-secondary">↳ {x}</li>)}</ul>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {s.step === 'assign' && (
        <Panel title="Assign to Audio › Headphones">
          <ul className="space-y-2">
            {PRODUCTS.map(p => {
              const on = assigned.includes(p)
              return (
                <li key={p} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-elevated px-3 py-3 sm:px-4">
                  <span className="min-w-0 text-sm font-medium text-foreground">{p}</span>
                  <Btn tone={on ? 'sand' : 'solid'} onClick={() => setAssigned(a => (on ? a.filter(x => x !== p) : [...a, p]))}>{on ? 'Assigned' : 'Assign'}</Btn>
                </li>
              )
            })}
          </ul>
        </Panel>
      )}
      {s.step === 'live' && (
        <div className="h-full flex flex-col">
          <div className="flex flex-wrap gap-x-4 gap-y-2 sm:flex-nowrap sm:gap-6 border-b border-border-default pb-3 text-sm font-semibold">
            {TREE.map((t, i) => <span key={t} className={i === 0 ? 'ecom-accent-text' : 'text-foreground-secondary'}>{t}</span>)}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 sm:flex-nowrap">{SUBS.slice(0, subs).map(x => <Tag key={x} tone="warn">{x}</Tag>)}</div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(assigned.length ? assigned : PRODUCTS.slice(0, 2)).map(p => (
              <div key={p} className="rounded-2xl org-sand p-3"><div className="aspect-square rounded-xl org-peach mb-2" /><p className="text-xs font-medium text-foreground break-words sm:truncate">{p}</p></div>
            ))}
          </div>
        </div>
      )}
    </AppDemoShell>
  )
}
