import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CreditCard, Copy, ExternalLink, Loader2, Mail, RefreshCw } from 'lucide-react'
import { apiFetch } from '../utils/api'
import { formatDollarAmount } from '../utils/formatCurrency'
import {
  buildManualOrderPaymentContext,
  buildPaymentEmailMailto,
  isManualOrder
} from '../utils/paymentLink'

const RegenerateInvoiceButton = ({ onClick, disabled, isWorking, className = '', prominent = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={disabled && !isWorking ? 'Customer email, zip code, and order total are required.' : undefined}
    className={
      prominent
        ? `inline-flex items-center rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60 ${className}`
        : `inline-flex items-center rounded-md border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60 ${className}`
    }
  >
    {isWorking ? (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Regenerating…
      </>
    ) : (
      <>
        <RefreshCw className="mr-2 h-4 w-4" />
        Regenerate invoice
      </>
    )}
  </button>
)

const PAYMENT_LINK_LOOKUP_TIMEOUT_MS = 15000

const ManualOrderPaymentSection = ({ order, orderDetails, isActive, onStripeTaxResolved }) => {
  const [paymentLink, setPaymentLink] = useState(null)
  const [stripeConfigured, setStripeConfigured] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [regenerateSuccess, setRegenerateSuccess] = useState(false)
  const lookupRequestIdRef = useRef(0)

  const manualOrder = isManualOrder(order, orderDetails)
  const orderNumber = useMemo(
    () => String(orderDetails?.corpOrderNum || order?.ordernum || order?.id || '').trim(),
    [orderDetails?.corpOrderNum, order?.ordernum, order?.id]
  )
  const paymentContext = orderDetails ? buildManualOrderPaymentContext(order, orderDetails) : null
  const canManagePaymentLink = Boolean(
    paymentContext?.email && paymentContext?.zip && paymentContext?.totalAmount != null
  )

  const onStripeTaxResolvedRef = useRef(onStripeTaxResolved)
  useEffect(() => {
    onStripeTaxResolvedRef.current = onStripeTaxResolved
  }, [onStripeTaxResolved])

  const loadPaymentLink = useCallback(async () => {
    if (!orderNumber) {
      setIsLoading(false)
      return
    }

    const requestId = ++lookupRequestIdRef.current
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), PAYMENT_LINK_LOOKUP_TIMEOUT_MS)

    setIsLoading(true)
    setError(null)
    try {
      const response = await apiFetch(
        `/api/manual-order/payment-link?orderNumber=${encodeURIComponent(orderNumber)}`,
        { signal: controller.signal }
      )
      const data = await response.json()
      if (requestId !== lookupRequestIdRef.current) return
      if (!response.ok || !data.success) {
        setError(data.message || data.error || 'Failed to load invoice')
        setPaymentLink(null)
        return
      }
      setStripeConfigured(data.configured !== false)
      setPaymentLink(data.paymentLink?.url ? data.paymentLink : null)
      setRegenerateSuccess(false)
    } catch (e) {
      if (requestId !== lookupRequestIdRef.current) return
      if (e.name === 'AbortError') {
        setError('Invoice lookup timed out. Make sure the API server is running on port 3001, then retry.')
      } else {
        setError(e.message || 'Network error')
      }
      setPaymentLink(null)
    } finally {
      window.clearTimeout(timeoutId)
      if (requestId === lookupRequestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [orderNumber])

  useEffect(() => {
    if (paymentLink?.stripeTaxAmount == null) return
    onStripeTaxResolvedRef.current?.(paymentLink.stripeTaxAmount)
  }, [paymentLink?.stripeTaxAmount])

  useEffect(() => {
    if (!isActive || !manualOrder || !orderNumber) {
      lookupRequestIdRef.current += 1
      setPaymentLink(null)
      setError(null)
      setIsLoading(false)
      return
    }
    loadPaymentLink()
    return () => {
      lookupRequestIdRef.current += 1
    }
  }, [isActive, manualOrder, orderNumber, loadPaymentLink])

  const handleCreatePaymentLink = async ({ regenerate = false } = {}) => {
    if (!paymentContext) return
    if (!paymentContext.email) {
      setError('Customer email is required to create an invoice.')
      return
    }
    if (paymentContext.totalAmount == null) {
      setError('Order total is required to create an invoice.')
      return
    }
    if (!paymentContext.zip) {
      setError('Recipient zip code is required so Stripe can calculate tax.')
      return
    }
    if (
      regenerate &&
      !window.confirm(
        'Create a new Stripe invoice using the current order details? The previous invoice or link will be voided or deactivated.'
      )
    ) {
      return
    }

    setIsCreating(true)
    setError(null)
    try {
      const response = await apiFetch('/api/manual-order/payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...paymentContext, regenerate })
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        setError(
          response.status === 409
            ? data.error || 'The previous invoice has already been paid and cannot be regenerated.'
            : data.message || data.error || 'Failed to create invoice'
        )
        return
      }
      if (data.paymentLink?.skipped) {
        setError(data.paymentLink.reason || 'Invoice was not created')
        return
      }
      if (!data.paymentLink?.url) {
        setError('Invoice payment URL was not returned by the server')
        return
      }
      setPaymentLink(data.paymentLink)
      if (data.regenerated) {
        setRegenerateSuccess(true)
        window.setTimeout(() => setRegenerateSuccess(false), 10000)
      } else {
        setRegenerateSuccess(false)
      }
    } catch (e) {
      setError(e.message || 'Network error')
    } finally {
      setIsCreating(false)
    }
  }

  if (!manualOrder) return null

  const regenerateDisabled = isCreating || isLoading || !canManagePaymentLink
  const detailsStillLoading = !orderDetails

  return (
    <div className="space-y-4 rounded-lg border border-indigo-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-lg font-semibold text-gray-900 flex items-center">
          <CreditCard className="h-5 w-5 text-bevvi-primary-600 mr-2" />
          Stripe Invoice
        </h4>
      </div>

      {detailsStillLoading ? (
        <p className="text-xs text-gray-500">Loading order details for invoice line items…</p>
      ) : null}

      {stripeConfigured && !isLoading && !paymentLink?.url && !detailsStillLoading ? (
        <p className="text-xs text-gray-500">
          Creates an itemized Stripe invoice with automatic tax for the recipient zip.
        </p>
      ) : null}

      {!stripeConfigured ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Stripe is not configured on the server. Set <code className="font-mono text-xs">STRIPE_SECRET_KEY</code> in your <code className="font-mono text-xs">.env</code> file.
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking for an existing invoice…
          </div>
        </div>
      ) : paymentLink?.url ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-4 text-sm text-indigo-900">
          <p className="font-semibold">
            {regenerateSuccess
              ? 'New invoice created'
              : paymentLink.paymentType === 'payment_link'
                ? 'Payment link ready'
                : 'Invoice ready'}
          </p>
          {regenerateSuccess ? (
            <p className="mt-1 text-green-800">
              The previous invoice was voided. Use the link below to pay or email the customer.
            </p>
          ) : null}
          {(paymentLink.automaticTax || paymentLink.recipientZip) && paymentLink.paymentType !== 'payment_link' ? (
            <p className="mt-1 text-indigo-800">
              {paymentLink.recipientZip || paymentContext?.zip ? (
                <>Tax calculated by Stripe for zip <strong>{paymentLink.recipientZip || paymentContext?.zip}</strong>.</>
              ) : (
                'Tax calculated automatically by Stripe.'
              )}
              {paymentLink.stripeTaxAmount != null ? (
                <> Invoice tax: <strong>{formatDollarAmount(paymentLink.stripeTaxAmount)}</strong>.</>
              ) : null}
            </p>
          ) : null}
          {(paymentLink.orderNumber || paymentLink.totalAmount != null || paymentLink.invoiceId || paymentLink.paymentLinkId) && (
            <p className="mt-1 text-indigo-800">
              {paymentLink.orderNumber ? (
                <span className="mr-4">
                  Order: <strong>{paymentLink.orderNumber}</strong>
                </span>
              ) : null}
              {paymentLink.totalAmount != null ? (
                <span className="mr-4">
                  Total: <strong>{formatDollarAmount(paymentLink.totalAmount)}</strong>
                </span>
              ) : paymentContext?.totalAmount != null ? (
                <span className="mr-4">
                  Total: <strong>{formatDollarAmount(paymentContext.totalAmount)}</strong>
                </span>
              ) : null}
              {paymentLink.invoiceId || paymentLink.paymentLinkId ? (
                <span>
                  Stripe ID:{' '}
                  <strong className="font-mono text-xs">
                    {paymentLink.invoiceId || paymentLink.paymentLinkId}
                  </strong>
                </span>
              ) : null}
            </p>
          )}
          <p className="mt-1 text-xs text-indigo-700">
            {paymentLink.paymentType === 'payment_link' ? (
              <>Find this under <strong>Payment Links</strong> in your Stripe dashboard.</>
            ) : (
              <>This is a Stripe <strong>Invoice</strong> — find it under <strong>Billing → Invoices</strong> in Stripe.</>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={buildPaymentEmailMailto({
                customerEmail: paymentLink.customerEmail || paymentContext?.email,
                customerName: paymentContext?.customerName,
                orderNumber: paymentLink.orderNumber || paymentContext?.orderNumber || orderNumber,
                totalAmount: paymentLink.totalAmount ?? paymentContext?.totalAmount,
                paymentUrl: paymentLink.url
              })}
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              <Mail className="mr-2 h-4 w-4" />
              Email customer
            </a>
            <a
              href={paymentLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {paymentLink.paymentType === 'payment_link' ? 'Open link' : 'Open invoice'}
            </a>
            {paymentLink.stripeDashboardUrl ? (
              <a
                href={paymentLink.stripeDashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-md border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                View in Stripe
              </a>
            ) : null}
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(paymentLink.url)
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 2000)
                } catch {
                  setError('Could not copy link to clipboard')
                }
              }}
              className="inline-flex items-center rounded-md border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
            >
              <Copy className="mr-2 h-4 w-4" />
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <RegenerateInvoiceButton
              onClick={() => handleCreatePaymentLink({ regenerate: true })}
              disabled={regenerateDisabled}
              isWorking={isCreating}
            />
          </div>
          {!regenerateSuccess ? (
            <p className="mt-2 text-xs text-indigo-700">
              Need updated line items or totals? Regenerate to void this invoice and create a fresh one.
            </p>
          ) : null}
          <p className="mt-3 break-all text-xs text-indigo-700">{paymentLink.url}</p>
        </div>
      ) : detailsStillLoading ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Waiting for order details before you can create a new invoice.
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <p className="font-semibold">No Stripe invoice yet</p>
          <p className="mt-1 text-amber-800">
            Create an invoice for{' '}
            <strong>{formatDollarAmount(paymentContext?.totalAmount)}</strong>
            {orderNumber ? (
              <> (order <strong>{orderNumber}</strong>)</>
            ) : null}{' '}
            so you can email it to the customer.
            {paymentContext?.zip ? (
              <> Stripe will calculate tax for zip <strong>{paymentContext.zip}</strong>.</>
            ) : null}
          </p>
          {error ? <p className="mt-2 text-red-800" role="alert">{error}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleCreatePaymentLink()}
              disabled={isCreating || !canManagePaymentLink}
              className="inline-flex items-center rounded-md bg-bevvi-800 px-4 py-2 text-sm font-medium text-white hover:bg-bevvi-900 disabled:opacity-60"
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                'Create invoice'
              )}
            </button>
            <RegenerateInvoiceButton
              onClick={() => handleCreatePaymentLink({ regenerate: true })}
              disabled={regenerateDisabled}
              isWorking={isCreating}
            />
          </div>
        </div>
      )}

      {error && !isLoading && !paymentLink?.url ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm text-red-700" role="alert">{error}</p>
          <button
            type="button"
            onClick={loadPaymentLink}
            className="text-sm font-medium text-indigo-700 hover:text-indigo-900"
          >
            Retry
          </button>
        </div>
      ) : null}

      {error && paymentLink?.url ? (
        <p className="text-sm text-red-700" role="alert">{error}</p>
      ) : null}
    </div>
  )
}

export default ManualOrderPaymentSection
