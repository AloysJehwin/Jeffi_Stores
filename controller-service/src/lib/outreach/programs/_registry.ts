import { showcaseOffer } from './showcase-offer'

export interface OutreachProgramDef {
  key: string
  title: string
  description: string
  defaultDailyCap: number
  defaultConcurrency: number
  defaultWindow: { start: string; end: string }
  maxAttempts: number
}

// Programs are defined in code only; there is no create-program UI.
export const PROGRAMS: Record<string, OutreachProgramDef> = {
  [showcaseOffer.key]: showcaseOffer,
}

export const getProgram = (key: string): OutreachProgramDef | null => PROGRAMS[key] ?? null
export const listPrograms = (): OutreachProgramDef[] => Object.values(PROGRAMS)
