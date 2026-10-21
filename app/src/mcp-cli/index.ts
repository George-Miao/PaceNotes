#!/usr/bin/env bun
import { createInterface } from "node:readline";
import appPackage from "../../package.json" with { type: "json" };

type RpcMessage = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

if (process.argv.includes("--version")) {
  process.stdout.write(`${appPackage.version}\n`);
} else {
  const base = process.env.PACENOTES_MCP_BASE_URL;
  const tripId = process.env.PACENOTES_MCP_TRIP_ID;
  const bootstrap =
    process.env.PACENOTES_MCP_BOOTSTRAP === "1" || process.argv.includes("--bootstrap");
  if (!base || !!tripId === bootstrap || (tripId && !/^[A-Za-z0-9_-]{20,32}$/.test(tripId))) {
    process.stderr.write(
      "Set PACENOTES_MCP_BASE_URL and exactly one of PACENOTES_MCP_TRIP_ID or PACENOTES_MCP_BOOTSTRAP=1.\n",
    );
    process.exitCode = 2;
  } else {
    try {
      const parsed = new URL(base);
      if (
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        (parsed.protocol !== "https:" &&
          !(
            parsed.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
          ))
      ) {
        throw new Error("Invalid remote origin");
      }
      const prefix = parsed.pathname.replace(/\/$/, "");
      const endpoint = new URL(
        `${prefix}/mcp/v1/${bootstrap ? "bootstrap" : `trips/${tripId}`}`,
        parsed.origin,
      );
      runProxy(endpoint);
    } catch {
      process.stderr.write(
        "PACENOTES_MCP_BASE_URL must be an HTTPS base URL (HTTP is allowed for loopback).\n",
      );
      process.exitCode = 2;
    }
  }
}

function runProxy(endpoint: URL) {
  let version = "2026-07-28";
  let sessionId: string | null = null;
  let legacyNotifications: AbortController | undefined;
  const activeSubscriptions = new Map<string | number | null, AbortController>();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

  const headers = (message: RpcMessage): Headers => {
    const requestHeaders = new Headers({
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": version,
    });
    if (sessionId) requestHeaders.set("Mcp-Session-Id", sessionId);
    if (version === "2026-07-28" && message.method) {
      requestHeaders.set("Mcp-Method", message.method);
      const name =
        message.method === "tools/call"
          ? message.params?.name
          : message.method === "resources/read"
            ? message.params?.uri
            : undefined;
      if (typeof name === "string") {
        const safe =
          /^[\x20-\x7e]+$/.test(name) &&
          name.trim() === name &&
          !(name.startsWith("=?base64?") && name.endsWith("?="));
        requestHeaders.set(
          "Mcp-Name",
          safe ? name : `=?base64?${Buffer.from(name).toString("base64")}?=`,
        );
      }
    }
    return requestHeaders;
  };

  async function readEvents(response: Response, signal?: AbortSignal) {
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    let data: string[] = [];
    try {
      while (!signal?.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (!line) {
            if (data.length) {
              try {
                const message: unknown = JSON.parse(data.join("\n"));
                if (
                  message &&
                  typeof message === "object" &&
                  "jsonrpc" in message &&
                  message.jsonrpc === "2.0"
                )
                  send(message);
              } catch {
                /* Ignore a malformed event, not the stream. */
              }
              data = [];
            }
          } else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          newline = buffer.indexOf("\n");
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  async function startLegacyNotifications() {
    if (!sessionId || legacyNotifications) return;
    const abort = new AbortController();
    legacyNotifications = abort;
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          "MCP-Protocol-Version": "2025-11-25",
          "Mcp-Session-Id": sessionId,
        },
        signal: abort.signal,
      });
      if (response.ok && response.headers.get("content-type")?.includes("text/event-stream")) {
        await readEvents(response, abort.signal);
      }
    } catch {
      /* An unavailable notification stream does not block read tools. */
    } finally {
      if (legacyNotifications === abort) legacyNotifications = undefined;
    }
  }

  async function relay(message: RpcMessage) {
    if (message.method === "initialize" && message.params?.protocolVersion === "2025-11-25")
      version = "2025-11-25";
    else if (
      message.params?._meta &&
      typeof message.params._meta === "object" &&
      "io.modelcontextprotocol/protocolVersion" in message.params._meta &&
      typeof message.params._meta["io.modelcontextprotocol/protocolVersion"] === "string"
    ) {
      version = message.params._meta["io.modelcontextprotocol/protocolVersion"];
    }
    if (message.method === "notifications/cancelled") {
      const requested = message.params?.requestId;
      if (typeof requested === "number" || typeof requested === "string") {
        activeSubscriptions.get(requested)?.abort();
        activeSubscriptions.delete(requested);
      }
      return;
    }
    const abort = new AbortController();
    if (message.method === "subscriptions/listen" && message.id !== undefined) {
      activeSubscriptions.set(message.id, abort);
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: headers(message),
        body: JSON.stringify(message),
        signal: abort.signal,
      });
      if (message.method === "initialize" && response.headers.has("mcp-session-id")) {
        sessionId = response.headers.get("mcp-session-id");
      }
      if (response.status === 202) return;
      let succeeded = false;
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        await readEvents(response, abort.signal);
      } else {
        const raw: unknown = await response.json();
        if (raw && typeof raw === "object" && "jsonrpc" in raw && raw.jsonrpc === "2.0") {
          succeeded = "result" in raw;
          send(raw);
        } else throw new Error("Invalid remote MCP response");
      }
      if (message.method === "resources/subscribe" && succeeded && sessionId)
        void startLegacyNotifications();
      if (message.method === "resources/unsubscribe" && succeeded) {
        legacyNotifications?.abort();
        legacyNotifications = undefined;
      }
    } catch {
      if (!abort.signal.aborted && message.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32603, message: "Remote MCP request failed" },
        });
      }
    } finally {
      if (message.method === "subscriptions/listen") activeSubscriptions.delete(message.id ?? null);
    }
  }

  input.on("line", (line) => {
    try {
      const value: unknown = JSON.parse(line);
      if (
        !value ||
        typeof value !== "object" ||
        !("jsonrpc" in value) ||
        value.jsonrpc !== "2.0" ||
        !("method" in value) ||
        typeof value.method !== "string"
      ) {
        send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid JSON-RPC request" },
        });
        return;
      }
      void relay(value as RpcMessage);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } });
    }
  });
  input.on("close", () => {
    legacyNotifications?.abort();
    for (const abort of activeSubscriptions.values()) abort.abort();
  });
}
