// An India DLT SMS sender: provider `aws`, region fixed to ap-south-1, sent with the platform's own AWS credentials
// (`config.credentials === 'platform'`, no keys stored). The header is one of the platform's registered headers
// (shared under Jeffi's entity) or the store's own header with its own entity ID (`dlt_entity_id`).

export const IN_DLT_REGION = 'ap-south-1'
export const DLT_HEADER_RE = /^[A-Za-z0-9]{3,11}$/
export const DLT_ENTITY_RE = /^\d{15,25}$/

export const isIndiaDltConfig = (c: Record<string, unknown> | null | undefined) => c?.credentials === 'platform'

/** Error text for an invalid India DLT sender, or null. `platformHeaders` are the platform's registered headers. */
export function indiaDltError(header: string, config: Record<string, string>, platformHeaders: string[]): string | null {
  if (!DLT_HEADER_RE.test(header)) return 'The DLT header is 3 to 11 letters or digits'
  const entity = config.dlt_entity_id
  if (entity) return DLT_ENTITY_RE.test(entity) ? null : 'The DLT entity ID is the 15 to 25 digit number from the Airtel DLT portal'
  if (!platformHeaders.some(h => h.toLowerCase() === header.toLowerCase())) return "Pick one of the platform's registered headers, or enter your own header with its own DLT entity ID"
  return null
}

export const INDIA_DLT_COST_HINT = 'About ₹0.44 per SMS (160 English characters; 70 if the text has ₹ or Indian-language characters) on the DLT route.'
