import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Versioned path and output directory come from release.json, so moving from the
// preview channel to a versioned release (for example /docs/v0.1.1) is a single
// config edit instead of a hunt through this file.
const release = JSON.parse(readFileSync(new URL('./release.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: release.basePath,
  outDir: release.outDir,
  // Set `site` in release.json when the canonical host is known (GitHub Pages needs it
  // for the sitemap and canonical URLs); the preview build does not have one.
  ...(release.site ? { site: release.site } : {}),
  integrations: [
    starlight({
      title: 'Kerangka Docs',
      description: 'Kerangka documentation and reference',
      sidebar: [
        {
          label: 'Introduction',
          items: [
            { label: 'Overview', link: '/' },
            { label: 'Your First Model', link: '/getting-started/first-model/' }
          ]
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Kerangka Model', link: '/concepts/kerangka-model/' },
            { label: 'Field, Expression, and Validation', link: '/concepts/validation/' },
            { label: 'Actions, Workflows, and Decisions', link: '/concepts/workflow/' },
            { label: 'Generated Contracts and UIDL', link: '/concepts/contracts/' }
          ]
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI Reference', link: '/reference/cli/' },
            { label: 'Compatibility Matrix', link: '/reference/compatibility/' },
            { label: 'Samples Reference', link: '/reference/samples/' }
          ]
        }
      ],
      defaultLocale: 'root',
      locales: {
        root: {
          label: 'English',
          lang: 'en'
        }
      },
      editLink: {
        baseUrl: 'https://github.com/hi-donwi/Kerangka/tree/main/docs-site/'
      },
      pagination: true,
      lastUpdated: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 }
    })
  ]
});
