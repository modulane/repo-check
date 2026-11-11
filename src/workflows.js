import { parse } from 'yaml'

export const WORKFLOWS = '.github/workflows'

// The shared workflows that repositories call.
export const SHARED = 'modulane/workflows/'

// A workflow file as text and as parsed YAML, or null when it is missing.
// A file that does not parse comes back with an `error`.
export const readWorkflow = async (source, file) => {
  const path = `${WORKFLOWS}/${file}`
  const text = await source.read(path)
  if (text === null) return null
  try {
    return { path, text, data: parse(text) ?? {} }
  } catch (error) {
    return { path, text, data: {}, error: error.message.split('\n')[0] }
  }
}

export const workflowFiles = async source =>
  (await source.list(WORKFLOWS)).filter(file => /\.ya?ml$/.test(file))

export const jobsOf = workflow => Object.entries(workflow?.data?.jobs ?? {})

// The path of a reusable workflow that a job calls, without its ref.
export const calledWorkflow = job =>
  typeof job?.uses === 'string' ? job.uses.replace(/@.*$/, '') : null

// The triggers of a workflow: `on` can be a string, a list or a map.
export const triggersOf = workflow => {
  const on = workflow?.data?.on ?? workflow?.data?.true
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on
  return Object.keys(on ?? {})
}
