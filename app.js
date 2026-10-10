/* ============================================================
   app.js — الإصدار 5
   ============================================================ */

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = document.documentElement;

const PASSWORD = '67';
const USERS = {
  hamza:  { name:'حمزة', tag:'J.C' },
  rawaha: { name:'رواحة', tag:'Itachi' }
};
const AVATAR_COLORS = { hamza:'#7ab82a', rawaha:'#ff2d2d' };
const QUICK_MSG = '💙🩶🩵🤍💜 باي 🤎🧡💛💚❤️';
const PAGE = 40;                       // عدد الرسائل في كل صفحة تحميل

const THEME_COLORS = [
  { id:'1', v:'#ff2d2d' }, { id:'2', v:'#2d7fff' },
  { id:'3', v:'#ffd93d' }, { id:'4', v:'#2dff7f' },
  { id:'5', v:'#ff8a2d' }, { id:'6', v:'#a02dff' },
  { id:'7', v:'#ff2d9e' }, { id:'8', v:'#2dffd9' }
];
/* 12 لون للكتابة (زر تلوين) */
const TEXT_COLORS = [
  '#ff3b3b', '#ff8a2d', '#ffd93d', '#a3e635', '#2dff7f', '#2dffd9',
  '#38bdf8', '#2d7fff', '#a02dff', '#ff2d9e', '#d4af37', '#c0c0c0'
];

const State = {
  user: null,
  myName: '',
  note: '',
  others: {},              // كل بيانات المستخدمين (users/*)
  messages: {},            // الرسائل المحمّلة لكل محادثة
  ready: {},               // هل اكتمل التحميل الأول
  hasMore: {},             // هل توجد رسائل أقدم
  allMsgs: {},             // كاش كل الرسائل (للبحث)
  currentChat: null,
  replyTo: null,
  pendingBlur: false,
  themeColor: null,
  textColor: '',
  blocked: JSON.parse(localStorage.getItem('blocked') || '[]'),
  unsubs: [],
  usersUnsub: null,
  hbTimer: null,
  inboxBound: false,
  curAudio: null,
  loadingOlder: false,
  profileUid: null
};

let ACCENT = '#ff2d2d';        // لون الجزيئات

/* ============================================================
   0) أدوات عامة: اهتزاز + صوت الضغط + الوقت
   ============================================================ */
function haptic(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

/* صوت كل ضغطة زر (click.mp3 بجانب index.html) */
const Click = {
  pool: [], i: 0,
  init() {
    try {
      for (let k = 0; k < 3; k++) {
        const a = new Audio('click.mp3'); a.preload = 'auto'; a.volume = .55; this.pool.push(a);
      }
    } catch (e) {}
  },
  play() {
    if (!this.pool.length) return;
    const a = this.pool[this.i++ % this.pool.length];
    try { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
};
Click.init();
const CLICKABLE = 'button, .btn, .icon-btn, .opt-btn, .inbox-item, .menu-item, .search-item, .swatch, ' +
  '.identity-btn, .perm-item, .header-profile, .inbox-my-info, .color-chip, .size-step, .model-btn, .msg-reply, .aud-bars';
document.addEventListener('pointerdown', e => { if (e.target.closest(CLICKABLE)) Click.play(); }, true);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* وقت 12 ساعة (ص / م) */
function fmt12(ts) {
  const d = new Date(ts || Date.now());
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'م' : 'ص';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}
function fmtDate(ts) {
  const d = new Date(ts || Date.now());
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}
/* "منذ ..." */
function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return 'منذ لحظات';
  const m = s / 60;
  if (m < 60) {
    const v = m < 10 ? Math.round(m * 10) / 10 : Math.floor(m);
    return `منذ ${v}د`;
  }
  const h = m / 60;
  if (h < 24) return `منذ ${Math.floor(h)}س`;
  const d = h / 24;
  if (d < 30) return d < 2 ? 'منذ يوم' : `منذ ${Math.floor(d)} أيام`;
  const mo = d / 30;
  if (mo < 12) return mo < 2 ? 'منذ شهر' : `منذ ${Math.floor(mo)} أشهر`;
  const y = d / 365;
  return y < 2 ? 'منذ سنة' : `منذ ${Math.floor(y)} سنوات`;
}
function fmtDur(s) {
  s = Math.max(0, Math.round(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function hashStr(str) {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function withTimeout(p, ms) {
  return Promise.race([p, new Promise(res => setTimeout(() => res('timeout'), ms))]);
}

/* تحديث كل أزمنة "منذ" الظاهرة كل 10 ثوانٍ */
setInterval(() => {
  $$('[data-ts]').forEach(el => { el.textContent = ago(+el.dataset.ts); });
  if (State.currentChat) updateChatHeader(State.currentChat);
  if (State.profileUid && $('#profile-modal').classList.contains('open')) renderProfile();
}, 10000);

/* ============================================================
   1) نماذج الواجهة + حجم الخط (محفوظان على الجهاز)
   ============================================================ */
const MODELS = [
  { id:1, s:1.28, n:'الأزرار كبيرة جداً' },
  { id:2, s:1.14, n:'الأزرار كبيرة' },
  { id:3, s:1.00, n:'متوسطة (الأصلي)' },
  { id:4, s:0.88, n:'الأزرار صغيرة' },
  { id:5, s:0.77, n:'الأزرار صغيرة جداً' }
];
const FONT_STEPS = [0.80, 0.88, 0.95, 1.00, 1.08, 1.17, 1.28, 1.40, 1.55, 1.72];
const FONT_DEFAULT = 3;

function applyModel(id) {
  const m = MODELS.find(x => String(x.id) === String(id)) || MODELS[2];
  root.style.setProperty('--s', m.s);
  measureBars();
}
function applyFont(idx) {
  const v = FONT_STEPS[idx] != null ? FONT_STEPS[idx] : 1;
  root.style.setProperty('--fs', v);
}
/* نقيس ارتفاع الهيدر وشريط الكتابة فعلياً كي تقع اللوحات في مكانها الصحيح على أي شاشة/DPI */
function measureBars() {
  requestAnimationFrame(() => {
    const h = $('#chat-header'), f = $('#chat-input');
    if (h && h.offsetHeight) root.style.setProperty('--hdr-h', h.offsetHeight + 'px');
    if (f && f.offsetHeight) root.style.setProperty('--inp-h', f.offsetHeight + 'px');
  });
}
window.addEventListener('resize', measureBars);
window.addEventListener('orientationchange', () => setTimeout(measureBars, 250));

applyModel(localStorage.getItem('ui_model_v1') || '3');
applyFont(parseInt(localStorage.getItem('ui_font_v1') || String(FONT_DEFAULT), 10));

/* ---------- نوافذ منبثقة عامة ---------- */
function openSheet(id) {
  closeSheets();
  $('#' + id).classList.add('open');
  $('#sheet-backdrop').classList.add('open');
}
function closeSheets() {
  $$('.sheet.open').forEach(s => s.classList.remove('open'));
  $('#sheet-backdrop').classList.remove('open');
  State.profileUid = null;
}
$('#sheet-backdrop').addEventListener('click', closeSheets);
['model-close', 'font-close', 'pm-close', 'set-close'].forEach(id => $('#' + id).addEventListener('click', closeSheets));

function buildModelPop() {
  const box = $('#model-grid');
  const cur = localStorage.getItem('ui_model_v1') || '3';
  box.innerHTML = '';
  MODELS.forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'model-btn' + (String(m.id) === cur ? ' active' : '');
    const sz = Math.round(30 * m.s);
    b.innerHTML = `<span class="mb-n">نموذج ${m.id}</span><span class="mb-d">${m.n}</span>` +
      `<span class="mb-demo" style="width:${sz}px;height:${sz}px;font-size:${Math.round(14 * m.s)}px">⚙️</span>`;
    b.addEventListener('click', () => {
      localStorage.setItem('ui_model_v1', String(m.id));
      applyModel(m.id);
      buildModelPop();
      haptic(15);
      toast(`تم تطبيق نموذج ${m.id} ✔`);
    });
    box.appendChild(b);
  });
}
function buildFontPop() {
  const cur = parseInt(localStorage.getItem('ui_font_v1') || String(FONT_DEFAULT), 10);
  const row = $('#font-steps');
  row.innerHTML = '';
  FONT_STEPS.forEach((v, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'size-step' + (i === cur ? ' active' : '');
    b.style.fontSize = (11 + i * 2) + 'px';
    b.textContent = 'أ';
    b.addEventListener('click', () => {
      localStorage.setItem('ui_font_v1', String(i));
      applyFont(i);
      buildFontPop();
      haptic(10);
    });
    row.appendChild(b);
  });
  $('#font-label').textContent = `الحجم: ${Math.round(FONT_STEPS[cur] * 100)}%  (${cur + 1} / 10)`;
  $('#font-preview').style.fontSize = `calc(15px * var(--fs))`;
}

/* ============================================================
   2) معلومات الجهاز (للملف التعريفي): بطارية / شبكة / قوة الإنترنت
   ============================================================ */
const Device = {
  bat: null, rtt: null,
  async init() {
    try {
      if (navigator.getBattery) {
        this.bat = await navigator.getBattery();
        ['levelchange', 'chargingchange'].forEach(ev => this.bat.addEventListener(ev, pushDeviceSoon));
      }
    } catch (e) {}
    try { if (navigator.connection) navigator.connection.addEventListener('change', pushDeviceSoon); } catch (e) {}
    window.addEventListener('online',  () => { this.measure(); pushDeviceSoon(); });
    window.addEventListener('offline', pushDeviceSoon);
    this.measure();
    setInterval(() => this.measure(), 60000);
  },
  async measure() {
    if (!navigator.onLine) { this.rtt = null; return; }
    const t = performance.now();
    try {
      await fetch('https://www.google.com/generate_204', { mode:'no-cors', cache:'no-store' });
      this.rtt = Math.round(performance.now() - t);
    } catch (e) { this.rtt = null; }
  },
  netPref() {
    try { return JSON.parse(localStorage.getItem('net_pref_v1') || '{}'); } catch (e) { return {}; }
  },
  snapshot() {
    const c = navigator.connection || {};
    const p = this.netPref();
    let conn = 'unk';
    if (!navigator.onLine) conn = 'none';
    else if (p.mode === 'wifi') conn = 'wifi';
    else if (p.mode === 'cell') conn = 'cell';
    else if (c.type === 'wifi' || c.type === 'ethernet') conn = 'wifi';
    else if (c.type === 'cellular') conn = 'cell';
    const d = {
      conn,
      wifi: conn === 'wifi' ? (p.wifi || '') : '',
      eff: c.effectiveType || '',
      dl: typeof c.downlink === 'number' ? c.downlink : null,
      rtt: this.rtt,
      ts: Date.now()
    };
    if (this.bat) { d.bat = Math.round(this.bat.level * 100); d.chg = !!this.bat.charging; }
    return d;
  }
};
let devTimer = null;
function pushDeviceSoon() {
  clearTimeout(devTimer);
  devTimer = setTimeout(() => { if (State.user) Store.heartbeat(State.user, Device.snapshot()); }, 800);
}

/* حضور المستخدم: متصل / غير متصل */
function isOnlineUser(u) {
  return !!u && u.online === true && (Date.now() - (u.lastSeen || 0)) < 150000;
}

/* ============================================================
   3) الإشعارات (Service Worker + Push اختياري)
   ============================================================ */
function pushCfg() { return (typeof PUSH_CONFIG !== 'undefined') ? PUSH_CONFIG : null; }
function urlB64ToUint8Array(b) {
  const pad = '='.repeat((4 - b.length % 4) % 4);
  const raw = atob((b + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
const Notif = {
  reg: null,
  async init() {
    if (!('serviceWorker' in navigator)) return;
    try {
      this.reg = await navigator.serviceWorker.register('sw.js');
      const r = await navigator.serviceWorker.ready;
      if (r.active && State.user) r.active.postMessage({ type:'user', user: State.user });
    } catch (e) { console.warn('[SW]', e); }
    this.subscribe();
  },
  async subscribe() {
    try {
      const c = pushCfg();
      if (!this.reg || !c || !c.workerUrl || !State.user) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (!this.reg.pushManager) return;
      let sub = await this.reg.pushManager.getSubscription();
      if (!sub) sub = await this.reg.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(c.publicKey)
      });
      Store.savePush(State.user, sub.toJSON());
    } catch (e) { console.warn('[Push]', e); }
  },
  async show(title, body, other) {
    const opts = { body, tag:'msg-' + other, renotify:true, vibrate:[120, 60, 120], data:{ other } };
    try { if (this.reg && this.reg.showNotification) { await this.reg.showNotification(title, opts); return; } } catch (e) {}
    try { new Notification(title, opts); } catch (e) {}
  },
  /* نطلب من الخادم الصغير إرسال إشعار للطرف الآخر (يصل حتى لو الموقع مغلق) */
  ping(to) {
    try {
      const c = pushCfg();
      if (!c || !c.workerUrl) return;
      fetch(c.workerUrl, { method:'POST', headers:{ 'Content-Type':'text/plain' },
        body: JSON.stringify({ to, key: c.secret }), keepalive:true }).catch(() => {});
    } catch (e) {}
  }
};

/* ============================================================
   4) كلمة السر
   ============================================================ */
$('#btn-password').addEventListener('click', checkPassword);
$('#password-input').addEventListener('keydown', e => { if (e.key === 'Enter') checkPassword(); });

function checkPassword() {
  const v = $('#password-input').value.trim();
  if (v === PASSWORD) {
    $('#password-error').textContent = '';
    goTo(localStorage.getItem('perms_done') ? 'screen-identity' : 'screen-permissions');
  } else {
    $('#password-error').textContent = 'كلمة السر غير صحيحة';
    $('#password-input').value = '';
    shake($('#screen-password .glass-panel'));
    haptic([40, 30, 40]);
  }
}
function shake(el) {
  el.animate([
    { transform:'translateX(0)' }, { transform:'translateX(-10px)' },
    { transform:'translateX(10px)' }, { transform:'translateX(-6px)' }, { transform:'translateX(0)' }
  ], { duration:400 });
}

/* ============================================================
   5) الأذونات
   ============================================================ */
$('#bell-3d').addEventListener('click', requestAllPerms);
$('#btn-request-perms').addEventListener('click', requestAllPerms);
$('#btn-skip-perms').addEventListener('click', () => { localStorage.setItem('perms_done', '1'); goTo('screen-identity'); });

async function requestAllPerms() {
  const bell = $('#bell-3d');
  bell.classList.add('ringing');
  const results = await Promise.allSettled([
    requestNotifications(), requestMicrophone(), requestCamera(), requestStorage()
  ]);
  bell.classList.remove('ringing');
  const perms = ['notifications', 'microphone', 'camera', 'storage'];
  results.forEach((r, i) => {
    const el = $(`.perm-item[data-perm="${perms[i]}"]`);
    if (!el) return;
    el.classList.remove('granted', 'denied');
    if (r.status === 'fulfilled' && r.value) {
      el.classList.add('granted');
      el.querySelector('.perm-status').textContent = 'مسموح';
    } else {
      el.classList.add('denied');
      el.querySelector('.perm-status').textContent = 'مرفوض';
    }
  });
  const allOk = results.every(r => r.status === 'fulfilled' && r.value);
  localStorage.setItem('perms_done', '1');
  if (allOk) {
    $('#btn-request-perms').classList.add('done');
    $('#btn-request-perms').textContent = '✔ تم منح جميع الأذونات';
    setTimeout(() => goTo('screen-identity'), 700);
  } else {
    toast('بعض الأذونات مرفوضة — اضغط تخطي للمتابعة');
  }
}
async function requestNotifications() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}
async function requestMicrophone() {
  try { const s = await navigator.mediaDevices.getUserMedia({ audio:true }); s.getTracks().forEach(t => t.stop()); return true; } catch { return false; }
}
async function requestCamera() {
  try { const s = await navigator.mediaDevices.getUserMedia({ video:true }); s.getTracks().forEach(t => t.stop()); return true; } catch { return false; }
}
async function requestStorage() { return true; }

/* ============================================================
   6) الهوية والجلسة
   ============================================================ */
$$('.identity-btn').forEach(btn => btn.addEventListener('click', () => startSession(btn.dataset.user)));

function startSession(user) {
  State.user = user;
  State.myName = USERS[user].name;
  document.body.removeAttribute('style');
  document.body.dataset.theme = user;
  ACCENT = AVATAR_COLORS[user];
  const savedColor = localStorage.getItem('themeColor_' + user);
  State.themeColor = savedColor || null;
  const c = THEME_COLORS.find(x => x.id === savedColor);
  if (c) applyThemeColor(c.v);
  State.textColor = localStorage.getItem('tcolor_' + user) || '';
  applyTextColorUI();
  localStorage.setItem('session_v1', JSON.stringify({ user, t: Date.now() }));
  buildPalette();
  buildColorGrid();
  enterInbox();
  Notif.init();
  Device.init();
}

function logout() {
  stopListeners();
  State.user = null; State.currentChat = null; State.messages = {}; State.others = {}; State.note = '';
  localStorage.removeItem('session_v1');
  document.body.removeAttribute('style');
  delete document.body.dataset.theme;
  clearMessagesDom();
  $('#password-input').value = '';
  closeSheets();
  $('#palette-bar').classList.remove('open');
  closeSearch();
  goTo('screen-password');
}

/* ============================================================
   7) المستمعون وقائمة المحادثات
   ============================================================ */
function stopListeners() {
  State.unsubs.forEach(fn => { try { fn(); } catch (e) {} });
  State.unsubs = [];
  if (State.usersUnsub) { try { State.usersUnsub(); } catch (e) {} State.usersUnsub = null; }
  clearInterval(State.hbTimer);
  State.hbTimer = null;
}

function belongsToChat(msg, me, other) {
  return !!msg && ((msg.from === me && msg.to === other) || (msg.from === other && msg.to === me));
}
function isViewing(other) {
  return State.currentChat === other && $('#screen-chat').classList.contains('active') && !document.hidden;
}

/* رسالة واردة: وصلت (أخضر) ثم شوهدت إن كان الشات مفتوحاً */
function handleIncoming(m, other, id) {
  const chatId = Store.chatIdOf(State.user, other);
  const patch = {};
  const first = !m.delivered;
  if (!m.delivered) { patch.delivered = true; patch.deliveredAt = Date.now(); m.delivered = true; }
  if (!m.seen && isViewing(other)) { patch.seen = true; patch.seenAt = Date.now(); m.seen = true; }
  if (Object.keys(patch).length) Store.updateMessage(chatId, id, patch).catch(() => {});
  if (first && State.ready[other]) {
    if (!isViewing(other)) notifyIncoming(m, other); else haptic(25);
  }
}
function notifyIncoming(m, other) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if ((Date.now() - (m.timestamp || 0)) > 120000) return;
    let body;
    if (m.blur && !m.revealed) body = '🌫️ رسالة مغبشة';
    else body = m.type === 'image' ? '📷 صورة' : m.type === 'audio' ? '🎵 تسجيل صوتي'
              : m.type === 'file' ? '📄 ' + (m.fileName || 'ملف') : (m.text || '');
    Notif.show((State.others[other] || {}).name || USERS[other].name, body, other);
  } catch (e) {}
}
function markAllSeen(other) {
  if (!isViewing(other)) return;
  const chatId = Store.chatIdOf(State.user, other);
  (State.messages[other] || []).forEach(m => {
    if (m.to === State.user && !m.seen) {
      m.seen = true;
      Store.updateMessage(chatId, m._id, { seen: true, seenAt: Date.now(), delivered: true }).catch(() => {});
    }
  });
  scheduleInbox();
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (State.currentChat) markAllSeen(State.currentChat);
    if (State.user) pushDeviceSoon();
  }
});

function onChatMessage(kind, other, msg, id) {
  const list = State.messages[other] || (State.messages[other] = []);
  const idx = list.findIndex(m => m._id === id);

  if (kind === 'removed') {
    if (idx >= 0) list.splice(idx, 1);
    if (State.currentChat === other) removeMessageRow(id);
    scheduleInbox();
    return;
  }
  if (!belongsToChat(msg, State.user, other)) return;
  if (State.blocked.includes(msg.from)) return;

  const full = { ...msg, _id: id };
  if (idx >= 0) list[idx] = full; else list.push(full);
  if (full.to === State.user) handleIncoming(full, other, id);

  if (State.ready[other] && State.currentChat === other) {
    const box = $('#messages');
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 180;
    renderMessage(full, id, { animate: kind === 'added' });
    if (kind === 'added' && (near || full.from === State.user)) scrollToBottom();
  }
  scheduleInbox();
}

function enterInbox() {
  goTo('screen-inbox');
  initInbox();
  State.currentChat = null;
  loadMyProfileCache();
  updateModeBanner();
  startListeners();
}

let bannerTimer = null;
function updateModeBanner() {
  const b = $('#mode-banner'); if (!b) return;
  const st = Store.status();
  clearTimeout(bannerTimer);
  b.classList.remove('ok');
  if (!st.ready) {
    b.style.display = 'block';
    b.textContent = st.error === 'no-sdk'
      ? '⚠️ تعذّر تحميل مكتبة Firebase — تحقق من الإنترنت أو جرّب إيقاف/تشغيل VPN ثم أعد تحميل الصفحة'
      : '⚠️ الوضع المحلي: الرسائل لن تصل لجهاز آخر — يلزم ملء إعدادات Firebase في firebase.js';
  } else if (!st.connected) {
    b.style.display = 'block';
    b.textContent = '🟡 جاري الاتصال بالخادم...';
  } else {
    b.style.display = 'block'; b.classList.add('ok');
    b.textContent = '🟢 متصل بالخادم';
    bannerTimer = setTimeout(() => { b.style.display = 'none'; }, 2500);
  }
}
window.addEventListener('fb-conn', () => {
  if (!State.user) return;
  updateModeBanner();
  if (Store.status().connected) { Store.presence(State.user); pushDeviceSoon(); }
});

function startListeners() {
  stopListeners();
  State.messages = {}; State.ready = {}; State.hasMore = {}; State.allMsgs = {};

  Store.presence(State.user);
  Store.heartbeat(State.user, Device.snapshot());
  State.hbTimer = setInterval(() => Store.heartbeat(State.user, Device.snapshot()), 25000);

  State.usersUnsub = Store.listenUsers(users => {
    State.others = users || {};
    scheduleInbox();
    updateMyHeaderFromUsers();
    refreshAvatars();
    if (State.currentChat) updateChatHeader(State.currentChat);
    if (State.profileUid && $('#profile-modal').classList.contains('open')) renderProfile();
  });

  Store.migrateLegacy();

  Object.keys(USERS).filter(u => u !== State.user).forEach(other => {
    const chatId = Store.chatIdOf(State.user, other);
    const unsub = Store.listenChat(chatId, {
      added:   (msg, id) => onChatMessage('added',   other, msg, id),
      changed: (msg, id) => onChatMessage('changed', other, msg, id),
      removed: (msg, id) => onChatMessage('removed', other, msg, id),
      ready: () => {
        State.ready[other] = true;
        State.hasMore[other] = (State.messages[other] || []).length >= PAGE + 10;
        if (State.currentChat === other) renderAllMessages(other);
        scheduleInbox();
      }
    }, PAGE + 10);
    State.unsubs.push(unsub);
  });
}

function refreshData(btn) {
  if (!State.user) return;
  Store.reconnect();
  startListeners();
  if (State.currentChat) { clearMessagesDom(); }
  if (btn) { btn.classList.remove('spin-once'); void btn.offsetWidth; btn.classList.add('spin-once'); }
  toast('🔄 تم تحديث الشات ✔');
}

function initInbox() {
  const me = State.user;
  setAvatarEl($('#inbox-my-avatar'), '', me);
  $('#inbox-my-name').textContent = USERS[me].name;

  if (State.inboxBound) return;
  State.inboxBound = true;
  $('#btn-inbox-settings').addEventListener('click', openSettings);
  $('#inbox-my-info').addEventListener('click', openSettings);
  $('#btn-inbox-refresh').addEventListener('click', e => refreshData(e.currentTarget));
  $('#btn-tools').addEventListener('click', () => toast('قيد التطوير عبر الجيسي قريبا...'));
  $('#btn-models').addEventListener('click', () => { buildModelPop(); openSheet('model-pop'); });
  $('#btn-font').addEventListener('click', () => { buildFontPop(); openSheet('font-pop'); });
}

/* صورة المستخدم أو حرفه الأول */
function setAvatarEl(el, url, uid) {
  if (!el) return;
  if (url) {
    if (el._av !== url) {
      el.innerHTML = '';
      const i = new Image(); i.src = url; i.alt = ''; i.decoding = 'async';
      el.appendChild(i); el._av = url; el.style.background = '';
    }
  } else {
    el._av = '';
    const nm = (State.others[uid] && State.others[uid].name) || (USERS[uid] && USERS[uid].name) || '?';
    el.textContent = nm[0];
    el.style.background = AVATAR_COLORS[uid] || '';
  }
}
function refreshAvatars() {
  $$('#messages .msg-row').forEach(r => {
    const uid = r.dataset.from;
    setAvatarEl(r.querySelector('.msg-avatar'), (State.others[uid] || {}).avatar || '', uid);
  });
  const sp = $('#set-avatar-preview');
  if (sp && State.user) setAvatarEl(sp, (State.others[State.user] || {}).avatar || '', State.user);
}

function loadMyProfileCache() {
  const me = State.user;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('profile_' + me) || '{}'); } catch (e) {}
  if (saved.name) { State.myName = saved.name; $('#inbox-my-name').textContent = saved.name; }
  if (saved.note != null) { State.note = saved.note; $('#inbox-my-note').textContent = saved.note || 'متصل الآن'; }
  if (saved.avatar) setAvatarEl($('#inbox-my-avatar'), saved.avatar, me);
}
function updateMyHeaderFromUsers() {
  const me = State.user; if (!me) return;
  const u = State.others[me] || {};
  if (u.name) { State.myName = u.name; $('#inbox-my-name').textContent = u.name; }
  State.note = u.note || '';
  $('#inbox-my-note').textContent = u.note || 'متصل الآن';
  setAvatarEl($('#inbox-my-avatar'), u.avatar || '', me);
  if (u.name || u.avatar || u.note != null) {
    try { localStorage.setItem('profile_' + me, JSON.stringify({ name: u.name || '', note: u.note || '', avatar: u.avatar || '' })); } catch (e) {}
  }
}

let inboxQueued = false;
function scheduleInbox() {
  if (inboxQueued) return;
  inboxQueued = true;
  requestAnimationFrame(() => { inboxQueued = false; renderInbox(); });
}
function tickHtml(m) {
  return `<span class="tk ${m.delivered ? 'ok' : 'no'}">√</span>`;
}
function renderInbox() {
  const me = State.user;
  if (!me) return;
  const list = $('#inbox-list');
  list.innerHTML = '';
  Object.keys(USERS).filter(u => u !== me).forEach(uid => {
    const u = State.others[uid] || {};
    const info = USERS[uid];
    const msgs = State.messages[uid] || [];
    const last = msgs[msgs.length - 1];
    const unread = msgs.filter(m => m.to === me && !m.seen).length;
    const online = isOnlineUser(u);

    const el = document.createElement('div');
    el.className = 'inbox-item' + (online ? ' online' : '') + (unread ? ' has-unread' : '');
    el.innerHTML = `
      <div class="inbox-item-avatar"><span class="online-dot"></span></div>
      <div class="inbox-item-body">
        <div class="inbox-item-name">${escapeHtml(u.name || info.name)}
          ${online ? '<span class="st-text on">متصل</span>' : '<span class="st-pill off">غير متصل</span>'}</div>
        ${u.note ? `<div class="inbox-item-note">💭 ${escapeHtml(u.note)}</div>` : ''}
        <div class="inbox-item-last">${unread ? '✉️ ' : (last && last.from === me ? tickHtml(last) + ' ' : '')}${last ? previewMsg(last) : 'ابدأ المحادثة...'}</div>
      </div>
      <div class="inbox-item-meta">
        ${last ? `<span class="inbox-item-time" data-ts="${last.timestamp || ''}">${ago(last.timestamp)}</span>` : ''}
        ${unread ? `<span class="inbox-item-unread">${unread}</span>` : ''}
      </div>`;
    const av = el.querySelector('.inbox-item-avatar');
    const img = u.avatar ? new Image() : null;
    if (img) { img.src = u.avatar; img.alt = ''; av.insertBefore(img, av.firstChild); }
    else { av.insertBefore(document.createTextNode((u.name || info.name)[0]), av.firstChild); av.style.background = AVATAR_COLORS[uid]; }
    el.addEventListener('click', () => openChat(uid));
    list.appendChild(el);
  });
}
function previewMsg(m) {
  if (m.blur && !m.revealed) return '🌫️ رسالة مغبشة';
  if (m.type === 'image') return '📷 صورة';
  if (m.type === 'audio') return '🎵 تسجيل صوتي';
  if (m.type === 'file') return '📄 ' + escapeHtml(m.fileName || 'ملف');
  return escapeHtml((m.text || '').slice(0, 40));
}

/* ============================================================
   8) فتح الشات + الترويسة
   ============================================================ */
const Rows = new Map();          // id → عنصر الصف
function clearMessagesDom() { $('#messages').innerHTML = ''; Rows.clear(); }

function openChat(uid) {
  State.currentChat = uid;
  goTo('screen-chat');
  closeSearch(); closeSheets();
  $('#chat-menu').classList.remove('open');
  $('#color-pop').classList.remove('open');
  updateChatHeader(uid);
  if (State.ready[uid]) renderAllMessages(uid);
  else { clearMessagesDom(); $('#messages').innerHTML = '<div class="msgs-loading">⏳ جار تحميل الرسائل...</div>'; }
  measureBars();
  refreshDraftDot();
  applyTextColorUI();
}

function renderAllMessages(uid) {
  clearMessagesDom();
  const frag = document.createDocumentFragment();
  (State.messages[uid] || []).forEach(m => {
    const row = buildRow(m, m._id, { noAnim: true });
    Rows.set(m._id, row);
    frag.appendChild(row);
  });
  $('#messages').appendChild(frag);
  refreshOlderBox(uid);
  scrollToBottom();
  markAllSeen(uid);
}

/* زر "تحميل رسائل أقدم" أعلى القائمة */
function refreshOlderBox(uid) {
  const box = $('#messages');
  let ob = $('#older-box');
  if (State.hasMore[uid]) {
    if (!ob) {
      ob = document.createElement('button');
      ob.id = 'older-box'; ob.type = 'button'; ob.className = 'older-box';
      ob.addEventListener('click', () => loadOlder(State.currentChat));
      box.prepend(ob);
    }
    ob.textContent = State.loadingOlder ? '⏳ جار التحميل...' : '⬆ تحميل رسائل أقدم';
  } else if (ob) ob.remove();
}
$('#messages').addEventListener('scroll', e => {
  const m = e.currentTarget;
  if (m.scrollTop < 60 && State.currentChat && State.hasMore[State.currentChat] && !State.loadingOlder) loadOlder(State.currentChat);
}, { passive:true });

async function loadOlder(uid) {
  if (!uid || State.loadingOlder || !State.hasMore[uid]) return;
  State.loadingOlder = true;
  refreshOlderBox(uid);
  const list = State.messages[uid] || (State.messages[uid] = []);
  try {
    const chatId = Store.chatIdOf(State.user, uid);
    const items = await Store.loadOlder(chatId, list[0] ? list[0]._id : null, PAGE);
    const add = [];
    items.forEach(({ id, val }) => {
      if (!belongsToChat(val, State.user, uid) || State.blocked.includes(val.from)) return;
      if (list.some(m => m._id === id)) return;
      add.push({ ...val, _id: id });
    });
    list.unshift(...add);
    State.hasMore[uid] = items.length >= PAGE;
    if (State.currentChat === uid) {
      const box = $('#messages');
      const prevH = box.scrollHeight, prevT = box.scrollTop;
      prependRows(add);
      box.scrollTop = prevT + (box.scrollHeight - prevH);
    }
  } catch (e) { console.error(e); toast('تعذّر تحميل الرسائل الأقدم'); }
  State.loadingOlder = false;
  refreshOlderBox(uid);
}
function prependRows(msgs) {
  if (!msgs.length) return;
  const frag = document.createDocumentFragment();
  msgs.forEach(m => {
    const row = buildRow(m, m._id, { noAnim: true });
    Rows.set(m._id, row);
    frag.appendChild(row);
  });
  const ob = $('#older-box');
  if (ob) ob.after(frag); else $('#messages').prepend(frag);
}

function updateChatHeader(uid) {
  const info = USERS[uid];
  const u = State.others[uid] || {};
  $('#hdr-name').textContent = u.name || info.name;
  setAvatarEl($('#hdr-avatar'), u.avatar || '', uid);
  const n = $('#hdr-note');
  n.textContent = u.note ? '💭 ' + u.note : '';
  n.style.display = u.note ? 'block' : 'none';
  const el = $('#hdr-status');
  if (isOnlineUser(u)) { el.textContent = 'متصل'; el.className = 'hdr-status online'; }
  else { el.textContent = u.lastSeen ? 'غير متصل · ' + ago(u.lastSeen) : 'غير متصل'; el.className = 'hdr-status offline'; }
}

$('#btn-back').addEventListener('click', () => {
  State.currentChat = null;
  closeSearch(); closeSheets();
  $('#chat-menu').classList.remove('open');
  $('#color-pop').classList.remove('open');
  clearMessagesDom();
  goTo('screen-inbox');
  scheduleInbox();
});

/* ============================================================
   9) الألوان (لون الموقع) + لون الكتابة (تلوين)
   ============================================================ */
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`;
}
function applyThemeColor(hex) {
  ACCENT = hex;
  const st = document.body.style;
  st.setProperty('--accent', hex);
  st.setProperty('--edge', `color-mix(in srgb, ${hex} 50%, #000)`);
  st.setProperty('--edge-glow', hexToRgba(hex, .5));
  st.setProperty('--bubble-me', `color-mix(in srgb, ${hex} 16%, #050505)`);
  st.setProperty('--bubble-me-border', hex);
  st.setProperty('--bubble-other', `color-mix(in srgb, ${hex} 7%, #060606)`);
  st.setProperty('--bubble-other-border', `color-mix(in srgb, ${hex} 42%, #000)`);
  st.setProperty('--bg-1', `color-mix(in srgb, ${hex} 4%, #030303)`);
  st.setProperty('--bg-2', `color-mix(in srgb, ${hex} 11%, #050505)`);
  st.setProperty('--ov1', `color-mix(in srgb, ${hex} 10%, rgba(5,5,5,.74))`);
  st.setProperty('--ov2', `color-mix(in srgb, ${hex} 14%, rgba(5,5,5,.85))`);
}
function colorWave(x, y, hex) {
  ['', ' ring'].forEach(extra => {
    const w = document.createElement('div');
    w.className = 'color-wave' + extra;
    w.style.left = x + 'px'; w.style.top = y + 'px';
    if (!extra) w.style.background = `radial-gradient(circle, ${hex} 0%, ${hex}00 70%)`;
    document.body.appendChild(w);
    setTimeout(() => w.remove(), 1200);
  });
}
function buildPalette() {
  const wrap = $('#palette-colors');
  wrap.innerHTML = '';
  THEME_COLORS.forEach(c => {
    const s = document.createElement('div');
    s.className = 'swatch' + (c.id === State.themeColor ? ' active' : '');
    s.style.background = c.v;
    s.addEventListener('click', () => {
      State.themeColor = c.id;
      applyThemeColor(c.v);
      const r = s.getBoundingClientRect();
      colorWave(r.left + r.width / 2, r.top + r.height / 2, c.v);
      $$('.palette-colors .swatch').forEach(x => x.classList.toggle('active', x === s));
      localStorage.setItem('themeColor_' + State.user, c.id);
      haptic(12);
      toast('تم تغيير اللون ✔');
    });
    wrap.appendChild(s);
  });
}
$('#btn-palette').addEventListener('click', e => {
  e.stopPropagation();
  $('#palette-bar').classList.toggle('open');
  $('#chat-menu').classList.remove('open');
  $('#color-pop').classList.remove('open');
  closeSheets();
});
$('#btn-palette-close').addEventListener('click', () => $('#palette-bar').classList.remove('open'));

/* ----- لون الكتابة الثابت ----- */
function buildColorGrid() {
  const g = $('#color-grid');
  g.innerHTML = '';
  TEXT_COLORS.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'color-chip' + (State.textColor === c ? ' active' : '');
    b.style.background = c; b.style.color = c;
    b.addEventListener('click', e => {
      e.stopPropagation();
      setTextColor(c);
      $('#color-pop').classList.remove('open');
      haptic(15);
      toast('تم تثبيت لون الكتابة ✔');
    });
    g.appendChild(b);
  });
}
function setTextColor(c) {
  State.textColor = c || '';
  if (State.user) localStorage.setItem('tcolor_' + State.user, State.textColor);
  applyTextColorUI();
  buildColorGrid();
}
function applyTextColorUI() {
  const inp = $('#msg-input');
  if (inp) inp.style.color = State.textColor || '';
  const dot = $('#opt-color-dot');
  if (dot) { dot.textContent = State.textColor ? '●' : '🎨'; dot.style.color = State.textColor || ''; }
}
$('#color-none').addEventListener('click', e => {
  e.stopPropagation();
  setTextColor('');
  $('#color-pop').classList.remove('open');
  toast('تم إلغاء لون الكتابة');
});

/* ============================================================
   10) عرض الرسائل
   ============================================================ */
function makeAvatar(msg) {
  const av = document.createElement('div');
  av.className = 'msg-avatar';
  setAvatarEl(av, (State.others[msg.from] || {}).avatar || '', msg.from);
  return av;
}

function parseColorCodes(text) {      // للرسائل القديمة فقط (~1نص~)
  const safe = escapeHtml(text);
  return safe.replace(/~(\d{1,2})([^~]+)~/g, (_, n, t) => {
    const i = parseInt(n);
    if (i < 1 || i > 12) return `~${n}${t}~`;
    return `<span class="tc${i}">${t}</span>`;
  }).replace(/\n/g, '<br>');
}

async function mediaUrl(msg) {
  if (msg.url) return msg.url;
  if (msg.mediaKey) return Store.getMedia(Store.chatIdOf(msg.from, msg.to), msg.mediaKey);
  return '';
}

function buildAudio(msg, id) {
  const w = document.createElement('div');
  w.className = 'aud';
  const seed = hashStr(String(id || msg.timestamp || 'x'));
  let bars = '';
  for (let i = 0; i < 30; i++) bars += `<i style="height:${Math.round(24 + Math.abs(Math.sin(seed + i * 1.7)) * 70)}%"></i>`;
  w.innerHTML = `<div class="aud-lbl">🎧 استمع إليها</div>
    <div class="aud-row"><button type="button" class="aud-play">▶</button>
    <div class="aud-bars">${bars}</div><span class="aud-time">${fmtDur(msg.dur || 0)}</span></div>`;
  const btn = w.querySelector('.aud-play'), barsEl = w.querySelector('.aud-bars'), timeEl = w.querySelector('.aud-time');
  const bs = [...barsEl.children];
  const a = new Audio(); a.preload = 'none';
  let loaded = false;
  const dur = () => (isFinite(a.duration) && a.duration > 0) ? a.duration : (msg.dur || 0);
  const paint = p => { const on = Math.round(p * bs.length); bs.forEach((b, i) => b.classList.toggle('on', i < on)); };
  async function ensure() {
    if (loaded) return true;
    btn.textContent = '⏳';
    let u = '';
    try { u = await mediaUrl(msg); } catch (e) {}
    if (!u) { btn.textContent = '▶'; toast('تعذّر تحميل الصوت'); return false; }
    a.src = u; loaded = true; return true;
  }
  btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!a.paused) { a.pause(); return; }
    if (!(await ensure())) return;
    if (State.curAudio && State.curAudio !== a) State.curAudio.pause();
    State.curAudio = a;
    try { await a.play(); } catch (err) { btn.textContent = '▶'; toast('تعذّر تشغيل الصوت'); }
  });
  a.addEventListener('play',  () => { btn.textContent = '⏸'; w.classList.add('playing'); });
  a.addEventListener('pause', () => { btn.textContent = '▶'; w.classList.remove('playing'); });
  a.addEventListener('ended', () => { btn.textContent = '▶'; w.classList.remove('playing'); paint(0); timeEl.textContent = fmtDur(dur()); });
  a.addEventListener('timeupdate', () => { const d = dur(); if (d) paint(a.currentTime / d); timeEl.textContent = fmtDur(a.currentTime); });
  barsEl.addEventListener('click', async e => {
    e.stopPropagation();
    if (!(await ensure())) return;
    const r = barsEl.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (r.right - e.clientX) / r.width));   // RTL
    const d = dur();
    if (d) { try { a.currentTime = frac * d; } catch (err) {} }
    if (a.paused) btn.click();
  });
  return w;
}

function buildContent(msg, id, blurred) {
  const content = document.createElement('div');
  content.className = 'msg-content';
  if (msg.type === 'image') {
    const img = document.createElement('img');
    img.className = 'msg-image'; img.alt = ''; img.decoding = 'async';
    if (msg.w && msg.h) img.style.aspectRatio = msg.w + ' / ' + msg.h;
    if (msg.url) { img.src = msg.url; img.loading = 'lazy'; }
    else {
      if (msg.thumb) img.src = msg.thumb;
      img.classList.add('lazy-blur');
      mediaUrl(msg).then(u => { if (u) { img.src = u; img.classList.remove('lazy-blur'); } }).catch(() => {});
    }
    img.addEventListener('click', e => { e.stopPropagation(); openViewer(msg); });
    content.appendChild(img);
    content.appendChild(makeDlBtn(msg));
  } else if (msg.type === 'audio') {
    content.appendChild(buildAudio(msg, id));
    content.appendChild(makeDlBtn(msg));
  } else if (msg.type === 'file') {
    const wrap = document.createElement('div');
    wrap.className = 'msg-file';
    wrap.innerHTML = `<span class="f-ico">📄</span><div><div class="f-name">${escapeHtml(msg.fileName || 'ملف')}</div></div>`;
    wrap.lastElementChild.appendChild(makeDlBtn(msg));
    content.appendChild(wrap);
  } else if (blurred) {
    content.textContent = (msg.text || '').slice(0, 160).replace(/[^\s]/g, '▒');   // لا نص حقيقي في الصفحة
  } else {
    if (msg.color && /^#[0-9a-f]{6}$/i.test(msg.color)) content.style.color = msg.color;
    content.innerHTML = parseColorCodes(msg.text || '');
  }
  return content;
}

function buildRow(msg, id, opts) {
  opts = opts || {};
  const isMe = msg.from === State.user;
  const isText = !msg.type || msg.type === 'text';
  const blurred = !!msg.blur && !msg.revealed && isText;

  const row = document.createElement('div');
  row.className = 'msg-row ' + (isMe ? 'me' : 'other') + (opts.noAnim ? ' no-anim' : '');
  row.dataset.id = id; row.dataset.from = msg.from;
  row.style.setProperty('--d', (Math.random() * 1.2).toFixed(2) + 's');
  row.appendChild(makeAvatar(msg));

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble' + (blurred ? ' blurred' : '');

  if (msg.replyTo) {
    const r = document.createElement('div');
    r.className = 'msg-reply';
    r.innerHTML = `<b>${escapeHtml(msg.replyTo.name || '')}</b><span>${escapeHtml(msg.replyTo.text || '')}</span>`;
    if (msg.replyTo.id) r.addEventListener('click', e => { e.stopPropagation(); jumpTo(msg.replyTo.id); });
    bubble.appendChild(r);
  }

  const content = buildContent(msg, id, blurred);
  bubble.appendChild(content);

  if (msg.downloaded && !isText) {
    const dn = document.createElement('div');
    dn.className = 'dl-note';
    dn.textContent = 'قام بتحميلها ♻️';
    bubble.appendChild(dn);
  }

  /* السطر السفلي: منذ ... / تم تعديلها / √ */
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const time = document.createElement('span');
  time.className = 'msg-time';
  time.dataset.ts = msg.timestamp || Date.now();
  time.title = fmt12(msg.timestamp);
  time.textContent = ago(msg.timestamp);
  meta.appendChild(time);
  if (msg.edited) {
    const ed = document.createElement('span');
    ed.className = 'msg-edited'; ed.textContent = 'تم تعديلها';
    meta.appendChild(ed);
  }
  if (isMe) {
    const st = document.createElement('span');
    st.className = 'msg-status';
    st.innerHTML = `<span class="tk ${msg.delivered ? 'ok' : 'no'}" title="${msg.delivered ? 'وصلت' : 'لم تصل بعد'}">√</span>` +
      (msg.seen ? ' <span class="eye" title="شوهدت">👁</span>' : '');
    meta.appendChild(st);
  }
  bubble.appendChild(meta);

  if (msg.reactions && Object.keys(msg.reactions).length) {
    const rx = document.createElement('div');
    rx.className = 'msg-reactions';
    rx.innerHTML = Object.entries(msg.reactions)
      .map(([emo, users]) => `<span>${emo} ${Object.keys(users || {}).length}</span>`).join('');
    bubble.appendChild(rx);
  }

  /* أزرار: نسخ + تعديل + حذف */
  const bar = document.createElement('div');
  bar.className = 'msg-actions';
  let n = 0;
  const mk = (cls, title, txt, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'msg-act ' + cls; b.title = title; b.textContent = txt;
    b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    bar.appendChild(b); n++;
  };
  if (isText && !blurred) mk('copy', 'نسخ الرسالة', '📋', () => copyText(msg.text || ''));
  if (isMe && isText) mk('edit', 'تعديل الرسالة', '✏️', () => startEdit(msg, id, row, bubble, content));
  if (isMe) mk('del', 'حذف الرسالة', '🗑️', () => deleteOwnMessage(msg, id, row));
  if (n) bubble.appendChild(bar);

  let longPressed = false;
  bubble.addEventListener('click', e => {
    if (longPressed) { longPressed = false; return; }
    if (e.target.closest('.msg-actions, .msg-edit, .aud, .msg-reply')) return;
    if (bubble.classList.contains('blurred') && !isMe) {
      haptic(20);
      Store.updateMessage(Store.chatIdOf(msg.from, msg.to), id, { revealed: true }).catch(() => {});
      return;
    }
    if (e.target.closest('img, a, button')) return;
    if (!bubble.querySelector('.msg-actions') || bubble.classList.contains('editing')) return;
    const open = bubble.classList.contains('show-actions');
    closeAllActions();
    if (!open) bubble.classList.add('show-actions');
  });

  let pressTimer = null;
  bubble.addEventListener('touchstart', () => {
    if (bubble.classList.contains('editing')) return;
    pressTimer = setTimeout(() => {
      longPressed = true;
      haptic(25);
      openReactions(id, bubble);
      if (bubble.querySelector('.msg-actions')) { closeAllActions(); bubble.classList.add('show-actions'); }
    }, 500);
  }, { passive:true });
  bubble.addEventListener('touchend', () => clearTimeout(pressTimer));
  bubble.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive:true });
  bubble.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (bubble.classList.contains('editing')) return;
    openReactions(id, bubble);
    if (bubble.querySelector('.msg-actions')) { closeAllActions(); bubble.classList.add('show-actions'); }
  });
  attachSwipeToReply(bubble, msg);

  row.appendChild(bubble);
  return row;
}

function renderMessage(msg, id, opts) {
  opts = opts || {};
  const existing = Rows.get(id);
  if (existing && existing.dataset.editing) { existing._pending = { msg, id }; return; }
  if (existing && existing.dataset.removing) return;

  const row = buildRow(msg, id, { noAnim: !!existing || opts.animate === false });
  /* لا نقطع تشغيل صوت جارٍ عند تحديث الرسالة (وصلت/شوهدت...) */
  if (existing && msg.type === 'audio') {
    const oldAud = existing.querySelector('.aud'), newAud = row.querySelector('.aud');
    if (oldAud && newAud) newAud.replaceWith(oldAud);
  }
  Rows.set(id, row);
  if (existing) existing.replaceWith(row);
  else {
    const ph = $('.msgs-loading'); if (ph) ph.remove();
    $('#messages').appendChild(row);
  }
}

/* ---------- أزرار الرسالة ---------- */
function closeAllActions() { $$('.msg-bubble.show-actions').forEach(b => b.classList.remove('show-actions')); }
document.addEventListener('click', e => { if (!e.target.closest('.msg-bubble')) closeAllActions(); });

function findRow(id) { return Rows.get(id) || null; }
function animateRemove(row, done) {
  if (!row || row.dataset.removing) return;
  row.dataset.removing = '1';
  row.classList.add('deleting');
  setTimeout(() => { row.remove(); if (done) done(); }, 400);
}
function removeMessageRow(id) { animateRemove(findRow(id), () => Rows.delete(id)); }

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
  haptic(10);
  toast('تم النسخ ✔');
}

async function deleteOwnMessage(msg, id, row) {
  if (msg.from !== State.user) { toast('لا يمكنك حذف رسائل الطرف الآخر'); return; }
  const bubble = row.querySelector('.msg-bubble');
  if (bubble) bubble.classList.remove('show-actions');
  animateRemove(row, () => Rows.delete(id));
  try {
    await Store.deleteMessage(Store.chatIdOf(msg.from, msg.to), id, msg);
  } catch (err) {
    console.error(err);
    toast('تعذّر حذف الرسالة');
    setTimeout(() => { if (State.currentChat === msg.to) renderMessage(msg, id, { animate:false }); }, 450);
  }
}

function startEdit(msg, id, row, bubble, content) {
  if (msg.from !== State.user) { toast('لا يمكنك تعديل رسائل الطرف الآخر'); return; }
  if (msg.type && msg.type !== 'text') { toast('يمكن تعديل الرسائل النصية فقط'); return; }
  if (row.dataset.editing) return;

  row.dataset.editing = '1';
  bubble.classList.remove('show-actions');
  bubble.classList.add('editing');

  const box = document.createElement('div');
  box.className = 'msg-edit';
  const ta = document.createElement('textarea');
  ta.className = 'msg-edit-input';
  ta.value = msg.text || '';
  ta.rows = 1;
  const btns = document.createElement('div');
  btns.className = 'msg-edit-btns';
  const ok = document.createElement('button');
  ok.type = 'button'; ok.className = 'msg-edit-ok'; ok.textContent = '✔ حفظ';
  const no = document.createElement('button');
  no.type = 'button'; no.className = 'msg-edit-no'; no.textContent = '✖ إلغاء';
  btns.appendChild(ok); btns.appendChild(no);
  box.appendChild(ta); box.appendChild(btns);

  content.style.display = 'none';
  content.after(box);

  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
  autosize();
  ta.addEventListener('input', autosize);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  const finish = rerenderPending => {
    box.remove();
    content.style.display = '';
    bubble.classList.remove('editing');
    delete row.dataset.editing;
    const p = row._pending; row._pending = null;
    if (rerenderPending && p) renderMessage(p.msg, p.id, { animate:false });
  };
  const save = async () => {
    const t = ta.value.trim();
    if (!t) { toast('لا يمكن أن تكون الرسالة فارغة'); return; }
    if (t === (msg.text || '')) { finish(true); return; }
    finish(false);
    try {
      await Store.updateMessage(Store.chatIdOf(msg.from, msg.to), id, { text: t, edited: true, editedAt: Date.now() });
      toast('تم تعديلها ✔');
    } catch (err) { console.error(err); toast('تعذّر تعديل الرسالة'); }
  };
  ok.addEventListener('click', e => { e.stopPropagation(); save(); });
  no.addEventListener('click', e => { e.stopPropagation(); finish(true); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(true); }
  });
}

function scrollToBottom() { const m = $('#messages'); m.scrollTop = m.scrollHeight; }

/* الانتقال لرسالة (يحمّل القديم إن لزم) */
async function jumpTo(id) {
  let row = Rows.get(id);
  if (!row && State.currentChat) {
    try {
      const uid = State.currentChat;
      const all = await getAllMsgs(uid);
      const have = new Set((State.messages[uid] || []).map(m => m._id));
      const older = all.filter(m => !have.has(m._id) && belongsToChat(m, State.user, uid));
      if (older.length) {
        State.messages[uid].unshift(...older);
        State.hasMore[uid] = false;
        prependRows(older);
        refreshOlderBox(uid);
      }
    } catch (e) {}
    row = Rows.get(id);
  }
  if (!row) { toast('الرسالة الأصلية غير موجودة'); return; }
  row.scrollIntoView({ behavior:'smooth', block:'center' });
  row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
  setTimeout(() => row.classList.remove('flash'), 1800);
}

/* ============================================================
   11) الإرسال + رفع الوسائط
   ============================================================ */
$('#btn-send').addEventListener('click', sendTextMessage);
$('#msg-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
});
$('#msg-input').addEventListener('input', e => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  measureBars();
});

function sendTo(chat, extra) {
  const me = State.user;
  const msg = {
    from: me, to: chat, chatId: Store.chatIdOf(me, chat),
    fromName: State.myName || USERS[me].name,
    ...extra
  };
  return Store.sendMessage(msg.chatId, msg).then(ok => {
    if (!ok) toast('تعذّر إرسال الرسالة');
    else { haptic(12); maybePing(chat); }
    return ok;
  });
}
function maybePing(chat) {
  const u = State.others[chat] || {};
  const fresh = isOnlineUser(u) && (Date.now() - (u.lastSeen || 0)) < 45000;
  if (!fresh) Notif.ping(chat);
}

function sendTextMessage() {
  const chat = State.currentChat;
  if (!chat) { toast('اختر محادثة أولاً'); return; }
  const input = $('#msg-input');
  const text = input.value.trim();
  if (!text) return;

  if (text === '.تحميل' && State.replyTo) {
    const m = (State.messages[chat] || []).find(x => x._id === State.replyTo.id);
    if (m && m.type && m.type !== 'text') downloadMsg(m); else toast('الرسالة المرتبطة ليست ملفاً');
    input.value = ''; clearReply();
    return;
  }
  sendTo(chat, {
    type: 'text', text,
    color: State.textColor || undefined,
    blur: State.pendingBlur, revealed: false,
    replyTo: State.replyTo, reactions: {}
  });
  input.value = '';
  input.style.height = 'auto';
  clearReply();
  State.pendingBlur = false;
  input.classList.remove('blur-armed');
  measureBars();
}

/* رسالة سريعة */
$('#btn-quick').addEventListener('click', () => {
  if (!State.currentChat) { toast('اختر محادثة أولاً'); return; }
  sendTo(State.currentChat, { type:'text', text: QUICK_MSG, reactions:{} });
  haptic([15, 40, 15]);
});

/* ---------- ضغط الصور ---------- */
function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
function compressImage(file, maxDim, quality) {
  return new Promise((res, rej) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const sc = Math.min(1, maxDim / Math.max(w, h));
      w = Math.max(1, Math.round(w * sc)); h = Math.max(1, Math.round(h * sc));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(u);
      c.toBlob(b => b ? res({ blob:b, w, h }) : rej(new Error('blob')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('img')); };
    img.src = u;
  });
}
async function prepareImage(file) {
  let blob = file, w = 0, h = 0;
  if (!/gif/i.test(file.type)) {
    try { const r = await compressImage(file, 1280, .78); blob = r.blob; w = r.w; h = r.h; } catch (e) {}
  }
  let thumb = '';
  try { const t = await compressImage(file, 32, .5); thumb = await blobToDataUrl(t.blob); } catch (e) {}
  const out = blob === file ? file
    : new File([blob], (file.name || 'img').replace(/\.\w+$/, '') + '.jpg', { type:'image/jpeg' });
  return { file: out, thumb, w, h };
}

/* ---------- فقاعة "جار الإرسال" داخل الشات ---------- */
function addPending(chat, label, previewUrl) {
  if (State.currentChat !== chat) return { set(){}, remove(){}, fail(){} };
  const row = document.createElement('div');
  row.className = 'msg-row me pending no-anim';
  row.innerHTML = `<div class="msg-bubble"><div class="pend-box">
      ${previewUrl ? '<img class="pend-img" alt="">' : ''}
      <div class="pend-txt"><span class="pend-spin"></span><span class="pend-label"></span></div>
      <div class="pend-bar"><i></i></div></div></div>`;
  row.querySelector('.pend-label').textContent = label;
  if (previewUrl) row.querySelector('.pend-img').src = previewUrl;
  $('#messages').appendChild(row);
  scrollToBottom();
  const bar = row.querySelector('.pend-bar i');
  return {
    set(p) { bar.style.width = Math.round(p * 100) + '%'; },
    remove() { row.remove(); if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl); },
    fail(t) {
      row.querySelector('.pend-label').textContent = t;
      row.classList.add('failed');
      setTimeout(() => row.remove(), 3000);
    }
  };
}

async function sendMedia(kind, file, label) {
  const chat = State.currentChat; if (!chat) return;
  const reply = State.replyTo;
  const pend = addPending(chat, label, kind === 'image' ? URL.createObjectURL(file) : null);
  try {
    let up = file; const extra = { fileName: file.name };
    if (kind === 'image') {
      const r = await prepareImage(file);
      up = r.file; extra.thumb = r.thumb; if (r.w) { extra.w = r.w; extra.h = r.h; }
    }
    pend.set(.05);
    const res = await Store.putMedia(Store.chatIdOf(State.user, chat), up, p => pend.set(.05 + p * .95));
    pend.remove();
    if (res.url) extra.url = res.url;
    if (res.mediaKey) extra.mediaKey = res.mediaKey;
    await sendTo(chat, { type: kind, ...extra, replyTo: reply, reactions: {} });
    if (State.replyTo === reply) clearReply();
  } catch (err) {
    console.error(err);
    pend.fail(err && err.message === 'big' ? 'الملف كبير جداً' : 'فشل الإرسال — حاول مرة أخرى');
  }
}

$('#file-input').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) sendMedia('image', f, 'جار إرسال الصورة…');
});
$('#music-input').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) sendMedia('audio', f, 'جار إرسال الصوت…');
});
$('#doc-input').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) sendMedia('file', f, 'جار إرسال الملف…');
});

/* ---------- التنزيل ---------- */
const MIME_EXT = { 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif',
  'audio/webm':'webm','audio/mpeg':'mp3','audio/ogg':'ogg','audio/wav':'wav','audio/mp4':'m4a',
  'video/mp4':'mp4','application/pdf':'pdf','text/plain':'txt' };
function fileNameWithExt(name, mime, type) {
  name = (name || 'file').trim();
  if (/\.[A-Za-z0-9]{2,5}$/.test(name)) return name;
  const ext = MIME_EXT[(mime || '').split(';')[0]] || (type === 'image' ? 'jpg' : type === 'audio' ? 'webm' : '');
  return ext ? name + '.' + ext : name;
}
async function downloadMedia(url, name, type) {
  if (!url) { toast('لا يوجد ملف للتنزيل'); return false; }
  toast('⬇ جاري التنزيل...');
  try {
    const blob = await (await fetch(url)).blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = obj; a.download = fileNameWithExt(name, blob.type, type);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 4000);
    toast('تم التنزيل ✔');
    return true;
  } catch (err) {
    const a = document.createElement('a');
    a.href = url; a.download = fileNameWithExt(name, '', type); a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    return true;
  }
}
/* عند تحميل الطرف الآخر → يظهر "قام بتحميلها ♻️" للطرفين */
async function downloadMsg(msg) {
  let url = '';
  try { url = await mediaUrl(msg); } catch (e) {}
  const ok = await downloadMedia(url, msg.fileName, msg.type);
  if (ok && msg.from !== State.user && msg._id && !msg.downloaded) {
    Store.updateMessage(Store.chatIdOf(msg.from, msg.to), msg._id, { downloaded: true, downloadedAt: Date.now() }).catch(() => {});
  }
}
function makeDlBtn(msg) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'msg-dl';
  b.textContent = '⬇ تنزيل';
  b.addEventListener('click', e => { e.stopPropagation(); downloadMsg(msg); });
  return b;
}

/* ============================================================
   12) السحب للرد + معاينة الرد
   ============================================================ */
function attachSwipeToReply(bubble, msg) {
  let startX = 0, moved = false;
  bubble.addEventListener('touchstart', e => { startX = e.touches[0].clientX; moved = false; }, { passive:true });
  bubble.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    if (dx > 60) { moved = true; bubble.style.transform = `translateX(${Math.min(dx, 100)}px)`; }
  }, { passive:true });
  bubble.addEventListener('touchend', () => {
    if (moved) { bubble.style.transform = ''; haptic(20); setReply(msg); }
  });
}
function setReply(msg) {
  const hidden = msg.blur && !msg.revealed;
  const txt = hidden ? '🌫️ رسالة مغبشة'
    : (msg.text || (msg.type === 'image' ? '📷 صورة' : msg.type === 'audio' ? '🎵 تسجيل صوتي' : '📄 ' + (msg.fileName || 'ملف')));
  State.replyTo = {
    id: msg._id || '',
    name: msg.fromName || (USERS[msg.from] && USERS[msg.from].name) || '',
    text: txt.slice(0, 140),
    type: msg.type || 'text'
  };
  $('#rp-name').textContent = State.replyTo.name;
  $('#rp-text').textContent = State.replyTo.text;
  $('#reply-preview').classList.add('open');
  $('#msg-input').focus();
}
function clearReply() { State.replyTo = null; $('#reply-preview').classList.remove('open'); }
$('#rp-cancel').addEventListener('click', clearReply);

/* ============================================================
   13) لوحة (+)
   ============================================================ */
$('#btn-plus').addEventListener('click', e => {
  e.stopPropagation();
  $('#options-panel').classList.toggle('open');
  $('#color-pop').classList.remove('open');
});
$$('.opt-btn').forEach(b => {
  b.addEventListener('click', e => {
    e.stopPropagation();
    const opt = b.dataset.opt;
    $('#options-panel').classList.remove('open');
    if (opt === 'studio') $('#file-input').click();
    else if (opt === 'music') $('#music-input').click();
    else if (opt === 'files') $('#doc-input').click();
    else if (opt === 'blur') {
      State.pendingBlur = true;
      $('#msg-input').classList.add('blur-armed');
      toast('🌫️ الرسالة القادمة ستكون مغبشة');
      $('#msg-input').focus();
    } else if (opt === 'color') {
      buildColorGrid();
      $('#color-pop').classList.add('open');
    }
  });
});
document.addEventListener('click', e => {
  if (!e.target.closest('#reactions-bar') && !e.target.closest('.msg-bubble')) $('#reactions-bar').classList.remove('open');
  if (!e.target.closest('#options-panel') && !e.target.closest('#btn-plus')) $('#options-panel').classList.remove('open');
  if (!e.target.closest('#color-pop') && !e.target.closest('.opt-btn')) $('#color-pop').classList.remove('open');
});

/* ============================================================
   14) التفاعلات
   ============================================================ */
let currentReactionMsgId = null;
function openReactions(msgId, bubble) {
  currentReactionMsgId = msgId;
  const rect = bubble.getBoundingClientRect();
  const bar = $('#reactions-bar');
  bar.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - 280)) + 'px';
  bar.style.top = Math.max(10, rect.top - 46) + 'px';
  bar.classList.add('open');
}
$$('#reactions-bar span').forEach(s => {
  s.addEventListener('click', e => {
    e.stopPropagation();
    if (!currentReactionMsgId || !State.currentChat) return;
    const chatId = Store.chatIdOf(State.user, State.currentChat);
    haptic(15);
    Store.toggleReaction(chatId, currentReactionMsgId, s.dataset.r, State.user)
      .then(() => toast('تم التفاعل ' + s.dataset.r))
      .catch(() => toast('تعذّر إضافة التفاعل'));
    $('#reactions-bar').classList.remove('open');
  });
});

/* ============================================================
   15) التسجيل الصوتي + المسودات
   ============================================================ */
const Drafts = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      if (this.db) return res(this.db);
      if (!window.indexedDB) return rej(new Error('no-idb'));
      const r = indexedDB.open('chat_drafts', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('d');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) {
    try {
      const db = await this.open();
      return await new Promise(res => {
        const q = db.transaction('d').objectStore('d').get(k);
        q.onsuccess = () => res(q.result || null); q.onerror = () => res(null);
      });
    } catch (e) { return null; }
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('d', 'readwrite');
      tx.objectStore('d').put(v, k);
      tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
    });
  },
  async del(k) {
    try {
      const db = await this.open();
      await new Promise(res => {
        const tx = db.transaction('d', 'readwrite');
        tx.objectStore('d').delete(k); tx.oncomplete = () => res(); tx.onerror = () => res();
      });
    } catch (e) {}
  }
};
async function refreshDraftDot() {
  const mic = $('#btn-mic');
  if (!State.currentChat || !State.user) { mic.classList.remove('has-draft'); return; }
  const d = await Drafts.get(State.user + '__' + State.currentChat);
  mic.classList.toggle('has-draft', !!(d && d.blob));
}

const Rec = { stream:null, mr:null, chunks:[], mime:'', secs:0, timer:null, paused:false,
              action:'send', prev:null, chat:null, active:false };

$('#btn-mic').addEventListener('click', startRecording);
$('#rec-cancel').addEventListener('click', () => stopRecorder('cancel'));
$('#rec-pause').addEventListener('click', pauseRecording);
$('#rec-draft').addEventListener('click', () => stopRecorder('draft'));
$('#rec-send').addEventListener('click', () => stopRecorder('send'));

function stopStream() {
  if (Rec.stream) { Rec.stream.getTracks().forEach(t => t.stop()); Rec.stream = null; }
}
async function startRecording() {
  if (Rec.active) { toast('التسجيل جارٍ'); return; }
  if (!State.currentChat) { toast('افتح محادثة أولاً'); return; }
  const chat = State.currentChat;
  const key = State.user + '__' + chat;
  Rec.prev = null; let prevDur = 0;

  const d = await Drafts.get(key);
  if (d && d.blob) {
    const cont = await askConfirm('🎙️ صوت محفوظ', 'هل تريد إكمال صوت محفوظ؟', 'نعم', 'لا');
    if (cont) { Rec.prev = d.blob; prevDur = d.dur || 0; }
    else { await Drafts.del(key); refreshDraftDot(); }
  }
  try {
    Rec.stream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true } });
  } catch (e) { toast('لا يمكن الوصول للميكروفون — اسمح به من إعدادات المتصفح'); return; }

  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const mime = (window.MediaRecorder && types.find(t => MediaRecorder.isTypeSupported(t))) || '';
  try { Rec.mr = mime ? new MediaRecorder(Rec.stream, { mimeType: mime }) : new MediaRecorder(Rec.stream); }
  catch (e) { stopStream(); toast('التسجيل غير مدعوم في هذا المتصفح'); return; }

  Rec.chat = chat; Rec.chunks = []; Rec.mime = Rec.mr.mimeType || mime || 'audio/webm';
  Rec.secs = prevDur; Rec.paused = false; Rec.action = 'send'; Rec.active = true;
  Rec.mr.ondataavailable = e => { if (e.data && e.data.size) Rec.chunks.push(e.data); };
  Rec.mr.onstop = onRecStop;
  Rec.mr.start(500);                       // قطع كل نصف ثانية → المسودة لا تكون فارغة
  $('#record-panel').classList.add('open');
  $('#record-panel').classList.remove('paused');
  $('#btn-mic').classList.add('recording');
  $('#rec-pause').textContent = '⏸';
  startRecTimer();
  measureBars();
  haptic(30);
}
function startRecTimer() {
  clearInterval(Rec.timer);
  const upd = () => {
    $('#rec-time').textContent = String(Math.floor(Rec.secs / 60)).padStart(2, '0') + ':' + String(Rec.secs % 60).padStart(2, '0');
  };
  upd();
  Rec.timer = setInterval(() => { if (!Rec.paused) { Rec.secs++; upd(); } }, 1000);
}
function pauseRecording() {
  if (!Rec.mr || !Rec.active) return;
  try {
    if (Rec.paused) { Rec.mr.resume(); Rec.paused = false; $('#rec-pause').textContent = '⏸'; $('#record-panel').classList.remove('paused'); }
    else { Rec.mr.pause(); Rec.paused = true; $('#rec-pause').textContent = '▶'; $('#record-panel').classList.add('paused'); }
    haptic(15);
  } catch (e) {}
}
function stopRecorder(action) {
  if (!Rec.active) return;
  Rec.action = action;
  if (Rec.mr && Rec.mr.state !== 'inactive') { try { Rec.mr.stop(); return; } catch (e) {} }
  onRecStop();
}
async function onRecStop() {
  if (!Rec.active) return;
  const { action, chat, secs, prev } = Rec;
  const chunks = Rec.chunks.slice(), mime = Rec.mime;
  /* نغلق اللوحة فوراً — لا ننتظر الرفع أبداً */
  stopStream();
  clearInterval(Rec.timer);
  Rec.active = false; Rec.mr = null; Rec.chunks = []; Rec.prev = null; Rec.paused = false;
  $('#record-panel').classList.remove('open');
  $('#btn-mic').classList.remove('recording');
  $('#rec-time').textContent = '00:00';
  measureBars();

  if (action === 'cancel') { toast('تم إلغاء التسجيل'); return; }
  let blob = new Blob(chunks, { type: mime });
  if (!chunks.length || blob.size < 300) { toast('التسجيل فارغ'); return; }
  if (prev) {
    try { toast('جار دمج التسجيل...'); blob = await mergeAudio([prev, blob]); }
    catch (e) { console.warn('[merge]', e); toast('تعذّر دمج الجزء المحفوظ'); }
  }
  if (action === 'draft') {
    try {
      await Drafts.set(State.user + '__' + chat, { blob, dur: secs, t: Date.now() });
      toast('تم حفظ الصوت كمسودة');
    } catch (e) { toast('تعذّر حفظ المسودة'); }
    refreshDraftDot();
    return;
  }
  await Drafts.del(State.user + '__' + chat);
  refreshDraftDot();
  sendAudioBlob(blob, secs, chat);
}
async function sendAudioBlob(blob, dur, chat) {
  const reply = State.replyTo;
  const pend = addPending(chat, 'جار إرسال التسجيل…', null);
  try {
    const t = blob.type || '';
    const ext = t.includes('wav') ? 'wav' : t.includes('mp4') ? 'm4a' : t.includes('ogg') ? 'ogg' : 'webm';
    const f = new File([blob], 'voice_' + Date.now() + '.' + ext, { type: t || 'audio/webm' });
    pend.set(.05);
    const res = await Store.putMedia(Store.chatIdOf(State.user, chat), f, p => pend.set(.05 + p * .95));
    pend.remove();
    const extra = { fileName: 'تسجيل صوتي', dur };
    if (res.url) extra.url = res.url;
    if (res.mediaKey) extra.mediaKey = res.mediaKey;
    await sendTo(chat, { type:'audio', ...extra, replyTo: reply, reactions: {} });
    if (State.replyTo === reply) clearReply();
  } catch (err) {
    console.error(err);
    pend.fail(err && err.message === 'big' ? 'التسجيل كبير جداً' : 'فشل إرسال التسجيل');
  }
}

/* دمج جزأين صوتيين (لإكمال المسودة) → WAV 16kHz أحادي */
async function mergeAudio(blobs) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try {
    const bufs = [];
    for (const b of blobs) bufs.push(await ctx.decodeAudioData(await b.arrayBuffer()));
    const rate = 16000;
    const total = Math.ceil(bufs.reduce((s, b) => s + b.duration, 0) * rate) + 1;
    const off = new OfflineAudioContext(1, total, rate);
    let t = 0;
    bufs.forEach(b => { const s = off.createBufferSource(); s.buffer = b; s.connect(off.destination); s.start(t); t += b.duration; });
    const out = await off.startRendering();
    return encodeWav(out.getChannelData(0), rate);
  } finally { try { ctx.close(); } catch (e) {} }
}
function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([v], { type:'audio/wav' });
}
window.addEventListener('beforeunload', e => { if (Rec.active) { e.preventDefault(); e.returnValue = ''; } });

/* ============================================================
   16) العارض + التوست + نافذة التأكيد + التنقل
   ============================================================ */
async function openViewer(msg) {
  const body = $('#viewer-body');
  body.innerHTML = '';
  const img = document.createElement('img');
  img.src = msg.url || msg.thumb || '';
  body.appendChild(img);
  $('#viewer-download').onclick = () => downloadMsg(msg);
  $('#viewer').classList.add('open');
  if (!msg.url) { try { const u = await mediaUrl(msg); if (u) img.src = u; } catch (e) {} }
}
$('#viewer-close').addEventListener('click', () => $('#viewer').classList.remove('open'));

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}
function askConfirm(title, text, okLabel, cancelLabel) {
  return new Promise(res => {
    $('#cm-title').textContent = title;
    $('#cm-text').textContent = text;
    $('#cm-ok').textContent = okLabel || 'تأكيد';
    $('#cm-cancel').textContent = cancelLabel || 'إلغاء';
    const m = $('#confirm-modal');
    m.classList.add('open');
    const done = v => { m.classList.remove('open'); $('#cm-ok').onclick = null; $('#cm-cancel').onclick = null; res(v); };
    $('#cm-ok').onclick = () => done(true);
    $('#cm-cancel').onclick = () => done(false);
  });
}
function goTo(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#' + id).classList.add('active');
  document.body.classList.toggle('in-chat', id === 'screen-chat');
}

/* ============================================================
   17) الإعدادات
   ============================================================ */
function openSettings() {
  if (!State.user) return;
  const me = State.user;
  const u = State.others[me] || {};
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('profile_' + me) || '{}'); } catch (e) {}
  $('#set-name').value = u.name || saved.name || USERS[me].name;
  $('#set-note').value = u.note != null ? u.note : (saved.note || '');
  const p = Device.netPref();
  $('#set-net-mode').value = p.mode || 'auto';
  $('#set-wifi').value = p.wifi || '';
  setAvatarEl($('#set-avatar-preview'), u.avatar || saved.avatar || '', me);
  $('#set-avatar-status').textContent = '';
  $('#palette-bar').classList.remove('open');
  $('#chat-menu').classList.remove('open');
  openSheet('settings-panel');
}
$('#btn-settings').addEventListener('click', e => { e.stopPropagation(); openSettings(); });

$('#set-avatar-btn').addEventListener('click', () => $('#set-avatar').click());
$('#set-avatar').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) changeAvatar(f);
});
async function changeAvatar(file) {
  const st = $('#set-avatar-status'), btn = $('#set-avatar-btn');
  btn.disabled = true;
  let pct = 0;
  const show = p => { pct = Math.max(pct, Math.min(100, Math.round(p))); st.textContent = `جار الرفع ${pct}%`; };
  try {
    show(3);
    const r = await compressImage(file, 320, .82);
    show(35);
    const dataUrl = await blobToDataUrl(r.blob);
    show(55);
    const tick = setInterval(() => show(Math.min(95, pct + 3)), 140);
    let res;
    try { res = await withTimeout(Store.saveUser(State.user, { avatar: dataUrl }), 12000); }
    finally { clearInterval(tick); }
    if (res === 'timeout') throw new Error('timeout');
    show(100);
    await sleep(350);                                   // يصل 100% ثم تتحدث الصورة
    if (!State.others[State.user]) State.others[State.user] = {};
    State.others[State.user].avatar = dataUrl;
    setAvatarEl($('#set-avatar-preview'), dataUrl, State.user);
    setAvatarEl($('#inbox-my-avatar'), dataUrl, State.user);
    try {
      const prev = JSON.parse(localStorage.getItem('profile_' + State.user) || '{}');
      localStorage.setItem('profile_' + State.user, JSON.stringify({ ...prev, avatar: dataUrl }));
    } catch (e) {}
    st.textContent = 'تم تحديث الصورة ✔';
    haptic([15, 30, 15]);
  } catch (err) {
    console.error(err);
    st.textContent = 'فشل رفع الصورة — جرّب صورة أخرى أو تحقق من الاتصال';
  }
  btn.disabled = false;
}

$('#set-save').addEventListener('click', async () => {
  const me = State.user;
  const name = $('#set-name').value.trim() || USERS[me].name;
  const note = $('#set-note').value.trim();
  localStorage.setItem('net_pref_v1', JSON.stringify({ mode: $('#set-net-mode').value, wifi: $('#set-wifi').value.trim() }));
  toast('جار الحفظ...');
  let r;
  try { r = await withTimeout(Store.saveUser(me, { name, note }), 6000); }
  catch (e) { console.error(e); toast('تعذّر الحفظ'); return; }
  State.myName = name; State.note = note;
  if (!State.others[me]) State.others[me] = {};
  State.others[me].name = name; State.others[me].note = note;
  try {
    const prev = JSON.parse(localStorage.getItem('profile_' + me) || '{}');
    localStorage.setItem('profile_' + me, JSON.stringify({ ...prev, name, note }));
  } catch (e) {}
  $('#inbox-my-name').textContent = name;
  $('#inbox-my-note').textContent = note || 'متصل الآن';
  pushDeviceSoon();
  haptic(15);
  toast(r === 'timeout' ? 'تم الحفظ وسيصل عند عودة الاتصال' : 'تم حفظ الإعدادات ✔');
  closeSheets();
});
$('#set-profile').addEventListener('click', () => openProfile(State.user));

/* ============================================================
   18) الملف التعريفي (شبكة / بطارية / حالة الهاتف / قوة الإنترنت)
   ============================================================ */
$('#open-profile').addEventListener('click', e => {
  e.stopPropagation();
  if (State.currentChat) openProfile(State.currentChat);
});
function openProfile(uid) {
  closeSheets();
  State.profileUid = uid;
  renderProfile();
  $('#profile-modal').classList.add('open');
  $('#sheet-backdrop').classList.add('open');
}
function batteryHtml(d) {
  if (!d || typeof d.bat !== 'number') return '<span class="pm-muted">غير متاح على هذا الجهاز</span>';
  const lv = d.bat;
  const col = lv <= 20 ? '#ef4444' : (lv <= 50 ? '#f59e0b' : '#10b981');
  const w = Math.max(1, Math.round(lv / 100 * 17));
  return `<span class="bat" style="color:${col}">
    <svg viewBox="0 0 26 12" width="28" height="13"><rect x="0.8" y="0.8" width="21" height="10.4" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <rect x="2.6" y="2.6" width="${w}" height="6.8" rx="1.2" fill="currentColor"/><rect x="23" y="3.6" width="2.2" height="4.8" rx="1" fill="currentColor"/></svg>
    <b>${lv}%</b></span>${d.chg ? ' <span class="chg">⚡ يشحن الان</span>' : ''}`;
}
function signalHtml(d) {
  if (!d) return '<span class="pm-muted">غير متاح</span>';
  let lvl = null;
  if (d.conn === 'none') lvl = 0;
  else if (d.eff) lvl = d.eff === '4g' ? ((d.dl >= 5 && (d.rtt == null || d.rtt < 150)) ? 4 : 3) : d.eff === '3g' ? 2 : 1;
  else if (typeof d.rtt === 'number') lvl = d.rtt < 80 ? 4 : d.rtt < 200 ? 3 : d.rtt < 500 ? 2 : 1;
  if (lvl == null) return '<span class="pm-muted">غير متاح</span>';
  const names = ['لا يوجد', 'ضعيف', 'متوسط', 'جيد', 'قوي'];
  const cols = ['#ef4444', '#ef4444', '#f59e0b', '#10b981', '#10b981'];
  const hs = [4, 7, 10, 13];
  let bars = '';
  hs.forEach((h, i) => { bars += `<rect x="${i * 5}" y="${14 - h}" width="3.4" height="${h}" rx="1" fill="${i < lvl ? cols[lvl] : 'rgba(255,255,255,.2)'}"/>`; });
  const extra = (typeof d.dl === 'number' && d.dl > 0) ? ` · ${d.dl} Mbps` : (typeof d.rtt === 'number' ? ` · ${d.rtt}ms` : '');
  return `<svg viewBox="0 0 19 14" width="22" height="16">${bars}</svg> <span style="color:${cols[lvl]}">${names[lvl]}</span><span class="pm-muted">${extra}</span>`;
}
function networkHtml(d, online) {
  const W = '<b class="blue">WIFI</b>';
  if (!online || !d || d.conn === 'none') return `<span class="bad">ليس متصلا بالـ${W}</span>`;
  if (d.conn === 'wifi') return `<span class="ok">${W}: ${escapeHtml(d.wifi || 'متصل')}</span>`;
  if (d.conn === 'cell') return '<span class="ok">متصل بالبيانات</span>';
  return '<span>متصل بالإنترنت</span>';
}
function renderProfile() {
  const uid = State.profileUid; if (!uid) return;
  const u = State.others[uid] || {};
  const d = u.device || null;
  const online = isOnlineUser(u);
  setAvatarEl($('#pm-avatar'), u.avatar || '', uid);
  $('#pm-name').textContent = (u.name || USERS[uid].name) + ' · ' + USERS[uid].tag;
  $('#pm-note').textContent = u.note ? '💭 ' + u.note : '';
  const row = (k, v) => `<div class="pm-row"><span class="pm-k">${k}</span><span class="pm-v">${v}</span></div>`;
  $('#pm-rows').innerHTML =
    row('📶 الشبكة', networkHtml(d, online)) +
    row('🔋 البطارية', batteryHtml(d)) +
    row('📱 اسم الهاتف', u.note ? escapeHtml(u.note) : '<span class="pm-muted">—</span>') +
    row('⚙️ حالة الهاتف', online ? '<span class="ok">شغال</span>' : '<span class="bad">مطفي</span>') +
    row('📡 قوة الإنترنت', online ? signalHtml(d) : '<span class="pm-muted">—</span>') +
    row('🕒 آخر ظهور', online ? '<span class="ok">الآن</span>' : (u.lastSeen ? ago(u.lastSeen) : '<span class="pm-muted">—</span>')) +
    (online ? '' : '<div class="pm-hint">البيانات أعلاه تعود لآخر مرة كان فيها متصلاً</div>');
}

/* ============================================================
   19) قائمة ⋮ + مسح الشات
   ============================================================ */
$('#btn-more').addEventListener('click', e => {
  e.stopPropagation();
  $('#palette-bar').classList.remove('open');
  $('#color-pop').classList.remove('open');
  closeSheets();
  $('#chat-menu').classList.toggle('open');
});
document.addEventListener('click', e => {
  if (!e.target.closest('#chat-menu, #btn-more')) $('#chat-menu').classList.remove('open');
}, true);
$$('#chat-menu .menu-item').forEach(b => b.addEventListener('click', e => {
  e.stopPropagation();
  $('#chat-menu').classList.remove('open');
  const act = b.dataset.act;
  if (act === 'search') openSearch();
  else if (act === 'refresh') refreshData($('#btn-more'));
  else if (act === 'clear') clearCurrentChat();
}));

async function clearCurrentChat() {
  const other = State.currentChat;
  if (!other) return;
  const nm = (State.others[other] || {}).name || USERS[other].name;
  const ok = await askConfirm('🗑️ مسح الشات بالكامل',
    `سيتم حذف جميع الرسائل بينك وبين ${nm} عند الطرفين، ولا يمكن التراجع.`, 'مسح الكل');
  if (!ok) return;
  const chatId = Store.chatIdOf(State.user, other);
  const msgs = (State.messages[other] || []).slice();
  try {
    await Store.clearChat(chatId, msgs);
    State.messages[other] = []; State.allMsgs[other] = null; State.hasMore[other] = false;
    setTimeout(() => { if (State.currentChat === other) clearMessagesDom(); scheduleInbox(); }, 500);
    toast('تم مسح الشات ✔');
  } catch (err) { console.error(err); toast('تعذّر مسح الشات'); }
}

/* ============================================================
   20) البحث داخل الشات (كل رسالة في مستطيل كامل)
   ============================================================ */
function normMap(str) {
  let out = ''; const map = [];
  for (let i = 0; i < str.length; i++) {
    let ch = str[i];
    if (/[\u064B-\u065F\u0670\u0640]/.test(ch)) continue;
    ch = ch.toLowerCase().replace(/[أإآ]/, 'ا').replace('ى', 'ي').replace('ة', 'ه');
    out += ch; map.push(i);
  }
  return { out, map };
}
function highlight(text, q) {
  const { out, map } = normMap(text);
  let html = '', last = 0, from = 0, pos;
  while ((pos = out.indexOf(q, from)) !== -1) {
    const a = map[pos], b = map[pos + q.length - 1] + 1;
    html += escapeHtml(text.slice(last, a)) + '<mark>' + escapeHtml(text.slice(a, b)) + '</mark>';
    last = b; from = pos + q.length;
  }
  return html + escapeHtml(text.slice(last));
}
async function getAllMsgs(uid, onSlow) {
  let c = State.allMsgs[uid];
  if (!c || Date.now() - c.t > 30000) {
    if (onSlow && !c) onSlow();
    const chatId = Store.chatIdOf(State.user, uid);
    const list = await Store.loadAll(chatId);
    c = State.allMsgs[uid] = { t: Date.now(), list };
  }
  const map = new Map();
  c.list.forEach(m => map.set(m._id, m));
  (State.messages[uid] || []).forEach(m => map.set(m._id, m));
  return [...map.values()]
    .filter(m => belongsToChat(m, State.user, uid) && !State.blocked.includes(m.from))
    .sort((a, b) => (a._id < b._id ? -1 : 1));
}
const SEARCH_HINT = '<div class="search-empty">اكتب كلمة أو جزءاً منها للبحث 🔍</div>';
function openSearch() {
  if (!State.currentChat) return;
  $('#search-bar').classList.add('open');
  $('#search-input').value = '';
  $('#search-results').innerHTML = SEARCH_HINT;
  setTimeout(() => $('#search-input').focus(), 50);
}
function closeSearch() {
  const bar = $('#search-bar');
  if (!bar) return;
  bar.classList.remove('open');
  $('#search-input').value = '';
  $('#search-results').innerHTML = '';
}
$('#search-close').addEventListener('click', closeSearch);
let searchSeq = 0, searchTimer = null;
$('#search-input').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 180); });

async function runSearch() {
  const box = $('#search-results');
  const raw = $('#search-input').value.trim();
  if (!raw) { box.innerHTML = SEARCH_HINT; return; }
  const other = State.currentChat; if (!other) return;
  const my = ++searchSeq;
  const q = normMap(raw).out;
  let list;
  try { list = await getAllMsgs(other, () => { box.innerHTML = '<div class="search-empty">⏳ جار تحميل كل الرسائل...</div>'; }); }
  catch (e) { box.innerHTML = '<div class="search-empty">تعذّر البحث</div>'; return; }
  if (my !== searchSeq) return;

  const found = [];
  list.slice().reverse().forEach(m => {
    if (m.blur && !m.revealed) return;                               // لا نكشف المغبشة
    const txt = (!m.type || m.type === 'text') ? (m.text || '') : (m.fileName || '');
    if (txt && normMap(txt).out.indexOf(q) !== -1) found.push({ m, txt });
  });
  box.innerHTML = '';
  if (!found.length) { box.innerHTML = '<div class="search-empty">لا توجد نتائج 🙁</div>'; return; }
  const cnt = document.createElement('div');
  cnt.className = 'search-count'; cnt.textContent = `النتائج: ${found.length}`;
  box.appendChild(cnt);
  found.slice(0, 80).forEach(({ m, txt }) => {
    const el = document.createElement('div');
    el.className = 'search-item';
    const who = m.from === State.user ? 'أنت' : escapeHtml(m.fromName || USERS[m.from].name);
    const icon = (!m.type || m.type === 'text') ? '' : (m.type === 'image' ? '📷 ' : m.type === 'audio' ? '🎵 ' : '📄 ');
    el.innerHTML = `<div class="si-head"><b>${who}</b><span>${fmtDate(m.timestamp)} · ${fmt12(m.timestamp)}</span></div>
      <div class="si-text">${icon}${highlight(txt, q)}</div>`;
    el.addEventListener('click', () => { closeSearch(); jumpTo(m._id); });
    box.appendChild(el);
  });
}

/* ============================================================
   21) تهكير 💀 + تأثير الموجة + الجزيئات + الإقلاع
   ============================================================ */
$('#btn-hack').addEventListener('click', e => {
  e.stopPropagation();
  const ov = $('#hack-overlay');
  if (ov.classList.contains('show')) return;
  ov.classList.add('show');
  haptic([120, 60, 200]);
  setTimeout(() => { logout(); ov.classList.remove('show'); }, 2600);
});

document.addEventListener('pointerdown', e => {
  const t = e.target.closest('.btn, .icon-btn, .opt-btn, .inbox-item, .hack-btn, .pill-btn, .menu-item, .search-item');
  if (!t) return;
  const r = t.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2;
  const sp = document.createElement('span');
  sp.className = 'ripple';
  sp.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  t.appendChild(sp);
  setTimeout(() => sp.remove(), 700);
});

(function initParticles() {
  const c = $('#particles');
  if (!c) return;
  const ctx = c.getContext('2d');
  let W, H, parts = [], last = 0;
  function resize() { W = c.width = window.innerWidth; H = c.height = window.innerHeight; }
  function make() {
    parts = [];
    for (let i = 0; i < 22; i++) parts.push({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - .5) * .5, vy: (Math.random() - .5) * .5, r: Math.random() * 2 + 1
    });
  }
  function loop(t) {
    requestAnimationFrame(loop);
    if (document.hidden || document.body.classList.contains('in-chat')) return;   // لا رسم داخل الشات
    if (t - last < 33) return;                                                   // 30 إطار/ث
    last = t;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = ACCENT; ctx.globalAlpha = .5;
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }
  window.addEventListener('resize', () => { resize(); make(); });
  resize(); make(); requestAnimationFrame(loop);
})();

/* الإقلاع: الجلسة المحفوظة → الحساب مباشرة بلا انتظار */
(function boot() {
  let sess = null;
  try { sess = JSON.parse(localStorage.getItem('session_v1') || 'null'); } catch (e) {}
  if (sess && USERS[sess.user]) startSession(sess.user);
  else goTo('screen-password');
})();

console.log('%c✅ app.js v5 جاهز', 'color:#10b981;font-weight:bold;font-size:14px');
