'use strict'

/** Planning-forecast Analytics tab + /api/analytics/* (opt-in via env). */
function isAnalyticsDashboardEnabled() {
  return String(process.env.BEVVI_ANALYTICS_DASHBOARD_ENABLED || '').toLowerCase() === 'true'
}

module.exports = { isAnalyticsDashboardEnabled }
