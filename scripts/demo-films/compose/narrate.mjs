// Narration: one Gemini TTS take per line (Indian English), silence trimmed, durations measured, then placed on the
// film clock at each line's start. Writes <out>/lines.json, <out>/narration.wav and <out>/captions.vtt.
// Usage: node narrate.mjs <script.json> <outDir>   script = { voice, style, lines: [{ id, text, at? }] }
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [, , scriptPath, outDir] = process.argv
const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'))
const key = process.env.GOOGLE_AI_API_KEY || fs.readFileSync(path.join(os.homedir(), '.jeffi/google-ai-key'), 'utf8').trim()
fs.mkdirSync(outDir, { recursive: true })
const MODEL = script.model || 'gemini-3.8-flash-tts'
// gemini-3.8-flash-tts reads any instruction aloud, so it gets the line alone; a style prefix is only for 2.5 models.
const style = script.style || ''

async function tts(text, file) {
  if (fs.existsSync(file)) return
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: style ? `${style} ${text}` : text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { languageCode: script.language || 'en-IN', voiceConfig: { prebuiltVoiceConfig: { voiceName: script.voice || 'Sulafat' } } } },
      }),
    })
    const d = await r.json()
    const part = d.candidates?.[0]?.content?.parts?.find(p => p.inlineData)
    if (part) {
      const raw = Buffer.from(part.inlineData.data, 'base64')
      const tmp = `${file}.raw`
      fs.writeFileSync(tmp, raw)
      const isWav = raw.subarray(0, 4).toString() === 'RIFF'
      const input = isWav ? ['-i', tmp] : ['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', tmp]
      // Trim leading/trailing silence, keep 80 ms of air.
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse', '-ar', '48000', '-ac', '1', file])
      fs.rmSync(tmp)
      return
    }
    console.error(`tts attempt ${attempt} failed`, JSON.stringify(d).slice(0, 200))
    await new Promise(r => setTimeout(r, 3000 * attempt))
  }
  throw new Error(`tts failed: ${text}`)
}

const dur = f => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim())

// Takes are kept between runs; a line whose text changed since it was voiced gets a new one.
const voicedFile = path.join(outDir, 'lines.json')
const voiced = fs.existsSync(voicedFile) ? Object.fromEntries(JSON.parse(fs.readFileSync(voicedFile, 'utf8')).map(l => [l.id, l.text])) : {}
const lines = []
for (const l of script.lines) {
  const file = path.join(outDir, `${l.id}.wav`)
  if (voiced[l.id] != null && voiced[l.id] !== l.text) fs.rmSync(file, { force: true })
  await tts(l.text, file)
  lines.push({ ...l, file, duration: dur(file) })
  console.log(`${l.id}  ${dur(file).toFixed(2)}s  ${l.text}`)
}
fs.writeFileSync(path.join(outDir, 'lines.json'), JSON.stringify(lines, null, 2))

// Place each line at its `at` (seconds) when given; otherwise right after the previous one with script.gap seconds.
let clock = script.leadIn ?? 0.6
for (const l of lines) {
  l.start = l.at ?? clock
  l.end = l.start + l.duration
  clock = l.end + (script.gap ?? 0.5)
}
const total = Math.max(...lines.map(l => l.end)) + (script.tail ?? 1.5)
const inputs = lines.flatMap(l => ['-i', l.file])
const delays = lines.map((l, i) => `[${i}:a]adelay=${Math.round(l.start * 1000)}|${Math.round(l.start * 1000)}[d${i}]`).join(';')
const mix = `${lines.map((_, i) => `[d${i}]`).join('')}amix=inputs=${lines.length}:normalize=0,apad=whole_dur=${total.toFixed(3)}[a]`
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${delays};${mix}`, '-map', '[a]', '-ar', '48000', '-ac', '1', '-t', total.toFixed(3), path.join(outDir, 'narration.wav')])

// Captions: each line split into chunks of at most ~84 characters, timed by length.
const ts = s => {
  const ms = Math.round(s * 1000)
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')
  const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
  return `${h}:${m}:${sec}.${String(ms % 1000).padStart(3, '0')}`
}
const cues = []
for (const l of lines) {
  const parts = []
  let cur = ''
  for (const w of l.text.split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > 84 && cur) {
      parts.push(cur)
      cur = w
    } else cur = (cur + ' ' + w).trim()
  }
  if (cur) parts.push(cur)
  const chars = parts.reduce((a, p) => a + p.length, 0)
  let t = l.start
  for (const p of parts) {
    const d = (p.length / chars) * l.duration
    cues.push(`${ts(t)} --> ${ts(t + d)}\n${p}`)
    t += d
  }
}
fs.writeFileSync(path.join(outDir, 'captions.vtt'), `WEBVTT\n\n${cues.join('\n\n')}\n`)
fs.writeFileSync(path.join(outDir, 'timing.json'), JSON.stringify({ total, lines: lines.map(({ id, start, end, duration }) => ({ id, start, end, duration })) }, null, 2))
console.log(`narration ${total.toFixed(1)}s`)
