// The files every repository copies from the reference.
import { inProse, normalize } from '../compare.js'
import { boxText, completeTemplate } from '../edit.js'
import { copyOf, fail, pass } from './findings.js'

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
    .map(boxText)

const checkTemplate = (expected, actual) => {
  const where = {
    file: TEMPLATE,
    fix: {
      path: TEMPLATE,
      edit: text => text && completeTemplate(expected, text),
    },
  }
  const own = { headings: headings(actual), boxes: boxes(actual) }
  return [
    ...headings(expected)
      .filter(heading => !own.headings.includes(heading))
      .map(heading =>
        fail(
          `files:template:${heading}`,
          `${TEMPLATE} has no "${heading}" section.`,
          where,
        ),
      ),
    ...boxes(expected)
      .filter(box => !own.boxes.includes(box))
      .map(box =>
        fail(
          `files:template-box:${box}`,
          `${TEMPLATE} is missing the box "${box}".`,
          where,
        ),
      ),
  ]
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
      const where = { file: path, fix: copyOf(path, expected) }
      if (actual === null) {
        findings.push(fail(`files:${path}`, `${path} is missing.`, where))
      } else if (normalize(expected) !== normalize(actual)) {
        findings.push(
          fail(`files:${path}`, `${path} differs from the reference.`, where),
        )
      }
    }

    const [expected, actual] = await read(TEMPLATE)
    if (expected !== null) {
      if (actual === null) {
        findings.push(
          fail(`files:${TEMPLATE}`, `${TEMPLATE} is missing.`, {
            file: TEMPLATE,
            fix: copyOf(TEMPLATE, expected),
          }),
        )
      } else findings.push(...checkTemplate(expected, actual))
    }

    const [license, own] = await read('LICENSE')
    if (own === null) {
      findings.push(
        fail('files:LICENSE', 'LICENSE is missing.', {
          file: 'LICENSE',
          fix: license === null ? undefined : copyOf('LICENSE', license),
        }),
      )
    }

    if (findings.length === 0) {
      findings.push(
        pass(`${inProse([...SAME, TEMPLATE, 'LICENSE'])} match the reference.`),
      )
    }
    return findings
  },
}
