'use client'

import { safeHref } from '@/lib/catalog/homepage-sections'
import { CtaFields, Grid, HeadingFields, Note, useSectionBinding, type EditorProps } from './fields'
import TileListEditor, { readTiles } from './TileListEditor'

const KEYS = ['title', 'excerpt', 'url', 'imageUrl', 'video']

export default function BlogTeaserEditor(props: EditorProps) {
  const { canWrite } = props
  const b = useSectionBinding(props)
  const items = readTiles(b.cfg.items, KEYS)
  const badLinks = items.filter(i => [i.url, i.imageUrl, i.video].some(v => v && !safeHref(v))).length

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Guides." />
      <TileListEditor
        label="Articles"
        hint="Each card links to a guide, article or blog post. Cards without a title or link are not shown."
        tiles={items}
        fields={[
          { key: 'title', label: 'Title', placeholder: 'How to choose the right drill bit' },
          { key: 'excerpt', label: 'Summary', kind: 'textarea' },
          { key: 'url', label: 'Link', placeholder: 'https://… or /page' },
          { key: 'imageUrl', label: 'Image', kind: 'image', size: ['wide', 'landscape'], videoKey: 'video' },
        ]}
        blank={{ title: '', excerpt: '', url: '', imageUrl: '', video: '' }}
        disabled={!canWrite}
        max={6}
        showIcon={false}
        itemLabel="Article"
        onCommit={next => b.saveConfig({ items: next })}
      />
      <CtaFields props={props} hint="Optional link to all your articles." urlPlaceholder="https://…" />
      {badLinks > 0 && (
        <Note>
          Links and images must start with https:// or /. {badLinks === 1 ? 'One card has' : `${badLinks} cards have`} a
          link that will be ignored.
        </Note>
      )}
    </Grid>
  )
}
