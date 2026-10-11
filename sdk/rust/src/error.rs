use thiserror::Error;

#[derive(Debug, Error)]
pub enum KerangkaError {
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Sidecar protocol error ({code}): {message}")]
    SidecarProtocol { code: i64, message: String },

    #[error("Action refused ({code}): {message}")]
    ActionRefused { code: String, message: String },

    #[error("Unknown error: {0}")]
    Generic(String),
}
