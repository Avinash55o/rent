import { eq } from "drizzle-orm";
import { invoices, notificationLogs, tenantProfiles, users } from "../db/schema";
import type { AppDB } from "../db/drizzle";
import type { Env } from "../types";

// ── Email ──────────────────────────────────────────

export interface SendEmailParams {
    to: string;
    subject: string;
    html: string;
}

export async function sendEmail(
    env: Env,
    params: SendEmailParams
): Promise<boolean> {
    // If GOOGLE_REFRESH_TOKEN is present, use Gmail API (Free)
    if (env.GOOGLE_REFRESH_TOKEN) {
        return sendEmailViaGmail(env, params);
    }

    // Otherwise fallback to Resend
    const { to, subject, html } = params;

    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${env.RESEND_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: env.RESEND_FROM_EMAIL,
                to: [to],
                subject,
                html,
            }),
        });

        if (!res.ok) {
            const error = await res.text();
            console.error("[Email] Failed to send via Resend:", error);
            return false;
        }
        return true;
    } catch (error: any) {
        console.error("[Email] Failed to send via Resend:", error.message);
        return false;
    }
}

// ── Email via Google Gmail API (Free) ──────────────
export async function sendEmailViaGmail(
    env: Env,
    params: SendEmailParams
): Promise<boolean> {
    const { to, subject, html } = params;

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
        console.error("[Gmail] Missing Google credentials in Env");
        return false;
    }

    try {
        // 1. Get a fresh Access Token using the Refresh Token
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: env.GOOGLE_CLIENT_ID,
                client_secret: env.GOOGLE_CLIENT_SECRET,
                refresh_token: env.GOOGLE_REFRESH_TOKEN,
                grant_type: "refresh_token"
            }).toString()
        });

        const tokenData: any = await tokenRes.json();
        const accessToken = tokenData.access_token;

        if (!accessToken) {
            console.error("[Gmail] Failed to get Access Token:", tokenData);
            return false;
        }

        // 2. Format the email into base64url format required by Gmail API
        const emailHeader = `From: ${env.GMAIL_FROM_MAIL}
            To: ${to}
            Subject: ${subject}
            Content-Type: text/html; charset=utf-8`;
        const fullEmail = emailHeader + html;
        const encodedEmail = encodeBase64Url(fullEmail);

        // 3. Send via Gmail API
        const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ raw: encodedEmail })
        });

        if (!sendRes.ok) {
            console.error("[Gmail] Failed to send via Gmail API:", await sendRes.text());
            return false;
        }
        return true;
    } catch (error: any) {
        console.error("[Gmail] Error sending email via Gmail API:", error.message);
        return false;
    }
}

// ── Email templates ────────────────────────────────

function dueReminderEmailHtml(name: string, amount: string, dueDate: string): string {
    return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
      <h2 style="color: #1f2937; margin: 0 0 16px;">Rent Due Reminder</h2>
      <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
        Hi <strong>${name}</strong>,
      </p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
        This is a friendly reminder that your rent payment of <strong>${amount}</strong> is due on <strong>${dueDate}</strong>.
      </p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        Please ensure timely payment to avoid late fees.
      </p>
      <p style="color: #9ca3af; font-size: 13px; margin: 0;">— Rent Management</p>
    </div>`;
}

function overdueReminderEmailHtml(name: string, amount: string, dueDate: string): string {
    return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
      <h2 style="color: #dc2626; margin: 0 0 16px;">⚠️ Rent Overdue Notice</h2>
      <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
        Hi <strong>${name}</strong>,
      </p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
        Your rent payment of <strong>${amount}</strong> was due on <strong>${dueDate}</strong> and is now <strong style="color: #dc2626;">overdue</strong>.
      </p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        Please make the payment at your earliest convenience to avoid further action.
      </p>
      <p style="color: #9ca3af; font-size: 13px; margin: 0;">— Rent Management</p>
    </div>`;
}

// ── WhatsApp via Meta Cloud API (kept for future use) ──

export interface SendWhatsAppParams {
    to: string;
    templateName: string;
    languageCode?: string;
    components?: object[];
}

export async function sendWhatsAppMessage(
    env: Env,
    params: SendWhatsAppParams
): Promise<boolean> {
    const { to, templateName, languageCode = "en", components = [] } = params;

    try {
        const res = await fetch(
            `${env.WHATSAPP_API_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to,
                    type: "template",
                    template: {
                        name: templateName,
                        language: { code: languageCode },
                        components,
                    },
                }),
            }
        );

        if (!res.ok) {
            const error = await res.text();
            console.error("[WhatsApp] Failed to send message:", error);
            return false;
        }
        return true;
    } catch (error: any) {
        console.error("[WhatsApp] Failed to send message:", error.message);
        return false;
    }
}

// ── Reminder senders (email-first approach) ────────

export async function sendDueReminder(
    db: AppDB, env: Env, tenantId: string, invoiceId: string
): Promise<void> {
    const invoice = await db.query.invoices.findFirst({
        where: eq(invoices.id, invoiceId),
    });
    const tenant = await db.query.tenantProfiles.findFirst({
        where: eq(tenantProfiles.id, tenantId),
    });
    if (!invoice || !tenant) return;

    const user = await db.query.users.findFirst({
        where: eq(users.id, tenant.userId),
    });
    if (!user?.email) return;

    const name = user.name || "Tenant";
    const amount = `₹${invoice.amount}`;

    // Email first
    const emailSuccess = await sendEmail(env, {
        to: user.email,
        subject: `Rent Due Reminder — ${amount} by ${invoice.dueDate}`,
        html: dueReminderEmailHtml(name, amount, invoice.dueDate),
    });

    await db.insert(notificationLogs).values({
        tenantId, invoiceId,
        type: "due_reminder",
        channel: "email",
        status: emailSuccess ? "sent" : "failed",
        sentAt: new Date(),
    });
}

export async function sendOverdueReminder(
    db: AppDB, env: Env, tenantId: string, invoiceId: string
): Promise<void> {
    const invoice = await db.query.invoices.findFirst({
        where: eq(invoices.id, invoiceId),
    });
    const tenant = await db.query.tenantProfiles.findFirst({
        where: eq(tenantProfiles.id, tenantId),
    });
    if (!invoice || !tenant) return;

    const user = await db.query.users.findFirst({
        where: eq(users.id, tenant.userId),
    });
    if (!user?.email) return;

    const name = user.name || "Tenant";
    const amount = `₹${invoice.amount}`;

    // Email first
    const emailSuccess = await sendEmail(env, {
        to: user.email,
        subject: `⚠️ Rent Overdue — ${amount} was due ${invoice.dueDate}`,
        html: overdueReminderEmailHtml(name, amount, invoice.dueDate),
    });

    await db.insert(notificationLogs).values({
        tenantId, invoiceId,
        type: "overdue_reminder",
        channel: "email",
        status: emailSuccess ? "sent" : "failed",
        sentAt: new Date(),
    });
}

// ── Helpers ────────────────────────────────────────

function encodeBase64Url(str: string): string {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    for (const b of bytes) {
        binary += String.fromCharCode(b);
    }
    const base64 = btoa(binary);

    return base64
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}