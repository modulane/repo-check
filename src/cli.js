import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createGitHub, findToken, originOf } from './github.js'
import { formatJson, formatText } from './report.js'
import { checks, hasFailures, runChecks } from './run.js'
import { githubSource, localSource, parseRepo } from './sources.js'

export const DEFAULT_REFERENCE = 'modulane/repo-template'

export const usage = `Usage: repo-check [target] [options]

Checks that a repository still matches the reference setup, and reports what
has drifted.

  target                 A local clone (default: the current directory), or
                         owner/repo[@ref] to read the files from GitHub

Options:
  --reference <source>   The reference setup: owner/repo[@ref] or a local
                         clone (default: ${DEFAULT_REFERENCE})
  --repo <owner/repo>    The GitHub repository whose rulesets are checked
                         (default: the target, or its origin remote)
  --only <checks>        Run only these checks, separated by commas:
                         ${checks.map(check => check.id).join(', ')}
  --json                 Print the results as JSON
  -h, --help             Print this help
  -v, --version          Print the version

GitHub is read with GITHUB_TOKEN or GH_TOKEN, or else with the token of the
GitHub CLI. Exit codes: 0 no drift, 1 drift found, 2 the check could not run.`

export class UsageError extends Error {}

const options = {
  reference: { type: 'string' },
  repo: { type: 'string' },
  only: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
}

// A path that exists is a local clone, even when it looks like owner/repo.
const openSource = (value, github) => {
  const remote = parseRepo(value)
  if (remote && !existsSync(value)) {
    return { source: githubSource({ github, ...remote }), repo: remote.repo }
  }
  const dir = resolve(value)
  if (!existsSync(dir)) throw new UsageError(`${value} does not exist.`)
  return { source: localSource(dir), dir }
}

export const main = async ({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  fetch = globalThis.fetch,
} = {}) => {
  let args
  try {
    args = parseArgs({ args: argv, options, allowPositionals: true })
  } catch (error) {
    throw new UsageError(error.message)
  }
  const { values, positionals } = args
  if (values.help) {
    stdout.write(`${usage}\n`)
    return 0
  }
  if (values.version) {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    )
    stdout.write(`${pkg.version}\n`)
    return 0
  }
  if (positionals.length > 1) throw new UsageError('Give at most one target.')

  const only = values.only
    ?.split(',')
    .map(id => id.trim())
    .filter(Boolean)
  const unknown = only?.filter(id => !checks.some(check => check.id === id))
  if (unknown?.length) {
    throw new UsageError(`Unknown check: ${unknown.join(', ')}.`)
  }
  if (values.repo !== undefined && !parseRepo(values.repo)?.repo) {
    throw new UsageError('--repo takes owner/repo.')
  }

  const github = createGitHub({ token: await findToken(env), fetch })
  const target = openSource(positionals[0] ?? '.', github)
  const reference = openSource(values.reference ?? DEFAULT_REFERENCE, github)
  const repo =
    values.repo ??
    target.repo ??
    (target.dir ? await originOf(target.dir) : null)

  const results = await runChecks(
    { target: target.source, reference: reference.source, github, repo },
    only,
  )
  const report = {
    target: repo ?? target.source.name,
    reference: reference.source.name,
    results,
  }
  stdout.write(
    `${values.json ? formatJson(report) : formatText(report, { color: Boolean(stdout.isTTY) && !env.NO_COLOR })}\n`,
  )
  return hasFailures(results) ? 1 : 0
}
