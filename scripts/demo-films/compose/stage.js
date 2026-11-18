// Frame-exact film stage: every visual is a pure function of time t (seconds). render.mjs calls renderAt(t) per frame
// and screenshots the page. Scenes overlap by FADE seconds for crossfades.

const W = 1920
const H = 1080
const FADE = 0.7
const stage = document.getElementById('stage')

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, k) => a + (b - a) * k
const easeInOut = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const easeOut = k => 1 - Math.pow(1 - k, 3)
const ramp = (t, a, b) => clamp((t - a) / (b - a), 0, 1)
const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html != null) e.innerHTML = html
  if (parent) parent.appendChild(e)
  return e
}
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const words = s =>
  esc(s)
    .split(/(\s+)/)
    .map(w => (/^\s+$/.test(w) ? w : `<span class="word">${w}</span>`))
    .join('')

// Drifting background blobs.
const BLOBS = [
  { c: '#dfe9cf', s: 820, x: 1500, y: -220, dx: 60, dy: 40, p: 23 },
  { c: '#fbe3d4', s: 700, x: -240, y: 600, dx: 50, dy: -50, p: 29 },
  { c: '#f9c6a3', s: 420, x: 1180, y: 760, dx: -40, dy: 30, p: 19 },
  { c: '#ecdfc8', s: 520, x: 300, y: -260, dx: 30, dy: 50, p: 31 },
]
const blobEls = BLOBS.map(b => {
  const e = el('div', 'blob', stage)
  Object.assign(e.style, { width: `${b.s}px`, height: `${b.s}px`, background: b.c, left: `${b.x}px`, top: `${b.y}px`, opacity: 0.75 })
  return e
})

const scenes = []
let film = null

function camAt(cams, lt) {
  if (!cams || !cams.length) return { z: 1, cx: 0.5, cy: 0 }
  if (lt <= cams[0].t) return cams[0]
  for (let i = 1; i < cams.length; i++) {
    if (lt <= cams[i].t) {
      const a = cams[i - 1]
      const b = cams[i]
      const k = easeInOut((lt - a.t) / (b.t - a.t))
      return { z: lerp(a.z, b.z, k), cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k) }
    }
  }
  return cams[cams.length - 1]
}

// Fit a frame of size (fw, fh) into a view (vw, vh) at zoom z, centred on the frame point (cx, cy) (0..1), clamped.
function placeImage(img, fw, fh, vw, vh, cam) {
  const base = vw / fw
  const s = base * cam.z
  const iw = fw * s
  const ih = fh * s
  let x = vw / 2 - cam.cx * iw
  let y = cam.cy === 0 && cam.z === 1 ? 0 : vh / 2 - cam.cy * ih
  x = clamp(x, vw - iw, 0)
  y = clamp(y, Math.min(0, vh - ih), 0)
  img.style.width = `${fw}px`
  img.style.height = `${fh}px`
  img.style.transform = `translate(${x}px, ${y}px) scale(${s})`
}

// cuts: [[a, b], ...] clip-second ranges played back to back (jump cuts); otherwise one run from clip.from.
function clipTime(clip, lt) {
  const run = lt * (clip.rate || 1)
  if (!clip.cuts?.length) return clip.from + run
  let rem = run
  for (const [a, b] of clip.cuts) {
    if (rem <= b - a) return a + rem
    rem -= b - a
  }
  return clip.cuts[clip.cuts.length - 1][1]
}

function frameSrc(clip, lt) {
  if (clip.image) return clip.image
  const n = clamp(Math.floor(clipTime(clip, lt) * clip.fps), 0, clip.count - 1)
  return `${clip.dir}/${String(n + 1).padStart(5, '0')}.jpg`
}

function setSrc(img, src, waits) {
  if (img.dataset.src === src) return
  img.dataset.src = src
  img.src = src
  waits.push(img.decode().catch(() => {}))
}

function lowerThird(root, lower) {
  if (!lower) return null
  const box = el('div', 'lower', root)
  el('div', 'kicker', box, esc(lower.kicker || ''))
  el('h3', '', box, esc(lower.title))
  if (lower.text) el('p', '', box, esc(lower.text))
  return box
}

function brand(root) {
  el('div', 'brand', root, '<span class="mark">J</span><span>Jeffi Stores</span>')
}

const build = {
  title(s, root) {
    const box = el('div', '', root)
    Object.assign(box.style, { position: 'absolute', left: '0', right: '0', top: '0', bottom: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 160px' })
    if (s.kicker) el('div', 'kicker', box, esc(s.kicker))
    const h = el('h1', 'display', box, s.lines.map(l => `<div>${words(l)}</div>`).join(''))
    Object.assign(h.style, { fontSize: `${s.size || 128}px`, lineHeight: '1.02', marginTop: '26px' })
    if (s.accentLine != null) h.children[s.accentLine]?.style && (h.children[s.accentLine].style.color = 'var(--accent)')
    let sub = null
    if (s.subtitle) {
      sub = el('p', '', box, esc(s.subtitle))
      Object.assign(sub.style, { marginTop: '34px', fontSize: '34px', color: 'var(--ink2)', maxWidth: '1100px', lineHeight: '1.35' })
    }
    return { box, words: [...h.querySelectorAll('.word')], sub }
  },
  screen(s, root) {
    brand(root)
    const fw = s.clip.width
    const fh = s.clip.height
    const vw = s.win?.w || 1400
    const vh = Math.round(vw * (fh / fw) > 860 ? 860 : vw * (fh / fw))
    const win = el('div', 'win', root)
    const left = s.win?.x ?? (W - vw) / 2
    const top = s.win?.y ?? (H - (vh + 52)) / 2 + 10
    Object.assign(win.style, { left: `${left}px`, top: `${top}px`, width: `${vw}px` })
    const bar = el('div', 'bar', win)
    for (const c of ['#c46a46', '#f9c6a3', 'rgba(107,127,85,.6)']) el('span', 'dot', bar).style.background = c
    el('div', 'url', bar, esc(s.url || 'jeffistores.in'))
    const view = el('div', 'view', win)
    Object.assign(view.style, { width: `${vw}px`, height: `${vh}px` })
    const img = el('img', '', view)
    return { win, view, img, vw, vh, fw, fh, lower: lowerThird(root, s.lower) }
  },
  phone(s, root) {
    brand(root)
    const pw = 430
    const ph = 900
    const phone = el('div', 'phone', root)
    Object.assign(phone.style, { width: `${pw}px`, height: `${ph}px`, left: `${s.x ?? 1250}px`, top: `${(H - ph) / 2}px` })
    el('div', 'notch', phone)
    const screen = el('div', 'screen', phone)
    const img = el('img', '', screen)
    let side = null
    if (s.side) {
      side = el('div', 'side', root)
      Object.assign(side.style, { left: '150px', top: '250px', width: '900px' })
      el('div', 'kicker', side, esc(s.side.kicker || ''))
      el('h2', 'display', side, esc(s.side.title))
      if (s.side.points?.length) el('ul', '', side, s.side.points.map(p => `<li>${esc(p)}</li>`).join(''))
    }
    return { phone, screen, img, sw: pw - 28, sh: ph - 28, side }
  },
  duo(s, root) {
    const a = build.screen({ ...s, win: { w: 1180, x: 120, y: 150 }, lower: null }, root)
    const p = build.phone({ ...s.phone, x: 1330 }, root)
    return { ...a, p, lower: lowerThird(root, s.lower) }
  },
  grid(s, root) {
    brand(root)
    const head = el('div', 'side', root)
    Object.assign(head.style, { left: '120px', top: `${s.headTop ?? 300}px`, width: '600px' })
    el('div', 'kicker', head, esc(s.kicker || ''))
    el('h2', 'display', head, esc(s.title))
    if (s.text) {
      const p = el('p', '', head, esc(s.text))
      Object.assign(p.style, { marginTop: '24px', fontSize: '28px', color: 'var(--ink2)', lineHeight: '1.35' })
    }
    const cols = s.cols || 3
    const tw = s.tile?.w || 300
    const th = s.tile?.h || 188
    const gap = s.gap ?? 22
    const x0 = s.x0 ?? 800
    const y0 = s.y0 ?? 170
    const tiles = s.images.map((im, i) => {
      const t = el('div', 'tile', root)
      Object.assign(t.style, { width: `${tw}px`, height: `${th}px`, left: `${x0 + (i % cols) * (tw + gap)}px`, top: `${y0 + Math.floor(i / cols) * (th + gap)}px` })
      const img = el('img', '', t)
      img.src = im.src
      if (im.label) el('span', '', t, esc(im.label))
      return t
    })
    return { head, tiles }
  },
  outro(s, root) {
    const box = el('div', '', root)
    Object.assign(box.style, { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: 'var(--band)', color: 'var(--band-text)' })
    const logo = el('div', '', box, '<span class="mark" style="width:72px;height:72px;font-size:44px;border-radius:20px">J</span>')
    const h = el('h1', 'display', box, s.lines.map(l => `<div>${words(l)}</div>`).join(''))
    Object.assign(h.style, { fontSize: '112px', lineHeight: '1.02', marginTop: '40px', color: 'var(--band-text)' })
    if (h.children[1]) h.children[1].style.color = 'var(--apricot)'
    const row = el('div', '', box)
    Object.assign(row.style, { display: 'flex', gap: '22px', marginTop: '56px' })
    const cta = el('span', 'pill', row, esc(s.cta || 'Start free'))
    Object.assign(cta.style, { background: 'var(--accent)', color: '#fff' })
    const url = el('span', 'pill', row, esc(s.url || 'jeffistores.in'))
    Object.assign(url.style, { background: 'rgba(243,234,217,.12)', color: 'var(--band-text)', border: '2px solid rgba(243,234,217,.35)' })
    return { box, logo, words: [...h.querySelectorAll('.word')], row }
  },
}

window.setup = async f => {
  film = f
  for (const s of f.scenes) {
    const root = el('div', 'scene', stage)
    scenes.push({ s, root, parts: build[s.type](s, root) })
  }
  await document.fonts.ready
  await Promise.all([...document.images].map(i => (i.src ? i.decode().catch(() => {}) : null)))
  return scenes.length
}

window.renderAt = async t => {
  const waits = []
  blobEls.forEach((e, i) => {
    const b = BLOBS[i]
    e.style.transform = `translate(${Math.sin((t / b.p) * Math.PI * 2) * b.dx}px, ${Math.cos((t / b.p) * Math.PI * 2) * b.dy}px)`
  })
  for (const { s, root, parts } of scenes) {
    const on = t >= s.start - 0.001 && t <= s.end + 0.001
    root.style.display = on ? 'block' : 'none'
    if (!on) continue
    const lt = t - s.start
    const dur = s.end - s.start
    const fadeIn = s.cut ? 1 : easeOut(ramp(lt, 0, FADE))
    const fadeOut = s.last ? 1 : 1 - easeInOut(ramp(lt, dur - FADE, dur))
    root.style.opacity = String(Math.min(fadeIn, fadeOut))

    if (s.type === 'title' || s.type === 'outro') {
      parts.words.forEach((w, i) => {
        const k = easeOut(ramp(lt, 0.15 + i * 0.07, 0.75 + i * 0.07))
        w.style.opacity = String(k)
        w.style.transform = `translateY(${(1 - k) * 46}px)`
      })
      if (parts.sub) {
        const k = easeOut(ramp(lt, 0.6 + parts.words.length * 0.07, 1.3 + parts.words.length * 0.07))
        parts.sub.style.opacity = String(k)
        parts.sub.style.transform = `translateY(${(1 - k) * 24}px)`
      }
      if (parts.row) {
        const k = easeOut(ramp(lt, 1.0, 1.7))
        parts.row.style.opacity = String(k)
        parts.row.style.transform = `translateY(${(1 - k) * 24}px)`
      }
      if (parts.logo) {
        const k = easeOut(ramp(lt, 0, 0.6))
        parts.logo.style.transform = `scale(${0.7 + 0.3 * k})`
        parts.logo.style.opacity = String(k)
      }
      const zoom = 1 + 0.03 * ramp(lt, 0, dur)
      ;(parts.box || root).style.transform = `scale(${zoom})`
    }

    if (s.type === 'screen' || s.type === 'duo') {
      const k = easeOut(ramp(lt, 0, 0.9))
      parts.win.style.transform = `translateY(${(1 - k) * 60}px) scale(${0.97 + 0.03 * k})`
      setSrc(parts.img, frameSrc(s.clip, lt), waits)
      placeImage(parts.img, parts.fw, parts.fh, parts.vw, parts.vh, camAt(s.camera, lt))
    }
    if (s.type === 'phone' || s.type === 'duo') {
      const p = s.type === 'duo' ? parts.p : parts
      const ps = s.type === 'duo' ? s.phone : s
      const k = easeOut(ramp(lt, s.type === 'duo' ? 0.5 : 0.1, s.type === 'duo' ? 1.4 : 1.0))
      p.phone.style.transform = `translateY(${(1 - k) * 80}px) rotate(${(1 - k) * 3}deg)`
      p.phone.style.opacity = String(k)
      setSrc(p.img, frameSrc(ps.clip, lt), waits)
      const cam = camAt(ps.camera, lt)
      const s2 = p.sw / ps.clip.width
      const ih = ps.clip.height * s2 * cam.z
      const y = clamp(-(cam.cy || 0) * (ih - p.sh), Math.min(0, p.sh - ih), 0)
      p.img.style.transform = `translateY(${y}px) scale(${cam.z})`
      if (p.side) {
        const k2 = easeOut(ramp(lt, 0.2, 1.0))
        p.side.style.opacity = String(k2)
        p.side.style.transform = `translateX(${(1 - k2) * -40}px)`
      }
    }
    if (parts.lower) {
      const a = easeOut(ramp(lt, 0.5, 1.2))
      const b = 1 - easeInOut(ramp(lt, dur - 1.1, dur - 0.5))
      const k = Math.min(a, b)
      parts.lower.style.opacity = String(k)
      parts.lower.style.transform = `translateY(${(1 - a) * 30}px)`
    }
    if (s.type === 'grid') {
      const k = easeOut(ramp(lt, 0.1, 0.9))
      parts.head.style.opacity = String(k)
      parts.head.style.transform = `translateX(${(1 - k) * -40}px)`
      // After the tiles land, the grid keeps a slow drift so a long scene never sits still.
      const drift = ramp(lt, 0, dur)
      parts.tiles.forEach((tile, i) => {
        const kk = easeOut(ramp(lt, 0.3 + i * 0.06, 0.9 + i * 0.06))
        const lift = (i % 2 ? -1 : 1) * 6 * drift
        tile.style.opacity = String(kk)
        tile.style.transform = `translateY(${(1 - kk) * 30 + lift}px) scale(${(0.92 + 0.08 * kk) * (1 + 0.035 * drift)})`
      })
    }
  }
  await Promise.all(waits)
  return true
}
