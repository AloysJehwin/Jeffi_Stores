'use client'

import { Download, ExternalLink, FileSearch } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { Dialog } from '@/components/admin/kit'
import PdfPreview from '@/components/ui/PdfPreview'
import { formatBytes, type DriveFile } from '@/lib/drive/types'
import { FileThumb, when } from './DriveItems'

/** Inline view for images, video, audio and PDFs (pdf.js canvas: the app's headers forbid framing). */
export default function FilePreview({ f, onClose }: { f: DriveFile; onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      zIndex="z-[1100]"
      title={<span className="break-all">{f.name}</span>}
      description={f.meta ? `${f.meta} · ${when(f.createdAt)}` : `${formatBytes(f.size)} · ${when(f.createdAt)}${f.uploadedBy ? ` · ${f.uploadedBy}` : ''}${f.public ? ' · Public (gallery)' : ''}`}
      footer={
        <>
          {f.href && (
            <a href={ap(f.href)} className="control-md mr-auto inline-flex items-center gap-1.5 border border-border-default text-foreground-secondary hover:bg-surface-secondary">
              <FileSearch className="h-4 w-4" /> Open record
            </a>
          )}
          <a href={f.url} target="_blank" rel="noopener noreferrer" className="control-md inline-flex items-center gap-1.5 border border-border-default text-foreground-secondary hover:bg-surface-secondary">
            <ExternalLink className="h-4 w-4" /> Open in new tab
          </a>
          <a href={f.downloadUrl} download={f.name} className="control-md inline-flex items-center gap-1.5 bg-accent-500 font-semibold text-white hover:bg-accent-600">
            <Download className="h-4 w-4" /> Download
          </a>
        </>
      }
    >
      <div className="flex min-h-[40vh] items-center justify-center rounded-lg bg-black/5 dark:bg-black/30">
        {f.kind === 'image' ? (
          <img src={f.url} alt={f.name} className="max-h-[65vh] max-w-full object-contain" />
        ) : f.kind === 'video' ? (
          <video src={f.url} controls playsInline className="max-h-[65vh] max-w-full" />
        ) : f.kind === 'audio' ? (
          <audio src={f.url} controls className="w-full max-w-md" />
        ) : f.kind === 'pdf' ? (
          <div className="max-h-[65vh] w-full self-stretch overflow-y-auto p-3">
            <PdfPreview url={f.source === 'document' ? f.url : `${f.url}?raw=1`} />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <FileThumb f={f} className="h-24 w-24 rounded-xl" />
            <p className="text-sm text-foreground-secondary">No preview for this file type. Download it to open.</p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
