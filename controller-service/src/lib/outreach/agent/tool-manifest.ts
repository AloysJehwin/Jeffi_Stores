import type { AgentChannel, ToolEffect, ToolGroup } from './types'

// What validation and parsing need to know about each tool, with no imports: catalog.ts pulls in the tool handlers
// (and through them the async DB modules), and Turbopack then hands validate.ts an unresolved catalog. The catalog
// test keeps this equal to the real catalog, in catalog order.
export interface ToolManifestEntry {
  channels: readonly AgentChannel[]
  effect: ToolEffect
  mandatory: boolean
  group: ToolGroup
}

export const TOOL_MANIFEST: Readonly<Record<string, ToolManifestEntry>> = {
  getLead: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'showcase' },
  updateLead: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'write', mandatory: false, group: 'showcase' },
  recordConsent: { channels: ['voice', 'whatsapp'], effect: 'write', mandatory: false, group: 'showcase' },
  optOut: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'write', mandatory: true, group: 'showcase' },
  markOutcome: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'write', mandatory: false, group: 'showcase' },
  logOutcome: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'write', mandatory: false, group: 'showcase' },
  handOff: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'write', mandatory: true, group: 'showcase' },
  getSiteStatus: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'showcase' },
  startPreview: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'send', mandatory: false, group: 'showcase' },
  addDetails: { channels: ['voice', 'whatsapp'], effect: 'write', mandatory: false, group: 'showcase' },
  requestChange: { channels: ['voice', 'whatsapp'], effect: 'write', mandatory: false, group: 'showcase' },
  publishSite: { channels: ['voice', 'whatsapp'], effect: 'send', mandatory: false, group: 'showcase' },
  sendLink: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'send', mandatory: false, group: 'showcase' },
  sendWhatsAppTemplate: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'send', mandatory: false, group: 'messaging' },
  sendWhatsAppText: { channels: ['whatsapp', 'follow_up'], effect: 'send', mandatory: false, group: 'showcase' },
  readMessages: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'showcase' },
  placeCall: { channels: ['whatsapp', 'follow_up'], effect: 'call', mandatory: false, group: 'showcase' },
  scheduleCallback: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'call', mandatory: false, group: 'showcase' },
  scheduleFollowUp: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'write', mandatory: false, group: 'showcase' },
  endCall: { channels: ['voice'], effect: 'write', mandatory: false, group: 'showcase' },
  switchLanguage: { channels: ['voice'], effect: 'write', mandatory: false, group: 'showcase' },
  getJob: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'core' },
  setOutcome: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'write', mandatory: false, group: 'core' },
  getOrder: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'orders' },
  findOrders: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'orders' },
  trackShipment: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'orders' },
  confirmCodOrder: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'write', mandatory: false, group: 'orders' },
  sendReviewLink: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'send', mandatory: false, group: 'reviews' },
  recordRating: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'write', mandatory: false, group: 'reviews' },
  getReviewStatus: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'reviews' },
  getAbandonedCheckout: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'checkout' },
  sendCheckoutLink: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'send', mandatory: false, group: 'checkout' },
  sendPaymentLink: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'send', mandatory: false, group: 'checkout' },
  checkDelivery: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'checkout' },
  searchProducts: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'catalog' },
  getProduct: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'catalog' },
  sendProductLink: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'send', mandatory: false, group: 'catalog' },
  getStoreInfo: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'read', mandatory: false, group: 'catalog' },
  createSupportTicket: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'write', mandatory: false, group: 'support' },
  createStaffTask: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'write', mandatory: false, group: 'support' },
  sendSms: { channels: ['voice', 'whatsapp', 'follow_up'], effect: 'send', mandatory: false, group: 'messaging' },
}

export const manifestTool = (name: string): ToolManifestEntry | null => (Object.prototype.hasOwnProperty.call(TOOL_MANIFEST, name) ? TOOL_MANIFEST[name] : null)
export const MANIFEST_MANDATORY: readonly string[] = Object.keys(TOOL_MANIFEST).filter(n => TOOL_MANIFEST[n].mandatory)
