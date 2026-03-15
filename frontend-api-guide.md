# frontend-api-guide.md

This document explains every API route you will need to build the frontend, including required parameters, authentication, and examples.

The base URL for all API calls is your backend domain (e.g., `http://localhost:8787` for development).

---

# DATA MODELS

Here are the important objects returned by the API.

### `User`
```json
{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "9876543210",
  "googleId": "1234567890", // Optional
  "role": "tenant", // OR "admin"
  "isActive": true,
  "createdAt": "2025-06-01T10:00:00Z"
}
```

### `Room`
```json
{
  "id": 1,
  "name": "Room 101",
  "description": "AC Room on the first floor",
  "createdAt": "2025-06-01T10:00:00Z"
}
```

### `Bed`
```json
{
  "id": 10,
  "roomId": 1,
  "name": "Bed A",
  "status": "available", // OR "reserved", "occupied"
  "monthlyRent": 5000,
  "createdAt": "2025-06-01T10:00:00Z"
}
```

### `Booking`
```json
{
  "id": 5,
  "tenantId": 1,
  "bedId": 10,
  "status": "active", // OR "pending_deposit", "ended"
  "monthlyRent": 5000,
  "moveInDate": "2025-06-01",
  "moveOutDate": null, 
  "nextRentDueDate": "2025-07-01",
  "createdAt": "2025-06-01T10:15:00Z"
}
```

### `Payment`
```json
{
  "id": 100,
  "tenantId": 1,
  "bookingId": 5,
  "amount": 5100,
  "type": "online", // OR "manual"
  "status": "completed", // OR "pending", "failed"
  "razorpayOrderId": "order_xyz123",
  "razorpayPaymentId": "pay_abc456",
  "rentMonth": "2025-06",
  "lateFee": 100,
  "notes": null,
  "paidAt": "2025-06-06T12:00:00Z",
  "createdAt": "2025-06-06T11:55:00Z"
}
```

---

# PUBLIC ROUTES
*These routes do not require any token or login.*

## GET `/api/rooms`
**Purpose:** View all rooms and their beds to show availability.
**Authentication:** None
**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Room 101",
      "description": "...",
      "createdAt": "...",
      "beds": [
        { "id": 10, "name": "Bed A", "status": "available", "monthlyRent": 5000 },
        { "id": 11, "name": "Bed B", "status": "occupied", "monthlyRent": 5000 }
      ]
    }
  ]
}
```

---

# AUTHENTICATION ROUTES

*(For all authenticated routes below, you must pass the token in the headers as: `Authorization: Bearer <your_jwt_token>`)*

## POST `/api/auth/signup`
**Purpose:** Register a new user with an email and password.
**Authentication:** None
**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "strongPassword123",
  "phone": "9876543210"
}
```
**Response:** User object (without password).
**Errors:** 409 (Email already exists).

## POST `/api/auth/login`
**Purpose:** Login with email and password to get a JWT.
**Authentication:** None
**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "strongPassword123"
}
```
**Response:** 
```json
{
  "success": true,
  "data": {
    "token": "eyJhb...", 
    "user": { ...User Object... }
  }
}
```
**Errors:** 401 (Invalid email or password).

## GET `/api/auth/google`
**Purpose:** Get the Google OAuth URL to redirect the user to Google's login page.
**Authentication:** None
**Response:**
```json
{
  "success": true,
  "data": {
    "url": "https://accounts.google.com/o/oauth2/v2/auth?...",
    "state": "random-uuid"
  }
}
```

## POST `/api/auth/google/callback`
**Purpose:** Send the code step from Google back to the server to get the JWT token.
**Authentication:** None
**Request Body:**
```json
{
  "code": "4/0AeaYSHC_..."
}
```
**Response:** Returns `token` and `user` (same format as `/login`).

## GET `/api/auth/me`
**Purpose:** Get the currently logged-in user's profile.
**Authentication:** Tenant or Admin
**Response:** `{ "success": true, "data": { "user": {...} } }`

---

# BOOKING ROUTES

## POST `/api/bookings`
**Purpose:** Start the bed booking process by creating a Razorpay deposit order.
**Authentication:** Tenant Authentication
**Request Body:**
```json
{
  "bedId": 10,
  "depositAmount": 5000
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "bookingId": 5,
    "razorpayOrderId": "order_abc123",
    "razorpayKeyId": "rzp_test_123",
    "amount": 5000,
    "currency": "INR"
  }
}
```
*(Use this Razorpay ID to open the payment gateway on the frontend).*
**Errors:** 409 (You already have an active booking), 409 (Bed is reserved).

## POST `/api/bookings/deposit/verify`
**Purpose:** Verify the deposit payment after Razorpay checkout finishes. This confirms the booking.
**Authentication:** Tenant Authentication
**Request Body:**
```json
{
  "razorpayOrderId": "order_abc123",
  "razorpayPaymentId": "pay_def456",
  "razorpaySignature": "abcdef1234567890..."
}
```
**Response:** 200 OK `"message": "Deposit verified. Booking confirmed!"`
**Errors:** 400 (Invalid signature).

## GET `/api/bookings/my`
**Purpose:** Get details of the tenant's current active booking.
**Authentication:** Tenant Authentication
**Response:**
```json
{
  "success": true,
  "data": {
    "booking": { ...Booking Object... },
    "bed": { ...Bed Object... },
    "deposit": { ...Deposit Object... }
  }
}
```

---

# PAYMENT ROUTES

## POST `/api/payments/initiate`
**Purpose:** Start the monthly rent payment process by creating a Razorpay order. It will automatically add late fees if applicable.
**Authentication:** Tenant Authentication
**Request Body:**
```json
{
  "rentMonth": "2025-06"
}
```
**Response:**
```json
{
  "paymentId": 100,
  "razorpayOrderId": "order_rent123",
  "razorpayKeyId": "rzp_test_123",
  "amount": 5100,
  "currency": "INR",
  "tenantName": "John Doe",
  "tenantEmail": "john@example.com"
}
```

## POST `/api/payments/verify`
**Purpose:** Verify the Razorpay rent payment.
**Authentication:** Tenant Authentication
**Request Body:**
```json
{
  "razorpayOrderId": "order_rent123",
  "razorpayPaymentId": "pay_rent456",
  "razorpaySignature": "abcdefg..."
}
```
**Response:** 200 OK `"message": "Payment successful!"`

## GET `/api/payments/my`
**Purpose:** Get rent payment history for the logged-in tenant.
**Authentication:** Tenant Authentication
**Response:** Array of Payment objects.

## GET `/api/payments/my/:id/receipt`
**Purpose:** Get structured data to generate a rent receipt (PDF) on the frontend.
**Authentication:** Tenant Authentication
**Response:**
```json
{
  "receiptNumber": "RCP-000100",
  "tenant": { "name": "John", "email": "..." },
  "room": "Room 101",
  "bed": "Bed A",
  "rentMonth": "2025-06",
  "rentAmount": 5000,
  "lateFee": 100,
  "totalAmount": 5100,
  "paymentType": "online",
  "paidAt": "2025-06-06T12:00:00Z"
}
```

---

# TENANT ROUTES

## PUT `/api/auth/me`
**Purpose:** Allow the tenant to update their profile (e.g. phone number).
**Authentication:** Tenant Authentication
**Request Body:**
```json
{
  "name": "John Doe",
  "phone": "1112223333"
}
```

## POST `/api/complaints`
**Purpose:** Tenant submits a new complaint.
**Authentication:** Tenant Authentication
**Request Body:**
```json
{
  "subject": "Broken AC",
  "message": "The AC in Room 101 is not cooling."
}
```

## GET `/api/complaints/my`
**Purpose:** Get all complaints submitted by the tenant.
**Authentication:** Tenant Authentication

---

# ADMIN ROUTES
*All routes below require Admin Authentication.*

## GET `/api/admin/dashboard`
**Purpose:** Get statistics for the admin dashboard (total beds, occupied, overdue payments, etc).

## POST `/api/rooms`
**Purpose:** Create a room and automatically create its beds.
**Request Body:**
```json
{
  "name": "Room 102",
  "description": "Ground floor",
  "beds": [
    { "name": "Bed A", "monthlyRent": 5000 },
    { "name": "Bed B", "monthlyRent": 5000 }
  ]
}
```

## GET `/api/admin/tenants`
**Purpose:** List all tenants along with their current booking status and bed.

## POST `/api/admin/tenants`
**Purpose:** Manually create a tenant (and optionally assign a bed immediately).
**Request Body:**
```json
{
  "name": "Jane",
  "email": "jane@example.com",
  "password": "tempPassword",
  "phone": "1234567",
  "bedId": 11 // Optional
}
```

## PUT `/api/admin/tenants/:id/rent`
**Purpose:** Update the monthly rent for a tenant (or all tenants).
**Request Body:**
```json
{
  "monthlyRent": 5500,
  "applyToAll": false 
}
```

## POST `/api/bookings/:id/end`
**Purpose:** End a booking (tenant leaves). Fees can be deducted from deposit.
**Request Body:**
```json
{
  "moveOutDate": "2025-10-01",
  "refundAmount": 4500,
  "deductionAmount": 500,
  "deductionReason": "Broken chair"
}
```

## POST `/api/payments/manual`
**Purpose:** Manually record a rent payment if the tenant paid cash/UPI.
**Request Body:**
```json
{
  "tenantId": 1,
  "amount": 5000,
  "rentMonth": "2025-06",
  "notes": "Paid by cash"
}
```

## GET `/api/admin/export/payments`
**Purpose:** Download a CSV file of all payments. Frontend can trigger a browser download.

## GET `/api/admin/export/tenants`
**Purpose:** Download a CSV file of all tenants.

## PUT `/api/admin/settings`
**Purpose:** Change system rules.
**Request Body:**
```json
{
  "rent_due_start_day": 1,
  "rent_due_end_day": 5,
  "late_fee_amount": 200,
  "deposit_amount": 6000
}
```
