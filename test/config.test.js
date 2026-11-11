import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import settings from '../src/checks/settings.js'
import { runChecks } from '../src/run.js'
import {
  fakeGitHub,
  memorySource,
  referenceFiles,
  settings as expected,
  targetFiles,
} from './helpers.js'

const run = (files, only = ['labels']) =>
  runChecks(
    {
      target: memorySource({ ...targetFiles(), ...files }),
      reference: memorySource(referenceFiles()),
      github: fakeGitHub({}),
      repo: 'modulane/example',
    },
    only,
  )

const drifted = { '.github/labels.json': '[]' }

describe('accepted differences', () => {
  test('an accepted finding neither fails nor gets fixed', async () => {
    const [labels, config] = await run({
      ...drifted,
      '.github/repo-check.yml': `accept:
  - finding: 'labels:*'
    reason: This repository has no issues.
`,
    })
    assert.deepEqual(
      labels.findings.map(finding => [finding.level, finding.was, finding.fix]),
      [
        ['accepted', 'fail', undefined],
        ['accepted', 'fail', undefined],
      ],
    )
    assert.equal(labels.findings[0].reason, 'This repository has no issues.')
    assert.deepEqual(
      config.findings.map(finding => finding.level),
      ['pass'],
    )
  })

  test('an entry that matches nothing warns', async () => {
    const [, config] = await run({
      '.github/repo-check.yml': `accept:
  - finding: labels:bug
    reason: Gone by now.
`,
    })
    assert.equal(config.findings[0].level, 'warn')
    assert.match(config.findings[0].message, /no longer differs: remove it/)
  })

  test('an entry needs a reason, and unknown keys fail', async () => {
    const [labels, config] = await run({
      ...drifted,
      '.github/repo-check.yml':
        'accept:\n  - finding: labels:bug\nignore: true\n',
    })
    assert.ok(labels.findings.every(finding => finding.level === 'fail'))
    assert.deepEqual(
      config.findings.map(finding => finding.message),
      [
        '`accept[0]` needs a `reason` for accepting "labels:bug".',
        'Unknown keys: `ignore`.',
      ],
    )
  })

  test('without a file there is no result for it', async () => {
    const results = await run({})
    assert.deepEqual(
      results.map(result => result.id),
      ['labels'],
    )
  })
})

describe('repository settings', () => {
  const context = data => ({
    reference: memorySource(referenceFiles()),
    target: memorySource(targetFiles()),
    repo: 'modulane/example',
    github: fakeGitHub({ '/repos/modulane/example': [200, data] }),
  })

  test('matching settings pass', async () => {
    const findings = await settings.run(
      context({ ...expected, private: false }),
    )
    assert.deepEqual(
      findings.map(finding => finding.level),
      ['pass'],
    )
  })

  test('another value fails, a hidden one is skipped', async () => {
    const findings = await settings.run(
      context({ allow_squash_merge: true, allow_merge_commit: true }),
    )
    assert.deepEqual(
      findings.map(finding => [finding.level, finding.id]),
      [
        ['fail', 'settings:allow_merge_commit'],
        ['skip', undefined],
      ],
    )
    assert.equal(
      findings[0].message,
      '`allow_merge_commit` is true, the reference false.',
    )
  })
})

test('an entry for a check that did not run is not reported', async () => {
  const results = await run(
    {
      '.github/repo-check.yml':
        "accept:\n  - finding: 'rulesets:main ruleset:*'\n    reason: Checked elsewhere.\n",
    },
    ['labels'],
  )
  assert.deepEqual(
    results.at(-1).findings.map(finding => finding.level),
    ['pass'],
  )
})
