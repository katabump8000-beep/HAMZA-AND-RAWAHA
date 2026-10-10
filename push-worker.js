/* ============================================================
   push-worker.js — Cloudflare Worker (مجاني)
   يرسل إشعاراً للطرف الآخر حتى لو كان الموقع مغلقاً.
   ⚠️ لا ترفع هذا الملف على GitHub (فيه مفتاح سري).
   ============================================================ */
const DB     = 'https://hamza-a0a8b-default-rtdb.firebaseio.com';
const SECRET = 'Vm5q9ghc8BE4cTzlzd7fPkVW';                       // نفس secret الموجود في firebase.js
const VAPID_PUBLIC = 'BKrPKz4pkSpwOL4vW1tMmWlm4MaUngqvvaEIhyHBnTlhEKk2A959ScjMf0LaOv6Vd3kmS37EyzduuOTOcY1aSBs';
const VAPID_JWK = { kty:'EC', crv:'P-256', x:'qs8rPimRKnA4vi9bW0yZaWbgxpSeCq-9oQiHIcGdOWE', y:'EKk2A959ScjMf0LaOv6Vd3kmS37EyzduuOTOcY1aSBs', d:'VMOOmwkTPZFn7aC9QPsZR8U7ukS8ktQqs9f2H3ZUfVs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = s => new TextEncoder().encode(s);

async function vapidJwt(aud) {
  const head = b64u(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:admin@example.com' })));
  const key = await crypto.subtle.importKey('jwk', VAPID_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(head + '.' + body));
  return head + '.' + body + '.' + b64u(sig);
}

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    try {
      const { to, key } = await req.json();
      if (key !== SECRET || (to !== 'hamza' && to !== 'rawaha')) return new Response('forbidden', { status: 403, headers: CORS });
      const sub = await (await fetch(DB + '/push/' + to + '.json')).json();
      if (!sub || !sub.endpoint) return new Response('no-subscription', { headers: CORS });
      const jwt = await vapidJwt(new URL(sub.endpoint).origin);
      const r = await fetch(sub.endpoint, {
        method: 'POST',
        headers: { Authorization: 'vapid t=' + jwt + ', k=' + VAPID_PUBLIC, TTL: '86400', Urgency: 'high' }
      });
      return new Response('push:' + r.status, { headers: CORS });
    } catch (e) {
      return new Response('error', { status: 500, headers: CORS });
    }
  }
};
