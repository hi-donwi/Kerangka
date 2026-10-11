import React from "react";
import { UIDocumentRenderer } from "@hi-donwi/uidl-runtime";
import taskListScreen from "../frontend-screens/task-list.uidl.json";

export function App() {
  return (
    <div className="polyglot-app-container">
      <h1>Polyglot Task Hub (React + UIDL-Runtime)</h1>
      <UIDocumentRenderer document={taskListScreen as any} />
    </div>
  );
}
