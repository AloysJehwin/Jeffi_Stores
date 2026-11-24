// Stand-in for O-whatsapp's lib/outreach/whatsapp.ts until that branch merges: the two sends the call tools need
// (templates outreach/preview_ready and outreach/site_live). It sends nothing and reports ok:false, so the agent
// never says a link went out. On merge: point the import in tools.ts at './whatsapp' and delete this file.
// The tools only call these after WhatsApp consent is recorded on the contact.

export interface SendResult {
  ok: boolean
  messageId?: string
  error?: string
}

export async function sendPreviewReady(_contactId: string, _input: { previewUrl: string }): Promise<SendResult> {
  return { ok: false, error: 'WhatsApp sends are not available yet' }
}

export async function sendSiteLive(_contactId: string, _input: { liveUrl: string; claimUrl: string }): Promise<SendResult> {
  return { ok: false, error: 'WhatsApp sends are not available yet' }
}
