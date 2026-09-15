'use client'

import { Grid, HeadingFields, useSectionBinding, type EditorProps } from './fields'
import TileListEditor, { readTiles } from './TileListEditor'

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
        hint="Leave empty to keep the built-in Fast Delivery / Wide Range / 24-7 Support cards."
        tiles={readTiles(b.cfg.items, KEYS)}
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
