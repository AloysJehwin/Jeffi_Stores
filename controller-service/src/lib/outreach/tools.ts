import { voiceAgentContext } from './agent/runtime'
import { getTool } from './agent/catalog'
import { invokeTool } from './agent/invoke'
import type { OutreachLanguage } from './types'

// POST /api/internal/outreach/calls/{callId}/tools/{tool}: a thin wrapper over agent/invoke.ts for the voice channel.
// voice-service speaks `say` verbatim and does not run the LLM again for that turn, so every claim of success is a
// line from prompt.ts sent only after the action worked. `end` hangs up after the line; `redialLanguage` ends the call
// and rings back in that language; `data` and `error` go to the LLM (read tools, refusals). The handlers and the
// allow-list live in agent/; every call is audited as a `tool_call` outreach event.

export { advance, applyOptOut, callbackTime } from './agent/tools/common'

export interface ToolReply {
  ok: boolean
  say?: string
  end?: boolean
  redialLanguage?: OutreachLanguage
  data?: Record<string, unknown>
}

export interface ToolResponse {
  status: number
  body: ToolReply & { error?: string }
}

export async function runTool(callId: string, tool: string, rawArgs: unknown, now: Date = new Date()): Promise<ToolResponse> {
  if (!getTool(tool)) return { status: 404, body: { ok: false, error: `Unknown tool: ${tool}` } }
  const ctx = await voiceAgentContext(callId, now)
  if (!ctx) return { status: 404, body: { ok: false, error: 'Unknown call' } }
  if (ctx.call.ended_at) return { status: 409, body: { ok: false, error: 'The call has ended' } }
  const r = await invokeTool({
    channel: 'voice',
    actor: 'voice',
    job: ctx.job,
    contact: ctx.contact,
    call: ctx.call,
    run: ctx.run,
    language: ctx.language,
    now,
    limits: ctx.limits,
    scriptVersion: ctx.skill.ref,
    name: tool,
    args: rawArgs ?? {},
    allowed: ctx.skill.skill.meta.tools.voice,
  })
  const { status, ok, say, end, redialLanguage, data, error } = r
  // A spoken line is final (the LLM is not run again), so the error code only travels when there is no line.
  const body = { ok, ...(say ? { say } : {}), ...(end ? { end } : {}), ...(redialLanguage ? { redialLanguage } : {}), ...(data ? { data } : {}), ...(error && !say ? { error } : {}) }
  return { status, body }
}
