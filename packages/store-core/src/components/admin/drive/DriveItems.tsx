'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, File, FileSpreadsheet, FileText, Film, Folder, Images, Lock, MoreVertical, Music, Play, Users, type LucideIcon } from 'lucide-react'
import { GALLERY_FOLDER_ID, driveExt, formatBytes, type DriveFile, type DriveFolder, type DriveKind } from '@/lib/drive/types'

export const KIND_ICON: Record<DriveKind, LucideIcon> = { image: Images, video: Film, audio: Music, pdf: FileText, doc: FileSpreadsheet, other: File }

/** The time for files added today, else the date. */
export function when(iso: string): string {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export const VISIBILITY_LABEL = { private: 'Only you and people you share with', team: 'Everyone with Drive access', shared: 'People you share with' } as const

export function FileThumb({ f, className = '' }: { f: DriveFile; className?: string }) {
  const [broken, setBroken] = useState(false)
  const src = f.thumbUrl ?? (f.kind === 'image' ? f.url : null)
  if (src && !broken) {
    return (
      <div className={`relative bg-surface-secondary ${className}`}>
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-contain" />
        {f.kind === 'video' && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white">
              <Play className="h-4 w-4" />
            </span>
          </span>
        )}
      </div>
    )
  }
  const Icon = KIND_ICON[f.kind] ?? File
  return (
    <div className={`flex flex-col items-center justify-center gap-1 bg-surface-secondary text-foreground-muted ${className}`}>
      <Icon className="h-8 w-8" />
      <span className="text-[10px] font-semibold uppercase tracking-wide">{driveExt(f.name) || f.kind}</span>
    </div>
  )
}

export function FolderGlyph({ f, className = 'w-5 h-5' }: { f: DriveFolder; className?: string }) {
  if (f.id === GALLERY_FOLDER_ID) return <Images className={`${className} text-accent-500`} />
  return (
    <span className="relative inline-flex">
      <Folder className={`${className} text-primary-500`} fill="currentColor" fillOpacity={0.15} />
      {f.visibility === 'private' && <Lock className="absolute -bottom-0.5 -right-1 h-2.5 w-2.5 text-foreground-muted" />}
      {f.visibility === 'team' && <Users className="absolute -bottom-0.5 -right-1 h-2.5 w-2.5 text-foreground-muted" />}
    </span>
  )
}

export interface MenuItem {
  label: string
  icon: LucideIcon
  onClick: () => void
  danger?: boolean
}

/** The ⋮ menu on a file or folder. */
export function ItemMenu({ items, className = '' }: { items: Array<MenuItem | false | null | undefined>; className?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', off)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const list = items.filter(Boolean) as MenuItem[]
  if (!list.length) return null
  return (
    <div ref={box} className={`relative ${className}`} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-elevated/80 text-foreground-muted hover:bg-surface-secondary hover:text-foreground"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-[11rem] rounded-lg border border-border-default bg-surface-elevated py-1 shadow-xl">
          {list.map(it => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                it.onClick()
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-secondary ${it.danger ? 'text-red-600' : 'text-foreground'}`}
            >
              <it.icon className="h-4 w-4 shrink-0" />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface GridProps {
  folders: DriveFolder[]
  files: DriveFile[]
  view?: 'grid' | 'list'
  selected?: Set<string>
  onFolder: (f: DriveFolder) => void
  onFile: (f: DriveFile, e: React.MouseEvent) => void
  onFileOpen?: (f: DriveFile) => void
  folderMenu?: (f: DriveFolder) => ReactNode
  fileMenu?: (f: DriveFile) => ReactNode
  /** Why a file can't be picked here (greyed out), or null. */
  blocked?: (f: DriveFile) => string | null
  /** The tick on a tile toggles selection without opening the file. */
  onCheck?: (f: DriveFile) => void
  /** Shown as the uploader column in the list view. */
  showOwner?: boolean
  ownerLabel?: string
}

export function DriveGrid({ folders, files, view = 'grid', selected, onFolder, onFile, onFileOpen, folderMenu, fileMenu, blocked, onCheck, showOwner, ownerLabel = 'Uploaded by' }: GridProps) {
  const anySelected = !!selected?.size
  return (
    <div className="space-y-5">
      {folders.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Folders</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
            {folders.map(f => (
              <div
                key={f.id}
                role="button"
                tabIndex={0}
                onClick={() => onFolder(f)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onFolder(f))}
                className="group flex items-center gap-2.5 rounded-lg border border-border-default bg-surface-elevated px-3 py-2.5 text-left hover:border-primary-400 hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                <FolderGlyph f={f} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{f.name}</p>
                  <p className="truncate text-[11px] text-foreground-muted">
                    {f.systemKey ? 'System folder' : f.ownerName ? `Owner: ${f.ownerName}` : f.visibility === 'team' ? 'Team' : 'Private'}
                    {f.fileCount != null && ` · ${f.fileCount} item${f.fileCount === 1 ? '' : 's'}`}
                  </p>
                </div>
                {folderMenu?.(f)}
              </div>
            ))}
          </div>
        </section>
      )}
      {files.length > 0 && (
        <section>
          {folders.length > 0 && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Files</h3>}
          {view === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
              {files.map(f => {
                const reason = blocked?.(f) ?? null
                const on = !!selected?.has(f.id)
                return (
                  <div
                    key={f.id}
                    role="button"
                    tabIndex={reason ? -1 : 0}
                    aria-pressed={on}
                    aria-disabled={!!reason}
                    title={reason ?? f.name}
                    onClick={e => !reason && onFile(f, e)}
                    onDoubleClick={() => !reason && onFileOpen?.(f)}
                    onKeyDown={e => !reason && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onFile(f, e as unknown as React.MouseEvent))}
                    className={`group relative rounded-lg border-2 bg-surface-elevated text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                      on ? 'border-accent-500 ring-2 ring-accent-500/40' : 'border-border-default hover:border-accent-400'
                    } ${reason ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}`}
                  >
                    <FileThumb f={f} className="aspect-square w-full overflow-hidden rounded-t-md" />
                    {selected && (
                      <span
                        role={onCheck ? 'checkbox' : undefined}
                        aria-checked={onCheck ? on : undefined}
                        aria-label={onCheck ? `Select ${f.name}` : undefined}
                        onClick={
                          onCheck
                            ? e => {
                                e.stopPropagation()
                                onCheck(f)
                              }
                            : undefined
                        }
                        className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 ${on || anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${on ? 'border-accent-500 bg-accent-500 text-white' : 'border-white/90 bg-black/25 text-transparent'}`}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                    {fileMenu && <div className="absolute right-1 top-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">{fileMenu(f)}</div>}
                    <div className="px-2 py-1.5">
                      <p className="truncate text-xs font-medium text-foreground">{f.name}</p>
                      <p className="truncate text-[11px] text-foreground-muted">
                        {f.meta || formatBytes(f.size)} · {when(f.deletedAt ?? f.createdAt)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border-default">
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary text-left text-xs text-foreground-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    {showOwner && <th className="hidden px-3 py-2 font-medium md:table-cell">{ownerLabel}</th>}
                    <th className="px-3 py-2 font-medium">{files.some(f => f.source === 'document') ? 'Amount' : 'Size'}</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">{files.some(f => f.deletedAt) ? 'Deleted' : 'Added'}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {files.map(f => {
                    const reason = blocked?.(f) ?? null
                    const on = !!selected?.has(f.id)
                    return (
                      <tr
                        key={f.id}
                        title={reason ?? undefined}
                        onClick={e => !reason && onFile(f, e)}
                        onDoubleClick={() => !reason && onFileOpen?.(f)}
                        className={`border-t border-border-default ${on ? 'bg-accent-500/10' : 'hover:bg-surface-secondary'} ${reason ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}`}
                      >
                        <td className="px-3 py-1.5">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <FileThumb f={f} className="h-8 w-8 shrink-0 overflow-hidden rounded [&_svg]:h-4 [&_svg]:w-4 [&_span]:hidden" />
                            <span className="truncate font-medium text-foreground">{f.name}</span>
                          </div>
                        </td>
                        {showOwner && <td className="hidden px-3 py-1.5 text-foreground-secondary md:table-cell">{f.uploadedBy ?? '—'}</td>}
                        <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-foreground-secondary">{f.size ? formatBytes(f.size) : (f.meta?.split(' · ').pop() ?? '—')}</td>
                        <td className="hidden whitespace-nowrap px-3 py-1.5 text-foreground-secondary sm:table-cell">{when(f.deletedAt ?? f.createdAt)}</td>
                        <td className="px-1 py-1">{fileMenu?.(f)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
