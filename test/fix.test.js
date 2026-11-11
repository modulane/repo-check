import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { checkRepository } from '../src/check.js'
import {
  addNeeds,
  completeTemplate,
  jobBlock,
  keepInputs,
  replacePin,
} from '../src/edit.js'
import { overlaySource } from '../src/fix.js'
import {
  caller,
  fakeGitHub,
  memorySource,
  OLD_SHA,
  referenceFiles,
  release,
  SHA,
  targetFiles,
} from './helpers.js'

const fixRepository = async (changes, extra = {}) => {
  const files = { ...targetFiles(), ...changes }
  for (const [path, value] of Object.entries(files)) {
    if (value === undefined) delete files[path]
  }
  return checkRepository({
    target: memorySource(files),
    reference: memorySource(referenceFiles()),
    github: fakeGitHub({}),
    repo: 'modulane/example',
    only: [
      'ci',
      'pinned-actions',
      'shared-workflows',
      'release',
      'dependabot',
      'labels',
      'files',
    ],
    fix: true,
    ...extra,
  })
}

describe('text edits', () => {
  const workflow = `jobs:
  # About the first job.
  first:
    runs-on: ubuntu-latest

    steps: []

  second:
    needs: [first]
    runs-on: ubuntu-latest
`

  test('a job block takes its comment and stops at the next job', () => {
    const block = jobBlock(workflow, 'first')
    assert.equal(
      block.text,
      '  # About the first job.\n  first:\n    runs-on: ubuntu-latest\n\n    steps: []',
    )
    assert.equal(jobBlock(workflow, 'missing'), null)
  })

  test('needs gain the missing jobs', () => {
    assert.match(
      addNeeds(workflow, 'second', ['lint']),
      /needs: \[first, lint\]/,
    )
    assert.match(
      addNeeds(workflow.replace('[first]', 'first'), 'second', ['lint']),
      /needs: \[first, lint\]/,
    )
    assert.equal(addNeeds(workflow, 'first', ['lint']), null)
  })

  test('pins move to the reference with their comment', () => {
    const text = `      - uses: actions/checkout@v4\n      - uses: 'actions/checkout@${OLD_SHA}' # v6.0.0\n`
    const pin = { ref: SHA, comment: 'v7.0.1' }
    assert.equal(
      replacePin(text, { name: 'actions/checkout', ref: 'v4' }, pin),
      `      - uses: actions/checkout@${SHA} # v7.0.1\n      - uses: 'actions/checkout@${OLD_SHA}' # v6.0.0\n`,
    )
    assert.equal(
      replacePin(text, { name: 'actions/checkout', ref: OLD_SHA }, pin),
      `      - uses: actions/checkout@v4\n      - uses: 'actions/checkout@${SHA}' # v7.0.1\n`,
    )
  })

  test('a caller keeps its own inputs', () => {
    const own = `${caller('pr-title', OLD_SHA, 'v1.0.0')}    with:\n      # Monorepo.\n      package-scope: true\n`
    const fixed = keepInputs(caller('pr-title'), own, ['pr-title'])
    assert.equal(
      fixed,
      `${caller('pr-title')}    with:\n      # Monorepo.\n      package-scope: true\n`,
    )
  })

  test('the template gains missing sections and boxes in place', () => {
    const reference =
      '## What and why\n\n## Release notes\n\n<!-- notes -->\n\n## Checklist\n\n- [ ] One\n- [ ] Two\n'
    const actual =
      '## What and why\n\nOwn text.\n\n## Checklist\n\n- [x] One\n- [ ] Own\n'
    assert.equal(
      completeTemplate(reference, actual),
      '## What and why\n\nOwn text.\n\n## Release notes\n\n<!-- notes -->\n\n## Checklist\n\n- [x] One\n- [ ] Own\n- [ ] Two\n',
    )
  })
})

describe('fixes', () => {
  test('outdated pins and callers are fixed, and nothing is left', async () => {
    const run = await fixRepository({
      '.github/workflows/zizmor.yml': caller(
        'zizmor',
        OLD_SHA,
        'v1.0.0',
      ).replace('pull_request:', 'push:'),
      '.github/workflows/pr-title.yml': undefined,
    })
    assert.deepEqual([...run.changes.keys()].sort(), [
      '.github/workflows/pr-title.yml',
      '.github/workflows/zizmor.yml',
    ])
    assert.equal(
      run.changes.get('.github/workflows/zizmor.yml'),
      referenceFiles()['.github/workflows/zizmor.yml'],
    )
    assert.equal(run.fixed.length, 3)
    assert.deepEqual(run.left, [])
  })

  test('a missing shared workflow call is added as a job', async () => {
    const text = release('example')
    const run = await fixRepository({
      '.github/workflows/release.yml': text.slice(
        0,
        text.indexOf('  release-notes:'),
      ),
    })
    assert.equal(
      run.changes.get('.github/workflows/release.yml'),
      `${text.trimEnd()}\n`,
    )
    assert.deepEqual(run.left, [])
  })

  test('REPO-NAME becomes the repository and its comment goes', async () => {
    const run = await fixRepository({
      '.github/workflows/release.yml': release().replace(
        '    if: github.repository',
        "    # Replace REPO-NAME with the repository's name: until then this job never\n    # runs, which is also why it never runs in modulane/repo-template.\n    if: github.repository",
      ),
    })
    assert.equal(
      run.changes.get('.github/workflows/release.yml'),
      release('example'),
    )
  })

  test('labels are merged, keeping the repository its own', async () => {
    const run = await fixRepository({
      '.github/labels.json': JSON.stringify([
        { name: 'own', color: 'ffffff', description: 'Mine' },
        { name: 'bug', color: '000000', description: 'Old' },
      ]),
    })
    const labels = JSON.parse(run.changes.get('.github/labels.json'))
    assert.deepEqual(
      labels.map(label => [label.name, label.color]),
      [
        ['bug', 'd73a4a'],
        ['ci', '5319e7'],
        ['own', 'ffffff'],
      ],
    )
    assert.deepEqual(run.left, [])
  })

  test('dependabot keeps updates of other ecosystems', async () => {
    const own = `version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: daily
  # npm, weekly.
  - package-ecosystem: npm
    directory: /
`
    const run = await fixRepository({ '.github/dependabot.yml': own })
    const text = run.changes.get('.github/dependabot.yml')
    assert.match(text, /interval: weekly/)
    assert.match(text, /prefix: ci/)
    assert.match(text, /# npm, weekly\.\n {2}- package-ecosystem: npm/)
    assert.deepEqual(run.left, [])
  })

  test('the npm plugin stays before the GitHub one', async () => {
    const run = await fixRepository({
      '.releaserc.json': JSON.stringify({
        branches: ['main', 'next'],
        plugins: ['@semantic-release/npm', '@semantic-release/github'],
      }),
    })
    const config = JSON.parse(run.changes.get('.releaserc.json'))
    assert.deepEqual(config.branches, ['main'])
    assert.deepEqual(config.plugins.slice(-2), [
      '@semantic-release/npm',
      '@semantic-release/github',
    ])
    assert.deepEqual(run.left, [])
  })

  test('what no file change can fix is left', async () => {
    const run = await fixRepository({
      '.github/workflows/ci.yml': targetFiles()[
        '.github/workflows/ci.yml'
      ].replace('    if: always()\n', ''),
    })
    assert.equal(run.changes.size, 0)
    assert.deepEqual(
      run.left.map(finding => finding.id),
      ['ci:always'],
    )
  })

  test('the overlay lists added files', async () => {
    const source = overlaySource(
      memorySource({ 'a/one': '1' }),
      new Map([
        ['a/two', '2'],
        ['b/three', '3'],
      ]),
    )
    assert.deepEqual(await source.list('a'), ['one', 'two'])
    assert.equal(await source.read('a/two'), '2')
    assert.equal(await source.read('a/one'), '1')
  })
})
