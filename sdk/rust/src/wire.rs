use std::fmt;

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use url::Url;

use crate::{Method, TripChange};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RpcCode {
    InvalidParams,
    Forbidden,
    NotFound,
    Conflict,
    RateLimit,
    ProviderUnavailable,
    Other(i32),
}

impl From<i32> for RpcCode {
    fn from(code: i32) -> Self {
        match code {
            -32602 => Self::InvalidParams,
            -32003 => Self::Forbidden,
            -32004 => Self::NotFound,
            -32009 => Self::Conflict,
            -32029 => Self::RateLimit,
            -32052 => Self::ProviderUnavailable,
            other => Self::Other(other),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

/// The conflict payload includes the server's current saved record, or null after deletion.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Conflict<T> {
    pub current: Option<T>,
    pub version: Option<String>,
}

impl RpcError {
    pub fn kind(&self) -> RpcCode {
        self.code.into()
    }

    /// Decode the conflict's current record as the affected method's record type.
    pub fn conflict<T: DeserializeOwned>(&self) -> Result<Option<Conflict<T>>, serde_json::Error> {
        if self.kind() != RpcCode::Conflict {
            return Ok(None);
        }
        self.data.clone().map(serde_json::from_value).transpose()
    }
}

#[derive(Debug)]
pub enum Error {
    Configuration(&'static str),
    Transport(&'static str),
    HttpStatus(u16),
    Protocol(&'static str),
    Codec(serde_json::Error),
    Rpc(RpcError),
    Disconnected,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Configuration(reason) => write!(f, "invalid client configuration: {reason}"),
            Self::Transport(reason) => write!(f, "transport failure: {reason}"),
            Self::HttpStatus(status) => write!(f, "HTTP status {status}"),
            Self::Protocol(reason) => write!(f, "invalid JSON-RPC response: {reason}"),
            Self::Codec(source) => write!(f, "JSON encoding error: {source}"),
            Self::Rpc(error) => write!(f, "JSON-RPC error {}: {}", error.code, error.message),
            Self::Disconnected => f.write_str("event stream ended"),
        }
    }
}
impl std::error::Error for Error {}
impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::Codec(error)
    }
}

#[derive(Serialize)]
struct Request<'a, P: Serialize> {
    jsonrpc: &'static str,
    id: u64,
    method: &'static str,
    params: &'a P,
}

pub(crate) fn request<M: Method>(id: u64, params: &M::Params) -> Result<Vec<u8>, Error> {
    Ok(serde_json::to_vec(&Request {
        jsonrpc: "2.0",
        id,
        method: M::NAME,
        params,
    })?)
}

#[derive(Deserialize)]
struct Response<'a, T> {
    jsonrpc: &'a str,
    id: u64,
    result: Option<T>,
    error: Option<RpcError>,
}

pub(crate) fn response<T: DeserializeOwned>(id: u64, body: &[u8]) -> Result<T, Error> {
    let decoded: Response<'_, T> = serde_json::from_slice(body)?;
    if decoded.jsonrpc != "2.0" || decoded.id != id {
        return Err(Error::Protocol("JSON-RPC version or request ID mismatch"));
    }
    if let Some(error) = decoded.error {
        if decoded.result.is_some() {
            return Err(Error::Protocol("response has both a result and an error"));
        }
        return Err(Error::Rpc(error));
    }
    decoded
        .result
        .ok_or(Error::Protocol("response has no result"))
}

#[derive(Deserialize)]
struct NoticeHint<'a> {
    method: Option<&'a str>,
}

pub(crate) fn is_notice(body: &[u8]) -> Result<bool, Error> {
    let hint: NoticeHint<'_> = serde_json::from_slice(body)?;
    Ok(hint.method.is_some())
}

#[derive(Deserialize)]
struct Notice<'a> {
    jsonrpc: &'a str,
    method: &'a str,
    params: TripChange,
}

pub(crate) fn notice(body: &[u8]) -> Result<TripChange, Error> {
    let notice: Notice<'_> = serde_json::from_slice(body)?;
    if notice.jsonrpc != "2.0" || notice.method != "trip.changed" {
        return Err(Error::Protocol("unexpected WebSocket notification"));
    }
    Ok(notice.params)
}

pub(crate) struct Endpoints {
    pub rpc: Url,
    pub events: Url,
    pub ws: Url,
}

impl Endpoints {
    pub fn new(base: &str) -> Result<Self, Error> {
        let root = Url::parse(base).map_err(|_| Error::Configuration("base URL is invalid"))?;
        if !matches!(root.scheme(), "http" | "https")
            || root.host_str().is_none()
            || root.path() != "/"
            || !root.username().is_empty()
            || root.password().is_some()
            || root.query().is_some()
            || root.fragment().is_some()
        {
            return Err(Error::Configuration(
                "base URL must be an HTTP origin without credentials",
            ));
        }
        let rpc = root
            .join("/api/v1/rpc")
            .map_err(|_| Error::Configuration("RPC URL is invalid"))?;
        let events = root
            .join("/api/v1/events")
            .map_err(|_| Error::Configuration("events URL is invalid"))?;
        let mut ws = root
            .join("/api/v1/ws")
            .map_err(|_| Error::Configuration("WebSocket URL is invalid"))?;
        let scheme = if root.scheme() == "https" {
            "wss"
        } else {
            "ws"
        };
        ws.set_scheme(scheme)
            .map_err(|_| Error::Configuration("WebSocket URL is invalid"))?;
        Ok(Self { rpc, events, ws })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PlaceReference, TripCreate, TripCreateParams};

    #[test]
    fn full_request_uses_named_wire_fields() {
        let params = TripCreateParams {
            idempotency_key: "create-trip-example-01".into(),
            title: Some("April".into()),
            start_date: "2026-04-01".into(),
            end_date: "2026-04-04".into(),
            destination: PlaceReference {
                place_id: "abc".into(),
            },
            time_zone: Some("Europe/Paris".into()),
        };
        let actual: Value =
            serde_json::from_slice(&request::<TripCreate>(7, &params).unwrap()).unwrap();
        assert_eq!(
            actual,
            serde_json::json!({
                "jsonrpc": "2.0", "id": 7, "method": "trip.create", "params": {
                    "idempotencyKey": "create-trip-example-01", "title": "April", "startDate": "2026-04-01",
                    "endDate": "2026-04-04", "destination": {"placeId": "abc"}, "timeZone": "Europe/Paris"
                }
            })
        );
    }

    #[test]
    fn conflict_keeps_current_record_and_version() {
        let version = "a".repeat(64);
        let body = format!(
            r#"{{"jsonrpc":"2.0","id":3,"error":{{"code":-32009,"message":"Conflict","data":{{"current":{{"id":"a"}},"version":"{version}"}}}}}}"#
        );
        let error = response::<Value>(3, body.as_bytes()).unwrap_err();
        let Error::Rpc(error) = error else {
            panic!("expected structured RPC error")
        };
        assert_eq!(error.kind(), RpcCode::Conflict);
        let conflict = error.conflict::<Value>().unwrap().unwrap();
        assert_eq!(conflict.current.unwrap()["id"], "a");
        assert_eq!(conflict.version.as_deref(), Some(version.as_str()));
    }
}
