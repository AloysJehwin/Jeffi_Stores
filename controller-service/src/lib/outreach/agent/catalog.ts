import type { AgentChannel, LlmToolSchema, ToolDef, ToolEffect, ToolGroup } from './types'
import { getLead, logOutcome, markOutcome, recordConsent, updateLead } from './tools/lead'
import { handOff, optOut, placeCall, scheduleCallback, scheduleFollowUp } from './tools/ops'
import { sendLink, readMessages, sendWhatsAppTemplate, sendWhatsAppText } from './tools/messaging'
import { addDetails, getSiteStatus, publishSite, requestChange, startPreview } from './tools/showcase'
import { endCall, switchLanguage } from './tools/voice'
import { JOB_TOOLS } from './tools/jobs'
import { STORE_TOOLS } from './tools/store'

// The tool catalog (docs/plans/OUTREACH_AGENT_SKILLS.md §1): every capability the agent can use, in catalog order.

// Insertion order is the catalog order the validator, the UI and the LLM see.
const ORDERED: ToolDef<any>[] = [
  getLead,
  updateLead,
  recordConsent,
  optOut,
  markOutcome,
  logOutcome,
  handOff,
  getSiteStatus,
  startPreview,
  addDetails,
  requestChange,
  publishSite,
  sendLink,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  readMessages,
  placeCall,
  scheduleCallback,
  scheduleFollowUp,
  endCall,
  switchLanguage,
  ...JOB_TOOLS,
  ...STORE_TOOLS,
]

export const TOOLS: Record<string, ToolDef> = Object.fromEntries(ORDERED.map(t => [t.name, t]))
export const TOOL_NAMES: string[] = ORDERED.map(t => t.name)
export const MANDATORY_TOOLS: readonly string[] = ORDERED.filter(t => t.mandatory).map(t => t.name)

export const getTool = (name: string): ToolDef | null => (Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null)

/** Skill allow-list for one channel, intersected with tool.channels, plus mandatory tools that run there. Catalog order. */
export function allowedTools(channel: AgentChannel, allow: readonly string[]): ToolDef[] {
  return ORDERED.filter(t => t.channels.includes(channel) && (t.mandatory || allow.includes(t.name)))
}

export const llmSchemas = (defs: ToolDef[]): LlmToolSchema[] => defs.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))

export function catalogSummary(): { name: string; description: string; channels: AgentChannel[]; effect: ToolEffect; mandatory: boolean; group: ToolGroup; inputSchema: Record<string, unknown> }[] {
  return ORDERED.map(t => ({ name: t.name, description: t.description, channels: [...t.channels], effect: t.effect, mandatory: !!t.mandatory, group: t.group ?? 'showcase', inputSchema: t.inputSchema }))
}
