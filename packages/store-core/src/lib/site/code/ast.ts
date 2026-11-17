// The JSON form a code section is stored and rendered in. compileSection builds it from the AI's TSX; the interpreter
// (components/visitor/site/code/CodeSection.tsx) walks it. Nothing in it is ever executed as code.

export type CodeNode =
  | { t: 'el'; tag: string; props: Record<string, CodeValue>; children: CodeNode[] }
  | { t: 'cmp'; name: string; props: Record<string, CodeValue>; children: CodeNode[]; render?: { param: string; index?: string; body: CodeNode } }
  | { t: 'text'; value: string }
  | { t: 'expr'; value: CodeValue }
  | { t: 'cond'; test: CodeValue; then: CodeNode; else?: CodeNode }
  | { t: 'frag'; children: CodeNode[] }
  /** `list.map(item => …)` over a literal list or a bound array. */
  | { t: 'each'; items: CodeValue; param: string; index?: string; body: CodeNode }

export type CodeValue =
  | { k: 'lit'; v: string | number | boolean | null | Record<string, unknown> | unknown[] }
  | { k: 'path'; root: string; path: string[] }
  | { k: 'tpl'; parts: (string | CodeValue)[] }
  | { k: 'not' | 'bool'; v: CodeValue }
  | { k: 'eq'; a: CodeValue; b: CodeValue }
  | { k: 'cmp'; op: '<' | '<=' | '>' | '>='; a: CodeValue; b: CodeValue }
  | { k: 'cond'; test: CodeValue; then: CodeValue; else: CodeValue }
  /** Object / array literals holding bound values (all-literal ones are `lit`). */
  | { k: 'obj'; v: Record<string, CodeValue> }
  | { k: 'arr'; v: CodeValue[] }

/** The page a site card is written for: its section takes the product (`Card({ p })`) instead of no props. */
export const CARD_PAGE = 'card' as const
/** The root of a site card's bound paths: the product it is drawn for. */
export const CARD_PRODUCT = '$card'
