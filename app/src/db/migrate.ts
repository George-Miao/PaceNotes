import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client.js";
import { sanitizeGooglePlaceDocument } from "./place-id-migration.js";
import { dataMigrations, documents } from "./schema.js";

await migrate(db, { migrationsFolder: process.env.MIGRATIONS_PATH ?? "./drizzle" });
await migrateGooglePlaceIds();

async function migrateGooglePlaceIds(): Promise<void> {
  const migrationId = "google-place-ids-v1";
  const [completed] = await db
    .select({ id: dataMigrations.id })
    .from(dataMigrations)
    .where(eq(dataMigrations.id, migrationId))
    .limit(1);
  if (completed) return;

  for (const row of await db.select().from(documents)) {
    const sanitized = sanitizeGooglePlaceDocument(row.data);
    if (!sanitized) continue;
    await db
      .update(documents)
      .set({ data: Buffer.from(sanitized), updatedAt: new Date() })
      .where(eq(documents.name, row.name));
  }
  await db.insert(dataMigrations).values({ id: migrationId });
}

await sql.end();
console.info(JSON.stringify({ event: "database_migrated" }));
