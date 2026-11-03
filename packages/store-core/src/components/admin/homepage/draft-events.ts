export const HOMEPAGE_DRAFT_CHANGED = 'homepage-draft-changed'

export function notifyHomepageDraftChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HOMEPAGE_DRAFT_CHANGED))
}
