// Robust loader for a Google service-account credential (client_email + private_key), from
// either GOOGLE_SERVICE_ACCOUNT_JSON (env, e.g. Secrets Manager) or a JSON key file on disk.
//
// Why this exists: the #1 way this secret gets mangled is the private_key's newlines being
// stored as LITERAL newline characters instead of the escaped "\n" JSON requires. That makes
// JSON.parse throw "Bad control character in string literal in JSON at position N" (N points at
// the first raw newline in the key), which took down the entire Merchant Center sync — every
// batch called this and threw identically. This loader parses defensively: on a control-char
// failure it escapes raw control characters that appear INSIDE string literals and retries, so
// a slightly-malformed secret degrades to "works" instead of "total outage".

export interface GoogleServiceAccountCreds {
  client_email: string
  private_key: string
}

/**
 * Parse service-account JSON that may contain raw (unescaped) control characters inside string
 * values — most commonly literal newlines in private_key. Tries a straight parse first; on a
 * control-character error, escapes control chars that occur while inside a JSON string and
 * retries once.
 */
export function parseServiceAccountJson(raw: string): any {
  try {
    return JSON.parse(raw)
  } catch (e: any) {
    if (!/control character|Bad control/i.test(e?.message || '')) throw e
    return JSON.parse(escapeControlCharsInStrings(raw))
  }
}

/** Escape raw control chars (\n \r \t and other <0x20) that appear INSIDE JSON string literals,
 * leaving structural whitespace between tokens untouched. */
function escapeControlCharsInStrings(s: string): string {
  let out = ''
  let inStr = false
  let escaped = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const code = s.charCodeAt(i)
    if (inStr) {
      if (escaped) {
        out += ch
        escaped = false
        continue
      }
      if (ch === '\\') {
        out += ch
        escaped = true
        continue
      }
      if (ch === '"') {
        out += ch
        inStr = false
        continue
      }
      if (code < 0x20) {
        out +=
          ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : '\\u' + code.toString(16).padStart(4, '0')
        continue
      }
      out += ch
    } else {
      if (ch === '"') {
        inStr = true
      }
      out += ch
    }
  }
  return out
}

/** Normalize a private key so PEM newlines are real newlines (handles the escaped-"\n" form). */
function normalizePrivateKey(key: string): string {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key
}

/**
 * Load the Google service-account credential. Prefers GOOGLE_SERVICE_ACCOUNT_JSON; falls back
 * to a key file in the project root (default jeffi-stores-76e9ecaecdd6.json). Tolerant of a
 * private_key stored with literal newlines.
 */
export function loadGoogleServiceAccount(keyFileName = 'jeffi-stores-76e9ecaecdd6.json'): GoogleServiceAccountCreds {
  let creds: any
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    creds = parseServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  } else {
    const fs = require('fs')
    const path = require('path')
    const credPath = path.join(process.cwd(), keyFileName)
    creds = parseServiceAccountJson(fs.readFileSync(credPath, 'utf8'))
  }
  return {
    client_email: creds.client_email,
    private_key: normalizePrivateKey(creds.private_key),
  }
}
