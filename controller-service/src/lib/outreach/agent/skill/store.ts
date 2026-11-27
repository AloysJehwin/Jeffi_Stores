import { createHash } from 'node:crypto'
import { outreachPool } from '../../db'
import { recordEvent } from '../../events'
import type { OutreachContact } from '../../types'
import type { AgentRunRow, ParsedSkill, ResolvedSkill, SkillFlow, SkillMeta, SkillValidation } from '../types'
import { BUILTIN_SKILLS, DEFAULT_SKILL_SLUG } from './builtin'
import { parseSkill } from './parse'
import { validateSkill } from './validate'

export class SkillError extends Error {
  constructor(message: string, public status: number, public validation?: SkillValidation) {
    super(message)
  }
}

export interface SkillSummary {
  id: string
  slug: string
  title: string
  description: string | null
  current_version_id: string | null
  current_version: number | null
  flow: SkillFlow | null
  channels: string[]
  archived_at: string | null
  updated_at: string
  list_count: number
  is_default: boolean
}

export interface SkillVersionRow {
  id: string
  skill_id: string
  version: number
  content: string
  meta: SkillMeta | Record<string, never>
  sha256: string
  validation: SkillValidation | Record<string, never>
  source: 'upload' | 'builtin'
  created_by: string | null
  created_at: string
}

interface Actor {
  id: string | null
  label: string
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v))

const SUMMARY_SQL = `
  SELECT s.id, s.slug, s.title, s.description, s.current_version_id, s.archived_at, s.updated_at,
         v.version AS current_version, v.meta AS current_meta,
         (SELECT count(*)::int FROM outreach_lists l WHERE l.skill_id = s.id) AS list_count,
         COALESCE(ps.default_skill_id = s.id, false) AS is_default
    FROM outreach_skills s
    LEFT JOIN outreach_skill_versions v ON v.id = s.current_version_id
    LEFT JOIN outreach_program_state ps ON ps.program = s.program`

function toSummary(r: any): SkillSummary {
  const meta = (r.current_meta ?? {}) as Partial<SkillMeta>
  const channels: string[] = [...(meta.channels ?? [])]
  if (meta.tools?.follow_up?.length) channels.push('follow_up')
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description ?? null,
    current_version_id: r.current_version_id ?? null,
    current_version: r.current_version ?? null,
    flow: meta.flow ?? null,
    channels,
    archived_at: isoOrNull(r.archived_at),
    updated_at: iso(r.updated_at),
    list_count: Number(r.list_count ?? 0),
    is_default: !!r.is_default,
  }
}

function toVersion(r: any): SkillVersionRow {
  return { ...r, created_at: iso(r.created_at) }
}

export async function listSkills(opts: { tenantId?: string | null; program?: string; includeArchived?: boolean } = {}): Promise<SkillSummary[]> {
  const where = ['s.tenant_id IS NOT DISTINCT FROM $1::uuid']
  const params: unknown[] = [opts.tenantId ?? null]
  if (opts.program) {
    params.push(opts.program)
    where.push(`s.program = $${params.length}`)
  }
  if (!opts.includeArchived) where.push('s.archived_at IS NULL')
  const r = await outreachPool().query(`${SUMMARY_SQL} WHERE ${where.join(' AND ')} ORDER BY s.updated_at DESC`, params)
  return r.rows.map(toSummary)
}

async function getSummary(id: string): Promise<SkillSummary | null> {
  const r = await outreachPool().query(`${SUMMARY_SQL} WHERE s.id = $1`, [id])
  return r.rows[0] ? toSummary(r.rows[0]) : null
}

export async function getSkillDetail(id: string): Promise<{ skill: SkillSummary; versions: SkillVersionRow[]; lists: { id: string; name: string; pinned_version_id: string | null }[] } | null> {
  const skill = await getSummary(id)
  if (!skill) return null
  const pool = outreachPool()
  const [versions, lists] = await Promise.all([
    pool.query(`SELECT * FROM outreach_skill_versions WHERE skill_id = $1 ORDER BY version DESC`, [id]),
    pool.query(`SELECT id, name, skill_version_id AS pinned_version_id FROM outreach_lists WHERE skill_id = $1 ORDER BY name`, [id]),
  ])
  return { skill, versions: versions.rows.map(toVersion), lists: lists.rows }
}

/** Validation as stored on a version: the parsed skill is dropped (the content already holds it). */
const storable = (v: SkillValidation): SkillValidation => ({ ...v, skill: null })

function requireValid(v: SkillValidation): ParsedSkill {
  if (!v.ok || !v.skill) {
    const first = v.issues.find(i => i.level === 'error')
    throw new SkillError(first ? `${first.message}${first.line ? ` (line ${first.line})` : ''}` : 'The skill is not valid', 400, v)
  }
  return v.skill
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export async function createSkill(input: { tenantId: string | null; program: string; content: string; actor: Actor }): Promise<{ skill: SkillSummary; version: SkillVersionRow; validation: SkillValidation }> {
  const validation = validateSkill(input.content)
  const parsed = requireValid(validation)
  const { meta } = parsed
  const pool = outreachPool()
  let skillId: string
  try {
    const r = await pool.query(
      `INSERT INTO outreach_skills (tenant_id, program, slug, title, description, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [input.tenantId, input.program, meta.name, meta.title, meta.description, input.actor.id]
    )
    skillId = r.rows[0].id
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new SkillError(`A skill named "${meta.name}" already exists`, 409)
    throw e
  }
  const v = await pool.query(
    `INSERT INTO outreach_skill_versions (skill_id, version, content, meta, sha256, validation, source, created_by) VALUES ($1,1,$2,$3,$4,$5,'upload',$6) RETURNING *`,
    [skillId, input.content, JSON.stringify(meta), sha256(input.content), JSON.stringify(storable(validation)), input.actor.id]
  )
  const version = toVersion(v.rows[0])
  await pool.query(`UPDATE outreach_skills SET current_version_id = $2, updated_at = now() WHERE id = $1`, [skillId, version.id])
  await recordEvent(null, 'skill_created', { actor: input.actor.label, data: { skillId, slug: meta.name, versionId: version.id, version: 1 } })
  return { skill: (await getSummary(skillId))!, version, validation }
}

export async function addSkillVersion(skillId: string, content: string, actor: Actor): Promise<{ skill: SkillSummary; version: SkillVersionRow; validation: SkillValidation }> {
  const cur = await getSummary(skillId)
  if (!cur) throw new SkillError('Skill not found', 404)
  if (cur.archived_at) throw new SkillError('This skill is archived', 409)
  const validation = validateSkill(content)
  const { meta } = requireValid(validation)
  if (meta.name !== cur.slug) throw new SkillError(`This skill is named "${cur.slug}"; a new version must keep that name (the file says "${meta.name}")`, 400, validation)
  const pool = outreachPool()
  const v = await pool.query(
    `INSERT INTO outreach_skill_versions (skill_id, version, content, meta, sha256, validation, source, created_by)
     SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4, $5, 'upload', $6 FROM outreach_skill_versions WHERE skill_id = $1 RETURNING *`,
    [skillId, content, JSON.stringify(meta), sha256(content), JSON.stringify(storable(validation)), actor.id]
  )
  const version = toVersion(v.rows[0])
  await pool.query(`UPDATE outreach_skills SET current_version_id = $2, title = $3, description = $4, updated_at = now() WHERE id = $1`, [skillId, version.id, meta.title, meta.description])
  await recordEvent(null, 'skill_version_added', { actor: actor.label, data: { skillId, slug: cur.slug, versionId: version.id, version: version.version } })
  return { skill: (await getSummary(skillId))!, version, validation }
}

export async function updateSkill(id: string, patch: { title?: string; description?: string | null; current_version_id?: string }, actor: Actor): Promise<SkillSummary> {
  const cur = await getSummary(id)
  if (!cur) throw new SkillError('Skill not found', 404)
  const pool = outreachPool()
  if (patch.current_version_id) {
    const v = await pool.query(`SELECT id, version FROM outreach_skill_versions WHERE id = $1 AND skill_id = $2`, [patch.current_version_id, id])
    if (!v.rows[0]) throw new SkillError('That version does not belong to this skill', 400)
  }
  const sets: string[] = []
  const params: unknown[] = [id]
  const set = (col: string, v: unknown) => {
    params.push(v)
    sets.push(`${col} = $${params.length}`)
  }
  if (patch.title !== undefined) set('title', patch.title)
  if (patch.description !== undefined) set('description', patch.description)
  if (patch.current_version_id !== undefined) set('current_version_id', patch.current_version_id)
  if (!sets.length) return cur
  await pool.query(`UPDATE outreach_skills SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params)
  if (patch.current_version_id) await recordEvent(null, 'skill_current_set', { actor: actor.label, data: { skillId: id, slug: cur.slug, versionId: patch.current_version_id } })
  return (await getSummary(id))!
}

/** Archive: hidden from pickers and skipped by resolution. A program default pointing at it is cleared; runs keep their pinned version. */
export async function archiveSkill(id: string, actor: Actor): Promise<void> {
  const cur = await getSummary(id)
  if (!cur) throw new SkillError('Skill not found', 404)
  if (cur.archived_at) return
  const pool = outreachPool()
  await pool.query(`UPDATE outreach_skills SET archived_at = now(), updated_at = now() WHERE id = $1`, [id])
  await pool.query(`UPDATE outreach_program_state SET default_skill_id = NULL WHERE default_skill_id = $1`, [id])
  await recordEvent(null, 'skill_archived', { actor: actor.label, data: { skillId: id, slug: cur.slug } })
}

export async function getVersion(versionId: string): Promise<SkillVersionRow | null> {
  const r = await outreachPool().query(`SELECT * FROM outreach_skill_versions WHERE id = $1`, [versionId])
  return r.rows[0] ? toVersion(r.rows[0]) : null
}

// ---- resolution ----

const builtinCache = new Map<string, ResolvedSkill>()

/** A builtin skill, parsed. The default when the slug is omitted or unknown. */
export function builtinSkill(slug?: string): ResolvedSkill {
  const entry = BUILTIN_SKILLS.find(b => b.slug === slug) ?? BUILTIN_SKILLS.find(b => b.slug === DEFAULT_SKILL_SLUG)!
  const hit = builtinCache.get(entry.slug)
  if (hit) return hit
  const { skill } = parseSkill(entry.content, { builtin: true })
  if (!skill) throw new Error(`Builtin skill ${entry.slug} does not parse`)
  const out: ResolvedSkill = { skillId: null, versionId: null, version: 0, slug: entry.slug, ref: skill.meta.scriptVersion ?? `${entry.slug}@builtin`, builtin: true, skill }
  builtinCache.set(entry.slug, out)
  return out
}

interface VersionJoin {
  id: string
  skill_id: string
  version: number
  content: string
  slug: string
  archived_at: unknown
}

const VERSION_JOIN = `SELECT v.id, v.skill_id, v.version, v.content, s.slug, s.archived_at FROM outreach_skill_versions v JOIN outreach_skills s ON s.id = v.skill_id`

const resolved = (row: VersionJoin, skill: ParsedSkill): ResolvedSkill => ({ skillId: row.skill_id, versionId: row.id, version: row.version, slug: row.slug, ref: `${row.slug}@v${row.version}`, builtin: false, skill })

/** A stored version for a NEW run: skipped when its skill is archived or it no longer validates. */
async function usable(row: VersionJoin | undefined): Promise<ResolvedSkill | null> {
  if (!row || row.archived_at) return null
  const v = validateSkill(row.content)
  if (!v.ok || !v.skill) {
    console.warn(`[outreach] skill ${row.slug}@v${row.version} no longer validates; falling back`)
    return null
  }
  return resolved(row, v.skill)
}

const byVersion = async (id: string) => (await outreachPool().query(`${VERSION_JOIN} WHERE v.id = $1`, [id])).rows[0] as VersionJoin | undefined
const bySkill = async (id: string) => (await outreachPool().query(`${VERSION_JOIN} WHERE s.id = $1 AND v.id = s.current_version_id`, [id])).rows[0] as VersionJoin | undefined

/** The list's pinned version, else its skill's current version, else the program's default skill, else the builtin default. */
export async function resolveSkillForContact(contact: Pick<OutreachContact, 'list_id' | 'program'>): Promise<ResolvedSkill> {
  const pool = outreachPool()
  if (contact.list_id) {
    const l = (await pool.query(`SELECT skill_id, skill_version_id FROM outreach_lists WHERE id = $1`, [contact.list_id])).rows[0] as { skill_id: string | null; skill_version_id: string | null } | undefined
    if (l?.skill_version_id) {
      const hit = await usable(await byVersion(l.skill_version_id))
      if (hit) return hit
    }
    if (l?.skill_id) {
      const hit = await usable(await bySkill(l.skill_id))
      if (hit) return hit
    }
  }
  const p = (await pool.query(`SELECT default_skill_id FROM outreach_program_state WHERE program = $1`, [contact.program])).rows[0] as { default_skill_id: string | null } | undefined
  if (p?.default_skill_id) {
    const hit = await usable(await bySkill(p.default_skill_id))
    if (hit) return hit
  }
  return builtinSkill()
}

/** The skill a run pinned: its version row, or (no version id) the builtin named by the ref. */
export async function loadRunSkill(run: Pick<AgentRunRow, 'skill_version_id' | 'skill_ref'>): Promise<ResolvedSkill> {
  if (run.skill_version_id) {
    const row = await byVersion(run.skill_version_id)
    if (row) {
      // a pinned run keeps its playbook even if the rules tightened since: only an unparsable file falls back
      const skill = validateSkill(row.content).skill
      if (skill) return resolved(row, skill)
      console.warn(`[outreach] pinned skill ${row.slug}@v${row.version} does not parse; using the builtin`)
    }
  }
  return builtinSkill(run.skill_ref.split(/[/@]/)[0])
}
