#!/usr/bin/env node
/**
 * Runs the approved manifest harness once, then optionally performs a guarded,
 * read-only cutover preflight. Never stops/starts a server.
 * Use `set -o pipefail` if logging through tee.
 * --restore-mock is a deprecated alias for --preflight, NOT restart authorization.
 */
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { withCutoverStoreOwnership, shouldRestoreMockGateway } =
  require('../lib/analyticsGateway/localTestCutover.cjs')
const { createCutoverInvocation, validateCutoverEvidence } =
  require('../lib/analyticsGateway/localTestCutoverEvidence.cjs')
const flags = process.argv.slice(2)
if (flags.some(flag => !['--preflight', '--restore-mock'].includes(flag))) {
  console.error(JSON.stringify({ code: 'unsupported_argument' }))
  process.exit(1)
}
const preflight = flags.length > 0
let context
let exitCode = 1
try {
  // Allocated afresh before child launch; inherited contexts/paths are overwritten.
  context = createCutoverInvocation()
  const child = spawnSync(process.execPath, [
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'analytics-gateway-local-test-run.mjs')
  ], { stdio: 'inherit', env: { ...process.env, ...context.childEnv } })
  exitCode = child.status ?? 1
  if (exitCode === 0 && preflight) {
    const decision = await withCutoverStoreOwnership(async (guard) => {
      const evidenceValidation = validateCutoverEvidence({ invocation: context.invocation })
      return shouldRestoreMockGateway({
        runExitCode: exitCode, evidenceValidation,
        storeQuiescent: guard.quiescent.ok, cutoverGuard: guard
      })
    })
    exitCode = decision.ok ? 0 : 1
    console.error(JSON.stringify({
      local_test_cutover: decision.ok ? 'preflight_passed' : 'preflight_blocked',
      restore_authorized: false,
      reason: decision.reason || null,
      note: 'No restart performed or authorized. A cutover executor must hold store ownership through final checks and transition.'
    }))
  } else if (exitCode !== 0) {
    console.error(JSON.stringify({ local_test_cutover: 'preflight_blocked',
      restore_authorized: false, reason: 'nonzero_exit', runExitCode: exitCode }))
  }
} catch (err) {
  console.error(JSON.stringify({ local_test_cutover: 'preflight_blocked',
    restore_authorized: false, reason: 'cutover_setup_or_check_failed' }))
  exitCode = 1
} finally {
  context?.cleanup()
}
process.exit(exitCode)
