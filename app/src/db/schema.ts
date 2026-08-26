import { customType, index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

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

export const dataMigrations = pgTable("data_migrations", {
  id: text("id").primaryKey(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});
