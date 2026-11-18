import type { PageKey } from '@jeffi/site-blocks'
import { allowedOnPage, codeLibrary, describeLibrary } from '../code/library'

// The code engine's component library as the studio needs it: names a page may use, the parts it requires, and the
// prompt text describing them.

export function partsFor(page: PageKey): string[] {
  return [...codeLibrary().values()].filter(d => allowedOnPage(d, page)).map(d => d.name)
}

export function requiredParts(page: PageKey): string[] {
  return [...codeLibrary().values()].filter(d => d.required?.includes(page)).map(d => d.name)
}

export const libraryText = (page: PageKey) => describeLibrary(page)
