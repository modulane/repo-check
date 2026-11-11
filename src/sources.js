// A source is a repository to read files from: a local directory, or a
// repository on GitHub read through the API. Both answer the same two
// questions, so the checks never know which one they read.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const isMissing = error => error.code === 'ENOENT' || error.code === 'ENOTDIR'

export const localSource = root => ({
  name: root,
  async read(path) {
    try {
      return await readFile(join(root, path), 'utf8')
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  },
  async list(dir) {
    try {
      const entries = await readdir(join(root, dir), { withFileTypes: true })
      return entries
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .sort()
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
  },
})

export const githubSource = ({ github, repo, ref }) => {
  const contents = path => {
    const encoded = path.split('/').map(encodeURIComponent).join('/')
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
    return github.get(`/repos/${repo}/contents/${encoded}${query}`)
  }
  return {
    name: ref ? `${repo}@${ref}` : repo,
    async read(path) {
      const { status, data } = await contents(path)
      if (status === 404) return null
      github.assertOk(status, data, `read ${path} from ${repo}`)
      if (Array.isArray(data) || data.type !== 'file') return null
      return Buffer.from(data.content, data.encoding).toString('utf8')
    },
    async list(dir) {
      const { status, data } = await contents(dir)
      if (status === 404) return []
      github.assertOk(status, data, `list ${dir} in ${repo}`)
      if (!Array.isArray(data)) return []
      return data
        .filter(entry => entry.type === 'file')
        .map(entry => entry.name)
        .sort()
    },
  }
}

// `owner/repo` or `owner/repo@ref` names a repository on GitHub. Anything
// else is a local directory.
export const parseRepo = value => {
  const match = /^([\w.-]+\/[\w.-]+)(?:@(.+))?$/.exec(value)
  if (!match || match[1].startsWith('.')) return null
  return { repo: match[1], ref: match[2] ?? '' }
}
