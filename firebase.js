/* ============================================================
   firebase.js  (الإصدار 5)
   - الاتصال بالخادم (Realtime Database + Storage)
   - إذا لم تُملأ بيانات Firebase، يعمل الموقع محلياً (localStorage)
   - كل رسالة تُخزَّن تحت مفتاح محادثة ثابت:  chats/{chatId}/messages
     حيث chatId = أسماء الطرفين مرتّبة أبجدياً (مثل: hamza__rawaha)
   ============================================================ */

/* ⚠️ ملاحظة مهمة:
   لكي يعمل الشات الحقيقي بين جهازين مختلفين، يجب إنشاء مشروع Firebase مجاني
   ثم لصق بياناتك في CONFIG أدناه.
   إذا تركت القيم فارغة، سيعمل الموقع بالوضع المحلي (نفس الجهاز فقط).
*/

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAp2S4de2GlGrygZNdhuZTtngBvgIJTRU8",
  authDomain: "hamza-a0a8b.firebaseapp.com",
  databaseURL: "https://hamza-a0a8b-default-rtdb.firebaseio.com",
  projectId: "hamza-a0a8b",
  storageBucket: "hamza-a0a8b.firebasestorage.app",
  messagingSenderId: "324557425333",
  appId: "1:324557425333:web:bd17bcf838d47d6aee4cfc"
};

/* المستخدمان المسموح لهما فقط */
const CHAT_USERS = ['hamza', 'rawaha'];

/* ============================================================
   إشعارات حتى لو الموقع مغلق (اختياري)
   اتركها فارغة وكل شيء يعمل عدا الإشعار عند إغلاق المتصفح تماماً.
   بعد نشر ملف push-worker.js على Cloudflare ضع رابطه في workerUrl.
   ============================================================ */
const PUSH_CONFIG = {
  workerUrl: 'https://snowy-mouse-9753.mdenserea2.workers.dev',
  publicKey: 'BKrPKz4pkSpwOL4vW1tMmWlm4MaUngqvvaEIhyHBnTlhEKk2A959ScjMf0LaOv6Vd3kmS37EyzduuOTOcY1aSBs',
  secret:    'Vm5q9ghc8BE4cTzlzd7fPkVW'
};

/* ============================================================
   حالة الاتصال
   ============================================================ */
let fbReady = false;
let fbDB = null;
let fbStorage = null;
let fbError = '';
let fbConnected = false;

function initFirebase() {
  if (!FIREBASE_CONFIG.databaseURL) {
    fbError = 'no-config';
    console.warn('[Firebase] لم يتم إعداد الاتصال — سيعمل الموقع محلياً');
    return false;
  }
  if (typeof firebase === 'undefined') {
    fbError = 'no-sdk';
    console.error('[Firebase] المكتبة لم تُحمَّل (قد يكون الموقع محجوباً)');
    return false;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    fbDB = firebase.database();
    try {
      fbStorage = firebase.storage();
      /* لا ننتظر دقائق إن كان Storage غير مفعّل — نتحول فوراً للبديل */
      fbStorage.setMaxUploadRetryTime(15000);
      fbStorage.setMaxOperationRetryTime(15000);
    } catch (e) { console.warn('[Firebase] Storage غير متاح'); }
    fbReady = true;
    fbDB.ref('.info/connected').on('value', s => {
      fbConnected = !!s.val();
      window.dispatchEvent(new Event('fb-conn'));
    });
    console.log('[Firebase] تم الاتصال بنجاح');
    return true;
  } catch (e) {
    console.error('[Firebase] خطأ في التهيئة:', e);
    return false;
  }
}

/* ============================================================
   أدوات داخلية للوضع المحلي
   ============================================================ */
const LOCAL_MSGS_KEY = 'local_msgs_v2';

function lsReadMsgs() {
  try { return JSON.parse(localStorage.getItem(LOCAL_MSGS_KEY) || '[]'); }
  catch (e) { return []; }
}
function lsWriteMsgs(arr) {
  localStorage.setItem(LOCAL_MSGS_KEY, JSON.stringify(arr));
  window.dispatchEvent(new Event('local-msgs'));   // إشعار نفس الصفحة
}
function newLocalId() {
  return 'l_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
function notifyErr(msg) {
  if (typeof toast === 'function') toast(msg);
}

/* ============================================================
   واجهة موحدة للتعامل مع البيانات
   (تعمل مع Firebase أو محلياً)
   ============================================================ */
const Store = {

  /* ---------- مفتاح المحادثة الثابت بين شخصين ---------- */
  chatIdOf(a, b) {
    return [a, b].sort().join('__');
  },

  /* ---------- هل الرسالة صالحة لهذه المحادثة؟ ---------- */
  isValidMessage(msg) {
    return !!msg
      && CHAT_USERS.includes(msg.from)
      && CHAT_USERS.includes(msg.to)
      && msg.from !== msg.to;
  },

  /* ---------- مستمع رسائل محادثة واحدة ----------
     handlers: { added(msg,id), changed(msg,id), removed(msg,id) }
     يُرجع دالة لإيقاف الاستماع                                   */
  listenChat(chatId, handlers, limit) {
    const h = handlers || {};
    limit = limit || 50;

    if (fbReady) {
      const ref = fbDB.ref('chats/' + chatId + '/messages').orderByKey().limitToLast(limit);
      const onAdd = ref.on('child_added',   s => h.added   && h.added(s.val(), s.key));
      const onChg = ref.on('child_changed', s => h.changed && h.changed(s.val(), s.key));
      const onRem = ref.on('child_removed', s => h.removed && h.removed(s.val(), s.key));
      /* حدث 'value' يصل بعد كل الرسائل الأولية → نعرضها دفعة واحدة */
      ref.once('value', () => h.ready && h.ready());
      return () => {
        ref.off('child_added', onAdd);
        ref.off('child_changed', onChg);
        ref.off('child_removed', onRem);
      };
    }

    /* محلي: نقارن الحالة الحالية بما سبق عرضه (إضافة / تغيير / حذف) */
    const known = new Map();
    const sync = () => {
      const mine = lsReadMsgs().filter(m => m.chatId === chatId);
      const seen = new Set();
      mine.forEach(m => {
        seen.add(m._id);
        const sig = JSON.stringify(m);
        if (!known.has(m._id)) {
          known.set(m._id, sig);
          h.added && h.added(m, m._id);
        } else if (known.get(m._id) !== sig) {
          known.set(m._id, sig);
          h.changed && h.changed(m, m._id);
        }
      });
      [...known.keys()].forEach(id => {
        if (!seen.has(id)) {
          known.delete(id);
          h.removed && h.removed(null, id);
        }
      });
    };
    const onStorage = e => { if (e.key === LOCAL_MSGS_KEY) sync(); };
    window.addEventListener('storage', onStorage);     // تبويب/نافذة أخرى
    window.addEventListener('local-msgs', sync);       // نفس الصفحة
    sync();
    setTimeout(() => h.ready && h.ready(), 0);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('local-msgs', sync);
    };
  },

  /* ---------- إرسال رسالة ---------- */
  async sendMessage(chatId, msg) {
    /* حماية: يجب أن يطابق المفتاح الطرفين تماماً */
    if (!Store.isValidMessage(msg) || Store.chatIdOf(msg.from, msg.to) !== chatId) {
      console.error('[Store] رسالة بطرفين غير صحيحين — تم رفضها', chatId, msg);
      return false;
    }
    /* إزالة قيم undefined (Firebase يرفضها) */
    const clean = JSON.parse(JSON.stringify(msg));
    clean.chatId = chatId;
    clean.timestamp = Date.now();

    try {
      if (fbReady) {
        await fbDB.ref('chats/' + chatId + '/messages').push(clean);
      } else {
        clean._id = newLocalId();
        const msgs = lsReadMsgs();
        msgs.push(clean);
        lsWriteMsgs(msgs);
      }
      return true;
    } catch (e) {
      console.error('[Store] فشل الإرسال:', e);
      return false;
    }
  },

  /* ---------- تحديث رسالة (تعديل نص / كشف تغبيش ...) ---------- */
  async updateMessage(chatId, id, patch) {
    if (fbReady) {
      await fbDB.ref('chats/' + chatId + '/messages/' + id).update(patch);
      return true;
    }
    const msgs = lsReadMsgs();
    const m = msgs.find(x => x._id === id && x.chatId === chatId);
    if (!m) return false;
    Object.assign(m, patch);
    lsWriteMsgs(msgs);
    return true;
  },

  /* ---------- حذف رسالة نهائياً ---------- */
  async deleteMessage(chatId, id, msg) {
    if (fbReady) {
      await fbDB.ref('chats/' + chatId + '/messages/' + id).remove();
      if (msg && msg.mediaKey) { fbDB.ref('media/' + chatId + '/' + msg.mediaKey).remove().catch(() => {}); }
      /* محاولة حذف المرفق من التخزين (اختياري، لا يوقف الحذف عند الفشل) */
      try {
        if (msg && msg.url && /^https?:/.test(msg.url) && fbStorage) {
          await fbStorage.refFromURL(msg.url).delete();
        }
      } catch (e) { /* تجاهل */ }
      return true;
    }
    const msgs = lsReadMsgs().filter(x => !(x._id === id && x.chatId === chatId));
    lsWriteMsgs(msgs);
    return true;
  },

  /* ---------- تفاعل (إضافة/إزالة) ---------- */
  async toggleReaction(chatId, id, emo, user) {
    if (fbReady) {
      await fbDB.ref('chats/' + chatId + '/messages/' + id + '/reactions/' + emo)
        .transaction(cur => {
          cur = Array.isArray(cur) ? cur.slice() : (cur ? Object.values(cur) : []);
          const i = cur.indexOf(user);
          if (i >= 0) cur.splice(i, 1); else cur.push(user);
          return cur.length ? cur : null;
        });
      return true;
    }
    const msgs = lsReadMsgs();
    const m = msgs.find(x => x._id === id && x.chatId === chatId);
    if (!m) return false;
    m.reactions = m.reactions || {};
    m.reactions[emo] = m.reactions[emo] || [];
    const k = m.reactions[emo].indexOf(user);
    if (k >= 0) m.reactions[emo].splice(k, 1); else m.reactions[emo].push(user);
    if (!m.reactions[emo].length) delete m.reactions[emo];
    lsWriteMsgs(msgs);
    return true;
  },

  /* ---------- هل الموقع متصل بـ Firebase فعلاً؟ ---------- */
  isOnline() { return fbReady; },
  status() { return { ready: fbReady, error: fbError, connected: fbConnected }; },

  /* ---------- إعادة الاتصال (لزر التحديث) ---------- */
  reconnect() {
    if (fbReady) { try { fbDB.goOffline(); fbDB.goOnline(); } catch (e) {} }
  },

  /* ---------- مسح الشات بالكامل (عند الطرفين) ---------- */
  async clearChat(chatId, msgs) {
    if (fbReady) {
      await fbDB.ref('chats/' + chatId + '/messages').remove();
      fbDB.ref('media/' + chatId).remove().catch(() => {});
      /* حذف المرفقات من التخزين (اختياري) */
      try {
        for (const m of (msgs || [])) {
          if (m && m.url && /^https?:/.test(m.url) && fbStorage) {
            fbStorage.refFromURL(m.url).delete().catch(() => {});
          }
        }
      } catch (e) { /* تجاهل */ }
      return true;
    }
    lsWriteMsgs(lsReadMsgs().filter(x => x.chatId !== chatId));
    return true;
  },

  /* ---------- ترحيل الرسائل القديمة (مرة واحدة) ----------
     القديم: messages/{id}  ← الجديد: chats/{chatId}/messages/{id}  */
  async migrateLegacy() {
    const fix = m => {
      if (!m || !CHAT_USERS.includes(m.from)) return null;
      const other = CHAT_USERS.find(u => u !== m.from);
      const to = (CHAT_USERS.includes(m.to) && m.to !== m.from) ? m.to : other;
      return { ...m, to, chatId: Store.chatIdOf(m.from, to) };
    };
    try {
      if (fbReady) {
        const flag = await fbDB.ref('meta/migratedV2').once('value');
        if (flag.val()) return;
        const snap = await fbDB.ref('messages').once('value');
        const old = snap.val() || {};
        const updates = {};
        Object.keys(old).forEach(k => {
          const f = fix(old[k]);
          if (f) updates['chats/' + f.chatId + '/messages/' + k] = JSON.parse(JSON.stringify(f));
        });
        if (Object.keys(updates).length) await fbDB.ref().update(updates);
        await fbDB.ref('meta/migratedV2').set(true);
      } else {
        if (localStorage.getItem('local_migrated_v2')) return;
        const old = JSON.parse(localStorage.getItem('local_msgs') || '[]');
        if (old.length) {
          const cur = lsReadMsgs();
          old.forEach((m, i) => {
            const f = fix(m);
            if (f) { f._id = 'l_old_' + i; cur.push(f); }
          });
          lsWriteMsgs(cur);
        }
        localStorage.setItem('local_migrated_v2', '1');
      }
    } catch (e) {
      console.warn('[Store] تعذّر ترحيل الرسائل القديمة:', e);
    }
  },

  /* ---------- مستمع المستخدمين (يُرجع دالة إيقاف) ---------- */
  listenUsers(cb) {
    if (fbReady) {
      const ref = fbDB.ref('users');
      const fn = ref.on('value', snap => cb(snap.val() || {}));
      return () => ref.off('value', fn);
    }
    const read = () => { try { return JSON.parse(localStorage.getItem('local_users') || '{}'); } catch (e) { return {}; } };
    const onStorage = e => { if (e.key === 'local_users') cb(read()); };
    const onLocal = () => cb(read());
    window.addEventListener('storage', onStorage);
    window.addEventListener('local-users', onLocal);
    cb(read());
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('local-users', onLocal);
    };
  },

  /* ---------- حفظ بيانات المستخدم ---------- */
  saveUser(uid, data) {
    if (fbReady) {
      return fbDB.ref('users/' + uid).update(data);
    }
    const users = JSON.parse(localStorage.getItem('local_users') || '{}');
    users[uid] = { ...(users[uid] || {}), ...data };
    localStorage.setItem('local_users', JSON.stringify(users));
    window.dispatchEvent(new Event('local-users'));
    return Promise.resolve();
  },

  /* ---------- نبضة الحضور + معلومات الجهاز ---------- */
  heartbeat(uid, device) {
    const d = { lastSeen: Date.now(), online: true };
    if (device) d.device = device;
    return this.saveUser(uid, d);
  },
  updateLastSeen(uid) { return this.heartbeat(uid); },

  /* ---------- حضور فوري: يصبح غير متصل لحظة إغلاق الموقع ---------- */
  presence(uid) {
    if (!fbReady || !uid) return;
    try {
      const ref = fbDB.ref('users/' + uid);
      ref.onDisconnect()
        .update({ online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP })
        .then(() => ref.update({ online: true, lastSeen: Date.now() }))
        .catch(() => {});
    } catch (e) {}
  },

  /* ---------- حفظ اشتراك الإشعارات ---------- */
  savePush(uid, sub) {
    if (!fbReady || !uid || !sub) return;
    try { fbDB.ref('push/' + uid).set(JSON.parse(JSON.stringify(sub))).catch(() => {}); } catch (e) {}
  },

  /* ---------- تحميل رسائل أقدم (صفحة) ---------- */
  async loadOlder(chatId, beforeKey, n) {
    if (fbReady) {
      let q = fbDB.ref('chats/' + chatId + '/messages').orderByKey();
      if (beforeKey) q = q.endAt(beforeKey);
      const snap = await q.limitToLast(n + 1).once('value');
      const out = [];
      snap.forEach(c => { if (c.key !== beforeKey) out.push({ id: c.key, val: c.val() }); });
      return out;
    }
    const mine = lsReadMsgs().filter(m => m.chatId === chatId);
    const idx = beforeKey ? mine.findIndex(m => m._id === beforeKey) : mine.length;
    const end = idx < 0 ? mine.length : idx;
    return mine.slice(Math.max(0, end - n), end).map(m => ({ id: m._id, val: m }));
  },

  /* ---------- كل الرسائل (للبحث فقط) ---------- */
  async loadAll(chatId) {
    if (fbReady) {
      const snap = await fbDB.ref('chats/' + chatId + '/messages').orderByKey().once('value');
      const out = [];
      snap.forEach(c => { out.push({ ...c.val(), _id: c.key }); });
      return out;
    }
    return lsReadMsgs().filter(m => m.chatId === chatId);
  },

  /* ---------- رفع وسائط ----------
     1) Firebase Storage (إن كان مفعّلاً)
     2) إن فشل أو تأخر → نحفظ الملف داخل قاعدة البيانات (media/…) ويعمل دائماً
     يرجع { url } أو { mediaKey }                                            */
  async putMedia(chatId, file, onProgress) {
    const report = p => { try { onProgress && onProgress(Math.max(0, Math.min(1, p))); } catch (e) {} };
    report(0.02);

    if (fbReady && fbStorage) {
      try {
        const url = await new Promise((resolve, reject) => {
          const safe = (file.name || 'file').replace(/[^\w.\-]/g, '_').slice(-60);
          const task = fbStorage.ref('uploads/' + Date.now() + '_' + safe)
            .put(file, file.type ? { contentType: file.type } : undefined);
          let dog = null;
          const arm = ms => {
            clearTimeout(dog);
            dog = setTimeout(() => { try { task.cancel(); } catch (e) {} reject(new Error('stall')); }, ms);
          };
          arm(9000);
          task.on('state_changed',
            s => { arm(12000); report(0.02 + 0.96 * (s.bytesTransferred / Math.max(1, s.totalBytes))); },
            err => { clearTimeout(dog); reject(err); },
            async () => {
              clearTimeout(dog);
              try { resolve(await task.snapshot.ref.getDownloadURL()); } catch (e) { reject(e); }
            });
        });
        report(1);
        return { url };
      } catch (e) {
        console.warn('[Storage] تعذّر الرفع، سيتم الحفظ في قاعدة البيانات بدلاً منه:', e && e.message);
      }
    }

    /* البديل: base64 */
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onprogress = e => { if (e.lengthComputable) report(0.05 + 0.4 * (e.loaded / e.total)); };
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('read'));
      r.readAsDataURL(file);
    });
    report(0.5);
    if (!fbReady) { report(1); return { url: dataUrl }; }
    if (dataUrl.length > 9 * 1024 * 1024) throw new Error('big');
    const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await fbDB.ref('media/' + chatId + '/' + key).set(dataUrl);
    report(1);
    return { mediaKey: key };
  },

  /* ---------- جلب وسائط محفوظة في قاعدة البيانات ---------- */
  _mediaCache: new Map(),
  async getMedia(chatId, key) {
    const ck = chatId + '/' + key;
    if (this._mediaCache.has(ck)) return this._mediaCache.get(ck);
    if (!fbReady) return '';
    const snap = await fbDB.ref('media/' + ck).once('value');
    const v = snap.val() || '';
    if (v) this._mediaCache.set(ck, v);
    return v;
  },

  /* قديم (للتوافق) */
  async uploadFile(file, onProgress) {
    const r = await this.putMedia('legacy', file, onProgress);
    return r.url || '';
  }
};

/* التهيئة التلقائية */
initFirebase();
