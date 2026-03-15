/**
 * DATABASE SEED — src/db/seed.ts
 *
 * Seeds the database with:
 *   - Admin user
 *   - 2 rooms (Room 1 with 3 beds, Room 2 with 2 beds)
 *   - Default settings (rent window, late fee, etc.)
 *
 * HOW TO RUN:
 *   Local:  npx wrangler d1 execute pg-management --local --file=./seed.sql
 *
 * This file GENERATES the SQL. Run it with ts-node or just use the
 * SQL output below directly.
 *
 * GENERATED SEED SQL (run this after migrations):
 * ---------------------------------------------------
 * -- Default admin user (change password immediately after first login)
 * -- Password: "admin123" (hashed with PBKDF2)
 * -- TODO: Generate real hash using the hashPassword() util before running
 *
 * INSERT OR IGNORE INTO users (name, email, phone, password_hash, role, is_active, created_at)
 * VALUES ('Admin', 'admin@pg.com', '9999999999', 'REPLACE_WITH_REAL_HASH', 'admin', 1, datetime('now'));
 *
 * INSERT OR IGNORE INTO rooms (name, description, created_at) VALUES
 *   ('Room 1', 'First floor room', datetime('now')),
 *   ('Room 2', 'Second floor room', datetime('now'));
 *
 * INSERT OR IGNORE INTO beds (room_id, name, status, monthly_rent, created_at) VALUES
 *   (1, 'Bed 1', 'available', 5000, datetime('now')),
 *   (1, 'Bed 2', 'available', 5000, datetime('now')),
 *   (1, 'Bed 3', 'available', 5000, datetime('now')),
 *   (2, 'Bed 1', 'available', 5000, datetime('now')),
 *   (2, 'Bed 2', 'available', 5000, datetime('now'));
 *
 * INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
 *   ('rent_due_start_day', '1',   datetime('now')),
 *   ('rent_due_end_day',   '5',   datetime('now')),
 *   ('late_fee_amount',    '100', datetime('now')),
 *   ('deposit_amount',     '5000', datetime('now'));
 */

// This file is documentation. The actual seed is the SQL above.
// Copy it to a seed.sql file and run via wrangler d1 execute.
export { };