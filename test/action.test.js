import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { runAction } from '../src/action.js'
import { fakeApi, referenceFiles, targetFiles } from './helpers.js'

let dir

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'repo-check-action-'))
})

after(() => rm(dir, { recursive: true, force: true }))

const run = async (files, inputs = {}, routes = {}) => {
  const api = fakeApi({
    repos: {
      'modulane/repo-template': referenceFiles(),
      'modulane/example': files,
    },
    routes,
  })
  const lines = []
  const output = join(dir, `output-${Math.random()}`)
  const summary = join(dir, `summary-${Math.random()}`)
  const code = await runAction({
    env: {
      GITHUB_REPOSITORY: 'modulane/example',
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      INPUT_TOKEN: 'token',
      INPUT_ONLY: 'labels,files',
      ...inputs,
    },
    log: line => lines.push(line),
    fetch: api.fetch,
  })
  return {
    code,
    log: lines.join('\n'),
    output: await readFile(output, 'utf8'),
    summary: await readFile(summary, 'utf8'),
    api,
  }
}

test('no drift passes', async () => {
  const { code, output, summary } = await run(targetFiles())
  assert.equal(code, 0)
  assert.equal(output, 'drift=false\npull-request=\n')
  assert.match(summary, /No drift\./)
})

test('drift fails with an annotation for each finding', async () => {
  const { code, log, output, summary } = await run({
    ...targetFiles(),
    '.editorconfig': 'root = false\n',
  })
  assert.equal(code, 1)
  assert.match(
    log,
    /::error title=repo-check,file=\.editorconfig::\.editorconfig differs from the reference\. \[files:\.editorconfig\]/,
  )
  assert.match(output, /^drift=true\n/)
  assert.match(summary, /\| Repository files \| fail \| \.editorconfig differs/)
})

test('with pull-request, fixable drift opens a pull request and passes', async () => {
  const REPO = '/repos/modulane/example'
  const { code, api, output } = await run(
    { ...targetFiles(), '.editorconfig': 'root = false\n' },
    { 'INPUT_PULL-REQUEST': 'true' },
    {
      [REPO]: [200, { default_branch: 'main' }],
      [`${REPO}/pulls`]: [200, []],
      [`${REPO}/git/ref/heads/main`]: [200, { object: { sha: 'head' } }],
      [`${REPO}/git/commits/head`]: [200, { tree: { sha: 'tree' } }],
      [`POST ${REPO}/git/trees`]: [201, { sha: 'tree-new' }],
      [`POST ${REPO}/git/commits`]: [201, { sha: 'commit' }],
      [`POST ${REPO}/git/refs`]: [201, {}],
      [`POST ${REPO}/pulls`]: [201, { html_url: 'https://github.com/pr/1' }],
    },
  )
  assert.equal(code, 0)
  assert.match(output, /pull-request=https:\/\/github\.com\/pr\/1/)
  const tree = api.requests.find(request => request.path.endsWith('/git/trees'))
  assert.deepEqual(
    tree.body.tree.map(entry => [entry.path, entry.content]),
    [['.editorconfig', 'root = true\n']],
  )
})

test('a reference the token cannot read fails the run', async () => {
  await assert.rejects(
    run(targetFiles(), { INPUT_REFERENCE: 'modulane/private' }),
    /cannot read it/,
  )
})
