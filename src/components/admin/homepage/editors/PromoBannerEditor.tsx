'use client'

import AdminImage from '@/components/admin/AdminImage'
import { CtaFields, Grid, HeadingFields, Note, Select, Text, useSectionBinding, type EditorProps } from './fields'

const BACKGROUNDS = [
  { value: '', label: 'Default' },
  { value: 'bg-primary-500', label: 'Primary' },
  { value: 'bg-accent-500', label: 'Accent' },
  { value: 'bg-red-500', label: 'Red' },
  { value: 'bg-blue-600', label: 'Blue' },
  { value: 'bg-emerald-600', label: 'Emerald' },
  { value: 'bg-orange-600', label: 'Orange' },
  { value: 'bg-purple-600', label: 'Purple' },
  { value: 'bg-slate-900', label: 'Near black' },
]

const TEXT_COLORS = [
  { value: '', label: 'Default' },
  { value: 'text-white', label: 'White' },
  { value: 'text-slate-900', label: 'Near black' },
]

function Preview({ label, src, hint }: { label: string; src: string; hint: string }) {
  return (
    <div>
      <p className="text-[11px] text-foreground-muted mb-1">{label}</p>
      <div className="rounded-lg border border-border-default overflow-hidden bg-surface-secondary aspect-[16/6]">
        <AdminImage
          src={src || null}
          alt={label}
          blurhash={null}
          wrapperClassName="relative w-full h-full"
          className="w-full h-full object-cover"
          fallback={<span className="text-[10px] text-foreground-muted">{hint}</span>}
        />
      </div>
    </div>
  )
}

export default function PromoBannerEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const imageUrl = b.str('imageUrl')
  const imageUrlMobile = b.str('imageUrlMobile')

  return (
    <Grid>
      <Text
        label="Image URL (desktop)"
        value={imageUrl}
        disabled={!canWrite}
        placeholder="https://…"
        onCommit={v => b.saveConfig({ imageUrl: v || null })}
      />
      <Text
        label="Image URL (mobile)"
        value={imageUrlMobile}
        disabled={!canWrite}
        placeholder="https://…"
        hint="Optional — falls back to the desktop image."
        onCommit={v => b.saveConfig({ imageUrlMobile: v || null })}
      />

      <Preview label="Desktop preview" src={imageUrl} hint="No desktop image" />
      <Preview label="Mobile preview" src={imageUrlMobile || imageUrl} hint="No image" />

      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Limited offer." />

      <Text label="Subtitle" value={section.subtitle ?? ''} disabled={!canWrite} onCommit={b.subtitle} />
      <Select
        label="Background colour"
        value={b.str('background')}
        options={BACKGROUNDS}
        disabled={!canWrite}
        hint="Shows behind or beside the image."
        onChange={v => b.saveConfig({ background: v || null })}
      />
      <Select
        label="Text colour"
        value={b.str('textColor')}
        options={TEXT_COLORS}
        disabled={!canWrite}
        onChange={v => b.saveConfig({ textColor: v || null })}
      />

      <CtaFields props={props} />

      {!imageUrl && <Note>Add a desktop image — without one the banner renders as a plain colour block.</Note>}
    </Grid>
  )
}
