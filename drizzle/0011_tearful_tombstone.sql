CREATE TABLE `asset_migrations` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`applied_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
