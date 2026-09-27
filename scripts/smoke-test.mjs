#!/usr/bin/env node
/**
 * Pre-commit / CI smoke tests — server + client suites (sequential).
 * Optional: SMOKE_API_BASE_URL=http://localhost:3001 for live backend checks.
 */
const serverFailures = (await import('./smoke/server.mjs')).default
const clientFailures = (await import('./smoke/client.mjs')).default

const failures = serverFailures + clientFailures

console.log('')
if (failures > 0) {
  console.error(
    `Smoke tests failed: ${failures} check(s).\n` +
      `  npm run smoke:server  — server libs & API\n` +
      `  npm run smoke:client  — client build & utils\n` +
      `See docs/QA_SMOKE_CHECKLIST.md for the manual list.\n`
  )
  process.exit(1)
}
console.log('All server and client smoke tests passed.\n')
process.exit(0)
