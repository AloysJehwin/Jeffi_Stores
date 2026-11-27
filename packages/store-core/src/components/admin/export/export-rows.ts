'use client'

import { useEffect, useSyncExternalStore } from 'react'

// Which rows a list shows and which are selected, by export key, so the Export dialog (anywhere on
// the page) can offer "rows on this page" and "selected rows". Tables publish; the dialog reads.

export interface ExportRows {
  page?: string[]
  selected?: string[]
}

const EMPTY: ExportRows = {}
const store = new Map<string, ExportRows>()
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function publishExportRows(key: string, rows: ExportRows | null) {
  if (rows) store.set(key, rows)
  else store.delete(key)
  listeners.forEach(l => l())
}

/** Publishes a table's visible and selected row ids (record ids) under `key` while mounted. */
export function useExportRows(key: string | undefined, page?: string[], selected?: string[]) {
  const pageSig = page?.join('\u0000')
  const selSig = selected?.join('\u0000')
  useEffect(() => {
    if (!key) return
    publishExportRows(key, { page, selected })
    return () => publishExportRows(key, null)
    // Signatures stand in for the arrays, which are new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pageSig, selSig])
}

export function useExportRowsSnapshot(key: string): ExportRows {
  return useSyncExternalStore(
    subscribe,
    () => store.get(key) ?? EMPTY,
    () => EMPTY
  )
}
