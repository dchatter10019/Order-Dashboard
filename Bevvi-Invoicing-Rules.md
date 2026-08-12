# Bevvi Invoicing Rules

**Document purpose.** This document is the authoritative operating reference for calculating **Bevvi Fees** in retailer revenue reports. Apply the transaction-eligibility rules first, then select the applicable fee rule according to the precedence specified below. The rules reflect the currently implemented report logic as of **August 11, 2026**.

> **Core principle:** A transaction may receive only one Bevvi fee rule. Flat-fee retailer rules take precedence over every percentage rule. For all other retailers, an eligible customer override takes precedence over the retailer's percentage rate.

## 1. Transaction Eligibility

Only transactions whose status is **Accepted**, **Delivered**, or **In Transit** are included in a report. Status matching is case-insensitive after whitespace is removed.

| Status | Report treatment |
|---|---|
| Accepted | Include |
| Delivered | Include |
| In Transit | Include |
| Pending | Exclude |
| Rejected | Exclude |
| Canceled / Cancelled | Exclude |
| Any other, blank, or unrecognized status | Exclude |

Transactions with malformed source rows or values that cannot be parsed are also excluded rather than assigned a fee.

## 2. Fee Calculation Basis

For percentage-based rules, calculate the fee from the transaction's **Revenue** field. Round the result to two decimal places.

> **Percentage-fee formula:** `Bevvi Fees = round(Revenue × Applicable Fee Rate, 2)`

Flat-fee rules do not use the Revenue amount to determine the dollar fee. The displayed effective rate for a flat-fee transaction can vary because it is calculated as `flat fee ÷ Revenue` for analytical purposes, while the detailed transaction row displays the fixed dollar fee in the **Fee Rate %** column.

## 3. Rule Precedence

Apply the following decision sequence to every eligible transaction. Stop once a matching rule is found.

| Priority | Rule type | How it is applied |
|---:|---|---|
| 1 | Flat-fee retailer rules | Match the retailer first. A matching flat fee applies regardless of customer. |
| 2 | Customer-specific overrides | For non-flat retailers, apply the customer override when the customer condition is met. |
| 3 | Named retailer percentage rates | Apply the rate assigned to the retailer. |
| 4 | GoPuff date-based rate | Apply the GoPuff rate determined by the transaction date. |
| 5 | Default rate | Apply 20% when no preceding rule matches. |

## 4. Flat-Fee Retailer Rules

The following retailers are charged a fixed Bevvi fee per eligible transaction. These rules override every customer-specific percentage rule.

| Retailer | Transaction date condition | Bevvi fee per transaction |
|---|---|---:|
| Heritage Wine and Liquor | January 1–31, 2026 | $13.00 |
| Heritage Wine and Liquor | February 1, 2026 onward; any non-January-2026 date in the current implementation | $21.00 |
| Sundance Liquor & Gifts | All dates | $40.00 |
| Sopris Liquor & Wine | All dates | $37.50 |

## 5. Customer-Specific Overrides

Customer overrides are checked only when the retailer does **not** match a flat-fee rule. These overrides take precedence over the retailer percentage-rate rules and the 20% default.

| Customer condition | Fee rate | Implementation note |
|---|---:|---|
| Customer name begins with `VistaJet` or `Vistajet` (case-insensitive) | 8% | The match is a case-insensitive prefix match, so names such as `VistaJet` and `Vistajet Global` qualify. |
| VistaJet / Vistajet customer with an order number beginning `VJPRIVATE` | No VistaJet override | Do **not** apply 8%; continue to the retailer rate or default. Order-number matching is case-insensitive. |
| OnGoody | 20% | Overrides the retailer percentage rate. |
| Reachdesk | 20% | Overrides the retailer percentage rate. |
| Sendoso | 12% | Overrides the retailer percentage rate. |
| Postal by Sendoso | 12% | Overrides the retailer percentage rate. |

## 6. Retailer Percentage Rates

If no flat-fee rule or eligible customer override applies, determine the fee from the retailer name according to the following table.

| Fee rate | Retailers / matching rule |
|---:|---|
| 10% | Wine & Spirits Market; Freshco; National Liquor and Package; Mavy Clippership Wine & Spirits; LIQUOR MASTER; Sam's Liquor & Market; Dallas Fine Wine; Super Duper Liquor; Fountain Liquor & Spirits; Wine & Spirits Discount Warehouse; Youbooze; Garfields Beverage; ROYAL WINES & SPIRITS |
| 15% | Ashburn Wine Shop; Rezerve Wine & Spirits; Broudys Liquors; Aficionados; Andy's Liquors; Andy’s Liquors; Burien Liquor and Wine |
| 25% | In Good Taste Wines |
| 20% | Every other retailer that does not qualify for a prior rule |

## 7. GoPuff Date-Based Rate

For a retailer whose name begins with **gopuff**, **go-puff**, or **go puff**, use the following transaction-date rule. Prefix matching is case-insensitive.

| Transaction date | Fee rate |
|---|---:|
| Through March 31, 2026 | 15% |
| April 1, 2026 onward | 12.5% |

If a GoPuff transaction date cannot be interpreted by the current report implementation, it defaults to the newer **12.5%** rate.

## 8. Reporting Output Requirements

The workbook includes an **Executive Summary** and an individual worksheet for each included retailer. Each retailer worksheet contains a customer-level summary followed by detailed eligible transactions. The workbook format follows the Base Liquor template.

| Report section | Required content |
|---|---|
| Executive Summary | Retailer Name, Subtotal, Service Fees, and Total, plus a grand-total row |
| Customer Summary | Customer, Transactions, Revenue, Bevvi Fees, Fee Rate %, Avg Transaction, Total Tip, Total Delivery Fee, and Date Range |
| Detailed Transactions | Order Number, Date, Customer, Revenue, Bevvi Fees, Fee Rate %, Tax, Tip, Shipping Fee, Delivery Fee, Service Fee, Service Fee Tax, Total Amount, and Payment ID |
| Styling | Blue header fill `#4472C4` with white bold text; yellow total-row fill `#FFFF00` with black bold text |

## 9. Worked Decision Examples

| Scenario | Applicable rule | Result |
|---|---|---|
| A $200 January 2026 Heritage Wine and Liquor transaction for OnGoody | Heritage flat fee takes precedence | $13.00 Bevvi fee |
| A $200 February 2026 Heritage Wine and Liquor transaction for VistaJet | Heritage flat fee takes precedence | $21.00 Bevvi fee |
| A $200 Fountain Liquor & Spirits transaction for OnGoody | OnGoody override takes precedence over the retailer's 10% rate | $40.00 Bevvi fee |
| A $200 GoPuff transaction dated March 31, 2026 | GoPuff pre-cutover rate | $30.00 Bevvi fee |
| A $200 GoPuff transaction dated April 1, 2026 | GoPuff post-cutover rate | $25.00 Bevvi fee |
| A $200 10%-retailer transaction for a customer beginning Vistajet | VistaJet override takes precedence | $16.00 Bevvi fee |
| A $200 10%-retailer transaction for a Vistajet customer with order `VJPRIVATE-100` | VistaJet override is intentionally bypassed | $20.00 Bevvi fee |
| A $200 Sopris Liquor & Wine transaction | Sopris flat fee | $37.50 Bevvi fee |

## 10. Implementation Notes

Retailer-name rules are exact-name matches unless this document explicitly calls out a prefix match. The current implementation recognizes both the straight-apostrophe and curly-apostrophe variants of Andy's Liquors. Customer-name matching is case-insensitive only for the VistaJet / Vistajet prefix override; the other listed customer overrides are evaluated against their specified customer names.

The status filter is deliberately allow-list based. Therefore, the addition of a new source-system status will not include transactions automatically; the status must be explicitly added to the allowed list before it can appear in invoices.

## References

[1]: ./data_processor.py "Current Bevvi fee calculation and report-generation implementation"
[2]: ./process_helper.py "Current Bevvi transaction parsing and status-filter implementation"
