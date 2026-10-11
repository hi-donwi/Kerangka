//! Official Kerangka Rust SDK
//!
//! Specification Version: 0.1
//! License: Apache-2.0
//!
//! Provides idiomatic Rust bindings to execute Kerangka applications via the
//! standard JSON-RPC Sidecar protocol, load compiled KIR documents, and model
//! domain entities.

pub mod error;
pub mod models;
pub mod sidecar;

pub use error::KerangkaError;
pub use models::{ActionResult, Actor};
pub use sidecar::SidecarClient;
