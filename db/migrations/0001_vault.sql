CREATE TABLE `vault_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`agent_id` text,
	`item_id` text,
	`merchant` text NOT NULL,
	`amount` text NOT NULL,
	`purpose` text,
	`host` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`expires_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `vault_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vault_approvals_thread_idx` ON `vault_approvals` (`thread_id`);--> statement-breakpoint
CREATE TABLE `vault_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`hint` text NOT NULL,
	`site` text,
	`secret` text NOT NULL,
	`ephemeral` integer DEFAULT false NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vault_items_kind_idx` ON `vault_items` (`kind`);