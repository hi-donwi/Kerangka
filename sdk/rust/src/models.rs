use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionResult {
    pub ok: bool,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub record: Option<serde_json::Value>,
    #[serde(default)]
    pub events: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Actor {
    pub id: String,
    #[serde(default)]
    pub roles: Vec<String>,
    #[serde(default)]
    pub tenant: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_action_result_deserialization() {
        let json_str = r#"{"ok":true,"action":"create","record":{"id":"123"}}"#;
        let res: ActionResult = serde_json::from_str(json_str).expect("Valid JSON");
        assert!(res.ok);
        assert_eq!(res.action.as_deref(), Some("create"));
    }

    #[test]
    fn test_actor_serialization() {
        let actor = Actor {
            id: "user_1".to_string(),
            roles: vec!["admin".to_string()],
            tenant: Some("acme".to_string()),
        };
        let val = serde_json::to_value(&actor).expect("Valid Actor serialization");
        assert_eq!(val["id"], "user_1");
        assert_eq!(val["roles"][0], "admin");
    }
}
