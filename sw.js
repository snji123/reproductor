// Service worker de "Para Ti Familia" — paso 1: la página abre sin conexión.
const VERSION = 'v1';
const SHELL = `fam-shell-${VERSION}`;
const RUNTIME = `fam-runtime-${VERSION}`;
const SHELL_FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

// Hosts de librerías y fuentes que conviene tener en caché para abrir sin internet
const CACHEABLE_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('fam-') && ![SHELL, RUNTIME].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la red (para ver siempre la versión nueva) y, si no hay internet o tarda, la copia guardada
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      fetch(req, { cache: 'no-cache' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
    ]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    return cached || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
  }
}

// Primero la copia guardada y en segundo plano la actualiza (así abre al instante y sin internet)
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  const network = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return; // audio/video: lo maneja el navegador (paso 2)
  const url = new URL(req.url);

  // Archivos propios de la página
  if (url.origin === location.origin) {
    const isCode = req.mode === 'navigate' || /\.(html|js|json)$/.test(url.pathname) || url.pathname.endsWith('/');
    e.respondWith(isCode ? networkFirst(req, SHELL) : staleWhileRevalidate(req, SHELL));
    return;
  }
  // Librerías y fuentes
  if (CACHEABLE_HOSTS.includes(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req, RUNTIME));
  }
  // Todo lo demás (Firestore, Cloudinary, etc.) pasa directo a la red
});
