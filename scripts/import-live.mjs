// Одноразовий імпорт контенту зі старого WordPress-сайту matyash.vn.ua/ua (листопад 2026).
// Бере сторінки через REST API, чистить HTML Elementor, перетворює на Markdown,
// розгортає посилання bit.ly, завантажує використані фото і перекодовує їх через sharp.
// Завантажений вміст лише записується у файли — нічого з нього не виконується.
//
//   npm run import:live            — з кешу export/pages-raw.json (якщо є)
//   npm run import:live -- --fresh — завантажити сторінки заново
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { parse } from 'node-html-parser';
import TurndownService from 'turndown';
import sharp from 'sharp';

const ORIGIN = 'https://matyash.vn.ua/ua';
const UA = { 'user-agent': 'matyash-site-import' };
const RAW = 'export/pages-raw.json';
const BITLY = 'export/bitly.json';
const ORIG = 'export/media-orig';

// ---------- сторінки ----------
if (process.argv.includes('--fresh') || !existsSync(RAW)) {
  const res = await fetch(`${ORIGIN}/wp-json/wp/v2/pages?per_page=100&_fields=id,slug,link,title,content`, { headers: UA });
  if (!res.ok) throw new Error(`REST API: HTTP ${res.status}`);
  mkdirSync('export', { recursive: true });
  writeFileSync(RAW, await res.text());
}
const pages = Object.fromEntries(JSON.parse(readFileSync(RAW, 'utf8')).map((p) => [decodeURIComponent(p.slug), p]));
const get = (slug) => {
  const p = pages[slug];
  if (!p) throw new Error(`Немає сторінки ${slug}`);
  return parse(p.content.rendered);
};

// Старі внутрішні адреси → нові
export const PATHS = {
  '': '/',
  'main': '/',
  'school': '/school/',
  'all-publications': '/publications/',
  'на-допомогу-аспіранту': '/phd-help/',
  'міжнародна-науково-практична-конфер': '/conference/',
};

// ---------- транслітерація (КМУ 2010, спрощено) ----------
const TR = { а:'a',б:'b',в:'v',г:'h',ґ:'g',д:'d',е:'e',є:'ie',ж:'zh',з:'z',и:'y',і:'i',ї:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ь:'',ю:'iu',я:'ia',"'":'','’':'' };
const slugify = (s) => [...s.toLowerCase()].map((c) => TR[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- медіа ----------
const media = new Map(); // шлях у uploads → нова базова назва
function mediaName(src) {
  const m = decodeURI(src).match(/\/wp-content\/uploads\/(.+)$/);
  if (!m) return null;
  const up = m[1];
  if (!media.has(up)) {
    const base = slugify(up.split('/').pop().replace(/\.[a-z]+$/i, '')) || `img-${media.size + 1}`;
    media.set(up, base);
  }
  return media.get(up);
}
const full = (n) => `/img/${n}.webp`;
const thumb = (n) => `/img/thumbs/${n}.webp`;

// ---------- bit.ly ----------
const bitly = existsSync(BITLY) ? JSON.parse(readFileSync(BITLY, 'utf8')) : {};
async function resolveShort(url) {
  if (bitly[url]) return bitly[url];
  const res = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: UA });
  const loc = res.headers.get('location');
  if (!loc || !/^https?:\/\//.test(loc)) throw new Error(`${url}: немає переадресації`);
  bitly[url] = loc;
  return loc;
}

// ---------- чистка HTML ----------
const KEEP_ATTR = { a: ['href'], img: ['src', 'alt'] };

async function clean(root, { pullImages } = {}) {
  root.querySelectorAll('script, style, noscript, svg, iframe, form, button').forEach((n) => n.remove());
  // лічильники Elementor: число стоїть в атрибуті, а на сторінці його малював JS
  for (const c of root.querySelectorAll('.elementor-counter')) {
    const n = c.querySelector('[data-to-value]')?.getAttribute('data-to-value');
    const t = c.querySelector('.elementor-counter-title')?.text.trim();
    c.replaceWith(parse(`<p><strong>${n}</strong> — ${t}</p>`));
  }
  // фото посеред тексту: на новому сайті вони йдуть у галерею
  if (pullImages) {
    for (const img of root.querySelectorAll('img')) {
      if (img.closest('a[href*="/uploads/"]')) continue;
      const n = mediaName(img.getAttribute('data-src') || img.getAttribute('src') || '');
      if (n) pullImages.push(n);
      img.remove();
    }
  }
  // каруселі → галереї з мініатюрами
  for (const car of root.querySelectorAll('.wpcp-carousel-section, .wpcp-carousel-wrapper')) {
    if (!car.parentNode) continue;
    const names = [...new Set(car.querySelectorAll('a[href*="/wp-content/uploads/"]').map((a) => mediaName(a.getAttribute('href'))))];
    car.replaceWith(parse(gallery(names)));
  }
  for (const el of root.querySelectorAll('*')) {
    const tag = el.tagName?.toLowerCase();
    if (el.closest?.('.gallery')) continue; // вже готова галерея
    if (tag === 'img') {
      const src = el.getAttribute('data-src') || el.getAttribute('src') || '';
      const n = mediaName(src);
      if (!n) { el.remove(); continue; }
      el.setAttribute('src', full(n));
    }
    if (tag === 'a') {
      let href = (el.getAttribute('href') || '').trim();
      if (/^https?:\/\/bit\.ly\//.test(href)) {
        const to = await resolveShort(href);
        if (el.text.trim() === href) el.set_content(to);
        href = to;
      }
      const internal = href.match(/^https?:\/\/matyash\.vn\.ua\/ua\/?([^?#]*)/);
      if (internal) {
        const key = decodeURIComponent(internal[1]).replace(/\/$/, '');
        const hit = Object.entries(PATHS).find(([k]) => k === key || (k.length > 20 && key.startsWith(k)));
        if (hit) href = hit[1];
        else if (/^wp-content\/uploads\//.test(key)) href = full(mediaName(href));
      }
      el.setAttribute('href', href);
    }
    for (const attr of Object.keys(el.attributes || {})) {
      if (!(KEEP_ATTR[tag] || []).includes(attr)) el.removeAttribute(attr);
    }
  }
  return root;
}

const gallery = (names) =>
  `<div class="gallery">${names.map((n) => `<a href="${full(n)}"><img src="${thumb(n)}" alt="" loading="lazy"></a>`).join('')}</div>`;

const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', emDelimiter: '*' });
td.keep((n) => n.nodeName === 'DIV' && n.classList?.contains('gallery'));
td.addRule('galleryRaw', {
  filter: (n) => n.nodeName === 'DIV' && n.classList?.contains('gallery'),
  replacement: (_, n) => {
    const items = Array.from(n.getElementsByTagName('a')).map((a) => `  [![](${a.getElementsByTagName('img')[0].getAttribute('src')})](${a.getAttribute('href')})`);
    return `\n\n<div class="gallery">\n\n${items.join('\n')}\n\n</div>\n\n`;
  },
});
const md = (html) =>
  td.turndown(html.toString())
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const front = (o) =>
  '---\n' + Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\n\n';

const sections = (root) => root.querySelectorAll('section.elementor-top-section');
const out = (file, data) => { mkdirSync(file.replace(/\/[^/]+$/, ''), { recursive: true }); writeFileSync(file, data); };

// ---------- Наукова школа ----------
rmSync('src/content/school', { recursive: true, force: true });
const school = sections(get('school'));
let order = 0;
for (const sec of school) {
  const h = sec.querySelector('h1, h2, h3, h4');
  const img = sec.querySelector('img');
  if (!h) { // карусель у кінці сторінки
    if (sec.querySelector('.wpcp-carousel-section, .wpcp-carousel-wrapper, a[href*="/uploads/"]')) {
      await clean(sec);
      const head = readFileSync('src/content/pages/school.md', 'utf8');
      out('src/content/pages/school.md', head + '\n\n## Фотографії\n\n' + md(sec.querySelector('.gallery') || sec) + '\n');
    }
    continue;
  }
  const name = h.text.trim().replace(/\s+/g, ' ');
  const photo = img ? mediaName(img.getAttribute('data-src') || img.getAttribute('src')) : undefined;
  h.remove();
  img?.remove();
  await clean(sec);
  const body = md(sec);
  if (order === 0) {
    out('src/content/pages/school.md', front({ title: 'Наукова школа', path: '/school/', photo, description: 'Наукова школа О. І. Матяш «Підвищення ефективності фахової підготовки учителів математики в умовах розвитку вищої освіти в Україні».' }) + body);
  } else {
    const year = Number(body.match(/(?:У|у)\s+(\d{4})\s+році/)?.[1] || body.match(/аспірантури\s+(\d{4})/)?.[1]) || undefined;
    const fileName = `${String(order).padStart(2, '0')}-${slugify(name)}.md`;
    out(`src/content/school/${fileName}`, front({ name, photo, year, order }) + body + '\n');
  }
  order++;
}

// ---------- Головна ----------
const main = sections(get('main'));
const byHeading = (t) => main.find((s) => s.querySelector('h1, h2, h3')?.text.includes(t));
// Усі фото головної (вбудовані в текст і з обох каруселей) збираємо в одну галерею
const homeParts = [];
const pulled = [];
const galleryOf = (root) => root.querySelectorAll('.gallery').flatMap((g) => g.querySelectorAll('a')).map((a) => a.getAttribute('href').replace(/^\/img\/|\.webp$/g, ''));
for (const t of ['Професійна активність', 'Наукова школа', 'Контакти']) {
  const s = byHeading(t);
  s.querySelector('h1, h2, h3').remove();
  await clean(s, { pullImages: pulled });
  pulled.push(...galleryOf(s));
  s.querySelectorAll('.gallery').forEach((g) => g.remove());
  homeParts.push(`## ${t}\n\n${md(s)}`);
}
const homeGallery = main.find((s) => !s.querySelector('h1, h2, h3') && s.querySelectorAll('a[href*="/uploads/"]').length > 5);
await clean(homeGallery);
const names = [...new Set([...pulled, ...galleryOf(homeGallery)])];
homeParts.splice(2, 0, `## Фотографії\n\n${md(parse(gallery(names)))}`);
const hero = byHeading('Матяш Ольга Іванівна');
const portrait = mediaName(hero.querySelector('img').getAttribute('src'));
out('src/content/pages/index.md', front({ title: 'Матяш Ольга Іванівна', path: '/', photo: portrait }) + homeParts.join('\n\n') + '\n');

// ---------- Публікації ----------
const pub = byHeading('Наукові публікації');
pub.querySelector('h1, h2, h3').remove();
await clean(pub);
out('src/content/pages/publications.md', front({ title: 'Наукові публікації', path: '/publications/', description: 'Монографії, навчальні посібники і статті О. І. Матяш.' }) + md(pub) + '\n');

// ---------- Аспіранту, конференція ----------
for (const [slug, path, title] of [
  ['на-допомогу-аспіранту', '/phd-help/', 'На допомогу аспіранту'],
  ['міжнародна-науково-практична-конференція', '/conference/', 'Міжнародна науково-практична конференція'],
]) {
  const key = Object.keys(pages).find((k) => k.startsWith(slug.slice(0, 20)));
  const root = await clean(get(key));
  out(`src/content/pages${path.replace(/\/$/, '')}.md`, front({ title, path }) + md(root) + '\n');
}

writeFileSync(BITLY, JSON.stringify(bitly, null, 2) + '\n');

// ---------- завантаження і перекодування фото ----------
const SIG = { jpg: [0xff, 0xd8, 0xff], jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47] };
mkdirSync(ORIG, { recursive: true });
mkdirSync('public/img/thumbs', { recursive: true });
const portraits = new Set([portrait]);
for (const f of (await import('node:fs')).readdirSync('src/content/school')) {
  const p = readFileSync(`src/content/school/${f}`, 'utf8').match(/^photo: "(.+)"$/m)?.[1];
  if (p) portraits.add(p);
}
const failed = [];
for (const [up, n] of media) {
  const ext = up.split('.').pop().toLowerCase();
  const local = `${ORIG}/${n}.${ext}`;
  try {
    if (!SIG[ext]) throw new Error('недозволений тип');
    if (!existsSync(local)) {
      const res = await fetch(`${ORIGIN}/wp-content/uploads/${up.split('/').map(encodeURIComponent).join('/')}`, { redirect: 'error', headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!SIG[ext].every((b, i) => buf[i] === b)) throw new Error('вміст не відповідає типу');
      writeFileSync(local, buf);
    }
    // Перекодування відкидає все, крім пікселів (EXIF, вкладені дані)
    await sharp(local).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(`public/img/${n}.webp`);
    const t = portraits.has(n)
      ? sharp(local).rotate().resize({ width: 400, height: 500, fit: 'cover', position: 'attention' })
      : sharp(local).rotate().resize({ width: 480, height: 480, fit: 'cover', position: 'attention' });
    await t.webp({ quality: 74 }).toFile(`public/img/thumbs/${n}.webp`);
  } catch (e) {
    failed.push(`${up}: ${e.message}`);
  }
}
console.log(`Сторінок: 6, людей у школі: ${order - 1}, фото: ${media.size}, bit.ly: ${Object.keys(bitly).length}`);
if (failed.length) { console.error('Проблеми:\n  ' + failed.join('\n  ')); process.exitCode = 1; }
