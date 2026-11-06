import fs from 'node:fs'
import type { Command } from 'commander'
import type { Dispatcher } from 'undici'
import { resolveContext, type Context, type GlobalOpts } from './config'
import { format } from './output'

export interface Io {
  out: (s: string) => void
  err: (s: string) => void
  env: NodeJS.ProcessEnv
  dir: string
  /** Tests inject an undici MockAgent here. */
  dispatcher?: Dispatcher
  sleep: (ms: number) => Promise<void>
  openUrl: (url: string) => boolean
  isTTY: boolean
  readStdin: () => string
}

export function defaultIo(dir: string): Io {
  return {
    out: s => process.stdout.write(s.endsWith('\n') ? s : s + '\n'),
    err: s => process.stderr.write(s.endsWith('\n') ? s : s + '\n'),
    env: process.env,
    dir,
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    openUrl: () => false,
    isTTY: !!process.stdout.isTTY,
    readStdin: () => fs.readFileSync(0, 'utf8'),
  }
}

export type GlobalFlags = GlobalOpts & { json?: boolean }

export const globals = (cmd: Command) => cmd.optsWithGlobals() as GlobalFlags

export const contextOf = (io: Io, cmd: Command): Context => resolveContext(globals(cmd), io.env, io.dir)

/** Prints `data` as JSON with --json, else through `render` (or the generic table/record view). */
export function emit(io: Io, cmd: Command, data: unknown, render?: (d: unknown) => string) {
  if (globals(cmd).json) io.out(JSON.stringify(data, null, 2))
  else io.out(render ? render(data) : format(data))
}
