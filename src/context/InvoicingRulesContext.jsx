import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createInvoicingRulesEngine } from '@lib/invoicing-rules'
import { apiFetch } from '../utils/api'

const InvoicingRulesContext = createContext({
  engine: null,
  rules: null,
  loadedAt: null,
  sourcePath: null,
  loading: true,
  error: null,
  refresh: async () => {}
})

export function InvoicingRulesProvider({ children }) {
  const [engine, setEngine] = useState(null)
  const [rules, setRules] = useState(null)
  const [loadedAt, setLoadedAt] = useState(null)
  const [sourcePath, setSourcePath] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch('/api/invoicing-rules')
      const data = await response.json()
      if (!response.ok || !data.success || !data.rules) {
        throw new Error(data.message || data.error || 'Failed to load invoicing rules')
      }
      setRules(data.rules)
      setEngine(createInvoicingRulesEngine(data.rules))
      setLoadedAt(data.loadedAt || null)
      setSourcePath(data.sourcePath || null)
    } catch (e) {
      setError(e.message || 'Failed to load invoicing rules')
      setEngine(null)
      setRules(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [refresh])

  const value = useMemo(
    () => ({
      engine,
      rules,
      loadedAt,
      sourcePath,
      loading,
      error,
      refresh
    }),
    [engine, rules, loadedAt, sourcePath, loading, error, refresh]
  )

  return (
    <InvoicingRulesContext.Provider value={value}>{children}</InvoicingRulesContext.Provider>
  )
}

export function useInvoicingRules() {
  return useContext(InvoicingRulesContext)
}
