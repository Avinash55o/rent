import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../db/client";
import { settings } from "../db/schema";
import { nowISO } from "../utils";

// ─── Default values ───────────────────────────────────────────
// These are used when the setting hasn't been configured yet.
export const SETTING_DEFAULTS = {
    rent_due_start_day: "1",
    rent_due_end_day: "5",
    late_fee_amount: "100",
    deposit_amount: "10000",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

// ─── Service Functions ────────────────────────────────────────

/**
 * Get a setting value by key.
 * Falls back to default if not found in DB.
 */
export async function getSetting(
    db: DrizzleDb,
    key: SettingKey
): Promise<string> {
    const result = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key))
        .get();

    return result?.value ?? SETTING_DEFAULTS[key];
}

/**
 * Get all settings as a typed object.
 * Returns defaults for any settings not yet set in the DB.
 */
export async function getAllSettings(db: DrizzleDb): Promise<Record<SettingKey, string>> {
    const rows = await db.select().from(settings).all();
    const settingsMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    // Merge with defaults (DB values take precedence)
    return {
        rent_due_start_day:
            settingsMap["rent_due_start_day"] ?? SETTING_DEFAULTS.rent_due_start_day,
        rent_due_end_day:
            settingsMap["rent_due_end_day"] ?? SETTING_DEFAULTS.rent_due_end_day,
        late_fee_amount:
            settingsMap["late_fee_amount"] ?? SETTING_DEFAULTS.late_fee_amount,
        deposit_amount:
            settingsMap["deposit_amount"] ?? SETTING_DEFAULTS.deposit_amount,
    };
}

/**
 * Upsert a setting (insert if not exists, update if exists).
 * "Upsert" = UPDATE or INSERT — a very common DB operation pattern.
 */
export async function setSetting(
    db: DrizzleDb,
    key: SettingKey,
    value: string
): Promise<void> {
    await db
        .insert(settings)
        .values({ key, value, updatedAt: nowISO() })
        .onConflictDoUpdate({
            target: settings.key,
            set: { value, updatedAt: nowISO() },
        });
}

/**
 * Update multiple settings at once (for the admin panel form).
 */
export async function updateSettings(
    db: DrizzleDb,
    updates: Partial<Record<SettingKey, string>>
): Promise<void> {
    // Run all upserts in parallel for efficiency
    await Promise.all(
        Object.entries(updates).map(([key, value]) =>
            setSetting(db, key as SettingKey, value)
        )
    );
}