//! Tokio backend: reqwest HTTP and SSE; tokio-tungstenite WebSocket.

use std::{
    collections::VecDeque,
    sync::atomic::{AtomicU64, Ordering},
};

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::{
    Message, client::IntoClientRequest, http::header::AUTHORIZATION,
};

use crate::{sse::Decoder, wire, *};

pub struct Client {
    endpoints: wire::Endpoints,
    trip_id: Option<String>,
    http: reqwest::Client,
    next_id: AtomicU64,
}

impl Client {
    /// Set `trip_id` to None for the public create and place search methods.
    /// Keep the trip ID private. This type does not print it in Debug output.
    pub fn new(base_url: &str, trip_id: Option<String>) -> Result<Self, Error> {
        Ok(Self {
            endpoints: wire::Endpoints::new(base_url)?,
            trip_id,
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| Error::Transport("HTTP client initialization failed"))?,
            next_id: AtomicU64::new(1),
        })
    }

    pub async fn call<M: Method>(&self, params: M::Params) -> Result<M::Result, Error> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = wire::request::<M>(id, &params)?;
        let mut send = self
            .http
            .post(self.endpoints.rpc.clone())
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(request);
        if let Some(token) = &self.trip_id {
            send = send.bearer_auth(token);
        }
        let reply = send
            .send()
            .await
            .map_err(|_| Error::Transport("HTTP request failed"))?;
        let status = reply.status();
        let body = reply
            .bytes()
            .await
            .map_err(|_| Error::Transport("HTTP response failed"))?;
        // JSON-RPC errors retain their codes, data, and current conflict records.
        match wire::response(id, &body) {
            Err(Error::Codec(_)) if !status.is_success() => Err(Error::HttpStatus(status.as_u16())),
            result => result,
        }
    }

    client_methods!();

    /// Consume SSE notices until the peer closes or the caller cancels this future.
    /// After reconnect, call `trip.read`; notices do not carry full records or replay.
    pub async fn subscribe(&self, mut on_change: impl FnMut(TripChange)) -> Result<(), Error> {
        let token = self
            .trip_id
            .as_ref()
            .ok_or(Error::Configuration("trip ID is required for events"))?;
        let reply = self
            .http
            .get(self.endpoints.events.clone())
            .bearer_auth(token)
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .send()
            .await
            .map_err(|_| Error::Transport("SSE connection failed"))?;
        if !reply.status().is_success() {
            return Err(Error::HttpStatus(reply.status().as_u16()));
        }
        let mut decoder = Decoder::default();
        let mut stream = reply.bytes_stream();
        while let Some(chunk) = stream.next().await {
            decoder.push(
                &chunk.map_err(|_| Error::Transport("SSE stream failed"))?,
                &mut on_change,
            )?;
        }
        Err(Error::Disconnected)
    }

    /// Connect a native JSON-RPC WebSocket with the same trip identity as HTTP calls.
    pub async fn websocket(&self) -> Result<Socket, Error> {
        let mut request = self
            .endpoints
            .ws
            .as_str()
            .into_client_request()
            .map_err(|_| Error::Configuration("WebSocket URL is invalid"))?;
        if let Some(token) = &self.trip_id {
            let value = format!("Bearer {token}")
                .parse()
                .map_err(|_| Error::Configuration("trip ID is not a valid header value"))?;
            request.headers_mut().insert(AUTHORIZATION, value);
        }
        let (stream, _) = tokio_tungstenite::connect_async(request)
            .await
            .map_err(|_| Error::Transport("WebSocket connection failed"))?;
        Ok(Socket {
            stream,
            next_id: 1,
            notices: VecDeque::new(),
        })
    }
}

pub struct Socket {
    stream: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    next_id: u64,
    notices: VecDeque<TripChange>,
}

impl Socket {
    /// Calls use a single in-flight request per socket. Notices received during a call are queued.
    pub async fn call<M: Method>(&mut self, params: M::Params) -> Result<M::Result, Error> {
        let id = self.next_id;
        self.next_id += 1;
        let text = String::from_utf8(wire::request::<M>(id, &params)?)
            .map_err(|_| Error::Protocol("outgoing JSON is not UTF-8"))?;
        self.stream
            .send(Message::Text(text.into()))
            .await
            .map_err(|_| Error::Transport("WebSocket send failed"))?;
        loop {
            let frame = self.next_frame().await?.into_data();
            if wire::is_notice(&frame)? {
                self.notices.push_back(wire::notice(&frame)?);
            } else {
                return wire::response(id, &frame);
            }
        }
    }

    pub async fn next_notice(&mut self) -> Result<TripChange, Error> {
        if let Some(change) = self.notices.pop_front() {
            return Ok(change);
        }
        let frame = self.next_frame().await?.into_data();
        if wire::is_notice(&frame)? {
            wire::notice(&frame)
        } else {
            Err(Error::Protocol(
                "unexpected WebSocket response without a pending call",
            ))
        }
    }

    async fn next_frame(&mut self) -> Result<Message, Error> {
        loop {
            match self.stream.next().await {
                Some(Ok(frame @ (Message::Text(_) | Message::Binary(_)))) => return Ok(frame),
                Some(Ok(Message::Close(_))) | None => return Err(Error::Disconnected),
                Some(Ok(_)) => continue,
                Some(Err(_)) => return Err(Error::Transport("WebSocket receive failed")),
            }
        }
    }

    pub async fn close(mut self) -> Result<(), Error> {
        self.stream
            .close(None)
            .await
            .map_err(|_| Error::Transport("WebSocket close failed"))
    }
}
