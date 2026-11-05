import { defineConfig } from 'astro/config';

// Старий WordPress жив у /ua/. Кожну колишню адресу переводимо на нову.
const old = {
  '/ua/': '/',
  '/ua/main/': '/',
  '/ua/school/': '/school/',
  '/ua/all-publications/': '/publications/',
  '/ua/на-допомогу-аспіранту/': '/phd-help/',
  '/ua/міжнародна-науково-практична-конфер/': '/conference/',
};
// Кириличні адреси лишаємо розкодованими: GitHub Pages сам розкодовує %XX у запиті.
const redirects = old;

export default defineConfig({
  site: 'https://matyash.vn.ua',
  trailingSlash: 'always',
  build: { format: 'directory' },
  redirects,
  markdown: { smartypants: false },
});
