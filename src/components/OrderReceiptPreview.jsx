import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Printer } from 'lucide-react'
import { buildOrderReceiptModel, formatReceiptMoney } from '../utils/orderReceipt'
import { printOrderReceipt } from '../utils/printOrderReceipt'
import receiptStyles from './OrderReceiptPreview.css?inline'
import './OrderReceiptPreview.css'

const RECEIPT_DOC_WIDTH = 816

function BottlePlaceholder() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 3h6v3l-1 1v11a3 3 0 0 1-3 3h0a3 3 0 0 1-3-3V7L9 6V3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9 6h6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function SectionTitle({ num, children }) {
  return (
    <h3 className="order-receipt-section-title">
      <span className="order-receipt-section-num">{num}</span> {children}
    </h3>
  )
}

function ChargeBlock({ index, title, total, lines }) {
  return (
    <div className="order-receipt-charge">
      <div className="order-receipt-charge-head">
        <div className="order-receipt-charge-title">
          <span className="order-receipt-charge-num">Charge {String(index).padStart(2, '0')}</span>{' '}
          {title}
        </div>
        <div className="order-receipt-charge-total">{formatReceiptMoney(total)}</div>
      </div>
      {lines.map((line) => (
        <div key={line.label} className="order-receipt-charge-line">
          <span>{line.label}</span>
          <span>{formatReceiptMoney(line.amount)}</span>
        </div>
      ))}
    </div>
  )
}

function ProductRow({ product }) {
  const qtyLabel = String(product.quantity).padStart(2, '0')

  return (
    <article className="order-receipt-product">
      <div className="order-receipt-product-thumb">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" />
        ) : (
          <BottlePlaceholder />
        )}
      </div>
      <div>
        <p className="order-receipt-product-name">{product.name}</p>
        <p className="order-receipt-product-size">{product.size}</p>
        <span className="order-receipt-product-badge">{product.badge}</span>
      </div>
      <div className="order-receipt-product-pricing">
        <div className="order-receipt-product-qty">QTY · {qtyLabel}</div>
        <div className="order-receipt-product-price">{formatReceiptMoney(product.lineTotal)}</div>
      </div>
    </article>
  )
}

function ReceiptPageFooter({ page = 1, totalPages = 1 }) {
  return (
    <footer className="order-receipt-page-footer">
      <span>https://ordertracker.getbevvi.com/dashboard</span>
      <span>{page}/{totalPages}</span>
    </footer>
  )
}

function ReceiptDocument({ receipt, addressLines }) {
  return (
    <div className="order-receipt-document">
      <div className="order-receipt-page">
        <header className="order-receipt-header">
          <div className="order-receipt-brand-block">
            <div className="order-receipt-logo-mark">bevvi</div>
            <p className="order-receipt-logo-tag">ALCOHOL · MADE · EASY</p>
          </div>
          <div className="order-receipt-title-block">
            <h1>ORDER RECEIPT</h1>
            {receipt.issuedDate && <p>ISSUED · {receipt.issuedDate}</p>}
            {receipt.clientLocation && <p>{receipt.clientLocation}</p>}
            <p className="order-receipt-order-no">№ {receipt.orderNumber}</p>
            {receipt.sequence && (
              <p className="order-receipt-sequence">{receipt.sequence}</p>
            )}
          </div>
        </header>

        <hr className="order-receipt-rule-thick" />

        <div className="order-receipt-hero">
          <div>
            <h2 className="order-receipt-hero-title">
              Alcohol Made Easy<span className="order-receipt-hero-dot">.</span>
            </h2>
            <p className="order-receipt-hero-sub">
              Your order, seamlessly delivered — start to doorstep.
            </p>
          </div>
          <div className="order-receipt-payment-label">{receipt.paymentLabel}</div>
        </div>

        <hr className="order-receipt-rule-thin" />

        <div className="order-receipt-meta">
          <div>
            <div className="order-receipt-meta-label">ORDER DATE</div>
            <div className="order-receipt-meta-value">{receipt.orderDate}</div>
          </div>
          <div>
            <div className="order-receipt-meta-label">PLACED AT</div>
            <div className="order-receipt-meta-value">{receipt.placedAt}</div>
          </div>
          <div>
            <div className="order-receipt-meta-label">SERVICE</div>
            <div className="order-receipt-meta-value">{receipt.serviceType}</div>
          </div>
          <div>
            <div className="order-receipt-meta-label">REFERENCE</div>
            <div className="order-receipt-meta-value">{receipt.reference}</div>
          </div>
          {receipt.externalOrderNumber && (
            <div>
              <div className="order-receipt-meta-label">EXTERNAL ORDER / PO</div>
              <div className="order-receipt-meta-value">{receipt.externalOrderNumber}</div>
            </div>
          )}
        </div>

        <div className="order-receipt-body">
          <div className="order-receipt-left">
            <SectionTitle num="01">YOUR SELECTION</SectionTitle>
            {receipt.products.length > 0 ? (
              receipt.products.map((product, index) => (
                <ProductRow key={`${product.name}-${index}`} product={product} />
              ))
            ) : (
              <p className="order-receipt-empty-products">Product details loading…</p>
            )}

            <ChargeBlock
              index={1}
              title="STORE CHARGE"
              total={receipt.storeCharge.total}
              lines={receipt.storeCharge.lines}
            />
            <ChargeBlock
              index={2}
              title="BEVVI TAX & SERVICE"
              total={receipt.bevviCharge.total}
              lines={receipt.bevviCharge.lines}
            />
          </div>

          <div className="order-receipt-right">
            <SectionTitle num="02">DELIVERED TO</SectionTitle>
            <div className="order-receipt-address-box">
              <p className="order-receipt-address-name">{receipt.deliveredTo.name}</p>
              {receipt.deliveredTo.company && (
                <p className="order-receipt-address-company">{receipt.deliveredTo.company}</p>
              )}
              {addressLines.length > 0 ? (
                addressLines.map((line) => (
                  <p key={line} className="order-receipt-address-line">{line}</p>
                ))
              ) : receipt.deliveredTo.fallbackAddress ? (
                <p className="order-receipt-address-line">{receipt.deliveredTo.fallbackAddress}</p>
              ) : null}
              <p className="order-receipt-address-line">{receipt.deliveredTo.country}</p>
              {(receipt.deliveredTo.email || receipt.deliveredTo.phone) && (
                <>
                  <hr className="order-receipt-address-divider" />
                  {receipt.deliveredTo.email && (
                    <p className="order-receipt-contact-line">
                      EMAIL <span>{receipt.deliveredTo.email}</span>
                    </p>
                  )}
                  {receipt.deliveredTo.phone && (
                    <p className="order-receipt-contact-line">
                      TEL <span>{receipt.deliveredTo.phone}</span>
                    </p>
                  )}
                </>
              )}
            </div>

            {receipt.deliveryWindow && (
              <div className="order-receipt-delivery-window">
                <div className="order-receipt-delivery-window-label">DELIVERY WINDOW</div>
                <div className="order-receipt-delivery-window-value">{receipt.deliveryWindow}</div>
              </div>
            )}

            <div className="order-receipt-status-section">
              <SectionTitle num="03">ORDER STATUS</SectionTitle>
              <div className="order-receipt-status-row">
                {receipt.statusSteps.map((step) => (
                  <div
                    key={step.key}
                    className={`order-receipt-status-step${step.complete ? ' is-complete' : ''}`}
                  >
                    <div className="order-receipt-status-icon" aria-hidden="true">
                      {step.complete ? '✓' : ''}
                    </div>
                    <div className="order-receipt-status-label">{step.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="order-receipt-total-block">
              <div className="order-receipt-total-label">TOTAL PAID</div>
              <div className="order-receipt-total-row">
                <div className="order-receipt-total-note">{receipt.totalPaidNote}</div>
                <div className="order-receipt-total-amount">{formatReceiptMoney(receipt.totalPaid)}</div>
              </div>
            </div>
          </div>
        </div>

        <hr className="order-receipt-rule-thick order-receipt-legal-rule" />
        <div className="order-receipt-legal-grid">
          <div className="order-receipt-legal-left">
            <p>
              Made with <span className="order-receipt-legal-heart">♥</span> in NYC.
            </p>
            <p className="order-receipt-legal-upper">
              BEVVI · POWERING {receipt.footerClient}
            </p>
          </div>
          <div className="order-receipt-legal-center">
            <span className="order-receipt-legal-age">21+</span>
            <p>Please drink responsibly.</p>
          </div>
          <div className="order-receipt-legal-right">
            <p>Etail Inc · dba Bevvi</p>
            <p>getbevvi.com · 47 states</p>
          </div>
        </div>

        <ReceiptPageFooter />
      </div>
    </div>
  )
}

const OrderReceiptPreview = ({ order, orderDetails, className = '', variant = 'fit' }) => {
  const hostRef = useRef(null)
  const innerRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [hostHeight, setHostHeight] = useState(null)

  const receipt = useMemo(
    () => buildOrderReceiptModel(order, orderDetails),
    [order, orderDetails]
  )

  const updateScale = useCallback(() => {
    const host = hostRef.current
    const inner = innerRef.current
    if (!host || !inner) return

    const availableWidth = host.clientWidth
    if (availableWidth <= 0) return

    const nextScale = variant === 'full'
      ? 1
      : Math.min(1, availableWidth / RECEIPT_DOC_WIDTH)

    const contentHeight = inner.offsetHeight
    setScale(nextScale)
    setHostHeight(contentHeight * nextScale)
  }, [variant])

  useLayoutEffect(() => {
    updateScale()
  }, [updateScale, receipt])

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(() => updateScale())
    observer.observe(host)
    return () => observer.disconnect()
  }, [updateScale])

  const handlePrint = () => {
    const documentEl = innerRef.current?.querySelector('.order-receipt-document')
    printOrderReceipt(documentEl, receiptStyles)
  }

  if (!receipt) return null

  const addressLines = [
    receipt.deliveredTo.street,
    receipt.deliveredTo.apt,
    [receipt.deliveredTo.city, receipt.deliveredTo.state, receipt.deliveredTo.zip].filter(Boolean).join(', ')
  ].filter(Boolean)

  const showScale = variant !== 'full' && scale < 0.999

  return (
    <aside className={`order-receipt-preview ${className}`}>
      <div className="order-receipt-preview-toolbar">
        <h2>Receipt preview</h2>
        <button type="button" className="order-receipt-print-btn" onClick={handlePrint}>
          <Printer size={14} strokeWidth={2} aria-hidden />
          Print / Save PDF
        </button>
      </div>

      <div
        ref={hostRef}
        className="order-receipt-preview-host"
        style={hostHeight != null ? { height: `${hostHeight}px` } : undefined}
      >
        <div
          className="order-receipt-scale-wrap"
          style={{
            width: `${RECEIPT_DOC_WIDTH * scale}px`,
            height: hostHeight != null ? `${hostHeight}px` : undefined
          }}
        >
          <div
            ref={innerRef}
            className="order-receipt-scale-inner"
            style={{
              transform: showScale ? `scale(${scale})` : undefined,
              width: `${RECEIPT_DOC_WIDTH}px`
            }}
          >
            <ReceiptDocument receipt={receipt} addressLines={addressLines} />
          </div>
        </div>
      </div>
    </aside>
  )
}

export default OrderReceiptPreview
