import { outreachPool } from './db'
import { recordEvent } from './events'
import { normalizePhone } from './phone'
import { getProgram } from './programs/_registry'
import type { OutreachProgramState } from './types'

// Compliance bounds (calls only 09:30-20:30 IST) are enforced here, not just defaulted.
export const WINDOW_MIN = '09:30'
export const WINDOW_MAX = '20:30'

export class ProgramStateError extends Error {}

const hhmm = (t: string) => String(t).slice(0, 5)

const COLS = `program, enabled, daily_cap, concurrency, to_char(window_start, 'HH24:MI') AS window_start, to_char(window_end, 'HH24:MI') AS window_end, test_numbers, updated_at, updated_by`

/** The program's state row, created from the registry defaults on first read. */
export async function getProgramState(program: string): Promise<OutreachProgramState> {
  const def = getProgram(program)
  if (!def) throw new ProgramStateError(`Unknown program: ${program}`)
  const pool = outreachPool()
  await pool.query(
    `INSERT INTO outreach_program_state (program, daily_cap, concurrency, window_start, window_end) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (program) DO NOTHING`,
    [program, def.defaultDailyCap, def.defaultConcurrency, def.defaultWindow.start, def.defaultWindow.end]
  )
  const r = await pool.query(`SELECT ${COLS} FROM outreach_program_state WHERE program = $1`, [program])
  return r.rows[0]
}

export interface ProgramStatePatch {
  enabled?: boolean
  daily_cap?: number
  concurrency?: number
  window_start?: string
  window_end?: string
  test_numbers?: string[]
}

export async function updateProgramState(program: string, patch: ProgramStatePatch, actor: { id: string | null; label: string }): Promise<OutreachProgramState> {
  const cur = await getProgramState(program)
  const start = hhmm(patch.window_start ?? cur.window_start)
  const end = hhmm(patch.window_end ?? cur.window_end)
  if (start < WINDOW_MIN || end > WINDOW_MAX || start >= end) {
    throw new ProgramStateError(`The calling window must sit inside ${WINDOW_MIN}-${WINDOW_MAX} IST and start before it ends`)
  }
  let tests: string[] | undefined
  if (patch.test_numbers) {
    tests = []
    for (const raw of patch.test_numbers) {
      const p = normalizePhone(raw)
      if (!p) throw new ProgramStateError(`Not a valid Indian mobile number: ${raw}`)
      if (!tests.includes(p)) tests.push(p)
    }
  }
  const sets: string[] = []
  const params: unknown[] = [program]
  const set = (col: string, v: unknown) => {
    params.push(v)
    sets.push(`${col} = $${params.length}`)
  }
  if (patch.enabled !== undefined) set('enabled', patch.enabled)
  if (patch.daily_cap !== undefined) set('daily_cap', patch.daily_cap)
  if (patch.concurrency !== undefined) set('concurrency', patch.concurrency)
  if (patch.window_start !== undefined) set('window_start', start)
  if (patch.window_end !== undefined) set('window_end', end)
  if (tests) set('test_numbers', tests)
  if (!sets.length) return cur
  set('updated_by', actor.id)
  const r = await outreachPool().query(
    `UPDATE outreach_program_state SET ${sets.join(', ')}, updated_at = now() WHERE program = $1 RETURNING ${COLS}`,
    params
  )
  await recordEvent(null, 'program_updated', { actor: actor.label, data: { program, patch: { ...patch, test_numbers: tests } } })
  return r.rows[0]
}
