ALTER TABLE "trips" DROP COLUMN IF EXISTS "destination_name";
ALTER TABLE "trips" DROP COLUMN IF EXISTS "destination_address";
ALTER TABLE "trips" DROP COLUMN IF EXISTS "destination_latitude";
ALTER TABLE "trips" DROP COLUMN IF EXISTS "destination_longitude";

CREATE TABLE IF NOT EXISTS "data_migrations" (
  "id" text PRIMARY KEY NOT NULL,
  "completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
