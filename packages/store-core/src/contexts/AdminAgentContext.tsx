'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAdminAgentChat, type AdminAgentChat } from '@/hooks/useAdminAgentChat'
import { ENTITY_ROUTES } from '@/components/admin/agent/format'
import { ap } from '@/lib/shared/admin-path'
import { useAdminHost } from './AdminHostContext'
import { useAgentChanges } from '@/lib/client/agent-events'
import type { PageContext } from '@/lib/admin-agent/conversations'

// One assistant chat for the whole admin panel: the bottom-right dock and the /admin/agent page share
// it, so moving between pages or expanding the dock never starts over. The open chat, and whether
// the dock is open, are remembered per admin for the browser tab (the sidebar does full page loads).

interface AdminAgentContextValue {
  chat: AdminAgentChat
  enabled: boolean
  showButton: boolean
  open: boolean
  onAgentPage: boolean
  pageContext: PageContext | null
  openAgent: (opts?: { prompt?: string; context?: PageContext }) => void
  closeAgent: () => void
  toggleAgent: () => void
  expandToFull: () => void
}

const AdminAgentContext = createContext<AdminAgentContextValue | null>(null)

const RESERVED_IDS = new Set(['new', 'create', 'add', 'edit', 'view', 'import', 'export', 'bulk', 'settings'])

// /admin/orders/<id>/view → order <id>, from the same routes the agent's links use.
const ENTITY_PATTERNS = Object.entries(ENTITY_ROUTES).map(([kind, route]) => {
  const prefix = route('__ID__').split('__ID__')[0]
  return { kind, re: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\w-]{1,64})(?:/|$)`) }
})

export function pageContextFor(pathname: string | null): PageContext | null {
  if (!pathname) return null
  const path = pathname.startsWith('/admin') ? pathname : `/admin${pathname === '/' ? '' : pathname}`
  if (!/^\/admin(\/[\w\-./]*)?$/.test(path) || path.length > 200) return null
  const segment = path.split('/')[2]
  const section = segment ? segment.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase()) : 'Dashboard'
  for (const { kind, re } of ENTITY_PATTERNS) {
    const id = path.match(re)?.[1]
    if (id && !RESERVED_IDS.has(id)) return { path, section, entity: { kind, id } }
  }
  return { path, section }
}

const storageKey = (adminId: string) => `jeffi.agent.conv.${adminId}`
const openKey = (adminId: string) => `jeffi.agent.open.${adminId}`

function store(key: string, value: string | null) {
  try {
    if (value) sessionStorage.setItem(key, value)
    else sessionStorage.removeItem(key)
  } catch {
    /* storage blocked */
  }
}

export function AdminAgentProvider({
  adminId,
  enabled,
  showButton,
  children,
}: {
  adminId: string
  enabled: boolean
  showButton: boolean
  children: ReactNode
}) {
  const chat = useAdminAgentChat()
  const host = useAdminHost()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const restored = useRef(false)
  const listed = useRef(false)

  // Server-rendered pages pick up an approved change; client-fetched ones listen themselves.
  useAgentChanges(() => router.refresh())

  const pageContext = useMemo(() => pageContextFor(pathname), [pathname])
  const onAgentPage = pageContext?.path === '/admin/agent'

  useEffect(() => {
    chat.setPageContext(pageContext)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageContext])

  // Reopen the chat this tab had; the agent page's ?c= wins over it.
  useEffect(() => {
    if (!enabled) return
    const fromUrl = onAgentPage && new URLSearchParams(window.location.search).get('c')
    let id: string | null = null
    try {
      id = sessionStorage.getItem(storageKey(adminId))
      if (sessionStorage.getItem(openKey(adminId))) setOpen(true)
    } catch {
      /* storage blocked */
    }
    if (id && !fromUrl && !chat.conversationId) {
      chat.loadConversation(id, { quiet: true }).finally(() => (restored.current = true))
    } else restored.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (restored.current) store(storageKey(adminId), chat.conversationId)
  }, [adminId, chat.conversationId])

  useEffect(() => {
    if (restored.current) store(openKey(adminId), open ? '1' : null)
  }, [adminId, open])

  useEffect(() => {
    if ((open || onAgentPage) && !listed.current) {
      listed.current = true
      chat.loadConversations()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onAgentPage])

  const openAgent = useCallback(
    (opts: { prompt?: string; context?: PageContext } = {}) => {
      setOpen(true)
      if (opts.context) chat.setPageContext(opts.context)
      if (opts.prompt) {
        if (chat.info.readOnly) chat.reset()
        chat.sendMessage(opts.prompt)
      }
    },
    [chat]
  )

  const expandToFull = useCallback(() => {
    setOpen(false)
    const c = chat.conversationId ? `?c=${chat.conversationId}` : ''
    router.push(ap(`/admin/agent${c}`, host))
  }, [chat.conversationId, router, host])

  const value: AdminAgentContextValue = {
    chat,
    enabled,
    showButton,
    open: open && !onAgentPage,
    onAgentPage,
    pageContext,
    openAgent,
    closeAgent: () => setOpen(false),
    toggleAgent: () => setOpen(o => !o),
    expandToFull,
  }

  return <AdminAgentContext.Provider value={value}>{children}</AdminAgentContext.Provider>
}

export function useAdminAgent() {
  const ctx = useContext(AdminAgentContext)
  if (!ctx) throw new Error('useAdminAgent must be used within an AdminAgentProvider')
  return ctx
}
