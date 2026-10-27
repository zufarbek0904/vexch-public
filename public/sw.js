// Минимальный сервис-воркер: делает приложение устанавливаемым и показывает страницу «нет сети».
// Данные (сообщения, API) НЕ кэшируются намеренно — чтобы не показывать устаревшие или чужие данные.
const CACHE = "vexchat-shell-v1";
const SHELL = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;   // только переходы между страницами
  e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
});
