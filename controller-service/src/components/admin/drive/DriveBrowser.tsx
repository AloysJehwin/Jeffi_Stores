'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  FileSearch,
  FileSignature,
  FileText,
  FolderInput,
  FolderOpen,
  FolderPlus,
  HardDrive,
  ImagePlus,
  Images,
  LayoutGrid,
  List,
  Loader2,
  Package,
  Pencil,
  ReceiptText,
  RotateCcw,
  Search,
  Share2,
  Tag,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react'
import { Dialog, EmptyState, ErrorState, fieldInputCls, useActionToast } from '@/components/admin/kit'
import AdminSelect from '@/components/admin/AdminSelect'
import { useConfirm, usePrompt } from '@/contexts/ConfirmContext'
import { useCanWrite, useHasScope } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import { DOC_FOLDERS, DRIVE_ACCEPT, GALLERY_FOLDER_ID, isDocFolder, type DocFolder, type DriveFile, type DriveFolder, type DriveKind, type DriveVisibility } from '@/lib/drive/types'
import { driveApi, uploadDriveFile, type DriveListing, type ShareTarget } from './api'
import { DriveGrid, ItemMenu, VISIBILITY_LABEL } from './DriveItems'
import { KIND_OPTIONS } from './DrivePicker'
import FilePreview from './FilePreview'
import MoveDialog from './MoveDialog'
import ShareDialog from './ShareDialog'

interface UploadJob {
  key: string
  name: string
  progress: number
  error?: string
  done?: boolean
}

type Share = { target: ShareTarget; name: string; folder?: DriveFolder }

const VIEW_KEY = 'drive:view'

const DOC_PLACES: { id: DocFolder; icon: typeof FileText }[] = [
  { id: 'invoices', icon: FileText },
  { id: 'cash-sales', icon: ReceiptText },
  { id: 'quotations', icon: FileSignature },
  { id: 'purchase-orders', icon: ClipboardList },
  { id: 'packing-slips', icon: Package },
  { id: 'shipping-labels', icon: Tag },
]

/** The staff Drive: private folders and files with sharing, the public gallery, and the trash. */
export default function DriveBrowser({ initialFolder, initialTrash }: { initialFolder: string; initialTrash: boolean }) {
  const toast = useActionToast()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const canWrite = useCanWrite('drive')
  const canGallery = [useCanWrite('products'), useCanWrite('settings'), useCanWrite('coupons'), useCanWrite('social')].some(Boolean)
  // Each document section needs the read scope of the records it lists.
  const readable: Record<string, boolean> = {
    'invoices:read': useHasScope('invoices:read'),
    'quotations:read': useHasScope('quotations:read'),
    'inventory:read': useHasScope('inventory:read'),
    'packing_slips:read': useHasScope('packing_slips:read'),
    'orders:read': useHasScope('orders:read'),
  }
  const docPlaces = DOC_PLACES.filter(d => readable[DOC_FOLDERS[d.id].scope])

  const [folder, setFolder] = useState(initialFolder || 'root')
  const [trash, setTrash] = useState(initialTrash)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<DriveKind | ''>('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [data, setData] = useState<DriveListing | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [jobs, setJobs] = useState<UploadJob[]>([])
  const [drag, setDrag] = useState(false)
  const [preview, setPreview] = useState<DriveFile | null>(null)
  const [share, setShare] = useState<Share | null>(null)
  const [move, setMove] = useState<{ files: string[]; folders: string[] } | null>(null)
  const [newFolder, setNewFolder] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY)
      if (v === 'grid' || v === 'list') setView(v)
    } catch {
      /* private mode */
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Keep the place in the URL so a refresh or a shared link opens the same folder.
  useEffect(() => {
    const u = new URL(window.location.href)
    u.searchParams.delete('folder')
    u.searchParams.delete('trash')
    if (trash) u.searchParams.set('trash', '1')
    else if (folder !== 'root') u.searchParams.set('folder', folder)
    window.history.replaceState(window.history.state, '', u)
  }, [folder, trash])

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    setPage(0)
    driveApi
      .list({ folder, q, kind, trash }, ac.signal)
      .then(d => {
        setData(d)
        setSelected(new Set())
      })
      .catch(e => !ac.signal.aborted && setError(e.message))
      .finally(() => !ac.signal.aborted && setLoading(false))
    return () => ac.abort()
  }, [folder, q, kind, trash, reload])

  const refresh = () => setReload(n => n + 1)

  const go = (id: string, toTrash = false) => {
    setTrash(toTrash)
    setFolder(id)
    setSearch('')
    setQ('')
  }

  const more = async () => {
    try {
      const d = await driveApi.list({ folder, q, kind, trash, page: page + 1 })
      setData(prev => (prev ? { ...prev, files: [...prev.files, ...d.files] } : d))
      setPage(p => p + 1)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const here = data?.folder ?? null
  const inGallery = folder === GALLERY_FOLDER_ID
  const inDocs = isDocFolder(folder)
  const canUploadHere = !trash && !inDocs && canWrite && (inGallery ? canGallery : folder === 'root' || (here?.access ?? 'view') !== 'view')
  const canFolderHere = !trash && !inGallery && !inDocs && canWrite && (folder === 'root' || (here?.access ?? 'view') !== 'view')

  const upload = async (list: File[]) => {
    if (!list.length) return
    const target = folder === 'root' ? null : folder
    const batch = list.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, progress: 0 }))
    setJobs(j => [...j.filter(x => !x.done && !x.error), ...batch])
    let ok = 0
    for (let i = 0; i < list.length; i++) {
      const key = batch[i].key
      const patch = (p: Partial<UploadJob>) => setJobs(j => j.map(x => (x.key === key ? { ...x, ...p } : x)))
      try {
        await uploadDriveFile(list[i], target, progress => patch({ progress }))
        patch({ progress: 100, done: true })
        ok++
      } catch (e: any) {
        patch({ error: e.message })
      }
    }
    if (ok && folder === 'root') toast.info(`${ok === 1 ? 'Saved' : `${ok} files saved`} to My files`)
    refresh()
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDrag(false)
    if (canUploadHere) upload(Array.from(e.dataTransfer.files))
  }
  const dragProps = canUploadHere
    ? {
        onDragEnter: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return
          dragDepth.current++
          setDrag(true)
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (!dragDepth.current) setDrag(false)
        },
        onDragOver: (e: React.DragEvent) => e.dataTransfer.types.includes('Files') && e.preventDefault(),
        onDrop,
      }
    : {}

  const act = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn()
      if (success) toast.success(success)
    } catch (e: any) {
      toast.error(e.message)
    }
    refresh()
  }

  const renameFile = async (f: DriveFile) => {
    const name = await prompt({ title: 'Rename file', message: 'New name', defaultValue: f.name, confirmLabel: 'Rename' })
    if (name?.trim() && name.trim() !== f.name) act(() => driveApi.updateFile(f.id, { name: name.trim() }))
  }
  const renameFolder = async (f: DriveFolder) => {
    const name = await prompt({ title: 'Rename folder', message: 'New name', defaultValue: f.name, confirmLabel: 'Rename' })
    if (name?.trim() && name.trim() !== f.name) act(() => driveApi.updateFolder(f.id, { name: name.trim() }))
  }
  const trashFiles = async (ids: string[]) => {
    const ok = await confirm({ title: ids.length === 1 ? 'Delete file?' : `Delete ${ids.length} files?`, message: 'They move to the trash and can be restored for 30 days.', confirmLabel: 'Delete', variant: 'danger' })
    if (ok) act(() => Promise.all(ids.map(id => driveApi.deleteFile(id))), ids.length === 1 ? 'Moved to the trash' : `${ids.length} files moved to the trash`)
  }
  const trashFolder = async (f: DriveFolder) => {
    const ok = await confirm({ title: `Delete “${f.name}”?`, message: 'The folder and everything in it move to the trash.', confirmLabel: 'Delete', variant: 'danger' })
    if (ok) act(() => driveApi.deleteFolder(f.id), 'Folder deleted')
  }
  const restore = (ids: string[]) => act(() => Promise.all(ids.map(id => driveApi.restoreFile(id))), ids.length === 1 ? 'Restored' : `${ids.length} files restored`)
  const publish = async (f: DriveFile) => {
    const ok = await confirm({
      title: 'Add to the gallery?',
      message: `A copy of “${f.name}” goes into the public gallery, where anyone with the link can see it. The original stays private here.`,
      confirmLabel: 'Add to gallery',
    })
    if (ok) act(() => driveApi.publish(f.id), 'Added to the gallery')
  }
  const download = (f: DriveFile) => {
    const a = document.createElement('a')
    a.href = f.downloadUrl
    a.download = f.name
    a.click()
  }

  const toggle = (f: DriveFile) =>
    setSelected(s => {
      const n = new Set(s)
      if (n.has(f.id)) n.delete(f.id)
      else n.add(f.id)
      return n
    })
  const onFile = (f: DriveFile, e: React.MouseEvent) => (selected.size || e.metaKey || e.ctrlKey || e.shiftKey ? toggle(f) : setPreview(f))

  const fileMenu = (f: DriveFile) => {
    if (f.source === 'document') {
      return (
        <ItemMenu
          items={[
            { label: 'Open', icon: Eye, onClick: () => setPreview(f) },
            { label: 'Download', icon: Download, onClick: () => download(f) },
            !!f.href && { label: 'Open record', icon: FileSearch, onClick: () => window.location.assign(ap(f.href!)) },
          ]}
        />
      )
    }
    const edit = canWrite && (f.access === 'edit' || f.access === 'manage')
    if (f.public) return <ItemMenu items={[{ label: 'Open', icon: Eye, onClick: () => setPreview(f) }]} />
    if (trash) return <ItemMenu items={[edit && { label: 'Restore', icon: RotateCcw, onClick: () => restore([f.id]) }]} />
    return (
      <ItemMenu
        items={[
          { label: 'Open', icon: Eye, onClick: () => setPreview(f) },
          { label: 'Download', icon: Download, onClick: () => download(f) },
          edit && { label: 'Rename', icon: Pencil, onClick: () => renameFile(f) },
          edit && { label: 'Move', icon: FolderInput, onClick: () => setMove({ files: [f.id], folders: [] }) },
          canWrite && f.access === 'manage' && { label: 'Share', icon: Share2, onClick: () => setShare({ target: { kind: 'file', id: f.id }, name: f.name }) },
          canGallery && canWrite && (f.kind === 'image' || f.kind === 'video') && { label: 'Add to gallery', icon: ImagePlus, onClick: () => publish(f) },
          edit && { label: 'Delete', icon: Trash2, danger: true, onClick: () => trashFiles([f.id]) },
        ]}
      />
    )
  }

  const folderMenu = (f: DriveFolder) => {
    if (f.id === GALLERY_FOLDER_ID || !canWrite || f.access !== 'manage') return null
    return (
      <ItemMenu
        items={[
          { label: 'Open', icon: FolderOpen, onClick: () => go(f.id) },
          !f.systemKey && { label: 'Rename', icon: Pencil, onClick: () => renameFolder(f) },
          !f.systemKey && { label: 'Move', icon: FolderInput, onClick: () => setMove({ files: [], folders: [f.id] }) },
          { label: 'Share & access', icon: Share2, onClick: () => setShare({ target: { kind: 'folder', id: f.id }, name: f.name, folder: f }) },
          !f.systemKey && { label: 'Delete', icon: Trash2, danger: true, onClick: () => trashFolder(f) },
        ]}
      />
    )
  }

  const files = data?.files ?? []
  const folders = data?.folders ?? []
  const crumbs = data?.path ?? []
  const picked = files.filter(f => selected.has(f.id))
  const editablePicked = picked.filter(f => f.access === 'edit' || f.access === 'manage')

  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label="Drive" className="flex gap-1 overflow-x-auto lg:flex-col">
        <Place icon={<HardDrive className="h-4 w-4" />} active={!trash && !inGallery && !inDocs} onClick={() => go('root')}>
          My Drive
        </Place>
        <Place icon={<Images className="h-4 w-4" />} active={!trash && inGallery} onClick={() => go(GALLERY_FOLDER_ID)}>
          Gallery
        </Place>
        <Place icon={<Trash2 className="h-4 w-4" />} active={trash} onClick={() => go('root', true)}>
          Trash
        </Place>
        {docPlaces.length > 0 && <p className="hidden px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted lg:block">Documents</p>}
        {docPlaces.map(d => (
          <Place key={d.id} icon={<d.icon className="h-4 w-4" />} active={!trash && folder === d.id} onClick={() => go(d.id)}>
            {DOC_FOLDERS[d.id].name}
          </Place>
        ))}
        <p className="hidden px-3 pt-3 text-[11px] leading-relaxed text-foreground-muted lg:block">
          Files here are private to staff. Links are signed and expire after a few minutes. Gallery items are public.
        </p>
      </nav>

      <section className="relative min-w-0 rounded-xl border border-border-default bg-surface-elevated" {...dragProps}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border-default px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
            {trash ? (
              <span className="font-semibold text-foreground">Trash</span>
            ) : (
              <>
                <Crumb active={folder === 'root'} onClick={() => go('root')}>
                  My Drive
                </Crumb>
                {crumbs.map((c, i) => (
                  <span key={c.id} className="flex min-w-0 items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                    <Crumb active={i === crumbs.length - 1} onClick={() => go(c.id)}>
                      {c.name}
                    </Crumb>
                  </span>
                ))}
              </>
            )}
            {inDocs && !trash && <span className="ml-1 hidden truncate text-xs text-foreground-muted md:inline">· Made from your records, always up to date</span>}
            {here && !trash && !inGallery && !inDocs && (
              <span className="ml-1 hidden truncate text-xs text-foreground-muted md:inline" title={VISIBILITY_LABEL[here.visibility]}>
                · {VISIBILITY_LABEL[here.visibility]}
              </span>
            )}
          </div>
          {here && !inGallery && !trash && here.access === 'manage' && canWrite && (
            <button
              type="button"
              onClick={() => setShare({ target: { kind: 'folder', id: here.id }, name: here.name, folder: here })}
              className="control-md inline-flex items-center gap-1.5 border border-border-default text-foreground-secondary hover:bg-surface-secondary"
            >
              <Share2 className="h-4 w-4" /> Share
            </button>
          )}
          {canFolderHere && (
            <button type="button" onClick={() => setNewFolder(true)} className="control-md inline-flex items-center gap-1.5 border border-border-default text-foreground-secondary hover:bg-surface-secondary">
              <FolderPlus className="h-4 w-4" /> New folder
            </button>
          )}
          {canUploadHere && (
            <button type="button" onClick={() => fileInput.current?.click()} className="control-md inline-flex items-center gap-1.5 bg-accent-500 font-semibold text-white hover:bg-accent-600">
              <Upload className="h-4 w-4" /> Upload
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept={inGallery ? 'image/*' : DRIVE_ACCEPT}
            onChange={e => {
              upload(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border-default px-4 py-2.5">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={trash ? 'Search the trash' : inDocs ? `Search ${DOC_FOLDERS[folder].name.toLowerCase()}` : folder === 'root' ? 'Search all your files' : 'Search this folder'}
              className={`${fieldInputCls} w-full pl-8`}
            />
          </div>
          {!inDocs && (
            <div className="w-36">
              <AdminSelect value={kind} onChange={v => setKind(v as DriveKind | '')} options={KIND_OPTIONS} />
            </div>
          )}
          <div className="flex rounded-lg border border-border-default p-0.5" role="group" aria-label="Layout">
            {(['grid', 'list'] as const).map(v => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                aria-label={v === 'grid' ? 'Grid' : 'List'}
                onClick={() => {
                  setView(v)
                  try {
                    localStorage.setItem(VIEW_KEY, v)
                  } catch {
                    /* private mode */
                  }
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-md ${view === v ? 'bg-surface-secondary text-foreground' : 'text-foreground-muted hover:text-foreground'}`}
              >
                {v === 'grid' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border-default bg-accent-500/10 px-4 py-2 text-sm">
            <button type="button" onClick={() => setSelected(new Set())} aria-label="Clear selection" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-secondary">
              <X className="h-4 w-4" />
            </button>
            <span className="font-medium text-foreground">{selected.size} selected</span>
            <span className="ml-auto flex flex-wrap gap-2">
              {trash ? (
                canWrite && editablePicked.length > 0 && (
                  <button type="button" onClick={() => restore(editablePicked.map(f => f.id))} className="control-sm inline-flex items-center gap-1.5 border border-border-default bg-surface-elevated hover:bg-surface-secondary">
                    <RotateCcw className="h-4 w-4" /> Restore
                  </button>
                )
              ) : (
                <>
                  {picked.length > 0 && !inGallery && (
                    <button type="button" onClick={() => picked.forEach(download)} className="control-sm inline-flex items-center gap-1.5 border border-border-default bg-surface-elevated hover:bg-surface-secondary">
                      <Download className="h-4 w-4" /> Download
                    </button>
                  )}
                  {canWrite && editablePicked.length > 0 && !inGallery && (
                    <>
                      <button type="button" onClick={() => setMove({ files: editablePicked.map(f => f.id), folders: [] })} className="control-sm inline-flex items-center gap-1.5 border border-border-default bg-surface-elevated hover:bg-surface-secondary">
                        <FolderInput className="h-4 w-4" /> Move
                      </button>
                      <button type="button" onClick={() => trashFiles(editablePicked.map(f => f.id))} className="control-sm inline-flex items-center gap-1.5 border border-red-300 bg-surface-elevated text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                        <Trash2 className="h-4 w-4" /> Delete
                      </button>
                    </>
                  )}
                </>
              )}
            </span>
          </div>
        )}

        {jobs.length > 0 && (
          <div className="border-b border-border-default px-4 py-2.5">
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-foreground-secondary">
              <span>{jobs.every(j => j.done || j.error) ? 'Uploads' : `Uploading ${jobs.filter(j => !j.done && !j.error).length}…`}</span>
              {jobs.every(j => j.done || j.error) && (
                <button type="button" onClick={() => setJobs([])} className="hover:underline">
                  Clear
                </button>
              )}
            </div>
            <ul className="space-y-1">
              {jobs.map(j => (
                <li key={j.key} className="flex items-center gap-2 text-xs">
                  {j.error ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" /> : j.done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" /> : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-500" />}
                  <span className="min-w-0 flex-1 truncate text-foreground">{j.name}</span>
                  {j.error ? (
                    <span className="truncate text-red-600">{j.error}</span>
                  ) : (
                    !j.done && (
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-secondary">
                        <span className="block h-full bg-accent-500 transition-all" style={{ width: `${j.progress}%` }} />
                      </span>
                    )
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="min-h-[50vh] p-4">
          {loading && !data ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-7 w-7 animate-spin text-accent-500" />
            </div>
          ) : error ? (
            <ErrorState bare body={error} actionNode={<button type="button" onClick={refresh} className="control-md border border-border-default">Try again</button>} />
          ) : !folders.length && !files.length ? (
            <EmptyState
              bare
              icon={trash ? <Trash2 className="h-5 w-5" /> : inDocs ? <FileText className="h-5 w-5" /> : inGallery ? <Images className="h-5 w-5" /> : <UploadCloud className="h-5 w-5" />}
              title={q ? 'No files match your search' : trash ? 'The trash is empty' : inDocs ? `No ${DOC_FOLDERS[folder].name.toLowerCase()} yet` : inGallery ? 'No gallery images yet' : folder === 'root' ? 'Your Drive is empty' : 'This folder is empty'}
              body={
                q
                  ? undefined
                  : trash
                    ? 'Deleted files stay here for 30 days before they are removed for good.'
                    : canUploadHere
                      ? 'Drop files here or use Upload. Files sent in support chats and to the assistant are kept in the Drive too.'
                      : undefined
              }
            />
          ) : (
            <div className={loading ? 'pointer-events-none opacity-60 transition-opacity' : ''}>
              <DriveGrid
                folders={folders}
                files={files}
                view={view}
                selected={selected}
                onFolder={f => go(f.id)}
                onFile={onFile}
                onCheck={toggle}
                onFileOpen={setPreview}
                folderMenu={folderMenu}
                fileMenu={fileMenu}
                showOwner
                ownerLabel={inDocs ? (folder === 'purchase-orders' ? 'Supplier' : 'Customer') : undefined}
              />
              {files.length < (data?.total ?? 0) && (
                <div className="mt-4 flex justify-center">
                  <button type="button" onClick={more} className="control-sm border border-border-default text-foreground-secondary hover:bg-surface-secondary">
                    Show more ({files.length} of {data?.total})
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {drag && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-accent-500 bg-accent-500/10 backdrop-blur-[1px]" onDrop={onDrop}>
            <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-elevated px-6 py-4 shadow-lg">
              <UploadCloud className="h-8 w-8 text-accent-500" />
              <p className="text-sm font-semibold text-foreground">Drop to upload {inGallery ? 'to the gallery' : here ? `to ${here.name}` : 'to My files'}</p>
            </div>
          </div>
        )}
      </section>

      {preview && <FilePreview f={preview} onClose={() => setPreview(null)} />}
      {share && (
        <ShareDialog
          target={share.target}
          name={share.name}
          visibility={share.folder?.systemKey ? undefined : share.folder?.visibility}
          onVisibility={
            share.folder && !share.folder.systemKey
              ? async (v: DriveVisibility) => {
                  await driveApi.updateFolder(share.folder!.id, { visibility: v })
                  refresh()
                }
              : undefined
          }
          onClose={() => setShare(null)}
        />
      )}
      {move && (
        <MoveDialog
          title={move.folders.length ? 'Move folder' : move.files.length === 1 ? 'Move file' : `Move ${move.files.length} files`}
          exclude={move.folders}
          allowRoot={move.folders.length > 0}
          onMove={async to => {
            try {
              await Promise.all([...move.files.map(id => driveApi.updateFile(id, { folderId: to })), ...move.folders.map(id => driveApi.updateFolder(id, { parentId: to }))])
              toast.success('Moved')
              setMove(null)
            } catch (e: any) {
              toast.error(e.message)
            }
            refresh()
          }}
          onClose={() => setMove(null)}
        />
      )}
      {newFolder && (
        <NewFolderDialog
          onClose={() => setNewFolder(false)}
          onCreate={async (name, visibility) => {
            try {
              await driveApi.createFolder(folder === 'root' ? null : folder, name, visibility)
              setNewFolder(false)
              refresh()
            } catch (e: any) {
              toast.error(e.message)
            }
          }}
        />
      )}
    </div>
  )
}

function Place({ icon, active, onClick, children }: { icon: ReactNode; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm ${active ? 'bg-primary-500/10 font-semibold text-primary-600 dark:text-primary-400' : 'text-foreground-secondary hover:bg-surface-secondary hover:text-foreground'}`}
    >
      {icon}
      {children}
    </button>
  )
}

function Crumb({ children, onClick, active }: { children: ReactNode; onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`min-w-0 truncate rounded px-1.5 py-0.5 ${active ? 'font-semibold text-foreground' : 'text-foreground-secondary hover:bg-surface-secondary hover:text-foreground'}`}
    >
      {children}
    </button>
  )
}

function NewFolderDialog({ onCreate, onClose }: { onCreate: (name: string, v: DriveVisibility) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('')
  const [vis, setVis] = useState<DriveVisibility>('private')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    await onCreate(name.trim(), vis)
    setBusy(false)
  }
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="New folder"
      onKeyDown={e => e.key === 'Enter' && submit()}
      footer={
        <>
          <button type="button" onClick={onClose} className="control-md border border-border-default text-foreground-secondary hover:bg-surface-secondary">
            Cancel
          </button>
          <button type="button" disabled={!name.trim() || busy} onClick={submit} className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50">
            Create
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Folder name" maxLength={160} className={`${fieldInputCls} w-full`} />
        <AdminSelect
          label="Who can see it"
          value={vis}
          onChange={v => setVis(v as DriveVisibility)}
          options={(['private', 'team'] as const).map(v => ({ value: v, label: v === 'private' ? 'Private' : 'Whole team', hint: VISIBILITY_LABEL[v] }))}
        />
      </div>
    </Dialog>
  )
}
