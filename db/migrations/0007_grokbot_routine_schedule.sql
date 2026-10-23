PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_routines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`agent_id` text,
	`squad_id` text,
	`prompt` text NOT NULL,
	`schedule` text,
	`enabled` integer DEFAULT true NOT NULL,
	`thread_id` text,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_status` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`squad_id`) REFERENCES `squads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_routines`("id", "name", "agent_id", "squad_id", "prompt", "schedule", "enabled", "thread_id", "next_run_at", "last_run_at", "last_status", "last_error", "created_at") SELECT "id", "name", "agent_id", "squad_id", "prompt", "schedule", "enabled", "thread_id", "next_run_at", "last_run_at", "last_status", "last_error", "created_at" FROM `routines`;--> statement-breakpoint
DROP TABLE `routines`;--> statement-breakpoint
ALTER TABLE `__new_routines` RENAME TO `routines`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `routines_next_idx` ON `routines` (`enabled`,`next_run_at`);