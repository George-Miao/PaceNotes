CREATE TABLE IF NOT EXISTS "trips" (
  "id" varchar(32) PRIMARY KEY NOT NULL,
  "title" varchar(200) NOT NULL,
  "start_date" varchar(10) NOT NULL,
  "end_date" varchar(10) NOT NULL,
  "destination_place_id" varchar(255) NOT NULL,
  "destination_name" varchar(300) NOT NULL,
  "destination_address" varchar(500) NOT NULL,
  "destination_latitude" varchar(32) NOT NULL,
  "destination_longitude" varchar(32) NOT NULL,
  "time_zone" varchar(100) NOT NULL,
  "state" varchar(16) DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "documents" (
  "name" varchar(32) PRIMARY KEY NOT NULL,
  "data" bytea NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "documents_name_trips_id_fk" FOREIGN KEY ("name") REFERENCES "trips"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "creation_events" (
  "id" text PRIMARY KEY NOT NULL,
  "client_hash" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "creation_events_client_time_idx" ON "creation_events" USING btree ("client_hash", "created_at");
