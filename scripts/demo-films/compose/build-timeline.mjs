// Turns a film plan + measured narration into a stage timeline. Each scene follows one narration line: it starts a
// beat before the line and runs until the next scene's line starts (plus the crossfade). Camera keys use k (0..1 of
// the scene). Usage: node build-timeline.mjs <plan.json> <narrationDir> <clipsDir> <out.json>
import fs from 'node:fs'
import path from 'node:path'

const [, , planPath, narrDir, clipsDir, outPath] = process.argv
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'))
const timing = JSON.parse(fs.readFileSync(path.join(narrDir, 'timing.json'), 'utf8'))
const at = Object.fromEntries(timing.lines.map(l => [l.id, l]))
const FADE = 0.7
const LEAD = 0.35

const clipMeta = name => {
  const dir = path.resolve(clipsDir, name)
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
  return { dir: 'file://' + dir, fps: meta.fps, count: meta.count, width: meta.width, height: meta.height, from: 0 }
}
const still = file => {
  const [w, h] = (plan.stillSize?.[file] || '2304x1440').split('x').map(Number)
  return { image: 'file://' + path.resolve(file), width: w, height: h, fps: 30, count: 1, from: 0 }
}

const scenes = plan.scenes.map((s, i) => {
  const line = at[s.line]
  const next = plan.scenes[i + 1] ? at[plan.scenes[i + 1].line] : null
  const start = Math.max(0, (i === 0 ? 0 : line.start - LEAD))
  const end = next ? next.start - LEAD + FADE : timing.total
  const dur = end - start
  const out = { ...s, start: +start.toFixed(3), end: +end.toFixed(3) }
  delete out.line
  if (i === 0) out.cut = true
  if (i === plan.scenes.length - 1) out.last = true
  const toCam = keys => keys?.map(k => ({ t: +(k.k * dur).toFixed(3), z: k.z ?? 1, cx: k.cx ?? 0.5, cy: k.cy ?? 0 }))
  if (s.clip) out.clip = typeof s.clip === 'string' ? clipMeta(s.clip) : s.clip.still ? still(s.clip.still) : { ...clipMeta(s.clip.name), from: s.clip.from ?? 0, rate: s.clip.rate ?? 1, cuts: s.clip.cuts }
  if (s.images) out.images = s.images.map(im => ({ ...im, src: /^(file|https?):/.test(im.src) ? im.src : 'file://' + path.resolve(im.src) }))
  if (s.camera) out.camera = toCam(s.camera)
  if (s.phone) {
    out.phone = { ...s.phone }
    if (s.phone.clip) out.phone.clip = typeof s.phone.clip === 'string' ? clipMeta(s.phone.clip) : { ...clipMeta(s.phone.clip.name), from: s.phone.clip.from ?? 0, rate: s.phone.clip.rate ?? 1, cuts: s.phone.clip.cuts }
    if (s.phone.camera) out.phone.camera = toCam(s.phone.camera)
  }
  if (s.type === 'phone' && s.camera) out.camera = toCam(s.camera)
  return out
})

const film = {
  fps: 30,
  duration: +timing.total.toFixed(3),
  poster: plan.poster ?? 1.6,
  narration: path.join(narrDir, 'narration.wav'),
  music: plan.music ? path.resolve(plan.music) : undefined,
  musicVolume: plan.musicVolume ?? 0.3,
  scenes,
}
fs.writeFileSync(outPath, JSON.stringify(film, null, 2))
console.log(`${scenes.length} scenes, ${film.duration}s`)
