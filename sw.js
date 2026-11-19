const CACHE='timermask-v30';
const FILES=['./','./index.html','./app.js','./privacy.html','./logo.png','./icon-180.png','./icon-192.png','./icon-512.png','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(FILES);
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith('timermask-')&&key!==CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{const response=await fetch(req);if(response.ok)return response;}catch{}
      return (await caches.match(req))||(await caches.match('./index.html'))||Response.error();
    })());
    return;
  }
  event.respondWith((async()=>{
    const cached=await caches.match(req);
    if(cached)return cached;
    try{
      const response=await fetch(req);
      if(response.ok){const cache=await caches.open(CACHE);await cache.put(req,response.clone());}
      return response;
    }catch{return Response.error();}
  })());
});
