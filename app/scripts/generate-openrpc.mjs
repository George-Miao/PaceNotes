import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  externalMethods,
  externalResults,
  externalVersion,
  tripChangeSchema,
} from "../src/features/external/contract";

const tripId = "AbCdEfGhIjKlMnOpQrStUvWx";
const recordVersion = "a".repeat(64);
const examples = {
  "trip.create": {
    params: {
      idempotencyKey: "create-trip-example-01",
      startDate: "2026-08-10",
      endDate: "2026-08-12",
      destination: { placeId: "ChIJexample" },
    },
    result: { id: tripId, url: `https://example.test/trips/${tripId}` },
  },
  "place.search": {
    params: { query: "Kyoto Station" },
    result: {
      places: [
        { placeId: "ChIJexample", displayName: "Kyoto Station", formattedAddress: "Kyoto, Japan" },
      ],
    },
  },
  "item.reorder": {
    params: { expected: recordVersion, order: ["example-item"] },
    result: { order: ["example-item"], version: recordVersion },
  },
};

const errors = [
  {
    code: -32602,
    message: "INVALID_PARAMS",
    "x-data-schema": {
      type: "object",
      properties: {
        issues: { type: "array", items: { type: "object" } },
        offsets: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
      },
    },
  },
  { code: -32003, message: "FORBIDDEN" },
  { code: -32004, message: "NOT_FOUND" },
  {
    code: -32009,
    message: "CONFLICT",
    "x-data-schema": {
      type: "object",
      properties: {
        current: { type: ["object", "array", "null"] },
        version: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" },
      },
      required: ["current", "version"],
    },
  },
  {
    code: -32029,
    message: "RATE_LIMIT",
    "x-data-schema": { type: "object", properties: { retryAfterSeconds: { type: "integer" } } },
  },
  { code: -32052, message: "PROVIDER_UNAVAILABLE" },
];

const schemaOptions = { target: "draft-7" };
const methods = Object.entries(externalMethods).map(([name, schema]) => {
  const sample = examples[name];
  if (sample) {
    schema.parse(sample.params);
    externalResults[name].parse(sample.result);
  }
  const wire = z.toJSONSchema(schema, schemaOptions);
  const required = new Set(wire.required ?? []);
  if (wire.type !== "object" || !wire.properties) throw new Error(`Invalid wire method: ${name}`);
  const params = Object.entries(wire.properties).map(([field, property]) => ({
    name: field,
    required: required.has(field),
    schema: property,
  }));
  return {
    name,
    summary: `PaceNotes ${name}`,
    paramStructure: "by-name",
    "x-requires-trip": name !== "trip.create" && name !== "place.search",
    params,
    "x-params-schema": wire,
    result: { name: "result", schema: z.toJSONSchema(externalResults[name], schemaOptions) },
    errors,
    ...(sample
      ? {
          examples: [
            {
              name: `${name} example`,
              params: Object.entries(sample.params).map(([field, value]) => ({
                name: field,
                value,
              })),
              result: { name: "result", value: sample.result },
            },
          ],
        }
      : {}),
  };
});

const path = new URL("../openrpc.json", import.meta.url);
const document = `${JSON.stringify(
  {
    openrpc: "1.3.2",
    info: { title: "PaceNotes JSON-RPC", version: `${externalVersion}.0.0` },
    servers: [{ url: "/api/v1/rpc", name: "Version 1 HTTP JSON-RPC" }],
    "x-authorization":
      "For trip methods, send Authorization: Bearer <tripId>. The trip ID grants edit access.",
    methods,
    components: { schemas: { TripChange: z.toJSONSchema(tripChangeSchema, schemaOptions) } },
    "x-events": {
      sse: "/api/v1/events",
      websocket: "/api/v1/ws",
      method: "trip.changed",
      schema: "#/components/schemas/TripChange",
    },
  },
  null,
  2,
)}\n`;

if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8")) !== document) {
    throw new Error("OpenRPC contract is out of date");
  }
} else {
  await writeFile(path, document);
}
