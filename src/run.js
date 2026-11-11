import ci from './checks/ci.js'
import dependabot from './checks/dependabot.js'
import files from './checks/files.js'
import labels from './checks/labels.js'
import pinnedActions from './checks/pinned-actions.js'
import release from './checks/release.js'
import rulesets from './checks/rulesets.js'
import sharedWorkflows from './checks/shared-workflows.js'
import { fail } from './checks/findings.js'

export const checks = [
  rulesets,
  ci,
  pinnedActions,
  sharedWorkflows,
  release,
  dependabot,
  labels,
  files,
]

// Runs the checks one after another, so the GitHub API sees one request at a
// time. A check that throws fails on its own and the others still run.
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
      findings = [fail(`The check could not run: ${error.message}`)]
    }
    results.push({ id: check.id, title: check.title, findings })
  }
  return results
}

export const hasFailures = results =>
  results.some(result =>
    result.findings.some(finding => finding.level === 'fail'),
  )
