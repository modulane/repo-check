// The action's script, bundled into dist/action.js with its dependencies, so
// the action runs without installing anything.
import { runAction } from './action.js'

try {
  process.exitCode = await runAction()
} catch (error) {
  console.log(`::error title=repo-check::${error.message}`)
  process.exitCode = 1
}
