/**
 * HOW RAZORPAY PAYMENTS WORK (2-step process):
 *
 * Step 1 — Create Order (backend):
 *   Your server calls Razorpay API to create an "order" with the amount.
 *   Razorpay returns an order_id. You send this to the frontend.
 *
 * Step 2 — Collect Payment (frontend) + Verify (backend):
 *   Frontend opens Razorpay checkout with the order_id.
 *   User pays via UPI/card/net banking.
 *   Razorpay sends back: razorpay_order_id, razorpay_payment_id, razorpay_signature
 *   Your server MUST verify the signature before marking payment as complete.
 *   (Signature = HMAC of order_id + "|" + payment_id, signed with your key_secret)
 *
 * WHY VERIFY THE SIGNATURE?
 * Without verification, anyone could fake a payment_id and mark rent as paid.
 * The signature proves Razorpay actually processed the payment.
 *
 * NOTE: We use the Razorpay REST API directly (no SDK) because the official
 * Razorpay Node SDK uses Node.js-specific APIs unavailable in Workers.
 */

export interface RazorpayOrder {
    id: string;
    amount: number;        // in paise (₹1 = 100 paise)
    currency: string;
    receipt: string;
    status: string;
}

export interface CreateOrderOptions {
    amount: number;        // in RUPEES (we convert to paise internally)
    receipt: string;       // your internal reference (e.g. payment DB id)
    notes?: Record<string, string>;
}

/**
 * Create a Razorpay order.
 * Call this when a tenant clicks "Pay Rent" — before showing the payment UI.
 */
export async function createRazorpayOrder(
    keyId: string,
    keySecret: string,
    options: CreateOrderOptions
): Promise<RazorpayOrder> {
    // Razorpay API uses HTTP Basic Auth: base64(key_id:key_secret)
    const credentials = btoa(`${keyId}:${keySecret}`);

    const response = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify({
            amount: Math.round(options.amount * 100), // convert ₹ to paise
            currency: "INR",
            receipt: options.receipt,
            notes: options.notes ?? {},
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Razorpay order creation failed: ${error}`);
    }

    return response.json() as Promise<RazorpayOrder>;
}

/**
 * Fetch a Razorpay order's details.
 * Useful for checking payment status server-side.
 */
export async function fetchRazorpayOrder(
    keyId: string,
    keySecret: string,
    orderId: string
): Promise<RazorpayOrder> {
    const credentials = btoa(`${keyId}:${keySecret}`);

    const response = await fetch(
        `https://api.razorpay.com/v1/orders/${orderId}`,
        {
            headers: { Authorization: `Basic ${credentials}` },
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch Razorpay order: ${orderId}`);
    }

    return response.json() as Promise<RazorpayOrder>;
}