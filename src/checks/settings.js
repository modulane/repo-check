// The repository settings match the reference's settings.json: squash
// merges only, the pull request title as the commit title, branches deleted
// after the merge. They are read from GitHub, and no pull request can fix
// them: `gh api -X PATCH repos/OWNER/REPO --input settings.json` does.
import { fail, pass, skip } from './findings.js'

const FILE = 'settings.json'

const show = value => (typeof value === 'string' ? `"${value}"` : String(value))

export default {
  id: 'settings',
  title: 'Repository settings',
  async run({ reference, github, repo }) {
    if (!repo) {
      return [
        skip(
          'Not a GitHub repository: name it with --repo to check its settings.',
        ),
      ]
    }
    const text = await reference.read(FILE)
    if (text === null) {
      return [skip(`The reference has no ${FILE} to compare with.`)]
    }
    const expected = JSON.parse(text)
    const { status, data } = await github.get(`/repos/${repo}`)
    github.assertOk(status, data, `read the settings of ${repo}`)

    const findings = []
    const hidden = []
    for (const [key, value] of Object.entries(expected)) {
      if (data[key] === undefined) hidden.push(key)
      else if (data[key] !== value) {
        findings.push(
          fail(
            `settings:${key}`,
            `\`${key}\` is ${show(data[key])}, the reference ${show(value)}.`,
          ),
        )
      }
    }
    // GitHub leaves out the merge settings for a token that cannot push.
    if (hidden.length > 0) {
      findings.push(
        skip(
          `GitHub does not show ${hidden.map(key => `\`${key}\``).join(', ')} with this token: it needs write access to ${repo}.`,
        ),
      )
    }
    if (!findings.some(finding => finding.level === 'fail')) {
      findings.unshift(
        pass(
          `${Object.keys(expected).length - hidden.length} settings match the reference.`,
        ),
      )
    }
    return findings
  },
}
