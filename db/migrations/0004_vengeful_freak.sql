CREATE TABLE `action_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`agent_id` text,
	`tool` text NOT NULL,
	`args` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`expires_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `action_approvals_thread_idx` ON `action_approvals` (`thread_id`,`status`);