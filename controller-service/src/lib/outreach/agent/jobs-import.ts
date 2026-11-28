import { columnKey, ImportError, parseTableFile } from '../import'
import { createJob } from './jobs'
import { getAgent } from './skill/store'

// CSV / XLSX rows as jobs (docs/plans/OUTREACH_AGENTS.md §3): a mapping says which column fills which input.

export const MAX_JOB_ROWS = 2000
const CONCURRENCY = 5

export interface JobImportResult {
  created: number
  duplicates: number
  failed: { row: number; errors: string[] }[]
}

/** `mapping` is { <inputName>: <column header> }; a row that fails the agent's input schema is reported, not imported. */
export async function importJobs(input: {
  skillId: string
  fileName: string
  buf: Buffer
  mapping: Record<string, string>
  actor: { id: string | null; label: string }
}): Promise<JobImportResult> {
  const agent = await getAgent(input.skillId)
  if (!agent) throw new ImportError('Agent not found', 404)
  const spec = agent.resolved.skill.meta.inputs
  for (const name of Object.keys(input.mapping)) if (!spec[name]) throw new ImportError(`"${name}" is not an input of this agent`)
  for (const [name, s] of Object.entries(spec)) if (s.required && !input.mapping[name]) throw new ImportError(`Map a column to the required input "${name}"`)

  const table = parseTableFile(input.buf, input.fileName)
  if (table.fatal) throw new ImportError(table.fatal)
  if (table.rows.length > MAX_JOB_ROWS) throw new ImportError(`Too many rows (${table.rows.length}). Import at most ${MAX_JOB_ROWS} jobs at a time.`)
  const columns = Object.fromEntries(Object.entries(input.mapping).map(([name, header]) => [name, columnKey(header)]))
  for (const [name, key] of Object.entries(columns)) if (!table.headers.includes(key)) throw new ImportError(`The file has no column "${input.mapping[name]}" (mapped to ${name})`)

  const out: JobImportResult = { created: 0, duplicates: 0, failed: [] }
  const rows = table.rows
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(
      rows.slice(i, i + CONCURRENCY).map(async ({ row, values }) => {
        const raw = Object.fromEntries(Object.entries(columns).map(([name, key]) => [name, values[key]]))
        try {
          const r = await createJob({ skillId: input.skillId, inputs: raw, source: 'csv', actor: input.actor })
          if (r.errors.length || !r.job) out.failed.push({ row, errors: r.errors.length ? r.errors : ['Could not create the job'] })
          else if (r.created) out.created++
          else out.duplicates++
        } catch (e) {
          out.failed.push({ row, errors: [e instanceof Error ? e.message : 'failed'] })
        }
      })
    )
  }
  out.failed.sort((a, b) => a.row - b.row)
  return out
}
