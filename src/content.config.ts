import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Сторінки сайту: кожен файл у src/content/pages/ — окрема сторінка за адресою path.
const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    path: z.string(),
    description: z.string().optional(),
    photo: z.string().optional(),
  }),
});

// Учні наукової школи: один файл — одна людина. Порядок на сторінці — за полем order.
const school = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/school' }),
  schema: z.object({
    name: z.string(),
    photo: z.string().optional(),
    year: z.number().optional(),
    order: z.number(),
  }),
});

export const collections = { pages, school };
