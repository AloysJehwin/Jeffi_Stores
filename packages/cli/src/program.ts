import { Command } from 'commander'
import { registerApi, registerGenerated } from './commands/api'
import { registerAuth } from './commands/auth'
import { registerCurated } from './commands/curated'
import { registerProfiles } from './commands/profiles'
import type { Io } from './io'
import type { ManifestRoute } from './manifest-types'
import { CLI_VERSION } from './util'

export function buildProgram(io: Io, routes?: ManifestRoute[]): Command {
  const program = new Command('jeffi')
    .description('Jeffi Stores admin and platform API from the terminal')
    .version(CLI_VERSION, '-v, --version')
    .option('-p, --profile <name>', 'profile to use (env JEFFI_PROFILE)')
    .option('--json', 'print raw JSON')
    .option('--host <url>', 'public API base URL override (env JEFFI_HOST)')
    .option('--direct', "call the store's admin host with the profile's .p12 instead of the public API")
    .showHelpAfterError('(add --help for usage)')
    .addHelpText(
      'after',
      `
Hosts: a profile points at one store. https://public-{slug}.jeffistores.in/v1/admin/… serves that
store; the flagship (and platform commands) use https://public.jeffistores.in. Local dev: --local.
Credentials: jeffi login (person, jfc_ token) or jeffi profiles add <name> --service-account jsa_….
Env: JEFFI_PROFILE, JEFFI_STORE, JEFFI_HOST, JEFFI_ADMIN_HOST, JEFFI_TOKEN, JEFFI_CERT, JEFFI_CERT_PASSWORD.`
    )
  program.exitOverride()
  program.configureOutput({ writeOut: s => io.out(s.replace(/\n$/, '')), writeErr: s => io.err(s.replace(/\n$/, '')) })
  registerAuth(program, io)
  registerProfiles(program, io)
  registerApi(program, io)
  registerCurated(program, io)
  registerGenerated(program, io, routes)
  return program
}
