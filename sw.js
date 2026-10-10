/* sw.js — الإشعارات (تعمل حتى والموقع مغلق إن فعّلت push-worker.js) */
const DB   = 'https://hamza-a0a8b-default-rtdb.firebaseio.com';
const CHAT = 'hamza__rawaha';
const NAMES = { hamza: 'حمزة', rawaha: 'رواحة' };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* الموقع يخبرنا من هو المستخدم الحالي على هذا الجهاز */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'user') {
    e.waitUntil(caches.open('meta').then(c => c.put('/user', new Response(String(e.data.user)))));
  }
});

async function currentUser() {
  try { const r = await (await caches.open('meta')).match('/user'); return r ? await r.text() : null; }
  catch (e) { return null; }
}

self.addEventListener('push', e => e.waitUntil(onPush(e)));

async function onPush(e) {
  let title = 'رسالة جديدة', body = 'وصلتك رسالة';
  const me = await currentUser();
  try {
    const url = DB + '/chats/' + CHAT + '/messages.json?orderBy=' + encodeURIComponent('"$key"') + '&limitToLast=1';
    const j = await (await fetch(url, { cache: 'no-store' })).json();
    const id = j && Object.keys(j)[0];
    if (id) {
      const m = j[id];
      if (me && m.from === me) return;                         // رسالتي أنا — لا إشعار
      title = m.fromName || NAMES[m.from] || title;
      body = (m.blur && !m.revealed) ? '🌫️ رسالة مغبشة'
           : m.type === 'image' ? '📷 صورة'
           : m.type === 'audio' ? '🎵 تسجيل صوتي'
           : m.type === 'file'  ? '📄 ' + (m.fileName || 'ملف')
           : (m.text || body);
      if (!m.delivered) {                                      // √ تصبح خضراء عند المرسل
        fetch(DB + '/chats/' + CHAT + '/messages/' + id + '.json', {
          method: 'PATCH', body: JSON.stringify({ delivered: true, deliveredAt: Date.now() })
        }).catch(() => {});
      }
    }
  } catch (err) {}
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (wins.some(w => w.visibilityState === 'visible' && w.focused)) return;
  await self.registration.showNotification(title, {
    body, tag: 'chat', renotify: true, vibrate: [120, 60, 120]
  });
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) return w.focus(); }
    return self.clients.openWindow('./');
  })());
});
