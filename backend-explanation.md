# backend-explanation.md

## 1. Project Overview

This system is a backend application designed to manage a **PG (Paying Guest) / room rental and rent payment system**. 

- **What the system does:** It helps tenants find available beds, book them, and pay monthly rent. It helps the admin manage rooms, beds, tenants, and track all rent payments.
- **How tenants use the system:** Tenants can view available beds publicly. To book a bed, they must log in using their Google account or sign up with an email and password. Once logged in, they can select a bed, pay a deposit to secure the booking, pay their monthly rent online, view their payment history, and submit complaints if they have issues.
- **How the admin manages tenants and rooms:** The admin has a special dashboard. The admin can create new rooms, add beds to those rooms, manually add tenants, change rent amounts, record cash payments, update system settings (like late fees), and remove tenants when they leave.
- **How beds and rooms are structured:** The system is based on beds, not whole rooms. 
  Example structure:
  - Room 101 → Bed A, Bed B, Bed C
  - Room 102 → Bed A, Bed B
  
**Tenants always book individual beds**, never a full room.

---

## 2. System Architecture

The backend is built using modern serverless technologies.

- **Hono:** This is the web framework used to build the API. It creates the routes (like `/api/rooms`), handles incoming requests, and sends JSON responses back to the frontend. It is very fast and lightweight.
- **Cloudflare Workers:** The backend code is hosted on Cloudflare Workers. It does not run on a traditional server that stays on 24/7. Instead, when a user makes a request, Cloudflare runs a "Worker" (a small piece of code) instantly to handle that specific request.
- **Cloudflare D1:** This is the database. It is a serverless SQLite database built by Cloudflare. It stores all the data (users, rooms, beds, payments).
- **Razorpay:** This is the payment gateway used to collect money. When a tenant pays a deposit or rent, Razorpay securely processes the credit card or UPI details and tells our system if the payment was successful.
- **Google OAuth:** This is used for authentication. Tenants can log in quickly using their Gmail accounts instead of creating a new password.

**Full Request Flow Example:**
User clicks "Pay Rent" → Request goes to Hono API route (`/api/payments/initiate`) → Validation checks if the rent month is already paid → Backend asks Razorpay to create an order → Backend saves pending payment in D1 Database → Response sends the Razorpay Order ID to the frontend.

---

## 3. Folder and File Structure

Here are the important files in the `/server` backend directory:

- `src/index.ts`: The root of the application. It creates the main Hono app, sets up CORS (to allow the frontend to talk to the backend), sets up global error handling, and connects all the route files.
- `src/db/schema.ts`: Defines the database design. It explains exactly what tables and columns exist in Cloudflare D1.
- `src/routes/`: This folder contains all the API endpoint files.
  - `auth.ts`: Handles signup, login, and Google OAuth routes.
  - `admin.ts`: Handles requests only the admin can do (viewing all tenants, ending bookings, exporting CSV data).
  - `bookings.ts`: Handles the logic for booking a bed, creating deposit orders, and releasing a bed.
  - `payments.ts`: Handles the logic for initiating and verifying rent payments, and viewing payment history.
  - `rooms.ts`: Handles listing rooms/beds and admin tools for creating them.
  - `complaints.ts`: Handles creating and reading complaints.
- `src/middleware/auth.ts`: Checks if a user is logged in. It verifies the JWT token sent by the browser. If the token is bad, it stops the request.
- `src/services/`: This folder contains complex logic separated from the routes.
  - `razorpay.service.ts`: Code that directly talks to the Razorpay API to create orders and verify payments.
  - `payment.service.ts`: Business logic for calculating late fees and updating the database when a payment is successful.
  - `google.service.ts`: Code that exchanges the Google login code for a user's email and profile picture.

---

## 4. Database Design

The database uses SQLite (Cloudflare D1). Here are the tables:

- **rooms:**
  - *Purpose:* Stores the physical rooms.
  - *Columns:* `id`, `name` (e.g., "Room 1"), `description`, `createdAt`.
  - *Relationships:* A room has many beds.
  
- **beds:**
  - *Purpose:* Stores individual beds that tenants can book.
  - *Columns:* `id`, `roomId` (links to `rooms`), `name` (e.g., "Bed A"), `status` ("available", "reserved", "occupied"), `monthlyRent`.
  - *Rules:* The `status` prevents double-booking.
  
- **users:**
  - *Purpose:* Stores both regular tenants and the admin.
  - *Columns:* `id`, `name`, `email`, `phone`, `passwordHash`, `googleId`, `role` ("admin" or "tenant"), `isActive`.
  - *Rules:* `googleId` is used if they logged in with Google. `passwordHash` is used if they used standard email/password.
  
- **bookings:**
  - *Purpose:* Connects a tenant to a specific bed. It shows who is sleeping where.
  - *Columns:* `id`, `tenantId` (links to `users`), `bedId` (links to `beds`), `status` ("pending_deposit", "active", "ended"), `monthlyRent`, `moveInDate`, `moveOutDate`, `nextRentDueDate`.
  - *Rules:* One tenant can only have one active booking.
  
- **deposits:**
  - *Purpose:* Stores the security deposit paid during booking.
  - *Columns:* `id`, `bookingId`, `tenantId`, `amount`, `status` ("held", "refunded", "partially_refunded"), `razorpayOrderId`, `razorpayPaymentId`, `refundAmount`, `deductionAmount`.
  
- **payments:**
  - *Purpose:* Stores monthly rent records.
  - *Columns:* `id`, `tenantId`, `bookingId`, `amount`, `type` ("online" or "manual"), `status` ("pending", "completed", "failed"), `rentMonth` (e.g., "2025-06"), `lateFee`, `razorpayOrderId`...
  - *Rules:* Tracks exactly which month the rent was paid for.

- **complaints:** Stores issues submitted by tenants.
- **settings:** Stores admin configuration like late fee amounts (stored as key-value pairs) so the admin can change rules without touching code.

*Why this design?* It strictly separates "users" from "bookings." This allows a user to leave the PG, have their booking ended, and move back later with a new booking history, while keeping all past payment records intact.

---

## 5. Bed Booking Logic

Here is the complete step-by-step flow when a tenant books a bed:

1. **User sees available beds:** Tenant views the rooms without logging in (Public route).
2. **User signs up or logs in:** Tenant creates an account so the system knows who they are.
3. **User selects a bed:** Tenant chooses an available bed and initiates a booking. 
4. **Deposit payment is created:** The backend checks if the bed is still "available". If yes, it creates a `booking` with status `"pending_deposit"`. It changes the bed status to `"reserved"`. It asks Razorpay to create a payment order for the deposit amount.
5. **Razorpay payment happens:** The frontend shows the Razorpay popup. The user pays. Razorpay gives the frontend a payment ID and signature.
6. **Booking is confirmed:** The frontend sends the Razorpay signature to the backend (`/api/bookings/deposit/verify`). The backend securely verifies the signature. If valid, the backend marks the deposit as paid, changes the booking status to `"active"`, and changes the bed status to `"occupied"`.

**Preventing double booking:** The database enforces this using the bed's `status`. Step 4 ensures that if two people click "Book" at the same time, the second person will be rejected because the bed instantly becomes `"reserved"` for the first person. Additionally, a tenant cannot book a bed if they already have an active booking.

---

## 6. Google Authentication Flow

Here is how Google login works:

1. The frontend asks the backend for a Google Login URL (`/api/auth/google`).
2. The user clicks the link, goes to Google, logs in, and approves the app.
3. Google redirects the user back to the frontend with a special code in the URL.
4. The frontend sends this code to the backend (`/api/auth/google/callback`).
5. The backend talks directly to Google's servers to exchange the code for the user's Google Profile (email, name, Google ID).
6. **Backend Logic:**
   - It checks the database: *Does a user with this Google ID exist?* If yes, log them in.
   - *Does a user with this email exist but without a Google ID?* If yes, link the Google ID to their existing account and log them in.
   - *Is this completely new?* If yes, create a new user account in the database (with no password hash, and "tenant" role).
7. Finally, the backend generates a **JWT (JSON Web Token)**. This is a secure digital passport. The backend sends this JWT token to the frontend. The frontend uses it for all future API requests to prove the user is logged in.

---

## 7. Tenant Management

The admin has full control over tenants:
- **Admin-created tenants:** The admin can manually create a tenant account (providing an email and password) and manually assign a bed. This skips the online deposit payment step.
- **Removing tenants:** When a tenant leaves, the admin clicks a button to "End Booking". The backend updates the booking status to `"ended"`, calculates any deposit deductions, and changes the bed status back to `"available"`.
- **Profile editing:** Tenants can edit their own profiles (name, phone) via a `/api/auth/me` endpoint. Admins generally do not edit tenant personal info, but they can deactivate a tenant's account entirely to remove their login access.

---

## 8. Rent Payment Logic

Rent calculations are strict and automatic.

- **Rent Window:** Rent is typically due between the 1st and the 5th of the month. These days are stored in the database `settings` table.
- **Overdue Logic:** If a tenant tries to pay rent for the current month and today's date is past the 5th, the system calculates an **overdue fee** (e.g., ₹100).
- **One-time fee:** The late fee is a single fixed amount added to the regular monthly rent. 
- **Implementation:** When the user clicks "Pay Rent", the backend checks the current date. If `today > 5`, it automatically adds the ₹100 fee to the Razorpay order. The backend creates a pending payment in the database that clearly logs the rent amount + the extra late fee.

---

## 9. Razorpay Payment Flow

Because security is critical for money, a two-step process is followed (used for both Deposits and Rent):

1. **Order Creation:** The backend calls Razorpay using a secret key and says "I need to collect ₹5000 from this user". Razorpay returns an `order_id`. The backend saves this order ID in the database with status `"pending"`.
2. **Payment Processing:** The frontend takes the `order_id` and opens the Razorpay popup. The user types their UPI or card info.
3. **Signature Verification:** Razorpay gives the frontend a `razorpay_signature`. The frontend sends this to the backend. **The backend uses cryptography to verify the signature.** This prevents hackers from faking a successful payment.
4. **Updating the Database:** Only after the signature is verified does the backend mark the payment as `"completed"` in the database and updates the booking's next rent due date to next month.

---

## 10. Authentication and Authorization

- **Authentication (Login Methods):** Users can log in manually (email + password) or via Google OAuth. 
- **JWT (JSON Web Tokens):** The system uses JWTs instead of traditional sessions because Cloudflare Workers are "stateless" (they don't have persistent server memory). A JWT safely stores the user ID and role inside the token. 
- **Authorization (Permissions):** 
  - The middleware `requireAuth()` ensures a valid JWT is present. If not, it blocks the request.
  - The middleware `requireAdmin()` checks the user's role. If the `role !== "admin"`, it blocks the request giving a 403 Forbidden error.
- **Protected Routes:** All booking, payment, and complaint routes require the user to be a tenant. All dashboard, setting changes, and tenant management routes require the user to be an admin.

---

## 11. Error Handling

- **Validation:** Every request body is checked using a library called Zod. If the frontend forgets to send a requirement (like `depositAmount`), the backend instantly replies with a 400 Bad Request error.
- **Common Failure Scenarios:**
  - *Payment fails or signature invalid:* The server returns 400 "Invalid signature — possible fraud attempt".
  - *Bed already booked:* The server returns 409 "Bed is currently reserved/occupied".
  - *Invalid token:* The server returns 401 "Invalid or expired token".
- **Safety Net:** If an unexpected crash happens, a global error handler catches it so the server doesn't freeze. It returns a safe JSON error like "Internal server error" without leaking code secrets.

---

## 12. Important Business Rules

Please keep these critical rules in mind while building the frontend:

1. **Users should not exist unless they book a bed or admin adds them:** (Except if they sign up but abandon the process). A tenant must have a booking to use feature like payments.
2. **Beds cannot have multiple tenants:** If a bed's status is "reserved" or "occupied", nobody else can book it.
3. **Admin can manually add tenants:** Some tenants pay cash. The admin can bypass the online systems and directly attach a tenant to an "occupied" bed.
4. **Tenants can see payment history:** They have read-only access to their past payments and deposit status.
5. **Only tenants can pay rent:** Admins cannot pay rent on behalf of a tenant online; admins can only record manual "cash/UPI" payments.
