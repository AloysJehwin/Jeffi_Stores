// An unfinished new-scenario wizard: what was typed and generated, kept until the scenario is saved.
export interface ScenarioDraftFields {
  step?: 'describe' | 'review_sql' | 'dry_run' | 'save'
  aiPrompt?: string
  sql?: string
  productSql?: string
  explanation?: string
  validation?: unknown
  productValidation?: unknown
  dryRun?: unknown
  name?: string
  kind?: string
  description?: string
}

const MAX_FIELDS_BYTES = 200_000

/** `{ title?, fields? }` from a request body, or an error message. */
export function parseScenarioDraft(body: any): { title?: string | null; fields?: ScenarioDraftFields } | string {
  const out: { title?: string | null; fields?: ScenarioDraftFields } = {}
  if (body?.title !== undefined) {
    if (body.title !== null && typeof body.title !== 'string') return 'title must be a string'
    out.title = body.title ? String(body.title).trim().slice(0, 128) || null : null
  }
  if (body?.fields !== undefined) {
    if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) return 'fields must be an object'
    if (JSON.stringify(body.fields).length > MAX_FIELDS_BYTES) return 'This draft is too large to save'
    out.fields = body.fields
  }
  return out
}
