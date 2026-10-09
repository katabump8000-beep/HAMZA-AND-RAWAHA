/* ============================================================
   firebase.js  (الإصدار 2 — إصلاح اقتران المحادثات + تعديل/حذف)
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
   حالة الاتصال
   ============================================================ */
let fbReady = false;
let fbDB = null;
let fbStorage = null;

function initFirebase() {
  if (!FIREBASE_CONFIG.databaseURL) {
    console.warn('[Firebase] لم يتم إعداد الاتصال — سيعمل الموقع محلياً');
    return false;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    fbDB = firebase.database();
    fbStorage = firebase.storage();
    fbReady = true;
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
  listenChat(chatId, handlers) {
    const h = handlers || {};

    if (fbReady) {
      const ref = fbDB.ref('chats/' + chatId + '/messages').orderByKey().limitToLast(300);
      const onAdd = ref.on('child_added',   s => h.added   && h.added(s.val(), s.key));
      const onChg = ref.on('child_changed', s => h.changed && h.changed(s.val(), s.key));
      const onRem = ref.on('child_removed', s => h.removed && h.removed(s.val(), s.key));
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

  /* ---------- إعادة الاتصال (لزر التحديث) ---------- */
  reconnect() {
    if (fbReady) { try { fbDB.goOffline(); fbDB.goOnline(); } catch (e) {} }
  },

  /* ---------- مسح الشات بالكامل (عند الطرفين) ---------- */
  async clearChat(chatId, msgs) {
    if (fbReady) {
      await fbDB.ref('chats/' + chatId + '/messages').remove();
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

  /* ---------- تحديث آخر ظهور ---------- */
  updateLastSeen(uid) {
    return this.saveUser(uid, { lastSeen: Date.now() });
  },

  /* ---------- رفع ملف (صورة/صوت/مستند) ---------- */
  async uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      if (fbReady) {
        const path = 'uploads/' + Date.now() + '_' + file.name;
        const ref = fbStorage.ref(path);
        const task = ref.put(file);
        task.on('state_changed',
          snap => { if (onProgress) onProgress(snap.bytesTransferred / snap.totalBytes); },
          err => reject(err),
          async () => { resolve(await task.snapshot.ref.getDownloadURL()); }
        );
      } else {
        // محلي: تحويل إلى Base64
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }
    });
  },

  /* ---------- حفظ/استرجاع المسودات ---------- */
  saveDraft(uid, dataUrl) {
    try { localStorage.setItem('draft_' + uid, dataUrl); } catch (e) {}
  },
  getDraft(uid) {
    return localStorage.getItem('draft_' + uid);
  },
  clearDraft(uid) {
    localStorage.removeItem('draft_' + uid);
  }
};

/* التهيئة التلقائية */
initFirebase();
