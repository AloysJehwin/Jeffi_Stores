'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, Badge, btnPrimary, inputCls, Kpi, KpiGrid } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import { useActionToast } from '@/components/admin/kit/toast'
import { LANGUAGES, type OutreachProgramState } from '@controller/lib/outreach/types'
import { API, BASE, isE164, LANGUAGE_LABEL, STATUS_LABEL, type SkillSummary } from './shared'

type View = { program: { key: string; title: string }; state: OutreachProgramState; counts: Record<string, number> }

const MAX_TEST_NUMBERS = 10
const parseNumbers = (s: string) => s.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)

export default function OutreachProgramClient() {
  const canWrite = useCanWrite('ecom_outreach:write')
  const toast = useActionToast()
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ daily_cap: 0, concurrency: 1, window_start: '09:30', window_end: '20:30', numbers: '' })
  const [testPhone, setTestPhone] = useState('')
  const [testLang, setTestLang] = useState('en')
  const [calling, setCalling] = useState(false)
  const [callId, setCallId] = useState<string | null>(null)
  const [skills, setSkills] = useState<SkillSummary[]>([])

  const apply = useCallback((v: View) => {
    setView(v)
    const s = v.state
    setForm({ daily_cap: s.daily_cap, concurrency: s.concurrency, window_start: s.window_start, window_end: s.window_end, numbers: s.test_numbers.join('\n') })
    setTestPhone(p => (s.test_numbers.includes(p) ? p : s.test_numbers[0] ?? ''))
  }, [])

  useEffect(() => {
    api<View>(`${API}/program`).then(({ ok, data }) => (ok ? apply(data) : setError(data.error || 'Could not load the program')))
  }, [apply])
  useEffect(() => {
    api<{ skills: SkillSummary[] }>(`${API}/skills?program=showcase-offer`).then(({ ok, data }) => ok && setSkills(data.skills.filter(s => !s.archived_at && s.audience !== 'shopper')))
  }, [])

  async function patch(body: Record<string, unknown>, done: string) {
    setSaving(true)
    const { ok, data } = await api<{ state: OutreachProgramState }>(`${API}/program`, { method: 'PATCH', json: body })
    setSaving(false)
    if (!ok) return toast.error(data.error || 'Could not save')
    toast.success(done)
    if (view) apply({ ...view, state: data.state })
  }

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!view) return <div className="h-48 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />
  const { state, counts } = view
  const numbers = parseNumbers(form.numbers)
  const badNumber = numbers.find(n => !isE164(n))
  const numbersError = badNumber ? `${badNumber} is not in E.164 form (+919876543210)` : numbers.length > MAX_TEST_NUMBERS ? `At most ${MAX_TEST_NUMBERS} test numbers` : null

  async function testCall() {
    setCalling(true)
    setCallId(null)
    const { ok, data } = await api<{ callId: string }>(`${API}/test-call`, { method: 'POST', json: { phone: testPhone, language: testLang } })
    setCalling(false)
    if (!ok) return toast.error(data.error || 'Could not start the test call')
    setCallId(data.callId)
    toast.success('Test call requested')
  }

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Status" value={state.enabled ? 'Enabled' : 'Disabled'} />
        <Kpi label="Daily cap" value={String(state.daily_cap)} />
        <Kpi label="Queued" value={String(counts.queued ?? 0)} />
        <Kpi label="Interested" value={String(counts.interested ?? 0)} />
      </KpiGrid>

      <Card
        title={view.program.title}
        hint={`Calls run ${state.window_start}-${state.window_end} IST at most 09:30-20:30, three attempts per contact, never on DND or suppressed numbers.`}
        action={
          <button type="button" className={btnPrimary} disabled={!canWrite || saving} onClick={() => patch({ enabled: !state.enabled }, state.enabled ? 'Program disabled' : 'Program enabled')}>
            {state.enabled ? 'Disable' : 'Enable'}
          </button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs text-foreground-muted space-y-1">
            Daily cap
            <input type="number" min={0} max={5000} className={inputCls} value={form.daily_cap} disabled={!canWrite} onChange={e => setForm({ ...form, daily_cap: Number(e.target.value) })} />
          </label>
          <label className="text-xs text-foreground-muted space-y-1">
            Concurrency
            <input type="number" min={1} max={20} className={inputCls} value={form.concurrency} disabled={!canWrite} onChange={e => setForm({ ...form, concurrency: Number(e.target.value) })} />
          </label>
          <label className="text-xs text-foreground-muted space-y-1">
            Window start (IST)
            <input type="time" className={inputCls} value={form.window_start} disabled={!canWrite} onChange={e => setForm({ ...form, window_start: e.target.value })} />
          </label>
          <label className="text-xs text-foreground-muted space-y-1">
            Window end (IST)
            <input type="time" className={inputCls} value={form.window_end} disabled={!canWrite} onChange={e => setForm({ ...form, window_end: e.target.value })} />
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className={btnPrimary}
            disabled={!canWrite || saving}
            onClick={() => patch({ daily_cap: form.daily_cap, concurrency: form.concurrency, window_start: form.window_start, window_end: form.window_end }, 'Settings saved')}
          >
            Save settings
          </button>
        </div>
      </Card>

      <Card title="Default agent" hint="What the agent follows for contacts whose list has no agent of its own. Applies to new runs; calls in progress keep theirs.">
        <label className="text-xs text-foreground-muted space-y-1 block sm:w-96">
          Default agent
          <select aria-label="Default agent" className={inputCls} value={state.default_skill_id ?? ''} disabled={!canWrite || saving} onChange={e => patch({ default_skill_id: e.target.value || null }, 'Default agent saved')}>
            <option value="">Builtin: Showcase offer (default)</option>
            {state.default_skill_id && !skills.some(s => s.id === state.default_skill_id) && <option value={state.default_skill_id}>Archived agent</option>}
            {skills.map(s => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </label>
      </Card>

      <Card title="Test numbers" hint="Only these numbers can receive a test call. One per line, E.164.">
        <textarea
          aria-label="Test numbers"
          rows={3}
          className={inputCls}
          value={form.numbers}
          disabled={!canWrite}
          onChange={e => setForm({ ...form, numbers: e.target.value })}
        />
        {numbersError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{numbersError}</p>}
        <div className="mt-3 flex justify-end">
          <button type="button" className={btnPrimary} disabled={!canWrite || saving || !!numbersError} onClick={() => patch({ test_numbers: numbers }, 'Test numbers saved')}>
            Save numbers
          </button>
        </div>
      </Card>

      <Card title="Test call" hint="Dials one of your test numbers with the live caller, in the language you pick.">
        {!state.test_numbers.length ? (
          <p className="text-sm text-foreground-muted">Add a test number above first.</p>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <label className="text-xs text-foreground-muted space-y-1 sm:w-56">
              Number
              <select className={inputCls} value={testPhone} onChange={e => setTestPhone(e.target.value)}>
                {state.test_numbers.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-foreground-muted space-y-1 sm:w-44">
              Language
              <select className={inputCls} value={testLang} onChange={e => setTestLang(e.target.value)}>
                {LANGUAGES.map(l => (
                  <option key={l} value={l}>{LANGUAGE_LABEL[l]}</option>
                ))}
              </select>
            </label>
            <button type="button" className={btnPrimary} disabled={!canWrite || calling || !testPhone} onClick={testCall}>
              {calling ? 'Calling…' : 'Test call'}
            </button>
            {callId && (
              <Link href={`${BASE}/calls/${callId}`} className="text-sm text-accent-500 hover:underline">
                View call
              </Link>
            )}
          </div>
        )}
      </Card>

      <Card title="Contacts by status">
        <div className="flex flex-wrap gap-2">
          {Object.entries(counts).length ? (
            Object.entries(counts).map(([s, n]) => (
              <Link key={s} href={`${BASE}?tab=contacts&status=${s}`}>
                <Badge>{`${STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? s}: ${n}`}</Badge>
              </Link>
            ))
          ) : (
            <p className="text-sm text-foreground-muted">No contacts yet. Import a list.</p>
          )}
        </div>
      </Card>
    </div>
  )
}
