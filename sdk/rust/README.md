# Rust SDK

This source-only crate speaks PaceNotes JSON-RPC v1. It has two separate async clients with shared wire types. It does not retry writes or keep a local trip snapshot. Do not put a trip ID in a URL, a log, or source code. Set `PACENOTES_URL` and `PACENOTES_TRIP_ID` in the client process. Use HTTPS outside a local machine.

Add one backend to your Cargo dependencies:

```toml
pacenotes = { path = "../sdk/rust", default-features = false, features = ["reqwest"] }
```

Use `features = ["cyper"]` for the Cyper and Compio client instead. Add `compio-runtime = "0.12.6"` to the application for that client. The `cyper` feature selects Compio's polling driver, which works without Linux io_uring access. The application owns the runtime.

## Tokio and reqwest

```rust
use pacenotes::{ReadResult, ReadSelector, ReqwestClient, TripReadParams};

async fn read_trip() -> Result<(), Box<dyn std::error::Error>> {
    let base = std::env::var("PACENOTES_URL")?;
    let trip_id = std::env::var("PACENOTES_TRIP_ID")?;
    let client = ReqwestClient::new(&base, Some(trip_id))?;
    let read = client.trip_read(TripReadParams { select: ReadSelector::Snapshot }).await?;
    if let ReadResult::Snapshot { snapshot, .. } = read {
        println!("Trip has {} days", snapshot.days.len());
    }
    Ok(())
}
```

A native WebSocket can call the same typed methods with `socket.call::<TripRead>(params).await?`. Use `socket.next_notice().await?` for changed IDs. `client.subscribe(callback).await` reads SSE notices. A stream has no replay. After a disconnect, read a new snapshot before listening again. A create needs a new idempotency key from the caller; only reuse the same key for an exact retry.

## Compio and Cyper

```rust
use pacenotes::{CyperClient, ReadSelector, TripReadParams};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let base = std::env::var("PACENOTES_URL")?;
    let trip_id = std::env::var("PACENOTES_TRIP_ID")?;
    compio_runtime::Runtime::new()?.block_on(async {
        let client = CyperClient::new(&base, Some(trip_id))?;
        let read = client.trip_read(TripReadParams { select: ReadSelector::Snapshot }).await?;
        println!("Read kind: {:?}", read);
        Ok(())
    })
}
```

The Cyper client also has `subscribe`, `websocket`, `socket.call::<Method>`, and `socket.next_notice`. Select only one backend feature for a small dependency graph. Use a client with `None` as its trip ID for `trip.create` or `place.search`.

Run the isolated backend checks:

```sh
cargo test --manifest-path sdk/rust/Cargo.toml --no-default-features --features reqwest
cargo test --manifest-path sdk/rust/Cargo.toml --no-default-features --features cyper
```

Read [external API and MCP](../../docs/external-api.md) for versions, errors, and security rules. The source OpenRPC contract is `app/openrpc.json`.
