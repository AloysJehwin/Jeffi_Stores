'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import DatePicker from '@/components/ui/DatePicker'
import { isValidDob } from '@/lib/shared/format'

type Stage = 'loading' | 'form' | 'saved' | 'already' | 'error'

const CARD = 'bg-surface-elevated rounded-2xl shadow-sm border border-border-default p-6 sm:p-8 max-w-sm w-full text-center'

export default function BirthdayPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const [stage, setStage] = useState<Stage>('loading')
  const [error, setError] = useState('')
  const [firstName, setFirstName] = useState<string | null>(null)
  const [dob, setDob] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('This link is missing its code.')
      setStage('error')
      return
    }
    fetch(`/api/user/birthday?token=${encodeURIComponent(token)}`)
      .then(async res => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error || 'This link is no longer valid.')
        setFirstName(body.firstName)
        setStage(body.alreadySet ? 'already' : 'form')
      })
      .catch(err => {
        setError(err.message)
        setStage('error')
      })
  }, [token])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidDob(dob) || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/user/birthday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, dateOfBirth: dob }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error || 'Could not save your birthday.')
        return
      }
      setStage(body.alreadySet ? 'already' : 'saved')
    } catch {
      setError('Could not save your birthday.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      {stage === 'loading' ? (
        <div className={`${CARD} animate-pulse`}>
          <div className="h-10 w-10 mx-auto rounded-full bg-surface-secondary" />
          <div className="mt-4 h-5 rounded bg-surface-secondary" />
          <div className="mt-2 h-4 rounded bg-surface-secondary" />
        </div>
      ) : stage === 'error' ? (
        <div className={CARD}>
          <p className="text-4xl">🎂</p>
          <h1 className="mt-3 font-semibold text-foreground">This link has expired</h1>
          <p className="mt-2 text-sm text-foreground-secondary">{error}</p>
          <Link href="/account" className="mt-5 inline-block text-sm font-medium text-accent-600 hover:text-accent-700">
            Add it from my account
          </Link>
        </div>
      ) : stage === 'saved' || stage === 'already' ? (
        <div className={CARD}>
          <p className="text-4xl">🎉</p>
          <h1 className="mt-3 font-semibold text-foreground">
            {stage === 'saved' ? 'Thank you!' : 'You are all set'}
          </h1>
          <p className="mt-2 text-sm text-foreground-secondary">
            {stage === 'saved'
              ? 'We have your birthday. Look out for a treat from us when it comes around.'
              : 'Your birthday is already saved. You can change it from your account.'}
          </p>
          <Link
            href="/"
            className="mt-5 inline-block px-4 py-2 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600"
          >
            Continue shopping
          </Link>
        </div>
      ) : (
        <form onSubmit={save} className={CARD}>
          <p className="text-4xl">🎂</p>
          <h1 className="mt-3 font-semibold text-foreground">
            {firstName ? `When is your birthday, ${firstName}?` : 'When is your birthday?'}
          </h1>
          <p className="mt-2 text-sm text-foreground-secondary">
            Tell us once and we will send you a birthday treat every year.
          </p>
          <div className="mt-5 text-left">
            <label className="block text-xs font-medium text-foreground-secondary mb-1">Date of birth</label>
            <DatePicker
              value={dob}
              onChange={val => {
                setDob(val)
                setError('')
              }}
              max={new Date().toISOString().slice(0, 10)}
              placeholder="dd/mm/yyyy"
              className="w-full"
            />
            {dob.length > 0 && !isValidDob(dob) && (
              <p className="mt-1 text-xs text-red-500">Enter a valid date of birth</p>
            )}
            {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
          </div>
          <button
            type="submit"
            disabled={!isValidDob(dob) || saving}
            className="mt-5 w-full px-4 py-2.5 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving' : 'Save my birthday'}
          </button>
          <p className="mt-3 text-xs text-foreground-muted">We only use this to send you birthday offers.</p>
        </form>
      )}
    </div>
  )
}
