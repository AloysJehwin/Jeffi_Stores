'use client'

import { configIds, configNumber } from '@/lib/homepage-sections'
import {
  Grid,
  HeadingFields,
  LABEL_CLASS,
  LimitField,
  NumberField,
  useSectionBinding,
  type EditorProps,
} from './fields'

const MAX_TABS = 8

export default function CategoryTabsEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const picked = configIds(section, 'categoryIds')
  const categories = props.options?.topCategories ?? []

  function toggle(id: string) {
    const next = picked.includes(id) ? picked.filter(p => p !== id) : [...picked, id].slice(0, MAX_TABS)
    b.saveConfig({ categoryIds: next })
  }

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Best sellers." />
      <NumberField
        label="Number of tabs"
        value={configNumber(section, 'tabs', 4, MAX_TABS)}
        disabled={!canWrite}
        hint={`Up to ${MAX_TABS}. Used when no categories are ticked below.`}
        onCommit={v => b.saveConfig({ tabs: Math.min(v, MAX_TABS) })}
      />
      <LimitField props={props} label="Products per tab" hint="Each category's best sellers first." />

      <div className="sm:col-span-2">
        <span className={LABEL_CLASS}>Categories</span>
        <p className="text-[11px] text-foreground-muted mb-2">
          {picked.length > 0
            ? `Showing ${picked.length} picked ${picked.length === 1 ? 'category' : 'categories'}, in the order you ticked them.`
            : 'None ticked: the section shows your categories with the most products.'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
          {categories.map(c => {
            const position = picked.indexOf(c.value)
            return (
              <label
                key={c.value}
                className="flex items-center gap-2 rounded-lg border border-border-default px-2.5 py-1.5 text-sm text-foreground cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={position >= 0}
                  disabled={!canWrite || (position < 0 && picked.length >= MAX_TABS)}
                  onChange={() => toggle(c.value)}
                  className="accent-accent-500"
                />
                <span className="flex-1 truncate">{c.label}</span>
                {position >= 0 && (
                  <span className="text-[11px] text-foreground-muted tabular-nums">{position + 1}</span>
                )}
              </label>
            )
          })}
        </div>
      </div>
    </Grid>
  )
}
