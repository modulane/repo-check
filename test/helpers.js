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

const respond = ([status, data]) => ({ status, json: async () => data })

// A fake GitHub API. `repos` maps owner/repo to its files, served by the
// contents API. `routes` answers other requests by "METHOD /path", or by
// "/path" for a GET, with [status, data] or a function of the request body
// that returns it. Every request is recorded.
export const fakeApi = ({ repos = {}, routes = {} } = {}) => {
  const requests = []
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    const { pathname, searchParams } = new URL(url)
    const body = init.body ? JSON.parse(init.body) : undefined
    requests.push({
      method,
      path: pathname,
      query: searchParams.toString(),
      body,
    })
    const route =
      routes[`${method} ${pathname}`] ??
      (method === 'GET' ? routes[pathname] : undefined)
    if (route) return respond(typeof route === 'function' ? route(body) : route)
    const contents = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.*)$/.exec(pathname)
    const files = contents && repos[contents[1]]
    if (method === 'GET' && files) {
      const path = decodeURIComponent(contents[2])
      if (Object.hasOwn(files, path)) {
        return respond([
          200,
          {
            type: 'file',
            encoding: 'base64',
            content: Buffer.from(files[path]).toString('base64'),
          },
        ])
      }
      const entries = Object.keys(files)
        .filter(other => other.startsWith(`${path}/`))
        .map(other => other.slice(path.length + 1))
        .filter(rest => !rest.includes('/'))
      if (entries.length > 0) {
        return respond([200, entries.map(name => ({ type: 'file', name }))])
      }
    }
    return respond([404, { message: 'Not Found' }])
  }
  return {
    fetch,
    requests,
    github: (token = 'token') => createGitHub({ token, fetch }),
  }
}

export const fakeGitHub = (routes, token = 'token') =>
  fakeApi({ routes }).github(token)

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

export const settings = {
  allow_squash_merge: true,
  allow_merge_commit: false,
  delete_branch_on_merge: true,
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
  '.releaserc.json': JSON.stringify(
    {
      branches: ['main'],
      plugins: [
        '@semantic-release/commit-analyzer',
        '@semantic-release/release-notes-generator',
        '@semantic-release/github',
      ],
    },
    null,
    2,
  ),
  LICENSE: 'MIT',
  'rulesets/main.json': JSON.stringify(ruleset),
  'settings.json': JSON.stringify(settings),
})

// A repository that matches the reference.
export const targetFiles = () => {
  const files = referenceFiles()
  delete files['rulesets/main.json']
  delete files['settings.json']
  files['.github/workflows/release.yml'] = release('example')
  return files
}

export { caller, release }
