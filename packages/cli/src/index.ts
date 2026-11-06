import { CommanderError } from 'commander'
import { openBrowser } from './auth/device'
import { configDir } from './config'
import { defaultIo } from './io'
import { buildProgram } from './program'
import { updateNotice } from './update-check'
import { CliError } from './util'

const io = { ...defaultIo(configDir()), openUrl: openBrowser }
const program = buildProgram(io)
const notice = process.stderr.isTTY ? updateNotice(io.dir, io.env).catch(() => null) : Promise.resolve(null)

async function main() {
  try {
    await program.parseAsync(process.argv)
  } catch (e) {
    if (e instanceof CommanderError) process.exitCode = e.exitCode
    else if (e instanceof CliError) {
      io.err(`jeffi: ${e.message}`)
      if (e.data !== undefined && program.opts().json) io.out(JSON.stringify(e.data, null, 2))
      process.exitCode = e.exitCode
    } else {
      io.err(`jeffi: ${(e as Error)?.stack || String(e)}`)
      process.exitCode = 1
    }
  }
  const n = await notice
  if (n) io.err(n)
}

void main()
