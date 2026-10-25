CREATE TABLE `work_session_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`wake_status` text DEFAULT 'pending' NOT NULL,
	`wake_message_id` text,
	`created_at` integer NOT NULL,
	`woken_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_session_batches_thread_idx` ON `work_session_batches` (`thread_id`,`wake_status`);--> statement-breakpoint
CREATE INDEX `work_session_batches_agent_idx` ON `work_session_batches` (`agent_id`);--> statement-breakpoint
CREATE TABLE `work_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`agent_name` text NOT NULL,
	`task` text NOT NULL,
	`tool` text NOT NULL,
	`model` text,
	`branch` text DEFAULT '' NOT NULL,
	`worktree_path` text,
	`repo_path` text NOT NULL,
	`base_branch` text DEFAULT 'main' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`output` text DEFAULT '' NOT NULL,
	`duration_ms` integer,
	`error` text,
	`timeout_minutes` integer,
	FOREIGN KEY (`batch_id`) REFERENCES `work_session_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_sessions_agent_status_idx` ON `work_sessions` (`agent_id`,`status`);--> statement-breakpoint
CREATE INDEX `work_sessions_thread_idx` ON `work_sessions` (`thread_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `work_sessions_batch_idx` ON `work_sessions` (`batch_id`);