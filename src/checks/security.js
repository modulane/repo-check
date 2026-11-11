// The security settings match the reference's security.json: Dependabot
// alerts and security updates, secret scanning and push protection, private
// vulnerability reporting, and approval for workflows from a first-time
// contributor's fork. Each lives behind its own endpoint, and no pull
// request can change them.
//
// GitHub offers secret scanning, private vulnerability reporting and the
// fork approval setting to public repositories only on its Free plan, so a
// private repository skips them.
import { fail, pass, skip } from './findings.js'

const FILE = 'security.json'

const show = value =>
  typeof value === 'boolean'
    ? value
      ? 'on'
      : 'off'
    : typeof value === 'string'
      ? `"${value}"`
      : String(value)

// Each setting's value on GitHub, or undefined when this token cannot see it.
const analysis = key => async (github, repo, data) => {
  const value = data.security_and_analysis?.[key]?.status
  return value === undefined ? undefined : value === 'enabled'
}

const settings = {
  vulnerability_alerts: {
    // 204 when the alerts are on, 404 when they are off, but also 404 for a
    // token that is not an admin, as a user token says it is.
    async read(github, repo, data) {
      const { status } = await github.get(`/repos/${repo}/vulnerability-alerts`)
      if (status === 204) return true
      return status === 404 && data.permissions?.admin !== false
        ? false
        : undefined
    },
  },
  automated_security_fixes: {
    async read(github, repo) {
      const { status, data } = await github.get(
        `/repos/${repo}/automated-security-fixes`,
      )
      return status === 200 ? data.enabled : undefined
    },
  },
  secret_scanning: { publicOnly: true, read: analysis('secret_scanning') },
  secret_scanning_push_protection: {
    publicOnly: true,
    read: analysis('secret_scanning_push_protection'),
  },
  private_vulnerability_reporting: {
    publicOnly: true,
    async read(github, repo) {
      const { status, data } = await github.get(
        `/repos/${repo}/private-vulnerability-reporting`,
      )
      return status === 200 ? data.enabled : undefined
    },
  },
  fork_pr_approval: {
    publicOnly: true,
    async read(github, repo) {
      const { status, data } = await github.get(
        `/repos/${repo}/actions/permissions/fork-pr-contributor-approval`,
      )
      return status === 200 ? data.approval_policy : undefined
    },
  },
}

export default {
  id: 'security',
  title: 'Security settings',
  async run({ reference, github, repo }) {
    if (!repo) {
      return [
        skip(
          'Not a GitHub repository: name it with --repo to check its security settings.',
        ),
      ]
    }
    const text = await reference.read(FILE)
    if (text === null) {
      return [skip(`The reference has no ${FILE} to compare with.`)]
    }
    const expected = JSON.parse(text)
    const unknown = Object.keys(expected).filter(key => !settings[key])
    const { status, data } = await github.get(`/repos/${repo}`)
    github.assertOk(status, data, `read the settings of ${repo}`)
    const findings = []
    const hidden = []
    const publicOnly = []
    let matching = 0
    for (const [key, value] of Object.entries(expected)) {
      const setting = settings[key]
      if (!setting) continue
      if (setting.publicOnly && data.private) {
        publicOnly.push(key)
        continue
      }
      const actual = await setting.read(github, repo, data)
      if (actual === undefined) hidden.push(key)
      else if (actual !== value) {
        findings.push(
          fail(
            `security:${key}`,
            `\`${key}\` is ${show(actual)}, the reference ${show(value)}.`,
          ),
        )
      } else matching += 1
    }
    if (unknown.length > 0) {
      findings.push(
        skip(
          `repo-check does not know ${unknown.map(key => `\`${key}\``).join(', ')} in ${FILE}.`,
        ),
      )
    }
    if (publicOnly.length > 0) {
      findings.push(
        skip(
          `${repo} is private, and GitHub's Free plan offers ${publicOnly.map(key => `\`${key}\``).join(', ')} to public repositories only.`,
        ),
      )
    }
    if (hidden.length > 0) {
      findings.push(
        skip(
          `GitHub does not show ${hidden.map(key => `\`${key}\``).join(', ')} with this token: it needs read access to the administration of ${repo}.`,
        ),
      )
    }
    if (!findings.some(finding => finding.level === 'fail') && matching > 0) {
      findings.unshift(
        pass(
          `${matching} security setting${matching === 1 ? ' matches' : 's match'} the reference.`,
        ),
      )
    }
    return findings
  },
}
