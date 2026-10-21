use crate::{Error, TripChange};

const MAX_EVENT_BYTES: usize = 1024 * 1024;

/// An incremental SSE decoder. Only `trip.changed` events contain public notices.
#[derive(Default)]
pub(crate) struct Decoder {
    line: Vec<u8>,
    event: Vec<u8>,
    data: Vec<u8>,
}

impl Decoder {
    pub fn push(
        &mut self,
        bytes: &[u8],
        on_change: &mut impl FnMut(TripChange),
    ) -> Result<(), Error> {
        for &byte in bytes {
            if byte == b'\n' {
                self.finish_line(on_change)?;
            } else {
                self.line.push(byte);
                if self.line.len() > MAX_EVENT_BYTES {
                    return Err(Error::Protocol("SSE line is too large"));
                }
            }
        }
        Ok(())
    }

    fn finish_line(&mut self, on_change: &mut impl FnMut(TripChange)) -> Result<(), Error> {
        let line = self.line.strip_suffix(b"\r").unwrap_or(&self.line);
        if line.is_empty() {
            if self.event == b"trip.changed" && !self.data.is_empty() {
                on_change(serde_json::from_slice(&self.data)?);
            }
            self.event.clear();
            self.data.clear();
        } else if !line.starts_with(b":") {
            let (field, value) = match line.iter().position(|byte| *byte == b':') {
                Some(index) => (&line[..index], &line[index + 1..]),
                None => (line, &b""[..]),
            };
            let value = value.strip_prefix(b" ").unwrap_or(value);
            match field {
                b"event" => {
                    self.event.clear();
                    self.event.extend_from_slice(value);
                }
                b"data" => {
                    if !self.data.is_empty() {
                        self.data.push(b'\n');
                    }
                    self.data.extend_from_slice(value);
                }
                _ => {}
            }
            if self.event.len() + self.data.len() > MAX_EVENT_BYTES {
                return Err(Error::Protocol("SSE event is too large"));
            }
        }
        self.line.clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notices_survive_chunk_boundaries_and_ignore_other_events() {
        let mut decoder = Decoder::default();
        let mut noticed = Vec::new();
        decoder.push(b":keepalive\r\nevent: trip.changed\r\ndata: {\"trip\":false,\"order\":true,\"items\":[\"a\"],\"tripmates\":[],\"expenses\":[],\"payments\":[]}\r", &mut |change| noticed.push(change)).unwrap();
        assert!(noticed.is_empty());
        decoder
            .push(b"\n\r\nevent: other\ndata: {}\n\n", &mut |change| {
                noticed.push(change)
            })
            .unwrap();
        assert_eq!(noticed.len(), 1);
        assert!(noticed[0].order);
        assert_eq!(noticed[0].items, ["a"]);
    }
}
