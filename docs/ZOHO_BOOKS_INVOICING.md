# Zoho Books invoicing (Retailers tab)

The dashboard creates **Zoho Books invoices** from the **Retailers** tab and **emails** each retailer.

Uses the **Zoho Books REST API** on the Node server (not Zoho MCP, which is IDE-only).

## Setup

The Retailers tab reads **server `.env`**. Zoho MCP in Cursor is separate and does **not** enable invoicing in the app.

1. In [Zoho API Console](https://api-console.zoho.com/), create a **Server-based Application**.
   - **Homepage URL:** `https://dashboard.getbevvi.com`
   - **Authorized redirect URI:** `https://dashboard.getbevvi.com/` (must match exactly in the OAuth URL and token exchange; used once to obtain a refresh token — the app does not need a special callback route; copy `code=` from the address bar after redirect)
2. Add scopes for invoicing, e.g. `ZohoInvoice.invoices.CREATE`, `ZohoInvoice.invoices.READ`, `ZohoInvoice.contacts.READ` (or the equivalent **Zoho Books** scopes if you use Books).
3. Generate a **refresh token** (Self Client or browser OAuth) while logged into **Etail Inc** org (`ZOHO_BOOKS_ORG_ID=937633761`).
4. On the **production server** that runs `dashboard.getbevvi.com`, add to `.env` and restart `node server.js` (or your process manager):

```env
ZOHO_ACCOUNTS_URL=https://accounts.zoho.com
# Zoho Invoice org (Etail Inc). Use .../books/v3 if you use Zoho Books instead.
ZOHO_BOOKS_API_BASE=https://www.zohoapis.com/invoice/v3
ZOHO_BOOKS_ORG_ID=937633761
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
ZOHO_REFRESH_TOKEN=...
```

Refresh token help: [Zoho OAuth](https://www.zoho.com/accounts/protocol/oauth/web-server/access-token.html) — exchange an authorization code once, then the server refreshes access tokens automatically.

## Local laptop first

Use the **same** Zoho client; add a **second** redirect URI in the API Console (you can have several):

| Field | Local value |
|--------|-------------|
| Redirect URI | `http://localhost:3001/` |

1. Put **Client ID** and **Client Secret** in the project `.env` on your laptop (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`).
2. Open (replace `YOUR_CLIENT_ID`):

   `http://accounts.zoho.com/oauth/v2/auth?scope=ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.READ,ZohoInvoice.contacts.READ&client_id=YOUR_CLIENT_ID&response_type=code&access_type=offline&redirect_uri=http://localhost:3001/&prompt=consent`

3. After login, the browser goes to `http://localhost:3001/?code=...` — copy the `code` query param (start the backend first with `npm run server` so the page loads, or copy from the address bar even if it errors).
4. Exchange the code (run in Terminal):

   ```bash
   curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
     -d "code=PASTE_CODE" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "redirect_uri=http://localhost:3001/" \
     -d "grant_type=authorization_code"
   ```

5. Add `ZOHO_REFRESH_TOKEN=...` from the JSON response to `.env`.
6. Restart: `npm run server`. Dev UI: `npm run dev` → http://localhost:3000 → **Retailers**.
7. Confirm: http://localhost:3001/api/zoho/books/status → `"configured": true`.

The same refresh token can later be copied to production `.env` on the dashboard server.

## Billing emails

You do **not** need to edit a JSON file by hand.

- The first time you **Charge Fees** or run **Invoice all retailers**, the app **prompts** for that retailer’s billing email.
- The server saves it to `data/retailer-zoho-contacts.json` (gitignored) and **reuses** it on later invoices.
- The **Invoice email** column shows the saved address, or “Prompt on invoice” if none is stored yet.

Optionally you can pre-seed contacts via `POST /api/retailers/zoho-contacts` or copy `data/retailer-zoho-contacts.example.json` to `data/retailer-zoho-contacts.json`.

## Usage

1. Open **Retailers**, pick a date range, and **Fetch Orders**.
2. **Charge Fees** — confirm amount and email; creates invoice and sends email.
3. **Invoice all retailers** — prompts for any missing emails, then invoices each row with charges.

Invoice line: **Bevvi platform fees** for the period **Total Charges** (service + retailer fee per invoicing rules).

**Preview invoice** on each retailer row shows the PDF-style layout and the email body before you charge.

### Payments (ACH only)

By default the dashboard does **not** expect a Zoho card **Pay Now** link. Invoices include **notes/terms** stating ACH/bank transfer only (`ZOHO_INVOICE_PAYMENT_NOTES`, `ZOHO_INVOICE_TERMS` in `.env`).

In **Zoho Invoice → Settings → Online Payments**, disable credit card gateways if you only accept ACH; enable ACH/wire there if you want Zoho-hosted bank payment. Set `ZOHO_INVOICE_ONLINE_PAYMENT_LINK=true` only if you intentionally use Zoho online payment links.

## API

- `GET /api/zoho/books/status`
- `GET /api/retailers/zoho-contacts` — saved retailer → email map
- `POST /api/retailers/zoho-contacts` — `{ retailerName, email }` (persist for next time)
- `POST /api/retailers/zoho-invoices` — `{ startDate, endDate, retailerNames?, billingEmails?, orders? }`
