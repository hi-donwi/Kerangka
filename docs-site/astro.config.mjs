import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Build for preview under /docs/preview/ so the versioned layout is exercised.
export default defineConfig({
  base: '/docs/preview',
  outDir: './dist/docs/preview',
  integrations: [
    starlight({
      title: 'Kerangka Docs',
      description: 'Kerangka documentation and reference',
      sidebar: [
        {
          label: 'Introduction',
          items: [
            { label: 'Overview', link: '/' }
          ]
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Kerangka Model', link: '/concepts/kerangka-model/' }
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
        baseUrl: 'https://github.com/donwi-code/public/tree/main/docs-site'
      },
      pagination: true,
      lastUpdated: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 }
    })
  ]
});
