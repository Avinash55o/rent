CREATE INDEX `idx_complaints_tenant_id` ON `complaints` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_complaints_status` ON `complaints` (`status`);--> statement-breakpoint
CREATE INDEX `idx_complaints_tenant_status` ON `complaints` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_deposits_tenant_id` ON `deposits` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_deposits_status` ON `deposits` (`status`);--> statement-breakpoint
CREATE INDEX `idx_payments_tenant_status` ON `payments` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_payments_status` ON `payments` (`status`);--> statement-breakpoint
CREATE INDEX `idx_payments_booking_id` ON `payments` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_users_role` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `idx_users_is_active` ON `users` (`is_active`);