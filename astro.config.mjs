// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import remarkWikiLink from 'remark-wiki-link';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { fileURLToPath } from 'url';
import { remarkCitations } from './src/plugins/remark-citations.mjs';

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
      remarkMath,
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
      [
        remarkCitations,
        { bibliography: fileURLToPath(new URL('./references.bib', import.meta.url)) },
      ],
    ],
    rehypePlugins: [
      rehypeKatex,
    ],
  },
});
