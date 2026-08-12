const SCOPE_URL = new URL('./', self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname;
const CACHE_PREFIX = `magic-blackboard:${encodeURIComponent(SCOPE_PATH)}:`;
const CACHE_NAME = `${CACHE_PREFIX}shell-v1`;
const SHELL_URLS = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg'].map(
  (path) => new URL(path, SCOPE_URL).href
);

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)),
      self.skipWaiting(),
    ])
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(SCOPE_PATH)
  ) {
    return;
  }

  const relativePath = url.pathname.slice(SCOPE_PATH.length);
  const isAppNavigation = request.mode === 'navigate' && ['', 'index.html'].includes(relativePath);
  if (isAppNavigation) {
    event.respondWith(
      fetch(request).catch(async () => {
        return (await caches.match(new URL('index.html', SCOPE_URL).href)) ?? Response.error();
      })
    );
    return;
  }
  if (request.mode === 'navigate') {
    return;
  }

  const isShellAsset = ['index.html', 'manifest.webmanifest', 'icon.svg'].includes(relativePath);
  const isBuildAsset = relativePath.startsWith('assets/');
  if (!isShellAsset && !isBuildAsset) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        return Response.error();
      })
  );
});
