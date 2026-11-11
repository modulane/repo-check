// Dependabot updates the pinned actions as the reference does. A repository
// may add updates for its own package ecosystem, such as npm.
import { parse, parseDocument } from 'yaml'
import { differences } from '../compare.js'
import { copyOf, fail, pass } from './findings.js'

const FILE = '.github/dependabot.yml'

const updatesOf = data => (Array.isArray(data?.updates) ? data.updates : [])

const key = update =>
  `${update['package-ecosystem']} in ${update.directory ?? '/'}`

// The reference's file when the repository has nothing of its own in it.
// Otherwise the reference's update replaces the repository's one, with the
// reference's comments, and the rest of the file stays.
const fixFor = (expectedText, expected, data, update) => {
  const own = Object.keys(data ?? {}).filter(
    name => !['version', 'updates'].includes(name),
  )
  const others = updatesOf(data).filter(other => key(other) !== key(update))
  if (own.length === 0 && others.length === 0) return copyOf(FILE, expectedText)
  return {
    path: FILE,
    edit: text => {
      if (!text) return null
      const doc = parseDocument(text)
      const ref = parseDocument(expectedText)
      const index = updatesOf(expected).indexOf(update)
      const node = ref.getIn(['updates', index], true)
      const at = updatesOf(data).findIndex(other => key(other) === key(update))
      if (at === -1) doc.addIn(['updates'], node)
      else doc.setIn(['updates', at], node)
      return doc.toString({ lineWidth: 0 })
    },
  }
}

export default {
  id: 'dependabot',
  title: 'Dependabot',
  async run({ reference, target }) {
    const expectedText = (await reference.read(FILE)) ?? ''
    const text = await target.read(FILE)
    if (text === null) {
      return [
        fail('dependabot:missing', `${FILE} is missing.`, {
          file: FILE,
          fix: copyOf(FILE, expectedText),
        }),
      ]
    }
    let data
    try {
      data = parse(text)
    } catch (error) {
      return [
        fail(
          'dependabot:parse',
          `${FILE} does not parse: ${error.message.split('\n')[0]}`,
          {
            file: FILE,
          },
        ),
      ]
    }
    const expected = parse(expectedText) ?? {}
    const actual = updatesOf(data)
    const findings = []
    for (const update of updatesOf(expected)) {
      const id = `dependabot:${update['package-ecosystem']}`
      const fix = fixFor(expectedText, expected, data, update)
      const match = actual.find(other => key(other) === key(update))
      if (!match) {
        findings.push(
          fail(`${id}:missing`, `${FILE} has no ${key(update)} update.`, {
            file: FILE,
            fix,
          }),
        )
        continue
      }
      // Both ways, so a setting the reference does not have is drift too.
      const paths = [
        ...new Set([
          ...differences(update, match),
          ...differences(match, update),
        ]),
      ]
      for (const path of paths) {
        findings.push(
          fail(
            `${id}:${path}`,
            `The ${key(update)} update differs from the reference in \`${path}\`.`,
            { file: FILE, fix },
          ),
        )
      }
    }
    if (findings.length === 0) {
      findings.push(pass(`${FILE} updates the actions as the reference does.`))
    }
    return findings
  },
}
