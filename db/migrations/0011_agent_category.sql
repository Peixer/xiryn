-- Category is the source of truth; retain the legacy column for SQLite compatibility.
ALTER TABLE `agents` ADD `category` text NOT NULL DEFAULT 'general';
--> statement-breakpoint
UPDATE `agents` SET `category` = 'coding' WHERE `coding_tools` = 1;
