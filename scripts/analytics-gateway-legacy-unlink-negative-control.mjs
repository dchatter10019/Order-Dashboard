#!/usr/bin/env node
/**
 * Negative control: compare-and-unlink can delete a live replacement (TOCTOU at unlink).
 * Gateway mutex ownership no longer uses durableLockFile at runtime.
 */
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const root = path.join(__dirname, '..', 'data', 'analytics-gateway', 'legacy-unlink-negative')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })

const lockFile = path.join(root, 'legacy-gate.lock')
const coord = path.join(root, 'coord')
fs.mkdirSync(coord, { recursive: true })

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const pausedFile = path.join(coord, 'paused')
const proceedFile = path.join(coord, 'proceed')
const outA = path.join(coord, 'out-a.json')
const outB = path.join(coord, 'out-b.json')

const childScript = path.join(__dirname, 'analytics-gateway-legacy-unlink-child.mjs')

fs.writeFileSync(
  lockFile,
  `${JSON.stringify({
    token: 'stale-token',
    pid: 999999,
    acquiredAt: new Date(0).toISOString()
  })}\n`,
  { mode: 0o600 }
)

const childA = spawn(process.execPath, [childScript, lockFile, pausedFile, proceedFile, outA, 'A'], {
  stdio: 'ignore'
})
const childB = spawn(process.execPath, [childScript, lockFile, pausedFile, proceedFile, outB, 'B'], {
  stdio: 'ignore'
})

const start = Date.now()
while (!fs.existsSync(pausedFile) && Date.now() - start < 10_000) sleep(25)
assert.ok(fs.existsSync(pausedFile), 'legacy harness must reach pre-unlink pause')

sleep(200)
fs.writeFileSync(proceedFile, 'go\n')

await Promise.all([
  new Promise((resolve) => childA.on('close', resolve)),
  new Promise((resolve) => childB.on('close', resolve))
])

const resultA = JSON.parse(fs.readFileSync(outA, 'utf8'))
const resultB = JSON.parse(fs.readFileSync(outB, 'utf8'))
assert.strictEqual(resultB.liveInstalled, true)
assert.strictEqual(resultA.removed === true, true, 'stale reclaimer deleted live replacement')
assert.strictEqual(fs.existsSync(lockFile), false)

fs.rmSync(root, { recursive: true, force: true })
console.log('analytics-gateway-legacy-unlink-negative-control: OK (documents unsafe primitive)')
