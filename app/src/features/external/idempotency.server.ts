import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type * as Y from "yjs";
import { sql } from "../../db/client";
import { readTripDocument } from "../collaboration/document";
import type { TripSnapshot } from "../trip/model";
import { ExternalError, externalResults } from "./contract";
import { canonical, version } from "./state.server";

type CreateMethod = "item.create" | "tripmate.create" | "expense.create" | "payment.create";
type Direct = { document: Y.Doc | null; transact: (fn: (doc: Y.Doc) => void) => Promise<void> };
type Receipt = { hash: string; recordId: string; response: unknown; expires: number };
type Pending = { state: "pending"; owner: string; recordId: string; leaseUntil: number };

function record(snapshot: TripSnapshot, method: CreateMethod, id: string): unknown {
  if (method === "item.create") return snapshot.items[id];
  if (method === "tripmate.create") return snapshot.friends[id];
  if (method === "expense.create") return snapshot.expenses[id];
  return snapshot.settlements[id];
}

function receiptKey(scope: string, method: string, key: string): string {
  return createHash("sha256").update(`${scope}:${method}:${key}`).digest("hex");
}

/** Commit a claim before changing Yjs. The receipt and the record share one Yjs transaction. */
export async function idempotentRecord<T>(
  method: CreateMethod,
  tripId: string,
  key: string,
  input: unknown,
  id: string,
  connection: Direct,
  prepare: () => Promise<(doc: Y.Doc, snapshot: TripSnapshot) => T>,
): Promise<T> {
  const scope = `trip:${tripId}`;
  const requestHash = createHash("sha256").update(canonical(input)).digest("hex");
  const marker = receiptKey(scope, method, key);
  const doc = connection.document;
  if (!doc) throw new ExternalError("NOT_FOUND", "Trip not found");
  const receipt = () => doc.getMap<Receipt>("externalIdempotency").get(marker);
  const inspect = () => record(readTripDocument(doc), method, id);
  let owner: string | null = null;
  for (;;) {
    const outcome = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${method}:${key}`}, 0))`;
      const rows = await tx`
        SELECT request_hash, response FROM external_idempotency
        WHERE scope = ${scope} AND method = ${method} AND key = ${key} AND expires_at > now()
      `;
      const row = rows[0];
      if (row && row.request_hash !== requestHash) {
        throw new ExternalError("CONFLICT", "The idempotency key was used with different input", {
          current: null,
          version: null,
        });
      }
      if (row) {
        const saved = row.response as Pending | T;
        if (
          !(saved && typeof saved === "object" && "state" in saved && saved.state === "pending")
        ) {
          return { state: "done" as const, value: saved as T };
        }
        if (saved.recordId !== id) {
          throw new ExternalError("CONFLICT", "The idempotency key belongs to another record", {
            current: null,
            version: null,
          });
        }
        if (saved.leaseUntil > Date.now()) return { state: "busy" as const };
      }
      const next: Pending = {
        state: "pending",
        owner: randomUUID(),
        recordId: id,
        leaseUntil: Date.now() + 30_000,
      };
      await tx`DELETE FROM external_idempotency WHERE scope = ${scope} AND method = ${method} AND key = ${key}`;
      await tx`
        INSERT INTO external_idempotency (scope, method, key, request_hash, response, expires_at)
        VALUES (${scope}, ${method}, ${key}, ${requestHash}, ${JSON.stringify(next)}::jsonb, now() + interval '24 hours')
      `;
      return { state: "claimed" as const, owner: next.owner };
    });
    if (outcome.state === "done") return outcome.value;
    if (outcome.state === "claimed") {
      owner = outcome.owner;
      break;
    }
    const prior = receipt();
    if (
      prior &&
      prior.expires > Date.now() &&
      prior.hash === requestHash &&
      prior.recordId === id
    ) {
      const replay = externalResults[method].parse(prior.response) as T;
      await sql`
        UPDATE external_idempotency SET response = ${JSON.stringify(replay)}::jsonb
        WHERE scope = ${scope} AND method = ${method} AND key = ${key} AND request_hash = ${requestHash}
          AND response->>'state' = 'pending'
      `;
      return replay;
    }
    await delay(100);
  }

  let attemptedMutation = false;
  try {
    const prior = receipt();
    let response: T;
    if (
      prior &&
      prior.expires > Date.now() &&
      prior.hash === requestHash &&
      prior.recordId === id
    ) {
      response = externalResults[method].parse(prior.response) as T;
    } else {
      const existing = inspect();
      if (existing !== undefined) {
        throw new ExternalError("CONFLICT", "Record exists without a matching creation receipt", {
          current: existing,
          version: version(existing),
        });
      }
      const action = await prepare();
      let created!: T;
      attemptedMutation = true;
      await connection.transact((live) => {
        const current = readTripDocument(live);
        const savedReceipt = live.getMap<Receipt>("externalIdempotency").get(marker);
        if (
          savedReceipt &&
          savedReceipt.expires > Date.now() &&
          savedReceipt.hash === requestHash &&
          savedReceipt.recordId === id
        ) {
          created = externalResults[method].parse(savedReceipt.response) as T;
          return;
        }
        const result = action(live, current);
        created = externalResults[method].parse(result) as T;
        live.getMap<Receipt>("externalIdempotency").set(marker, {
          hash: requestHash,
          recordId: id,
          response: created,
          expires: Date.now() + 86_400_000,
        });
        if (Math.random() < 0.01) {
          const receipts = live.getMap<Receipt>("externalIdempotency");
          const now = Date.now();
          for (const [receiptId, value] of receipts.entries()) {
            if (value.expires < now) receipts.delete(receiptId);
          }
        }
      });
      response = created;
    }
    // If this update fails, a retry recovers the response from the live Yjs receipt.
    await sql`
      UPDATE external_idempotency SET response = ${JSON.stringify(response)}::jsonb
      WHERE scope = ${scope} AND method = ${method} AND key = ${key}
        AND request_hash = ${requestHash} AND response->>'owner' = ${owner}
    `;
    return response;
  } catch (error) {
    // A failed preflight can release its claim. Never erase a claim for an applied record.
    if (!attemptedMutation || (!receipt() && inspect() === undefined)) {
      await sql`
        DELETE FROM external_idempotency WHERE scope = ${scope} AND method = ${method} AND key = ${key}
          AND request_hash = ${requestHash} AND response->>'owner' = ${owner}
      `;
    }
    throw error;
  }
}
