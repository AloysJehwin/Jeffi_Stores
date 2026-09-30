'use client'

import { Grid, useSectionBinding, type EditorProps } from './fields'
import TileListEditor, { readTiles } from './TileListEditor'
import { SECTION_TILE_DEFAULTS } from '@/lib/homepage-sections'

const KEYS = ['icon', 'label']

export default function TrustStripEditor(props: EditorProps) {
  const { canWrite } = props
  const b = useSectionBinding(props)

  return (
    <Grid>
      <TileListEditor
        label="Strip items"
        hint="Write {amount} in a label to insert the free-delivery threshold."
        tiles={readTiles(b.cfg.items, KEYS)}
        defaults={SECTION_TILE_DEFAULTS.trust_strip}
        fields={[{ key: 'label', label: 'Label', placeholder: 'Free delivery above {amount}' }]}
        blank={{ icon: 'Truck', label: '' }}
        disabled={!canWrite}
        max={6}
        onCommit={items => b.saveConfig({ items })}
      />
    </Grid>
  )
}
