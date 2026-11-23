// A code section's tree: the JSON form store-core compiles the AI's TSX into (lib/site/code/compile.ts) and renders.
// Nothing in it is ever executed as code. `id` is the node's stable id (its `data-e` in the printed source; derived
// for nodes without a tag), `ro` marks a className built from expressions, `locked` a part the page can't lose.

type Ids = { id?: string }
type Marks = { ro?: true; locked?: true }

export type CodeNode =
  | ({ t: 'el'; tag: string; props: Record<string, CodeValue>; children: CodeNode[] } & Ids & Marks)
  | ({ t: 'cmp'; name: string; props: Record<string, CodeValue>; children: CodeNode[]; render?: { param: string; index?: string; body: CodeNode } } & Ids & Marks)
  | ({ t: 'text'; value: string } & Ids)
  | ({ t: 'expr'; value: CodeValue } & Ids)
  | ({ t: 'cond'; test: CodeValue; then: CodeNode; else?: CodeNode } & Ids)
  | ({ t: 'frag'; children: CodeNode[] } & Ids)
  /** `list.map(item => …)` over a literal list or a bound array. */
  | ({ t: 'each'; items: CodeValue; param: string; index?: string; body: CodeNode } & Ids)

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

/** Nodes that print as a tag and carry their id as `data-e`. */
export type TagNode = Extract<CodeNode, { t: 'el' | 'cmp' }>
export const isTagNode = (n: CodeNode | null | undefined): n is TagNode => !!n && (n.t === 'el' || n.t === 'cmp')

/** A `data-e` id: short, starts with a letter. */
export const NODE_ID = /^[A-Za-z][\w-]{0,40}$/
