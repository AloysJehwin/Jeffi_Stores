// AI Site Studio pipeline (docs/AI_SITE_STUDIO_PLAN.md 4.5): answers → brief → plan → directions → sample catalogue →
// pages written section by section as code sections → installed into the store after provisioning.

export * from './types'
export type { SampleCatalog } from '../data/types'
export { brief, cleanAnswers, suggestAnswer } from './brief'
export { plan, replanPage, plannedPage, planShowcase, APPROACHES, LAYOUTS, SHOWCASE_APPROACHES } from './plan'
export { UTILITY_RANK } from './utility'
export { showcaseBrief, suggestShowcaseAnswer, studioPageOf, showcaseStarter, showcasePictures } from './showcase'
export { directions, newDirection, shuffleColours } from './directions'
export { sampleCatalog, addPictures } from './catalog'
export { generatePage, regeneratePage, tweakSection, generateCard, extractTsx, CODE_SECTION } from './generate'
export { CARD_KEY } from '../card'
export { installStudioSite, parseStudioKey, type InstallResult } from './install'
export { runStudioFunded, studioBudgetLeft, studioSpentInr, StudioBudgetError, StudioAiDownError, STUDIO_BUDGET_INR } from './ai'
