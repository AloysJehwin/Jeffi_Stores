import type { OutreachProgramDef } from './_registry'

export const showcaseOffer: OutreachProgramDef = {
  key: 'showcase-offer',
  title: 'Showcase offer',
  description: 'Call a business that has no website, build a Showcase site with them on the call, and WhatsApp the preview and live links.',
  defaultDailyCap: 50,
  defaultConcurrency: 2,
  defaultWindow: { start: '09:30', end: '20:30' },
  maxAttempts: 3,
}
