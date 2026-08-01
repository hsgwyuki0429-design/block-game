// Service Worker ― ホーム画面から開いたときに、通信が無くても遊べるようにする。
//
// 方針は 2 つだけ。
//
//   ページ本体（index.html）は「ネットワーク優先・3秒で諦めてキャッシュ」。
//     オンラインなら必ず最新の HTML を取りに行くので、新しい版を出したときに
//     取り残されない。オフラインなら即座にキャッシュから開く。
//
//   それ以外は「キャッシュ優先」。
//     app.js と styles.css は URL に内容ハッシュが付いている（app.js?v=…）ので、
//     中身が変われば URL も変わる ―― つまり古い版を掴み続ける事故が起きない。
//     だからキャッシュ優先で問題なく、起動が速い。
//
// インストール時は index.html を読んで、そこに書かれているハッシュ付きの
// アセットも一緒に先読みしておく。ビルド側に一覧を持たせずに済む。

const CACHE = 'slidepop-v1';

/** 版に関係なく必要なもの */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

/** index.html が読み込んでいる、ハッシュ付きのアセットを拾う */
function assetsFrom(html) {
  const out = [];
  const re = /(?:src|href)="((?:app\.js|styles\.css)\?v=[0-9a-f]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(`./${m[1]}`);
  return out;
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    try {
      const res = await cache.match('./index.html');
      if (res) {
        const assets = assetsFrom(await res.text());
        if (assets.length) await cache.addAll(assets);
      }
    } catch { /* 先読みに失敗しても、通常の fetch で拾えるので致命ではない */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/** ネットワークを待つ。遅すぎるときはキャッシュに切り替える */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (err) => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ページ本体: ネットワーク優先
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await withTimeout(fetch(req), 3000);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('./index.html'))
          || (await caches.match('./'))
          || Response.error();
      }
    })());
    return;
  }

  // それ以外: キャッシュ優先
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      return Response.error();
    }
  })());
});
