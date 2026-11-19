#!/usr/bin/env node
// Creates one of the two GitHub Apps from a manifest and stores its ID and private key where the pipelines read
// them. Run it yourself, in your own terminal: the key goes from GitHub straight into the secrets (`gh secret set`
// on stdin), never to disk or the screen.
//
//   node oss/create-apps.mjs export    org-owned app the Jeffi_Stores export uses (Contents, Workflows, Issues)
//   node oss/create-apps.mjs promote   your app that opens promotion PRs on Jeffi_Stores (Contents, Pull requests)
//
// It opens GitHub's "Create GitHub App" page with everything filled in. Click Create; GitHub sends the browser back
// here, the key is stored, and the browser moves on to the app's Install page, where you pick the repos.
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const manifestFile = path.join(here, 'repos.json')
const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
const kind = process.argv[2]
if (!['export', 'promote'].includes(kind)) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n'))
  process.exit(kind ? 1 : 0)
}

const apps = {
  export: {
    createUrl: `https://github.com/organizations/${m.org}/settings/apps/new`,
    app: {
      name: 'Jeffi ERP Export',
      url: `https://github.com/${m.org}`,
      description: `Exports ${m.upstream.repo} to the ${m.org} repos (oss/export.mjs in ${m.upstream.repo}).`,
      default_permissions: { contents: 'write', workflows: 'write', issues: 'write', metadata: 'read' },
    },
    install: `Install it on ${m.org} with "All repositories".`,
    store(id, pem) {
      gh(['variable', 'set', 'OSS_EXPORT_APP_ID', '--env', 'oss-export', '--repo', m.upstream.repo, '--body', String(id)])
      gh(['secret', 'set', 'OSS_EXPORT_APP_KEY', '--env', 'oss-export', '--repo', m.upstream.repo], pem)
      return [`${m.upstream.repo} (environment oss-export)`]
    },
  },
  promote: {
    createUrl: 'https://github.com/settings/apps/new',
    app: {
      name: 'Jeffi ERP Promote',
      url: `https://github.com/${m.upstream.repo}`,
      description: `Opens approved ${m.org} contributions as pull requests on ${m.upstream.repo}.`,
      default_permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' },
    },
    install: `Install it on your account with "Only select repositories" → ${m.upstream.repo.split('/')[1]}.`,
    store(id, pem) {
      const done = []
      for (const r of m.repos) {
        gh(['variable', 'set', 'OSS_PROMOTE_APP_ID', '--env', 'promote', '--repo', `${m.org}/${r.name}`, '--body', String(id)])
        gh(['secret', 'set', 'OSS_PROMOTE_APP_KEY', '--env', 'promote', '--repo', `${m.org}/${r.name}`], pem)
        done.push(`${m.org}/${r.name} (environment promote)`)
      }
      return done
    },
  },
}[kind]

function gh(args, input) {
  execFileSync('gh', args, { input, stdio: [input ? 'pipe' : 'ignore', 'ignore', 'inherit'] })
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:16px system-ui;max-width:640px;margin:48px auto;padding:0 16px">${body}</body>`

const state = crypto.randomBytes(16).toString('hex')
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const redirect = `http://127.0.0.1:${server.address().port}/callback`
  if (url.pathname === '/') {
    const manifest = JSON.stringify({
      ...apps.app,
      hook_attributes: { url: apps.app.url, active: false },
      redirect_url: redirect,
      public: false,
      default_events: [],
    })
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page(`Create ${apps.app.name}`, `<p>Sending you to GitHub to create <b>${esc(apps.app.name)}</b>…</p>
<form id="f" method="post" action="${esc(`${apps.createUrl}?state=${state}`)}"><input type="hidden" name="manifest" value="${esc(manifest)}"><button>Continue to GitHub</button></form>
<script>document.getElementById('f').submit()</script>`))
    return
  }
  if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return }
  if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
    res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page('Not this request', '<p>That response doesn\'t match this run. Start again with the command.</p>'))
    return
  }
  try {
    const conv = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(url.searchParams.get('code'))}/conversions`, {
      method: 'POST', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'jeffi-erp-create-apps' },
    })
    const app = await conv.json()
    if (!conv.ok) throw new Error(`GitHub: ${conv.status} ${app.message ?? ''}`)
    const where = apps.store(app.id, app.pem)
    const text = fs.readFileSync(manifestFile, 'utf8')
    const ids = { ...(m.apps ?? {}), [kind]: app.id }
    fs.writeFileSync(manifestFile, text.replace(/"apps": \{[^}]*\}/, `"apps": { "export": ${ids.export ?? null}, "promote": ${ids.promote ?? null} }`))
    const installUrl = `https://github.com/apps/${app.slug}/installations/new`
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page('Stored', `<p><b>${esc(app.name)}</b> (App ID ${app.id}) is created and its key is stored.</p><p>Next: ${esc(apps.install)}</p><p><a href="${esc(installUrl)}">Install ${esc(app.name)}</a></p><script>setTimeout(() => location.href = ${JSON.stringify(installUrl)}, 1500)</script>`))
    console.log(`\nCreated ${app.name} (App ID ${app.id}, ${app.html_url}).`)
    console.log(`Stored its ID and key in:\n${where.map(w => `  ${w}`).join('\n')}`)
    console.log(`Recorded the ID in oss/repos.json.\n\nLast step, in the browser: ${apps.install}\n  ${installUrl}`)
    finish(0)
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page('Failed', `<p>${esc(e.message)}</p><p>Nothing was stored. Run the command again.</p>`))
    console.error(`Failed: ${e.message}`)
    finish(1)
  }
})

function finish(code) {
  setTimeout(() => { server.close(); process.exit(code) }, 500)
}
setTimeout(() => { console.error('No answer from GitHub in 15 minutes; stopping.'); process.exit(1) }, 15 * 60 * 1000).unref()

server.listen(0, '127.0.0.1', () => {
  const start = `http://127.0.0.1:${server.address().port}/`
  console.log(`Opening ${start} → GitHub's "Create GitHub App" page for ${apps.app.name}.`)
  console.log('On GitHub, check the name and click "Create GitHub App". Leave this running until it says it stored the key.')
  if (process.env.OSS_NO_OPEN) return
  spawn('open', [start], { stdio: 'ignore', detached: true }).on('error', () => console.log(`Open ${start} in your browser.`)).unref()
})
