import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articleSchema = z.object({
  title: z.string(),
  description: z.string().nullish(),
  date: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  public: z.coerce.boolean().default(false),
  order: z.number().optional(),
});

const librarySchema = z.object({
  title: z.string(),
  description: z.string().nullish(),
  date: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  public: z.coerce.boolean().default(false),
  order: z.number().optional(),
  type: z.enum(['paper', 'book', 'course']).optional(),
  authors: z.string().optional(),
  year: z.number().optional(),
  source: z.string().optional(),
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
  'studio-lab': defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/studio-lab' }),
    schema: articleSchema,
  }),
  'library': defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/library' }),
    schema: librarySchema,
  }),
};
