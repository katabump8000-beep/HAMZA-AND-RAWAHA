/* ============================================================
   firebase.js
   - إعداد الاتصال بالخادم (Realtime Database + Storage)
   - إذا لم تُملأ بيانات Firebase، يعمل الموقع محلياً
   ============================================================ */

/* ⚠️ ملاحظة مهمة:
   لكي يعمل الشات الحقيقي بين جهازين مختلفين، يجب إنشاء مشروع Firebase مجاني
   ثم لصق بياناتك في CONFIG أدناه.
   إذا تركت القيم فارغة، سيعمل الموقع بالوضع المحلي (نفس الجهاز فقط).
*/

const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

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
   واجهة موحدة للتعامل مع البيانات
   (تعمل مع Firebase أو محلياً)
   ============================================================ */
const Store = {

  /* ---------- مستمع الرسائل ---------- */
  listenMessages(cb) {
    if (fbReady) {
      fbDB.ref('messages').limitToLast(200).on('child_added', snap => {
        cb(snap.val(), snap.key);
      });
    } else {
      // محلي
      const msgs = JSON.parse(localStorage.getItem('local_msgs') || '[]');
      msgs.forEach((m, i) => cb(m, 'local_' + i));
      // استمع للتحديثات
      window.addEventListener('storage', e => {
        if (e.key === 'local_msgs') {
          const updated = JSON.parse(e.newValue || '[]');
          cb(updated[updated.length - 1], 'local_' + (updated.length - 1));
        }
      });
    }
  },

  /* ---------- إرسال رسالة ---------- */
  sendMessage(msg) {
    msg.timestamp = Date.now();
    if (fbReady) {
      fbDB.ref('messages').push(msg);
    } else {
      const msgs = JSON.parse(localStorage.getItem('local_msgs') || '[]');
      msgs.push(msg);
      localStorage.setItem('local_msgs', JSON.stringify(msgs));
      // إشعار الأحداث في نفس الصفحة
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'local_msgs',
        newValue: JSON.stringify(msgs)
      }));
    }
  },

  /* ---------- حذف/تحديث رسالة ---------- */
  updateMessage(id, patch) {
    if (fbReady) {
      fbDB.ref('messages/' + id).update(patch);
    } else {
      const msgs = JSON.parse(localStorage.getItem('local_msgs') || '[]');
      const i = parseInt(id.replace('local_', ''));
      if (msgs[i]) { Object.assign(msgs[i], patch); localStorage.setItem('local_msgs', JSON.stringify(msgs)); }
    }
  },

  /* ---------- مستمع المستخدمين ---------- */
  listenUsers(cb) {
    if (fbReady) {
      fbDB.ref('users').on('value', snap => cb(snap.val() || {}));
    } else {
      const users = JSON.parse(localStorage.getItem('local_users') || '{}');
      cb(users);
      window.addEventListener('storage', e => {
        if (e.key === 'local_users') cb(JSON.parse(e.newValue || '{}'));
      });
    }
  },

  /* ---------- حفظ بيانات المستخدم ---------- */
  saveUser(uid, data) {
    if (fbReady) {
      fbDB.ref('users/' + uid).update(data);
    } else {
      const users = JSON.parse(localStorage.getItem('local_users') || '{}');
      users[uid] = { ...(users[uid] || {}), ...data };
      localStorage.setItem('local_users', JSON.stringify(users));
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'local_users',
        newValue: JSON.stringify(users)
      }));
    }
  },

  /* ---------- تحديث آخر ظهور ---------- */
  updateLastSeen(uid) {
    this.saveUser(uid, { lastSeen: Date.now() });
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
    try { localStorage.setItem('draft_' + uid, dataUrl); } catch(e) {}
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