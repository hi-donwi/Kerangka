use crate::error::KerangkaError;
use crate::models::{ActionResult, Actor};
use serde_json::json;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};

/// Client to drive Kerangka applications via the `kerangka serve --stdio` JSON-RPC sidecar process.
pub struct SidecarClient {
    child: Child,
    request_id: u64,
}

impl SidecarClient {
    /// Spawns a sidecar process for the specified model file path.
    pub fn spawn(model_path: &str) -> Result<Self, KerangkaError> {
        let child = Command::new("kerangka")
            .arg("serve")
            .arg(model_path)
            .arg("--stdio")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;

        Ok(Self {
            child,
            request_id: 1,
        })
    }

    /// Executes an action against the model.
    pub fn run(
        &mut self,
        action: &str,
        record: serde_json::Value,
        actor: Option<&Actor>,
    ) -> Result<ActionResult, KerangkaError> {
        let mut params = json!({
            "action": action,
            "record": record,
        });

        if let Some(act) = actor {
            params["actor"] = serde_json::to_value(act)?;
        }

        let resp = self.send_request("run", params)?;

        if let Some(err) = resp.get("error") {
            let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
            let msg = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown sidecar error");
            return Err(KerangkaError::SidecarProtocol {
                code,
                message: msg.to_string(),
            });
        }

        let result: ActionResult = serde_json::from_value(
            resp.get("result").cloned().unwrap_or(serde_json::Value::Null),
        )?;

        Ok(result)
    }

    fn send_request(
        &mut self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, KerangkaError> {
        let id = self.request_id;
        self.request_id += 1;

        let req = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        let stdin = self.child.stdin.as_mut().ok_or_else(|| {
            KerangkaError::Generic("Sidecar stdin is not available".to_string())
        })?;

        let mut line = serde_json::to_string(&req)?;
        line.push('\n');
        stdin.write_all(line.as_bytes())?;
        stdin.flush()?;

        let stdout = self.child.stdout.as_mut().ok_or_else(|| {
            KerangkaError::Generic("Sidecar stdout is not available".to_string())
        })?;

        let mut reader = BufReader::new(stdout);
        let mut response_line = String::new();
        reader.read_line(&mut response_line)?;

        let response: serde_json::Value = serde_json::from_str(&response_line)?;
        Ok(response)
    }
}

impl Drop for SidecarClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}
