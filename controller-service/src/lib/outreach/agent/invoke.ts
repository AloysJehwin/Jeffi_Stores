import * as build from '../build'
import { recordEvent } from '../events'
import { LINES } from '../prompt'
import type { OutreachLanguage } from '../types'
import { getTool, MANDATORY_TOOLS } from './catalog'
import { contactGate } from './guards'
import type { ToolContext, ToolResult } from './types'

// Every tool call goes through here: the tool exists, the skill allows it on this channel, the args parse, the
// contact gate, then the handler. Each call is audited as a `tool_call` outreach event.

export interface InvokeInput extends ToolContext {
  name: string
  args: unknown
  allowed: readonly string[]
}
export type InvokeOutcome = ToolResult & { status: 200 | 400 | 403 | 404 }

/**
 * A build.ts refusal, said to the caller. Its message is a speakable English sentence, used as it is on an English
 * call; other languages get the matching line from prompt.ts. An opted-out contact ends the call.
 */
function buildRefusal(tool: string, e: InstanceType<typeof build.OutreachBuildError>, language: OutreachLanguage): ToolResult {
  const L = LINES[language]
  const detail = { code: e.code, error: e.message }
  if (e.code === 'opted_out') return { ok: false, say: L.optedOut, end: true, error: e.code, detail }
  if (language === 'en') return { ok: false, say: e.message, error: e.code, detail }
  const local = e.code === 'building' ? L.buildBusy : e.code === 'not_built' ? L.buildNeedsMore : e.code === 'details' && tool === 'publishSite' ? L.needContact : null
  return { ok: false, say: local ?? (tool === 'publishSite' ? L.publishFailed : L.failedSoft), error: e.code, detail }
}

export async function invokeTool(input: InvokeInput): Promise<InvokeOutcome> {
  const { name, args, allowed, ...ctx } = input
  const voice = ctx.channel === 'voice'
  const audit = (result: ToolResult, withArgs = true) => {
    const { say, end, error, detail, ok } = result
    return recordEvent(ctx.contact.id, 'tool_call', {
      callId: ctx.call?.id ?? null,
      actor: ctx.actor,
      data: { tool: name, channel: ctx.channel, runId: ctx.run?.id ?? null, ...(withArgs ? { args } : {}), ok, say, end, error, ...(detail ? { detail } : {}) },
    }).catch(() => {})
  }
  const done = async (status: InvokeOutcome['status'], result: ToolResult, withArgs = true): Promise<InvokeOutcome> => {
    await audit(result, withArgs)
    // detail is for the audit row only; off voice a spoken line becomes a note the LLM can read, and nothing ends the turn.
    const { detail: _detail, ...out } = result
    if (!voice) {
      const { say, end: _end, redialLanguage: _redial, ...rest } = out
      return { status, ...rest, ...(say ? { data: { ...rest.data, note: say } } : {}) }
    }
    return { status, ...out }
  }

  const tool = getTool(name)
  if (!tool) return done(404, { ok: false, error: `Unknown tool: ${name}` })
  if (!(tool.mandatory || MANDATORY_TOOLS.includes(name) || allowed.includes(name)) || !tool.channels.includes(ctx.channel)) return done(403, { ok: false, error: 'not_allowed' })

  const parsed = tool.args.safeParse(args ?? {})
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return done(400, { ok: false, error: i ? `${i.path.join('.') || 'args'}: ${i.message}` : 'Invalid args' }, false)
  }

  const refused = await contactGate(ctx.contact, tool)
  if (refused) return done(200, { ok: false, error: refused, ...(voice ? { say: LINES[ctx.language].optedOut, end: true } : {}) })

  let result: ToolResult
  try {
    result = await tool.run(ctx, parsed.data)
  } catch (e) {
    if (e instanceof build.OutreachBuildError) result = buildRefusal(name, e, ctx.language)
    else {
      console.error(`[outreach] tool ${name} failed (${ctx.channel}) for contact ${ctx.contact.id}:`, (e as Error)?.message)
      result = { ok: false, ...(voice ? { say: LINES[ctx.language].failedSoft } : {}), error: 'failed', detail: { error: (e as Error)?.message ?? 'error' } }
    }
  }
  return done(200, result)
}
