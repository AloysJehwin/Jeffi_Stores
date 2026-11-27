import { aiChat, type AiChatMessage, type AiToolDef } from '@/lib/shared/ai-client'
import type { AgentModel, AgentModelReply, AgentModelRequest } from './types'

// The brain behind WhatsApp and follow-up turns: aiChat through the AI gateway (flagship-metered). Tests and the E2E
// swap in a scripted model with setAgentModel().

export const gatewayModel: AgentModel = async (req: AgentModelRequest): Promise<AgentModelReply> => {
  const messages: AiChatMessage[] = [
    { role: 'system', content: req.system },
    ...req.messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls.map(tc => ({ id: tc.id, function: { name: tc.name, arguments: tc.arguments } })) } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.providerState ? { providerState: m.providerState as AiChatMessage['providerState'] } : {}),
    })),
  ]
  const tools: AiToolDef[] = req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
  const r = await aiChat({
    feature: 'outreach_agent',
    modelHint: 'agent',
    cacheNamespace: 'platform',
    noCache: true,
    temperature: 0.3,
    maxTokens: 600,
    messages,
    tools: tools.length ? tools : undefined,
  })
  return {
    content: r.content ?? '',
    toolCalls: (r.toolCalls ?? []).map((tc, i) => ({ id: tc.id || `call_${i}`, name: tc.name, arguments: tc.arguments ?? {} })),
    providerState: r.providerState,
    costPaise: Math.round((r.usage?.costInr ?? 0) * 100),
  }
}

let override: AgentModel | null = null

/** Tests / E2E: a scripted brain. Null restores the gateway. */
export function setAgentModel(m: AgentModel | null): void {
  override = m
}

export const getAgentModel = (): AgentModel => override ?? gatewayModel
