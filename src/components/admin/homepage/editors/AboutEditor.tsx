'use client'

import AdminImage from '@/components/admin/AdminImage'
import { SECTION_TILE_DEFAULTS } from '@/lib/homepage-sections'
import {
  CtaFields,
  Grid,
  HeadingFields,
  LABEL_CLASS,
  Text,
  TextArea,
  copyHint,
  sectionCopy,
  useSectionBinding,
  type EditorProps,
} from './fields'
import TileListEditor, { readTiles } from './TileListEditor'

const STAT_KEYS = ['value', 'label']

const optional = (v: string) => (v.trim() ? v : null)

export default function AboutEditor(props: EditorProps) {
  const { section, canWrite, options } = props
  const b = useSectionBinding(props)
  const d = sectionCopy(props)
  const body = typeof b.cfg.body === 'string' ? b.cfg.body : null
  const imageUrl = typeof b.cfg.imageUrl === 'string' ? b.cfg.imageUrl : null

  return (
    <Grid>
      <HeadingFields props={props} />
      <TextArea
        label="Story"
        value={section.subtitle ?? d.subtitle ?? ''}
        disabled={!canWrite}
        hint={copyHint(section.subtitle == null && !!d.subtitle, 'The store story beside the photo.')}
        onCommit={b.subtitle}
      />
      <TextArea
        label="Second paragraph"
        value={body ?? d.body ?? ''}
        disabled={!canWrite}
        hint={copyHint(body == null && !!d.body)}
        onCommit={v => b.saveConfig({ body: optional(v) })}
      />
      <Text
        label="Photo"
        value={imageUrl ?? d.imageUrl ?? ''}
        disabled={!canWrite}
        placeholder="/images/about.jpg or https://…"
        hint={copyHint(imageUrl == null && !!d.imageUrl, 'Image URL shown beside the story.')}
        onCommit={v => b.saveConfig({ imageUrl: optional(v) })}
      />
      <div>
        <p className={LABEL_CLASS}>Photo preview</p>
        <div className="aspect-video w-full max-w-xs overflow-hidden rounded-lg border border-border-default">
          <AdminImage src={imageUrl || d.imageUrl} alt="About photo" className="w-full h-full object-cover" />
        </div>
      </div>
      <TileListEditor
        label="Stats"
        hint="Shown over the photo."
        tiles={readTiles(b.cfg.stats, STAT_KEYS)}
        defaults={options?.tileDefaults?.about ?? SECTION_TILE_DEFAULTS.about}
        fields={[
          { key: 'value', label: 'Value', placeholder: '10+' },
          { key: 'label', label: 'Label', placeholder: 'Years in Business' },
        ]}
        blank={{ value: '', label: '' }}
        showIcon={false}
        itemLabel="Stat"
        disabled={!canWrite}
        max={4}
        onCommit={items => b.saveConfig({ stats: items })}
      />
      <CtaFields
        props={props}
        urlPlaceholder="/about"
        hint="The main button. A second button always opens all products."
      />
    </Grid>
  )
}
