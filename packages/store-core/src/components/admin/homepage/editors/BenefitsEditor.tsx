'use client'

import { Grid, HeadingFields, useSectionBinding, type EditorProps } from './fields'
import TileListEditor, { readTiles } from './TileListEditor'
import { SECTION_TILE_DEFAULTS } from '@/lib/catalog/homepage-sections'

const KEYS = ['icon', 'title', 'sub']

export default function BenefitsEditor(props: EditorProps) {
  const { canWrite } = props
  const b = useSectionBinding(props)

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Optional — leave both empty to show the tiles with no heading." />
      <TileListEditor
        label="Tiles"
        tiles={readTiles(b.cfg.items, KEYS)}
        defaults={SECTION_TILE_DEFAULTS.benefits}
        fields={[
          { key: 'title', label: 'Title', placeholder: 'Bulk order discounts' },
          { key: 'sub', label: 'Description', kind: 'textarea' },
        ]}
        blank={{ icon: 'Receipt', title: '', sub: '' }}
        disabled={!canWrite}
        max={6}
        onCommit={items => b.saveConfig({ items })}
      />
    </Grid>
  )
}
