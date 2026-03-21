ALTER TABLE `projects` ADD `autopilot_mode` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `pending_file_ids` text;