// Wraps a rendered template body in the store's branded shell (shared with the store app and documents).
// Skipped when the body already starts with <!DOCTYPE or <html — admin-authored full HTML is passed through.
import { applyMailTheme, escapeHtml, mailShell } from '@jeffi/mail-shell'

export interface WrapOpts {
  brand?: string
  kicker?: string
  footerContact?: string
  preheader?: string | null
  accent?: string
  /** The mail carries a reply address that is read: invite the customer to reply. */
  replyHint?: boolean
}

export function wrapEmail(body: string, opts: WrapOpts): string {
  if (/^\s*<!DOCTYPE|^\s*<html/i.test(body)) return body
  const html = mailShell({
    brand: opts.brand || 'Notifications',
    kicker: opts.kicker,
    content: body,
    footerLines: opts.footerContact ? [escapeHtml(opts.footerContact)] : [],
    preheader: opts.preheader || undefined,
  })
  return applyMailTheme(html, { accent: opts.accent, replyHint: opts.replyHint })
}
