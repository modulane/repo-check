// .github/labels.json has every label of the reference, with the same color
// and description. A repository may add labels of its own.
import { copyOf, fail, pass } from './findings.js'

const FILE = '.github/labels.json'

// The reference's labels in its order, then the repository's own labels.
// Each fix writes the whole list, so the file reads the same whichever fix
// runs first.
const merged = (expected, actual) => {
  const names = new Set(expected.map(label => label.name.toLowerCase()))
  const own = actual.filter(
    label => !names.has(String(label.name).toLowerCase()),
  )
  return `${JSON.stringify([...expected, ...own], null, 2)}\n`
}

export default {
  id: 'labels',
  title: 'Labels',
  async run({ reference, target }) {
    const expectedText = (await reference.read(FILE)) ?? '[]'
    const expected = JSON.parse(expectedText)
    const text = await target.read(FILE)
    if (text === null) {
      return [
        fail('labels:missing', `${FILE} is missing.`, {
          file: FILE,
          fix: copyOf(FILE, expectedText),
        }),
      ]
    }
    let actual
    try {
      actual = JSON.parse(text)
    } catch (error) {
      return [
        fail('labels:parse', `${FILE} does not parse: ${error.message}`, {
          file: FILE,
        }),
      ]
    }
    if (!Array.isArray(actual)) actual = []
    const byName = new Map(
      actual.map(label => [String(label.name).toLowerCase(), label]),
    )
    const where = { file: FILE, fix: copyOf(FILE, merged(expected, actual)) }
    const findings = []
    for (const label of expected) {
      const match = byName.get(label.name.toLowerCase())
      if (!match) {
        findings.push(
          fail(
            `labels:${label.name}`,
            `${FILE} is missing "${label.name}".`,
            where,
          ),
        )
      } else if (
        match.name !== label.name ||
        String(match.color).toLowerCase() !== label.color.toLowerCase() ||
        (match.description ?? '') !== (label.description ?? '')
      ) {
        findings.push(
          fail(
            `labels:${label.name}`,
            `"${label.name}" has another name, color or description than in the reference.`,
            where,
          ),
        )
      }
    }
    if (findings.length === 0) {
      findings.push(
        pass(`${FILE} has the ${expected.length} labels of the reference.`),
      )
    }
    return findings
  },
}
