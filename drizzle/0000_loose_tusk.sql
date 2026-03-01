CREATE TYPE "public"."account_role" AS ENUM('primary', 'secondary', 'backup');--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('text', 'image', 'video', 'story', 'reel', 'short');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'retrying');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('generate_content', 'publish_post', 'fetch_analytics', 'send_notification', 'poll_source');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('error', 'warn', 'info', 'debug');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('twitter', 'instagram', 'youtube', 'tiktok');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('pending', 'generating', 'review', 'scheduled', 'publishing', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tone" AS ENUM('emotional', 'informative', 'urgent', 'hopeful', 'friendly');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"role" "account_role" DEFAULT 'primary' NOT NULL,
	"username" varchar(100) NOT NULL,
	"credentials" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"strategy" jsonb,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_message" text,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" "log_level" NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"source" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_analytics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"engagement_rate" real DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"content_type" "content_type" NOT NULL,
	"text" text NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb,
	"media_urls" jsonb DEFAULT '[]'::jsonb,
	"status" "post_status" DEFAULT 'pending' NOT NULL,
	"tone" "tone",
	"platform_post_id" varchar(255),
	"platform_url" text,
	"safety_score" integer,
	"quality_score" integer,
	"error_message" text,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_analytics" ADD CONSTRAINT "post_analytics_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;