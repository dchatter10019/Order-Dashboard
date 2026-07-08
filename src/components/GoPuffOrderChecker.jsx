import React, { useState, useCallback } from 'react'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { apiFetch } from '../utils/api'
import PageHeader from './ui/PageHeader'
import { TAB_COPY } from '../constants/brand'

const STEP = {
  INPUT: 'input',
  VALIDATED: 'validated',
  SUBMIT_SUCCESS: 'submit_success'
}

function JsonPanel({ title, data }) {
  if (data == null) return null
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      <pre className="mt-2 p-4 bg-slate-900 text-emerald-100 text-xs rounded-lg overflow-auto max-h-[28rem] font-mono border border-slate-700">
        {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

async function parseErrorFromResponse(response) {
  let message = `Request failed (${response.status})`
  let details = null
  try {
    const ct = response.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      const j = await response.json()
      details = j
      message = j.message || j.error || message
    } else {
      const t = await response.text()
      if (t) message = t.length > 800 ? `${t.slice(0, 800)}…` : t
    }
  } catch {
    /* ignore */
  }
  return { message, details, status: response.status }
}

function parseGoPuffApiResult(data) {
  if (data == null || typeof data !== 'object') {
    return { ok: true }
  }
  if (data.status === false || data.success === false) {
    return {
      ok: false,
      message: data.message || data.error || 'GoPuff request failed'
    }
  }
  return { ok: true }
}

const GoPuffOrderChecker = () => {
  const [orderNumber, setOrderNumber] = useState('')
  const [step, setStep] = useState(STEP.INPUT)
  const [validationJson, setValidationJson] = useState(null)
  const [submitJson, setSubmitJson] = useState(null)
  const [resendJson, setResendJson] = useState(null)
  const [loading, setLoading] = useState(null)
  const [error, setError] = useState(null)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [showResendConfirm, setShowResendConfirm] = useState(false)

  const startOver = useCallback(() => {
    setStep(STEP.INPUT)
    setValidationJson(null)
    setSubmitJson(null)
    setResendJson(null)
    setError(null)
    setLoading(null)
    setShowSubmitConfirm(false)
    setShowResendConfirm(false)
  }, [])

  const handleValidate = async () => {
    setError(null)
    setValidationJson(null)
    setSubmitJson(null)
    setResendJson(null)
    setShowSubmitConfirm(false)

    const trimmed = orderNumber.trim()
    if (!trimmed) {
      setError({ message: 'Enter an order number to validate.' })
      return
    }

    setLoading('validate')
    try {
      const q = new URLSearchParams({ orderNumber: trimmed })
      const res = await apiFetch(`/api/validate-order?${q}`)
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError({
          message: data?.message || data?.error || `Request failed (${res.status})`,
          details: data
        })
        return
      }

      const result = parseGoPuffApiResult(data)
      if (!result.ok) {
        setValidationJson(data)
        setError({ message: result.message, details: data })
        return
      }

      setValidationJson(data)
      setSubmitJson(null)
      setStep(STEP.VALIDATED)
      setShowSubmitConfirm(true)
    } catch (e) {
      setError({ message: e.message || 'Network error' })
    } finally {
      setLoading(null)
    }
  }

  const handleResend = async () => {
    setError(null)
    const trimmed = orderNumber.trim()
    setLoading('resend')
    setShowResendConfirm(false)
    try {
      const q = new URLSearchParams({ orderNumber: trimmed })
      const res = await apiFetch(`/api/resend-order?${q}`)
      if (!res.ok) {
        setError(await parseErrorFromResponse(res))
        return
      }
      const data = await res.json()
      setResendJson(data)
    } catch (e) {
      setError({ message: e.message || 'Network error' })
    } finally {
      setLoading(null)
    }
  }

  const handleSubmit = async () => {
    setError(null)
    const trimmed = orderNumber.trim()
    setLoading('submit')
    setShowSubmitConfirm(false)
    try {
      const q = new URLSearchParams({ orderNumber: trimmed })
      const res = await apiFetch(`/api/submit-order?${q}`)
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError({
          message: data?.message || data?.error || `Request failed (${res.status})`,
          details: data
        })
        return
      }

      const result = parseGoPuffApiResult(data)
      if (!result.ok) {
        setError({ message: result.message, details: data })
        return
      }

      setSubmitJson(data)
      setStep(STEP.SUBMIT_SUCCESS)
    } catch (e) {
      setError({ message: e.message || 'Network error' })
    } finally {
      setLoading(null)
    }
  }

  const busy = loading !== null

  return (
    <div className="bevvi-page-panel">
      <div className="max-w-3xl">
        <PageHeader
          icon={ClipboardCheck}
          title={TAB_COPY['gopuff-checker'].title}
          description="Enter an order number, validate it, then confirm to submit to GoPuff."
        />

        <div className="space-y-4">
          <div>
            <label htmlFor="gopuff-order-number" className="bevvi-label">
              Order number
            </label>
            <input
              id="gopuff-order-number"
              type="text"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              disabled={step !== STEP.INPUT || busy}
              placeholder="Corporate order number"
              className="input-field text-sm disabled:bg-bevvi-dark-100 disabled:text-bevvi-dark-500"
            />
            {step !== STEP.INPUT && (
              <p className="mt-1 text-xs text-gray-500">Start over to use a different order number.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {step === STEP.INPUT && (
              <>
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={busy || showResendConfirm}
                  className="inline-flex items-center justify-center rounded-md bg-bevvi-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-bevvi-primary-700 focus:outline-none focus:ring-2 focus:ring-bevvi-primary-500 focus:ring-offset-2 disabled:opacity-50"
                >
                  {loading === 'validate' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Validating…
                    </>
                  ) : (
                    'Validate order'
                  )}
                </button>
                {!showResendConfirm ? (
                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = orderNumber.trim()
                      if (!trimmed) {
                        setError({ message: 'Enter an order number to resend.' })
                        return
                      }
                      setError(null)
                      setShowResendConfirm(true)
                    }}
                    disabled={busy}
                    className="inline-flex items-center justify-center rounded-md border border-bevvi-primary-600 bg-white px-4 py-2 text-sm font-medium text-bevvi-primary-700 shadow-sm hover:bg-bevvi-primary-50 focus:outline-none focus:ring-2 focus:ring-bevvi-primary-500 focus:ring-offset-2 disabled:opacity-50"
                  >
                    Resend Order
                  </button>
                ) : (
                  <div className="w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                    <p className="font-medium">Resend this order to GoPuff?</p>
                    <p className="mt-1 text-amber-800">Order number: {orderNumber.trim()}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleResend}
                        disabled={busy}
                        className="inline-flex items-center justify-center rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                      >
                        {loading === 'resend' ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Resending…
                          </>
                        ) : (
                          'Yes, resend order'
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowResendConfirm(false)}
                        disabled={busy}
                        className="inline-flex items-center justify-center rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {step === STEP.VALIDATED && (
              <>
                {!showSubmitConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowSubmitConfirm(true)}
                    disabled={busy}
                    className="inline-flex items-center justify-center rounded-md bg-bevvi-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-bevvi-primary-700 focus:outline-none focus:ring-2 focus:ring-bevvi-primary-500 focus:ring-offset-2 disabled:opacity-50"
                  >
                    Submit to GoPuff
                  </button>
                ) : (
                  <div className="w-full rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
                    <p className="font-medium">Order validated successfully.</p>
                    <p className="mt-1 text-emerald-800">
                      Submit order <strong>{orderNumber.trim()}</strong> to GoPuff?
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={busy}
                        className="inline-flex items-center justify-center rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                      >
                        {loading === 'submit' ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Submitting…
                          </>
                        ) : (
                          'Yes, submit order'
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSubmitConfirm(false)}
                        disabled={busy}
                        className="inline-flex items-center justify-center rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        Not now
                      </button>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={startOver}
                  disabled={busy || showSubmitConfirm}
                  className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-bevvi-primary-500 focus:ring-offset-2 disabled:opacity-50"
                >
                  Start over
                </button>
              </>
            )}

            {step === STEP.SUBMIT_SUCCESS && (
              <button
                type="button"
                onClick={startOver}
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-bevvi-primary-500 focus:ring-offset-2"
              >
                Start over
              </button>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              <p className="font-medium">Something went wrong</p>
              <p className="mt-1">{error.message}</p>
              {error.details != null && (
                <JsonPanel title="Error details (JSON)" data={error.details} />
              )}
            </div>
          )}

          {(step === STEP.VALIDATED || step === STEP.SUBMIT_SUCCESS) && (
            <JsonPanel title="Validation response" data={validationJson} />
          )}
          {step === STEP.SUBMIT_SUCCESS && (
            <JsonPanel title="Submit response" data={submitJson} />
          )}
          {resendJson != null && <JsonPanel title="Resend response" data={resendJson} />}
        </div>
      </div>
    </div>
  )
}

export default GoPuffOrderChecker
