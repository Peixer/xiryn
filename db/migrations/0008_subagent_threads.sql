-- Subturn / subagent support
-- ephemeral: hidden from sidebar, deleted after the parent turn ends
-- parentThreadId: links a subturn thread back to the thread that spawned it
ALTER TABLE `threads` ADD `parent_thread_id` text REFERENCES `threads`(`id`) ON DELETE CASCADE;
ALTER TABLE `threads` ADD `ephemeral` integer DEFAULT false NOT NULL;
