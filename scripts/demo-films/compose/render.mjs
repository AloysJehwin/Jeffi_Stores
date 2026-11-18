// Renders a film timeline (JSON) frame by frame through stage.html into <out>.mp4/.webm/.jpg, mixing the narration
// (and optional music, ducked under the voice). Usage: node render.mjs <timeline.json> <outBase> [--from s --to s]
import * as pw from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = pw
const here = path.dirname(fileURLToPath(import.meta.url))
const [, , timelinePath, outBase, ...rest] = process.argv
const arg = name => {
  const i = rest.indexOf(name)
  return i >= 0 ? Number(rest[i + 1]) : undefined
}
const film = JSON.parse(fs.readFileSync(timelinePath, 'utf8'))
const fps = film.fps || 30
const total = film.duration ?? Math.max(...film.scenes.map(s => s.end))
const from = arg('--from') ?? 0
const to = arg('--to') ?? total
const first = Math.round(from * fps)
const last = Math.round(to * fps)

const audioOnly = rest.includes('--audio-only')
const silent = `${outBase}.silent.mp4`
if (audioOnly) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${outBase}.mp4`, '-map', '0:v', '-c:v', 'copy', silent])
if (!audioOnly) {
const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security'] })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  await page.goto('file://' + path.join(here, 'stage.html'))
  await page.evaluate(f => window.setup(f), film)
  
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-maxrate', '5M', '-bufsize', '10M', '-pix_fmt', 'yuv420p', '-r', String(fps), silent], { stdio: ['pipe', 'inherit', 'inherit'] })
  const started = Date.now()
  for (let i = first; i < last; i++) {
    await page.evaluate(t => window.renderAt(t), i / fps)
    const buf = await page.screenshot({ type: 'jpeg', quality: 94 })
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r))
    if ((i - first) % (fps * 10) === 0) console.log(`frame ${i - first}/${last - first}  ${((Date.now() - started) / 1000).toFixed(0)}s`)
  }
  ff.stdin.end()
  await new Promise(r => ff.on('close', r))
  
  // Poster: the frame at film.poster (seconds).
  if (film.poster != null) {
    await page.evaluate(t => window.renderAt(t), film.poster)
    await page.screenshot({ type: 'jpeg', quality: 88, path: `${outBase}.jpg` })
  }
  await browser.close()
}

// Audio: narration track (already placed on the film's clock), music ducked under it, loudness-normalised.
const inputs = ['-i', silent]
const filters = []
let n = 1
if (film.narration) {
  inputs.push('-i', film.narration)
  filters.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,apad[voice]`)
  n++
}
if (film.music) {
  inputs.push('-stream_loop', '-1', '-i', film.music)
  filters.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${film.musicVolume ?? 0.32},afade=t=in:d=1.5,afade=t=out:st=${(to - from - 3).toFixed(2)}:d=3[bed]`)
  n++
}
const dur = (to - from).toFixed(3)
const mp4 = `${outBase}.mp4`
if (film.narration && film.music) {
  filters.push('[voice]asplit=2[v1][v2]', '[bed][v2]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[ducked]', '[v1][ducked]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]')
} else if (film.narration) {
  filters.push('[voice]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]')
} else if (film.music) {
  filters.push('[bed]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]')
}
const audio = filters.length ? ['-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[a]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'] : ['-map', '0:v']
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, ...audio, '-c:v', 'copy', '-t', dur, '-movflags', '+faststart', mp4], { stdio: 'inherit' })
// WebM for browsers that prefer it; smaller at the same look.
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '33', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-c:a', 'libopus', '-b:a', '128k', `${outBase}.webm`], { stdio: 'inherit' })
fs.rmSync(silent, { force: true })
console.log(`done ${mp4}`)
