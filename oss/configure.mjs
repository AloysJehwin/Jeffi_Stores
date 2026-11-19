#!/usr/bin/env node
// Applies the Jeffi-ERP org's settings with the gh CLI (your login). Safe to re-run; each step is idempotent.
//
//   node oss/configure.mjs create      create the org repos that don't exist yet (public)
//   node oss/configure.mjs repos       descriptions, topics, merge settings, labels, Actions policy
//   node oss/configure.mjs team        the maintainers team, with Maintain on every repo (needs gh scope admin:org)
//   node oss/configure.mjs org         org profile and member privileges (needs gh scope admin:org)
//   node oss/configure.mjs protect     rulesets, the promote environment, security features (public repos on GitHub Free)
//   node oss/configure.mjs monorepo    the oss-export environment on Jeffi_Stores (main only)
//   node oss/configure.mjs public      make every org repo public (irreversible in practice: forks and clones stay)
//   node oss/configure.mjs pause|resume  turn the rulesets off and on (only to push managed files before the export app exists)
//   node oss/configure.mjs show        print what is configured
//
// App IDs come from repos.json "apps" (fill them in after creating the GitHub Apps; see oss/README.md).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'repos.json'), 'utf8'))
const org = manifest.org
const ACTIONS_APP_ID = 15368 // GitHub Actions: required checks must come from it
const repos = [...manifest.repos, { name: '.github', description: 'Community health files and the profile of the Jeffi ERP org.', topics: ['jeffi-erp', 'community'], community: true }]

function gh(args, body) {
  try {
    const out = execFileSync('gh', ['api', ...args, ...(body ? ['--input', '-'] : [])], { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return out.trim() ? JSON.parse(out) : null
  } catch (e) {
    const msg = `${e.stdout || ''}${e.stderr || ''}`.trim()
    const err = new Error(`gh api ${args.join(' ')}: ${msg}`)
    err.status = Number((msg.match(/HTTP (\d{3})/) || [])[1]) || null
    throw err
  }
}
const tryGh = (args, body) => { try { return gh(args, body) ?? {} } catch (e) { return { error: e } } }
const log = (repo, what) => console.log(`${repo.padEnd(20)} ${what}`)

const step = process.argv[2]
const owner = gh(['users/' + manifest.owner])

if (step === 'create') {
  for (const r of repos) {
    const got = tryGh([`repos/${org}/${r.name}`])
    if (!got.error) { log(r.name, `exists (${got.visibility})`); continue }
    gh(['-X', 'POST', `orgs/${org}/repos`], {
      name: r.name, description: r.description, homepage: manifest.homepage, visibility: 'public',
      has_wiki: false, has_projects: false, has_issues: true, auto_init: false,
    })
    log(r.name, 'created (public)')
  }
} else if (step === 'repos') {
  for (const r of repos) {
    gh(['-X', 'PATCH', `repos/${org}/${r.name}`], {
      description: r.description, homepage: manifest.homepage,
      has_wiki: false, has_projects: false, has_issues: true, has_discussions: !!r.discussions,
      allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, allow_auto_merge: false,
      delete_branch_on_merge: true, allow_update_branch: true,
      squash_merge_commit_title: 'PR_TITLE', squash_merge_commit_message: 'PR_BODY',
    })
    gh(['-X', 'PUT', `repos/${org}/${r.name}/topics`], { names: r.topics })
    if (!r.community) {
      for (const [name, color, description] of [
        [manifest.label, '0e8a16', 'A maintainer read this PR: run the checks (removed on every new push)'],
        ['sync-conflict', 'd93f0b', 'An export from Jeffi_Stores conflicts with changes here'],
        ['promotion-failed', 'b60205', 'A merged change could not be opened on Jeffi_Stores'],
        ['needs-triage', 'fbca04', 'New issue, not looked at yet'],
      ]) {
        const made = tryGh(['-X', 'POST', `repos/${org}/${r.name}/labels`], { name, color, description })
        if (made.error) gh(['-X', 'PATCH', `repos/${org}/${r.name}/labels/${encodeURIComponent(name)}`], { new_name: name, color, description })
      }
    }
    gh(['-X', 'PUT', `repos/${org}/${r.name}/actions/permissions/workflow`], { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false })
    const fork = tryGh(['-X', 'PUT', `repos/${org}/${r.name}/actions/permissions/fork-pr-contributor-approval`], { approval_policy: 'all_external_contributors' })
    log(r.name, `settings, topics${r.community ? '' : ', labels'}, Actions read-only token${fork.error ? ' (fork approval policy: not set, ' + fork.error.message.split('\n').pop() + ')' : ', fork PRs need approval'}`)
  }
} else if (step === 'team') {
  let team = tryGh([`orgs/${org}/teams/${manifest.maintainers}`])
  if (team.error) {
    team = gh(['-X', 'POST', `orgs/${org}/teams`], { name: manifest.maintainers, description: 'Label PRs ok-to-test, merge, and approve promotions to Jeffi_Stores', privacy: 'closed' })
    log(manifest.maintainers, `team created (id ${team.id})`)
  }
  for (const r of repos) {
    gh(['-X', 'PUT', `orgs/${org}/teams/${team.slug}/repos/${org}/${r.name}`], { permission: 'maintain' })
    log(r.name, `${team.slug}: maintain`)
  }
} else if (step === 'org') {
  gh(['-X', 'PATCH', `orgs/${org}`], {
    name: 'Jeffi ERP',
    description: 'The Jeffi Stores commerce platform, developed in the open: storefront, admin, B2B and multi-tenant SaaS for Indian merchants.',
    blog: manifest.homepage, email: 'support@jeffistores.in', location: 'India',
    default_repository_permission: 'read',
    members_can_create_repositories: false, members_can_create_public_repositories: false, members_can_create_private_repositories: false,
    members_can_delete_repositories: false, members_can_change_repo_visibility: false, members_can_fork_private_repositories: false,
    members_can_invite_outside_collaborators: false, members_can_create_teams: false, members_can_create_pages: false,
  })
  const fork = tryGh(['-X', 'PUT', `orgs/${org}/actions/permissions/fork-pr-contributor-approval`], { approval_policy: 'all_external_contributors' })
  const wf = tryGh(['-X', 'PUT', `orgs/${org}/actions/permissions/workflow`], { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false })
  log(org, `profile and member privileges set${fork.error ? '; fork approval: ' + fork.error.message.split('\n').pop() : ''}${wf.error ? '; workflow token: ' + wf.error.message.split('\n').pop() : ''}`)
} else if (step === 'protect') {
  const team = tryGh([`orgs/${org}/teams/${manifest.maintainers}`])
  const exportApp = manifest.apps?.export
  const bypassMerge = [
    { actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'pull_request' },
    ...(team.error ? [] : [{ actor_id: team.id, actor_type: 'Team', bypass_mode: 'pull_request' }]),
    ...(exportApp ? [{ actor_id: exportApp, actor_type: 'Integration', bypass_mode: 'always' }] : []),
  ]
  const onMain = { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } }
  for (const r of repos) {
    const rulesets = [
      {
        name: 'Merge gate',
        target: 'branch', enforcement: 'active', conditions: onMain,
        rules: [{ type: 'update', parameters: { update_allows_fetch_and_merge: false } }, { type: 'deletion' }, { type: 'non_fast_forward' }],
        bypass_actors: bypassMerge,
      },
      {
        name: 'Required checks',
        target: 'branch', enforcement: 'active', conditions: onMain,
        rules: [
          { type: 'pull_request', parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: true, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: true, allowed_merge_methods: ['squash'] } },
          ...(r.community ? [] : [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, do_not_enforce_on_create: false, required_status_checks: [{ context: 'PR checks', integration_id: ACTIONS_APP_ID }, { context: 'Guard', integration_id: ACTIONS_APP_ID }] } }]),
        ],
        bypass_actors: exportApp ? [{ actor_id: exportApp, actor_type: 'Integration', bypass_mode: 'always' }] : [],
      },
    ]
    const existing = gh([`repos/${org}/${r.name}/rulesets`]) ?? []
    for (const rs of rulesets) {
      const have = existing.find(x => x.name === rs.name)
      if (have) gh(['-X', 'PUT', `repos/${org}/${r.name}/rulesets/${have.id}`], rs)
      else gh(['-X', 'POST', `repos/${org}/${r.name}/rulesets`], rs)
    }
    let env = 'no promote environment (community repo)'
    if (!r.community) {
      gh(['-X', 'PUT', `repos/${org}/${r.name}/environments/promote`], {
        wait_timer: 0, prevent_self_review: false,
        reviewers: [{ type: 'User', id: owner.id }, ...(team.error ? [] : [{ type: 'Team', id: team.id }])],
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      })
      const policies = gh([`repos/${org}/${r.name}/environments/promote/deployment-branch-policies`])
      if (!policies.branch_policies.some(p => p.name === 'main')) gh(['-X', 'POST', `repos/${org}/${r.name}/environments/promote/deployment-branch-policies`], { name: 'main', type: 'branch' })
      env = 'promote environment (reviewers: owner' + (team.error ? '' : ', maintainers') + '; main only)'
    }
    const sec = tryGh(['-X', 'PATCH', `repos/${org}/${r.name}`], { security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } } })
    tryGh(['-X', 'PUT', `repos/${org}/${r.name}/private-vulnerability-reporting`])
    tryGh(['-X', 'PUT', `repos/${org}/${r.name}/vulnerability-alerts`])
    log(r.name, `rulesets (bypass: ${bypassMerge.map(b => b.actor_type).join(', ')}), ${env}${sec.error ? '; secret scanning: ' + sec.error.message.split('\n').pop() : ', secret scanning + push protection'}`)
  }
} else if (step === 'monorepo') {
  const up = manifest.upstream.repo
  gh(['-X', 'PUT', `repos/${up}/environments/oss-export`], { wait_timer: 0, deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } })
  const policies = gh([`repos/${up}/environments/oss-export/deployment-branch-policies`])
  if (!policies.branch_policies.some(p => p.name === manifest.upstream.branch)) gh(['-X', 'POST', `repos/${up}/environments/oss-export/deployment-branch-policies`], { name: manifest.upstream.branch, type: 'branch' })
  log(up, `oss-export environment (${manifest.upstream.branch} only)`)
} else if (step === 'pause' || step === 'resume') {
  for (const r of repos) {
    for (const rs of gh([`repos/${org}/${r.name}/rulesets`]) ?? []) {
      gh(['-X', 'PUT', `repos/${org}/${r.name}/rulesets/${rs.id}`], { enforcement: step === 'pause' ? 'disabled' : 'active' })
    }
    log(r.name, step === 'pause' ? 'rulesets disabled' : 'rulesets active')
  }
} else if (step === 'public') {
  for (const r of repos) {
    gh(['-X', 'PATCH', `repos/${org}/${r.name}`], { visibility: 'public' })
    log(r.name, 'public')
  }
} else if (step === 'show') {
  for (const r of repos) {
    const got = tryGh([`repos/${org}/${r.name}`])
    if (got.error) { log(r.name, 'missing'); continue }
    const rs = tryGh([`repos/${org}/${r.name}/rulesets`])
    const env = tryGh([`repos/${org}/${r.name}/environments`])
    log(r.name, `${got.visibility}; rulesets: ${rs.error ? 'n/a' : rs.map(x => x.name).join(', ') || 'none'}; environments: ${env.error ? 'n/a' : env.environments.map(e => e.name).join(', ') || 'none'}`)
  }
} else {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n'))
  process.exit(step ? 1 : 0)
}
