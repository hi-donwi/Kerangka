import { filterLogicPresetCatalog, filterStarterCatalog, logicPresetUsage, previewStarterFiles } from "./catalog";
import { repositorySourceHref } from "./sample-links";

function RepositorySource({ path }: { path: string }) {
  const href = repositorySourceHref(path);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer"><code>{path}</code></a>
  ) : (
    <code>{path}</code>
  );
}

export function StarterCatalog({ query }: { query: string }) {
  const starters = filterStarterCatalog(query);

  return (
    <section className="catalog-view" aria-labelledby="starter-catalog-title">
      <div className="catalog-intro">
        <p className="eyebrow">Kerangka CLI / predefined starters</p>
        <h2 id="starter-catalog-title">Starter catalog</h2>
        <p>Start from a tested model or workspace. Each card is read from the same starter manifest used by <code>kerangka init --list</code>.</p>
      </div>
      {starters.length === 0 ? (
        <div className="empty-state" role="status">
          <h3>No starters found</h3>
          <p>Try a name, capability, or layout such as “workspace”.</p>
        </div>
      ) : (
        <div className="catalog-grid">
          {starters.map((starter) => {
            const generatedFiles = previewStarterFiles(starter);
            const featuredFile = generatedFiles.find((file) => file.path.includes("/contexts/") && file.path.endsWith(".kerangka.json"))
              ?? generatedFiles.find((file) => file.path.endsWith(".kerangka.json") && !file.path.includes("deploy."))
              ?? generatedFiles[0];
            const excerptLimit = 1800;
            const excerpt = featuredFile?.content.slice(0, excerptLimit) ?? "No generated files.";
            const hasMorePreview = generatedFiles.length > 1 || (featuredFile?.content.length ?? 0) > excerptLimit;
            return (
              <article className="catalog-card" key={starter.starter} aria-labelledby={`starter-${starter.starter}`}>
                <div className="card-kicker">
                  <span>{starter.layout}</span>
                  <span>{starter.files.length} source {starter.files.length === 1 ? "file" : "files"}</span>
                </div>
                <h3 id={`starter-${starter.starter}`}>{starter.starter}</h3>
                <p>{starter.description}</p>
                {starter.tags?.length ? (
                  <ul className="catalog-tags" aria-label={`${starter.starter} capabilities`}>
                    {starter.tags.map((tag) => <li key={tag}>{tag}</li>)}
                  </ul>
                ) : null}
                <section className="catalog-preview starter-preview" aria-label={`Generated file preview for ${starter.starter}`}>
                  <p><strong>Generated preview:</strong> <code>{featuredFile?.path ?? ""}</code></p>
                  <pre tabIndex={0}><code>{excerpt}{featuredFile && featuredFile.content.length > excerptLimit ? "\n…" : ""}</code></pre>
                  {hasMorePreview ? (
                    <details className="catalog-files">
                      <summary>View full generated output ({generatedFiles.length} {generatedFiles.length === 1 ? "file" : "files"})</summary>
                      {generatedFiles.map((file) => (
                        <div className="generated-file" key={file.path}>
                          <p><code>{file.path}</code></p>
                          <pre tabIndex={0}><code>{file.content}</code></pre>
                        </div>
                      ))}
                    </details>
                  ) : null}
                </section>
                <div className="catalog-command">
                  <span>Start with</span>
                  <code>kerangka init {starter.starter} --name my-app</code>
                </div>
                <details className="catalog-files">
                  <summary>Included source files</summary>
                  <ul>
                    {starter.files.map((file) => {
                      const sourcePath = `packages/cli/starters/${starter.starter}/${file.from}`;
                      return (
                        <li key={file.from}>
                          <RepositorySource path={sourcePath} />
                          <span aria-hidden="true"> → </span>
                          <code>{file.to}</code>
                        </li>
                      );
                    })}
                  </ul>
                </details>
                {starter.directories?.length ? (
                  <details className="catalog-files">
                    <summary>Created directories</summary>
                    <ul>{starter.directories.map((directory) => <li key={directory}><code>{directory}</code></li>)}</ul>
                  </details>
                ) : null}
                {starter.next?.length ? (
                  <div className="catalog-next">
                    <h4>Next steps</h4>
                    <ol>
                      {starter.next.map((command) => (
                        <li key={command}><code>npx {command.replaceAll("${target}", starter.layout === "document" ? "my-app.kerangka.json" : "my-app")}</code></li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                <p className="catalog-source"><strong>Manifest:</strong> <RepositorySource path={`packages/cli/starters/${starter.starter}/starter.json`} /></p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function LogicPresetCatalog({ query }: { query: string }) {
  const presets = filterLogicPresetCatalog(query);

  return (
    <section className="catalog-view" aria-labelledby="logic-preset-catalog-title">
      <div className="catalog-intro">
        <p className="eyebrow">Kerangka packages / model logic</p>
        <h2 id="logic-preset-catalog-title">Logic preset catalog</h2>
        <p>Browse reusable types, traits, templates, and lint rules from Kerangka's packages. Presentation recipes and widgets remain owned by UIDL Runtime.</p>
      </div>
      {presets.length === 0 ? (
        <div className="empty-state" role="status">
          <h3>No logic presets found</h3>
          <p>Try a package, type, workflow, or lint preset name.</p>
        </div>
      ) : (
        <div className="catalog-grid">
          {presets.map((preset) => (
            <article className="catalog-card" key={preset.id} aria-labelledby={`preset-${preset.id}`}>
              <section className="catalog-preview preset-preview" aria-label={`Model usage preview for ${preset.id}`}>
                <p><strong>{preset.kind === "lint preset" ? "Workspace configuration preview" : "Model usage preview"}</strong> <span>(example, not executed)</span></p>
                <pre tabIndex={0}><code>{logicPresetUsage(preset)}</code></pre>
              </section>
              <div className="card-kicker">
                <span>{preset.kind}</span>
                <span>{preset.packageName}</span>
              </div>
              <h3 id={`preset-${preset.id}`}>{preset.id}</h3>
              <p>{preset.description}</p>
              <details className="catalog-files">
                <summary>Inspect definition</summary>
                <pre tabIndex={0}><code>{JSON.stringify(preset.definition, null, 2)}</code></pre>
              </details>
              <p className="catalog-source"><strong>Source:</strong> <RepositorySource path={preset.sourcePath} /></p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
