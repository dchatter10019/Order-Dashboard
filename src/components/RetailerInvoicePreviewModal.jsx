import React, { useState } from 'react'
import { X, FileText, Mail } from 'lucide-react'
import { formatDollarAmount } from '../utils/formatCurrency'

const RetailerInvoicePreviewModal = ({ preview, isOpen, onClose, isLoading, error }) => {
  const [tab, setTab] = useState('invoice')

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-6 w-6 shrink-0 text-bevvi-primary-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Invoice preview</h2>
              {preview?.retailerName && (
                <p className="text-sm text-gray-500">{preview.retailerName}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close preview"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-gray-100 px-4 pt-2 sm:px-6">
          <button
            type="button"
            onClick={() => setTab('invoice')}
            className={`px-3 py-2 text-sm font-medium rounded-t-md ${
              tab === 'invoice'
                ? 'bg-bevvi-primary-50 text-bevvi-primary-700 border-b-2 border-bevvi-primary-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Invoice
          </button>
          <button
            type="button"
            onClick={() => setTab('email')}
            className={`px-3 py-2 text-sm font-medium rounded-t-md flex items-center gap-1 ${
              tab === 'email'
                ? 'bg-bevvi-primary-50 text-bevvi-primary-700 border-b-2 border-bevvi-primary-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Mail className="h-3.5 w-3.5" />
            Email
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {isLoading && <p className="text-gray-600 text-sm">Building preview…</p>}
          {error && <p className="text-red-700 text-sm">{error}</p>}
          {!isLoading && !error && preview && tab === 'invoice' && (
            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
              <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">From</p>
                  <p className="font-semibold text-gray-900">{preview.fromOrg}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Invoice</p>
                  <p className="text-sm text-gray-700">Date: {preview.invoiceDate}</p>
                  <p className="text-xs text-gray-500 break-all">Ref: {preview.referenceNumber}</p>
                </div>
              </div>
              <div className="px-6 py-4 border-b border-gray-100">
                <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Bill to</p>
                <p className="font-medium text-gray-900">{preview.retailerName}</p>
                {preview.billToEmail && (
                  <p className="text-sm text-gray-600">{preview.billToEmail}</p>
                )}
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-6 py-2 font-medium">Item</th>
                    <th className="px-4 py-2 font-medium text-right w-16">Qty</th>
                    <th className="px-4 py-2 font-medium text-right w-28">Rate</th>
                    <th className="px-6 py-2 font-medium text-right w-28">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lineItems.map((line, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-6 py-3">
                        <p className="font-medium text-gray-900">{line.name}</p>
                        <p className="text-gray-600 text-xs mt-0.5">{line.description}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-800">{line.quantity}</td>
                      <td className="px-4 py-3 text-right text-gray-800">
                        {formatDollarAmount(line.rate)}
                      </td>
                      <td className="px-6 py-3 text-right font-medium text-gray-900">
                        {formatDollarAmount(line.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
                <div className="text-right">
                  <p className="text-sm text-gray-600">
                    Total ({preview.currency})
                  </p>
                  <p className="text-xl font-bold text-gray-900">{formatDollarAmount(preview.total)}</p>
                </div>
              </div>
              {(preview.notes || preview.terms) && (
                <div className="px-6 py-4 border-t border-gray-100 text-sm space-y-3">
                  {preview.notes && (
                    <div>
                      <p className="text-xs font-semibold uppercase text-gray-500">Notes</p>
                      <p className="text-gray-800 whitespace-pre-wrap">{preview.notes}</p>
                    </div>
                  )}
                  {preview.terms && (
                    <div>
                      <p className="text-xs font-semibold uppercase text-gray-500">Terms</p>
                      <p className="text-gray-800 whitespace-pre-wrap">{preview.terms}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!isLoading && !error && preview && tab === 'email' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 p-4 text-sm">
                <p>
                  <span className="text-gray-500">To:</span>{' '}
                  <span className="font-medium">{preview.email.to}</span>
                </p>
                <p className="mt-2">
                  <span className="text-gray-500">Subject:</span>{' '}
                  <span className="font-medium">{preview.email.subject}</span>
                </p>
                <pre className="mt-4 whitespace-pre-wrap text-gray-800 font-sans text-sm bg-gray-50 rounded-md p-3 border border-gray-100">
                  {preview.email.body}
                </pre>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-semibold mb-1">Payment link</p>
                <p className="mb-2">{preview.payment.onlinePaymentLinkInEmail}</p>
                <p>
                  <span className="font-medium">Accepted methods:</span> {preview.payment.acceptedMethods}
                  {!preview.payment.creditCardsAccepted && ' (no credit cards)'}
                </p>
                <p className="mt-2 text-xs text-amber-900">{preview.payment.zohoPayNowButton}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default RetailerInvoicePreviewModal
