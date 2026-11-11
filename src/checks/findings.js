// Every check returns a list of findings. Only a failure fails the run.
// A warning is drift worth a look that the reference allows, and a skip is a
// part that could not be checked.
//
// A failure or a warning has an `id`, such as `labels:bug` or
// `rulesets:main ruleset:bypass_actors`, that stays the same from run to run,
// so a repository can accept it in .github/repo-check.yml. It can also carry
// a `fix`: the file it changes and an `edit` that turns the file's text
// (null when the file is missing) into the fixed text, or null when it
// cannot.
export const pass = message => ({ level: 'pass', message })
export const skip = message => ({ level: 'skip', message })
export const fail = (id, message, extra = {}) => ({
  level: 'fail',
  id,
  message,
  ...extra,
})
export const warn = (id, message, extra = {}) => ({
  level: 'warn',
  id,
  message,
  ...extra,
})

// A fix that writes the reference's text as it is.
export const copyOf = (path, text) => ({ path, edit: () => text })
