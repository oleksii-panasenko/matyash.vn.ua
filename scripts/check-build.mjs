// Перевірка зібраного сайту: немає спаму, зовнішніх скриптів і PHP.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SPAM = /grandpasha|casino|казино|betting|viagra|cialis/i;
const problems = [];
let html = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (/\.(php\d?|phtml|phar)$/i.test(name)) problems.push(`PHP-файл: ${p}`);
    if (!name.endsWith('.html')) continue;
    html++;
    const s = readFileSync(p, 'utf8');
    if (SPAM.test(s)) problems.push(`Спам-слова: ${p}`);
    for (const m of s.matchAll(/<script[^>]*src="(https?:)?\/\/[^"]+"/g)) problems.push(`Зовнішній скрипт: ${p}: ${m[0]}`);
    for (const m of s.matchAll(/<(?:img|iframe|object)[^>]*(?:src|data)="https?:\/\/[^"]+"/g)) problems.push(`Зовнішній ресурс: ${p}: ${m[0].slice(0, 120)}`);
  }
})('dist');
console.log(`Перевірено HTML-сторінок: ${html}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('Чисто: спаму, зовнішніх скриптів і PHP немає.');
