// Server pages can't hand a function to a client table, so they send two built URLs
// (page 1 and a sentinel page) and the client fills in the page number.
const SENTINEL = 987654321

export type PageUrls = { first: string; template: string }

export function pageUrls(build: (p: number) => string): PageUrls {
  return { first: build(1), template: build(SENTINEL) }
}

export function pageHrefFrom(urls: PageUrls): (p: number) => string {
  return p => (p <= 1 ? urls.first : urls.template.replace(String(SENTINEL), String(p)))
}
