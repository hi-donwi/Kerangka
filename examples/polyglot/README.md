# Polyglot Task Hub Showcase

This showcase demonstrates **Kerangka**'s single source of truth architecture: **One JSON skeleton. Every stack.**

A single declarative model ([`kerangka.json`](./kerangka.json)) powers:
- Strongly-typed models in **Rust**, **Go**, **Python**, and **Dart**.
- Schema-driven user interface screens projected in **UIDL** format.
- Instant stack switching across backends and frontends using `kerangka switch`.

---

## Directory Structure

```
examples/polyglot/
├── kerangka.json           # Single Source of Truth specification
├── docker-compose.yml       # Infrastructure (PostgreSQL 16 & Valkey 8)
├── backend-rust/            # Rust Axum/Sidecar service & generated models (models.rs)
├── backend-go/              # Go service & generated models (models.go)
├── backend-python/          # Python FastAPI service & generated models (models.py)
├── frontend-screens/        # Projected UIDL screens (task-list, task-form)
├── frontend-react/          # React web client powered by @hi-donwi/uidl-runtime
└── frontend-flutter/        # Flutter mobile client powered by uidl_flutter & models.dart
```

---

## Running the Showcase

### 1. Start Infrastructure
```bash
docker compose up -d
```

### 2. Choose Your Backend
You can run whichever backend you prefer:

#### Run Rust Backend
```bash
cd backend-rust
cargo run
```

#### Run Go Backend
```bash
cd backend-go
go run main.go
```

#### Run Python Backend
```bash
cd backend-python
pip install -r requirements.txt
python main.py
```

---

## Switching Stacks with the CLI

To switch or regenerate backends directly from the root model:

```bash
# Switch to Rust
kerangka switch backend rust

# Switch to Go
kerangka switch backend go

# Switch to Python
kerangka switch backend python

# Switch frontend between React and Flutter
kerangka switch frontend flutter
kerangka switch frontend react
```

---

## UI Runtimes

Both **React** and **Flutter** render the exact same declarative UIDL screens located in `frontend-screens/`:
- In React: `<UIDocumentRenderer document={taskListScreen} />` from `@hi-donwi/uidl-runtime`.
- In Flutter: `UIDLScreen(assetPath: 'frontend-screens/task-list.uidl.json')` from `uidl_flutter`.
