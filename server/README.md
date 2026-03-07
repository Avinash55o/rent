# Tenant Rent System — Backend

A Hono-based backend for managing tenant rent, invoices, and payments with Razorpay and WhatsApp notifications.

## Stack

- **Framework**: [Hono](https://hono.dev) on Node.js
- **Database**: PostgreSQL via [Drizzle ORM](https://orm.drizzle.team)
- **Auth**: JWT + Google OAuth
- **Payments**: Razorpay
- **Notifications**: WhatsApp (Meta Cloud API)
- **Scheduler**: node-cron (reminder worker)

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in all values in .env
```

### 3. Run DB migrations

```bash
npm run db:generate
npm run db:migrate
```

### 4. Start the server

```bash
npm run dev
```

### 5. Start the reminder worker (separate process)

```bash
npm run worker:reminders
```

---

## API Reference

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | – | Register with email/password |
| POST | `/auth/login` | – | Login with email/password |
| GET | `/auth/google` | – | Start Google OAuth flow |
| GET | `/auth/google/callback` | – | Google OAuth callback |
| GET | `/auth/me` | Bearer | Get current user |

### Tenants *(admin-only unless noted)*

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/tenants` | Admin | List all tenants |
| GET | `/tenants/:id` | Bearer | Get tenant (own profile for tenants) |
| POST | `/tenants` | Admin | Create a tenant + user |
| PATCH | `/tenants/:id` | Admin | Update tenant profile |
| DELETE | `/tenants/:id` | Admin | Soft-deactivate tenant |
| GET | `/tenants/:id/invoices` | Bearer | Get tenant invoices |
| GET | `/tenants/:id/payments` | Bearer | Get tenant payments |

### Invoices

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/invoices` | Admin | List invoices (filterable) |
| GET | `/invoices/:id` | Bearer | Get invoice |
| POST | `/invoices` | Admin | Create invoice |
| PATCH | `/invoices/:id` | Admin | Update invoice |
| DELETE | `/invoices/:id` | Admin | Delete unpaid invoice |
| POST | `/invoices/bulk-generate` | Admin | Generate invoices for all active tenants |

**Filters for GET `/invoices`**: `?status=pending&tenantId=...&from=2024-01-01&to=2024-12-31`

### Payments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/payments/create-order` | Bearer | Create Razorpay order for invoice |
| POST | `/payments/verify` | Bearer | Verify payment after Razorpay checkout |
| GET | `/payments` | Admin | List all payments |
| GET | `/payments/:id` | Bearer | Get payment details |
| GET | `/payments/attempts/:invoiceId` | Bearer | Get payment attempts for invoice |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhooks/razorpay` | Razorpay payment events |

---

## Payment Flow

1. **Client** calls `POST /payments/create-order` with `invoiceId`
2. Server creates a Razorpay order → returns `{ orderId, amount, attemptId }`
3. **Client** opens Razorpay checkout using `orderId`
4. On success, **client** calls `POST /payments/verify` with Razorpay response
5. Server verifies signature → marks invoice paid → records payment
6. **Alternatively**, Razorpay fires a webhook to `/webhooks/razorpay` (server-side fallback)

---

## WhatsApp Templates

Create two approved templates in Meta Business Suite:

**`rent_due_reminder`** body variables:
1. `{{1}}` — Tenant name  
2. `{{2}}` — Amount (e.g. ₹8000)  
3. `{{3}}` — Due date (e.g. 2024-02-05)

**`rent_overdue_reminder`** body variables:
1. `{{1}}` — Tenant name  
2. `{{2}}` — Amount  
3. `{{3}}` — Due date

---

## Reminder Worker

The worker runs three cron jobs (IST timezone):

| Time | Job |
|------|-----|
| 1:00 AM | Mark past-due invoices as `overdue` |
| 9:00 AM | Send WhatsApp due reminders (3 days before due date) |
| 10:00 AM | Send WhatsApp overdue reminders |

Each reminder is deduplicated — a notification won't be sent twice in the same day for the same invoice.
