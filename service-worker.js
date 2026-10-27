// 旧站（GitHub Pages）已迁移到 CloudBase 静态托管。
// 这个 Service Worker 只做两件事：清掉旧的缓存、把已经安装的旧版引导到新地址。
// 不缓存任何新内容，避免旧域名继续提供过期页面。

const NEW_HOME = 'https://my-daka-d7g92edvi8d023606-1517594422.tcloudbaseapp.com/';
const OWN_CACHE_PREFIX = 'evening-agreement-';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 只清理本应用自己的缓存，避免影响同一域名下的其它站点
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.indexOf(OWN_CACHE_PREFIX) === 0).map((key) => caches.delete(key)));
      await self.clients.claim();
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(
        clientList.map((client) => client.navigate(NEW_HOME).catch(() => null))
      );
    })()
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(`打卡应用已迁移到新地址：${NEW_HOME}`, {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          status: 503,
        })
    )
  );
});
