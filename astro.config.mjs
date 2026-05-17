// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import remarkWikiLink from 'remark-wiki-link';

// https://astro.build/docs/guides/deploy/github/
export default defineConfig({
  site: 'https://tershire.github.io',
  base: '/ena-world',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    remarkPlugins: [
      [
        remarkWikiLink,
        {
          // [[Article Title]] → /ena-world/central-lab/article-title
          hrefTemplate: (/** @type {string} */ permalink) => `/ena-world/${permalink}`,
          pageResolver: (/** @type {string} */ name) =>
            [name.toLowerCase().replace(/\s+/g, '-')],
          aliasDivider: '|',
        },
      ],
    ],
  },
});
