# OTD Business Hub

Internal business portal for **On Time Deliveries (OTD)**, a logistics company operating in Bihar and Jharkhand. OTD provides last-mile and linehaul transportation services for clients including Shadowfax and Meesho/Valmo.

## Features

### Dashboard
Central hub with quick access to all modules and business overview.

### Invoice Manager
- Create GST-compliant invoices with auto-generated invoice numbers
- PDF generation with company letterhead and digital signature
- Invoice register with status tracking (Draft → Submitted → Paid)
- Client management with saved billing details

### MIS Module
- Import Shadowfax MIS Excel files (Regular and Adhoc formats)
- Auto-detect Excel format from column headers
- View imported trip data with filters
- Import history tracking
- *(Planned: Reconciliation against Trip Logger data)*

### Trip Logger
- Log daily trips with client, vehicle, route, and amount details
- Sticky form defaults (date/client/type remembered between entries)
- View, filter, edit, and delete trip records
- Summary statistics
- *(Planned: Smart dropdowns, vehicle-size mapping, client-filtered locations)*

## Tech Stack

- **Frontend**: React 19 + React Router 7 + Tailwind CSS 4
- **Build**: Vite 7
- **Backend**: Firebase (Firestore, Auth, Storage, Hosting)
- **Auth**: Google Sign-In with email whitelist
- **PDF**: @react-pdf/renderer + pdf-lib
- **Excel**: xlsx (SheetJS)

## Project Structure

```
├── app/
│   ├── src/
│   │   ├── components/       # Reusable UI components
│   │   │   ├── LoadingSpinner.jsx
│   │   │   ├── MISUploadModal.jsx
│   │   │   ├── OfflineBanner.jsx
│   │   │   ├── TripEditModal.jsx
│   │   │   └── TripForm.jsx
│   │   ├── contexts/
│   │   │   └── AuthContext.jsx
│   │   ├── lib/
│   │   │   ├── firebase.js        # Firebase config & initialization
│   │   │   ├── pdfGenerator.jsx   # Invoice PDF generation
│   │   │   ├── seed.js            # Client data seeding
│   │   │   └── sfxMisParser.js    # Shadowfax MIS Excel parser
│   │   ├── pages/
│   │   │   ├── CreateInvoicePage.jsx
│   │   │   ├── DashboardPage.jsx
│   │   │   ├── InvoiceRegisterPage.jsx
│   │   │   ├── LoginPage.jsx
│   │   │   ├── MISPage.jsx
│   │   │   └── TripsPage.jsx
│   │   ├── App.jsx
│   │   ├── index.css
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── eslint.config.js
├── firebase.json              # Firebase project config
├── firestore.rules            # Firestore security rules
├── storage.rules              # Storage security rules
├── firestore.indexes.json
├── cors.json
└── .firebaserc
```

## Setup

```bash
# Install dependencies
cd app && npm install

# Start dev server
npm run dev

# Deploy to Firebase Hosting
cd .. && npx firebase deploy
```

## Firebase Collections

| Collection | Purpose |
|------------|---------|
| `config` | App configuration (invoice counters, etc.) |
| `clients` | Client master data (name, GST, address) |
| `invoices` | Invoice records with line items |
| `mis_imports` | MIS file import history |
| `mis_trips` | Parsed trip data from MIS imports |
| `trips` | Trip Logger entries (OTD's ground truth) |

## Auth

Access is restricted to whitelisted Google accounts via Firestore security rules. The `isAllowed()` helper in `firestore.rules` checks the authenticated user's email against the whitelist.
