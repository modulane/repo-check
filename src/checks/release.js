// The Release workflow is set up for this repository, and semantic-release
// uses the reference's plugins. A package published to npm adds
// @semantic-release/npm, which is the one plugin the reference leaves out.
import { inProse } from '../compare.js'
import { readWorkflow } from '../workflows.js'
import { fail, pass } from './findings.js'

const RELEASERC = '.releaserc.json'
const NPM_PLUGIN = '@semantic-release/npm'

const pluginName = plugin => (Array.isArray(plugin) ? plugin[0] : plugin)

const checkWorkflow = async (target, repo) => {
  const release = await readWorkflow(target, 'release.yml')
  if (!release) {
    return [
      fail('.github/workflows/release.yml is missing.', {
        file: '.github/workflows/release.yml',
      }),
    ]
  }
  const where = { file: release.path }
  if (release.text.includes('REPO-NAME')) {
    return [
      fail(
        `${release.path} still names \`modulane/REPO-NAME\`, so it never releases.`,
        where,
      ),
    ]
  }
  const named = [
    ...release.text.matchAll(/github\.repository\s*==\s*'([^']+)'/g),
  ].map(match => match[1])
  if (
    repo &&
    named.length > 0 &&
    !named.every(name => name.toLowerCase() === repo.toLowerCase())
  ) {
    return [
      fail(
        `${release.path} releases only in ${inProse([...new Set(named)])}, not in ${repo}.`,
        where,
      ),
    ]
  }
  return [pass(`${release.path} releases from this repository.`)]
}

const parseJson = text => {
  try {
    return { data: JSON.parse(text) }
  } catch (error) {
    return { error: error.message }
  }
}

const checkConfig = async (reference, target) => {
  const expected = parseJson((await reference.read(RELEASERC)) ?? '{}').data
  const text = await target.read(RELEASERC)
  if (text === null)
    return [fail(`${RELEASERC} is missing.`, { file: RELEASERC })]
  const { data, error } = parseJson(text)
  if (error)
    return [fail(`${RELEASERC} does not parse: ${error}`, { file: RELEASERC })]

  const findings = []
  if (JSON.stringify(data.branches) !== JSON.stringify(expected?.branches)) {
    findings.push(
      fail(`${RELEASERC} releases from other branches than the reference.`, {
        file: RELEASERC,
      }),
    )
  }
  const names = list => (list ?? []).map(pluginName)
  const actual = names(data.plugins).filter(name => name !== NPM_PLUGIN)
  if (JSON.stringify(actual) !== JSON.stringify(names(expected?.plugins))) {
    findings.push(
      fail(
        `${RELEASERC} uses the plugins ${inProse(names(data.plugins))}, not the reference's ${inProse(names(expected?.plugins))} (and ${NPM_PLUGIN} for a package on npm).`,
        { file: RELEASERC },
      ),
    )
  }
  if (findings.length === 0) {
    findings.push(pass(`${RELEASERC} uses the reference's plugins.`))
  }
  return findings
}

export default {
  id: 'release',
  title: 'Release',
  async run({ reference, target, repo }) {
    return [
      ...(await checkWorkflow(target, repo)),
      ...(await checkConfig(reference, target)),
    ]
  },
}
