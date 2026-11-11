// Keeps one pull request with the fixes open on a repository, as Dependabot
// does: opened when there is something to fix, updated when the fixes
// change, and closed with its branch once there is nothing left to fix. The
// commit is made through the API, so GitHub signs it, and nothing is cloned.

export const DEFAULT_BRANCH = 'repo-check'

const linkTo = name =>
  /^[\w.-]+\/[\w.-]+$/.test(name)
    ? `[${name}](https://github.com/${name})`
    : `\`${name}\``

const item = finding =>
  `- ${finding.message}${finding.id ? ` \`${finding.id}\`` : ''}`

export const pullRequestTitle = reference =>
  `ci: catch up with ${reference.split('/').at(-1).toLowerCase()}`

export const pullRequestBody = ({ reference, fixed, left }) => {
  const lines = [
    '## What and why',
    '',
    `[repo-check](https://github.com/modulane/repo-check) found that this repository has drifted from ${linkTo(reference)}. This pull request brings back what a file change can fix:`,
    '',
    ...fixed.map(item),
  ]
  if (left.length > 0) {
    lines.push(
      '',
      'Still different once this is merged, for a maintainer to fix:',
      '',
      ...left.map(item),
    )
  }
  lines.push(
    '',
    'To keep a difference on purpose, accept it in `.github/repo-check.yml` with the reason, and repo-check leaves it alone.',
    '',
    '## Release notes',
    '',
    '## AI use',
    '',
    '- [x] No AI tool was used',
    '- [ ] AI tools were used, as described here:',
    '',
  )
  return lines.join('\n')
}

export const syncPullRequest = async ({
  github,
  repo,
  branch = DEFAULT_BRANCH,
  changes,
  title,
  body,
}) => {
  const [owner] = repo.split('/')
  const { default_branch: base } = await github.call(
    'GET',
    `/repos/${repo}`,
    undefined,
    `read ${repo}`,
  )
  const open = await github.call(
    'GET',
    `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    undefined,
    `list the pull requests of ${repo}`,
  )

  if (changes.size === 0) {
    for (const pull of open) {
      await github.call(
        'POST',
        `/repos/${repo}/issues/${pull.number}/comments`,
        {
          body: 'Nothing left to fix: this repository matches the reference again.',
        },
        `comment on #${pull.number}`,
      )
      await github.call(
        'PATCH',
        `/repos/${repo}/pulls/${pull.number}`,
        { state: 'closed' },
        `close #${pull.number}`,
      )
    }
    // The branch may already be gone, which is fine.
    await github.request('DELETE', `/repos/${repo}/git/refs/heads/${branch}`)
    return {
      action: open.length > 0 ? 'closed' : 'none',
      url: open[0]?.html_url,
    }
  }

  const head = (
    await github.call(
      'GET',
      `/repos/${repo}/git/ref/heads/${base}`,
      undefined,
      `read ${base} of ${repo}`,
    )
  ).object.sha
  const baseCommit = await github.call(
    'GET',
    `/repos/${repo}/git/commits/${head}`,
    undefined,
    `read the head of ${base}`,
  )
  const tree = await github.call(
    'POST',
    `/repos/${repo}/git/trees`,
    {
      base_tree: baseCommit.tree.sha,
      tree: [...changes].map(([path, content]) => ({
        path,
        mode: '100644',
        type: 'blob',
        content,
      })),
    },
    'write the fixed files',
  )

  // A branch that already holds these changes on top of the default branch
  // is left as it is, so the pull request and its checks do not churn.
  const existing = await github.request(
    'GET',
    `/repos/${repo}/git/ref/heads/${branch}`,
  )
  let current = false
  if (existing.status === 200) {
    const tip = await github.call(
      'GET',
      `/repos/${repo}/git/commits/${existing.data.object.sha}`,
      undefined,
      `read the ${branch} branch`,
    )
    current =
      tip.tree.sha === tree.sha &&
      tip.parents.length === 1 &&
      tip.parents[0].sha === head
  }
  if (!current) {
    const commit = await github.call(
      'POST',
      `/repos/${repo}/git/commits`,
      { message: title, tree: tree.sha, parents: [head] },
      'commit the fixes',
    )
    if (existing.status === 200) {
      await github.call(
        'PATCH',
        `/repos/${repo}/git/refs/heads/${branch}`,
        { sha: commit.sha, force: true },
        `update the ${branch} branch`,
      )
    } else {
      await github.call(
        'POST',
        `/repos/${repo}/git/refs`,
        { ref: `refs/heads/${branch}`, sha: commit.sha },
        `create the ${branch} branch`,
      )
    }
  }

  if (open.length > 0) {
    const pull = await github.call(
      'PATCH',
      `/repos/${repo}/pulls/${open[0].number}`,
      { title, body },
      `update #${open[0].number}`,
    )
    return { action: current ? 'unchanged' : 'updated', url: pull.html_url }
  }
  const pull = await github.call(
    'POST',
    `/repos/${repo}/pulls`,
    { title, body, head: branch, base },
    'open the pull request',
  )
  return { action: 'opened', url: pull.html_url }
}
