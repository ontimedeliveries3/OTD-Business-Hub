# OTD Business Hub

## Modules
1. **Invoice Generator** ← MVP (Shadowfax + Meesho only)
2. Payment Tracker
3. MIS Reconciliation
4. Bid Manager
5. Credit Note Manager
6. Lane/Route Allocation Tracker
7. KM Reconciliation & Dispute Tracker (Valmo)
8. Monthly Trip Count Submission
9. Penalty & Deduction Tracker
10. Contract & Compliance Vault

---

## Architecture

### Tech Stack
- **Frontend**: React + Tailwind CSS v4 (SPA), Vite build
- **Database**: Cloud Firestore (NoSQL)
- **Auth**: Firebase Auth (Google Sign-in only)
- **File Storage**: Firebase Storage (PDFs, signature image)
- **PDF Generation**: @react-pdf/renderer (client-side, React components with flexbox layout)
- **Hosting**: Firebase Hosting
- **Plan**: Blaze (pay-as-you-go)

### Users (MVP)
- `ontimedeliveries3@gmail.com` — admin (create/edit invoices, manage clients)
- `mohitsingh87@gmail.com` — super admin (all above + delete invoices + modify config)

### Firestore Collections
- `clients/` — Shadowfax + Meesho (with per-client config: client_id_label, quantity_label, customer_section_style, etc.)
- `invoices/` — all invoices (drafts + generated). Line items support optional `source` and `mis_ref` fields for future MIS reconciliation.
- `config/company_info` — OTD company details (verified from Excel templates)
- `config/counters` — fiscal year + last invoice sequence

### Firestore Indexes
- Composite index on `invoices`: `fiscal_year` (ASC) + `created_at` (DESC) — required for dashboard query

> **Deferred**: `routes/` collection (saved routes per client) — for MVP, routes are typed as free text in line item Particulars.

---

## Step-by-Step Build Plan

### Step 1: Project Setup ✅
- React + Vite + Tailwind CSS v4 app in `app/` directory
- Firebase SDK + pdf-lib + @react-pdf/renderer installed
- Firebase project `otd-business-hub`, Blaze plan, `asia-south1`
- `firebase.json`, `.firebaserc`, hosting configured with SPA rewrites
- Deployed to https://otd-business-hub.web.app/

### Step 2: Authentication ✅
- Google Sign-in flow via popup
- Email whitelist check (2 emails) in `AuthContext.jsx`
- Redirect to dashboard if allowed, "Access denied" + sign out if not
- Auth context/provider with `isSuperAdmin` flag
- `localhost` added as authorized domain for local development

### Step 3: Database Setup & Seed Data ✅
- Firestore security rules deployed (invoice delete = super admin only)
- Storage security rules deployed (invoices/ and assets/ paths)
- Auto-seed on first dashboard load via `seed.js` (idempotent)
- Company info, counters, Shadowfax & Meesho clients all seeded
- Current counter state: `last_seq` is at 70 (next invoice = RS/071/25-26)

### Step 4: Dashboard ✅
- Summary cards: Total invoices this FY, Total revenue, Last invoice number
- "Create New Invoice" button
- Recent invoices list (last 10)
- Click draft → opens edit form; click generated → opens PDF in new tab

### Step 5: Create Invoice Page ✅
- **Form fields**:
  - Invoice Number — "Auto-assigned on generation" placeholder (read-only)
  - Invoice Date — date picker, defaults to today
  - Client dropdown — auto-fills tax rate, GSTIN, address, client ID, quantity label, place of supply
  - Billing Period — month/year picker
  - Place of Supply — auto-filled from client's state (editable)
  - Line items — dynamic table:
    - Particulars (free text)
    - HSN/SAC (pre-filled from client default, editable)
    - Quantity (column header adapts: "No. of Trips" or "KMS" per client)
    - Rate
    - Amount (auto-calculated: qty x rate, or manual entry for lump sums)
    - Add/Remove row buttons
  - Sub Total (auto-calculated)
  - IGST @ X% (auto-calculated from client tax_rate)
  - Grand Total (auto-calculated)
- **Actions**:
  - **Save as Draft** — saves to Firestore, no invoice number, no PDF
  - **Generate & Download** — allocates invoice number (atomic Firestore transaction), generates PDF, uploads to Storage, downloads locally
- Edit draft support via `/invoice/:id/edit` route

### Step 6: PDF Generation ✅
- Migrated from pdf-lib to **@react-pdf/renderer** (React components with flexbox layout)
- PDF defined in `app/src/lib/pdfGenerator.jsx`
- **Layout**:
  - TAX-INVOICE header bar (gray background)
  - ONTIME DELIVERIES company banner with address, contact, GSTIN/PAN
  - Two-column customer/meta section with vertical divider
    - Left: Customer info (adapts per `customer_section_style`)
    - Right: Invoice No, Date, Vendor Code/Oracle ID, Period (spread with space-between)
  - Line items table with full grid borders, flex-stretches to fill page
  - Totals section: Sub Total, IGST, RCM status + Grand Total
  - Footer: Bank details (left, aligned with colon column) | Signature area (right)
- Upload generated PDF to Firebase Storage
- Save `pdf_url` to invoice document in Firestore

### Step 7: Invoice Register Page ✅
- Separate page at `/invoices` route (`InvoiceRegisterPage.jsx`)
- Fetches ALL invoices from Firestore (no server-side filtering)
- Client-side filtering with dropdowns:
  - **Search** — type-ahead search on invoice number or line item particulars
  - **Client** — dynamic dropdown (auto-populated from data)
  - **Status** — dropdown (Draft / Generated / All)
  - **Financial Year** — dropdown (24-25 / 25-26 / 26-27 / All), defaults to current FY
- Table columns: Invoice Number, Date, Client, Period, Sub Total, GST, Grand Total, Status
- Totals footer row (sums generated invoices in filtered view)
- Click draft → edit form; click generated → open PDF
- Dashboard "Recent Invoices" section links to this page via "View All →"
- **Export to Excel** button (xlsx library) — exports filtered results with proper column widths

### Step 7b: Bulk Import Old Invoices ⬜ (DEFERRED)
- Need to import RS/001 through RS/057 (pre-app invoices)
- Options: bulk import script from CSV/JSON, or manual entry via Firestore Console
- Old invoice PDFs can be uploaded to Storage and linked
- Waiting on old invoice data files

### Step 8: Client Management Page ⬜ (DEFERRED)
- List clients with key details
- Add/edit client form (all per-client config fields)
- Admin-only access
- Deferred — only 2 clients (Shadowfax + Meesho), already seeded. Will build when a 3rd client is onboarded.

### Step 9: Polish & Deploy ✅
- **HTML title** fixed: "OTD Business Hub" + meta description + theme color
- **Loading states**: Reusable `LoadingSpinner` component with animated spinner (auth, dashboard, drafts)
- **Error handling**: Dashboard shows error with Retry button; error states on all pages
- **Offline indicator**: `OfflineBanner` component — fixed amber bar when connection lost
- **Mobile responsiveness**:
  - Larger touch targets (py-2.5, py-3 on buttons)
  - `active:` states for tap feedback
  - Date column hidden on small screens (dashboard)
  - HSN/SAC column hidden on mobile (invoice form)
  - Responsive text sizes and padding
- **Signature image**: Upload from Create Invoice page → Firebase Storage (`assets/signature.png`) → URL saved to `config/company_info` → embedded in PDF between header/footer
- **Deployed** to https://otd-business-hub.web.app/

---

## Key Design Decisions
- Invoice numbers allocated at generation time only (not on form load)
- Drafts have no invoice number — assigned only on "Generate & Download"
- IGST only for MVP (no CGST+SGST split — deferred to post-MVP)
- No amount in words
- Flexible line items (trips, KMS, or lump sums — all via same schema)
- Per-client PDF formatting (customer section style, quantity label, ID label)
- Signature image on all invoices
- `routes/` collection deferred — free text in Particulars for MVP
- `source` and `mis_ref` fields reserved on line items for future MIS Reconciliation integration
- Meesho Transporter Panel (going live ~March 10) does not affect invoice format — only changes submission method
- Shadowfax workflow unchanged (email-based with KM readings + provision values)
- Invoice Register uses client-side filtering (fetch all, filter in React) — avoids needing multiple Firestore composite indexes
