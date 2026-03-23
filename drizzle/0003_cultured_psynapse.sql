CREATE TABLE `agent_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attempt_id` text NOT NULL,
	`from_agent` text,
	`from_type` text NOT NULL,
	`to_type` text NOT NULL,
	`content` text NOT NULL,
	`summary` text,
	`is_broadcast` integer DEFAULT false NOT NULL,
	`timestamp` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agent_messages_attempt` ON `agent_messages` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `subagents` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`parent_id` text,
	`team_name` text,
	`status` text NOT NULL,
	`error` text,
	`prompt` text,
	`result_preview` text,
	`result_full` text,
	`started_at` integer,
	`completed_at` integer,
	`duration_ms` integer,
	`depth` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_subagents_attempt` ON `subagents` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `tracked_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`subject` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`owner` text,
	`active_form` text,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tracked_tasks_attempt` ON `tracked_tasks` (`attempt_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `last_model` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `last_provider` text;