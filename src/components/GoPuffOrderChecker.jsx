import React, { useState, useCallback } from 'react'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { apiFetch } from '../utils/api'

const STEP = {
  INPUT: 'input',
  VALIDATED: 'validated',
  PREVIEW: 'preview',
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

const GoPuffOrderChecker = () => {
  const [orderNumber, setOrderNumber] = useState('')
  const [step, setStep] = useState(STEP.INPUT)
  const [validationJson, setValidationJson] = useState(null)
  const [previewJson, setPreviewJson] = useState(null)
  const [submitJson, setSubmitJson] = useState(null)
  const [resendJson, setResendJson] = useState(null)
  const [loading, setLoading] = useState(null)
  const [error, setError] = useState(null)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [showResendConfirm, setShowResendConfirm] = useState(false)

  const startOver = useCallback(() => {
    setStep(STEP.INPUT)
    setValidationJson(null)
    setPreviewJson(null)
    setSubmitJson(null)
    setResendJson(null)
    setResendJson(null)
    setError(null)
    setLoading(null)
    setShowSubmitConfirm(false)
    setShowResendConfirm(false)
  }, [])

  const handleValidate = async () => {
    setError(null)
    setValidationJson(null)
    setPreviewJson(null)
    setSubmitJson(null)
    setResendJson(null)
    const trimmed = orderNumber.trim()
    if (!trimmed) {
      setError({ message: 'Enter an order number to validate.' })
      return
    }
    setLoading('validate')
    try {
      const q = new URLSearchParams({ orderNumber: trimmed })
      const res = await apiFetch(`/api/validate-order?${q}`)
      if (!res.ok) {
        setError(await parseErrorFromResponse(res))
        return
      }
      const data = await res.json()
      setValidationJson(data)
      setPreviewJson(null)
      setSubmitJson(null)
      setStep(STEP.VALIDATED)
    } catch (e) {
      setError({ message: e.message || 'Network error' })
    } finally {
      setLoading(null)
    }
  }

  const handlePreview = async () => {
    setError(null)
    const trimmed = orderNumber.trim()
    setLoading('preview')
    try {
      const q = new URLSearchParams({ orderNumber: trimmed })
      const res = await apiFetch(`/api/preview-order?${q}`)
      if (!res.ok) {
        setError(await parseErrorFromResponse(res))
        return
      }
      const data = await res.json()
      setPreviewJson(data)
      setSubmitJson(null)
      setStep(STEP.PREVIEW)
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
      if (!res.ok) {
        setError(await parseErrorFromResponse(res))
        return
      }
      const data = await res.json()
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
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-bevvi-primary-600" aria-hidden />
          <h2 className="text-lg font-semibold text-gray-900">GoPuff order checker</h2>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          Validate a corporate order, preview what will be sent to GoPuff, submit, or resend an existing order.
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="gopuff-order-number" className="block text-sm font-medium text-gray-700">
              Order number
            </label>
            <input
              id="gopuff-order-number"
              type="text"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              disabled={step !== STEP.INPUT || busy}
              placeholder="Corporate order number"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-bevvi-primary-500 focus:outline-none focus:ring-1 focus:ring-bevvi-primary-500 disabled:bg-gray-100 disabled:text-gray-600"
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
                    'Validate'
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
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={busy}
                  className="inline-flex items-center justify-center rounded-md bg-bevvi-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-bevvi-primary-700 focus:outline-none focus:ring-2 focus:ring-bevvi-primary-500 focus:ring-offset-2 disabled:opacity-50"
                >
                  {loading === 'preview' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading preview…
                    </>
                  ) : (
                    'Load order details'
                  )}
                </button>
                <button
                  type="button"
                  onClick={startOver}
                  disabled={busy}
                  className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-bevvi-primary-500 focus:ring-offset-2 disabled:opacity-50"
                >
                  Start over
                </button>
              </>
            )}

            {step === STEP.PREVIEW && (
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
                  <div className="w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                    <p className="font-medium">Send this order to GoPuff?</p>
                    <p className="mt-1 text-amber-800">This uses the same order number you validated and previewed.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={busy}
                        className="inline-flex items-center justify-center rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                      >
                        {loading === 'submit' ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Submitting…
                          </>
                        ) : (
                          'Yes, send to GoPuff'
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSubmitConfirm(false)}
                        disabled={busy}
                        className="inline-flex items-center justify-center rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                      >
                        Cancel
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

          {step === STEP.VALIDATED && <JsonPanel title="Validation response" data={validationJson} />}
          {step === STEP.PREVIEW && (
            <>
              <JsonPanel title="Validation response" data={validationJson} />
              <JsonPanel title="Preview response" data={previewJson} />
            </>
          )}
          {step === STEP.SUBMIT_SUCCESS && (
            <>
              <JsonPanel title="Validation response" data={validationJson} />
              <JsonPanel title="Preview response" data={previewJson} />
              <JsonPanel title="Submit response" data={submitJson} />
            </>
          )}
          {resendJson != null && <JsonPanel title="Resend response" data={resendJson} />}
        </div>
      </div>
    </div>
  )
}

export default GoPuffOrderChecker
