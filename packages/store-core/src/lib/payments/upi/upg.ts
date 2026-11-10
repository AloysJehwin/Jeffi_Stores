import 'server-only'
import { INTENT_COLS, normIntent, storeDb, type UpiDb, type UpiIntent } from './intents'
import { LATE_ALERT_MS, upgPaySeconds, upgVerifySeconds, type UpgSlot } from './upg-logic'

/**
 * UPG sessions and bank observations in SQL (docs/plans/UPI_UPG_V2.md §2–3). Each step is one
 * statement; the partial unique index on (receiving_vpa) WHERE active|processing makes promotion
 * atomic — a racing promotion loses on the index and is a no-op.
 */

const one = async (db: UpiDb, t: string, p?: any[]) => (await db.query(t, p)).rows[0] ?? null
const isUniqueViolation = (e: any) => e?.code === '23505'

/** Applies due timers on a UPI ID (active → expired, processing → failed) and activates the next in line. */
export async function advanceVpa(vpa: string | null | undefined, db: UpiDb = storeDb): Promise<UpiIntent | null> {
  if (!vpa) return null
  await db.query(
    `UPDATE upi_payment_intents
        SET status = CASE WHEN status = 'active' THEN 'expired' ELSE 'failed' END,
            error_code = CASE WHEN status = 'active' THEN 'pay_window_elapsed' ELSE 'payment_not_seen' END, updated_at = NOW()
      WHERE receiving_vpa = $1 AND provider = 'upg'
        AND ((status = 'active' AND pay_expires_at <= NOW()) OR (status = 'processing' AND verify_expires_at <= NOW()))`,
    [vpa]
  )
  return promoteNext(vpa, db)
}

/** FIFO: the earliest queued intent takes the slot when nobody holds it. */
export async function promoteNext(vpa: string, db: UpiDb = storeDb): Promise<UpiIntent | null> {
  try {
    return normIntent(
      await one(
        db,
        `UPDATE upi_payment_intents
            SET status = 'active', active_at = NOW(), pay_expires_at = NOW() + make_interval(secs => $2::int), updated_at = NOW()
          WHERE id = (SELECT id FROM upi_payment_intents WHERE receiving_vpa = $1 AND status = 'queued'
                       ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
            AND NOT EXISTS (SELECT 1 FROM upi_payment_intents WHERE receiving_vpa = $1 AND status IN ('active', 'processing'))
          RETURNING ${INTENT_COLS}`,
        [vpa, upgPaySeconds()]
      )
    )
  } catch (e) {
    if (isUniqueViolation(e)) return null
    throw e
  }
}

/** The DB clock and, for a queued intent, how many are ahead of it. */
export async function queueState(intent: UpiIntent, db: UpiDb = storeDb): Promise<{ serverNow: string; queuePosition: number | null }> {
  const r = await one(
    db,
    `SELECT NOW() AS now, (SELECT count(*) FROM upi_payment_intents q
                            WHERE q.receiving_vpa = $1 AND q.status = 'queued' AND (q.created_at, q.id) < ($2::timestamptz, $3::uuid))::int AS ahead`,
    [intent.receiving_vpa, intent.created_at, intent.id]
  )
  return { serverNow: new Date(r?.now ?? Date.now()).toISOString(), queuePosition: intent.status === 'queued' ? 1 + Number(r?.ahead ?? 0) : null }
}

/** "Payment done — check my payment": active → processing for the verify window. */
export async function markProcessing(id: string, db: UpiDb = storeDb): Promise<UpiIntent | null> {
  return normIntent(
    await one(
      db,
      `UPDATE upi_payment_intents SET status = 'processing', processing_at = NOW(), verify_expires_at = NOW() + make_interval(secs => $2::int), updated_at = NOW()
        WHERE id = $1 AND provider = 'upg' AND status = 'active' AND pay_expires_at > NOW() RETURNING ${INTENT_COLS}`,
      [id, upgVerifySeconds()]
    )
  )
}

export async function markCancelled(id: string, db: UpiDb = storeDb): Promise<UpiIntent | null> {
  return normIntent(
    await one(
      db,
      `UPDATE upi_payment_intents SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND provider = 'upg' AND status IN ('queued', 'active') RETURNING ${INTENT_COLS}`,
      [id]
    )
  )
}

// ── bank observations ──────────────────────────────────────────────────────────────────────────────

export interface UpiObservation {
  id: string
  kind: 'credit' | 'gmail_forwarding'
  receiving_vpa: string | null
  amount_paise: number | null
  utr: string | null
  sender_vpa: string | null
  bank_domain: string | null
  ses_message_id: string | null
  message_id: string | null
  fingerprint: string
  trusted: boolean
  subject: string | null
  details: Record<string, any> | null
  observed_at: string
  matched_intent_id: string | null
  created_at: string
}

const OBS_COLS = `id, kind, receiving_vpa, amount_paise::bigint AS amount_paise, utr, sender_vpa, bank_domain, ses_message_id, message_id, fingerprint,
  trusted, subject, details, observed_at, matched_intent_id, created_at`
const normObs = (r: any): UpiObservation | null => (r ? { ...r, amount_paise: r.amount_paise == null ? null : Number(r.amount_paise) } : null)

export interface NewObservation {
  kind?: 'credit' | 'gmail_forwarding'
  receivingVpa: string | null
  amountPaise: number | null
  utr: string | null
  senderVpa?: string | null
  bankDomain?: string | null
  sesMessageId?: string | null
  messageId?: string | null
  fingerprint: string
  trusted: boolean
  subject?: string | null
  details?: Record<string, unknown> | null
  observedAt?: Date
}

/** Null when this credit was already recorded (same fingerprint or UTR). A trusted copy upgrades an untrusted one. */
export async function insertObservation(o: NewObservation, db: UpiDb = storeDb): Promise<UpiObservation | null> {
  try {
    const row = await one(
      db,
      `INSERT INTO upi_bank_observations (kind, receiving_vpa, amount_paise, utr, sender_vpa, bank_domain, ses_message_id, message_id, fingerprint, trusted, subject, details, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
       ON CONFLICT (fingerprint) DO UPDATE SET trusted = true, bank_domain = EXCLUDED.bank_domain
         WHERE upi_bank_observations.trusted = false AND EXCLUDED.trusted = true AND upi_bank_observations.matched_intent_id IS NULL
       RETURNING ${OBS_COLS}`,
      [o.kind ?? 'credit', o.receivingVpa, o.amountPaise, o.utr, o.senderVpa ?? null, o.bankDomain ?? null, o.sesMessageId ?? null, o.messageId ?? null, o.fingerprint, o.trusted,
        (o.subject ?? '').slice(0, 300) || null, o.details ? JSON.stringify(o.details) : null, o.observedAt ?? new Date()]
    )
    return normObs(row)
  } catch (e) {
    if (isUniqueViolation(e)) return null
    throw e
  }
}

/** Claims an observation for an intent; false when another intent already took it. */
export async function claimObservation(observationId: string, intentId: string, db: UpiDb = storeDb): Promise<boolean> {
  const r = await db.query(`UPDATE upi_bank_observations SET matched_intent_id = $2 WHERE id = $1 AND (matched_intent_id IS NULL OR matched_intent_id = $2)`, [observationId, intentId])
  return (r.rowCount ?? 0) > 0
}

export async function releaseObservation(observationId: string, intentId: string, db: UpiDb = storeDb): Promise<void> {
  await db.query(`UPDATE upi_bank_observations SET matched_intent_id = NULL WHERE id = $1 AND matched_intent_id = $2`, [observationId, intentId])
}

/** An unclaimed trusted credit with this UTR on the UPI ID (the UTR fallback's shortcut). */
export async function trustedObservationByUtr(vpa: string, utr: string, db: UpiDb = storeDb): Promise<UpiObservation | null> {
  return normObs(
    await one(db, `SELECT ${OBS_COLS} FROM upi_bank_observations WHERE kind = 'credit' AND trusted AND matched_intent_id IS NULL AND receiving_vpa = $1 AND upper(utr) = upper($2) LIMIT 1`, [vpa, utr])
  )
}

/** The intents an alert on this UPI ID could pay: everything open, and what ended inside the late-alert window. */
export async function alertCandidates(vpa: string, db: UpiDb = storeDb): Promise<UpgSlot[]> {
  const { rows } = await db.query(
    `SELECT id, status, amount_paise::bigint AS amount_paise, receiving_vpa, created_at, active_at, pay_expires_at, verify_expires_at
       FROM upi_payment_intents
      WHERE receiving_vpa = $1 AND provider = 'upg'
        AND (status IN ('queued', 'active', 'processing')
             OR (status IN ('failed', 'expired') AND updated_at > NOW() - make_interval(secs => $2::int)))`,
    [vpa, Math.round(LATE_ALERT_MS / 1000) + 600]
  )
  return rows.map((r: any) => ({ ...r, amount_paise: Number(r.amount_paise) }))
}

/** An intent waiting on staff whose customer-entered UTR is this one. */
export async function awaitingIntentByUtr(vpa: string, utr: string, amountPaise: number, db: UpiDb = storeDb): Promise<UpiIntent | null> {
  return normIntent(
    await one(
      db,
      `SELECT ${INTENT_COLS} FROM upi_payment_intents
        WHERE receiving_vpa = $1 AND provider = 'upg' AND status = 'awaiting_confirmation' AND upper(utr) = upper($2) AND amount_paise = $3 LIMIT 1`,
      [vpa, utr, amountPaise]
    )
  )
}

/** Untrusted or unmatched credits of the same amount around an intent: what staff see beside a UTR to approve. */
export async function observationSuggestions(intents: Array<{ id: string; receiving_vpa: string | null; amount_paise: number; utr: string | null }>, db: UpiDb = storeDb): Promise<Map<string, UpiObservation[]>> {
  const out = new Map<string, UpiObservation[]>()
  const wanted = intents.filter(i => i.receiving_vpa)
  if (!wanted.length) return out
  const { rows } = await db.query(
    `SELECT ${OBS_COLS} FROM upi_bank_observations
      WHERE kind = 'credit' AND matched_intent_id IS NULL AND receiving_vpa = ANY($1::text[]) AND observed_at > NOW() - INTERVAL '3 days'
      ORDER BY observed_at DESC LIMIT 500`,
    [[...new Set(wanted.map(i => i.receiving_vpa))]]
  )
  const obs = rows.map((r: any) => normObs(r)!)
  for (const i of wanted) {
    const hits = obs.filter((o: UpiObservation) => o.receiving_vpa === i.receiving_vpa && (o.amount_paise === i.amount_paise || (!!i.utr && !!o.utr && o.utr.toUpperCase() === i.utr.toUpperCase())))
    if (hits.length) out.set(i.id, hits.slice(0, 5))
  }
  return out
}

/** What Site Controls shows about a UPI ID's bank alerts. */
export async function alertStats(vpa: string | null, db: UpiDb = storeDb): Promise<{ lastAlertAt: string | null; trustedCount30d: number; gmailConfirmation: { code: string | null; link: string | null; at: string } | null }> {
  const [stats, gmail] = await Promise.all([
    vpa
      ? one(db, `SELECT max(observed_at) FILTER (WHERE trusted) AS last, count(*) FILTER (WHERE trusted AND observed_at > NOW() - INTERVAL '30 days')::int AS n
                   FROM upi_bank_observations WHERE kind = 'credit' AND receiving_vpa = $1`, [vpa])
      : null,
    one(db, `SELECT details, observed_at FROM upi_bank_observations WHERE kind = 'gmail_forwarding' ORDER BY observed_at DESC LIMIT 1`),
  ])
  return {
    lastAlertAt: stats?.last ? new Date(stats.last).toISOString() : null,
    trustedCount30d: Number(stats?.n ?? 0),
    gmailConfirmation: gmail ? { code: gmail.details?.code ?? null, link: gmail.details?.link ?? null, at: new Date(gmail.observed_at).toISOString() } : null,
  }
}

/** UPI IDs with someone in line or paying, for the sweep. */
export async function openVpas(db: UpiDb = storeDb): Promise<string[]> {
  const { rows } = await db.query(`SELECT DISTINCT receiving_vpa FROM upi_payment_intents WHERE provider = 'upg' AND status IN ('queued', 'active', 'processing') AND receiving_vpa IS NOT NULL`)
  return rows.map((r: any) => r.receiving_vpa)
}

/** Queued intents nobody is waiting on any more. */
export async function expireStaleQueued(olderThanSec: number, db: UpiDb = storeDb): Promise<number> {
  const r = await db.query(
    `UPDATE upi_payment_intents SET status = 'expired', error_code = 'queue_abandoned', updated_at = NOW()
      WHERE provider = 'upg' AND status = 'queued' AND created_at < NOW() - make_interval(secs => $1::int)`,
    [olderThanSec]
  )
  return r.rowCount ?? 0
}

/** Completed UPG intents whose payment was never applied (the apply threw): the sweep retries them. */
export async function unappliedUpgIntents(db: UpiDb = storeDb): Promise<UpiIntent[]> {
  const { rows } = await db.query(
    `SELECT ${INTENT_COLS} FROM upi_payment_intents
      WHERE provider = 'upg' AND status = 'completed' AND result IS NULL AND error_code LIKE 'apply_failed%' AND updated_at > NOW() - INTERVAL '2 days' LIMIT 50`
  )
  return rows.map((r: any) => normIntent(r)!)
}
