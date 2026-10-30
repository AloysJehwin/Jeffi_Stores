'use client'

import { Grid, HeadingFields, useSectionBinding, type EditorProps } from './fields'
import TileListEditor, { readTiles } from './TileListEditor'
import { SECTION_TILE_DEFAULTS } from '@/lib/catalog/homepage-sections'

const KEYS = ['icon', 'title', 'desc', 'color']

const COLORS = [
  { value: 'primary', label: 'Primary' },
  { value: 'accent', label: 'Accent' },
  { value: 'secondary', label: 'Secondary' },
]

export default function WhyUsEditor(props: EditorProps) {
  const { canWrite } = props
  const b = useSectionBinding(props)

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Why us." />
      <TileListEditor
        label="Cards"
        tiles={readTiles(b.cfg.items, KEYS)}
        defaults={SECTION_TILE_DEFAULTS.why_us}
        fields={[
          { key: 'title', label: 'Title', placeholder: 'Fast Delivery' },
          { key: 'desc', label: 'Description', kind: 'textarea' },
          { key: 'color', label: 'Accent colour', kind: 'select', options: COLORS },
        ]}
        blank={{ icon: 'Truck', title: '', desc: '', color: 'primary' }}
        disabled={!canWrite}
        max={6}
        onCommit={items => b.saveConfig({ items })}
      />
    </Grid>
  )
}
