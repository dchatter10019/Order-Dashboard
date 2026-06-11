/**
 * Print receipt in an isolated iframe at full size (no preview transform).
 * Avoids squished/clipped PDF output from printing the scaled preview pane.
 */
export function printOrderReceipt(documentElement, styles = '') {
  if (!documentElement) return

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0'
  })
  document.body.appendChild(iframe)

  const win = iframe.contentWindow
  const doc = win.document
  const fontLink =
    'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Inter:wght@400;500;600;700&display=swap'

  doc.open()
  doc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Order Receipt</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="${fontLink}" rel="stylesheet" />
  <style>
    html, body.receipt-print-root {
      margin: 0;
      padding: 0;
      background: #fff;
    }
    ${styles}
  </style>
</head>
<body class="receipt-print-root">
  ${documentElement.outerHTML}
</body>
</html>`)
  doc.close()

  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
  }

  const doPrint = () => {
    const page = doc.querySelector('.order-receipt-page')
    const body = doc.body

    if (page && body) {
      // Letter printable height ≈ 10in at 96dpi after margins; zoom prints more reliably than transform.
      const printableHeightPx = 960
      const contentHeight = page.offsetHeight
      if (contentHeight > printableHeightPx) {
        const zoom = Math.max(0.78, printableHeightPx / contentHeight)
        body.style.zoom = String(zoom)
      }
    }

    win.focus()
    win.addEventListener('afterprint', cleanup, { once: true })
    win.print()
    window.setTimeout(cleanup, 8000)
  }

  if (doc.readyState === 'complete') {
    window.requestAnimationFrame(doPrint)
  } else {
    iframe.onload = () => window.requestAnimationFrame(doPrint)
  }
}
