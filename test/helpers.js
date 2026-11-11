// In-memory repositories and a fake GitHub API for the tests.
import { createGitHub } from '../src/github.js'

export const memorySource = (files, name = 'memory') => ({
  name,
  async read(path) {
    return Object.hasOwn(files, path) ? files[path] : null
  },
  async list(dir) {
    const prefix = `${dir}/`
    return Object.keys(files)
      .filter(path => path.startsWith(prefix))
      .map(path => path.slice(prefix.length))
      .filter(rest => !rest.includes('/'))
      .sort()
  },
})

// Routes are paths without the query string, answered with [status, data].
export const fakeGitHub = (routes, token = 'token') =>
  createGitHub({
    token,
    fetch: async url => {
      const path = new URL(url).pathname
      const [status, data] = routes[path] ?? [404, { message: 'Not Found' }]
      return { status, json: async () => data }
    },
  })

const SHA = 'a'.repeat(40)
const OLD_SHA = 'b'.repeat(40)
export { OLD_SHA, SHA }

const caller = (name, ref = SHA, version = 'v1.2.0') => `name: ${name}

# A comment that every repository keeps.
on:
  pull_request:

permissions: {}

jobs:
  ${name}:
    name: ${name}
    uses: modulane/workflows/.github/workflows/${name}.yml@${ref} # ${version}
`

const ci = `name: CI

on:
  pull_request:
  workflow_call:

permissions:
  contents: read

jobs:
  checks:
    name: Checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1

  ci-passed:
    name: CI passed
    if: always()
    needs: [checks]
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`

const release = (repo = 'REPO-NAME') => `name: Release

on:
  push:
    branches: [main]

permissions: {}

jobs:
  ci:
    uses: $/.github/workflows/ci.yml

  release:
    needs: ci
    if: github.repository == 'modulane/${repo}' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1

  release-notes:
    name: Release notes
    needs: release
    uses: modulane/workflows/.github/workflows/release-notes.yml@${SHA} # v1.2.0
`

const dependabot = `version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    commit-message:
      prefix: ci
`

const labels = JSON.stringify([
  { name: 'bug', color: 'd73a4a', description: 'Something does not work' },
  { name: 'ci', color: '5319e7', description: 'Workflows' },
])

const template = `## What and why

## Release notes

## AI use

- [ ] No AI tool was used
- [ ] AI tools were used, as described here:
`

export const ruleset = {
  bypass_actors: [],
  conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
  enforcement: 'active',
  name: 'main ruleset',
  rules: [
    { type: 'deletion' },
    {
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [{ context: 'CI passed', integration_id: 1 }],
      },
    },
  ],
  target: 'branch',
}

export const referenceFiles = () => ({
  '.github/workflows/pr-title.yml': caller('pr-title'),
  '.github/workflows/zizmor.yml': caller('zizmor'),
  '.github/workflows/ci.yml': ci,
  '.github/workflows/release.yml': release(),
  '.github/dependabot.yml': dependabot,
  '.github/labels.json': labels,
  '.github/CODEOWNERS': '* @versnic\n',
  '.github/PULL_REQUEST_TEMPLATE.md': template,
  '.editorconfig': 'root = true\n',
  '.gitattributes': '* text=auto eol=lf\n',
  '.releaserc.json': JSON.stringify({
    branches: ['main'],
    plugins: [
      '@semantic-release/commit-analyzer',
      '@semantic-release/release-notes-generator',
      '@semantic-release/github',
    ],
  }),
  LICENSE: 'MIT',
  'rulesets/main.json': JSON.stringify(ruleset),
})

// A repository that matches the reference.
export const targetFiles = () => {
  const files = referenceFiles()
  delete files['rulesets/main.json']
  files['.github/workflows/release.yml'] = release('example')
  return files
}

export { caller, release }
