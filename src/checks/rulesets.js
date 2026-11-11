// The rulesets on the default branch match the reference's rulesets/*.json:
// the main ruleset and the maintainer review ruleset. They live in the
// repository settings, not in its files, so this check reads them from
// GitHub.
import { differences, inProse } from '../compare.js'
import { fail, pass, skip, warn } from './findings.js'

const DIR = 'rulesets'

const code = paths => inProse(paths.map(path => `\`${path}\``))

const compareRules = (expected = [], actual = []) => {
  const findings = []
  for (const rule of expected) {
    const match = actual.find(other => other.type === rule.type)
    if (!match) {
      findings.push(`no \`${rule.type}\` rule`)
      continue
    }
    const paths = differences(rule.parameters ?? {}, match.parameters ?? {})
    if (paths.length > 0) {
      findings.push(
        `${code(paths.map(path => `${rule.type}.${path}`.replace(/\.$/, '')))}`,
      )
    }
  }
  const extra = actual
    .map(rule => rule.type)
    .filter(type => !expected.some(rule => rule.type === type))
  return { findings, extra }
}

const compareRuleset = (expected, actual) => {
  const { name, rules, bypass_actors: bypass, ...rest } = expected
  const problems = []
  const notes = []

  const paths = differences(rest, actual)
  if (paths.length > 0) problems.push(code(paths))

  const compared = compareRules(rules, actual.rules)
  problems.push(...compared.findings)
  if (compared.extra.length > 0) {
    notes.push(
      warn(
        `"${name}" has rules the reference does not: ${code(compared.extra)}.`,
      ),
    )
  }

  // GitHub only shows who can bypass a ruleset to repository admins.
  if (bypass !== undefined) {
    if (actual.bypass_actors === undefined) {
      notes.push(
        skip(
          `The bypass list of "${name}" is only visible with admin access to the repository.`,
        ),
      )
    } else if (differences(bypass, actual.bypass_actors).length > 0) {
      problems.push('`bypass_actors`')
    }
  }

  if (problems.length > 0) {
    return [
      fail(`"${name}" differs from the reference: ${problems.join(', ')}.`),
      ...notes,
    ]
  }
  return [pass(`"${name}" matches the reference.`), ...notes]
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
