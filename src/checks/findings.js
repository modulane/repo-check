// Every check returns a list of findings. Only a failure fails the run.
// A warning is drift worth a look that the reference allows, and a skip is a
// part that could not be checked.
export const pass = message => ({ level: 'pass', message })
export const fail = (message, where = {}) => ({
  level: 'fail',
  message,
  ...where,
})
export const warn = (message, where = {}) => ({
  level: 'warn',
  message,
  ...where,
})
export const skip = message => ({ level: 'skip', message })
