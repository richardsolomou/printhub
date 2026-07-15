CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` text,
	`refreshTokenExpiresAt` text,
	`scope` text,
	`password` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE TABLE `asset_generation_jobs` (
	`request_id` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	PRIMARY KEY(`request_id`, `stage`),
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "asset_generation_jobs_stage_check" CHECK("asset_generation_jobs"."stage" IN ('thumbnail', 'preview')),
	CONSTRAINT "asset_generation_jobs_status_check" CHECK("asset_generation_jobs"."status" IN ('pending', 'running', 'ready', 'skipped', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `asset_generation_jobs_status` ON `asset_generation_jobs` (`status`,`queued_at`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`used_by` text,
	CONSTRAINT "invites_role_check" CHECK("invites"."role" IN ('admin', 'requester'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`request_id` text,
	`upload_id` text,
	`payload_json` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "operations_kind_check" CHECK("operations"."kind" IN ('move', 'delete', 'upload')),
	CONSTRAINT "operations_state_check" CHECK("operations"."state" IN ('prepared', 'assets_moved', 'committed'))
);
--> statement-breakpoint
CREATE INDEX `operations_state` ON `operations` (`state`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `operations_active_request` ON `operations` (`request_id`) WHERE "operations"."request_id" IS NOT NULL AND "operations"."state" <> 'committed';--> statement-breakpoint
CREATE UNIQUE INDEX `operations_upload` ON `operations` (`upload_id`) WHERE "operations"."upload_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `orientation_analysis_jobs` (
	`request_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`analysis_version` integer NOT NULL,
	`error` text,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orientation_analysis_jobs_status_check" CHECK("orientation_analysis_jobs"."status" IN ('pending', 'running', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `orientation_analysis_jobs_status` ON `orientation_analysis_jobs` (`status`,`queued_at`);--> statement-breakpoint
CREATE TABLE `plate_model_analysis` (
	`request_id` text PRIMARY KEY NOT NULL,
	`width_mm` real NOT NULL,
	`depth_mm` real NOT NULL,
	`height_mm` real NOT NULL,
	`analyzed_at` integer NOT NULL,
	`orientation_quaternion` text,
	`orientation_island_count` integer,
	`orientation_risk` real,
	`orientation_candidates` text,
	`content_hash` text,
	`analysis_version` integer DEFAULT 1 NOT NULL,
	`estimated_volume_mm3` real,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plate_model_analysis_content_hash` ON `plate_model_analysis` (`content_hash`);--> statement-breakpoint
CREATE TABLE `rateLimit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`lastRequest` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rateLimit_key_unique` ON `rateLimit` (`key`);--> statement-breakpoint
CREATE INDEX `rateLimit_key_idx` ON `rateLimit` (`key`);--> statement-breakpoint
CREATE TABLE `request_statuses` (
	`request_id` text NOT NULL,
	`status_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`sort_order` real,
	PRIMARY KEY(`request_id`, `status_id`),
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`file_name` text NOT NULL,
	`file_path` text NOT NULL,
	`quantity` integer NOT NULL,
	`owner_user_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_name` text,
	`notes` text,
	`source_url` text,
	`thumbnail_path` text,
	`preview_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`assets_generated_at` integer,
	`printer_id` text,
	`print_type` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "requests_print_type_check" CHECK("requests"."print_type" IN ('resin', 'filament') OR "requests"."print_type" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `requests_created` ON `requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `requests_print_type` ON `requests` (`print_type`);--> statement-breakpoint
CREATE INDEX `requests_printer_id` ON `requests` (`printer_id`);--> statement-breakpoint
CREATE INDEX `requests_owner_user_id` ON `requests` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` text NOT NULL,
	`token` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	`impersonatedBy` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `twoFactor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backupCodes` text NOT NULL,
	`userId` text NOT NULL,
	`verified` integer DEFAULT true NOT NULL,
	`failedVerificationCount` integer DEFAULT 0 NOT NULL,
	`lockedUntil` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `twoFactor_secret_idx` ON `twoFactor` (`secret`);--> statement-breakpoint
CREATE INDEX `twoFactor_userId_idx` ON `twoFactor` (`userId`);--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_request_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`completed_request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `upload_sessions_owner` ON `upload_sessions` (`owner_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer NOT NULL,
	`image` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`role` text,
	`banned` integer,
	`banReason` text,
	`banExpires` text,
	`color` text,
	`twoFactorEnabled` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);