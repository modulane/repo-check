import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { main, UsageError } from '../src/cli.js'
import { referenceFiles, targetFiles } from './helpers.js'

let root

const writeTree = async (dir, files) => {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), text)
  }
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'repo-check-'))
  await writeTree(join(root, 'reference'), referenceFiles())
  await writeTree(join(root, 'target'), targetFiles())
  await writeTree(join(root, 'drifted'), {
    ...targetFiles(),
    '.github/labels.json': '[]',
  })
})

after(() => rm(root, { recursive: true, force: true }))

// No token and no network: every GitHub request answers 404.
const env = { GITHUB_TOKEN: 'token', NO_COLOR: '1' }
const fetch = async () => ({ status: 404, json: async () => ({}) })

const run = async argv => {
  let out = ''
  const stdout = { write: text => (out += text), isTTY: false }
  const code = await main({ argv, env, stdout, fetch })
  return { code, out }
}

test('a matching local clone exits 0', async () => {
  const { code, out } = await run([
    join(root, 'target'),
    '--reference',
    join(root, 'reference'),
    '--repo',
    'modulane/example',
    '--only',
    'ci,labels,files',
  ])
  assert.equal(code, 0, out)
  assert.match(out, /^Checking modulane\/example against /)
  assert.match(out, /No drift: all 3 checks passed\./)
})

test('drift exits 1 and is listed', async () => {
  const { code, out } = await run([
    join(root, 'drifted'),
    '--reference',
    join(root, 'reference'),
    '--only',
    'labels',
  ])
  assert.equal(code, 1)
  assert.match(out, /✗ \.github\/labels\.json is missing "bug" and "ci"\./)
  assert.match(out, /1 of 1 checks found drift\./)
})

test('--json prints the results', async () => {
  const { out } = await run([
    join(root, 'drifted'),
    '--reference',
    join(root, 'reference'),
    '--only',
    'labels',
    '--json',
  ])
  const report = JSON.parse(out)
  assert.equal(report.results[0].id, 'labels')
  assert.equal(report.results[0].findings[0].level, 'fail')
})

test('a reference on GitHub is read through the API', async () => {
  const files = referenceFiles()
  const requests = []
  const github = async url => {
    const { pathname, searchParams } = new URL(url)
    requests.push(pathname + (searchParams.size ? `?${searchParams}` : ''))
    const path = decodeURIComponent(
      pathname.replace('/repos/modulane/repo-template/contents/', ''),
    )
    if (Object.hasOwn(files, path)) {
      return {
        status: 200,
        json: async () => ({
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(files[path]).toString('base64'),
        }),
      }
    }
    return { status: 404, json: async () => ({}) }
  }
  let out = ''
  const code = await main({
    argv: [
      join(root, 'target'),
      '--only',
      'labels',
      '--reference',
      'modulane/repo-template@v1',
    ],
    env,
    stdout: { write: text => (out += text) },
    fetch: github,
  })
  assert.equal(code, 0, out)
  assert.ok(
    requests.includes(
      '/repos/modulane/repo-template/contents/.github/labels.json?ref=v1',
    ),
  )
})

test('usage errors are reported as such', async () => {
  await assert.rejects(run(['--only', 'nope']), UsageError)
  await assert.rejects(run(['--repo', 'nope']), UsageError)
  await assert.rejects(run([join(root, 'missing')]), UsageError)
  await assert.rejects(run(['--unknown']), UsageError)
})

test('--help and --version print and exit 0', async () => {
  assert.match((await run(['--help'])).out, /^Usage: repo-check/)
  assert.match((await run(['--version'])).out, /^\d+\.\d+\.\d+/)
})
