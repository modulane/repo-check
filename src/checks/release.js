// The Release workflow is set up for this repository, and semantic-release
// uses the reference's plugins. A package published to npm adds
// @semantic-release/npm, which is the one plugin the reference leaves out.
import { inProse } from '../compare.js'
import { readWorkflow } from '../workflows.js'
import { copyOf, fail, pass } from './findings.js'

const RELEASE = '.github/workflows/release.yml'
const RELEASERC = '.releaserc.json'
const NPM_PLUGIN = '@semantic-release/npm'
const GITHUB_PLUGIN = '@semantic-release/github'

const pluginName = plugin => (Array.isArray(plugin) ? plugin[0] : plugin)

// The template's REPO-NAME, and the comment that explains it.
const nameRepository = (text, repo) =>
  text
    .replace(
      /^[ \t]*# Replace REPO-NAME[^\n]*\n(?:[ \t]*#[^\n]*repo-template\.\n)?/m,
      '',
    )
    .replaceAll('modulane/REPO-NAME', repo)

const checkWorkflow = async (target, repo) => {
  const release = await readWorkflow(target, 'release.yml')
  if (!release) {
    return [
      fail('release:missing', `${RELEASE} is missing.`, { file: RELEASE }),
    ]
  }
  const where = { file: RELEASE }
  if (release.text.includes('REPO-NAME')) {
    return [
      fail(
        'release:repo-name',
        `${RELEASE} still names \`modulane/REPO-NAME\`, so it never releases.`,
        {
          ...where,
          fix: repo && {
            path: RELEASE,
            edit: text => text && nameRepository(text, repo),
          },
        },
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
        'release:repository',
        `${RELEASE} releases only in ${inProse([...new Set(named)])}, not in ${repo}.`,
        where,
      ),
    ]
  }
  return [pass(`${RELEASE} releases from this repository.`)]
}

const parseJson = text => {
  try {
    return { data: JSON.parse(text) }
  } catch (error) {
    return { error: error.message }
  }
}

// The reference's text, with the npm plugin before the GitHub one when the
// repository publishes to npm. A plugin with options is left to a person.
const configFix = (expectedText, data) => {
  const npm = (data?.plugins ?? []).find(
    plugin => pluginName(plugin) === NPM_PLUGIN,
  )
  if (!npm) return copyOf(RELEASERC, expectedText)
  if (typeof npm !== 'string') return undefined
  return {
    path: RELEASERC,
    edit: () => {
      const line = expectedText
        .split('\n')
        .find(other => other.trim() === `"${GITHUB_PLUGIN}"`)
      // Only a list with one plugin a line, as the reference has it.
      if (!line) return null
      const indent = /^\s*/.exec(line)[0]
      return expectedText.replace(line, `${indent}"${NPM_PLUGIN}",\n${line}`)
    },
  }
}

const checkConfig = async (reference, target) => {
  const expectedText = (await reference.read(RELEASERC)) ?? '{}'
  const expected = parseJson(expectedText).data
  const text = await target.read(RELEASERC)
  if (text === null) {
    return [
      fail('release:releaserc', `${RELEASERC} is missing.`, {
        file: RELEASERC,
        fix: copyOf(RELEASERC, expectedText),
      }),
    ]
  }
  const { data, error } = parseJson(text)
  if (error) {
    return [
      fail('release:releaserc', `${RELEASERC} does not parse: ${error}`, {
        file: RELEASERC,
      }),
    ]
  }

  const findings = []
  const fix = configFix(expectedText, data)
  if (JSON.stringify(data.branches) !== JSON.stringify(expected?.branches)) {
    findings.push(
      fail(
        'release:releaserc:branches',
        `${RELEASERC} releases from other branches than the reference.`,
        { file: RELEASERC, fix },
      ),
    )
  }
  const names = list => (list ?? []).map(pluginName)
  const actual = names(data.plugins).filter(name => name !== NPM_PLUGIN)
  if (JSON.stringify(actual) !== JSON.stringify(names(expected?.plugins))) {
    findings.push(
      fail(
        'release:releaserc:plugins',
        `${RELEASERC} uses the plugins ${inProse(names(data.plugins))}, not the reference's ${inProse(names(expected?.plugins))} (and ${NPM_PLUGIN} for a package on npm).`,
        { file: RELEASERC, fix },
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
