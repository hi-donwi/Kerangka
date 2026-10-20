import { useState } from "react";
import { exportBundleRequest, importBundleRequest } from "./studio-api";

export function BundleTools({ token, onImported }: { token: string; onImported: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <section className="bundle-tools" aria-label="Bundle export and import">
      <h3>Bundle</h3>
      <p className="muted">Export authored sources only. Import validates the bundle before adoption.</p>
      <button
        type="button"
        onClick={async () => {
          const bundle = await exportBundleRequest(token);
          const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "kerangka-studio-bundle.json";
          link.click();
          URL.revokeObjectURL(url);
          setStatus("Bundle exported.");
        }}
      >
        Export bundle
      </button>
      <label>
        Import bundle
        <input
          type="file"
          accept="application/json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const bundle = JSON.parse(await file.text());
            await importBundleRequest(token, bundle);
            setStatus("Bundle validated. Refresh to adopt it.");
            onImported();
          }}
        />
      </label>
      {status ? <p role="status">{status}</p> : null}
    </section>
  );
}
