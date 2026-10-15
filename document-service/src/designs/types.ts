import type { ReactElement } from 'react'
import type { DocModel, FontKey } from './model.js'
import type { Theme } from './kit.js'

export interface Design {
  key: string
  name: string
  description: string
  accent: string
  font: FontKey
  render: (m: DocModel, t: Theme, opts: { thermal?: boolean }) => ReactElement
  /** Neutral colours for this design (the accent is the customer's). */
  palette?: Partial<Omit<Theme, 'accent' | 'head' | 'body' | 'mono'>>
}
