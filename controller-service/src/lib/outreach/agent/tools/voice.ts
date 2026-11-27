import { z } from 'zod'
import { outreachPool } from '../../db'
import { recordEvent } from '../../events'
import { asLanguage, LINES } from '../../prompt'
import { LANGUAGES } from '../../types'
import type { ToolDef } from '../types'
import { setCall, str } from './common'

const endCallArgs = z.object({ outcome: z.enum(['done', 'busy', 'other']), note: z.string().trim().max(300).optional() })
export const endCall: ToolDef<typeof endCallArgs> = {
  name: 'endCall',
  description: 'Hang up after you have said goodbye. done: the call went as planned. busy: they cannot talk now. other: anything else (add a note).',
  channels: ['voice'],
  effect: 'write',
  args: endCallArgs,
  inputSchema: {
    type: 'object',
    properties: { outcome: { type: 'string', enum: ['done', 'busy', 'other'] }, note: str('a short reason', 300) },
    required: ['outcome'],
  },
  async run({ call }, a) {
    if (call && a.outcome !== 'done') await setCall(call.id, { outcome: 'other', summary: a.note ?? a.outcome })
    // No line from code: the model says goodbye first.
    return { ok: true, end: true, detail: { outcome: a.outcome } }
  },
}

const switchLanguageArgs = z.object({ language: z.string().trim().max(10) })
export const switchLanguage: ToolDef<typeof switchLanguageArgs> = {
  name: 'switchLanguage',
  description: 'They prefer another supported language: the call ends and we ring back in that language.',
  channels: ['voice'],
  effect: 'write',
  args: switchLanguageArgs,
  inputSchema: { type: 'object', properties: { language: { type: 'string', enum: [...LANGUAGES] } }, required: ['language'] },
  async run({ call, contact, language, actor }, a) {
    const to = asLanguage(a.language)
    if (to !== a.language.split('-')[0].toLowerCase()) return { ok: false, say: LINES[language].failedSoft, error: 'unsupported', detail: { reason: 'unsupported', language: a.language } }
    if (to === language) return { ok: true, detail: { unchanged: true } }
    await outreachPool().query(`UPDATE outreach_contacts SET language = $2, updated_at = now() WHERE id = $1`, [contact.id, to])
    await recordEvent(contact.id, 'language_switch', { callId: call?.id ?? null, actor, data: { from: language, to } })
    return { ok: true, say: LINES[to].switching, redialLanguage: to }
  },
}
