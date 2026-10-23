const {
  loadRetailerZohoContacts,
  getContactForRetailer,
  normalizeRetailerKey
} = require('./retailerZohoContacts.cjs')
const { aggregateRetailerInvoice } = require('./retailerInvoiceFees.cjs')
const zoho = require('./zohoBooksClient.cjs')

function formatInvoiceReference(startDate, endDate, retailerName) {
  const slug = String(retailerName || '')
    .replace(/[^\w]+/g, '-')
    .slice(0, 24)
  return `bevvi-${startDate}_${endDate}-${slug}`.slice(0, 100)
}

function buildLineDescription(startDate, endDate, summary) {
  const orders = summary.orderCount === 1 ? '1 order' : `${summary.orderCount} orders`
  return `Bevvi platform fees (${startDate} through ${endDate}, ${orders})`
}

function getInvoicePaymentSettings() {
  const notes =
    String(process.env.ZOHO_INVOICE_PAYMENT_NOTES || '').trim() ||
    'Payment by ACH or bank transfer only. Credit card payments are not accepted.'
  const terms =
    String(process.env.ZOHO_INVOICE_TERMS || '').trim() ||
    'Please remit via ACH. Contact accounts@getbevvi.com for banking details if needed.'
  const onlinePaymentLinkEnabled = process.env.ZOHO_INVOICE_ONLINE_PAYMENT_LINK === 'true'
  return { notes, terms, onlinePaymentLinkEnabled }
}

function buildEmailBody(startDate, endDate, summary, paymentSettings = getInvoicePaymentSettings()) {
  return [
    'Hello,',
    '',
    `Please find your invoice for Bevvi platform fees for orders from ${startDate} through ${endDate}.`,
    '',
    `Orders in period: ${summary.orderCount}`,
    `Total charges: $${summary.totalCharges.toFixed(2)}`,
    '',
    paymentSettings.notes,
    '',
    'Thank you,',
    'Bevvi'
  ].join('\n')
}

function buildRetailerInvoicePreview({
  retailerName,
  startDate,
  endDate,
  orders,
  invoicingEngine,
  billingEmail = null
}) {
  const summary = aggregateRetailerInvoice(orders, retailerName, startDate, endDate, invoicingEngine)
  const payment = getInvoicePaymentSettings()
  const reference = formatInvoiceReference(startDate, endDate, retailerName)
  const lineDescription = buildLineDescription(startDate, endDate, summary)
  const invoiceDate = endDate
  const emailSubject = `Bevvi invoice — ${retailerName} (${startDate} to ${endDate})`
  const emailBody = buildEmailBody(startDate, endDate, summary, payment)

  return {
    retailerName,
    billToEmail: billingEmail || null,
    fromOrg: 'Etail Inc / Bevvi',
    invoiceDate,
    referenceNumber: reference,
    lineItems: [
      {
        name: 'Bevvi platform fees',
        description: lineDescription,
        quantity: 1,
        rate: summary.totalCharges,
        amount: summary.totalCharges
      }
    ],
    summary,
    subtotal: summary.totalCharges,
    total: summary.totalCharges,
    currency: 'USD',
    notes: payment.notes,
    terms: payment.terms,
    email: {
      to: billingEmail || '(entered when you send)',
      subject: emailSubject,
      body: emailBody
    },
    payment: {
      acceptedMethods: 'ACH / bank transfer only',
      creditCardsAccepted: false,
      onlinePaymentLinkInEmail: payment.onlinePaymentLinkEnabled
        ? 'May appear if enabled in Zoho Invoice → Settings → Online Payments'
        : 'Not included — pay by ACH using instructions on the invoice (default for this dashboard).',
      zohoPayNowButton: payment.onlinePaymentLinkEnabled
        ? 'Configure Zoho to allow ACH only and disable card gateways'
        : 'Disabled via dashboard config (ZOHO_INVOICE_ONLINE_PAYMENT_LINK is not true)'
    }
  }
}

async function resolveZohoCustomerId(retailerName, contactEntry) {
  if (contactEntry?.zohoContactId) return contactEntry.zohoContactId
  const found = await zoho.findContactByName(retailerName)
  if (!found?.contact_id) {
    throw new Error(
      `No Zoho Books customer found for "${retailerName}". Create the customer in Zoho Books or save a zohoContactId for this retailer.`
    )
  }
  return found.contact_id
}

async function createAndEmailRetailerInvoice({
  orders,
  invoicingEngine,
  retailerName,
  startDate,
  endDate,
  sendEmail = true,
  dryRun = false,
  billingEmail = null
}) {
  const summary = aggregateRetailerInvoice(orders, retailerName, startDate, endDate, invoicingEngine)
  if (summary.orderCount === 0) {
    return { ok: false, skipped: true, reason: 'no_orders', retailerName, summary }
  }
  if (summary.totalCharges <= 0) {
    return { ok: false, skipped: true, reason: 'zero_amount', retailerName, summary }
  }

  const stored = getContactForRetailer(retailerName)
  const email = String(billingEmail || stored?.email || '').trim()
  if (!email) {
    return {
      ok: false,
      skipped: true,
      reason: 'no_email',
      retailerName,
      summary,
      message: `Billing email required for "${retailerName}"`
    }
  }
  const contactEntry = {
    retailerName: stored?.retailerName || retailerName,
    email,
    zohoContactId: stored?.zohoContactId || null
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      retailerName,
      email: contactEntry.email,
      summary
    }
  }

  const customerId = await resolveZohoCustomerId(retailerName, contactEntry)
  const invoiceDate = endDate
  const reference = formatInvoiceReference(startDate, endDate, retailerName)
  const lineDescription = buildLineDescription(startDate, endDate, summary)

  const paymentSettings = getInvoicePaymentSettings()
  const invoice = await zoho.createInvoiceForRetailer({
    customerId,
    invoiceDate,
    lineDescription,
    amount: summary.totalCharges,
    reference,
    notes: paymentSettings.notes,
    terms: paymentSettings.terms
  })

  let emailed = false
  if (sendEmail) {
    await zoho.emailInvoice(invoice.invoice_id, {
      toEmails: [contactEntry.email],
      subject: `Bevvi invoice — ${retailerName} (${startDate} to ${endDate})`,
      body: buildEmailBody(startDate, endDate, summary, paymentSettings)
    })
    emailed = true
  }

  return {
    ok: true,
    retailerName,
    email: contactEntry.email,
    summary,
    invoiceId: invoice.invoice_id,
    invoiceNumber: invoice.invoice_number,
    emailed
  }
}

function getPublicContactMap() {
  const store = loadRetailerZohoContacts()
  const map = {}
  for (const entry of store.byKey.values()) {
    const payload = {
      email: entry.email,
      hasZohoContactId: Boolean(entry.zohoContactId),
      retailerName: entry.retailerName
    }
    map[entry.retailerName] = payload
    map[normalizeRetailerKey(entry.retailerName)] = payload
  }
  return { count: store.count, missingFile: Boolean(store.missing), retailers: map }
}

module.exports = {
  createAndEmailRetailerInvoice,
  buildRetailerInvoicePreview,
  getInvoicePaymentSettings,
  getPublicContactMap,
  formatInvoiceReference
}
