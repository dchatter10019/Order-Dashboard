# Playwright regression cases (from QA checklist)

Automated mapping of manual QA IDs to Playwright specs under `e2e/regression/`.  
Each case runs on **desktop-chrome** and **mobile-chrome** unless marked skipped.

| ID | Spec file | Playwright test name |
|----|-----------|----------------------|
| A1–A3, Auth | `auth.spec.mjs` | A1, A2, A3, protected routes, log out |
| R1–R5 | `routing.spec.mjs` | Deep links, unknown route, all tabs, detail URL, AI URL |
| O1–O7, D5 | `orders.spec.mjs` | Search, empty search, status URL, fetch, delayed, 31-day guard, deep-link |
| D1–D4, O5, D6–D7 | `order-detail.spec.mjs` | Detail open, round-trips (skip if no rows); D6/D7/O5 skipped |
| AI1, AI3, AI5 | `ai-assistant.spec.mjs` | Revenue query, chip, no ReferenceError |
| AI2, AI4, AI6 | `ai-assistant.spec.mjs` | Skipped (covered elsewhere or manual) |
| G1 | `gopuff.spec.mjs` | JUNK-123 friendly error |
| G2 | `gopuff.spec.mjs` | Skipped (live submit) |
| P1–P3 | `products.spec.mjs` | Search gating and wine search |
| N1, N3 | `notifications.spec.mjs` | SSE stream, footer auto-refresh |
| N2, N4–N8 | `notifications.spec.mjs` | Skipped (manual / flaky) |
| X2, X3 | `misc.spec.mjs` | Footer copy, tab console sweep |
| X1 | `misc.spec.mjs` | Skipped (export) |

Run: `npm run test:e2e`  
Debug one ID: `npm run test:e2e -- --grep "O1"`

Source checklist: `bevvi-dashboard-test-cases.md` (QA export).
