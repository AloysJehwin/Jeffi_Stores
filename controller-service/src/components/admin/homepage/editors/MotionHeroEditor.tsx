'use client'

import { motionHeroIntervalMs, motionHeroSlides, safeHref } from '@/lib/catalog/homepage-sections'
import { Grid, Note, NumberField, useSectionBinding, type EditorProps } from './fields'
import TileListEditor, { readTiles } from './TileListEditor'

const KEYS = ['bgImage', 'bgVideo', 'fgImage', 'eyebrow', 'headline', 'sub', 'ctaLabel', 'url']
const MAX_SECONDS = 20

export default function MotionHeroEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const slides = readTiles(b.cfg.slides, KEYS)
  const badLinks = slides.filter(s => [s.url, s.bgImage, s.bgVideo, s.fgImage].some(v => v && !safeHref(v))).length

  return (
    <Grid>
      <TileListEditor
        label="Slides"
        hint="Each slide needs a background image and a headline. A background video plays over its image. The foreground image drifts over the background as the slide plays."
        tiles={slides}
        fields={tile => [
          {
            key: 'bgImage',
            label: 'Background',
            kind: 'image',
            size: ['hero', 'wide'],
            videoKey: 'bgVideo',
            defaultPrompt: tile.headline,
          },
          {
            key: 'fgImage',
            label: 'Foreground image (optional, PNG with transparency works best)',
            kind: 'image',
            size: ['square', 'portrait'],
          },
          { key: 'eyebrow', label: 'Eyebrow', placeholder: 'New season' },
          { key: 'headline', label: 'Headline', placeholder: 'Built to last' },
          { key: 'sub', label: 'Subtitle', kind: 'textarea' },
          { key: 'ctaLabel', label: 'Button label', placeholder: 'Shop now' },
          { key: 'url', label: 'Button link', placeholder: 'https://… or /products' },
        ]}
        blank={{ bgImage: '', bgVideo: '', fgImage: '', eyebrow: '', headline: '', sub: '', ctaLabel: '', url: '' }}
        disabled={!canWrite}
        max={8}
        showIcon={false}
        itemLabel="Slide"
        onCommit={next => b.saveConfig({ slides: next })}
      />
      <NumberField
        label="Seconds per slide"
        value={motionHeroIntervalMs(section) / 1000}
        disabled={!canWrite}
        min={3}
        hint={`3 to ${MAX_SECONDS} seconds before the next slide plays.`}
        onCommit={v => b.saveConfig({ intervalSeconds: Math.min(MAX_SECONDS, v) })}
      />

      {motionHeroSlides(section).length === 0 && (
        <Note>Add at least one slide with a background image and a headline; the hero stays hidden until then.</Note>
      )}
      {badLinks > 0 && (
        <Note>
          Links and images must start with https:// or /. {badLinks === 1 ? 'One slide has' : `${badLinks} slides have`}{' '}
          a link that will be ignored.
        </Note>
      )}
      <Note>This replaces the Hero slides section on this layout — the two can&apos;t be combined.</Note>
    </Grid>
  )
}
