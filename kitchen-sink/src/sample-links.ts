export function publishedDocsHref(docsPath: string, site: string) {
  if (!docsPath.startsWith("/") || docsPath.includes("\\") || docsPath.includes("..")) return docsPath;
  try {
    return new URL(docsPath, site).href;
  } catch {
    return docsPath;
  }
}

export function repositorySourceHref(sourcePath: string, repository = "https://github.com/hi-donwi/Kerangka") {
  if (!sourcePath || sourcePath.startsWith("/") || sourcePath.includes("\\") || sourcePath.split("/").includes("..")) return null;
  return `${repository.replace(/\/$/, "")}/blob/main/${sourcePath}`;
}
