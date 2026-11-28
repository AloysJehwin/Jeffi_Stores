// A small stand-in for agent/catalog.ts (built in parallel): the real names and channels, none of the handlers.
type Ch = 'voice' | 'whatsapp' | 'follow_up'
const ALL: Ch[] = ['voice', 'whatsapp', 'follow_up']

const def = (name: string, channels: Ch[], effect: 'read' | 'write' | 'send' | 'call' = 'write', mandatory = false) => ({
  name,
  description: `${name} tool`,
  channels,
  effect,
  mandatory,
  args: null,
  inputSchema: { type: 'object', properties: {} },
  run: async () => ({ ok: true }),
})

const defs = [
  def('getLead', ALL, 'read'),
  def('updateLead', ALL),
  def('recordConsent', ['voice', 'whatsapp']),
  def('optOut', ALL, 'write', true),
  def('markOutcome', ALL),
  def('logOutcome', ALL),
  def('handOff', ALL, 'write', true),
  def('getSiteStatus', ALL, 'read'),
  def('startPreview', ['voice', 'whatsapp', 'follow_up'], 'send'),
  def('addDetails', ['voice', 'whatsapp']),
  def('requestChange', ['voice', 'whatsapp']),
  def('publishSite', ['voice', 'whatsapp'], 'send'),
  def('sendLink', ALL, 'send'),
  def('sendWhatsAppTemplate', ALL, 'send'),
  def('sendWhatsAppText', ['whatsapp', 'follow_up'], 'send'),
  def('readMessages', ALL, 'read'),
  def('placeCall', ['whatsapp', 'follow_up'], 'call'),
  def('scheduleCallback', ['voice', 'whatsapp', 'follow_up'], 'call'),
  def('scheduleFollowUp', ALL),
  def('endCall', ['voice']),
  def('switchLanguage', ['voice']),
  // Task-agent tools (docs/plans/OUTREACH_AGENTS.md §4)
  def('getJob', ALL, 'read'),
  def('setOutcome', ALL, 'write'),
  def('getOrder', ALL, 'read'),
  def('findOrders', ALL, 'read'),
  def('trackShipment', ALL, 'read'),
  def('confirmCodOrder', ALL, 'write'),
  def('sendReviewLink', ALL, 'send'),
  def('recordRating', ALL, 'write'),
  def('getReviewStatus', ALL, 'read'),
  def('getAbandonedCheckout', ALL, 'read'),
  def('sendCheckoutLink', ALL, 'send'),
  def('sendPaymentLink', ALL, 'send'),
  def('checkDelivery', ALL, 'read'),
  def('searchProducts', ALL, 'read'),
  def('getProduct', ALL, 'read'),
  def('sendProductLink', ALL, 'send'),
  def('getStoreInfo', ALL, 'read'),
  def('createSupportTicket', ALL, 'write'),
  def('createStaffTask', ALL, 'write'),
  def('sendSms', ALL, 'send'),
]

export const TOOLS: Record<string, ReturnType<typeof def>> = Object.fromEntries(defs.map(d => [d.name, d]))
export const TOOL_NAMES = defs.map(d => d.name)
export const MANDATORY_TOOLS = ['optOut', 'handOff'] as const
export const getTool = (name: string) => TOOLS[name] ?? null
export const allowedTools = (channel: Ch, allow: readonly string[]) => defs.filter(d => d.channels.includes(channel) && (allow.includes(d.name) || d.mandatory))
export const llmSchemas = (list: typeof defs) => list.map(d => ({ name: d.name, description: d.description, input_schema: d.inputSchema }))
export const catalogSummary = () => defs.map(d => ({ name: d.name, description: d.description, channels: d.channels, effect: d.effect, mandatory: d.mandatory, inputSchema: d.inputSchema }))
