'use client'

import { useRef } from 'react'
import StaffVoiceMemo from './StaffVoiceMemo'
import { MAX_FILES, type StaffNoteDraft } from './useStaffNoteDraft'

export default function StaffAttachmentsPicker({ d, layout }: { d: StaffNoteDraft; layout: 'mobile' | 'desktop' }) {
  const galleryRef = useRef<HTMLInputElement>(null)
  const tile = 'flex items-center justify-center py-4 rounded-xl border-2 border-dashed border-border-secondary text-sm font-medium cursor-pointer hover:bg-surface-secondary'
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1.5">Photos</label>
        <div className={`grid gap-2 ${layout === 'mobile' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {layout === 'mobile' && (
            <label className={tile}>
              Take photo
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { d.addPhotos(e.target.files); e.target.value = '' }} />
            </label>
          )}
          <label className={tile}>
            {layout === 'mobile' ? 'Choose from gallery' : 'Choose or drop photos'}
            <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { d.addPhotos(e.target.files); e.target.value = '' }} />
          </label>
        </div>
        {d.previews.length > 0 && (
          <div className={`grid gap-2 mt-3 ${layout === 'mobile' ? 'grid-cols-4' : 'grid-cols-5'}`}>
            {d.previews.map((p, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-border-default">
                <img src={p.url} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => d.removePhoto(i)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs">x</button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-foreground-muted mt-1">Up to {MAX_FILES} attachments. Handwritten notes, sketches, measurements.</p>
      </div>
      <StaffVoiceMemo onRecorded={(blob, duration) => d.setAudio(blob ? { blob, duration } : null)} />
    </div>
  )
}
