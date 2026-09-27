export function createRunner(suiteName) {
  let failures = 0

  function pass(label) {
    console.log(`  ✓ ${label}`)
  }

  function fail(label, detail) {
    failures += 1
    console.error(`  ✗ ${label}${detail ? `: ${detail}` : ''}`)
  }

  function section(title) {
    console.log(`\n[${suiteName}] ${title}`)
  }

  function finish() {
    return failures
  }

  return { pass, fail, section, finish }
}
