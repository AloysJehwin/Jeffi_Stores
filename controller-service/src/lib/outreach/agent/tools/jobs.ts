import { z } from 'zod'
import { shopperBye } from '../../prompt'
import { maskPhone } from '../guards'
import type { InputSpec, ToolContext, ToolDef, ToolResult } from '../types'
import { ALL, setCall, str } from './common'

// Task-agent core tools (docs/plans/OUTREACH_AGENTS.md §4): read the job, and close it with an outcome.

/** The job's agent version, for its declared inputs and outcomes (loaded late: the skill store and jobs import the catalog, which imports this file). */
async function metaOf(job: NonNullable<ToolContext['job']>) {
  const { loadJobSkill } = await import('../skill/store')
  return (await loadJobSkill(job))?.skill.meta ?? null
}

/** An input as the LLM may see it: phone numbers and emails are masked. */
function show(spec: InputSpec | undefined, v: unknown): unknown {
  if (typeof v !== 'string') return v
  if (spec?.type === 'phone') return maskPhone(v)
  if (spec?.type === 'email') return v.replace(/^(.).*(@.*)$/, '$1•••$2')
  return v
}

const getJobArgs = z.object({})
export const getJob: ToolDef<typeof getJobArgs> = {
  name: 'getJob',
  description: "Read this job: the inputs it was created with, the order, checkout or product it is about, how many calls were tried and which outcomes you may record. Phone numbers are masked.",
  channels: ALL,
  effect: 'read',
  group: 'core',
  args: getJobArgs,
  inputSchema: { type: 'object', properties: {} },
  async run({ job, contact }) {
    if (!job) return { ok: false, error: 'no_job' }
    const meta = await metaOf(job)
    const inputs = Object.fromEntries(Object.entries(job.inputs).map(([k, v]) => [k, show(meta?.inputs[k], v)]))
    return {
      ok: true,
      data: {
        status: job.status,
        outcome: job.outcome,
        attempts: job.attempts,
        inputs,
        refs: job.refs,
        outcomes: meta?.outcomes ?? [],
        contact: { name: contact.owner_name, language: contact.language, phone: maskPhone(contact.phone), whatsappConsent: !!contact.consent_whatsapp_at },
      },
    }
  },
}

const setOutcomeArgs = z.object({ outcome: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, 'a lowercase slug such as review_link_sent'), note: z.string().trim().max(300).optional() })
export const setOutcome: ToolDef<typeof setOutcomeArgs> = {
  name: 'setOutcome',
  description: 'Record how this job ended, using one of its outcomes (see getJob). This closes the job; on a call it ends the call, so say your goodbye first.',
  channels: ALL,
  effect: 'write',
  group: 'core',
  args: setOutcomeArgs,
  inputSchema: {
    type: 'object',
    properties: { outcome: str('one of the agent\'s outcome codes', 40), note: str('a short note for the team', 300) },
    required: ['outcome'],
  },
  async run({ job, call, language, actor, channel, now }, a): Promise<ToolResult> {
    if (!job) return { ok: false, error: 'no_job' }
    const outcomes = (await metaOf(job))?.outcomes ?? []
    if (outcomes.length && !outcomes.includes(a.outcome)) return { ok: false, error: 'unknown_outcome', data: { allowed: outcomes } }
    if (job.outcome === a.outcome && job.status === 'completed') return { ok: true, data: { outcome: a.outcome } }
    const { completeJob } = await import('../jobs')
    const done = await completeJob(job.id, a.outcome, { note: a.note, actor, now })
    if (!done) return { ok: false, error: 'job_closed' }
    if (call) await setCall(call.id, { summary: a.note ?? a.outcome })
    return channel === 'voice' ? { ok: true, say: shopperBye(language), end: true, data: { outcome: a.outcome } } : { ok: true, data: { outcome: a.outcome } }
  },
}

export const JOB_TOOLS: ToolDef<any>[] = [getJob, setOutcome]
