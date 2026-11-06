// One-line summaries for routes whose handler has no leading comment, from the method and path.

const VERBS = new Set([
  'approve', 'reject', 'cancel', 'sync', 'refresh', 'retry', 'publish', 'unpublish', 'restore', 'revoke', 'resend', 'send', 'test', 'run', 'preview',
  'import', 'export', 'upload', 'download', 'generate', 'convert', 'finalize', 'archive', 'unarchive', 'duplicate', 'clone', 'verify', 'connect',
  'disconnect', 'enable', 'disable', 'toggle', 'reorder', 'recalculate', 'reset', 'regenerate', 'start', 'stop', 'pause', 'resume', 'join', 'handback',
  'translate', 'check', 'push', 'pull', 'register', 'issue', 'rotate', 'mark', 'assign', 'unassign', 'bulk', 'apply', 'submit', 'confirm', 'complete',
  'close', 'reopen', 'move', 'rename', 'share', 'unshare', 'merge', 'split', 'suggest', 'analyze', 'analyse', 'enrich', 'optimize', 'reconcile',
  'resync', 'provision', 'deprovision', 'release', 'claim', 'block', 'unblock', 'ban', 'unban', 'lock', 'unlock', 'notify', 'remind', 'schedule',
  'reschedule', 'ship', 'pack', 'dispatch', 'deliver', 'refund', 'charge', 'capture', 'void', 'accept', 'decline', 'escalate', 'resolve', 'attach',
  'detach', 'link', 'unlink', 'invite', 'impersonate', 'login', 'logout', 'heartbeat', 'acknowledge', 'ack', 'dismiss', 'snooze', 'redeem', 'recharge',
  'topup', 'withdraw', 'transfer', 'calculate', 'estimate', 'validate', 'search', 'scan', 'parse', 'extract', 'compose', 'save', 'discard',
  'seed', 'backfill', 'rebuild', 'reindex', 'purge', 'clear', 'flush', 'ping', 'probe', 'set', 'update', 'create', 'delete', 'add', 'remove', 'ask',
  'answer', 'reply', 'request', 'promote', 'demote', 'rollback', 'deploy', 'redeploy', 'restart', 'scale', 'resize', 'audit', 'label', 'tag', 'print',
  'email', 'call', 'fetch', 'load', 'save', 'mint', 'sign', 'encrypt', 'decrypt', 'subscribe', 'unsubscribe', 'opt', 'go', 'select', 'pick', 'swap',
])

const UNCOUNTABLE = new Set(['analytics', 'settings', 'news', 'status', 'sms', 'access', 'series', 'process', 'business', 'address', 'stats', 'metrics', 'insights', 'logistics', 'pricing', 'inventory', 'billing', 'kyc', 'dns', 'gst', 'seo', 'ai', 'data', 'media', 'info', 'feedback', 'health', 'overview', 'console', 'controls', 'details', 'credentials', 'permissions', 'preferences', 'payments', 'notes', 'alerts', 'filters', 'logs', 'mfa', 'auth', 'tds', 'ecom'])

const ACRONYMS: Record<string, string> = { ai: 'AI', gst: 'GST', gmc: 'GMC', sms: 'SMS', kyc: 'KYC', dns: 'DNS', seo: 'SEO', po: 'purchase order', rfq: 'RFQ', rfqs: 'RFQs', mfa: 'MFA', otp: 'OTP', csv: 'CSV', pdf: 'PDF', wa: 'WhatsApp', url: 'URL', api: 'API', tds: 'TDS', hsn: 'HSN', sku: 'SKU', skus: 'SKUs', utm: 'UTM', id: 'ID', ids: 'IDs', einvoice: 'e-invoice', ecom: 'ecom', faq: 'FAQ', faqs: 'FAQs', ssl: 'SSL', p12: 'P12' }

function words(seg: string): string {
  return seg
    .split(/[-_]/)
    .map(w => ACRONYMS[w.toLowerCase()] ?? w)
    .join(' ')
}

const PLURAL_ACRONYMS: Record<string, string> = { rfqs: 'rfq', skus: 'sku', ids: 'id', faqs: 'faq' }

function singular(seg: string): string {
  const w = seg.toLowerCase()
  if (PLURAL_ACRONYMS[w]) return words(PLURAL_ACRONYMS[w])
  const last = w.split('-').pop()!
  if (UNCOUNTABLE.has(last) || ACRONYMS[last]) return words(seg)
  let s = seg
  if (/ies$/.test(seg)) s = seg.replace(/ies$/, 'y')
  else if (/(ss|us)$/.test(seg)) s = seg
  else if (/(ch|sh|x|z|ses)$/.test(seg.replace(/es$/, '')) && /es$/.test(seg)) s = seg.replace(/es$/, '')
  else if (/s$/.test(seg)) s = seg.replace(/s$/, '')
  return words(s)
}

const article = (w: string) => (/^(uni|use|usa|usi|uti|eu|one)/i.test(w) ? 'a' : article0(w))
const article0 = (w: string) => (/^(AI|SMS|SKU|SEO|SSL|MFA|FAQ|RFQ|HSN|URL|API)\b/.test(w) ? (/^(SMS|SKU|SEO|SSL|MFA|FAQ|RFQ|HSN)/.test(w) ? 'an' : w.startsWith('U') ? 'a' : 'an') : /^[aeiou]/i.test(w) ? 'an' : 'a')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const isParam = (s: string) => s.startsWith('{')

export function generatedSummary(method: string, segments: string[], host: string): string {
  const segs = segments.filter(Boolean)
  if (!segs.length) return `${method} ${host === 'platform' ? 'the platform' : 'the store'} root`
  const last = segs[segs.length - 1]
  const statics = segs.filter(s => !isParam(s))
  const ownerOf = (i: number) => {
    for (let j = i; j >= 0; j--) if (!isParam(segs[j])) return segs[j]
    return null
  }
  const lastStatic = statics[statics.length - 1] ?? last
  const first = lastStatic.split('-')[0].toLowerCase()

  if (isParam(last)) {
    const owner = ownerOf(segs.length - 2) ?? 'resource'
    const thing = singular(owner)
    const ctx = statics.length > 1 ? ` (${statics.slice(0, -1).map(words).join(' / ')})` : ''
    if (last.startsWith('{...')) return `${method === 'GET' ? 'Get' : method === 'DELETE' ? 'Delete' : 'Write'} ${words(owner)} by path${ctx}`
    if (method === 'GET') return `Get ${article(thing)} ${thing}${ctx}`
    if (method === 'DELETE') return `Delete ${article(thing)} ${thing}${ctx}`
    if (method === 'POST') return `Act on ${article(thing)} ${thing}${ctx}`
    return `Update ${article(thing)} ${thing}${ctx}`
  }

  const idx = segs.length - 1
  const prevIsParam = idx > 0 && isParam(segs[idx - 1])
  const owner = prevIsParam ? ownerOf(idx - 2) : null
  const ownerText = owner ? ` ${owner === lastStatic ? '' : `for ${article(singular(owner))} ${singular(owner)}`}`.trimEnd() : ''
  const scope = !prevIsParam && statics.length > 1 ? statics.slice(0, -1).map(words).join(' ') : ''

  if (VERBS.has(first) && method === 'POST') {
    const action = cap(words(lastStatic))
    // `orders/{id}/cancel` → "Cancel an order"; `invoices/{id}/resend-email` → "Resend email for an invoice".
    if (owner && !lastStatic.includes('-')) return `${action} ${article(singular(owner))} ${singular(owner)}`
    if (ownerText) return `${action}${ownerText}`
    return scope ? `${action} (${scope})` : action
  }
  const noun = words(lastStatic)
  const where = ownerText || (scope ? ` (${scope})` : '')
  switch (method) {
    case 'GET':
      return `${UNCOUNTABLE.has(lastStatic.split('-').pop()!.toLowerCase()) || !/s$/.test(lastStatic) ? 'Get' : 'List'} ${noun}${where}`
    case 'POST':
      return /s$/.test(lastStatic) && !UNCOUNTABLE.has(lastStatic.split('-').pop()!.toLowerCase()) ? `Create ${article(singular(lastStatic))} ${singular(lastStatic)}${where}` : `Submit ${noun}${where}`
    case 'DELETE':
      return `Delete ${noun}${where}`
    default:
      return `Update ${noun}${where}`
  }
}
