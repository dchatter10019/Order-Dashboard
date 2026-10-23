const crypto = require('crypto')

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key])
    }
    return out
  }
  return value
}

function canonicalJsonString(value) {
  return JSON.stringify(sortKeysDeep(value))
}

function hashCanonicalArguments(args) {
  return crypto.createHash('sha256').update(canonicalJsonString(args)).digest('hex')
}

module.exports = {
  sortKeysDeep,
  canonicalJsonString,
  hashCanonicalArguments
}
