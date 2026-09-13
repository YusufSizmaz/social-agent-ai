ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_queue_dequeue_idx" ON "job_queue" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_analytics_post_fetched_idx" ON "post_analytics" USING btree ("post_id","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_project_created_idx" ON "posts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_account_created_idx" ON "posts" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_status_idx" ON "posts" USING btree ("status");
