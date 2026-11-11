import { styleText } from 'node:util'

const MARKS = {
  pass: ['✓', 'green'],
  fail: ['✗', 'red'],
  warn: ['!', 'yellow'],
  skip: ['–', 'gray'],
}

const location = finding =>
  finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : ''

export const formatText = (
  { target, reference, results },
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
      lines.push(`  ${paint(style, mark)} ${finding.message}${where}`)
    }
    lines.push('')
  }
  const failed = results.filter(result =>
    result.findings.some(finding => finding.level === 'fail'),
  ).length
  lines.push(
    failed === 0
      ? paint('green', `No drift: all ${results.length} checks passed.`)
      : paint('red', `${failed} of ${results.length} checks found drift.`),
  )
  return lines.join('\n')
}

export const formatJson = ({ target, reference, results }) =>
  JSON.stringify({ target, reference, results }, null, 2)
