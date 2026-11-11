// The files every repository copies from the reference.
import { inProse, normalize } from '../compare.js'
import { fail, pass } from './findings.js'

// Copied as they are.
const SAME = ['.editorconfig', '.gitattributes', '.github/CODEOWNERS']

const TEMPLATE = '.github/PULL_REQUEST_TEMPLATE.md'

const headings = text =>
  normalize(text)
    .split('\n')
    .filter(line => /^## /.test(line))
    .map(line => line.slice(3).trim())

const boxes = text =>
  normalize(text)
    .split('\n')
    .filter(line => /^\s*- \[[ xX]\] /.test(line))
    .map(line => line.replace(/^\s*- \[[ xX]\] /, '').trim())

const checkTemplate = (expected, actual) => {
  const missingHeadings = headings(expected).filter(
    heading => !headings(actual).includes(heading),
  )
  const missingBoxes = boxes(expected).filter(
    box => !boxes(actual).includes(box),
  )
  const findings = []
  if (missingHeadings.length > 0) {
    findings.push(
      fail(
        `${TEMPLATE} has no ${inProse(missingHeadings.map(heading => `"${heading}"`))} section.`,
        { file: TEMPLATE },
      ),
    )
  }
  if (missingBoxes.length > 0) {
    findings.push(
      fail(
        `${TEMPLATE} is missing the ${missingBoxes.length > 1 ? 'boxes' : 'box'} ${inProse(missingBoxes.map(box => `"${box}"`))}.`,
        { file: TEMPLATE },
      ),
    )
  }
  return findings
}

export default {
  id: 'files',
  title: 'Repository files',
  async run({ reference, target }) {
    const findings = []
    const read = async path => [
      await reference.read(path),
      await target.read(path),
    ]

    for (const path of SAME) {
      const [expected, actual] = await read(path)
      if (expected === null) continue
      if (actual === null)
        findings.push(fail(`${path} is missing.`, { file: path }))
      else if (normalize(expected) !== normalize(actual)) {
        findings.push(
          fail(`${path} differs from the reference.`, { file: path }),
        )
      }
    }

    const [expected, actual] = await read(TEMPLATE)
    if (expected !== null) {
      if (actual === null)
        findings.push(fail(`${TEMPLATE} is missing.`, { file: TEMPLATE }))
      else findings.push(...checkTemplate(expected, actual))
    }

    if ((await target.read('LICENSE')) === null) {
      findings.push(fail('LICENSE is missing.', { file: 'LICENSE' }))
    }

    if (findings.length === 0) {
      findings.push(
        pass(`${inProse([...SAME, TEMPLATE, 'LICENSE'])} match the reference.`),
      )
    }
    return findings
  },
}
