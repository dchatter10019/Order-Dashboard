# Bevvi Invoicing Rules

**Last Updated:** July 22, 2026

> **Runtime config:** The Order Dashboard server reads this file on startup and reloads it automatically when the file changes (no app redeploy needed). Edit the tables below, save, then refresh the dashboard or switch back to the browser tab.

---

## Overview

Bevvi charges a service fee (referred to as "Bevvi Fees") on each transaction. The fee is calculated per order based on a priority hierarchy: flat-fee retailers are evaluated first, followed by customer-level overrides, then retailer-based percentage rates, and finally a default rate for all others.

---

## Priority Order

Rules are applied in the following order. The first matching rule wins.

1. **Flat Fee Retailers** — specific retailers charged a fixed dollar amount per transaction
2. **Customer Overrides** — specific customers charged a fixed percentage regardless of retailer
3. **Retailer-Based Rates** — specific retailers charged a fixed percentage
4. **Default Rate** — all other transactions charged 20%

---

## 1. Flat Fee Retailers

These retailers are charged a fixed dollar amount per transaction, regardless of order value.

| Retailer | Fee Per Transaction | Effective Dates |
|---|---|---|
| Heritage Wine and Liquor | **$13.00** | January 2026 only |
| Heritage Wine and Liquor | **$21.00** | February 2026 onwards |
| Sundance Liquor & Gifts | **$40.00** | All dates |

> **Note:** For Heritage Wine and Liquor, the fee is determined by the transaction date. Orders placed in January 2026 are charged $13.00; orders from February 2026 onwards are charged $21.00.

---

## 2. Customer Overrides

These customers are always charged the specified rate, regardless of which retailer they order from. Customer overrides take precedence over all retailer-based rates (except flat fee retailers).

| Customer | Fee Rate | Notes |
|---|---|---|
| VistaJet / Vistajet Global | **8%** | Matches any customer name starting with "VistaJet" (case-insensitive) |
| OnGoody | **20%** | Overrides retailer rate |
| Reachdesk | **20%** | Overrides retailer rate |
| Sendoso | **12%** | — |
| Postal by Sendoso | **12%** | Treated the same as Sendoso |

---

## 3. Retailer-Based Rates

If no flat fee or customer override applies, the fee is determined by the retailer.

### 10% Retailers

| Retailer |
|---|
| Wine & Spirits Market |
| Freshco |
| National Liquor and Package |
| Mavy Clippership Wine & Spirits |
| LIQUOR MASTER |
| Sam's Liquor & Market |
| Dallas Fine Wine |
| Super Duper Liquor |
| Fountain Liquor & Spirits |
| Wine & Spirits Discount Warehouse |
| Youbooze |
| Garfields Beverage |
| ROYAL WINES & SPIRITS |

### 15% Retailers

| Retailer |
|---|
| Ashburn Wine Shop |
| Rezerve Wine & Spirits |
| Broudys Liquors |
| Aficionados |
| Andy's Liquors |

### Gopuff Stores — Date-Based Rate

All stores with names beginning with "Gopuff", "Go-Puff", or "Go Puff" follow a date-based rate:

| Date Range | Fee Rate |
|---|---|
| Up to March 31, 2026 | **15%** |
| April 1, 2026 onwards | **12.5%** |

### 25% Retailers

| Retailer |
|---|
| In Good Taste Wines |

---

## 4. Default Rate

All retailers not listed above are charged the default rate of **20%**.

---

## Order Status Filter

Only orders with the following statuses are included in reports and fee calculations:

| Included | Excluded |
|---|---|
| ✅ Accepted | ❌ Pending |
| ✅ Delivered | ❌ Rejected |
| ✅ In Transit | ❌ Canceled |

---

## Fee Calculation Formula

For percentage-based fees:

```
Bevvi Fee = Revenue × Fee Rate
```

For flat fees:

```
Bevvi Fee = Fixed Dollar Amount (e.g., $13, $21, $40)
```

> **Revenue** is defined as the order subtotal (excluding tax, tip, shipping, delivery fee, service fee, and service fee tax).

---

## Report Structure

Each retailer report contains two sections:

### Customer Summary

| Column | Description |
|---|---|
| Customer | Customer name |
| Transactions | Number of orders |
| Revenue | Total order revenue |
| Bevvi Fees | Total calculated fees |
| Fee Rate % | Applied fee rate (% or flat $) |
| Avg Transaction | Average revenue per order |
| Total Tip | Sum of all tips |
| Total Delivery Fee | Sum of all delivery fees |
| Date Range | First to last order date |

### Detailed Transactions

| Column | Description |
|---|---|
| Order Number | Unique order identifier |
| Date | Order date |
| Customer | Customer name |
| Revenue | Order subtotal |
| Bevvi Fees | Calculated fee for this order |
| Fee Rate % | Applied fee rate |
| Tax | Tax amount |
| Tip | Tip amount |
| Shipping Fee | Shipping charges |
| Delivery Fee | Delivery charges |
| Service Fee | Service charges |
| Service Fee Tax | Tax on service fee |
| Total Amount | Grand total |
| Payment ID | Stripe payment ID |
