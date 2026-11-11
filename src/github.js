// A minimal GitHub REST client on the built-in fetch.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export class GitHubError extends Error {}

export const createGitHub = ({
  token,
  fetch = globalThis.fetch,
  baseUrl = 'https://api.github.com',
} = {}) => ({
  token,
  async get(path) {
    const response = await fetch(baseUrl + path, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'repo-check',
        'x-github-api-version': '2022-11-28',
        ...(token && { authorization: `Bearer ${token}` }),
      },
    })
    const data = await response.json().catch(() => null)
    return { status: response.status, data }
  },
  assertOk(status, data, action) {
    if (status >= 200 && status < 300) return
    const reason = data?.message ? ` (${data.message})` : ''
    const hint =
      !token && [401, 403, 404].includes(status)
        ? ' Set GITHUB_TOKEN or GH_TOKEN, or sign in with `gh auth login`.'
        : ''
    throw new GitHubError(
      `Could not ${action}: GitHub answered ${status}${reason}.${hint}`,
    )
  },
})

// GITHUB_TOKEN or GH_TOKEN, else the token of the GitHub CLI when it is
// installed and signed in. Without a token, public repositories can still be
// read.
export const findToken = async (env = process.env) => {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN
  if (token) return token
  try {
    const { stdout } = await run('gh', ['auth', 'token'], {
      timeout: 10_000,
      windowsHide: true,
    })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

// The `owner/repo` of a GitHub remote URL, in its HTTPS or SSH form.
export const repoFromRemote = url => {
  const match =
    /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    )
  return match ? match[1] : null
}

// The GitHub repository that the `origin` remote of a local clone points to.
export const originOf = async dir => {
  try {
    const { stdout } = await run(
      'git',
      ['-C', dir, 'remote', 'get-url', 'origin'],
      { timeout: 10_000, windowsHide: true },
    )
    return repoFromRemote(stdout)
  } catch {
    return null
  }
}
