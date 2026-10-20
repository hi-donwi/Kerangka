const uidlFiles = import.meta.glob<string>("../../generated/*/uidl/*.uidl.json", {
  eager: true,
  query: "?raw",
  import: "default",
});

export interface SampleUidlFile {
  id: string;
  raw: string;
}

export function uidlForSample(sampleId: string): SampleUidlFile[] {
  if (!/^[a-z0-9-]+$/.test(sampleId)) return [];
  const marker = `/generated/${sampleId}/uidl/`;
  return Object.entries(uidlFiles)
    .filter(([key]) => key.includes(marker))
    .map(([key, raw]) => ({
      id: key.slice(key.lastIndexOf("/") + 1).replace(/\.uidl\.json$/, ""),
      raw,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
