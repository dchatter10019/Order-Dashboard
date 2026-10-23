import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw, TrendingUp, CalendarDays, AlertTriangle } from 'lucide-react'
import PageHeader from './ui/PageHeader'
import { TAB_COPY } from '../constants/brand'
import { formatDollarAmount, formatNumber } from '../utils/formatCurrency'

function MetricCard({ title, subtitle, slice, loading }) {
  if (loading) {
    return (
      <div className="bevvi-card p-6 animate-pulse">
        <div className="h-4 bg-bevvi-100 rounded w-1/3 mb-4" />
        <div className="h-8 bg-bevvi-100 rounded w-1/2 mb-2" />
        <div className="h-4 bg-bevvi-100 rounded w-2/3" />
      </div>
    )
  }

  if (!slice?.available) {
    return (
      <div className="bevvi-card p-6">
        <h3 className="font-display text-lg font-semibold text-bevvi-900">{title}</h3>
        <p className="text-sm text-bevvi-dark-600 mt-2">No forecast slice available for this period.</p>
      </div>
    )
  }

  return (
    <div className="bevvi-card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-bevvi-900">{title}</h3>
          {subtitle && <p className="text-sm text-bevvi-dark-600 mt-1">{subtitle}</p>}
        </div>
        {slice.partial_period && (
          <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-900">
            Partial period
          </span>
        )}
      </div>
      <dl className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-bevvi-dark-500">Orders</dt>
          <dd className="text-2xl font-semibold text-bevvi-900 mt-1">
            {slice.orders != null ? formatNumber(slice.orders) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-bevvi-dark-500">Revenue</dt>
          <dd className="text-2xl font-semibold text-bevvi-900 mt-1">
            {slice.revenue_usd != null ? formatDollarAmount(slice.revenue_usd) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-bevvi-dark-500">AOV</dt>
          <dd className="text-2xl font-semibold text-bevvi-900 mt-1">
            {slice.aov_usd != null ? formatDollarAmount(slice.aov_usd) : '—'}
          </dd>
        </div>
      </dl>
      {(slice.start_date || slice.end_date) && (
        <p className="text-xs text-bevvi-dark-500 mt-4">
          {slice.start_date} → {slice.end_date}
          {slice.days != null ? ` · ${slice.days} day(s)` : ''}
        </p>
      )}
      {slice.interpretation && (
        <p className="text-xs text-bevvi-dark-600 mt-2">{slice.interpretation}</p>
      )}
    </div>
  )
}

const AnalyticsDashboard = () => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [jobId, setJobId] = useState(null)

  const load = useCallback(async (pollJobId = null) => {
    try {
      setError(null)
      if (!pollJobId) setLoading(true)

      const qs = pollJobId ? `?jobId=${encodeURIComponent(pollJobId)}` : ''
      const res = await fetch(`/api/analytics/planning-forecast${qs}`)
      const body = await res.json()

      if (!res.ok && body.status !== 'pending') {
        throw new Error(body.message || body.error || 'Failed to load forecast')
      }

      if (body.status === 'pending') {
        setJobId(body.jobId)
        setLoading(true)
        return
      }

      setJobId(null)
      setData(body)
      setLoading(false)
    } catch (err) {
      setError(err.message || 'Failed to load analytics')
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!jobId) return undefined
    const timer = setInterval(() => load(jobId), 4000)
    return () => clearInterval(timer)
  }, [jobId, load])

  const copy = TAB_COPY.analytics

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <button
            type="button"
            onClick={() => load()}
            disabled={loading && !jobId}
            className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg border border-bevvi-200 text-bevvi-900 hover:bg-bevvi-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {jobId && loading && (
        <p className="text-sm text-bevvi-dark-600">
          Analytics job in progress via MCP gateway… <code className="text-xs">{jobId}</code>
        </p>
      )}

      {data?.review_only && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Review-only forecast (not accounting-certified). As of {data.as_of}; Eastern today{' '}
          {data.eastern_today}.
          {data.gateway_job_id && (
            <>
              {' '}
              Job <code className="text-xs">{data.gateway_job_id}</code>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MetricCard
          title="Today"
          subtitle={data?.today?.label}
          slice={loading && !data ? null : data?.today}
          loading={loading && !data}
        />
        <MetricCard
          title="Current month"
          subtitle={data?.current_month?.label}
          slice={loading && !data ? null : data?.current_month}
          loading={loading && !data}
        />
      </div>

      {data?.limitations?.length > 0 && (
        <div className="bevvi-card p-5">
          <h4 className="text-sm font-semibold text-bevvi-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Model limitations
          </h4>
          <ul className="mt-2 list-disc list-inside text-sm text-bevvi-dark-700 space-y-1">
            {data.limitations.slice(0, 5).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {!loading && !error && !data && (
        <p className="text-sm text-bevvi-dark-600 flex items-center gap-2">
          <CalendarDays className="w-4 h-4" />
          No forecast data yet.
        </p>
      )}
    </div>
  )
}

export default AnalyticsDashboard
