import { vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import type { HomepageSection } from '@/lib/catalog/homepage-sections'
import type { EditorProps } from '@/components/admin/homepage/editors/fields'

// Shared helpers for the homepage section-editor tests. Labels in these editors are plain <label>s next
// to their control (no htmlFor), so controls are found through the label's wrapper.

export const P1 = '11111111-1111-4111-8111-111111111111'
export const P2 = '22222222-2222-4222-8222-222222222222'

export const PRODUCTS = [
  { id: P1, name: 'Cordless Drill', sku: 'DRL-1', image_url: null, is_bundle: false },
  { id: P2, name: 'Drill Bit Set', sku: 'BIT-2', image_url: null, is_bundle: true },
]

export function makeSection(type: HomepageSection['type'], over: Partial<HomepageSection> = {}): HomepageSection {
  return {
    id: 'sec-1',
    type,
    title: null,
    subtitle: null,
    eyebrow: null,
    cta_label: null,
    cta_url: null,
    config: {},
    display_order: 0,
    is_active: true,
    starts_at: null,
    ends_at: null,
    ...over,
  }
}

export function renderEditor(
  Editor: ComponentType<EditorProps>,
  type: HomepageSection['type'],
  over: Partial<HomepageSection> = {},
  extra: Partial<EditorProps> = {}
) {
  const onChange = vi.fn<(...a: any[]) => any>()
  const onSave = vi.fn<(...a: any[]) => Promise<void>>(async () => {})
  const section = makeSection(type, over)
  const utils = render(<Editor section={section} canWrite onChange={onChange} onSave={onSave} {...extra} />)
  return { ...utils, onChange, onSave, section }
}

/** Wrapper div holding a label and its control; `index` picks among repeated labels (tiles). */
export function group(label: string, index = 0): HTMLElement {
  // Skip text that is not a field label (e.g. the selected value shown inside a select button).
  const els = screen
    .getAllByText(label, { selector: 'label,span,p' })
    .filter(el => !!el.parentElement?.querySelector('input,textarea,[role="combobox"],[role="switch"]'))
  return els[index].parentElement as HTMLElement
}

export function input(label: string, index = 0): HTMLInputElement | HTMLTextAreaElement {
  return group(label, index).querySelector('input,textarea') as HTMLInputElement | HTMLTextAreaElement
}

export function combo(label: string, index = 0): HTMLElement {
  return group(label, index).querySelector('[role="combobox"]') as HTMLElement
}

/** Type into a copy/number field and blur to commit. */
export function commit(el: HTMLElement, value: string) {
  fireEvent.focus(el)
  fireEvent.change(el, { target: { value } })
  fireEvent.blur(el)
}

/** Open an AdminSelect and pick an option by its label. */
export function choose(label: string, option: string, index = 0) {
  fireEvent.click(combo(label, index))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: new RegExp(option, 'i') }))
}

export function stubProductFetch(rows = PRODUCTS) {
  const fn = vi.fn(async (url: string) => {
    const q = new URL(url, 'http://x').searchParams
    const ids = q.get('ids')?.split(',')
    const text = q.get('q')?.toLowerCase()
    const products = ids
      ? rows.filter(r => ids.includes(r.id))
      : rows.filter(r => !text || r.name.toLowerCase().includes(text))
    return { ok: true, json: async () => ({ products }) }
  })
  vi.stubGlobal('fetch', fn as any)
  return fn
}
