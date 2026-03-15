# How to Run & Frontend Design Guide

This document provides concise instructions for running the Rent Management API backend and how the frontend should be structured to interact with it.

## 🚀 Running the Backend (Cloudflare Workers)

### Prerequisites
1.  **Node.js & pnpm**: Ensure you have Node.js and `pnpm` installed.
2.  **Cloudflare Account**: You need a free Cloudflare account for deployment and D1 Database setup.
3.  **Wrangler CLI**: The official Cloudflare developer tool.

### Setup Instructions

1.  **Install Dependencies:**
    ```bash
    pnpm install
    ```

2.  **Authenticate Wrangler & Create Database:**
    ```bash
    npx wrangler login
    npx wrangler d1 create pg-management
    ```
    *Copy the `database_id` provided in the output and paste it into [wrangler.toml](file:///home/ppriyankuu/Projects/rent/server/wrangler.toml) under `[[d1_databases]]`.*

3.  **Run Migrations (Setup Database Tables):**
    ```bash
    # Run locally for development
    pnpm run db:migrate:local

    # Run remotely for production
    pnpm run db:migrate:remote
    ```

4.  **Set Secrets (Environment Variables):**
    You must set these secrets for the backend to function. Run these commands and enter the values when prompted:
    ```bash
    npx wrangler secret put JWT_SECRET
    npx wrangler secret put RAZORPAY_KEY_ID
    npx wrangler secret put RAZORPAY_KEY_SECRET
    npx wrangler secret put GOOGLE_CLIENT_ID
    npx wrangler secret put GOOGLE_CLIENT_SECRET
    ```

5.  **Start Development Server:**
    ```bash
    pnpm run dev
    # API will typically run on http://127.0.0.1:8787
    ```

6.  **Deploy to Production:**
    ```bash
    pnpm run deploy
    ```

---

## 💻 Frontend Design Guide

The frontend (Next.js, React, Vue, etc.) should be built around these core user flows and API interactions.

### 1. Public Home Page
*   **Purpose:** Show available beds to attract new tenants.
*   **Design:** Display a clean grid or list of rooms. Under each room, show beds as small cards or badges (e.g., "Available", "Occupied").
*   **API:** Call `GET /api/rooms` (public route - if you added one) or create a public endpoint to fetch bed statuses.

### 2. Authentication Flow
*   **Login/Signup:** Forms for Email/Password authentication.
*   **Google Auth:** A button linking to the route that securely fetches the Google OAuth screen.
*   **Token Storage:** Store the returned JWT securely (e.g., `localStorage` or HttpOnly cookies).
*   **API:**
    *   `POST /api/auth/signup`
    *   `POST /api/auth/login`
    *   `GET /api/auth/google` & `POST /api/auth/google/callback`

### 3. Tenant Dashboard
*   **Profile Section:** Display user info. Form to update Name and Phone Number (`PUT /api/auth/me`).
*   **Booking Registration:** Step-by-step flow: Select Room -> Select Bed -> Pay Deposit (Razorpay).
*   **Rent Payment Section:**
    *   Show current rent due, next due date, and applicable late fees.
    *   "Pay Now" button triggers Razorpay checkout.
*   **History & Complaints:** Tables showing past payments and a form to submit new complaints.

### 4. Razorpay Integration (Crucial)
1.  **Initiate (Backend):** Frontend calls `POST /api/payments/initiate` (or `/api/bookings` for deposit). Backend returns a Razorpay `orderId`.
2.  **Checkout (Frontend):** Frontend opens the Razorpay popup via the Razorpay Web JS SDK, passing the `orderId`.
3.  **Verify (Backend):** After Razorpay succeeds on the frontend, the frontend MUST immediately call `POST /api/payments/verify` (or `/api/bookings/deposit/verify`) with the signature data to mark the payment complete in your database.

### 5. Admin Dashboard
*   **Overview Stats:** Top-level cards showing Total Tenants, Available Beds, and Overdue Payments (`GET /api/admin/dashboard`).
*   **Tenant Management:** A data table of all tenants. Clicking a row opens a full profile view where the Admin can:
    *   Update individual or global rent amounts (`PUT /api/admin/tenants/:id/rent`).
    *   End a booking / process move-out (`POST /api/bookings/:id/end`).
    *   Deactivate accounts (`PUT /api/admin/tenants/:id/deactivate`).
*   **Manual Payments:** A form to record cash or direct UPI payments bypassing Razorpay (`POST /api/payments/manual`).
*   **Settings Panel:** Form to update global variables like late fee amount and rent due window (`PUT /api/admin/settings`).

### Essential Global Rules for Frontend
*   **Authorization Header:** Every authenticated request must include `Authorization: Bearer <JWT_TOKEN>`.
*   **Error Handling:** Catch 4XX and 5XX errors gracefully. Display the specific error message returned by the backend (e.g., "Bed is currently occupied").
