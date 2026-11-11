#!/usr/bin/env node
import { main, UsageError, usage } from '../src/cli.js'

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`repo-check: ${error.message}`)
  if (error instanceof UsageError) console.error(`\n${usage}`)
  process.exitCode = 2
}
