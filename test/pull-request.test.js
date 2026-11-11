import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  pullRequestBody,
  pullRequestTitle,
  syncPullRequest,
} from '../src/pull-request.js'
import { fakeApi } from './helpers.js'

const REPO = '/repos/modulane/example'
const HEAD = 'h'.repeat(40)

// GitHub with main at HEAD, and optionally a repo-check branch and an open
// pull request from it.
const github = ({ branch, open = [], branchTree = 'tree-new' } = {}) =>
  fakeApi({
    routes: {
      [REPO]: [200, { default_branch: 'main' }],
      [`${REPO}/pulls`]: [200, open],
      [`${REPO}/git/ref/heads/main`]: [200, { object: { sha: HEAD } }],
      [`${REPO}/git/commits/${HEAD}`]: [200, { tree: { sha: 'tree-main' } }],
      [`POST ${REPO}/git/trees`]: [201, { sha: 'tree-new' }],
      [`${REPO}/git/ref/heads/repo-check`]: branch
        ? [200, { object: { sha: 'tip' } }]
        : [404, {}],
      [`${REPO}/git/commits/tip`]: [
        200,
        { tree: { sha: branchTree }, parents: [{ sha: HEAD }] },
      ],
      [`POST ${REPO}/git/commits`]: [201, { sha: 'commit-new' }],
      [`POST ${REPO}/git/refs`]: [201, {}],
      [`PATCH ${REPO}/git/refs/heads/repo-check`]: [200, {}],
      [`POST ${REPO}/pulls`]: [201, { html_url: 'https://github.com/pr/1' }],
      [`PATCH ${REPO}/pulls/4`]: [200, { html_url: 'https://github.com/pr/4' }],
      [`POST ${REPO}/issues/4/comments`]: [201, {}],
      [`DELETE ${REPO}/git/refs/heads/repo-check`]: [204, null],
    },
  })

const sync = (api, changes) =>
  syncPullRequest({
    github: api.github(),
    repo: 'modulane/example',
    changes: new Map(changes),
    title: 'ci: catch up with repo-template',
    body: 'Body',
  })

const writes = api =>
  api.requests
    .filter(request => request.method !== 'GET')
    .map(request => `${request.method} ${request.path.replace(REPO, '')}`)

describe('the pull request', () => {
  test('is opened on a new branch with one commit', async () => {
    const api = github()
    const result = await sync(api, [['.github/labels.json', '[]\n']])
    assert.deepEqual(result, {
      action: 'opened',
      url: 'https://github.com/pr/1',
    })
    assert.deepEqual(writes(api), [
      'POST /git/trees',
      'POST /git/commits',
      'POST /git/refs',
      'POST /pulls',
    ])
    const tree = api.requests.find(request =>
      request.path.endsWith('/git/trees'),
    )
    assert.deepEqual(tree.body, {
      base_tree: 'tree-main',
      tree: [
        {
          path: '.github/labels.json',
          mode: '100644',
          type: 'blob',
          content: '[]\n',
        },
      ],
    })
    const commit = api.requests.find(request =>
      request.path.endsWith('/git/commits'),
    )
    assert.deepEqual(commit.body.parents, [HEAD])
    const pull = api.requests.find(
      request => request.method === 'POST' && request.path.endsWith('/pulls'),
    )
    assert.deepEqual(pull.body, {
      title: 'ci: catch up with repo-template',
      body: 'Body',
      head: 'repo-check',
      base: 'main',
    })
  })

  test('is updated, and its branch force-pushed, when the fixes change', async () => {
    const api = github({
      branch: true,
      open: [{ number: 4 }],
      branchTree: 'tree-old',
    })
    const result = await sync(api, [['a', 'b']])
    assert.equal(result.action, 'updated')
    assert.deepEqual(writes(api), [
      'POST /git/trees',
      'POST /git/commits',
      'PATCH /git/refs/heads/repo-check',
      'PATCH /pulls/4',
    ])
  })

  test('is left as it is when its branch already holds the fixes', async () => {
    const api = github({ branch: true, open: [{ number: 4 }] })
    const result = await sync(api, [['a', 'b']])
    assert.equal(result.action, 'unchanged')
    assert.deepEqual(writes(api), ['POST /git/trees', 'PATCH /pulls/4'])
  })

  test('is closed, with its branch, once there is nothing to fix', async () => {
    const api = github({ branch: true, open: [{ number: 4, html_url: 'u' }] })
    const result = await sync(api, [])
    assert.deepEqual(result, { action: 'closed', url: 'u' })
    assert.deepEqual(writes(api), [
      'POST /issues/4/comments',
      'PATCH /pulls/4',
      'DELETE /git/refs/heads/repo-check',
    ])
  })

  test('says what it fixes, what is left, and that no AI was used', () => {
    const body = pullRequestBody({
      reference: 'modulane/repo-template',
      fixed: [{ id: 'labels:bug', message: 'Label "bug" is missing.' }],
      left: [
        { id: 'settings:allow_merge_commit', message: 'Merge commits are on.' },
      ],
    })
    assert.match(
      body,
      /\[modulane\/repo-template\]\(https:\/\/github\.com\/modulane\/repo-template\)/,
    )
    assert.match(body, /- Label "bug" is missing\. `labels:bug`/)
    assert.match(body, /for a maintainer to fix:\n\n- Merge commits are on\./)
    assert.match(
      body,
      /## Release notes\n\n## AI use\n\n- \[x\] No AI tool was used\n- \[ \] AI tools/,
    )
    assert.equal(
      pullRequestTitle('modulane/repo-template'),
      'ci: catch up with repo-template',
    )
  })
})
