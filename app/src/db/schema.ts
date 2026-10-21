import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const trips = pgTable("trips", {
  id: varchar("id", { length: 32 }).primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  startDate: varchar("start_date", { length: 10 }).notNull(),
  endDate: varchar("end_date", { length: 10 }).notNull(),
  destinationPlaceId: varchar("destination_place_id", { length: 255 }).notNull(),
  timeZone: varchar("time_zone", { length: 100 }).notNull(),
  state: varchar("state", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  name: varchar("name", { length: 32 })
    .primaryKey()
    .references(() => trips.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const creationEvents = pgTable(
  "creation_events",
  {
    id: text("id").primaryKey(),
    clientHash: varchar("client_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("creation_events_client_time_idx").on(table.clientHash, table.createdAt)],
);

export const externalIdempotency = pgTable(
  "external_idempotency",
  {
    scope: varchar("scope", { length: 128 }).notNull(),
    method: varchar("method", { length: 64 }).notNull(),
    key: varchar("key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    response: jsonb("response").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.method, table.key] }),
    index("external_idempotency_expiry_idx").on(table.expiresAt),
  ],
);

export const externalRateBuckets = pgTable(
  "external_rate_buckets",
  {
    scope: varchar("scope", { length: 128 }).notNull(),
    bucket: timestamp("bucket", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.bucket] })],
);

export const dataMigrations = pgTable("data_migrations", {
  id: text("id").primaryKey(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});
