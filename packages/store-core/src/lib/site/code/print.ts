import { NODE_ID, isTagNode, type CodeNode, type CodeValue } from '@jeffi/site-blocks'
import { LIBRARY_MODULE, MAX_SOURCE_BYTES } from './allow'
import { CARD_PRODUCT } from './ast'

// A code section's tree printed back to TSX, each tag carrying its id as `data-e`, so the AI and the source-level
// editors work on the same section the visual editor does. The output is only ever trusted after compileSection
// checks it: a tree from a browser goes through here and then the full compile. Printing an ids-mode tree and
// compiling it again gives the same tree (tests/lib/site-code-roundtrip.test.ts).

export class PrintError extends Error {}

export interface PrintOptions {
  /** The site card's section: takes the product (`Card({ p: $card })`). */
  card?: boolean
  /** No line breaks or indentation (for a section that would not fit the size limit printed in full). */
  compact?: boolean
}

const IDENT = /^[A-Za-z_$][\w$]*$/
const TAG = /^[a-z][a-z0-9]*$/
const COMPONENT = /^[A-Z][A-Za-z0-9]*$/
const ATTR = /^[A-Za-z][\w-]*$/
const SKIP_PROPS = new Set(['key', 'data-e'])

const fail = (what: string): never => {
  throw new PrintError(what)
}
const ident = (s: unknown, what: string) => (typeof s === 'string' && IDENT.test(s) ? s : fail(`${what} isn't a name: ${String(s).slice(0, 40)}`))

function litJs(v: unknown, nested: boolean): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) fail('A number must be finite')
    return v < 0 || Object.is(v, -0) ? (nested ? `(${v})` : String(v)) : String(v)
  }
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'object') return JSON.stringify(v)
  return fail(`A ${typeof v} can't be written as a literal`)
}

const pathJs = (v: Extract<CodeValue, { k: 'path' }>) =>
  ident(v.root, 'A path root') +
  (Array.isArray(v.path) ? v.path : fail('A path must be a list')).map(k => (typeof k !== 'string' ? fail('A path step must be text') : IDENT.test(k) ? `.${k}` : /^(0|[1-9]\d{0,8})$/.test(k) ? `[${k}]` : `[${JSON.stringify(k)}]`)).join('')

const escTpl = (s: string) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/\r/g, '\\r')

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A value as a JS expression; `nested` wraps compound ones in parentheses. */
export function valueJs(v: CodeValue, nested = false): string {
  const wrap = (s: string) => (nested ? `(${s})` : s)
  if (!v || typeof v !== 'object') return fail('Not a value')
  switch (v.k) {
    case 'lit':
      return litJs(v.v, nested)
    case 'path':
      return pathJs(v)
    case 'tpl':
      return '`' + (Array.isArray(v.parts) ? v.parts : fail('A template must be a list')).map(p => (typeof p === 'string' ? escTpl(p) : '${' + valueJs(p) + '}')).join('') + '`'
    case 'not':
      return v.v?.k === 'eq' ? wrap(`${valueJs(v.v.a, true)} !== ${valueJs(v.v.b, true)}`) : wrap(`!${valueJs(v.v, true)}`)
    case 'bool':
      return wrap(`!!${valueJs(v.v, true)}`)
    case 'eq':
      return wrap(`${valueJs(v.a, true)} === ${valueJs(v.b, true)}`)
    case 'cmp':
      return ['<', '<=', '>', '>='].includes(v.op) ? wrap(`${valueJs(v.a, true)} ${v.op} ${valueJs(v.b, true)}`) : fail('Unknown comparison')
    case 'cond':
      // `a || b` is stored as a ? a : b.
      return same(v.test, v.then) ? wrap(`${valueJs(v.test, true)} || ${valueJs(v.else, true)}`) : wrap(`${valueJs(v.test, true)} ? ${valueJs(v.then, true)} : ${valueJs(v.else, true)}`)
    case 'obj':
      return `{ ${Object.entries(v.v ?? {}).map(([k, x]) => `${JSON.stringify(k)}: ${valueJs(x)}`).join(', ')} }`
    case 'arr':
      return `[${(Array.isArray(v.v) ? v.v : fail('A list must be a list')).map(x => valueJs(x)).join(', ')}]`
    default:
      return fail('Unknown value')
  }
}

/** Text JSX can hold as it is: no edge or line-break whitespace, nothing JSX reads as markup. */
const plainText = (s: string) => s.length > 0 && !/^\s|\s$/.test(s) && !/[{}<>&\n\r\t]/.test(s)
const plainAttr = (s: string) => !/["&\\\u0000-\u001f\u007f]/.test(s)

function attrJs(name: string, v: CodeValue): string {
  if (v.k === 'lit' && v.v === true) return name
  if (v.k === 'lit' && typeof v.v === 'string') return plainAttr(v.v) ? `${name}="${v.v}"` : `${name}={${JSON.stringify(v.v)}}`
  return `${name}={${valueJs(v)}}`
}

class Printer {
  readonly components = new Set<string>()
  constructor(private readonly compact: boolean) {}

  private nl(depth: number) {
    return this.compact ? '' : `\n${'  '.repeat(depth)}`
  }

  /** A node where an expression goes (a branch, an arrow's body). */
  expr(n: CodeNode, depth: number): string {
    switch (n.t) {
      case 'el':
      case 'cmp':
      case 'frag':
        return this.jsx(n, depth)
      case 'text':
        return JSON.stringify(typeof n.value === 'string' ? n.value : fail('Text must be text'))
      case 'expr':
        return this.exprValue(n.value)
      case 'cond': {
        const test = valueJs(n.test, true)
        const then = this.branch(n.then, depth)
        return n.else ? `${test} ? ${then} : ${this.branch(n.else, depth)}` : `${test} && ${then}`
      }
      case 'each': {
        const params = n.index ? `(${ident(n.param, 'A list item')}, ${ident(n.index, 'An index')})` : `(${ident(n.param, 'A list item')})`
        return `${valueJs(n.items, true)}.map(${params} => ${this.arrowBody(n.body, depth)})`
      }
      default:
        return fail('Unknown node')
    }
  }

  /** `{x}` where JSX shows a value: text reads as an expression node only from a template literal. */
  private exprValue(v: CodeValue): string {
    if (v?.k === 'lit' && typeof v.v === 'string') return '`' + escTpl(v.v) + '`'
    return valueJs(v, v?.k === 'cond' && !same(v.test, v.then))
  }

  private branch(n: CodeNode, depth: number) {
    return n.t === 'cond' || n.t === 'each' ? `(${this.expr(n, depth)})` : this.expr(n, depth)
  }

  private arrowBody(n: CodeNode, depth: number) {
    return n.t === 'el' || n.t === 'cmp' || n.t === 'frag' ? `(${this.nl(depth + 1)}${this.jsx(n, depth + 1)}${this.nl(depth)})` : `(${this.expr(n, depth)})`
  }

  private open(n: Extract<CodeNode, { t: 'el' | 'cmp' }>): string {
    const name = n.t === 'el' ? (TAG.test(n.tag) ? n.tag : fail(`<${String(n.tag).slice(0, 20)}> isn't a tag`)) : COMPONENT.test(n.name) ? n.name : fail(`<${String(n.name).slice(0, 20)}> isn't a component`)
    if (n.t === 'cmp') this.components.add(name)
    const attrs: string[] = []
    if (n.id && NODE_ID.test(n.id)) attrs.push(`data-e="${n.id}"`)
    for (const [k, v] of Object.entries(n.props ?? {})) {
      if (SKIP_PROPS.has(k)) continue
      if (!ATTR.test(k)) fail(`${k.slice(0, 40)} isn't an attribute name`)
      attrs.push(attrJs(k, v))
    }
    return `<${name}${attrs.map(a => ` ${a}`).join('')}`
  }

  jsx(n: CodeNode, depth: number): string {
    if (n.t === 'frag') return n.children.length ? `<>${this.children(n.children, depth)}${this.nl(depth)}</>` : '<></>'
    if (!isTagNode(n)) return fail('Not markup')
    const open = this.open(n)
    const name = n.t === 'el' ? n.tag : n.name
    if (n.t === 'cmp' && n.render) {
      const r = n.render
      const params = r.index ? `(${ident(r.param, 'A render parameter')}, ${ident(r.index, 'An index')})` : `(${ident(r.param, 'A render parameter')})`
      return `${open}>${this.nl(depth + 1)}{${params} => ${this.arrowBody(r.body, depth + 1)}}${this.nl(depth)}</${name}>`
    }
    const kids = Array.isArray(n.children) ? n.children : fail('Children must be a list')
    if (!kids.length) return `${open} />`
    const only = kids.length === 1 && kids[0].t === 'text' ? kids[0].value : null
    if (only != null && plainText(only) && open.length + only.length < 100) return `${open}>${only}</${name}>`
    return `${open}>${this.children(kids, depth)}${this.nl(depth)}</${name}>`
  }

  private children(list: CodeNode[], depth: number): string {
    let out = ''
    let rawBefore = false
    for (const c of list) {
      let s: string
      let raw = false
      if (c.t === 'text') {
        const v = typeof c.value === 'string' ? c.value : fail('Text must be text')
        // Two plain texts in a row would read back as one.
        raw = plainText(v) && !rawBefore
        s = raw ? v : `{${JSON.stringify(v)}}`
      } else if (c.t === 'el' || c.t === 'cmp' || c.t === 'frag') s = this.jsx(c, depth + 1)
      else s = `{${this.expr(c, depth + 1)}}`
      rawBefore = raw
      out += this.nl(depth + 1) + s
    }
    return out
  }
}

/** The section's TSX. Throws PrintError on a tree that isn't one. */
export function printSection(tree: CodeNode, opts: PrintOptions = {}): string {
  if (!tree || typeof tree !== 'object' || (tree.t !== 'el' && tree.t !== 'cmp' && tree.t !== 'frag')) fail('A section returns markup')
  const p = new Printer(!!opts.compact)
  const body = p.jsx(tree, 2)
  const head = p.components.size ? `import { ${[...p.components].sort().join(', ')} } from '${LIBRARY_MODULE}'\n\n` : ''
  const sig = opts.card ? `Card({ p: ${CARD_PRODUCT} })` : 'Section()'
  return opts.compact ? `${head}export default function ${sig} {\nreturn (${body})\n}\n` : `${head}export default function ${sig} {\n  return (\n    ${body}\n  )\n}\n`
}

const bytes = (s: string) => new TextEncoder().encode(s).length

/** The section printed in full, or compact when that alone fits the size limit; null when neither fits. */
export function printFitting(tree: CodeNode, opts: Omit<PrintOptions, 'compact'> = {}): string | null {
  const full = printSection(tree, opts)
  if (bytes(full) <= MAX_SOURCE_BYTES) return full
  const compact = printSection(tree, { ...opts, compact: true })
  return bytes(compact) <= MAX_SOURCE_BYTES ? compact : null
}
