'use client'

import { safeHref } from '@/lib/catalog/homepage-sections'
import { CtaFields, Grid, HeadingFields, Note, useSectionBinding, type EditorProps } from './fields'
import TileListEditor, { readTiles } from './TileListEditor'

const KEYS = ['imageUrl', 'url', 'caption']

export default function SocialStripEditor(props: EditorProps) {
  const { canWrite } = props
  const b = useSectionBinding(props)
  const items = readTiles(b.cfg.items, KEYS)
  const badLinks = items.filter(i => (i.url && !safeHref(i.url)) || (i.imageUrl && !safeHref(i.imageUrl))).length

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Follow along." />
      <TileListEditor
        label="Posts"
        hint="Each photo links to a post. Posts without an image or link are not shown."
        tiles={items}
        fields={[
          { key: 'imageUrl', label: 'Image URL', placeholder: 'https://…' },
          { key: 'url', label: 'Post link', placeholder: 'https://instagram.com/p/…' },
          { key: 'caption', label: 'Caption', placeholder: 'Shown on hover' },
        ]}
        blank={{ imageUrl: '', url: '', caption: '' }}
        disabled={!canWrite}
        max={12}
        showIcon={false}
        itemLabel="Post"
        onCommit={next => b.saveConfig({ items: next })}
      />
      <CtaFields
        props={props}
        hint="Your profile, e.g. https://instagram.com/yourstore. Leave empty to hide the button."
        urlPlaceholder="https://instagram.com/…"
      />
      {badLinks > 0 && (
        <Note>
          Links and images must start with https:// or /. {badLinks === 1 ? 'One post has' : `${badLinks} posts have`} a
          link that will be ignored.
        </Note>
      )}
    </Grid>
  )
}
