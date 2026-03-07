import { and, eq, gte } from "drizzle-orm";
import { notificationLogs } from "../db/schema";
import {
    getInvoicesDueInDays,
    getOverdueInvoices,
    markOverdueInvoices,
} from "../services/invoice.service";
import {
    sendDueReminder,
    sendOverdueReminder,
} from "../services/notification.service";
import { createDb } from "../db/drizzle";
import type { Env } from "../types";

async function wasReminderSentToday(
    db: ReturnType<typeof createDb>,
    tenantId: string,
    invoiceId: string,
    type: "due_reminder" | "overdue_reminder"
): Promise<boolean> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const existing = await db.query.notificationLogs.findFirst({
        where: and(
            eq(notificationLogs.tenantId, tenantId),
            eq(notificationLogs.invoiceId, invoiceId),
            eq(notificationLogs.type, type),
            gte(notificationLogs.createdAt, startOfDay)
        ),
    });

    return !!existing;
}

// Called by the CF scheduled handler in index.ts
export async function handleScheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
) {
    const db = createDb(env.rent_db);
    const cron = event.cron;

    // 1:00 AM IST = 7:30 PM UTC previous day → "30 19 * * *"
    if (cron === "30 19 * * *") {
        console.log("[Cron] Running: markOverdueInvoices");
        const count = await markOverdueInvoices(db);
        console.log(`[Cron] Marked ${count} invoices as overdue`);
    }

    // 9:00 AM IST = 3:30 AM UTC → "30 3 * * *"
    if (cron === "30 3 * * *") {
        console.log("[Cron] Running: sendDueReminders");
        const upcoming = await getInvoicesDueInDays(db, 5);
        for (const invoice of upcoming) {
            const alreadySent = await wasReminderSentToday(
                db, invoice.tenantId, invoice.id, "due_reminder"
            );
            if (alreadySent) continue;
            await sendDueReminder(db, env, invoice.tenantId, invoice.id);
        }
    }

    // 10:00 AM IST = 4:30 AM UTC → "30 4 * * *"
    if (cron === "30 4 * * *") {
        console.log("[Cron] Running: sendOverdueReminders");
        const overdue = await getOverdueInvoices(db);
        for (const invoice of overdue) {
            const alreadySent = await wasReminderSentToday(
                db, invoice.tenantId, invoice.id, "overdue_reminder"
            );
            if (alreadySent) continue;
            await sendOverdueReminder(db, env, invoice.tenantId, invoice.id);
        }
    }
}
