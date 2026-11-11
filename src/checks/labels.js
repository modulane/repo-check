// .github/labels.json has every label of the reference, with the same color
// and description. A repository may add labels of its own.
import { inProse } from '../compare.js'
import { fail, pass } from './findings.js'

const FILE = '.github/labels.json'

const quoted = names => inProse(names.map(name => `"${name}"`))

export default {
  id: 'labels',
  title: 'Labels',
  async run({ reference, target }) {
    const text = await target.read(FILE)
    if (text === null) return [fail(`${FILE} is missing.`, { file: FILE })]
    let actual
    try {
      actual = JSON.parse(text)
    } catch (error) {
      return [fail(`${FILE} does not parse: ${error.message}`, { file: FILE })]
    }
    const expected = JSON.parse((await reference.read(FILE)) ?? '[]')
    const byName = new Map(
      (Array.isArray(actual) ? actual : []).map(label => [
        String(label.name).toLowerCase(),
        label,
      ]),
    )
    const missing = []
    const changed = []
    for (const label of expected) {
      const match = byName.get(label.name.toLowerCase())
      if (!match) missing.push(label.name)
      else if (
        match.name !== label.name ||
        String(match.color).toLowerCase() !== label.color.toLowerCase() ||
        (match.description ?? '') !== (label.description ?? '')
      ) {
        changed.push(label.name)
      }
    }
    const findings = []
    if (missing.length > 0) {
      findings.push(
        fail(`${FILE} is missing ${quoted(missing)}.`, { file: FILE }),
      )
    }
    if (changed.length > 0) {
      findings.push(
        fail(
          `${quoted(changed)} ${changed.length > 1 ? 'have' : 'has'} another name, color or description than in the reference.`,
          { file: FILE },
        ),
      )
    }
    if (findings.length === 0) {
      findings.push(
        pass(`${FILE} has the ${expected.length} labels of the reference.`),
      )
    }
    return findings
  },
}
