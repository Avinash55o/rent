/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    Razorpay: any;
  }
}

/** Dynamically load the Razorpay checkout script */
function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window.Razorpay) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay SDK"));
    document.body.appendChild(script);
  });
}

export interface RazorpayResult {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface OpenRazorpayOptions {
  razorpayKeyId: string;
  orderId: string;
  amount: number; // in paise
  currency?: string;
  name?: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
}

/** Open the Razorpay checkout popup and return payment details */
export async function openRazorpayCheckout(
  options: OpenRazorpayOptions
): Promise<RazorpayResult> {
  await loadRazorpayScript();

  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: options.razorpayKeyId,
      amount: options.amount,
      currency: options.currency || "INR",
      name: options.name || "PG Rent Payment",
      description: options.description || "Payment",
      order_id: options.orderId,
      prefill: options.prefill || {},
      handler: (response: any) => {
        resolve({
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        });
      },
      modal: {
        ondismiss: () => {
          reject(new Error("Payment cancelled by user"));
        },
      },
    });
    rzp.open();
  });
}
