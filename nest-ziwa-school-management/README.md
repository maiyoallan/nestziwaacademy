# Nest Ziwa School Management System

A fresh full-stack foundation for Nest Ziwa Schools (Primary + Secondary), motto: **Virtues are Success.**

## Included in this first build

- React + Vite frontend with responsive dashboard, login screen, module navigation and a reusable records workspace.
- Node.js + Express API with JWT authentication, password hashing, role-based access control, validation, audit logging and health endpoint.
- PostgreSQL + Prisma schema covering users, students, guardians, staff, classes, subjects, enrolments, attendance, fee structures, invoices, payments, expenses, assessments, results, inventory, suppliers, purchases, transport, announcements and audit logs.
- Seed script creates the first system administrator.
- Docker Compose for local PostgreSQL.
- Starter modules for admissions, students, academics, attendance, finance, HR, inventory, transport, communication and reports.
- Student intake supports the school class list, uppercase names, admission number suggestions, DOB picker, bulk Excel import and a workbook template with example and instructions.
- Student profiles support photos, linked student logins, access-limited student portals, exam result summaries and printable reports. The application stores these records in the configured PostgreSQL database.
- Settings provide database-backed logo/signature assets and staff account tools. Newsletter Studio supports editable layouts, saved drafts, download/print and email delivery when SMTP is configured.
- Exam records can be assigned to a class and teacher with a ranking method; class mark lists can be downloaded as Excel workbooks.
- Student photos can be uploaded in bulk when image filenames match the learner's admission number (or full name); images are resized and stored with the student record.
- The school theme starts with green and sky blue; administrators can adjust both colors in System Settings. Report Card Studio builds editable cards from examination results, saves designs in PostgreSQL, and supports print/PDF, HTML download, and email when SMTP is configured.

This is a runnable development foundation, not a claim that every school workflow, statutory report, payment provider, SMS gateway or offline-sync feature is already production-ready. Those integrations require configuration, school policy decisions and end-to-end testing.

## Additive finance, exports, and staff tools

- **Accounting:** Double-entry journals power the trial balance, balance sheet, income and expenditure summary, main and petty cashbooks, bank reconciliation, and budget variance view. New fee invoices post to receivables, payments post to cash/bank, and expenses post after they are marked paid. Existing fee, payment, and expense records can be posted once from Accounting. Posted transactions are corrected with reversals; locked periods reject new entries.
- **Bank reconciliation:** Import CSV/Excel files or configure a signed webhook. References can match an admission number. Duplicate, unmatched, and likely overpayment rows stay in review and notify the Bursar. A reviewed matched receipt posted to receivables is also recorded as a learner payment. Webhook rows are never posted automatically.
- **Exports and records:** Filtered student and fee lists and accounting reports can be downloaded as Excel, Word, or HTML, or printed/saved as PDF. The reusable searchable student selector shows names, admission numbers, class and available photos. Student IDs can be previewed and printed individually or in batches.
- **School artwork:** Settings stores the shared logo, transparent signature, and transparent stamp in PostgreSQL. Signature/stamp cleanup runs in the browser and can be adjusted by uploading a clearer scan if the threshold removes too much handwriting.
- **Assistant and documents:** The staff assistant is read-only and uses role-scoped data. It falls back to guided help and a notes-based document draft if a local Ollama model is unavailable. Newsletter Studio remains usable without SMTP; sending requires an authorized mail configuration.
- **Director tools:** Director role access includes school registry/linking, consolidated ledgers for schools in this database, and the director-only audit view. Remote school synchronization needs a separate authenticated API connection and is not implied by registry linking.
- **Alerts:** Role-targeted notifications surface bank conflicts and finance items requiring attention.

### Optional integrations

Set `OLLAMA_URL` and `OLLAMA_MODEL` in `server/.env` to use a local Ollama model. Without it, the assistant and document generator use their safe built-in fallbacks. Set `BANK_WEBHOOK_SECRET` to enable `POST /api/webhooks/bank`; send the same value in the `x-bank-webhook-secret` header and provide `schoolCode` plus `transactions` with `reference`, `amount`, and optional `admissionNumber`, `externalId`, `method`, and ISO `transactionDate`. Keep this endpoint behind HTTPS and share the secret only with the approved payment provider. Bank imports remain available without a webhook secret.

## Requirements

- Node.js 20+
- npm 10+
- Docker Desktop (recommended for PostgreSQL) or an existing PostgreSQL 15+ server

## 1. Start PostgreSQL

From the project root:

```bash
docker compose up -d db
```

## 2. Configure the API

```bash
cd server
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run seed
npm run dev
```

The API runs at `http://localhost:5000`.

Default seed admin:
- Email: `admin@nestziwa.ac.ke`
- Password: `ChangeMe123!`

**Change this password immediately after the first login.** Set a unique `JWT_SECRET` in `server/.env` before using the system beyond local development.

## 3. Start the frontend

In a second terminal:

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173` (or the alternate port Vite prints if 5173 is already in use).

### Local data and email

The checked-out development instance uses PostgreSQL on port `5433` and stores its database files in `server/.data/`. This local data directory is ignored by Git. For another machine, use Docker Compose or a PostgreSQL server and set `DATABASE_URL` to that server.

Newsletter email requires `SMTP_URL` and `MAIL_FROM` in `server/.env`. Configure these with the school's approved mail provider before sending; drafts can be created and downloaded without SMTP. Student Excel import uses SheetJS in the browser and accepts the template's `Students` worksheet.

## 4. First deployment checklist

1. Use a managed PostgreSQL database with encrypted backups.
2. Set strong unique secrets and HTTPS.
3. Configure a production frontend/API origin and CORS allowlist.
4. Disable or replace the development seed credentials.
5. Set up SMTP/SMS providers only after obtaining authorized credentials.
6. Integrate M-Pesa using Daraja credentials, signed/verified callbacks, idempotency and reconciliation; never put provider secrets in the browser.
7. Review Kenya Data Protection Act obligations, retention rules, parental consent and access to children's records.
8. Test restore procedures, permissions, financial reconciliation and audit trails.
9. For local-network operation, deploy the API and database on a secured school server and make the frontend available on the LAN. Reliable online + LAN operation with offline data entry needs a separately designed synchronization layer; it is not silently assumed here.

## Main folders

- `client/` React user interface
- `server/` Express API and Prisma database
- `docker-compose.yml` local PostgreSQL
- `docs/` implementation roadmap and role/module matrix

## API overview

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/health`
- `GET /api/records/:module`
- `POST /api/records/:module`
- `PATCH /api/records/:module/:id`
- `DELETE /api/records/:module/:id`

Supported record modules are defined in `server/src/config/modules.js`. Each request is authenticated and checked against the role permissions configured there. The generic records engine stores module-specific fields as JSON while keeping ownership, creator, timestamps and audit history in relational columns. Core relational school entities are present in the Prisma schema and can be promoted into dedicated typed workflows as each phase is completed.


## Payments, in-kind contributions, and receipts

The Finance module now supports staged student payments through M-Pesa Paybill, Airtel Money, cheque, bank transfer, cash, in-kind, and explained custom methods. New entries remain pending until an authorized finance user confirms the reference and amount; in-kind entries also require a delivery reference and physically received quantity. Duplicate channel references and reused idempotency keys are rejected or sent to Administration follow-up. Verified entries post once to the double-entry ledger; accounting reversals update the student payment status and retain audit records.

In-kind items are limited to maize, beans, millet, and ream paper. Quantity units are kg or sack for grains and ream or box for paper. Staff may set a per-unit valuation when recording an expected contribution or delivery. Valuation is optional; without it, quantities still appear in stock and student/class balances but do not create a monetary fee credit. Item balances can be downloaded to Excel. These fields live in Finance and student/class fee views, not Learning.

Receipts can be printed on A4 or 58 mm / 80 mm thermal paper. They include the school logo, current fee and transport balances, verified payment history, and in-kind balances. System Settings stores the official WhatsApp number and class invite links; Finance can export linked guardian contacts and open WhatsApp share links. Staff still attach the saved receipt manually. Provider callbacks (including Daraja) and automated WhatsApp document/group messaging are not configured by this feature; verify payment against the bank/mobile statement before posting.

### Payment prompts, parent hub, transport, and salary runs

- The Parent role has a child hub that links student records through the guardian email matching the signed-in account. It shows balances, recorded in-kind pledges, exam records, and parent payment prompts. Student access remains restricted to the student's own linked record.
- Finance and parents can request M-Pesa or Airtel payment prompts. The default `mock_sandbox` adapter is a simulation: it does not contact a payment provider or move money. A sandbox confirmation is available only outside production, and confirmed sandbox receipts are visibly marked as simulated. Live M-Pesa, Airtel, bank, and cheque provider drivers remain adapter stubs until the school supplies and configures provider credentials and callback verification.
- Configure `PAYMENT_GATEWAY_DRIVER=mock_sandbox` for local development. For a real provider adapter, also configure `PAYMENT_GATEWAY_WEBHOOK_SECRET`; callbacks use `POST /api/payment-gateway/callbacks/:provider` with an `x-gateway-signature` HMAC over the JSON request body. Provider-specific callback mapping and reconciliation still need to be completed before live use.
- Transport staff can create named routes, vehicles, classes, and student assignments. Active assigned fares appear in student balances, parent and staff hubs, and financial statements when no separate transport invoice exists.
- Directors can prepare single or batch salary installments. Runs stay pending until provider confirmation; the sandbox confirmation records a simulated payout and balanced salary/bank journal, but transfers no funds. Live salary disbursement providers are not configured.

## Important

Do not load real pupil or financial data until the school has approved the deployment, access model, backups, privacy notice, data retention policy and operational procedures.
