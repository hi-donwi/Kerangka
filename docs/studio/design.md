# Studio Console Design

The console is a restrained engineering workbench, not an application-dashboard template.
Use a warm paper surface, charcoal text/rail, and a dark rust accent. The source explorer,
inspector, projection tabs, and diagnostics are the hierarchy; no decorative KPI cards,
gradients, remote fonts, or generic marketing header. UIDL preview keeps the runtime's
presentation styles in its own frame rather than leaking them into the console.

| Role | Value / rule |
|---|---|
| Canvas / surface | `#f5f2eb` / `#fffdf8` |
| Text / muted | `#27251f` / `#625b50` on light surfaces |
| Rail | `#27251f` with `#fffdf8` text |
| Accent / focus | `#a33819`, always paired with light surface/text |
| Border | `#d9d2c6`; focus/active state also uses text and a strong outline |
| Type | System sans for navigation/content; system monospace for code, counts, and IDs |
| Density | 4px primitive spacing scale; semantic panel/control/code tokens |
| Shape | Small radius, thin dividers; no interchangeable rounded-card grid |
| Touch | Primary controls at least 44px; minimum controls 24px |

Declare raw values only in primitive CSS tokens. Semantic tokens reference them; components
consume semantic/component tokens. Foreground/accent pairs must meet 4.5:1 for normal text;
verify those pairs alongside keyboard/browser tests. Color is never the only state cue.

At desktop width use explorer + flexible inspector, with diagnostics below the inspector.
At narrow widths stack the explorer and inspector, bound the explorer's scroll area, and
keep code scrolling inside a labelled focusable region. No page-wide horizontal overflow
at 320px; long filenames and pointers must wrap or truncate without changing source data.
Source rendering uses a few text nodes, not a DOM node per line in a 512 KiB source.

Loading, missing access, invalid access, missing selection, invalid source, stale refresh,
no diagnostics, unsupported preview, and empty model states have explicit text. Selection
uses buttons and labelled tabs; diagnostics open the correct source/line. No business
mutation or source-save control is presented in P1.
