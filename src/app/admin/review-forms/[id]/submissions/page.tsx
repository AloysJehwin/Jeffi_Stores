'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'

interface CustomField {
  id: string
  label: string
  type: 'text' | 'textarea' | 'image' | 'rating'
  required: boolean
}

interface Submission {
  id: string
  email: string
  screenshot_url: string
  coupon_code: string | null
  status: 'pending' | 'approved' | 'rejected'
  submitted_at: string
  extra_fields: Record<string, string>
}

interface FormMeta {
  title: string
  custom_fields: CustomField[]
}

function StarDisplay({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <span key={s} className={`text-sm ${s <= value ? 'text-yellow-400' : 'text-gray-300'}`}>★</span>
      ))}
    </div>
  )
}

export default function SubmissionsPage({ params }: { params: { id: string } }) {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [formMeta, setFormMeta] = useState<FormMeta | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [updating, setUpdating] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : ''
      const [subsRes, formRes] = await Promise.all([
        fetch(`/api/admin/review-forms/${params.id}/submissions${qs}`),
        fetch(`/api/admin/review-forms/${params.id}`),
      ])
      if (subsRes.ok) {
        const data = await subsRes.json()
        setSubmissions(data.submissions)
        setTotal(data.total)
      }
      if (formRes.ok) {
        const data = await formRes.json()
        setFormMeta({ title: data.form.title, custom_fields: data.form.custom_fields || [] })
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [statusFilter])

  const updateStatus = async (submissionId: string, status: string) => {
    setUpdating(submissionId)
    const res = await fetch(`/api/admin/review-forms/${params.id}/submissions`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId, status }),
    })
    if (res.ok) {
      setSubmissions(prev => prev.map(s => s.id === submissionId ? { ...s, status: status as Submission['status'] } : s))
    }
    setUpdating(null)
  }

  const statusColor = (s: string) =>
    s === 'approved' ? 'bg-green-100 text-green-700' : s === 'rejected' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/review-forms" className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">
            {formMeta?.title ? `${formMeta.title} — Submissions` : 'Submissions'}
          </h1>
          <p className="text-sm text-foreground-secondary mt-0.5">{total} total</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {['', 'pending', 'approved', 'rejected'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${statusFilter === s ? 'bg-accent-500 text-white' : 'bg-surface-elevated border border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}
          >
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full" />
        </div>
      ) : submissions.length === 0 ? (
        <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
          No submissions yet
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {submissions.map(s => (
            <div key={s.id} className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
              <a href={s.screenshot_url} target="_blank" rel="noopener noreferrer" className="block relative aspect-video bg-surface-secondary overflow-hidden">
                <Image src={s.screenshot_url} alt="Review screenshot" fill className="object-cover" unoptimized />
              </a>
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{s.email}</span>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(s.status)}`}>{s.status}</span>
                </div>

                {s.coupon_code && (
                  <p className="text-xs text-foreground-secondary">Coupon: <span className="font-mono font-bold text-accent-500">{s.coupon_code}</span></p>
                )}

                {formMeta?.custom_fields && formMeta.custom_fields.length > 0 && s.extra_fields && Object.keys(s.extra_fields).length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t border-border-default">
                    {formMeta.custom_fields.map(field => {
                      const val = s.extra_fields[field.id]
                      if (!val) return null
                      return (
                        <div key={field.id}>
                          <p className="text-xs text-foreground-muted">{field.label}</p>
                          {field.type === 'rating' ? (
                            <StarDisplay value={parseInt(val, 10)} />
                          ) : field.type === 'image' ? (
                            <a href={val} target="_blank" rel="noopener noreferrer">
                              <Image src={val} alt={field.label} width={200} height={100} className="rounded-lg max-h-24 object-contain" unoptimized />
                            </a>
                          ) : (
                            <p className="text-xs text-foreground">{val}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                <p className="text-xs text-foreground-muted">{new Date(s.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>

                {s.status === 'pending' && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => updateStatus(s.id, 'approved')}
                      disabled={updating === s.id}
                      className="flex-1 py-1 text-xs bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => updateStatus(s.id, 'rejected')}
                      disabled={updating === s.id}
                      className="flex-1 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
