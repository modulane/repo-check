// Dependabot updates the pinned actions as the reference does. A repository
// may add updates for its own package ecosystem, such as npm.
import { parse } from 'yaml'
import { differences, inProse } from '../compare.js'
import { fail, pass } from './findings.js'

const FILE = '.github/dependabot.yml'

const updatesOf = data => (Array.isArray(data?.updates) ? data.updates : [])

const key = update =>
  `${update['package-ecosystem']} in ${update.directory ?? '/'}`

export default {
  id: 'dependabot',
  title: 'Dependabot',
  async run({ reference, target }) {
    const text = await target.read(FILE)
    if (text === null) return [fail(`${FILE} is missing.`, { file: FILE })]
    let data
    try {
      data = parse(text)
    } catch (error) {
      return [
        fail(`${FILE} does not parse: ${error.message.split('\n')[0]}`, {
          file: FILE,
        }),
      ]
    }
    const expected = parse((await reference.read(FILE)) ?? '') ?? {}
    const actual = updatesOf(data)
    const findings = []
    for (const update of updatesOf(expected)) {
      const match = actual.find(other => key(other) === key(update))
      if (!match) {
        findings.push(
          fail(`${FILE} has no ${key(update)} update.`, { file: FILE }),
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
      if (paths.length > 0) {
        findings.push(
          fail(
            `The ${key(update)} update differs from the reference in ${inProse(paths.map(path => `\`${path}\``))}.`,
            { file: FILE },
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
