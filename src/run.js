import ci from './checks/ci.js'
import dependabot from './checks/dependabot.js'
import files from './checks/files.js'
import { fail } from './checks/findings.js'
import labels from './checks/labels.js'
import pinnedActions from './checks/pinned-actions.js'
import release from './checks/release.js'
import rulesets from './checks/rulesets.js'
import security from './checks/security.js'
import settings from './checks/settings.js'
import sharedWorkflows from './checks/shared-workflows.js'
import { applyConfig, readConfig } from './config.js'
import { WORKFLOWS } from './workflows.js'

export const checks = [
  rulesets,
  settings,
  security,
  ci,
  pinnedActions,
  sharedWorkflows,
  release,
  dependabot,
  labels,
  files,
]

export class UnreadableReference extends Error {}

// A reference that cannot be read looks like an empty one, which every
// repository would match. GitHub answers 404 for a private repository the
// token cannot see, so check that the reference has workflows at all.
export const assertReference = async reference => {
  if ((await reference.list(WORKFLOWS)).length === 0) {
    throw new UnreadableReference(
      `${reference.name} has no ${WORKFLOWS}: it does not exist, or this token cannot read it.`,
    )
  }
}

// Runs the checks one after another, so the GitHub API sees one request at a
// time. A check that throws fails on its own and the others still run. Then
// the repository's .github/repo-check.yml marks the differences it accepts.
export const runChecks = async (
  context,
  only = checks.map(check => check.id),
) => {
  const results = []
  for (const check of checks.filter(check => only.includes(check.id))) {
    let findings
    try {
      findings = await check.run(context)
    } catch (error) {
      findings = [
        fail(`${check.id}:error`, `The check could not run: ${error.message}`),
      ]
    }
    results.push({ id: check.id, title: check.title, findings })
  }
  return applyConfig(results, await readConfig(context.target))
}

export const hasFailures = results =>
  results.some(result =>
    result.findings.some(finding => finding.level === 'fail'),
  )
