import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articleSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  date: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  public: z.coerce.boolean().default(false),
});

export const collections = {
  'central-lab': defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/central-lab' }),
    schema: articleSchema,
  }),
  'marine-lab': defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/marine-lab' }),
    schema: articleSchema,
  }),
  'aerospace-lab': defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/aerospace-lab' }),
    schema: articleSchema,
  }),
};
