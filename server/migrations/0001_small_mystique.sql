PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bookings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`bed_id` integer NOT NULL,
	`status` text DEFAULT 'pending_deposit' NOT NULL,
	`monthly_rent` real NOT NULL,
	`move_in_date` text NOT NULL,
	`move_out_date` text,
	`next_rent_due_date` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bed_id`) REFERENCES `beds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_bookings`("id", "tenant_id", "bed_id", "status", "monthly_rent", "move_in_date", "move_out_date", "next_rent_due_date", "created_at") SELECT "id", "tenant_id", "bed_id", "status", "monthly_rent", "move_in_date", "move_out_date", "next_rent_due_date", "created_at" FROM `bookings`;--> statement-breakpoint
DROP TABLE `bookings`;--> statement-breakpoint
ALTER TABLE `__new_bookings` RENAME TO `bookings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_bookings_tenant_status` ON `bookings` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_beds_room_id` ON `beds` (`room_id`);--> statement-breakpoint
CREATE INDEX `idx_beds_status` ON `beds` (`status`);--> statement-breakpoint
CREATE INDEX `idx_payments_tenant_month` ON `payments` (`tenant_id`,`rent_month`);