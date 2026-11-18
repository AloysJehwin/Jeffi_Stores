// Init script for recordings of the local admin (a copy of real store data): swaps customer names, addresses, emails,
// phone numbers and GSTINs for stand-ins in every text node, and hides the Next dev indicator.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const HIDE_DEV = `
(() => {
  // A constructed sheet is not a DOM node, so hydration never sees it.
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('nextjs-portal, [data-nextjs-toast], [data-next-badge-root], #__next-build-watcher { display: none !important; }')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  } catch {}
})()`

export function maskScript() {
  const file = path.join(here, '.local', 'mask-dict.json')
  if (!fs.existsSync(file)) throw new Error('no mask dictionary: run "node setup.mjs mask" first')
  const dict = JSON.parse(fs.readFileSync(file, 'utf8'))
  // Account labels and the store's own brand are not people.
  const keep = new Set(['admin', 'admin user', 'business', 'customer', 'guest', 'user', 'app customer', 'walk-in customer', 'jeffi', 'jeffi stores'])
  const names = (dict.names ?? []).filter(n => n && n.length >= 4 && !keep.has(n.toLowerCase())).sort((a, b) => b.length - a.length)
  const addresses = (dict.addresses ?? []).filter(Boolean).sort((a, b) => b.length - a.length)
  return `
(() => {
  if (window.__masking) return
  window.__masking = true
  const NAMES = ${JSON.stringify(names)}
  const ADDRS = ${JSON.stringify(addresses)}
  const FAKE = ['Aarav Sharma','Diya Patel','Vihaan Rao','Ananya Iyer','Kabir Mehta','Isha Nair','Arjun Reddy','Meera Joshi','Rohan Gupta','Sana Khan','Aditya Verma','Priya Menon','Karan Malhotra','Nisha Pillai','Dev Kapoor','Tara Bose','Neel Desai','Riya Shetty','Yash Kulkarni','Zoya Ali','Ishaan Bhat','Avni Jain','Reyansh Das','Kiara Sinha','Vivaan Chopra','Myra Saxena','Aryan Hegde','Anika Ghosh','Shaurya Naidu','Pari Agarwal']
  const STREETS = ['12, 4th Cross, Indiranagar','88, MG Road','7, Lake View Layout','21, Temple Street','5, Park Avenue','40, 2nd Main, Jayanagar']
  const h = s => { let x = 2166136261; for (const c of s.toLowerCase()) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619) } return Math.abs(x) }
  const esc = s => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')
  const nameRe = NAMES.length ? new RegExp('(?<![\\\\p{L}])(' + NAMES.map(esc).join('|') + ')(?![\\\\p{L}])', 'giu') : null
  const addrRe = ADDRS.length ? new RegExp('(' + ADDRS.map(esc).join('|') + ')', 'gi') : null
  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi
  const phoneRe = /(\\+?91[\\s-]?)?(?<!\\d)[6-9]\\d{4}[\\s-]?\\d{5}(?!\\d)/g
  const gstRe = /\\b\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\\b/g
  const made = new Set()
  const keep = (m, make) => { if (made.has(m)) return m; const r = make(m); made.add(r); return r }
  const fakeName = real => {
    const f = FAKE[h(real) % FAKE.length]
    return real.trim().includes(' ') ? f : f.split(' ')[0]
  }
  const fix = text => {
    let t = text
    if (addrRe) t = t.replace(addrRe, m => keep(m, x => STREETS[h(x) % STREETS.length]))
    t = t.replace(emailRe, m => keep(m, x => FAKE[h(x) % FAKE.length].toLowerCase().replace(' ', '.') + '@example.com'))
    t = t.replace(phoneRe, m => keep(m, x => { const d = String(h(x)).padStart(9, '7').slice(0, 9); return (x.trim().startsWith('+') ? '+91 ' : '') + '9' + d.slice(0, 4) + ' ' + d.slice(4, 9) }))
    t = t.replace(gstRe, m => keep(m, () => '29ABCDE1234F1Z5'))
    if (nameRe) t = t.replace(nameRe, m => keep(m, fakeName))
    return t
  }
  const produced = new Set()
  const apply = node => { const v = node.nodeValue; if (!v || !v.trim() || produced.has(v)) return; const n = fix(v); if (n !== v) { produced.add(n); node.nodeValue = n } }
  const walk = root => {
    if (root.nodeType === 3) return apply(root)
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node
    while ((node = tw.nextNode())) apply(node)
    if (root.querySelectorAll) for (const i of root.querySelectorAll('input, textarea')) { const v = i.value; if (v && !produced.has(v)) { const n = fix(v); if (n !== v) { produced.add(n); i.value = n } } }
  }
  // Watch the document from the very start so parsed text is swapped before the first paint.
  if (document.documentElement) walk(document.documentElement)
  new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') walk(m.target); else m.addedNodes.forEach(walk) } }).observe(document, { childList: true, subtree: true, characterData: true })
})()`
}
