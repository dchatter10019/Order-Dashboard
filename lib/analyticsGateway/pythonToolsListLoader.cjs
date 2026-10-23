const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { parseCalendarDate, isCompleteCalendarMonthRange, DATE_RE } = require('./calendarValidation.cjs')

const EXPORT_PATH = path.join(
  __dirname,
  '..',
  '..',
  'test-fixtures',
  'analytics-gateway',
  'Bevvi-Python-Tools-List-Export.json'
)

const EXPORT_SHA256_SIDECAR = path.join(
  __dirname,
  '..',
  '..',
  'test-fixtures',
  'analytics-gateway',
  'Bevvi-Python-Tools-List-Export.SHA256'
)

const OUTPUT_CONTRACTS_PATH = path.join(
  __dirname,
  '..',
  '..',
  'test-fixtures',
  'analytics-gateway',
  'Bevvi-Python-Output-Contracts.json'
)

let cachedExport = null
let cachedOutput = null
let cachedTools = null

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function loadToolsListExport() {
  if (!cachedExport) {
    cachedExport = JSON.parse(fs.readFileSync(EXPORT_PATH, 'utf8'))
    cachedTools = extractToolsFromExport(cachedExport)
  }
  return cachedExport
}

function extractToolsFromExport(doc) {
  if (Array.isArray(doc?.result?.tools)) return doc.result.tools
  if (Array.isArray(doc?.tools)) return doc.tools
  return []
}

function getToolsList() {
  loadToolsListExport()
  return cachedTools || []
}

function loadOutputContracts() {
  if (!cachedOutput) {
    cachedOutput = JSON.parse(fs.readFileSync(OUTPUT_CONTRACTS_PATH, 'utf8'))
  }
  return cachedOutput
}

function getInputSchema(operation) {
  const tool = getToolsList().find((t) => t.name === operation)
  return tool?.inputSchema || null
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const KNOWN_DATE_FIELDS = new Set([
  'as_of',
  'start_date',
  'end_date',
  'baseline_start',
  'baseline_end'
])

const ISO_DATE_JSON_PATTERNS = new Set([
  '^\\d{4}-\\d{2}-\\d{2}$',
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
])

function patternImpliesIsoCalendarDate(pattern) {
  if (!pattern || typeof pattern !== 'string') return false
  if (ISO_DATE_JSON_PATTERNS.has(pattern)) return true
  return /^(\^)?(\[0-9\]{4}|\\d{4})-(\[0-9\]{2}|\\d{2})-(\[0-9\]{2}|\\d{2})(\$$)?$/.test(pattern)
}

function isDateLikeStringSpec(spec, fieldName) {
  if (KNOWN_DATE_FIELDS.has(fieldName)) return true
  if (spec.format === 'date') return true
  if (spec.pattern === DATE_RE.source) return true
  if (patternImpliesIsoCalendarDate(spec.pattern)) return true
  return false
}

function validateStringField(key, value, spec) {
  if (typeof value !== 'string') return { ok: false, error: `${key} must be a string` }
  if (isDateLikeStringSpec(spec, key)) {
    const d = parseCalendarDate(key, value)
    if (!d.ok) return d
    return { ok: true, value: d.value }
  }
  if (spec.pattern && !patternImpliesIsoCalendarDate(spec.pattern)) {
    try {
      const re = new RegExp(spec.pattern)
      if (!re.test(value)) {
        return { ok: false, error: `${key} does not match required pattern` }
      }
    } catch {
      return { ok: false, error: `${key} has invalid schema pattern` }
    }
  }
  if (spec.enum && !spec.enum.includes(value)) {
    return { ok: false, error: `${key} must be one of: ${spec.enum.join(', ')}` }
  }
  if (spec.minLength != null && value.length < spec.minLength) {
    return { ok: false, error: `${key} must be at least ${spec.minLength} characters` }
  }
  return { ok: true, value }
}

function __testOnlyResetToolsListCache() {
  cachedExport = null
  cachedOutput = null
  cachedTools = null
}

function validateAgainstSchema(operation, args) {
  const schema = getInputSchema(operation)
  if (!schema) return { ok: false, error: `No tools/list schema for ${operation}` }
  if (!isPlainObject(args)) return { ok: false, error: 'arguments must be a JSON object' }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!schema.properties?.[key]) {
        return { ok: false, error: `Unexpected field: ${key}` }
      }
    }
  }
  for (const req of schema.required || []) {
    if (args[req] == null) return { ok: false, error: `${req} required` }
  }

  const normalized = {}
  for (const [key, spec] of Object.entries(schema.properties || {})) {
    if (args[key] == null) continue
    const value = args[key]
    if (spec.type === 'string') {
      const checked = validateStringField(key, value, spec)
      if (!checked.ok) return checked
      normalized[key] = checked.value
    } else if (spec.type === 'array') {
      if (!Array.isArray(value)) return { ok: false, error: `${key} must be an array` }
      if (spec.minItems != null && value.length < spec.minItems) {
        return { ok: false, error: `${key} must contain at least ${spec.minItems} item(s)` }
      }
      if (spec.maxItems != null && value.length > spec.maxItems) {
        return { ok: false, error: `${key} must contain at most ${spec.maxItems} item(s)` }
      }
      for (const item of value) {
        if (typeof item !== 'string' || !item.trim()) {
          return { ok: false, error: `${key} must contain non-empty strings` }
        }
      }
      normalized[key] = value.map(String)
    } else if (spec.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, error: `${key} must be a finite number (JSON number type)` }
      }
      if (spec.exclusiveMinimum != null && value <= spec.exclusiveMinimum) {
        return { ok: false, error: `${key} must be > ${spec.exclusiveMinimum}` }
      }
      normalized[key] = value
    }
  }

  if (normalized.as_of) {
    const { isSettledAsOfEligible } = require('./operationalGuards.cjs')
    const settled = isSettledAsOfEligible(normalized.as_of)
    if (!settled.ok) return { ok: false, error: settled.message, code: settled.code }
  }
  if (normalized.start_date && normalized.end_date && normalized.as_of) {
    if (normalized.start_date > normalized.end_date) {
      return { ok: false, error: 'start_date must be on or before end_date' }
    }
    if (normalized.end_date > normalized.as_of) {
      return { ok: false, error: 'end_date must not be after as_of' }
    }
  }

  if (operation === 'bevvi_period_comparison') {
    if (normalized.comparison === 'custom') {
      if (!normalized.baseline_start || !normalized.baseline_end) {
        return { ok: false, error: 'baseline_start and baseline_end required for custom comparison' }
      }
      if (normalized.baseline_start > normalized.baseline_end) {
        return { ok: false, error: 'baseline_start must be on or before baseline_end' }
      }
      if (normalized.baseline_end >= normalized.start_date) {
        return {
          ok: false,
          error: 'Custom baseline period must finish before the current period start_date'
        }
      }
    } else if (normalized.baseline_start || normalized.baseline_end) {
      return { ok: false, error: 'baseline dates only allowed with custom comparison' }
    }
  }

  if (operation === 'bevvi_historical_seasonality') {
    if (!isCompleteCalendarMonthRange(normalized.start_date, normalized.end_date)) {
      return { ok: false, error: 'Seasonality range must span complete calendar months' }
    }
  }

  return { ok: true, normalized, pythonArguments: { ...normalized } }
}

function validateHandlerOutputShape(operation, handler) {
  const doc = loadOutputContracts()
  const shape = doc.output_shapes?.[operation]
  if (!shape) return { ok: true }

  const nullable = new Set(shape.nullable || [])
  for (const key of shape.required || []) {
    if (!Object.prototype.hasOwnProperty.call(handler, key)) {
      return { ok: false, code: 'missing_output', message: `Handler missing required output field: ${key}` }
    }
    if (handler[key] == null && !nullable.has(key)) {
      return { ok: false, code: 'missing_output', message: `Handler missing required output field: ${key}` }
    }
  }
  if (operation === 'bevvi_analysis_data_quality') {
    if (typeof handler.eligible_orders !== 'number' || !Number.isFinite(handler.eligible_orders)) {
      return { ok: false, code: 'invalid_output', message: 'eligible_orders must be a finite number' }
    }
  }
  if (operation === 'bevvi_planning_forecast' && shape.horizon_keys) {
    if (!isPlainObject(handler.horizons)) {
      return { ok: false, code: 'missing_output', message: 'horizons must be an object' }
    }
    for (const k of shape.horizon_keys) {
      if (handler.horizons[k] == null) {
        return { ok: false, code: 'missing_output', message: `horizons missing key ${k}` }
      }
    }
  }
  if (operation === 'bevvi_period_comparison') {
    for (const k of ['current_period', 'baseline_period', 'metrics', 'revenue_change_bridge']) {
      if (!isPlainObject(handler[k]) && !Array.isArray(handler[k])) {
        if (k === 'breakdown') continue
        if (!isPlainObject(handler[k])) {
          return { ok: false, code: 'missing_output', message: `${k} structure required` }
        }
      }
    }
    if (!Array.isArray(handler.breakdown)) {
      return { ok: false, code: 'missing_output', message: 'breakdown must be an array' }
    }
  }
  if (operation === 'bevvi_historical_seasonality' && Object.prototype.hasOwnProperty.call(handler, 'bulk_threshold_usd')) {
    const v = handler.bulk_threshold_usd
    if (v != null && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) {
      return { ok: false, code: 'invalid_output', message: 'bulk_threshold_usd must be null or a positive number' }
    }
  }
  return { ok: true }
}

function getApprovedAnalysisSourceSha256() {
  return loadOutputContracts().approved_analysis_source_sha256 || []
}

function readExpectedExportSha256() {
  try {
    const raw = fs.readFileSync(EXPORT_SHA256_SIDECAR, 'utf8').trim()
    const line = raw.split(/\r?\n/).find((l) => /^[a-f0-9]{64}$/i.test(l.trim()))
    return line ? line.trim().toLowerCase() : null
  } catch {
    return process.env.BEVVI_ANALYTICS_GATEWAY_TOOLS_LIST_SHA256 || null
  }
}

function verifyExportSha256(expected = null) {
  const expectedSha = (expected || readExpectedExportSha256() || '').toLowerCase()
  if (!expectedSha) {
    return { ok: false, code: 'missing_integrity_sidecar', message: 'Tools list SHA256 sidecar missing' }
  }
  if (!fs.existsSync(EXPORT_PATH)) {
    return { ok: false, code: 'missing_export', message: 'Tools list export file missing' }
  }
  const actual = sha256File(EXPORT_PATH)
  if (actual !== expectedSha) {
    return { ok: false, code: 'sha_mismatch', expected: expectedSha, actual }
  }
  return { ok: true, actual }
}

function assertToolsListIntegrity() {
  const sha = verifyExportSha256()
  if (!sha.ok) {
    return {
      ok: false,
      code: sha.code || 'tools_list_integrity',
      message: sha.message || 'Tools list export integrity check failed',
      details: sha
    }
  }
  const tools = getToolsList()
  if (!tools.length) {
    return {
      ok: false,
      code: 'tools_list_empty',
      message: 'Tools list export contains no tools (expected result.tools or tools array)'
    }
  }
  return { ok: true, toolCount: tools.length, exportSha256: sha.actual }
}

module.exports = {
  EXPORT_PATH,
  EXPORT_SHA256_SIDECAR,
  OUTPUT_CONTRACTS_PATH,
  loadToolsListExport,
  extractToolsFromExport,
  getToolsList,
  getInputSchema,
  validateAgainstSchema,
  validateHandlerOutputShape,
  getApprovedAnalysisSourceSha256,
  verifyExportSha256,
  assertToolsListIntegrity,
  patternImpliesIsoCalendarDate,
  __testOnlyResetToolsListCache
}
