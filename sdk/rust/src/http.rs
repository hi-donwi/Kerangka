use crate::error::KerangkaError;
use crate::models::{ActionResult, Actor};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// HTTP REST client to interact with a running Kerangka server.
pub struct HttpClient {
    base_url: String,
    timeout: Duration,
}

impl HttpClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            timeout: Duration::from_secs(10),
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Invokes an action on a model over the HTTP API.
    pub fn run_action(
        &self,
        action: &str,
        record: serde_json::Value,
        actor: Option<&Actor>,
    ) -> Result<ActionResult, KerangkaError> {
        let path = format!("/api/actions/{}", action);
        let mut body = json!({
            "record": record,
        });

        if let Some(act) = actor {
            body["actor"] = serde_json::to_value(act)?;
        }

        let resp_body = self.post_json(&path, &body)?;
        let result: ActionResult = serde_json::from_str(&resp_body)?;
        Ok(result)
    }

    fn post_json(&self, path: &str, body: &serde_json::Value) -> Result<String, KerangkaError> {
        let url_no_scheme = self
            .base_url
            .trim_start_matches("http://")
            .trim_start_matches("https://");
        let parts: Vec<&str> = url_no_scheme.split(':').collect();
        let host = parts.first().unwrap_or(&"localhost");
        let port: u16 = if parts.len() > 1 {
            parts[1].parse().unwrap_or(80)
        } else {
            80
        };

        let addr = format!("{}:{}", host, port);
        let mut stream = TcpStream::connect(&addr)
            .map_err(|e| KerangkaError::Generic(format!("Failed to connect to {}: {}", addr, e)))?;
        stream.set_read_timeout(Some(self.timeout))?;
        stream.set_write_timeout(Some(self.timeout))?;

        let body_str = serde_json::to_string(body)?;
        let request = format!(
            "POST {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            path, host, body_str.len(), body_str
        );

        stream.write_all(request.as_bytes())?;
        stream.flush()?;

        let mut response = String::new();
        stream.read_to_string(&mut response)?;

        if let Some(pos) = response.find("\r\n\r\n") {
            Ok(response[(pos + 4)..].to_string())
        } else {
            Ok(response)
        }
    }
}
