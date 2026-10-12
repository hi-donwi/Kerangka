/**
 * Kerangka CLI - Scaffold Command
 * Multi-stack starter and stack switcher scaffolding.
 * Specification Version: 0.1
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  compile,
  generateCode,
  generateUIDL,
  emitDockerCompose,
  type TargetLanguage
} from "@kerangka/compiler";
import { starterDocument } from "../starters.js";

export type BackendStack = "go" | "python" | "rust" | "node";
export type FrontendStack = "react" | "flutter";
export type DatabaseDialect = "sqlite" | "postgres";

export interface ScaffoldOptions {
  name?: string;
  output?: string;
  backend?: BackendStack;
  frontend?: FrontendStack;
  database?: DatabaseDialect;
}

export function scaffoldCommand(
  appName: string = "my-polyglot-app",
  options: ScaffoldOptions = {}
): boolean {
  try {
    const backend: BackendStack = (options.backend || "node").toLowerCase() as BackendStack;
    const frontend: FrontendStack = (options.frontend || "react").toLowerCase() as FrontendStack;
    const db: DatabaseDialect = (options.database || "sqlite").toLowerCase() as DatabaseDialect;
    const targetDir = path.resolve(process.cwd(), options.output || appName);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 1. Write the declarative source of truth model
    // The same model `kerangka init todo` writes: one catalog, two commands (ADR-0043).
    const model = starterDocument("todo", appName);
    const modelPath = path.join(targetDir, `${appName}.kerangka.json`);
    fs.writeFileSync(modelPath, JSON.stringify(model, null, 2) + "\n", "utf-8");

    // 2. Compile model to canonical KIR
    const kir = compile(JSON.stringify(model), { sourceFile: modelPath });

    // 3. Emit Docker Compose infrastructure
    const compose = emitDockerCompose(kir, { includePostgres: db === "postgres" });
    fs.writeFileSync(path.join(targetDir, "docker-compose.yml"), compose.yaml, "utf-8");


    // 4. Generate Backend
    scaffoldBackend(targetDir, kir, backend, db);

    // 5. Generate Frontend
    scaffoldFrontend(targetDir, kir, frontend);

    // 6. Write Root README with stack-switching instructions
    writeRootReadme(targetDir, appName, backend, frontend, db);

    console.log(`\nSuccessfully scaffolded polyglot project '${appName}' at: ${targetDir}`);
    console.log(`  Backend:  ${backend.toUpperCase()}`);
    console.log(`  Frontend: ${frontend.toUpperCase()}`);
    console.log(`  Database: ${db.toUpperCase()}`);
    console.log(`\nStack Switcher commands:`);
    console.log(`  Switch to Go backend:     npx kerangka codegen ${appName}.kerangka.json --target go -o backend/models.go`);
    console.log(`  Switch to Python backend: npx kerangka codegen ${appName}.kerangka.json --target python -o backend/models.py`);
    console.log(`  Switch to Rust backend:   npx kerangka codegen ${appName}.kerangka.json --target rust -o backend/models.rs`);
    console.log(`  Re-generate UIDL screens: npx kerangka uidl ${appName}.kerangka.json -o frontend/screens/`);
    console.log("");

    return true;
  } catch (err: any) {
    console.error(`Error scaffolding project: ${err.message}`);
    return false;
  }
}

export function scaffoldBackend(targetDir: string, kir: any, backend: BackendStack, db: DatabaseDialect): void {
  const backendDir = path.join(targetDir, "backend");
  fs.mkdirSync(backendDir, { recursive: true });

  switch (backend) {
    case "go": {
      const goCode = generateCode(kir, "go", { packageName: "model" });
      fs.writeFileSync(path.join(backendDir, "models.go"), goCode, "utf-8");
      fs.writeFileSync(
        path.join(backendDir, "go.mod"),
        `module ${kir.app}-backend\n\ngo 1.22\n\nrequire github.com/shopspring/decimal v1.4.0\n`,
        "utf-8"
      );
      fs.writeFileSync(
        path.join(backendDir, "main.go"),
        `package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, "{\\"status\\":\\"ok\\",\\"backend\\":\\"go\\"}")
	})

	fmt.Println("Kerangka Go backend listening on :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		panic(err)
	}
}
`,
        "utf-8"
      );
      break;
    }

    case "python": {
      const pyCode = generateCode(kir, "python");
      fs.writeFileSync(path.join(backendDir, "models.py"), pyCode, "utf-8");
      fs.writeFileSync(
        path.join(backendDir, "requirements.txt"),
        "fastapi>=0.110.0\nuvicorn>=0.28.0\npydantic>=2.6.0\n",
        "utf-8"
      );
      fs.writeFileSync(
        path.join(backendDir, "main.py"),
        `from fastapi import FastAPI
from models import Task

app = FastAPI(title="${kir.app} API")

@app.get("/api/health")
def health():
    return {"status": "ok", "backend": "python"}
`,
        "utf-8"
      );
      break;
    }

    case "rust": {
      const rustCode = generateCode(kir, "rust");
      const srcDir = path.join(backendDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "models.rs"), rustCode, "utf-8");
      fs.writeFileSync(
        path.join(backendDir, "Cargo.toml"),
        `[package]
name = "${kir.app}-backend"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.0", features = ["full"] }
axum = "0.7"
`,
        "utf-8"
      );
      fs.writeFileSync(
        path.join(srcDir, "main.rs"),
        `mod models;

use axum::{routing::get, Json, Router};
use serde_json::json;

#[tokio::main]
async fn main() {
    let app = Router::new().route("/api/health", get(|| async {
        Json(json!({ "status": "ok", "backend": "rust" }))
    }));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    println!("Kerangka Rust backend listening on 0.0.0.0:8080");
    axum::serve(listener, app).await.unwrap();
}
`,
        "utf-8"
      );
      break;
    }

    case "node":
    default: {
      const tsCode = generateCode(kir, "ts");
      fs.writeFileSync(path.join(backendDir, "models.ts"), tsCode, "utf-8");
      fs.writeFileSync(
        path.join(backendDir, "package.json"),
        JSON.stringify(
          {
            name: `${kir.app}-backend`,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "tsx server.ts"
            },
            dependencies: {
              "@kerangka/server": "workspace:*",
              "@kerangka/adapter-hono": "workspace:*"
            }
          },
          null,
          2
        ),
        "utf-8"
      );
      fs.writeFileSync(
        path.join(backendDir, "server.ts"),
        `import { Hono } from "hono";

const app = new Hono();
app.get("/api/health", (c) => c.json({ status: "ok", backend: "node" }));

export default app;
`,
        "utf-8"
      );
      break;
    }
  }
}

export function scaffoldFrontend(targetDir: string, kir: any, frontend: FrontendStack): void {
  const frontendDir = path.join(targetDir, "frontend");
  fs.mkdirSync(frontendDir, { recursive: true });

  // Generate UIDL screens
  const screensDir = path.join(frontendDir, "screens");
  fs.mkdirSync(screensDir, { recursive: true });
  const uidlDocs = generateUIDL(kir);
  for (const [docId, doc] of Object.entries(uidlDocs)) {
    fs.writeFileSync(path.join(screensDir, `${docId}.uidl.json`), JSON.stringify(doc, null, 2) + "\n", "utf-8");
  }

  if (frontend === "react") {
    const srcDir = path.join(frontendDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(frontendDir, "package.json"),
      JSON.stringify(
        {
          name: `${kir.app}-frontend`,
          version: "0.1.0",
          private: true,
          dependencies: {
            "react": "^18.3.1",
            "react-dom": "^18.3.1",
            "@hi-donwi/uidl-runtime": "^0.1.0"
          }
        },
        null,
        2
      ),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `import React from "react";
import { UIDocumentRenderer } from "@hi-donwi/uidl-runtime";
import taskListScreen from "../screens/task-list.uidl.json";

export function App() {
  return (
    <div className="app-container">
      <UIDocumentRenderer document={taskListScreen as any} />
    </div>
  );
}
`,
      "utf-8"
    );

  } else {
    // Flutter
    fs.writeFileSync(
      path.join(frontendDir, "pubspec.yaml"),
      `name: ${kir.app}_frontend
description: UIDL Flutter Application
version: 0.1.0

environment:
  sdk: ">=3.0.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter
  uidl_flutter: ^0.1.4

flutter:
  assets:
    - screens/
`,
      "utf-8"
    );

    const libDir = path.join(frontendDir, "lib");
    fs.mkdirSync(libDir, { recursive: true });

    // Generate typed Dart domain models
    const dartCode = generateCode(kir, "dart");
    fs.writeFileSync(path.join(libDir, "models.dart"), dartCode, "utf-8");

    // Generate Flutter entrypoint
    fs.writeFileSync(
      path.join(libDir, "main.dart"),
      `import 'package:flutter/material.dart';
import 'package:uidl_flutter/uidl_flutter.dart';
import 'models.dart';

void main() {
  runApp(const PolyglotApp());
}

class PolyglotApp extends StatelessWidget {
  const PolyglotApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${kir.app}',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      home: const Scaffold(
        body: SafeArea(
          child: UIDLScreen(assetPath: 'screens/task-list.uidl.json'),
        ),
      ),
    );
  }
}
`,
      "utf-8"
    );
  }
}

function writeRootReadme(
  targetDir: string,
  appName: string,
  backend: BackendStack,
  frontend: FrontendStack,
  db: DatabaseDialect
): void {
  const content = `# ${appName} (Polyglot Kerangka Project)

This project was bootstrapped with \`kerangka scaffold\`.
It uses a **Single Source of Truth** architecture powered by **Kerangka** and **UIDL-Runtime**.

## Architecture

- **Specification**: \`${appName}.kerangka.json\` (Defines entities, validations, workflows, permissions).
- **Backend Stack**: \`${backend.toUpperCase()}\` (\`backend/\`).
- **Frontend Stack**: \`${frontend.toUpperCase()}\` (\`frontend/\`) driven by **UIDL JSON Screens** (\`frontend/screens/\`).
- **Database**: \`${db.toUpperCase()}\` (\`docker-compose.yml\`).

## Stack Switcher Guide

You can switch the backend or frontend technology at any time without rewriting business logic.

### 1. Switch Backend Language

Regenerate strongly-typed models for your desired language:

\`\`\`bash
# Switch to Go
npx kerangka codegen ${appName}.kerangka.json --target go -o backend/models.go

# Switch to Python
npx kerangka codegen ${appName}.kerangka.json --target python -o backend/models.py

# Switch to Rust
npx kerangka codegen ${appName}.kerangka.json --target rust -o backend/models.rs

# Switch to TypeScript / Node
npx kerangka codegen ${appName}.kerangka.json --target ts -o backend/models.ts

# Switch to Java 21
npx kerangka codegen ${appName}.kerangka.json --target java -o backend/models.java
\`\`\`

### 2. Switch or Update Frontend

Re-project UI screens into UIDL JSON documents:

\`\`\`bash
npx kerangka uidl ${appName}.kerangka.json -o frontend/screens/
\`\`\`

Because the UI is rendered from schema-driven UIDL documents by \`uidl-runtime\` (React) or \`uidl_flutter\` (Flutter), both platforms consume the exact same JSON screens.
`;

  fs.writeFileSync(path.join(targetDir, "README.md"), content, "utf-8");
}
