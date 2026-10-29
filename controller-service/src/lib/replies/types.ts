import type { z } from 'zod'

export type ScenarioKey =
  | 'order_adjustment'
  | 'variant_change'
  | 'quotation'
  | 'rfq_offer'
  | 'invoice_payment'
  | 'payment_failed'
  | 'order_delay'
  | 'out_of_stock'
  | 'subscription_renewal'
  | 'support'

export interface ReplyContextRow {
  id: string
  token: string
  user_id: string | null
  contact_email: string | null
  contact_phone: string | null
  scenario: ScenarioKey
  entity_type: string
  entity_id: string
  ref_id: string | null
  status: 'open' | 'answered' | 'closed' | 'expired'
  expires_at: string
  last_sent_at: string
  answered_at: string | null
  created_at: string
}

/**
 * auto: applied straight away when the reading is clear.
 * confirm: the customer is asked YES/NO first (destructive but theirs to make).
 * admin: an admin approves (money moves, or the customer asked for something new).
 */
export type Tier = 'auto' | 'confirm' | 'admin'

export interface IntentDef {
  /** What the customer means, for the reader. */
  describe: string
  tier: Tier | ((snapshot: any, args: any) => Tier)
  args?: z.ZodTypeAny
  /** "Approve switching X to Y?" — used for confirm cards and admin cards. */
  title: (snapshot: any, args: any) => string
  /** Nothing to run: the admin does it by hand and marks it handled. */
  manual?: boolean
}

export interface ExecResult {
  ok: boolean
  /** To the customer, in English (translated on the way out). */
  text: string
  /** Close the question: the decision is made. */
  close?: boolean
}

export interface ExecCtx {
  context: ReplyContextRow
  userId: string | null
  /** Set when an admin approved it. */
  adminId?: string | null
  /** What the customer wrote, as written. */
  text?: string
}

export interface Scenario<S = any> {
  key: ScenarioKey
  label: string
  /** The record as it is now, or null when there is nothing left to answer. */
  snapshot(ctx: ReplyContextRow): Promise<S | null>
  /** One paragraph the reader sees: what we asked and what the options mean. */
  describe(snapshot: S): string
  intents: Record<string, IntentDef>
  /** What a bare YES / NO means when the model is unavailable. */
  yes?: string
  no?: string
  execute(intent: string, args: any, snapshot: S, ctx: ExecCtx): Promise<ExecResult>
  /** Admin page for the record. */
  href(ctx: ReplyContextRow): string
  /** Write scope an admin needs to approve. */
  scope: string
}

export interface Reading {
  contextIndex: number | null
  intent: string
  args: Record<string, unknown>
  confidence: number
  reading: string
}
