const {
  REVIEW_CHECKOUT_PATH,
  OPERATIONAL_ROOT_PATH,
  COMPUTER_THREAD_ID
} = require('./constants.cjs')
const { BINDING_KEY, HANDLER_KEY } = require('./jobBinding.cjs')

/**
 * Server-authored Computer task text. Caller args are embedded as JSON only (data, not shell).
 */
function buildComputerTaskMessage(operation, normalizedPythonArgs, jobId, jobBinding = null) {
  const argsJson = JSON.stringify(normalizedPythonArgs)
  const artifactPath = jobId
    ? `/home/user/workspace/bevvi-analytics-jobs/${jobId}.json`
    : '/home/user/workspace/bevvi-analytics-jobs/<server-generated-job-id>'
  const bindingJson = jobBinding ? JSON.stringify(jobBinding) : null
  return [
    'Bevvi analytics gateway job (read-only). Do not modify caches, registries, or forecast snapshots.',
    `Use thread ${COMPUTER_THREAD_ID} only.`,
    `In ${REVIEW_CHECKOUT_PATH} run review_server via:`,
    `cd ${REVIEW_CHECKOUT_PATH} && BEVVI_ANALYTICS_MCP_ROOT=${OPERATIONAL_ROOT_PATH} PYTHONPATH=${REVIEW_CHECKOUT_PATH} python3 -B -m ml.mcp.review_server`,
    'Send one JSON-RPC tools/call on stdin with this exact tool name and arguments object (no shell interpolation):',
    `tool_name=${operation}`,
    `arguments=${argsJson}`,
    'Return the handler JSON result only. If confirmation or auth is required, stop and report the checkpoint event.',
    'Do not modify caches, registries, forecast snapshots, or any runtime data outside the single job-result file below.',
    `Required artifact schema: JSON object with "${HANDLER_KEY}" (unchanged handler JSON) and "${BINDING_KEY}" (exact gateway binding copied verbatim).`,
    bindingJson ? `Required ${BINDING_KEY} object (copy exactly): ${bindingJson}` : '',
    `Required: write the complete artifact object to exactly ${artifactPath} and nowhere else (only permitted write).`,
    jobId
      ? `Required before completion: register/share that exact file on thread ${COMPUTER_THREAD_ID} as a thread asset named ${jobId}.json (must appear in list_thread_assets with filename ${jobId}.json). A workspace file alone is not sufficient.`
      : '',
    'The handler_result JSON must remain pristine Python output (no gateway job_id/operation/request_hash fields).',
    jobId ? `gateway_job_binding must carry job_id ${jobId}, operation ${operation}, and canonical arguments.` : '',
    'Do not finish until the job JSON artifact is written and visible on the thread for gateway download.'
  ]
    .filter(Boolean)
    .join('\n')
}

module.exports = {
  buildComputerTaskMessage
}
