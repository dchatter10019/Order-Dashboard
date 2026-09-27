# QA smoke tests (pre check-in)

Run automated smoke tests before every commit. Use the manual checklist before releases or large UI changes.

## One-time setup (git hook)

```bash
npm run setup:hooks
```

This points Git at `.githooks/pre-commit`, which runs `npm run smoke`. To skip once: `git commit --no-verify`.

## Commands

| Command | Scope |
|---------|--------|
| `npm run smoke` | Full suite (server + client) |
| `npm run smoke:server` | Backend libs, in-process auth HTTP, optional live API |
| `npm run smoke:client` | Vite build, routing, URL state, totals, AI helpers |

Optional live backend (must be running):

```bash
SMOKE_API_BASE_URL=http://localhost:3001 npm run smoke
```

## Automated — server (`npm run smoke:server`)

| # | Check | What it verifies |
|---|--------|------------------|
| S1 | Dashboard auth | Timing-safe credential check via `lib/dashboardAuth.cjs` |
| S2 | Order date range | `/api/orders` validation rules in `lib/orderDateRange.cjs` |
| S3 | Manual delivery fee | `lib/manualOrderDeliveryInference.cjs` |
| S4 | Bulk upload helpers | ZIP + US address parsing in `lib/manualOrderBulkSpreadsheet.cjs` |
| S5 | Auth HTTP | In-process Express: 400 / 401 / 200 on `/api/auth/login` |
| S6 | Server wiring | `server.js` uses shared auth + `/api/health` |
| S7–S9 | Live API (optional) | `/api/health`, `/api/products/status`, login rejection |

## Automated — client (`npm run smoke:client`)

| # | Check | What it verifies |
|---|--------|------------------|
| C1 | Production build | `vite build` succeeds |
| C2 | Login security | No demo creds; `/api/auth/login` |
| C3 | Tab routes | `dashboardRoutes.js` path ↔ tab mapping |
| C4 | Orders URL state | Filter query string parse/serialize |
| C5 | Order TOTAL | `orderTotals.js` component sum vs `total` field |
| C6 | AI intent | Aggregate vs per-customer revenue queries |
| C7 | App routes | Order detail + AI paths in `App.jsx` |
| C8 | Build output | `dist/index.html` bundle references |

## Manual browser checklist

Use after automated smoke passes, or before tagging a release.

| # | Area | Steps | Expected |
|---|------|--------|----------|
| M1 | Auth | Log in with env credentials | Dashboard loads; no demo creds on login screen |
| M2 | Tab URLs | Open `/orders`, `/products`, `/retailers`, `/ai-assistant` | Correct tab; refresh keeps same tab |
| M3 | Orders filters | Set dates, search, status; copy URL; open in new tab | Filters restored |
| M4 | Order detail | Open an order; Back | Returns to list with filters + scroll |
| M5 | TOTAL column | Compare list TOTAL vs order detail | Same grand total |
| M6 | Manual order | Open a `BEV-MAN-*` order with delivery in total | Delivery fee shown when inferred |
| M7 | AI | “What is my total revenue this month?” | Aggregate answer, not one retailer |
| M8 | GoPuff | Trigger validation error | Friendly message, no raw JSON panel |
| M9 | Retailers XLSX | Export spreadsheet | File downloads; no console module errors |
| M10 | SSE / footer | Wait on dashboard | Footer refresh copy; no error spam in console |

## CI

Push and pull requests run `npm run smoke` via `.github/workflows/smoke.yml` (no live API).

## Adding tests

1. **Server logic** → assertion in `scripts/smoke/server.mjs` (prefer `lib/*.cjs` modules).
2. **Client logic** → assertion in `scripts/smoke/client.mjs` (prefer `src/utils/*.js`).
3. Document new rows in the tables above.
4. UX-only behavior → **Manual browser checklist**.
