import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import security from '../src/checks/security.js'
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

describe('security settings', () => {
  const REPO = '/repos/modulane/example'
  const context = (repo, routes = {}) => ({
    reference: memorySource(referenceFiles()),
    target: memorySource(targetFiles()),
    repo: 'modulane/example',
    github: fakeGitHub({ [REPO]: [200, repo], ...routes }),
  })
  const enabled = {
    secret_scanning: { status: 'enabled' },
  }
  const levels = findings =>
    findings.map(finding => [finding.level, finding.id])

  test('matching settings pass', async () => {
    const findings = await security.run(
      context(
        { private: false, security_and_analysis: enabled },
        {
          [`${REPO}/vulnerability-alerts`]: [204, null],
          [`${REPO}/actions/permissions/fork-pr-contributor-approval`]: [
            200,
            { approval_policy: 'first_time_contributors' },
          ],
        },
      ),
    )
    assert.deepEqual(levels(findings), [['pass', undefined]])
    assert.equal(
      findings[0].message,
      '3 security settings match the reference.',
    )
  })

  test('a setting that is off, or another policy, fails', async () => {
    const findings = await security.run(
      context(
        {
          private: false,
          security_and_analysis: { secret_scanning: { status: 'disabled' } },
        },
        {
          [`${REPO}/actions/permissions/fork-pr-contributor-approval`]: [
            200,
            { approval_policy: 'all_external_contributors' },
          ],
        },
      ),
    )
    assert.deepEqual(levels(findings), [
      ['fail', 'security:vulnerability_alerts'],
      ['fail', 'security:secret_scanning'],
      ['fail', 'security:fork_pr_approval'],
    ])
    assert.equal(
      findings[0].message,
      '`vulnerability_alerts` is off, the reference on.',
    )
    assert.equal(
      findings[2].message,
      '`fork_pr_approval` is "all_external_contributors", the reference "first_time_contributors".',
    )
  })

  test('a private repository skips what GitHub offers to public ones only', async () => {
    const findings = await security.run(
      context(
        { private: true, security_and_analysis: null },
        { [`${REPO}/vulnerability-alerts`]: [204, null] },
      ),
    )
    assert.deepEqual(levels(findings), [
      ['pass', undefined],
      ['skip', undefined],
    ])
    assert.match(findings[1].message, /`secret_scanning`, `fork_pr_approval`/)
  })

  test('a token that is not an admin skips what it cannot see', async () => {
    const findings = await security.run(
      context({ private: false, permissions: { admin: false, push: true } }),
    )
    assert.deepEqual(levels(findings), [['skip', undefined]])
    assert.match(
      findings[0].message,
      /^GitHub does not show `vulnerability_alerts`, `secret_scanning`, `fork_pr_approval`/,
    )
  })

  test('a setting the token cannot read is skipped', async () => {
    const findings = await security.run(
      context(
        { private: false, security_and_analysis: enabled },
        {
          [`${REPO}/vulnerability-alerts`]: [403, { message: 'Forbidden' }],
          [`${REPO}/actions/permissions/fork-pr-contributor-approval`]: [
            403,
            { message: 'Forbidden' },
          ],
        },
      ),
    )
    assert.deepEqual(levels(findings), [
      ['pass', undefined],
      ['skip', undefined],
    ])
    assert.match(
      findings[1].message,
      /`vulnerability_alerts`, `fork_pr_approval` with this token/,
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
