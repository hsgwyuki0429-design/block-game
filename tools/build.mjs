// src/ の ES モジュールを 1 本の app.js にまとめ、index.html に内容ハッシュを刻む。
//
// なぜ必要か:
//   index.html と src/*.js を別々に配信すると、ブラウザが「新しい HTML＋古い JS」を
//   組み合わせてしまうことがある（GitHub Pages はどちらも短い max-age で配信し、
//   Safari は JS を長く保持する）。実際にそれで盤面が真っ白になった。
//   1 本にまとめてファイル名にハッシュを付ければ、HTML と JS が食い違いようがない。
//   副産物として file:// で直接開いても動くようになる。
//
//   node tools/build.mjs [--check]
//     --check : 生成物が最新かどうかだけ確かめる（テストから使う）

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(ROOT, 'src/main.js');
const OUT = resolve(ROOT, 'app.js');
const HTML = resolve(ROOT, 'index.html');

/** import 文（複数行も可）。相対パスのみ扱う */
const IMPORT_RE = /^[ \t]*import\s+[\s\S]*?from\s+['"](\.[^'"]+)['"];?[ \t]*$/gm;
/** export { a, b }; の形 */
const EXPORT_LIST_RE = /^[ \t]*export\s*\{[^}]*\}\s*;?[ \t]*$/gm;
/** export const / function / class / async function の接頭辞 */
const EXPORT_DECL_RE = /^([ \t]*)export\s+(const|let|var|function|class|async\s+function)\b/gm;

/** 依存順に並べたモジュール一覧を返す（深さ優先の後順＝依存が先） */
async function collect(entry, seen = new Map(), order = []) {
  if (seen.has(entry)) return order;
  const source = await readFile(entry, 'utf8');
  seen.set(entry, source);

  const deps = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    deps.push(resolve(dirname(entry), m[1]));
  }
  for (const dep of deps) await collect(dep, seen, order);
  order.push({ path: entry, source });
  return order;
}

/** import / export を取り除いて、素の文の並びにする */
function strip(source) {
  return source
    .replace(IMPORT_RE, '')
    .replace(EXPORT_LIST_RE, '')
    .replace(EXPORT_DECL_RE, '$1$2')
    .replace(/\n{3,}/g, '\n\n');
}

/** 平坦に連結するので、トップレベルの名前が衝突していないか確かめる */
function topLevelNames(source) {
  const names = new Set();
  const re = /^(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of source.matchAll(re)) names.add(m[1]);
  return names;
}

async function build() {
  const modules = await collect(ENTRY);

  const seen = new Map();
  const parts = [];
  for (const mod of modules) {
    const rel = relative(ROOT, mod.path);
    const body = strip(mod.source);
    for (const name of topLevelNames(body)) {
      if (seen.has(name)) {
        throw new Error(
          `トップレベルの名前 "${name}" が ${seen.get(name)} と ${rel} で衝突しています。` +
          'どちらかの名前を変えてください（1 本に連結するため同じスコープに並びます）。',
        );
      }
      seen.set(name, rel);
    }
    parts.push(`// ===== ${rel} =====\n${body.trim()}\n`);
  }

  const banner = '// SLIDE POP! ― tools/build.mjs が src/ から生成。直接編集しないこと。\n';
  const code = `${banner}(function () {\n'use strict';\n\n${parts.join('\n')}\n})();\n`;
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 10);

  let html = await readFile(HTML, 'utf8');
  html = html
    .replace(/<script[^>]*src="[^"]*app\.js[^"]*"[^>]*><\/script>/, `<script defer src="app.js?v=${hash}"></script>`)
    .replace(/<script type="module"[^>]*src="src\/main\.js"[^>]*><\/script>/, `<script defer src="app.js?v=${hash}"></script>`)
    .replace(/href="styles\.css(\?v=[^"]*)?"/, `href="styles.css?v=${hash}"`);

  return { code, html, hash };
}

const check = process.argv.includes('--check');
const { code, html, hash } = await build();

if (check) {
  const [curCode, curHtml] = await Promise.all([
    readFile(OUT, 'utf8').catch(() => ''),
    readFile(HTML, 'utf8'),
  ]);
  if (curCode !== code || curHtml !== html) {
    console.error('app.js / index.html が src/ と食い違っています。`npm run build` を実行してください。');
    process.exit(1);
  }
  console.log(`ビルド成果物は最新です (v=${hash})`);
} else {
  await writeFile(OUT, code);
  await writeFile(HTML, html);
  console.log(`app.js を生成しました (${(code.length / 1024).toFixed(1)}KB, v=${hash})`);
}
