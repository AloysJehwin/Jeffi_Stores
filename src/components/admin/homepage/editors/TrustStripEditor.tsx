'use client'

import { Grid, useSectionBinding, type EditorProps } from './fields'
import TileListEditor, { readTiles } from './TileListEditor'

const KEYS = ['icon', 'label']

export default function TrustStripEditor(props: EditorProps) {
  const { canWrite } = props
  const b = useSectionBinding(props)

  return (
    <Grid>
      <TileListEditor
        label="Strip items"
        hint="Leave empty to keep the built-in delivery, GST, stock and payment items. Write {amount} in a label to insert the free-delivery threshold."
        tiles={readTiles(b.cfg.items, KEYS)}
        fields={[
          { key: 'label', label: 'Label', placeholder: 'Free delivery above {amount}' },
        ]}
        blank={{ icon: 'Truck', label: '' }}
        disabled={!canWrite}
        max={6}
        onCommit={items => b.saveConfig({ items })}
      />
    </Grid>
  )
}
