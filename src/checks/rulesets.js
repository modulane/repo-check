// The rulesets on the default branch match the reference's rulesets/*.json:
// the main ruleset and the maintainer review ruleset. They live in the
// repository settings, not in its files, so this check reads them from
// GitHub, and no pull request can fix them.
import { differences, inProse } from '../compare.js'
import { fail, pass, skip, warn } from './findings.js'

const DIR = 'rulesets'

const compareRuleset = (expected, actual) => {
  const { name, rules = [], bypass_actors: bypass, ...rest } = expected
  const id = `rulesets:${name}`
  const differs = path =>
    fail(
      `${id}:${path}`,
      `"${name}" differs from the reference in \`${path}\`.`,
    )
  const findings = differences(rest, actual).map(differs)

  for (const rule of rules) {
    const match = (actual.rules ?? []).find(other => other.type === rule.type)
    if (!match) {
      findings.push(
        fail(`${id}:${rule.type}`, `"${name}" has no \`${rule.type}\` rule.`),
      )
      continue
    }
    for (const path of differences(
      rule.parameters ?? {},
      match.parameters ?? {},
    )) {
      findings.push(differs(`${rule.type}.${path}`.replace(/\.$/, '')))
    }
  }

  for (const rule of actual.rules ?? []) {
    if (!rules.some(other => other.type === rule.type)) {
      findings.push(
        warn(
          `${id}:${rule.type}`,
          `"${name}" has a \`${rule.type}\` rule that the reference does not.`,
        ),
      )
    }
  }

  // GitHub only shows who can bypass a ruleset to repository admins.
  if (bypass !== undefined) {
    if (actual.bypass_actors === undefined) {
      findings.push(
        skip(
          `The bypass list of "${name}" is only visible with admin access to the repository.`,
        ),
      )
    } else if (differences(bypass, actual.bypass_actors).length > 0) {
      findings.push(differs('bypass_actors'))
    }
  }

  if (!findings.some(finding => finding.level === 'fail')) {
    findings.unshift(pass(`"${name}" matches the reference.`))
  }
  return findings
}

export default {
  id: 'rulesets',
  title: 'Rulesets',
  async run({ reference, github, repo }) {
    if (!repo) {
      return [
        skip(
          'Not a GitHub repository: name it with --repo to check its rulesets.',
        ),
      ]
    }
    const expected = []
    for (const file of await reference.list(DIR)) {
      if (file.endsWith('.json')) {
        expected.push(JSON.parse(await reference.read(`${DIR}/${file}`)))
      }
    }
    if (expected.length === 0) {
      return [skip(`The reference has no ${DIR}/*.json to compare with.`)]
    }

    const { status, data } = await github.get(
      `/repos/${repo}/rulesets?includes_parents=true&per_page=100`,
    )
    if (status === 403 && /upgrade|public/i.test(data?.message ?? '')) {
      return [
        skip(
          `GitHub has no rulesets for ${repo}: on the Free plan, they only work on public repositories.`,
        ),
      ]
    }
    github.assertOk(status, data, `list the rulesets of ${repo}`)

    const findings = []
    for (const ruleset of expected) {
      const summary = data.find(
        other =>
          other.target === (ruleset.target ?? 'branch') &&
          other.name.toLowerCase() === ruleset.name.toLowerCase(),
      )
      if (!summary) {
        const names = data.map(other => `"${other.name}"`)
        findings.push(
          fail(
            `rulesets:${ruleset.name}`,
            `${repo} has no "${ruleset.name}" ruleset${names.length > 0 ? `, only ${inProse(names)}` : ''}.`,
          ),
        )
        continue
      }
      const detail = await github.get(`/repos/${repo}/rulesets/${summary.id}`)
      github.assertOk(
        detail.status,
        detail.data,
        `read the "${ruleset.name}" ruleset of ${repo}`,
      )
      findings.push(...compareRuleset(ruleset, detail.data))
    }
    return findings
  },
}
