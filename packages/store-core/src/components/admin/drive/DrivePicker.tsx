'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, HardDrive, Loader2, Search, Upload } from 'lucide-react'
import { Dialog, fieldInputCls, useActionToast } from '@/components/admin/kit'
import AdminSelect from '@/components/admin/AdminSelect'
import { DRIVE_ACCEPT, GALLERY_FOLDER_ID, formatBytes, type DriveFile, type DriveKind } from '@/lib/drive/types'
import { driveApi, uploadDriveFile, type DriveListing } from './api'
import { DriveGrid } from './DriveItems'

export interface DrivePickOptions {
  title?: string
  multiple?: boolean
  max?: number
  /** Only these kinds can be picked; the rest show greyed out. */
  kinds?: DriveKind[]
  maxBytes?: number
  /** Offer the public Gallery folder (its items are gallery rows, not private files). */
  gallery?: boolean
  confirmLabel?: string
}

export const KIND_OPTIONS: { value: DriveKind | ''; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'doc', label: 'Documents' },
  { value: 'other', label: 'Other' },
]

/** Pick files from the Drive (or upload one into it), for every attach button in the admin. */
export default function DrivePicker({
  title = 'Choose from Drive',
  multiple = true,
  max = 10,
  kinds,
  maxBytes,
  gallery = false,
  confirmLabel,
  onPick,
  onClose,
}: DrivePickOptions & { onPick: (files: DriveFile[]) => void; onClose: () => void }) {
  const toast = useActionToast()
  const [folder, setFolder] = useState('root')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<DriveKind | ''>(kinds?.length === 1 ? kinds[0] : '')
  const [data, setData] = useState<DriveListing | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<DriveFile[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [reload, setReload] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    setPage(0)
    driveApi
      .list({ folder, q, kind }, ac.signal)
      .then(setData)
      .catch(e => !ac.signal.aborted && setError(e.message))
      .finally(() => !ac.signal.aborted && setLoading(false))
    return () => ac.abort()
  }, [folder, q, kind, reload])

  const more = async () => {
    const next = page + 1
    try {
      const d = await driveApi.list({ folder, q, kind, page: next })
      setData(prev => (prev ? { ...prev, files: [...prev.files, ...d.files] } : d))
      setPage(next)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const blocked = useCallback(
    (f: DriveFile): string | null => {
      if (kinds && !kinds.includes(f.kind)) return 'This type can’t be used here'
      if (maxBytes && f.size > maxBytes) return `Larger than ${formatBytes(maxBytes)}`
      return null
    },
    [kinds, maxBytes]
  )

  const toggle = (f: DriveFile) => {
    if (!multiple) return onPick([f])
    setPicked(p => (p.some(x => x.id === f.id) ? p.filter(x => x.id !== f.id) : p.length >= max ? p : [...p, f]))
  }

  const upload = async (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (input.current) input.current.value = ''
    for (const file of list) {
      setProgress(0)
      try {
        const out = await uploadDriveFile(file, folder === 'root' ? null : folder, setProgress)
        if (out.file && !blocked(out.file)) {
          if (!multiple) return onPick([out.file])
          setPicked(p => (p.length >= max ? p : [...p, out.file!]))
        }
      } catch (e: any) {
        toast.error(`${file.name}: ${e.message}`)
      }
    }
    setProgress(null)
    setReload(n => n + 1)
  }

  const folders = (data?.folders ?? []).filter(f => gallery || f.id !== GALLERY_FOLDER_ID)
  const files = data?.files ?? []
  const canUpload = folder === 'root' || (data?.folder?.access ?? 'view') !== 'view'
  const crumbs = data?.path ?? []
  const selected = new Set(picked.map(p => p.id))

  return (
    <Dialog
      open
      onClose={onClose}
      zIndex="z-[1100]"
      size="xl"
      title={title}
      description={kinds || maxBytes ? hint(kinds, maxBytes) : undefined}
      footer={
        multiple ? (
          <>
            <span className="mr-auto text-xs text-foreground-muted">{picked.length ? `${picked.length} selected` : multiple ? `Pick up to ${max}` : ''}</span>
            <button type="button" onClick={onClose} className="control-md border border-border-default text-foreground-secondary hover:bg-surface-secondary">
              Cancel
            </button>
            <button
              type="button"
              disabled={!picked.length}
              onClick={() => onPick(picked)}
              className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmLabel ?? (picked.length ? `Attach ${picked.length} file${picked.length === 1 ? '' : 's'}` : 'Attach')}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="-m-5 flex min-h-[420px] flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-default px-5 py-3">
          <nav aria-label="Folder" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
            <Crumb onClick={() => setFolder('root')} active={folder === 'root'}>
              <HardDrive className="h-4 w-4" /> Drive
            </Crumb>
            {crumbs.map((c, i) => (
              <span key={c.id} className="flex min-w-0 items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                <Crumb onClick={() => setFolder(c.id)} active={i === crumbs.length - 1}>
                  <span className="truncate">{c.name}</span>
                </Crumb>
              </span>
            ))}
          </nav>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={folder === 'root' ? 'Search all files' : 'Search this folder'} className={`${fieldInputCls} w-full pl-8`} />
          </div>
          <div className="w-36">
            <AdminSelect value={kind} onChange={v => setKind(v as DriveKind | '')} options={KIND_OPTIONS.filter(o => !o.value || !kinds || kinds.includes(o.value as DriveKind))} />
          </div>
          <button
            type="button"
            disabled={!canUpload || progress !== null}
            onClick={() => input.current?.click()}
            className="control-md inline-flex items-center gap-1.5 border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
          >
            {progress !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {progress !== null ? `${progress}%` : 'Upload'}
          </button>
          <input ref={input} type="file" multiple={multiple} accept={folder === GALLERY_FOLDER_ID ? 'image/*' : DRIVE_ACCEPT} hidden onChange={e => upload(e.target.files)} />
        </div>

        <div className="flex-1 px-5 py-4">
          {loading && !data ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-accent-500" />
            </div>
          ) : error ? (
            <p className="py-16 text-center text-sm text-red-600">{error}</p>
          ) : !folders.length && !files.length ? (
            <p className="py-16 text-center text-sm text-foreground-secondary">{q ? 'No files match your search.' : canUpload ? 'Nothing here yet. Upload a file to use it.' : 'Nothing here yet.'}</p>
          ) : (
            <div className={loading ? 'pointer-events-none opacity-60' : ''}>
              <DriveGrid folders={folders} files={files} selected={multiple ? selected : undefined} onFolder={f => setFolder(f.id)} onFile={toggle} blocked={blocked} />
              {files.length < (data?.total ?? 0) && (
                <div className="mt-4 flex justify-center">
                  <button type="button" onClick={more} className="control-sm border border-border-default text-foreground-secondary hover:bg-surface-secondary">
                    Show more
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}

function Crumb({ children, onClick, active }: { children: ReactNode; onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 ${active ? 'font-semibold text-foreground' : 'text-foreground-secondary hover:bg-surface-secondary hover:text-foreground'}`}
    >
      {children}
    </button>
  )
}

const KIND_NOUN: Record<DriveKind, string> = { image: 'images', video: 'videos', audio: 'audio', pdf: 'PDFs', doc: 'documents', other: 'other files' }

function hint(kinds?: DriveKind[], maxBytes?: number) {
  const k = kinds?.map(x => KIND_NOUN[x]).join(', ')
  return [k && `Only ${k}`, maxBytes && `up to ${formatBytes(maxBytes)}`].filter(Boolean).join(', ')
}

/** `pick()` opens the picker and resolves with the files (null if closed); render `node`. */
export function useDrivePicker() {
  const [req, setReq] = useState<{ opts: DrivePickOptions; resolve: (f: DriveFile[] | null) => void } | null>(null)
  const pick = useCallback((opts: DrivePickOptions = {}) => new Promise<DriveFile[] | null>(resolve => setReq({ opts, resolve })), [])
  const node = req ? (
    <DrivePicker
      {...req.opts}
      onClose={() => {
        req.resolve(null)
        setReq(null)
      }}
      onPick={f => {
        req.resolve(f)
        setReq(null)
      }}
    />
  ) : null
  return { pick, node }
}
