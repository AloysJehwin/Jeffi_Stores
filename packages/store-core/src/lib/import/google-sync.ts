import * as XLSX from 'xlsx'

export type SheetMatrix = string[][]

// Accept either a bare spreadsheet id or a full Google Sheets URL and return the id, or '' if
// nothing usable is found. URL form: https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0
export function extractSpreadsheetId(input: string): string {
  const s = input.trim()
  if (!s) return ''
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9-_]+$/.test(s)) return s
  return ''
}

/**
 * Convert Google Sheets value matrices into a .xlsx Buffer that parseWorkbook accepts unchanged,
 * so the Google sync reuses the upload worker path. Pass one matrix for a legacy flat sheet, or a
 * map of tab title → matrix to rebuild the multi-sheet template with its tabs intact.
 */
export function valuesToWorkbookBuffer(values: SheetMatrix | Record<string, SheetMatrix>): Buffer {
  const sheets = Array.isArray(values) ? { Products: values } : values
  const wb = XLSX.utils.book_new()
  for (const [title, matrix] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrix.length ? matrix : [[]]), title.slice(0, 31))
  }
  if (wb.SheetNames.length === 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Products')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export type GoogleFailureCode = 'reauth' | 'not_found' | 'no_access' | 'scope' | 'rate_limited' | 'unavailable' | 'unknown'

export interface GoogleFailure {
  code: GoogleFailureCode
  status: number
  error: string
}

/** Turn a Google token/API failure into a status and a message an admin can act on (no raw internals). */
export function describeGoogleFailure(e: unknown, action = 'reach the Google Sheet'): GoogleFailure {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 0
  const low = msg.toLowerCase()
  // Only a refused refresh token means reconnect; a refresh that failed for another reason (Google 5xx,
  // temporarily_unavailable) is retried, not flagged.
  if (/invalid_grant|expired or revoked|invalid_client|unauthorized_client/.test(low) || status === 401) {
    return {
      code: 'reauth',
      status: 409,
      error: 'Google access expired or was revoked. Reconnect your Google account, then try again.',
    }
  }
  if (/google oauth not configured/.test(low)) {
    return { code: 'unavailable', status: 503, error: 'Google sign-in is not configured on this server.' }
  }
  if (/insufficient authentication scopes|insufficientpermissions|access_token_scope_insufficient/.test(low)) {
    return {
      code: 'scope',
      status: 409,
      error: 'Google access is missing a permission this needs. Reconnect and allow every permission Google asks for.',
    }
  }
  if (status === 429 || /rate limit|quota|resource_exhausted/.test(low)) {
    return { code: 'rate_limited', status: 429, error: 'Google is rate limiting requests. Wait a minute and try again.' }
  }
  if (status === 404 || /requested entity was not found|not found/.test(low)) {
    return {
      code: 'not_found',
      status: 404,
      error: 'The Google Sheet was not found. It may have been deleted; create a new one or paste another link.',
    }
  }
  if (status === 403 || /permission|forbidden/.test(low)) {
    return {
      code: 'no_access',
      status: 403,
      error: 'The connected Google account cannot open this sheet. Share it with that account or connect the account that owns it.',
    }
  }
  if (status >= 500) {
    return { code: 'unavailable', status: 502, error: 'Google is not responding right now. Try again in a few minutes.' }
  }
  return { code: 'unknown', status: 502, error: `Could not ${action}. Try again, or reconnect Google if it keeps failing.` }
}
