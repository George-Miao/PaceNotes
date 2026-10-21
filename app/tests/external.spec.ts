import { HocuspocusProvider } from "@hocuspocus/provider";
import { expect, test } from "@playwright/test";
import WebSocket from "ws";
import * as Y from "yjs";

// The test uses the real PostgreSQL database and the web process's shared Hocuspocus document.
test.skip(process.env.PACENOTES_EXTERNAL_ENABLED !== "true", "External access is disabled");

test("JSON-RPC creates once and reports browser edits by record ID", async ({
  request,
  baseURL,
}) => {
  test.setTimeout(60_000);
  if (!baseURL) throw new Error("A server base URL is required");
  const rpc = async (method: string, params: unknown, tripId?: string) => {
    const response = await request.post("/api/v1/rpc", {
      headers: tripId ? { Authorization: `Bearer ${tripId}` } : {},
      data: { jsonrpc: "2.0", id: 1, method, params },
    });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const create = {
    idempotencyKey: crypto.randomUUID().replaceAll("-", ""),
    startDate: "2027-11-07",
    endDate: "2027-11-08",
    destination: { placeId: "external-test-place" },
    timeZone: "America/New_York",
  };
  const first = await rpc("trip.create", create);
  const tripId: string = first.result.id;
  expect((await rpc("trip.create", create)).result.id).toBe(tripId);
  const item = {
    id: crypto.randomUUID(),
    type: "place",
    title: "Morning walk",
    details: "",
    dayId: "2027-11-07",
    startTime: "01:30",
    durationMinutes: 30,
    place: { placeId: "external-test-walk" },
    reservation: null,
    lodging: null,
    transport: null,
    travelMode: "WALKING",
  };
  const key = crypto.randomUUID().replaceAll("-", "");
  const ambiguous = await rpc("item.create", { idempotencyKey: key, item }, tripId);
  expect(ambiguous.error.code).toBe(-32602);
  expect(ambiguous.error.data.offsets).toEqual(["-04:00", "-05:00"]);
  const created = await rpc(
    "item.create",
    { idempotencyKey: key, item, timeChoice: "later" },
    tripId,
  );
  expect(created.result.record.timeChoice).toBe("later");
  expect(
    (await rpc("item.create", { idempotencyKey: key, item, timeChoice: "later" }, tripId)).result
      .record.id,
  ).toBe(item.id);

  const webSocketUrl = new URL("/api/v1/ws", baseURL);
  webSocketUrl.protocol = webSocketUrl.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(webSocketUrl, { headers: { Authorization: `Bearer ${tripId}` } });
  const document = new Y.Doc();
  let provider: HocuspocusProvider | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const notice = new Promise<unknown>((resolve, reject) => {
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.method === "trip.changed" && message.params.items.includes(item.id))
          resolve(message.params);
      });
      socket.once("error", reject);
    });
    const syncUrl = new URL("/sync", baseURL);
    syncUrl.protocol = syncUrl.protocol === "https:" ? "wss:" : "ws:";
    provider = new HocuspocusProvider({ url: syncUrl.toString(), name: tripId, document });
    await new Promise<void>((resolve, reject) => {
      provider?.on("synced", resolve);
      provider?.on("authenticationFailed", reject);
    });
    const record = document.getMap<Y.Map<unknown>>("items").get(item.id);
    expect(record).toBeInstanceOf(Y.Map);
    record?.set("details", "Edited through the browser document");
    await expect(notice).resolves.toMatchObject({ items: [item.id] });
    await expect
      .poll(
        async () =>
          (await rpc("trip.read", { select: { kind: "item", id: item.id } }, tripId)).result.record
            .details,
      )
      .toBe("Edited through the browser document");
    const stale = await rpc(
      "item.update",
      { id: item.id, expected: created.result.version, patch: { title: "Stale title" } },
      tripId,
    );
    expect(stale.error.code).toBe(-32009);
    expect(stale.error.data.current.details).toBe("Edited through the browser document");
    const snapshot = await rpc("trip.read", { select: { kind: "snapshot" } }, tripId);
    const shifted = await rpc(
      "trip.setDates",
      {
        expected: snapshot.result.versions.trip,
        startDate: "2099-01-01",
        endDate: "2099-01-02",
      },
      tripId,
    );
    expect(shifted.result.record.startDate).toBe("2099-01-01");
    const after = await rpc("trip.read", { select: { kind: "item", id: item.id } }, tripId);
    expect(after.result.record.dayId).toBeNull();
  } finally {
    provider?.destroy();
    document.destroy();
    socket.close();
  }
});
