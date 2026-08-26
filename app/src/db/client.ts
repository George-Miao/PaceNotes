import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

export const sql = postgres(connectionString, {
  max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(sql, { schema });
