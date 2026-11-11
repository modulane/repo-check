// Entry point of the action. The runner passes each input in an INPUT_*
// environment variable, so no input is ever interpolated into a script. The
// repository is read through the API, so the job needs no checkout.
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkRepository } from './check.js'
import { DEFAULT_REFERENCE } from './defaults.js'
import { createGitHub } from './github.js'
import {
  DEFAULT_BRANCH,
  pullRequestBody,
  pullRequestTitle,
  syncPullRequest,
} from './pull-request.js'
import { countFailures, formatText } from './report.js'
import { githubSource, localSource, parseRepo } from './sources.js'

// Workflow commands end at a line break, so escape it, and "%" before it.
const escapeData = text =>
  text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escapeProperty = text =>
  escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C')

const annotation = finding => {
  const command = finding.level === 'fail' ? 'error' : 'warning'
  const properties = [
    'title=repo-check',
    finding.file && `file=${escapeProperty(finding.file)}`,
    finding.line && `line=${finding.line}`,
  ].filter(Boolean)
  const id = finding.id ? ` [${finding.id}]` : ''
  return `::${command} ${properties.join(',')}::${escapeData(finding.message + id)}`
}

const summary = ({ repo, reference, results, pull }) => {
  const rows = results.flatMap(result =>
    result.findings
      .filter(finding => finding.level !== 'pass')
      .map(
        finding =>
          `| ${result.title} | ${finding.level} | ${finding.message.replace(/\|/g, '\\|')} | ${finding.id ? `\`${finding.id}\`` : ''} |`,
      ),
  )
  return [
    `## repo-check: ${repo}`,
    '',
    `Compared with ${reference}.${pull?.url ? ` Pull request: ${pull.url} (${pull.action}).` : ''}`,
    '',
    ...(rows.length > 0
      ? [
          '| Check | Result | Finding | Id |',
          '| --- | --- | --- | --- |',
          ...rows,
        ]
      : ['No drift.']),
    '',
  ].join('\n')
}

export const runAction = async ({
  env = process.env,
  log = console.log,
  fetch = globalThis.fetch,
} = {}) => {
  const input = name =>
    (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim()
  const repo = input('repository') || env.GITHUB_REPOSITORY
  const referenceName = input('reference') || DEFAULT_REFERENCE
  const pullRequest = input('pull-request') === 'true'
  const branch = input('branch') || DEFAULT_BRANCH
  const only = input('only')
    ? input('only')
        .split(/[\s,]+/)
        .filter(Boolean)
    : undefined

  const github = createGitHub({ token: input('token') || undefined, fetch })
  const target = githubSource({ github, repo })
  const remote = parseRepo(referenceName)
  const reference = remote
    ? githubSource({ github, ...remote })
    : localSource(resolve(env.GITHUB_WORKSPACE ?? '.', referenceName))

  const run = await checkRepository({
    target,
    reference,
    github,
    repo,
    only,
    fix: pullRequest,
  })

  let pull
  let left = run.results
  if (pullRequest) {
    left = run.after
    pull = await syncPullRequest({
      github,
      repo,
      branch,
      changes: run.changes,
      title: pullRequestTitle(referenceName),
      body: pullRequestBody({
        reference: referenceName,
        fixed: run.fixed,
        left: run.left,
      }),
    })
  }

  log(
    formatText({
      target: repo,
      reference: reference.name,
      results: run.results,
    }),
  )
  if (pull)
    log(`\nPull request ${pull.action}${pull.url ? `: ${pull.url}` : ''}.`)

  // What the pull request fixes needs no annotation: the pull request says it.
  for (const result of left) {
    for (const finding of result.findings) {
      if (['fail', 'warn'].includes(finding.level)) log(annotation(finding))
    }
  }

  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      summary({ repo, reference: reference.name, results: left, pull }),
    )
  }
  if (env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      `drift=${countFailures(run.results) > 0}\npull-request=${pull?.url ?? ''}\n`,
    )
  }
  // Drift that a pull request now fixes passes; drift no pull request can
  // fix fails, so the run says that a maintainer is needed.
  return countFailures(left) > 0 ? 1 : 0
}
