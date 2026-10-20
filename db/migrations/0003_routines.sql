CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`agent_id` text,
	`squad_id` text,
	`prompt` text NOT NULL,
	`schedule` text NOT NULL,
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
CREATE INDEX `routines_next_idx` ON `routines` (`enabled`,`next_run_at`);