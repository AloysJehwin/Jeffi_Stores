'use client'

import { useEffect, useState } from 'react'
import type { SelectOption } from '@/components/admin/AdminSelect'
import { MAX_SLIDES, safeHref, slidesConfig } from '@/lib/catalog/homepage-sections'
import {
  Grid,
  HeadingFields,
  Note,
  NumberField,
  Select,
  ToggleField,
  useSectionBinding,
  type EditorProps,
} from './fields'
import ProductPickerField from './ProductPickerField'
import TileListEditor, { readTiles, type Tile, type TileField } from './TileListEditor'

const LAYOUT_OPTIONS = [
  { value: 'cards', label: 'Cards (centred, neighbours fade out)' },
  { value: 'banner', label: 'Banner (one wide slide)' },
  { value: 'rail', label: 'Rail (scrolls sideways)' },
  { value: 'fade', label: 'Fade (one slide at a time)' },
]
const ASPECT_OPTIONS = [
  { value: '4:5', label: 'Portrait 4:5' },
  { value: '1:1', label: 'Square 1:1' },
  { value: '16:9', label: 'Wide 16:9' },
]
const KIND_OPTIONS = [
  { value: 'offer', label: 'Offer' },
  { value: 'category', label: 'Category' },
  { value: 'product', label: 'Product' },
  { value: 'custom', label: 'Custom slide' },
]
const MOTION_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'kenburns', label: 'Slow zoom' },
  { value: 'parallax', label: 'Parallax drift' },
  { value: 'reveal', label: 'Headline reveal' },
]
const MAX_SECONDS = 20

const REF_KEY: Record<string, string> = { offer: 'offerId', category: 'categoryId', product: 'productId' }
const CUSTOM_KEYS = ['image', 'imageCard', 'eyebrow', 'title', 'sub', 'ctaLabel', 'url', 'motion']
// `id` rides along as a hidden tile key so a slide keeps its identity across edits.
const KEYS = ['id', 'kind', ...Object.values(REF_KEY), ...CUSTOM_KEYS]
const BLANK: Tile = { ...Object.fromEntries(KEYS.map(k => [k, ''])), kind: 'offer' }

// What gets saved: ids minted for new slides, and only the keys the slide's kind reads.
function serialize(tiles: Tile[]) {
  return tiles.map(t => {
    const kind = t.kind === 'custom' || REF_KEY[t.kind] ? t.kind : 'offer'
    const id = t.id || crypto.randomUUID()
    if (kind !== 'custom') return { id, kind, [REF_KEY[kind]]: t[REF_KEY[kind]] ?? '' }
    return { id, kind, ...Object.fromEntries(CUSTOM_KEYS.map(k => [k, t[k] ?? ''])) }
  })
}

interface OfferRow {
  id: string
  title: string
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
  product_count: number
}

interface CategoryRow {
  id: string
  name: string
  parent_category_id: string | null
}

function offerOption(o: OfferRow): SelectOption {
  const now = Date.now()
  const state = !o.is_active
    ? ' · hidden'
    : o.ends_at && Date.parse(o.ends_at) < now
      ? ' · ended'
      : o.starts_at && Date.parse(o.starts_at) > now
        ? ' · not started'
        : ''
  return { value: o.id, label: o.title, hint: `${o.product_count} product${o.product_count === 1 ? '' : 's'}${state}` }
}

const offerOptions = (rows: OfferRow[]) => rows.map(offerOption)

// Departments in the catalogue's order, each followed by its sub-categories.
function categoryOptions(rows: CategoryRow[]): SelectOption[] {
  const children = new Map<string | null, CategoryRow[]>()
  for (const c of rows) children.set(c.parent_category_id, [...(children.get(c.parent_category_id) ?? []), c])
  const out: SelectOption[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const c of children.get(parent) ?? []) {
      out.push({ value: c.id, label: c.name, indent: depth > 0 })
      if (depth < 4) walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

// `map` must be module-level (stable), or the list reloads on every render.
function useOptions<T>(url: string, key: string, map: (rows: T[]) => SelectOption[]) {
  const [state, setState] = useState<{ options: SelectOption[]; status: 'loading' | 'ready' | 'failed' }>({
    options: [],
    status: 'loading',
  })
  useEffect(() => {
    let cancelled = false
    fetch(url, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => {
        if (!cancelled) setState({ options: map(Array.isArray(d[key]) ? d[key] : []), status: 'ready' })
      })
      .catch(() => {
        if (!cancelled) setState({ options: [], status: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [url, key, map])
  return state
}

const placeholder = (status: 'loading' | 'ready' | 'failed', ready: string, plural: string) =>
  status === 'loading' ? `Loading ${plural}…` : status === 'failed' ? `Could not load ${plural}` : ready

export default function SlidesEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const config = slidesConfig(section)
  const tiles: Tile[] = readTiles(b.cfg.items, KEYS).map(t => ({ ...t, kind: t.kind || 'offer' }))
  const offers = useOptions('/api/admin/product-offers', 'offers', offerOptions)
  const categories = useOptions('/api/categories', 'categories', categoryOptions)
  const unused = tiles.length - config.items.length
  const badLinks = tiles.filter(
    t => t.kind === 'custom' && [t.image, t.imageCard, t.url].some(v => v && !safeHref(v))
  ).length

  const kindField: TileField = { key: 'kind', label: 'Shows', kind: 'select', options: KIND_OPTIONS }
  const fieldsFor = (tile: Tile): TileField[] => {
    switch (tile.kind) {
      case 'category':
        return [
          kindField,
          {
            key: 'categoryId',
            label: 'Category',
            kind: 'select',
            options: categories.options,
            placeholder: placeholder(categories.status, 'Choose a category', 'categories'),
            hint: 'Shows its own image or its lead product’s photo, and its product count.',
          },
        ]
      case 'product':
        return [
          kindField,
          {
            key: 'productId',
            label: 'Product',
            kind: 'custom',
            render: (value, commit) => (
              <ProductPickerField
                label="Product"
                ids={value ? [value] : []}
                disabled={!canWrite}
                hint="Shown with its photo and price, and a button to add it to the cart."
                onCommit={ids => commit(ids[0] ?? '')}
              />
            ),
          },
        ]
      case 'custom':
        return [
          kindField,
          {
            key: 'motion',
            label: 'Motion',
            kind: 'select',
            options: MOTION_OPTIONS,
            placeholder: 'None',
            hint: 'Off for visitors who ask for reduced motion.',
          },
          {
            key: 'image',
            label: 'Image',
            kind: 'image',
            hint: 'Wide, about 1600×900. Used by every layout without a card image.',
          },
          {
            key: 'imageCard',
            label: 'Card image (optional)',
            kind: 'image',
            hint: 'Portrait 4:5, about 1080×1350, for the Cards layout.',
          },
          { key: 'eyebrow', label: 'Eyebrow', placeholder: 'New season' },
          { key: 'title', label: 'Title', placeholder: 'Built to last' },
          { key: 'sub', label: 'Subtitle', kind: 'textarea' },
          { key: 'ctaLabel', label: 'Button label', placeholder: 'Shop now' },
          { key: 'url', label: 'Link', placeholder: 'https://… or /products' },
        ]
      default:
        return [
          kindField,
          {
            key: 'offerId',
            label: 'Offer',
            kind: 'select',
            options: offers.options,
            placeholder: placeholder(offers.status, 'Choose an offer', 'offers'),
            hint: 'Uses the offer’s card image, badge and button, and links to its products.',
          },
        ]
    }
  }

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Optional line above the slides." />
      <Select
        label="Layout"
        value={config.layout}
        options={LAYOUT_OPTIONS}
        disabled={!canWrite}
        onChange={v => b.saveConfig({ layout: v })}
      />
      <Select
        label="Slide shape"
        value={config.aspect}
        options={ASPECT_OPTIONS}
        disabled={!canWrite}
        onChange={v => b.saveConfig({ aspect: v })}
      />
      <ToggleField
        label="Play automatically"
        checked={config.autoplay}
        disabled={!canWrite}
        hint="Pauses on hover, and stays still for visitors who prefer reduced motion."
        onChange={v => b.saveConfig({ autoplay: v })}
      />
      {config.autoplay && (
        <NumberField
          label="Seconds per slide"
          value={config.intervalSeconds}
          disabled={!canWrite}
          min={3}
          hint={`3 to ${MAX_SECONDS} seconds before the next slide.`}
          onCommit={v => b.saveConfig({ intervalSeconds: Math.min(MAX_SECONDS, v) })}
        />
      )}

      <TileListEditor
        label="Slides"
        hint={`Up to ${MAX_SLIDES}. Each slide shows an offer, a category, a product, or a picture and text of your own.`}
        tiles={tiles}
        fields={fieldsFor}
        blank={BLANK}
        disabled={!canWrite}
        max={MAX_SLIDES}
        showIcon={false}
        itemLabel="Slide"
        onCommit={next => b.saveConfig({ items: serialize(next) })}
      />

      {config.items.length === 0 && <Note>Add at least one slide; the section stays hidden until then.</Note>}
      {unused > 0 && (
        <Note>
          {unused === 1 ? 'One slide is' : `${unused} slides are`} not shown yet — offer, category and product slides
          need one picked, and custom slides need an image and a title.
        </Note>
      )}
      {badLinks > 0 && (
        <Note>
          Links and images must start with https:// or /. {badLinks === 1 ? 'One slide has' : `${badLinks} slides have`}{' '}
          a link that will be ignored.
        </Note>
      )}
      <Note>Hidden or ended offers, empty categories and inactive products are skipped on the storefront.</Note>
    </Grid>
  )
}
