import { describe, it, expect } from 'vitest'
import {
  isAwsTemplateRef,
  formatAwsTemplateRef,
  parseAwsTemplateRef,
  cloudText,
  cloudMedia,
  cloudRead,
  cloudTemplate,
  cloudMediaKind,
  cloudWebhookValues,
  cloudInboundText,
  cloudInboundMedia,
  type AwsTemplateRef,
  type CloudInboundMessage,
} from '../src/wa-cloud'

describe('isAwsTemplateRef', () => {
  it('true only for aws:-prefixed non-empty strings', () => {
    expect(isAwsTemplateRef('aws:foo:en')).toBe(true)
    expect(isAwsTemplateRef('twilio:HX...')).toBe(false)
    expect(isAwsTemplateRef('')).toBe(false)
    expect(isAwsTemplateRef(null)).toBe(false)
    expect(isAwsTemplateRef(undefined)).toBe(false)
  })
})

describe('formatAwsTemplateRef / parseAwsTemplateRef round-trip', () => {
  it('formats a bare ref', () => {
    expect(formatAwsTemplateRef({ name: 'order_ok', lang: 'en', buttons: [] })).toBe('aws:order_ok:en')
  })
  it('appends header, buttons and otp in order', () => {
    const r: AwsTemplateRef = {
      name: 'promo',
      lang: 'en_US',
      header: { slot: '4', kind: 'image' },
      buttons: [{ slot: '5', index: 0 }, { slot: '6', index: 1 }],
      otp: true,
    }
    expect(formatAwsTemplateRef(r)).toBe('aws:promo:en_US|h=4:image|b=5@0|b=6@1|otp')
  })
  it('parses a full ref back into structure', () => {
    const r = parseAwsTemplateRef('aws:promo:en_US|h=4:video|b=5@0|otp')
    expect(r).toEqual({
      name: 'promo',
      lang: 'en_US',
      header: { slot: '4', kind: 'video' },
      buttons: [{ slot: '5', index: 0 }],
      otp: true,
    })
  })
  it('parses a bare ref (no parts)', () => {
    expect(parseAwsTemplateRef('aws:x:en')).toEqual({ name: 'x', lang: 'en', buttons: [] })
  })
  it('ignores unrecognised parts', () => {
    const r = parseAwsTemplateRef('aws:x:en|zzz')
    expect(r.header).toBeUndefined()
    expect(r.buttons).toEqual([])
    expect(r.otp).toBeUndefined()
  })
  it('throws on a malformed head', () => {
    expect(() => parseAwsTemplateRef('notaws:x:en')).toThrow(/invalid AWS template ref/)
    expect(() => parseAwsTemplateRef('aws:BAD-NAME:en')).toThrow() // uppercase/dash invalid
  })
  it('round-trips via format→parse', () => {
    const r: AwsTemplateRef = { name: 'a_b', lang: 'pt_BR', header: { slot: '3', kind: 'document' }, buttons: [{ slot: '4', index: 2 }], otp: false }
    expect(parseAwsTemplateRef(formatAwsTemplateRef(r))).toEqual({ ...r, otp: undefined })
  })
})

describe('cloudText', () => {
  it('strips a leading + and builds a text body', () => {
    expect(cloudText('+919876543210', 'hi')).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543210',
      type: 'text',
      text: { preview_url: true, body: 'hi' },
    })
  })
  it('leaves a number without + unchanged', () => {
    expect(cloudText('919876543210', 'x').to).toBe('919876543210')
  })
})

describe('cloudMedia', () => {
  it('prefers id over link', () => {
    expect(cloudMedia('919', 'image', { id: 'm1', link: 'http://x' })).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '919',
      type: 'image', image: { id: 'm1' },
    })
  })
  it('uses link when there is no id', () => {
    expect(cloudMedia('919', 'video', { link: 'http://x' }).video).toEqual({ link: 'http://x' })
  })
  it('adds caption for non-audio and truncates to 1024', () => {
    const long = 'a'.repeat(2000)
    const out = cloudMedia('919', 'image', { id: 'm' }, { caption: long }) as any
    expect(out.image.caption).toHaveLength(1024)
  })
  it('drops caption for audio', () => {
    const out = cloudMedia('919', 'audio', { id: 'm' }, { caption: 'nope' }) as any
    expect(out.audio.caption).toBeUndefined()
  })
  it('adds filename only for documents, truncated to 240', () => {
    const doc = cloudMedia('919', 'document', { id: 'm' }, { filename: 'f'.repeat(300) }) as any
    expect(doc.document.filename).toHaveLength(240)
    const img = cloudMedia('919', 'image', { id: 'm' }, { filename: 'name.png' }) as any
    expect(img.image.filename).toBeUndefined()
  })
  it('no caption/filename when opts empty', () => {
    const out = cloudMedia('919', 'image', { id: 'm' }) as any
    expect(out.image).toEqual({ id: 'm' })
  })
})

describe('cloudRead', () => {
  it('builds a read receipt', () => {
    expect(cloudRead('wamid.1')).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.1' })
  })
})

describe('cloudTemplate', () => {
  const to = '919'
  it('bare template with no components', () => {
    const ref: AwsTemplateRef = { name: 't', lang: 'en', buttons: [] }
    const out = cloudTemplate(to, ref, {}) as any
    expect(out.type).toBe('template')
    expect(out.template).toEqual({ name: 't', language: { code: 'en' } }) // no components key
  })
  it('adds a body component from numbered slots, sorted and skipping special slots', () => {
    const ref: AwsTemplateRef = { name: 't', lang: 'en', header: { slot: '3', kind: 'image' }, buttons: [{ slot: '4', index: 0 }] }
    const out = cloudTemplate(to, ref, { '2': 'B', '1': 'A', '3': 'hdr', '4': 'btn' }) as any
    const body = out.template.components.find((c: any) => c.type === 'body')
    expect(body.parameters).toEqual([{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }]) // 3,4 excluded, sorted 1,2
  })
  it('adds a header component only when its slot has a value', () => {
    const ref: AwsTemplateRef = { name: 't', lang: 'en', header: { slot: '3', kind: 'image' }, buttons: [] }
    const withHdr = cloudTemplate(to, ref, { '3': 'http://img' }) as any
    expect(withHdr.template.components[0]).toEqual({ type: 'header', parameters: [{ type: 'image', image: { link: 'http://img' } }] })
    const noHdr = cloudTemplate(to, ref, {}) as any
    expect(noHdr.template.components).toBeUndefined() // header slot empty → no components at all
  })
  it('adds a url button component, skipping buttons whose slot is undefined', () => {
    const ref: AwsTemplateRef = { name: 't', lang: 'en', buttons: [{ slot: '2', index: 0 }, { slot: '3', index: 1 }] }
    const out = cloudTemplate(to, ref, { '2': 'code' }) as any // slot 3 omitted
    const buttons = out.template.components.filter((c: any) => c.type === 'button')
    expect(buttons).toEqual([{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'code' }] }])
  })
  it('adds an otp copy-code button echoing {{1}} when otp and slot 1 present', () => {
    const ref: AwsTemplateRef = { name: 't', lang: 'en', buttons: [], otp: true }
    const out = cloudTemplate(to, ref, { '1': '123456' }) as any
    const otp = out.template.components.find((c: any) => c.sub_type === 'url' && c.index === '0')
    expect(otp.parameters).toEqual([{ type: 'text', text: '123456' }])
  })
  it('no otp button when slot 1 missing', () => {
    const ref: AwsTemplateRef = { name: 't', lang: 'en', buttons: [], otp: true }
    const out = cloudTemplate(to, ref, {}) as any
    expect(out.template.components).toBeUndefined()
  })
  it('stringifies and defaults undefined vars to empty', () => {
    const ref: AwsTemplateRef = { name: 't', lang: 'en', buttons: [] }
    const out = cloudTemplate(to, ref, { '1': undefined as any }) as any
    expect(out.template.components.find((c: any) => c.type === 'body').parameters).toEqual([{ type: 'text', text: '' }])
  })
})

describe('cloudMediaKind', () => {
  it('classifies by mime prefix, defaulting to document', () => {
    expect(cloudMediaKind('image/png')).toBe('image')
    expect(cloudMediaKind('video/mp4')).toBe('video')
    expect(cloudMediaKind('audio/ogg')).toBe('audio')
    expect(cloudMediaKind('application/pdf')).toBe('document')
    expect(cloudMediaKind('')).toBe('document')
  })
})

describe('cloudWebhookValues', () => {
  it('parses a JSON string entry', () => {
    const json = JSON.stringify({ changes: [{ value: { messages: [] } }] })
    expect(cloudWebhookValues(json)).toEqual([{ messages: [] }])
  })
  it('accepts an object entry and filters changes without a value', () => {
    const entry = { changes: [{ value: { a: 1 } }, { field: 'x' }, { value: { b: 2 } }] }
    expect(cloudWebhookValues(entry)).toEqual([{ a: 1 }, { b: 2 }])
  })
  it('returns [] when changes is not an array', () => {
    expect(cloudWebhookValues({})).toEqual([])
    expect(cloudWebhookValues({ changes: 'nope' })).toEqual([])
    expect(cloudWebhookValues(null)).toEqual([])
  })
})

describe('cloudInboundText', () => {
  it('prefers text body', () => {
    expect(cloudInboundText({ text: { body: 't' }, button: { text: 'b' } } as CloudInboundMessage)).toBe('t')
  })
  it('falls back through button, interactive replies and captions', () => {
    expect(cloudInboundText({ button: { text: 'b' } } as CloudInboundMessage)).toBe('b')
    expect(cloudInboundText({ interactive: { type: 'button', button_reply: { id: '1', title: 'br' } } } as CloudInboundMessage)).toBe('br')
    expect(cloudInboundText({ interactive: { type: 'list', list_reply: { id: '1', title: 'lr' } } } as CloudInboundMessage)).toBe('lr')
    expect(cloudInboundText({ image: { id: 'i', caption: 'ic' } } as CloudInboundMessage)).toBe('ic')
    expect(cloudInboundText({ video: { id: 'v', caption: 'vc' } } as CloudInboundMessage)).toBe('vc')
    expect(cloudInboundText({ document: { id: 'd', caption: 'dc' } } as CloudInboundMessage)).toBe('dc')
  })
  it('renders a location as name · address · lat,lng, dropping empties', () => {
    expect(cloudInboundText({ location: { latitude: 1, longitude: 2, name: 'Home', address: 'Road' } } as CloudInboundMessage)).toBe('Home · Road · 1,2')
    expect(cloudInboundText({ location: { latitude: 1, longitude: 2 } } as CloudInboundMessage)).toBe('1,2')
  })
  it('returns empty string when nothing matches', () => {
    expect(cloudInboundText({ type: 'unknown' } as CloudInboundMessage)).toBe('')
  })
})

describe('cloudInboundMedia', () => {
  it('returns null when there is no media', () => {
    expect(cloudInboundMedia({ text: { body: 'x' } } as CloudInboundMessage)).toBeNull()
  })
  it('returns null when the media item has no id', () => {
    expect(cloudInboundMedia({ image: {} as any } as CloudInboundMessage)).toBeNull()
  })
  it('picks the first present media kind and defaults the mime', () => {
    expect(cloudInboundMedia({ image: { id: 'i1', mime_type: 'image/png' } } as CloudInboundMessage)).toEqual({ id: 'i1', mime: 'image/png', filename: undefined })
    expect(cloudInboundMedia({ audio: { id: 'a1' } } as CloudInboundMessage)).toEqual({ id: 'a1', mime: 'application/octet-stream', filename: undefined })
  })
  it('carries the document filename', () => {
    expect(cloudInboundMedia({ document: { id: 'd1', mime_type: 'application/pdf', filename: 'f.pdf' } } as CloudInboundMessage)).toEqual({ id: 'd1', mime: 'application/pdf', filename: 'f.pdf' })
  })
})
