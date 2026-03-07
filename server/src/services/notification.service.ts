import { eq } from "drizzle-orm";
import { invoices, notificationLogs, tenantProfiles, users } from "../db/schema";
import type { AppDB } from "../db/drizzle";
import type { Env } from "../types";

// ── Email via Resend ───────────────────────────────

export interface SendEmailParams {
    to: string;
    subject: string;
    html: string;
}

export async function sendEmail(
    env: Env,
    params: SendEmailParams
): Promise<boolean> {
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
            console.error("[Email] Failed to send:", error);
            return false;
        }
        return true;
    } catch (error: any) {
        console.error("[Email] Failed to send:", error.message);
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

function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("91") && digits.length === 12) return digits;
    if (digits.length === 10) return `91${digits}`;
    return digits;
}
