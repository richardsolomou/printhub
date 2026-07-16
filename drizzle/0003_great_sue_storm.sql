PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `requests_workspace_id_unique` ON `requests` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_asset_generation_jobs` (
	`workspace_id` text NOT NULL,
	`request_id` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	PRIMARY KEY(`workspace_id`, `request_id`, `stage`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`request_id`) REFERENCES `requests`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "asset_generation_jobs_stage_check" CHECK("__new_asset_generation_jobs"."stage" IN ('thumbnail', 'preview')),
	CONSTRAINT "asset_generation_jobs_status_check" CHECK("__new_asset_generation_jobs"."status" IN ('pending', 'running', 'ready', 'skipped', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_asset_generation_jobs`("workspace_id", "request_id", "stage", "status", "error", "queued_at", "started_at", "finished_at")
SELECT `requests`.`workspace_id`, `asset_generation_jobs`.`request_id`, `asset_generation_jobs`.`stage`, `asset_generation_jobs`.`status`, `asset_generation_jobs`.`error`, `asset_generation_jobs`.`queued_at`, `asset_generation_jobs`.`started_at`, `asset_generation_jobs`.`finished_at`
FROM `asset_generation_jobs`
INNER JOIN `requests` ON `requests`.`id` = `asset_generation_jobs`.`request_id`;--> statement-breakpoint
DROP TABLE `asset_generation_jobs`;--> statement-breakpoint
ALTER TABLE `__new_asset_generation_jobs` RENAME TO `asset_generation_jobs`;--> statement-breakpoint
CREATE INDEX `asset_generation_jobs_workspace_status` ON `asset_generation_jobs` (`workspace_id`,`status`,`queued_at`);--> statement-breakpoint
CREATE TABLE `__new_orientation_analysis_jobs` (
	`workspace_id` text NOT NULL,
	`request_id` text NOT NULL,
	`status` text NOT NULL,
	`analysis_version` integer NOT NULL,
	`error` text,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	PRIMARY KEY(`workspace_id`, `request_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`request_id`) REFERENCES `requests`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orientation_analysis_jobs_status_check" CHECK("__new_orientation_analysis_jobs"."status" IN ('pending', 'running', 'ready', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_orientation_analysis_jobs`("workspace_id", "request_id", "status", "analysis_version", "error", "queued_at", "started_at", "finished_at")
SELECT `requests`.`workspace_id`, `orientation_analysis_jobs`.`request_id`, `orientation_analysis_jobs`.`status`, `orientation_analysis_jobs`.`analysis_version`, `orientation_analysis_jobs`.`error`, `orientation_analysis_jobs`.`queued_at`, `orientation_analysis_jobs`.`started_at`, `orientation_analysis_jobs`.`finished_at`
FROM `orientation_analysis_jobs`
INNER JOIN `requests` ON `requests`.`id` = `orientation_analysis_jobs`.`request_id`;--> statement-breakpoint
DROP TABLE `orientation_analysis_jobs`;--> statement-breakpoint
ALTER TABLE `__new_orientation_analysis_jobs` RENAME TO `orientation_analysis_jobs`;--> statement-breakpoint
CREATE INDEX `orientation_analysis_jobs_workspace_status` ON `orientation_analysis_jobs` (`workspace_id`,`status`,`queued_at`);--> statement-breakpoint
CREATE TABLE `__new_plate_model_analysis` (
	`workspace_id` text NOT NULL,
	`request_id` text NOT NULL,
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
	PRIMARY KEY(`workspace_id`, `request_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`request_id`) REFERENCES `requests`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_plate_model_analysis`("workspace_id", "request_id", "width_mm", "depth_mm", "height_mm", "analyzed_at", "orientation_quaternion", "orientation_island_count", "orientation_risk", "orientation_candidates", "content_hash", "analysis_version", "estimated_volume_mm3")
SELECT `requests`.`workspace_id`, `plate_model_analysis`.`request_id`, `plate_model_analysis`.`width_mm`, `plate_model_analysis`.`depth_mm`, `plate_model_analysis`.`height_mm`, `plate_model_analysis`.`analyzed_at`, `plate_model_analysis`.`orientation_quaternion`, `plate_model_analysis`.`orientation_island_count`, `plate_model_analysis`.`orientation_risk`, `plate_model_analysis`.`orientation_candidates`, `plate_model_analysis`.`content_hash`, `plate_model_analysis`.`analysis_version`, `plate_model_analysis`.`estimated_volume_mm3`
FROM `plate_model_analysis`
INNER JOIN `requests` ON `requests`.`id` = `plate_model_analysis`.`request_id`;--> statement-breakpoint
DROP TABLE `plate_model_analysis`;--> statement-breakpoint
ALTER TABLE `__new_plate_model_analysis` RENAME TO `plate_model_analysis`;--> statement-breakpoint
CREATE INDEX `plate_model_analysis_workspace_content_hash` ON `plate_model_analysis` (`workspace_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `__new_request_statuses` (
	`workspace_id` text NOT NULL,
	`request_id` text NOT NULL,
	`status_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`sort_order` real,
	PRIMARY KEY(`workspace_id`, `request_id`, `status_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`request_id`) REFERENCES `requests`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_request_statuses`("workspace_id", "request_id", "status_id", "quantity", "sort_order")
SELECT `requests`.`workspace_id`, `request_statuses`.`request_id`, `request_statuses`.`status_id`, `request_statuses`.`quantity`, `request_statuses`.`sort_order`
FROM `request_statuses`
INNER JOIN `requests` ON `requests`.`id` = `request_statuses`.`request_id`;--> statement-breakpoint
DROP TABLE `request_statuses`;--> statement-breakpoint
ALTER TABLE `__new_request_statuses` RENAME TO `request_statuses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
