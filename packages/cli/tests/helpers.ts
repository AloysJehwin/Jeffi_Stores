import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent } from 'undici'
import type { Io } from '../src/io'
import { buildProgram } from '../src/program'

export function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jeffi-cli-'))
}

export function testIo(dir: string, env: NodeJS.ProcessEnv = {}) {
  const agent = new MockAgent()
  agent.disableNetConnect()
  const out: string[] = []
  const err: string[] = []
  const sleeps: number[] = []
  const io: Io = {
    out: s => out.push(s),
    err: s => err.push(s),
    env,
    dir,
    dispatcher: agent,
    sleep: async ms => {
      sleeps.push(ms)
    },
    openUrl: () => true,
    isTTY: false,
    readStdin: () => '',
  }
  return { io, agent, out, err, sleeps }
}

export async function run(io: Io, args: string[]) {
  await buildProgram(io).parseAsync(args, { from: 'user' })
}

export const JSON_HEADERS = { headers: { 'content-type': 'application/json' } }
