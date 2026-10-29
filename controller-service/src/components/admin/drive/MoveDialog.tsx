'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, CornerLeftUp, HardDrive, Loader2 } from 'lucide-react'
import { Dialog } from '@/components/admin/kit'
import { GALLERY_FOLDER_ID, type DriveFolder } from '@/lib/drive/types'
import { driveApi, type DriveCrumb } from './api'
import { FolderGlyph } from './DriveItems'

/** Pick a destination folder. `exclude` hides the folders being moved (a folder can't go inside itself). */
export default function MoveDialog({ title, exclude = [], allowRoot, onMove, onClose }: { title: string; exclude?: string[]; allowRoot?: boolean; onMove: (folderId: string | null) => Promise<void>; onClose: () => void }) {
  const [at, setAt] = useState<string>('root')
  const [folders, setFolders] = useState<DriveFolder[] | null>(null)
  const [path, setPath] = useState<DriveCrumb[]>([])
  const [here, setHere] = useState<DriveFolder | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setFolders(null)
    driveApi.list({ folder: at }).then(
      d => {
        setFolders(d.folders.filter(f => f.id !== GALLERY_FOLDER_ID && !exclude.includes(f.id)))
        setPath(d.path)
        setHere(d.folder)
      },
      () => setFolders([])
    )
  }, [at]) // eslint-disable-line react-hooks/exhaustive-deps

  const canDrop = at === 'root' ? !!allowRoot : !!here && here.access !== 'view'
  const up = path.length > 1 ? path[path.length - 2].id : 'root'

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      zIndex="z-[1100]"
      title={title}
      footer={
        <>
          <button type="button" onClick={onClose} className="control-md border border-border-default text-foreground-secondary hover:bg-surface-secondary">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canDrop || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onMove(at === 'root' ? null : at)
              } finally {
                setBusy(false)
              }
            }}
            className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
          >
            {!canDrop ? 'Open a folder' : at === 'root' ? 'Move to the top level' : `Move to ${here?.name}`}
          </button>
        </>
      }
    >
      <div className="mb-2 flex items-center gap-1 text-sm text-foreground-secondary">
        <HardDrive className="h-4 w-4" />
        <button type="button" onClick={() => setAt('root')} className="hover:underline">
          Drive
        </button>
        {path.map(c => (
          <span key={c.id} className="flex min-w-0 items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5" />
            <button type="button" onClick={() => setAt(c.id)} className="truncate hover:underline">
              {c.name}
            </button>
          </span>
        ))}
      </div>
      <div className="max-h-72 min-h-[10rem] overflow-y-auto rounded-lg border border-border-default">
        {at !== 'root' && (
          <button type="button" onClick={() => setAt(up)} className="flex w-full items-center gap-2 border-b border-border-default px-3 py-2 text-sm text-foreground-secondary hover:bg-surface-secondary">
            <CornerLeftUp className="h-4 w-4" /> Up
          </button>
        )}
        {!folders ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
          </div>
        ) : !folders.length ? (
          <p className="px-3 py-6 text-center text-sm text-foreground-muted">No folders inside</p>
        ) : (
          folders.map(f => (
            <button key={f.id} type="button" onClick={() => setAt(f.id)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-secondary">
              <FolderGlyph f={f} className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <ChevronRight className="h-4 w-4 text-foreground-muted" />
            </button>
          ))
        )}
      </div>
    </Dialog>
  )
}
