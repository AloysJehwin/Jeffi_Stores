// Stand-in for O-build's lib/outreach/build.ts (the WAVE2 contract signatures) until that branch merges. It builds
// nothing: every call throws, so a tool answers ok:false and the agent never claims a site exists.
// On merge: point the import in tools.ts at './build' and delete this file.

export interface OutreachBrief {
  whatTheyDo?: string
  audience?: string
  highlights?: string[]
  contact?: { phone?: string; email?: string; whatsapp?: string }
  hours?: string
  address?: string
  style?: string
  language?: string
}

export class BuildUnavailableError extends Error {
  constructor() {
    super('The outreach build pipeline is not available yet')
    this.name = 'BuildUnavailableError'
  }
}

export async function startDraft(_contactId: string, _input: { businessName: string; language: string }): Promise<{ siteId: string; previewUrl: string }> {
  throw new BuildUnavailableError()
}

export async function mergeBrief(_contactId: string, _partial: OutreachBrief): Promise<{ building: boolean; missing: (keyof OutreachBrief)[] }> {
  throw new BuildUnavailableError()
}

export async function requestChange(_contactId: string, _instruction: string): Promise<{ ok: boolean; summary: string }> {
  throw new BuildUnavailableError()
}

export async function publish(_contactId: string): Promise<{ liveUrl: string; claimUrl: string }> {
  throw new BuildUnavailableError()
}
