import { styleText } from 'node:util'

const MARKS = {
  pass: ['✓', 'green'],
  fail: ['✗', 'red'],
  warn: ['!', 'yellow'],
  skip: ['–', 'gray'],
  accepted: ['~', 'gray'],
}

const location = finding =>
  finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : ''

export const countFailures = results =>
  results.filter(result =>
    result.findings.some(finding => finding.level === 'fail'),
  ).length

export const formatText = (
  { target, reference, results, fixed },
  { color = false } = {},
) => {
  const paint = (style, text) => (color ? styleText(style, text) : text)
  const lines = [`Checking ${target} against ${reference}`, '']
  for (const result of results) {
    lines.push(paint('bold', result.title))
    for (const finding of result.findings) {
      const [mark, style] = MARKS[finding.level]
      // A path in the message already says where; a line number adds to it.
      const where = finding.line ? paint('gray', ` (${location(finding)})`) : ''
      const message =
        finding.level === 'accepted'
          ? `${finding.message} Accepted: ${finding.reason}`
          : finding.message
      // The id is what .github/repo-check.yml accepts.
      const id =
        finding.id && finding.level !== 'pass'
          ? paint('gray', ` [${finding.id}]`)
          : ''
      const fixable = finding.fix ? paint('gray', ' (fixable)') : ''
      lines.push(`  ${paint(style, mark)} ${message}${where}${fixable}${id}`)
    }
    lines.push('')
  }
  if (fixed) {
    lines.push(
      fixed.files.length === 0
        ? 'Nothing to fix.'
        : `Fixed ${fixed.findings} finding${fixed.findings === 1 ? '' : 's'} in ${fixed.files.join(', ')}.`,
      '',
    )
  }
  const failed = countFailures(results)
  lines.push(
    failed === 0
      ? paint('green', `No drift: all ${results.length} checks passed.`)
      : paint('red', `${failed} of ${results.length} checks found drift.`),
  )
  return lines.join('\n')
}

// Fixes are functions, so the JSON says only whether a finding has one.
export const formatJson = ({ target, reference, results, fixed }) =>
  JSON.stringify(
    {
      target,
      reference,
      results: results.map(result => ({
        ...result,
        findings: result.findings.map(({ fix, ...finding }) => ({
          ...finding,
          ...(fix && { fixable: true }),
        })),
      })),
      ...(fixed && { fixed }),
    },
    null,
    2,
  )
