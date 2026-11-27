'use client'

import { Badge } from '@/components/admin/kit/core'
import { CHANNEL_LABEL, FLOW_LABEL, LANGUAGE_LABEL, type SkillValidation } from './shared'

const ICON_ERR = 'text-red-600 dark:text-red-400'
const ICON_WARN = 'text-amber-700 dark:text-amber-400'

export function Issues({ validation }: { validation: SkillValidation }) {
  if (!validation.issues.length) return null
  return (
    <ul className="space-y-1 text-sm" aria-label="Validation issues">
      {validation.issues.map((i, n) => (
        <li key={`${i.code}-${n}`} className={i.level === 'error' ? ICON_ERR : ICON_WARN}>
          <span className="font-medium">{i.level === 'error' ? 'Error' : 'Warning'}</span>
          {i.line ? <span className="tabular-nums"> (line {i.line})</span> : null}: {i.message}
        </li>
      ))}
    </ul>
  )
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex gap-2 text-sm">
    <dt className="w-24 shrink-0 text-xs text-foreground-muted pt-0.5">{label}</dt>
    <dd className="min-w-0 text-foreground break-words">{children}</dd>
  </div>
)

/** Parsed metadata and the tools per channel, with unknown tool names flagged. */
export function ParsedMeta({ validation }: { validation: SkillValidation }) {
  const skill = validation.skill
  if (!skill) return null
  const m = skill.meta
  const byName = new Map(validation.tools.map(t => [t.name, t]))
  const limits = Object.entries(m.limits ?? {})
  return (
    <div className="space-y-3">
      <dl className="space-y-1">
        <Row label="Name">
          <span className="font-mono text-xs">{m.name}</span>
        </Row>
        <Row label="Title">{m.title}</Row>
        <Row label="Flow">{FLOW_LABEL[m.flow] ?? m.flow}</Row>
        <Row label="Channels">{m.channels.map(c => CHANNEL_LABEL[c] ?? c).join(', ') || '-'}</Row>
        <Row label="Languages">{m.languages.map(l => LANGUAGE_LABEL[l] ?? l).join(', ') || '-'} (default {LANGUAGE_LABEL[m.defaultLanguage] ?? m.defaultLanguage})</Row>
        <Row label="Persona">{Object.entries(m.persona ?? {}).map(([l, n]) => `${LANGUAGE_LABEL[l] ?? l}: ${n}`).join(', ') || 'Default names'}</Row>
        <Row label="Tone">{m.tone || '-'}</Row>
        <Row label="Limits">{limits.length ? limits.map(([k, v]) => `${k}: ${v}`).join(', ') : 'Hard limits only'}</Row>
      </dl>
      <div>
        <div className="text-xs text-foreground-muted mb-1">Tools per channel</div>
        <div className="space-y-1.5">
          {(['voice', 'whatsapp', 'follow_up'] as const).map(ch => {
            const names = m.tools?.[ch] ?? []
            return (
              <div key={ch} className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="w-20 shrink-0 text-xs text-foreground-muted">{CHANNEL_LABEL[ch]}</span>
                {names.length ? (
                  names.map(n => {
                    const t = byName.get(n)
                    return (
                      <span key={n} title={t && !t.known ? 'Unknown tool: it is ignored' : t ? `Runs on ${t.channels.join(', ')}` : undefined}>
                        <Badge tone={t && !t.known ? 'red' : 'muted'}>{t && !t.known ? `${n} (unknown)` : n}</Badge>
                      </span>
                    )
                  })
                ) : (
                  <span className="text-xs text-foreground-muted">none listed</span>
                )}
              </div>
            )
          })}
          <p className="text-xs text-foreground-muted">Mandatory tools (optOut, handOff) are always added.</p>
        </div>
      </div>
    </div>
  )
}

export function ValidationSummary({ validation, checking, error }: { validation: SkillValidation | null; checking: boolean; error?: string | null }) {
  if (error) return <p className={`text-sm ${ICON_ERR}`}>{error}</p>
  if (!validation) return <p className="text-sm text-foreground-muted">{checking ? 'Checking…' : 'Paste or upload a skill file to check it.'}</p>
  const errors = validation.issues.filter(i => i.level === 'error').length
  const warns = validation.issues.length - errors
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={validation.ok ? 'green' : 'red'}>{validation.ok ? 'Valid' : 'Has errors'}</Badge>
        {errors > 0 && <Badge tone="red">{`${errors} error${errors === 1 ? '' : 's'}`}</Badge>}
        {warns > 0 && <Badge tone="amber">{`${warns} warning${warns === 1 ? '' : 's'}`}</Badge>}
        {checking && <span className="text-xs text-foreground-muted">Checking…</span>}
      </div>
      <Issues validation={validation} />
      <ParsedMeta validation={validation} />
    </div>
  )
}
