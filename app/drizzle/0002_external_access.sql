CREATE TABLE "external_idempotency" (
  "scope" varchar(128) NOT NULL,
  "method" varchar(64) NOT NULL,
  "key" varchar(128) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "response" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "external_idempotency_scope_method_key_pk" PRIMARY KEY ("scope", "method", "key")
);
CREATE INDEX "external_idempotency_expiry_idx" ON "external_idempotency" ("expires_at");
CREATE TABLE "external_rate_buckets" (
  "scope" varchar(128) NOT NULL,
  "bucket" timestamptz NOT NULL,
  "count" integer NOT NULL,
  CONSTRAINT "external_rate_buckets_scope_bucket_pk" PRIMARY KEY ("scope", "bucket")
);
