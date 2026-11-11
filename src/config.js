// .github/repo-check.yml lists the differences from the reference that a
// repository keeps on purpose, each with the reason:
//
//   accept:
//     - finding: 'rulesets:main ruleset:required_status_checks.*'
//       reason: The workflows run here directly, so their checks have no prefix.
//
// `finding` is the id of a failure or a warning, as the report prints it,
// and `*` matches any text. An accepted finding neither fails the run nor
// gets fixed. An entry that matches nothing any more is reported, so the list
// never keeps a difference that is gone.
import { parse } from 'yaml'
import { fail, warn } from './checks/findings.js'

export const CONFIG = '.github/repo-check.yml'

const toPattern = glob =>
  new RegExp(
    `^${glob
      .split('*')
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  )

export const readConfig = async target => {
  const text = await target.read(CONFIG)
  if (text === null) return { exists: false, accept: [], problems: [] }
  let data
  try {
    data = parse(text) ?? {}
  } catch (error) {
    return {
      exists: true,
      accept: [],
      problems: [`${CONFIG} does not parse: ${error.message.split('\n')[0]}`],
    }
  }
  const problems = []
  const accept = []
  const entries = data.accept ?? []
  if (!Array.isArray(entries)) problems.push('`accept` must be a list.')
  else {
    entries.forEach((entry, index) => {
      const where = `\`accept[${index}]\``
      if (typeof entry?.finding !== 'string' || entry.finding.trim() === '') {
        problems.push(`${where} needs a \`finding\`.`)
      } else if (
        typeof entry.reason !== 'string' ||
        entry.reason.trim() === ''
      ) {
        problems.push(
          `${where} needs a \`reason\` for accepting "${entry.finding}".`,
        )
      } else {
        accept.push({
          finding: entry.finding,
          reason: entry.reason.trim(),
          pattern: toPattern(entry.finding),
        })
      }
    })
  }
  const unknown = Object.keys(data).filter(key => key !== 'accept')
  if (unknown.length > 0) {
    problems.push(
      `Unknown keys: ${unknown.map(key => `\`${key}\``).join(', ')}.`,
    )
  }
  return { exists: true, accept, problems }
}

// Marks the accepted findings, and adds a result for the configuration
// itself when the repository has one.
export const applyConfig = (results, config) => {
  const used = new Set()
  const marked = results.map(result => ({
    ...result,
    findings: result.findings.map(finding => {
      if (!finding.id || !['fail', 'warn'].includes(finding.level))
        return finding
      const entry = config.accept.find(other => other.pattern.test(finding.id))
      if (!entry) return finding
      used.add(entry)
      const { fix, ...rest } = finding
      return {
        ...rest,
        level: 'accepted',
        was: finding.level,
        reason: entry.reason,
      }
    }),
  }))
  if (!config.exists) return marked
  const findings = [
    ...config.problems.map(problem =>
      fail('config', problem, { file: CONFIG }),
    ),
    // An entry for a check that did not run, with --only, may still be
    // needed.
    ...config.accept
      .filter(entry => !used.has(entry))
      .filter(entry => {
        const check = toPattern(entry.finding.split(':')[0])
        return results.some(result => check.test(result.id))
      })
      .map(entry =>
        warn(
          `config:${entry.finding}`,
          `${CONFIG} accepts \`${entry.finding}\`, which no longer differs: remove it.`,
          { file: CONFIG },
        ),
      ),
  ]
  return [
    ...marked,
    {
      id: 'config',
      title: 'Accepted differences',
      findings:
        findings.length > 0
          ? findings
          : [
              {
                level: 'pass',
                message: `${CONFIG} accepts ${config.accept.length} difference${config.accept.length === 1 ? '' : 's'}.`,
              },
            ],
    },
  ]
}
