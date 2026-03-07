import { and, eq, gte, lte, sql } from "drizzle-orm";
import { invoices } from "../db/schema";
import type { AppDB } from "../db/drizzle";

export async function markOverdueInvoices(db: AppDB): Promise<number> {
    const today = new Date().toISOString().split("T")[0];

    const result = await db
        .update(invoices)
        .set({ status: "overdue", updatedAt: new Date() })
        .where(
            and(
                eq(invoices.status, "pending"),
                sql`coalesce(${invoices.graceLastDate}, ${invoices.dueDate}) <= ${today}`
            )
        )
        .returning({ id: invoices.id });

    return result.length;
}

export async function getInvoicesDueInDays(db: AppDB, days: number) {
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + days);

    const todayStr = today.toISOString().split("T")[0];
    const targetStr = targetDate.toISOString().split("T")[0];

    return db.query.invoices.findMany({
        where: and(
            eq(invoices.status, "pending"),
            gte(invoices.dueDate, todayStr),
            lte(invoices.dueDate, targetStr)
        ),
    });
}

export async function getOverdueInvoices(db: AppDB) {
    return db.query.invoices.findMany({
        where: eq(invoices.status, "overdue"),
    });
}