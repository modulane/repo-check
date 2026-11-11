import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import ci from '../src/checks/ci.js'
import dependabot from '../src/checks/dependabot.js'
import files from '../src/checks/files.js'
import labels from '../src/checks/labels.js'
import pinnedActions from '../src/checks/pinned-actions.js'
import release from '../src/checks/release.js'
import rulesets from '../src/checks/rulesets.js'
import sharedWorkflows from '../src/checks/shared-workflows.js'
import { hasFailures, runChecks } from '../src/run.js'
import {
  caller,
  fakeGitHub,
  memorySource,
  OLD_SHA,
  referenceFiles,
  release as releaseWorkflow,
  ruleset,
  SHA,
  targetFiles,
} from './helpers.js'

const context = (changes = {}, extra = {}) => {
  const target = { ...targetFiles(), ...changes }
  for (const [path, value] of Object.entries(target)) {
    if (value === undefined) delete target[path]
  }
  return {
    reference: memorySource(referenceFiles(), 'reference'),
    target: memorySource(target, 'target'),
    repo: 'modulane/example',
    github: fakeGitHub({}),
    ...extra,
  }
}

const levels = findings => findings.map(finding => finding.level)
const failures = findings =>
  findings.filter(finding => finding.level === 'fail').map(f => f.message)

describe('a repository that matches the reference', () => {
  test('passes every check that reads files', async () => {
    const results = await runChecks(context(), [
      'ci',
      'pinned-actions',
      'shared-workflows',
      'release',
      'dependabot',
      'labels',
      'files',
    ])
    assert.equal(hasFailures(results), false, JSON.stringify(results, null, 2))
  })
})

describe('shared workflows', () => {
  test('a missing caller fails', async () => {
    const findings = await sharedWorkflows.run(
      context({ '.github/workflows/zizmor.yml': undefined }),
    )
    assert.deepEqual(failures(findings), [
      '.github/workflows/zizmor.yml is missing.',
    ])
  })

  test('another pin is left to the pinned actions check', async () => {
    const findings = await sharedWorkflows.run(
      context({
        '.github/workflows/zizmor.yml': caller('zizmor', OLD_SHA, 'v1.0.0'),
      }),
    )
    assert.deepEqual(failures(findings), [])
  })

  test('another trigger fails', async () => {
    const findings = await sharedWorkflows.run(
      context({
        '.github/workflows/zizmor.yml': caller('zizmor').replace(
          'pull_request:',
          'push:',
        ),
      }),
    )
    assert.match(
      failures(findings)[0],
      /differs from the reference in `on\.push`, `on\.pull_request`|`on\./,
    )
  })

  test('own inputs pass', async () => {
    const findings = await sharedWorkflows.run(
      context({
        '.github/workflows/pr-title.yml': `${caller('pr-title')}    with:\n      package-scope: true\n`,
      }),
    )
    assert.deepEqual(failures(findings), [])
    assert.ok(findings.some(f => /inputs of its own/.test(f.message)))
  })

  test('other comments only warn', async () => {
    const findings = await sharedWorkflows.run(
      context({
        '.github/workflows/zizmor.yml': caller('zizmor').replace(
          'every repository keeps',
          'this one rewrote',
        ),
      }),
    )
    assert.ok(levels(findings).includes('warn'))
    assert.deepEqual(failures(findings), [])
  })

  test('a missing call to a shared workflow fails', async () => {
    const files = targetFiles()
    const text = files['.github/workflows/release.yml']
    const findings = await sharedWorkflows.run(
      context({
        '.github/workflows/release.yml': text.slice(
          0,
          text.indexOf('  release-notes:'),
        ),
      }),
    )
    assert.match(failures(findings)[0], /does not call .*release-notes\.yml/)
  })

  test('the repository that holds the shared workflows calls them locally', async () => {
    const own = `name: zizmor\non:\n  pull_request:\n  workflow_call:\njobs:\n  zizmor:\n    runs-on: ubuntu-latest\n    steps: []\n`
    const findings = await sharedWorkflows.run(
      context({
        '.github/workflows/zizmor.yml': own,
        '.github/workflows/pr-title.yml': own,
        '.github/workflows/release.yml': releaseWorkflow('example').replace(
          /uses: modulane\/workflows\/\.github\/workflows\/release-notes\.yml@.*/,
          'uses: $/.github/workflows/release-notes.yml',
        ),
      }),
    )
    assert.deepEqual(failures(findings), [])
  })
})

describe('pinned actions', () => {
  const step = uses =>
    targetFiles()['.github/workflows/ci.yml'].replace(
      `actions/checkout@${SHA} # v7.0.1`,
      uses,
    )

  test('a tag instead of a SHA fails, with its line', async () => {
    const [finding] = await pinnedActions.run(
      context({ '.github/workflows/ci.yml': step('actions/checkout@v7') }),
    )
    assert.equal(finding.level, 'fail')
    assert.match(finding.message, /pinned to `v7`, not to a commit SHA/)
    assert.equal(finding.file, '.github/workflows/ci.yml')
    assert.equal(finding.line, 15)
  })

  test('a SHA without a version comment fails', async () => {
    const [finding] = await pinnedActions.run(
      context({ '.github/workflows/ci.yml': step(`actions/checkout@${SHA}`) }),
    )
    assert.match(finding.message, /no `# vX\.Y\.Z` comment/)
  })

  test('an older release than the reference fails', async () => {
    const [finding] = await pinnedActions.run(
      context({
        '.github/workflows/zizmor.yml': caller('zizmor', OLD_SHA, 'v1.0.0'),
      }),
    )
    assert.equal(finding.level, 'fail')
    assert.match(finding.message, /at v1\.0\.0, the reference at v1\.2\.0/)
  })

  test('a newer release than the reference warns', async () => {
    const [finding] = await pinnedActions.run(
      context({
        '.github/workflows/ci.yml': step(
          `actions/checkout@${OLD_SHA} # v7.1.0`,
        ),
      }),
    )
    assert.equal(finding.level, 'warn')
    assert.match(finding.message, /update the reference first/)
  })

  test('the same release on another commit fails', async () => {
    const [finding] = await pinnedActions.run(
      context({
        '.github/workflows/ci.yml': step(
          `actions/checkout@${OLD_SHA} # v7.0.1`,
        ),
      }),
    )
    assert.equal(finding.level, 'fail')
    assert.match(finding.message, /pinned to bbbbbbb, the reference to aaaaaaa/)
  })

  test('actions the reference does not use only need a pin', async () => {
    const findings = await pinnedActions.run(
      context({
        'action.yml': `runs:\n  using: composite\n  steps:\n    - uses: some/action@${SHA} # v2.0.0\n`,
      }),
    )
    assert.deepEqual(levels(findings), ['pass'])
  })
})

describe('CI passed', () => {
  const ciWith = (from, to) =>
    targetFiles()['.github/workflows/ci.yml'].replace(from, to)

  test('a job missing from needs fails', async () => {
    const findings = await ci.run(
      context({
        '.github/workflows/ci.yml': ciWith(
          '  ci-passed:',
          '  lint:\n    runs-on: ubuntu-latest\n    steps: []\n\n  ci-passed:',
        ),
      }),
    )
    assert.match(failures(findings)[0], /does not need `lint`/)
  })

  test('a deployment that only runs on main need not be listed', async () => {
    const findings = await ci.run(
      context({
        '.github/workflows/ci.yml': ciWith(
          '  ci-passed:',
          "  deploy:\n    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n    runs-on: ubuntu-latest\n    steps: []\n\n  ci-passed:",
        ),
      }),
    )
    assert.deepEqual(failures(findings), [])
  })

  test('without always() it fails', async () => {
    const findings = await ci.run(
      context({ '.github/workflows/ci.yml': ciWith('    if: always()\n', '') }),
    )
    assert.match(failures(findings)[0], /if: always\(\)/)
  })

  test('without the job or a trigger it fails', async () => {
    const findings = await ci.run(
      context({
        '.github/workflows/ci.yml': ciWith(
          'name: CI passed',
          'name: Done',
        ).replace('  workflow_call:\n', ''),
      }),
    )
    assert.deepEqual(failures(findings), [
      '.github/workflows/ci.yml does not run on workflow_call.',
      '.github/workflows/ci.yml has no "CI passed" job.',
    ])
  })
})

describe('release', () => {
  test('a release workflow still named REPO-NAME fails', async () => {
    const findings = await release.run(
      context({ '.github/workflows/release.yml': releaseWorkflow() }),
    )
    assert.match(failures(findings)[0], /REPO-NAME/)
  })

  test('a release workflow for another repository fails', async () => {
    const findings = await release.run(
      context({ '.github/workflows/release.yml': releaseWorkflow('other') }),
    )
    assert.match(failures(findings)[0], /only in modulane\/other/)
  })

  test('the npm plugin is allowed, others are not', async () => {
    const config = plugins => JSON.stringify({ branches: ['main'], plugins })
    const base = [
      '@semantic-release/commit-analyzer',
      '@semantic-release/release-notes-generator',
    ]
    const npm = await release.run(
      context({
        '.releaserc.json': config([
          ...base,
          ['@semantic-release/npm', { provenance: true }],
          '@semantic-release/github',
        ]),
      }),
    )
    assert.deepEqual(failures(npm), [])
    const other = await release.run(
      context({
        '.releaserc.json': config([...base, '@semantic-release/git']),
      }),
    )
    assert.equal(failures(other).length, 1)
  })
})

describe('dependabot', () => {
  test('another setting fails', async () => {
    const findings = await dependabot.run(
      context({
        '.github/dependabot.yml': targetFiles()[
          '.github/dependabot.yml'
        ].replace('prefix: ci', 'prefix: chore'),
      }),
    )
    assert.match(failures(findings)[0], /`commit-message\.prefix`/)
  })

  test('updates of other ecosystems are allowed', async () => {
    const findings = await dependabot.run(
      context({
        '.github/dependabot.yml': `${targetFiles()['.github/dependabot.yml']}  - package-ecosystem: npm\n    directory: /\n`,
      }),
    )
    assert.deepEqual(failures(findings), [])
  })
})

describe('labels', () => {
  test('missing and changed labels fail, extra ones do not', async () => {
    const findings = await labels.run(
      context({
        '.github/labels.json': JSON.stringify([
          {
            name: 'bug',
            color: '000000',
            description: 'Something does not work',
          },
          { name: 'own', color: 'ffffff' },
        ]),
      }),
    )
    assert.deepEqual(failures(findings), [
      '.github/labels.json is missing "ci".',
      '"bug" has another name, color or description than in the reference.',
    ])
  })
})

describe('files', () => {
  test('changed and missing files fail', async () => {
    const findings = await files.run(
      context({
        '.editorconfig': 'root = false\n',
        LICENSE: undefined,
        '.github/PULL_REQUEST_TEMPLATE.md':
          '## What and why\n\n## AI use\n\n- [ ] No AI tool was used\n',
      }),
    )
    assert.deepEqual(failures(findings), [
      '.editorconfig differs from the reference.',
      '.github/PULL_REQUEST_TEMPLATE.md has no "Release notes" section.',
      '.github/PULL_REQUEST_TEMPLATE.md is missing the box "AI tools were used, as described here:".',
      'LICENSE is missing.',
    ])
  })

  test('line endings do not count', async () => {
    const findings = await files.run(
      context({ '.editorconfig': 'root = true\r\n' }),
    )
    assert.deepEqual(failures(findings), [])
  })
})

describe('rulesets', () => {
  const routes = actual => ({
    '/repos/modulane/example/rulesets': [
      200,
      [{ id: 7, name: actual.name, target: 'branch' }],
    ],
    '/repos/modulane/example/rulesets/7': [200, actual],
  })

  test('a matching ruleset passes, extra defaults included', async () => {
    const actual = structuredClone(ruleset)
    actual.id = 7
    actual.rules[1].parameters.strict_required_status_checks_policy = false
    const findings = await rulesets.run(
      context({}, { github: fakeGitHub(routes(actual)) }),
    )
    assert.deepEqual(levels(findings), ['pass'])
  })

  test('a missing rule or another status check fails', async () => {
    const actual = structuredClone(ruleset)
    actual.rules = [
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [{ context: 'Tests', integration_id: 1 }],
        },
      },
      { type: 'creation' },
    ]
    const findings = await rulesets.run(
      context({}, { github: fakeGitHub(routes(actual)) }),
    )
    assert.deepEqual(levels(findings), ['fail', 'warn'])
    assert.match(findings[0].message, /no `deletion` rule/)
    assert.match(
      findings[0].message,
      /`required_status_checks\.required_status_checks`/,
    )
    assert.match(findings[1].message, /`creation`/)
  })

  test('a hidden bypass list is skipped', async () => {
    const actual = structuredClone(ruleset)
    delete actual.bypass_actors
    const findings = await rulesets.run(
      context({}, { github: fakeGitHub(routes(actual)) }),
    )
    assert.deepEqual(levels(findings), ['pass', 'skip'])
  })

  test('a missing ruleset names the ones there are', async () => {
    const findings = await rulesets.run(
      context({}, { github: fakeGitHub(routes({ ...ruleset, name: 'main' })) }),
    )
    assert.deepEqual(failures(findings), [
      'modulane/example has no "main ruleset" ruleset, only "main".',
    ])
  })

  test('private repositories on the Free plan are skipped', async () => {
    const findings = await rulesets.run(
      context(
        {},
        {
          github: fakeGitHub({
            '/repos/modulane/example/rulesets': [
              403,
              {
                message:
                  'Upgrade to GitHub Pro or make this repository public to enable this feature.',
              },
            ],
          }),
        },
      ),
    )
    assert.deepEqual(levels(findings), ['skip'])
  })

  test('without a GitHub repository it is skipped', async () => {
    const findings = await rulesets.run(context({}, { repo: null }))
    assert.deepEqual(levels(findings), ['skip'])
  })

  test('an API error fails the check, not the run', async () => {
    const results = await runChecks(
      context({}, { github: fakeGitHub({}, null) }),
      ['rulesets', 'labels'],
    )
    assert.match(
      results[0].findings[0].message,
      /could not run: .*404.*GITHUB_TOKEN/,
    )
    assert.deepEqual(levels(results[1].findings), ['pass'])
  })
})
