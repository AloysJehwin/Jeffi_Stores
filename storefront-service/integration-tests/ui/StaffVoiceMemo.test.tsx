import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import StaffVoiceMemo from '@storefront/app/(portal)/staff/notes/_components/StaffVoiceMemo'

class FakeRecorder {
  static isTypeSupported = () => true
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(public stream: unknown) {}
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob(['abc'], { type: 'audio/webm' }) })
    this.onstop?.()
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
  })
  URL.createObjectURL = vi.fn(() => 'blob:memo')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

async function recordOnce() {
  fireEvent.click(await screen.findByRole('button', { name: 'Record' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
}

describe('StaffVoiceMemo', () => {
  it('keeps the audio-only behaviour when no transcript handler is given', async () => {
    const onRecorded = vi.fn()
    render(<StaffVoiceMemo onRecorded={onRecorded} />)
    expect(screen.queryByLabelText('Spoken language')).toBeNull()
    await recordOnce()
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith(expect.any(Blob), expect.any(Number)))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the recording with the language hint and hands the transcript to the note', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: 'namaste duniya', language: 'hi-IN' }) })
    const onRecorded = vi.fn()
    const onTranscript = vi.fn()
    render(<StaffVoiceMemo onRecorded={onRecorded} onTranscript={onTranscript} />)
    fireEvent.change(screen.getByLabelText('Spoken language'), { target: { value: 'hi-IN' } })
    await recordOnce()
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('namaste duniya'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/staff/notes/transcribe')
    const fd = init.body as FormData
    expect(fd.get('language')).toBe('hi-IN')
    expect((fd.get('file') as File).name).toBe('voice-memo.webm')
    expect(init.credentials).toBe('include')
    expect(onRecorded).toHaveBeenCalledWith(expect.any(Blob), expect.any(Number))
    expect(await screen.findByText(/Transcript added to the note/)).toBeTruthy()
  })

  it('omits the language when left on Auto', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: 'hi' }) })
    render(<StaffVoiceMemo onRecorded={vi.fn()} onTranscript={vi.fn()} />)
    await recordOnce()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect((fetchMock.mock.calls[0][1].body as FormData).has('language')).toBe(false)
  })

  it('keeps the audio and offers a retry when transcription fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Audio transcription is not set up.' }) })
    const onTranscript = vi.fn()
    render(<StaffVoiceMemo onRecorded={vi.fn()} onTranscript={onTranscript} />)
    await recordOnce()
    expect(await screen.findByText('Audio transcription is not set up.')).toBeTruthy()
    expect(onTranscript).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'second try' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry transcript' }))
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('second try'))
  })

  it('shows a network error without losing the recording', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<StaffVoiceMemo onRecorded={vi.fn()} onTranscript={vi.fn()} />)
    await recordOnce()
    expect(await screen.findByText(/Network error/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
  })
})
