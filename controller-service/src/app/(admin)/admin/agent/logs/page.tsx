'use client'

import { useState } from 'react'
import { Bot, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/admin/kit/layout'
import { InfiniteFooter, fetchJson, useInfiniteList } from '@/components/admin/kit/infinite'

interface ToolLogMessage {
  id: string
  conversation_id: string
  created_at: string
  tool_calls: Array<{ tool: string; input: Record<string, unknown>; output: unknown; isError?: boolean }>
  admin_first_name: string | null
  admin_last_name: string | null
  admin_username: string | null
}

function relTime(iso: string) {
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  if (sec < 86400 * 30) return `${Math.round(sec / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function AgentLogsPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const list = useInfiniteList<ToolLogMessage>({
    key: 'tool-logs',
    pageSize: 50,
    getKey: m => m.id,
    fetchPage: async (p, signal) => {
      const qs = new URLSearchParams({ page: String(p), pageSize: '50' })
      const data = await fetchJson(`/api/admin/agent/tool-logs?${qs.toString()}`, signal)
      return { rows: data.messages || [], total: data.total || 0 }
    },
  })
  const toolLogs = list.rows
  const loading = list.loading || list.loadingMore

  return (
    <div className="p-4 sm:p-6 w-full space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Agent Tool Logs"
          description="Tool calls made by the AI admin assistant. Each row is one assistant response that invoked one or more tools."
        />
        <button
          type="button"
          onClick={list.reload}
          disabled={loading}
          className="control-md border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading && toolLogs.length === 0 ? (
        <div className="space-y-2 animate-pulse">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="bg-surface-elevated border border-border-default rounded-lg px-4 py-3 flex items-start gap-3"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="w-8 h-8 rounded-full bg-surface-secondary shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="h-3 w-20 bg-surface-secondary rounded" />
                  <div className="h-3 w-12 bg-surface-secondary rounded" />
                  <div className="h-3 w-16 bg-surface-secondary rounded" />
                </div>
                <div className="h-3 w-3/4 bg-surface-secondary rounded" />
              </div>
              <div className="h-3 w-4 bg-surface-secondary rounded shrink-0" />
            </div>
          ))}
        </div>
      ) : toolLogs.length === 0 ? (
        <p className="text-sm text-foreground-muted italic">No tool calls logged yet.</p>
      ) : (
        <>
          <div className="space-y-2">
            {toolLogs.map(msg => {
              const isExpanded = expandedId === msg.id
              const adminName =
                [msg.admin_first_name, msg.admin_last_name].filter(Boolean).join(' ') || msg.admin_username || 'Admin'
              const errorCount = msg.tool_calls.filter(tc => tc.isError).length
              return (
                <div
                  key={msg.id}
                  className="bg-surface-elevated border border-border-default rounded-lg overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : msg.id)}
                    className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-surface-secondary/50 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-500 to-secondary-500 flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-foreground">
                          {msg.tool_calls.length} tool call{msg.tool_calls.length !== 1 ? 's' : ''}
                        </span>
                        {errorCount > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] text-red-500">
                            <XCircle className="w-3 h-3" /> {errorCount} error{errorCount !== 1 ? 's' : ''}
                          </span>
                        )}
                        <span className="text-[10px] text-foreground-muted">{relTime(msg.created_at)}</span>
                        <span className="text-[10px] text-foreground-muted">by {adminName}</span>
                      </div>
                      <p className="text-[11px] text-foreground-muted mt-0.5 font-mono truncate">
                        {msg.tool_calls.map(tc => tc.tool).join(', ')}
                      </p>
                    </div>
                    <span className="text-[10px] text-foreground-muted shrink-0">{isExpanded ? '▲' : '▼'}</span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border-default divide-y divide-border-default">
                      {msg.tool_calls.map((tc, i) => {
                        const outputStr = typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output, null, 2)
                        const inputStr = JSON.stringify(tc.input, null, 2)
                        return (
                          <div key={i} className={`px-4 py-3 ${tc.isError ? 'bg-red-500/5' : ''}`}>
                            <div className="flex items-center gap-2 mb-2">
                              {tc.isError ? (
                                <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                              )}
                              <span className="min-w-0 text-xs font-semibold font-mono text-foreground [overflow-wrap:anywhere]">{tc.tool}</span>
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-[11px]">
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-1">Input</p>
                                <pre className="bg-surface-secondary rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-foreground font-mono leading-relaxed">
                                  {inputStr}
                                </pre>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-1">Output</p>
                                <pre
                                  className={`rounded p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed ${tc.isError ? 'bg-red-500/10/50 text-red-600 dark:text-red-400' : 'bg-surface-secondary text-foreground'}`}
                                >
                                  {outputStr}
                                </pre>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <InfiniteFooter shown={toolLogs.length} control={list} noun="responses" />
        </>
      )}
    </div>
  )
}
