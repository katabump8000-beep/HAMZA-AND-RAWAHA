/* ============================================================
   app.js — الإصدار النهائي الكامل
   قائمة محادثات + شات + إعدادات + تسجيل + رفع ملفات
   ============================================================ */

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const State = {
  user: null,
  others: {},
  messages: {},
  currentChat: null,
  replyTo: null,
  recording: false,
  paused: false,
  cancelled: false,
  savedAsDraft: false,
  mediaRecorder: null,
  recChunks: [],
  recSeconds: 0,
  recTimer: null,
  currentReactionMsgId: null,
  pendingBlur: false,
  themeColor: '1',
  blocked: JSON.parse(localStorage.getItem('blocked') || '[]'),
  note: '',
  unsubs: [],
  usersUnsub: null,
  lastSeenTimer: null,
  recChat: null,
  inboxBound: false
};

const PASSWORD = '67';
const USERS = {
  hamza:  { name:'حمزة', tag:'J.C' },
  rawaha: { name:'رواحة', tag:'Itachi' }
};
const AVATAR_COLORS = {
  hamza: '#7ab82a',
  rawaha: '#ff2d2d'
};

/* ============================================================
   1) كلمة السر
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
    shake($('.glass-panel'));
  }
}

function shake(el) {
  el.animate([
    { transform:'translateX(0)' },
    { transform:'translateX(-10px)' },
    { transform:'translateX(10px)' },
    { transform:'translateX(-6px)' },
    { transform:'translateX(0)' }
  ], { duration:400 });
}

/* ============================================================
   2) الأذونات
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
  const perms = ['notifications','microphone','camera','storage'];
  results.forEach((r, i) => {
    const el = $(`.perm-item[data-perm="${perms[i]}"]`);
    if (!el) return;
    el.classList.remove('granted','denied');
    if (r.status === 'fulfilled' && r.value) {
      el.classList.add('granted');
      el.querySelector('.perm-status').textContent = 'مسموح';
    } else {
      el.classList.add('denied');
      el.querySelector('.perm-status').textContent = 'مرفوض';
    }
  });
  const allOk = results.every(r => r.status === 'fulfilled' && r.value);
  if (allOk) {
    $('#btn-request-perms').classList.add('done');
    $('#btn-request-perms').textContent = '✔ تم منح جميع الأذونات';
    localStorage.setItem('perms_done', '1');
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
  try { const s = await navigator.mediaDevices.getUserMedia({ audio:true }); s.getTracks().forEach(t=>t.stop()); return true; } catch { return false; }
}
async function requestCamera() {
  try { const s = await navigator.mediaDevices.getUserMedia({ video:true }); s.getTracks().forEach(t=>t.stop()); return true; } catch { return false; }
}
async function requestStorage() { return true; }

/* ============================================================
   3) اختيار الهوية
   ============================================================ */
$$('.identity-btn').forEach(btn => {
  btn.addEventListener('click', () => startSession(btn.dataset.user));
});

/* بدء جلسة مستخدم (من اختيار الهوية أو من الجلسة المحفوظة) */
function startSession(user) {
  State.user = user;
  document.body.removeAttribute('style');          // تصفير ألوان سابقة
  document.body.dataset.theme = user;
  const savedColor = localStorage.getItem('themeColor_' + user);
  State.themeColor = savedColor || null;
  const c = THEME_COLORS.find(x => x.id === savedColor);
  if (c) applyThemeColor(c.v);
  localStorage.setItem('session_v1', JSON.stringify({ user, t: Date.now() }));
  buildPalette();
  enterInbox();
}

/* تسجيل الخروج ومسح الجلسة */
function logout() {
  stopListeners();
  State.user = null; State.currentChat = null; State.messages = {}; State.others = {}; State.note = '';
  localStorage.removeItem('session_v1');
  document.body.removeAttribute('style');
  delete document.body.dataset.theme;
  $('#messages').innerHTML = '';
  $('#password-input').value = '';
  $('#settings-panel').classList.remove('open');
  $('#profile-card').classList.remove('open');
  $('#palette-bar').classList.remove('open');
  closeSearch();
  goTo('screen-password');
}

/* ============================================================
   4) قائمة المحادثات
   ============================================================ */
function stopListeners() {
  State.unsubs.forEach(fn => { try { fn(); } catch (e) {} });
  State.unsubs = [];
  if (State.usersUnsub) { try { State.usersUnsub(); } catch (e) {} State.usersUnsub = null; }
  clearInterval(State.lastSeenTimer);
  State.lastSeenTimer = null;
}

/* هل الرسالة تخص هذه المحادثة بالضبط (أنا ↔ الطرف الآخر)؟ */
function belongsToChat(msg, me, other) {
  return !!msg && (
    (msg.from === me && msg.to === other) ||
    (msg.from === other && msg.to === me)
  );
}

/* هل أنا أشاهد هذا الشات الآن فعلاً؟ */
function isViewing(other) {
  return State.currentChat === other
    && $('#screen-chat').classList.contains('active')
    && !document.hidden;
}

/* رسالة واردة: تعليمها "وصلت" ثم "شوهدت" إن كان الشات مفتوحاً */
function handleIncoming(m, other, id) {
  const chatId = Store.chatIdOf(State.user, other);
  const patch = {};
  const firstTime = !m.delivered;
  if (!m.delivered) { patch.delivered = true; patch.deliveredAt = Date.now(); m.delivered = true; }
  if (!m.seen && isViewing(other)) { patch.seen = true; patch.seenAt = Date.now(); m.seen = true; }
  if (Object.keys(patch).length) Store.updateMessage(chatId, id, patch).catch(() => {});
  if (firstTime && !isViewing(other)) notifyIncoming(m, other);
}

function notifyIncoming(m, other) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if ((Date.now() - (m.timestamp || 0)) > 120000) return;     // تجاهل الرسائل القديمة
    const body = m.type === 'image' ? '📷 صورة' : m.type === 'audio' ? '🎵 تسجيل صوتي'
               : m.type === 'file' ? '📄 ' + (m.fileName || 'ملف') : (m.text || '');
    new Notification((State.others[other] || {}).name || USERS[other].name, { body });
  } catch (e) {}
}

/* تعليم كل رسائل الطرف الآخر كمشاهدة (عند فتح الشات / العودة للصفحة) */
function markAllSeen(other) {
  if (!isViewing(other)) return;
  const chatId = Store.chatIdOf(State.user, other);
  (State.messages[other] || []).forEach(m => {
    if (m.to === State.user && !m.seen) {
      m.seen = true;
      Store.updateMessage(chatId, m._id, { seen: true, seenAt: Date.now(), delivered: true }).catch(() => {});
    }
  });
  renderInbox();
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && State.currentChat) markAllSeen(State.currentChat);
});

function onChatMessage(kind, other, msg, id) {
  const list = State.messages[other] || (State.messages[other] = []);
  const idx = list.findIndex(m => m._id === id);

  if (kind === 'removed') {
    if (idx >= 0) list.splice(idx, 1);
    if (State.currentChat === other) removeMessageRow(id);
    renderInbox();
    return;
  }

  if (!belongsToChat(msg, State.user, other)) return;   // لا تسريب بين المحادثات
  if (State.blocked.includes(msg.from)) return;

  const full = { ...msg, _id: id };
  if (idx >= 0) list[idx] = full; else list.push(full);

  if (full.to === State.user) handleIncoming(full, other, id);

  if (State.currentChat === other) {
    renderMessage(full, id);
    if (kind === 'added') scrollToBottom();
  }
  renderInbox();
}

function enterInbox() {
  goTo('screen-inbox');
  initInbox();
  loadMyProfile();
  State.currentChat = null;
  $('#mode-banner').style.display = Store.isOnline() ? 'none' : 'block';

  Store.updateLastSeen(State.user);
  startListeners();
}

function startListeners() {
  /* تنظيف أي مستمعين/مؤقتات قديمة */
  stopListeners();
  State.messages = {};

  Store.updateLastSeen(State.user);
  State.lastSeenTimer = setInterval(() => Store.updateLastSeen(State.user), 20000);

  State.usersUnsub = Store.listenUsers(users => {
    State.others = users;
    renderInbox();
    updateMyHeaderFromUsers();
    if (State.currentChat) updateChatHeader(State.currentChat);
  });

  Store.migrateLegacy();

  /* مستمع مستقل لكل محادثة */
  Object.keys(USERS).filter(u => u !== State.user).forEach(other => {
    const chatId = Store.chatIdOf(State.user, other);
    const unsub = Store.listenChat(chatId, {
      added:   (msg, id) => onChatMessage('added',   other, msg, id),
      changed: (msg, id) => onChatMessage('changed', other, msg, id),
      removed: (msg, id) => onChatMessage('removed', other, msg, id)
    });
    State.unsubs.push(unsub);
  });
}

/* زر التحديث: يعيد جلب أحدث الرسائل (بدون تسجيل دخول أو كلمة سر) */
function refreshData(btn) {
  if (!State.user) return;
  Store.reconnect();
  startListeners();
  if (State.currentChat) $('#messages').innerHTML = '';
  if (btn) { btn.classList.remove('spin-once'); void btn.offsetWidth; btn.classList.add('spin-once'); }
  toast('🔄 تم تحديث الشات ✔');
}

function initInbox() {
  const me = State.user;
  $('#inbox-my-name').textContent = USERS[me].name;
  const myAv = $('#inbox-my-avatar');
  myAv.textContent = USERS[me].name[0];
  myAv.style.background = AVATAR_COLORS[me];

  if (State.inboxBound) return;      // ربط الأزرار مرة واحدة فقط
  State.inboxBound = true;
  $('#btn-inbox-settings').addEventListener('click', () => openSettings());
  $('#inbox-my-info').addEventListener('click', () => openSettings());
  $('#btn-inbox-refresh').addEventListener('click', e => refreshData(e.currentTarget));
}

function updateMyHeaderFromUsers() {
  const me = State.user;
  const u = State.others[me] || {};
  if (u.name) $('#inbox-my-name').textContent = u.name;
  if (u.note) $('#inbox-my-note').textContent = u.note;
  else $('#inbox-my-note').textContent = 'متصل الآن';
  State.note = u.note || '';
  if (u.avatar) $('#inbox-my-avatar').innerHTML = `<img src="${u.avatar}">`;
}

function renderInbox() {
  const me = State.user;
  if (!me) return;
  const others = Object.keys(USERS).filter(u => u !== me);
  const list = $('#inbox-list');
  list.innerHTML = '';

  others.forEach(uid => {
    const u = State.others[uid] || {};
    const info = USERS[uid];
    const msgs = State.messages[uid] || [];
    const last = msgs[msgs.length - 1];
    const unread = msgs.filter(m => m.to === me && !m.seen).length;
    let tick = '';
    if (last && last.from === me) {
      tick = last.seen ? '<span class="tick seen">👁</span> ' : (last.delivered ? '<span class="tick">✓</span> ' : '');
    }

    const el = document.createElement('div');
    el.className = 'inbox-item' + (isOnline(u.lastSeen) ? ' online' : '') + (unread ? ' has-unread' : '');
    el.innerHTML = `
      <div class="inbox-item-avatar" style="${u.avatar ? '' : 'background:' + AVATAR_COLORS[uid]}">
        ${u.avatar ? `<img src="${u.avatar}">` : info.name[0]}
        <span class="online-dot"></span>
      </div>
      <div class="inbox-item-body">
        <div class="inbox-item-name">${escapeHtml(u.name || info.name)}</div>
        ${u.note ? `<div class="inbox-item-note">💭 ${escapeHtml(u.note)}</div>` : ''}
        <div class="inbox-item-last">${unread ? '✉️ ' : tick}${last ? previewMsg(last) : 'ابدأ المحادثة...'}</div>
      </div>
      <div class="inbox-item-meta">
        <span class="inbox-item-time">${last ? formatTime(last.timestamp) : ''}</span>
        ${unread ? `<span class="inbox-item-unread">${unread}</span>` : ''}
      </div>
    `;
    el.addEventListener('click', () => openChat(uid));
    list.appendChild(el);
  });
}

function previewMsg(m) {
  if (m.type === 'image') return '📷 صورة';
  if (m.type === 'audio') return '🎵 تسجيل صوتي';
  if (m.type === 'file') return '📄 ' + (m.fileName || 'ملف');
  return escapeHtml((m.text || '').slice(0, 40));
}

function isOnline(ts) { return ts && (Date.now() - ts) < 60000; }

/* ============================================================
   5) فتح شات شخص
   ============================================================ */
function openChat(uid) {
  State.currentChat = uid;
  goTo('screen-chat');
  $('#messages').innerHTML = '';
  closeSearch();
  $('#chat-menu').classList.remove('open');
  (State.messages[uid] || []).forEach(m => renderMessage(m, m._id));
  updateChatHeader(uid);
  scrollToBottom();
  markAllSeen(uid);
}

function updateChatHeader(uid) {
  const info = USERS[uid];
  const u = State.others[uid] || {};
  $('#hdr-name').textContent = u.name || info.name;
  if (u.avatar) $('#hdr-avatar').innerHTML = `<img src="${u.avatar}">`;
  else { $('#hdr-avatar').innerHTML = ''; $('#hdr-avatar').textContent = info.name[0]; }
  const n = $('#hdr-note');                       // الملاحظة تظهر تحت الاسم مثل واتساب
  n.textContent = u.note ? '💭 ' + u.note : '';
  n.style.display = u.note ? 'block' : 'none';
  updateLastSeenUI(u.lastSeen);
}

function updateLastSeenUI(ts) {
  if (!ts) { $('#hdr-status').textContent = 'غير متصل'; return; }
  const diff = (Date.now() - ts) / 1000;
  const el = $('#hdr-status');
  if (diff < 60) { el.textContent = 'متصل الآن'; el.classList.add('online'); }
  else {
    el.classList.remove('online');
    const m = Math.floor(diff / 60);
    if (m < 60) el.textContent = `آخر ظهور قبل ${m} د`;
    else {
      const h = Math.floor(m / 60);
      if (h < 24) el.textContent = `آخر ظهور قبل ${h} س`;
      else el.textContent = `آخر ظهور قبل ${Math.floor(h/24)} يوم`;
    }
  }
}
setInterval(() => { if (State.currentChat) updateChatHeader(State.currentChat); }, 30000);

/* ============================================================
   6) تحميل ملفي الشخصي
   ============================================================ */
function loadMyProfile() {
  const me = State.user;
  const saved = JSON.parse(localStorage.getItem('profile_' + me) || '{}');
  if (saved.name) {
    $('#name-input').value = saved.name;
    $('#inbox-my-name').textContent = saved.name;
  }
  if (saved.note) {
    State.note = saved.note;
    $('#inbox-my-note').textContent = saved.note;
  }
  if (saved.avatar) {
    $('#pc-avatar').innerHTML = `<img src="${saved.avatar}">`;
    $('#inbox-my-avatar').innerHTML = `<img src="${saved.avatar}">`;
  } else {
    $('#pc-avatar').textContent = USERS[me].name[0];
  }
}

/* ============================================================
   7) الألوان
   ============================================================ */
const THEME_COLORS = [
  { id:'1', v:'#ff2d2d' }, { id:'2', v:'#2d7fff' },
  { id:'3', v:'#ffd93d' }, { id:'4', v:'#2dff7f' },
  { id:'5', v:'#ff8a2d' }, { id:'6', v:'#a02dff' },
  { id:'7', v:'#ff2d9e' }, { id:'8', v:'#2dffd9' }
];

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`;
}

/* يضبط ألوان الموقع كلها على <body> (لأن سمة المستخدم معرّفة هناك وتتغلّب على :root) */
function applyThemeColor(hex) {
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
  st.setProperty('--ov1', `color-mix(in srgb, ${hex} 11%, rgba(5,5,5,.86))`);
  st.setProperty('--ov2', `color-mix(in srgb, ${hex} 16%, rgba(5,5,5,.94))`);
}

/* موجة لونية تنتشر من نقطة الضغط */
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
  if (!wrap) return;
  wrap.innerHTML = '';
  THEME_COLORS.forEach(c => {
    const s = document.createElement('div');
    s.className = 'swatch' + (c.id === State.themeColor ? ' active' : '');
    s.style.background = c.v;
    s.dataset.id = c.id;
    s.addEventListener('click', () => {
      State.themeColor = c.id;
      applyThemeColor(c.v);
      const r = s.getBoundingClientRect();
      colorWave(r.left + r.width / 2, r.top + r.height / 2, c.v);
      $$('.palette-colors .swatch').forEach(x => x.classList.toggle('active', x.dataset.id === c.id));
      localStorage.setItem('themeColor_' + State.user, c.id);
      toast('تم تغيير اللون ✔');
    });
    wrap.appendChild(s);
  });
}

$('#btn-palette').addEventListener('click', e => {
  e.stopPropagation();
  $('#palette-bar').classList.toggle('open');
  $('#profile-card').classList.remove('open');
  $('#settings-panel').classList.remove('open');
});
$('#btn-palette-close').addEventListener('click', () => $('#palette-bar').classList.remove('open'));

/* ============================================================
   8) الإعدادات
   ============================================================ */
function openSettings() {
  $('#settings-panel').classList.add('open');
  $('#profile-card').classList.remove('open');
  $('#palette-bar').classList.remove('open');
  if (State.user) {
    $('#set-name').value = $('#name-input').value || USERS[State.user].name;
    $('#set-note').value = State.note || '';
  }
}

$('#btn-settings').addEventListener('click', e => {
  e.stopPropagation();
  $('#settings-panel').classList.toggle('open');
  $('#profile-card').classList.remove('open');
  $('#palette-bar').classList.remove('open');
  if (State.user) {
    $('#set-name').value = $('#name-input').value || USERS[State.user].name;
    $('#set-note').value = State.note || '';
  }
});

$('#set-avatar-btn').addEventListener('click', () => $('#set-avatar').click());
$('#set-avatar').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  toast('جاري رفع الصورة...');
  try {
    let url = await Store.uploadFile(f);
    if (!url) url = await fallbackBase64(f);
    $('#set-avatar-btn').textContent = '✔ تم اختيار الصورة';
    $('#set-avatar-btn').dataset.url = url;
    toast('تم رفع الصورة ✔');
  } catch { toast('فشل رفع الصورة'); }
  e.target.value = '';
});

$('#set-save').addEventListener('click', async () => {
  const name = $('#set-name').value.trim() || USERS[State.user].name;
  const note = $('#set-note').value.trim();
  const newAvatar = $('#set-avatar-btn').dataset.url;
  const cur = JSON.parse(localStorage.getItem('profile_' + State.user) || '{}');
  const avatar = newAvatar || cur.avatar || '';

  await Store.saveUser(State.user, { name, note, avatar });
  localStorage.setItem('profile_' + State.user, JSON.stringify({ name, note, avatar }));
  State.note = note;
  $('#name-input').value = name;
  $('#inbox-my-name').textContent = name;
  $('#inbox-my-note').textContent = note || 'متصل الآن';
  if (avatar) {
    $('#pc-avatar').innerHTML = `<img src="${avatar}">`;
    $('#inbox-my-avatar').innerHTML = `<img src="${avatar}">`;
  }
  toast('تم حفظ الإعدادات ✔');
  $('#settings-panel').classList.remove('open');
});

$('#set-close').addEventListener('click', () => $('#settings-panel').classList.remove('open'));

/* ============================================================
   9) بطاقة البروفايل (من الشات)
   ============================================================ */
$('#open-profile').addEventListener('click', e => {
  e.stopPropagation();
  $('#profile-card').classList.toggle('open');
  $('#palette-bar').classList.remove('open');
  $('#settings-panel').classList.remove('open');
});

$('#btn-upload-avatar').addEventListener('click', () => $('#avatar-upload').click());
$('#avatar-upload').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    let url = await Store.uploadFile(f);
    if (!url) url = await fallbackBase64(f);
    $('#pc-avatar').innerHTML = `<img src="${url}">`;
    const cur = JSON.parse(localStorage.getItem('profile_' + State.user) || '{}');
    cur.avatar = url;
    localStorage.setItem('profile_' + State.user, JSON.stringify(cur));
    Store.saveUser(State.user, { avatar: url, name: cur.name || USERS[State.user].name });
    toast('تم تحديث الصورة ✔');
  } catch { toast('فشل رفع الصورة'); }
  e.target.value = '';
});

$('#btn-save-profile').addEventListener('click', () => {
  const name = $('#name-input').value.trim() || USERS[State.user].name;
  const avatar = $('#pc-avatar').querySelector('img')?.src || '';
  Store.saveUser(State.user, { name, avatar });
  const prev = JSON.parse(localStorage.getItem('profile_' + State.user) || '{}');
  localStorage.setItem('profile_' + State.user, JSON.stringify({ ...prev, name, avatar }));
  toast('تم الحفظ ✔');
  $('#profile-card').classList.remove('open');
});

/* ============================================================
   10) عرض الرسائل
   ============================================================ */
function renderMessage(msg, id) {
  const isMe = msg.from === State.user;
  const existing = $$('#messages .msg-row').find(r => r.dataset.id === id);

  /* إن كانت الرسالة قيد التعديل الآن، نؤجل إعادة الرسم */
  if (existing && existing.dataset.editing) { existing._pending = { msg, id }; return; }
  if (existing && existing.dataset.removing) return;

  const row = document.createElement('div');
  row.className = 'msg-row ' + (isMe ? 'me' : 'other') + (existing ? ' no-anim' : '');
  row.dataset.id = id;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  const liveAv = (State.others[msg.from] || {}).avatar || msg.avatar;
  if (liveAv) avatar.innerHTML = `<img src="${liveAv}">`;
  else avatar.textContent = (msg.fromName || USERS[msg.from]?.name || '?')[0];
  row.appendChild(avatar);

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (msg.blur && !msg.revealed) bubble.classList.add('blurred');

  if (msg.replyTo) {
    const r = document.createElement('div');
    r.className = 'msg-reply';
    r.innerHTML = `<b>${escapeHtml(msg.replyTo.name || '')}</b>${escapeHtml(msg.replyTo.text || '')}`;
    bubble.appendChild(r);
  }

  const content = document.createElement('div');
  content.className = 'msg-content';

  if (msg.type === 'image') {
    const img = document.createElement('img');
    img.src = msg.url; img.className = 'msg-image';
    img.addEventListener('click', () => openViewer('image', msg.url, msg.fileName));
    content.appendChild(img);
    content.appendChild(makeDlBtn(msg));
  } else if (msg.type === 'audio') {
    const wrap = document.createElement('div');
    wrap.className = 'msg-audio';
    wrap.innerHTML = `<span>🎵</span><audio controls src="${msg.url}"></audio>`;
    content.appendChild(wrap);
    content.appendChild(makeDlBtn(msg));
  } else if (msg.type === 'file') {
    const wrap = document.createElement('div');
    wrap.className = 'msg-file';
    wrap.innerHTML = `<span class="f-ico">📄</span>
      <div><div class="f-name">${escapeHtml(msg.fileName || 'ملف')}</div></div>`;
    wrap.lastElementChild.appendChild(makeDlBtn(msg));
    content.appendChild(wrap);
  } else {
    content.innerHTML = parseColorCodes(msg.text || '');
  }
  bubble.appendChild(content);

  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = formatTime(msg.timestamp);
  if (msg.edited) {
    const ed = document.createElement('span');
    ed.className = 'msg-edited';
    ed.textContent = 'تم التعديل';
    time.appendChild(ed);
  }
  if (isMe) {                                   // وصلت ✓ / تمت المشاهدة 👁
    const st = document.createElement('span');
    st.className = 'msg-status' + (msg.seen ? ' seen' : '');
    st.innerHTML = msg.seen ? '<span class="eye">👁</span> تمت المشاهدة'
                 : msg.delivered ? '✓ وصلت' : '🕓 أُرسلت';
    time.appendChild(st);
  }
  bubble.appendChild(time);

  if (msg.reactions && Object.keys(msg.reactions).length) {
    const rx = document.createElement('div');
    rx.className = 'msg-reactions';
    rx.innerHTML = Object.entries(msg.reactions)
      .map(([emo, users]) => `<span>${emo} ${Object.keys(users || {}).length}</span>`).join('');
    bubble.appendChild(rx);
  }

  /* أزرار التعديل والحذف — لرسائلي فقط */
  if (isMe) {
    const bar = document.createElement('div');
    bar.className = 'msg-actions';
    if (msg.type === 'text' || !msg.type) {
      const eb = document.createElement('button');
      eb.type = 'button'; eb.className = 'msg-act edit'; eb.title = 'تعديل الرسالة';
      eb.textContent = '✏️';
      eb.addEventListener('click', e => {
        e.stopPropagation();
        startEdit(msg, id, row, bubble, content);
      });
      bar.appendChild(eb);
    }
    const db = document.createElement('button');
    db.type = 'button'; db.className = 'msg-act del'; db.title = 'حذف الرسالة';
    db.textContent = '🗑️';
    db.addEventListener('click', e => {
      e.stopPropagation();
      deleteOwnMessage(msg, id, row);
    });
    bar.appendChild(db);
    bubble.appendChild(bar);
  }

  let longPressed = false;

  bubble.addEventListener('click', e => {
    if (longPressed) { longPressed = false; return; }
    if (e.target.closest('.msg-actions, .msg-edit')) return;

    if (bubble.classList.contains('blurred') && !isMe) {
      bubble.classList.add('revealed');
      bubble.classList.remove('blurred');
      Store.updateMessage(Store.chatIdOf(msg.from, msg.to), id, { revealed: true });
      return;
    }
    if (isMe && !bubble.classList.contains('editing')) {
      /* الضغط على الوسائط/الروابط لا يفتح الأزرار */
      if (e.target.closest('img, audio, a, button')) return;
      const open = bubble.classList.contains('show-actions');
      closeAllActions();
      if (!open) bubble.classList.add('show-actions');
    }
  });

  let pressTimer = null;
  bubble.addEventListener('touchstart', () => {
    if (bubble.classList.contains('editing')) return;
    pressTimer = setTimeout(() => {
      longPressed = true;
      openReactions(id, bubble);
      if (isMe) { closeAllActions(); bubble.classList.add('show-actions'); }
    }, 500);
  }, { passive:true });
  bubble.addEventListener('touchend', () => clearTimeout(pressTimer));
  bubble.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive:true });
  bubble.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (bubble.classList.contains('editing')) return;
    openReactions(id, bubble);
    if (isMe) { closeAllActions(); bubble.classList.add('show-actions'); }
  });

  attachSwipeToReply(bubble, msg);

  row.appendChild(bubble);
  if (existing) existing.replaceWith(row);
  else $('#messages').appendChild(row);
}

/* ---------- أزرار الرسالة: إغلاق / تعديل / حذف ---------- */
function closeAllActions() {
  $$('.msg-bubble.show-actions').forEach(b => b.classList.remove('show-actions'));
}

document.addEventListener('click', e => {
  if (!e.target.closest('.msg-bubble')) closeAllActions();
});

function findRow(id) {
  return $$('#messages .msg-row').find(r => r.dataset.id === id);
}

/* تأثير الحذف: تلاشٍ + تصغير + ضبابية خلال 400ms ثم الإزالة من DOM */
function animateRemove(row, done) {
  if (!row || row.dataset.removing) return;
  row.dataset.removing = '1';
  row.classList.add('deleting');
  setTimeout(() => { row.remove(); if (done) done(); }, 400);
}

function removeMessageRow(id) {
  animateRemove(findRow(id));
}

async function deleteOwnMessage(msg, id, row) {
  if (msg.from !== State.user) { toast('لا يمكنك حذف رسائل الطرف الآخر'); return; }
  const bubble = row.querySelector('.msg-bubble');
  if (bubble) bubble.classList.remove('show-actions');

  animateRemove(row);   // الحذف دائماً مع التأثير، ويظهر عند الطرف الآخر أيضاً
  try {
    await Store.deleteMessage(Store.chatIdOf(msg.from, msg.to), id, msg);
  } catch (err) {
    console.error(err);
    toast('تعذّر حذف الرسالة');
    setTimeout(() => {
      if (State.currentChat === msg.to) renderMessage(msg, id);
    }, 450);
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

  const finish = (rerenderPending) => {
    box.remove();
    content.style.display = '';
    bubble.classList.remove('editing');
    delete row.dataset.editing;
    const p = row._pending; row._pending = null;
    if (rerenderPending && p) renderMessage(p.msg, p.id);
  };

  const save = async () => {
    const t = ta.value.trim();
    if (!t) { toast('لا يمكن أن تكون الرسالة فارغة'); return; }
    if (t === (msg.text || '')) { finish(true); return; }
    finish(false);
    try {
      await Store.updateMessage(Store.chatIdOf(msg.from, msg.to), id,
        { text: t, edited: true, editedAt: Date.now() });
      toast('تم تعديل الرسالة ✔');
    } catch (err) {
      console.error(err);
      toast('تعذّر تعديل الرسالة');
    }
  };

  ok.addEventListener('click', e => { e.stopPropagation(); save(); });
  no.addEventListener('click', e => { e.stopPropagation(); finish(true); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(true); }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function parseColorCodes(text) {
  const safe = escapeHtml(text);
  return safe.replace(/~(\d{1,2})([^~]+)~/g, (_, n, t) => {
    const i = parseInt(n);
    if (i < 1 || i > 12) return `~${n}${t}~`;
    return `<span class="tc${i}">${t}</span>`;
  }).replace(/\n/g, '<br>');
}

function formatTime(ts) {
  const d = new Date(ts || Date.now());
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

function scrollToBottom() {
  const m = $('#messages');
  m.scrollTop = m.scrollHeight;
}

/* ============================================================
   11) الإرسال
   ============================================================ */
$('#btn-send').addEventListener('click', sendTextMessage);
$('#msg-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
});
$('#msg-input').addEventListener('input', e => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
});

/* إرسال رسالة إلى محادثة محددة (الطرفان يُثبَّتان لحظة الاستدعاء) */
function sendTo(chat, extra) {
  const me = State.user;
  const msg = {
    from: me,
    to: chat,
    chatId: Store.chatIdOf(me, chat),
    fromName: $('#name-input').value || USERS[me].name,
    ...extra
  };
  return Store.sendMessage(msg.chatId, msg).then(ok => {
    if (!ok) toast('تعذّر إرسال الرسالة');
    return ok;
  });
}

function sendTextMessage() {
  const chat = State.currentChat;
  if (!chat) { toast('اختر محادثة أولاً'); return; }
  const input = $('#msg-input');
  const text = input.value.trim();
  if (!text) return;

  if (text === '.تحميل' && State.replyTo) {
    downloadReply(State.replyTo);
    input.value = '';
    clearReply();
    return;
  }

  sendTo(chat, {
    type: 'text',
    text,
    blur: State.pendingBlur,
    revealed: false,
    replyTo: State.replyTo,
    reactions: {}
  });
  input.value = '';
  input.style.height = 'auto';
  clearReply();
  State.pendingBlur = false;
}

function downloadReply(r) {
  downloadMedia(r.url, r.fileName, r.type);
}

/* ---------- التنزيل الحقيقي للملفات ---------- */
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
  if (!url) { toast('لا يوجد ملف للتنزيل'); return; }
  toast('⬇ جاري التنزيل...');
  try {
    const blob = await (await fetch(url)).blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = obj; a.download = fileNameWithExt(name, blob.type, type);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 4000);
    toast('تم التنزيل ✔');
  } catch (err) {                                  // احتياطي (مثلاً قيود CORS)
    const a = document.createElement('a');
    a.href = url; a.download = fileNameWithExt(name, '', type); a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
}

function makeDlBtn(msg) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'msg-dl';
  b.innerHTML = '⬇ تنزيل';
  b.addEventListener('click', e => { e.stopPropagation(); downloadMedia(msg.url, msg.fileName, msg.type); });
  return b;
}

/* ============================================================
   12) السحب للرد
   ============================================================ */
function attachSwipeToReply(bubble, msg) {
  let startX = 0, moved = false;
  bubble.addEventListener('touchstart', e => { startX = e.touches[0].clientX; moved = false; }, { passive:true });
  bubble.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    if (dx > 60) { moved = true; bubble.style.transform = `translateX(${Math.min(dx,100)}px)`; }
  }, { passive:true });
  bubble.addEventListener('touchend', () => {
    if (moved) { bubble.style.transform = ''; setReply(msg); }
  });
}

function setReply(msg) {
  State.replyTo = {
    name: msg.fromName || '',
    text: msg.text || (msg.type === 'image' ? '📷 صورة' : msg.type === 'audio' ? '🎵 تسجيل' : '📄 ملف'),
    url: msg.url, fileName: msg.fileName, type: msg.type
  };
  $('#rp-name').textContent = State.replyTo.name;
  $('#rp-text').textContent = State.replyTo.text;
  $('#reply-preview').classList.add('open');
}
function clearReply() { State.replyTo = null; $('#reply-preview').classList.remove('open'); }
$('#rp-cancel').addEventListener('click', clearReply);

/* ============================================================
   13) لوحة (+)
   ============================================================ */
$('#btn-plus').addEventListener('click', e => {
  e.stopPropagation();
  $('#options-panel').classList.toggle('open');
  $('#emoji-picker').classList.remove('open');
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
      toast('🌫️ الرسالة القادمة ستكون مغبشة');
      $('#msg-input').focus();
    }
  });
});

/* رفع الصور */
$('#file-input').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f || !State.currentChat) return;
  const chat = State.currentChat, reply = State.replyTo;   // تثبيت الطرف قبل الرفع
  toast('جاري رفع الصورة...');
  try {
    let url = await Store.uploadFile(f, p => toast(`رفع ${Math.round(p*100)}%`));
    if (!url) url = await fallbackBase64(f);
    sendTo(chat, { type: 'image', url, fileName: f.name, replyTo: reply, reactions: {} });
    if (State.replyTo === reply) clearReply();
  } catch (err) { console.error(err); toast('فشل رفع الصورة'); }
  e.target.value = '';
});

/* رفع الصوت */
$('#music-input').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f || !State.currentChat) return;
  const chat = State.currentChat, reply = State.replyTo;   // تثبيت الطرف قبل الرفع
  toast('جاري رفع الصوت...');
  try {
    let url = await Store.uploadFile(f, p => toast(`رفع ${Math.round(p*100)}%`));
    if (!url) url = await fallbackBase64(f);
    sendTo(chat, { type: 'audio', url, fileName: f.name, replyTo: reply, reactions: {} });
    if (State.replyTo === reply) clearReply();
  } catch (err) { console.error(err); toast('فشل رفع الصوت'); }
  e.target.value = '';
});

/* رفع ملف */
$('#doc-input').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f || !State.currentChat) return;
  const chat = State.currentChat, reply = State.replyTo;   // تثبيت الطرف قبل الرفع
  toast('جاري رفع الملف...');
  try {
    let url = await Store.uploadFile(f, p => toast(`رفع ${Math.round(p*100)}%`));
    if (!url) url = await fallbackBase64(f);
    sendTo(chat, { type: 'file', url, fileName: f.name, replyTo: reply, reactions: {} });
    if (State.replyTo === reply) clearReply();
  } catch (err) { console.error(err); toast('فشل رفع الملف'); }
  e.target.value = '';
});

function fallbackBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/* ============================================================
   14) الإيموجي
   ============================================================ */
const EMOJIS = ('😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 ☺️ 😚 😙 ' +
'🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 ' +
'😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥺 🥹 😢 😭 😤 😠 😡 🤬 🤡 💀 ☠️ ' +
'❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 🔥 ✨ ⭐ 🌟 💫 ⚡ ' +
'👍 👎 👌 ✌️ 🤞 🤟 🤘 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤙 💪 🙏 🫶').split(' ');

function buildEmojiPicker() {
  const grid = $('#emoji-grid');
  grid.innerHTML = '';
  EMOJIS.forEach(e => {
    const s = document.createElement('span');
    s.textContent = e;
    s.addEventListener('click', () => {
      const input = $('#msg-input');
      input.value += e;
      input.focus();
    });
    grid.appendChild(s);
  });
}
buildEmojiPicker();

$('#btn-emoji').addEventListener('click', e => {
  e.stopPropagation();
  $('#emoji-picker').classList.toggle('open');
  $('#options-panel').classList.remove('open');
});

/* ============================================================
   15) التفاعلات
   ============================================================ */
function openReactions(msgId, bubble) {
  State.currentReactionMsgId = msgId;
  const rect = bubble.getBoundingClientRect();
  const bar = $('#reactions-bar');
  bar.style.left = Math.max(10, rect.left) + 'px';
  bar.style.top  = Math.max(10, rect.top - 46) + 'px';
  bar.classList.add('open');
}

$$('#reactions-bar span').forEach(s => {
  s.addEventListener('click', e => {
    e.stopPropagation();
    if (!State.currentReactionMsgId) return;
    addReaction(State.currentReactionMsgId, s.dataset.r);
    $('#reactions-bar').classList.remove('open');
  });
});

function addReaction(msgId, emo) {
  if (!State.currentChat) return;
  const chatId = Store.chatIdOf(State.user, State.currentChat);
  Store.toggleReaction(chatId, msgId, emo, State.user)
    .then(() => toast('تم التفاعل ' + emo))
    .catch(() => toast('تعذّر إضافة التفاعل'));
}

document.addEventListener('click', e => {
  if (!e.target.closest('#reactions-bar') && !e.target.closest('.msg-bubble')) {
    $('#reactions-bar').classList.remove('open');
  }
  if (!e.target.closest('#options-panel') && !e.target.closest('#btn-plus')) {
    $('#options-panel').classList.remove('open');
  }
  if (!e.target.closest('#emoji-picker') && !e.target.closest('#btn-emoji')) {
    $('#emoji-picker').classList.remove('open');
  }
});

/* ============================================================
   16) التسجيل الصوتي
   ============================================================ */
$('#btn-mic').addEventListener('click', startRecording);
$('#rec-cancel').addEventListener('click', cancelRecording);
$('#rec-pause').addEventListener('click', pauseRecording);
$('#rec-draft').addEventListener('click', saveDraft);
$('#rec-send').addEventListener('click', sendRecording);

async function startRecording() {
  if (!State.currentChat) { toast('افتح محادثة أولاً'); return; }
  State.recChat = State.currentChat;   // تثبيت الطرف عند بدء التسجيل
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    State.mediaRecorder = new MediaRecorder(stream);
    State.recChunks = [];
    State.recSeconds = 0;
    State.recording = true;
    State.paused = false;
    State.cancelled = false;
    State.savedAsDraft = false;

    State.mediaRecorder.ondataavailable = e => State.recChunks.push(e.data);
    State.mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (State.cancelled) { State.cancelled = false; cleanupRecording(); return; }
      if (State.savedAsDraft) { State.savedAsDraft = false; cleanupRecording(); return; }
      const blob = new Blob(State.recChunks, { type:'audio/webm' });
      await sendAudioBlob(blob);
      cleanupRecording();
    };

    State.mediaRecorder.start();
    $('#record-panel').classList.add('open');
    $('#btn-mic').textContent = '⏹';
    startRecTimer();
  } catch { toast('لا يمكن الوصول للميكروفون'); }
}

async function sendAudioBlob(blob) {
  const chat = State.recChat, reply = State.replyTo;
  if (!chat) return;
  const f = new File([blob], 'voice_' + Date.now() + '.webm', { type:'audio/webm' });
  toast('جاري رفع التسجيل...');
  try {
    let url = await Store.uploadFile(f);
    if (!url) url = await fallbackBase64(f);
    sendTo(chat, { type: 'audio', url, fileName: 'تسجيل صوتي', replyTo: reply, reactions: {} });
    if (State.replyTo === reply) clearReply();
  } catch (err) { console.error(err); toast('فشل رفع التسجيل'); }
}

function startRecTimer() {
  clearInterval(State.recTimer);
  State.recTimer = setInterval(() => {
    if (State.paused) return;
    State.recSeconds++;
    const m = String(Math.floor(State.recSeconds/60)).padStart(2,'0');
    const s = String(State.recSeconds%60).padStart(2,'0');
    $('#rec-time').textContent = `${m}:${s}`;
  }, 1000);
}

function cancelRecording() {
  if (State.mediaRecorder && State.recording) {
    State.cancelled = true;
    State.mediaRecorder.stop();
  } else cleanupRecording();
  toast('تم إلغاء التسجيل');
}

function pauseRecording() {
  if (!State.mediaRecorder) return;
  if (State.paused) {
    State.mediaRecorder.resume();
    State.paused = false;
    $('#rec-pause').textContent = '■';
  } else {
    State.mediaRecorder.pause();
    State.paused = true;
    $('#rec-pause').textContent = '▶';
  }
}

function sendRecording() {
  if (!State.mediaRecorder) return;
  State.mediaRecorder.stop();
}

async function saveDraft() {
  if (!State.mediaRecorder) return;
  State.savedAsDraft = true;
  const chunks = State.recChunks.slice();
  const blob = new Blob(chunks, { type:'audio/webm' });
  const reader = new FileReader();
  reader.onload = () => {
    Store.saveDraft(State.user, reader.result);
    toast('⏳ تم حفظ المسودة');
  };
  reader.readAsDataURL(blob);
  State.mediaRecorder.stop();
}

function cleanupRecording() {
  State.recording = false;
  State.paused = false;
  State.mediaRecorder = null;
  State.recChunks = [];
  State.recSeconds = 0;
  clearInterval(State.recTimer);
  $('#record-panel').classList.remove('open');
  $('#btn-mic').textContent = '🎤';
  $('#rec-time').textContent = '00:00';
  $('#rec-pause').textContent = '■';
}

/* ============================================================
   17) العارض والتوست
   ============================================================ */
function openViewer(type, url, fname) {
  const body = $('#viewer-body');
  body.innerHTML = type === 'image' ? `<img src="${url}">` : `<video src="${url}" controls></video>`;
  $('#viewer-download').onclick = () => {
    downloadMedia(url, fname || 'media', type);
  };
  $('#viewer').classList.add('open');
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

/* ============================================================
   18) التنقل
   ============================================================ */
function goTo(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#' + id).classList.add('active');
}

$('#btn-back').addEventListener('click', () => {
  State.currentChat = null;
  closeSearch();
  $('#chat-menu').classList.remove('open');
  $('#messages').innerHTML = '';
  goTo('screen-inbox');
});

/* ============================================================
   19) الجزيئات
   ============================================================ */
(function initParticles() {
  const c = $('#particles');
  if (!c) return;
  const ctx = c.getContext('2d');
  let W, H, parts = [];
  function resize() { W = c.width = window.innerWidth; H = c.height = window.innerHeight; }
  function make() {
    parts = [];
    for (let i = 0; i < 40; i++) {
      parts.push({
        x:Math.random()*W, y:Math.random()*H,
        vx:(Math.random()-.5)*.4, vy:(Math.random()-.5)*.4,
        r:Math.random()*2 + 1
      });
    }
  }
  function loop() {
    ctx.clearRect(0,0,W,H);
    const col = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#fff';
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x<0||p.x>W) p.vx *= -1;
      if (p.y<0||p.y>H) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = col;
      ctx.globalAlpha = .5;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(loop);
  }
  window.addEventListener('resize', () => { resize(); make(); });
  resize(); make(); loop();
})();

window.addEventListener('beforeunload', e => {
  if (State.recording) { e.preventDefault(); e.returnValue = ''; }
});

/* ============================================================
   20) قائمة ⋮ : بحث / تحديث / مسح الشات
   ============================================================ */
$('#btn-more').addEventListener('click', e => {
  e.stopPropagation();
  $('#palette-bar').classList.remove('open');
  $('#settings-panel').classList.remove('open');
  $('#profile-card').classList.remove('open');
  $('#chat-menu').classList.toggle('open');
});
document.addEventListener('click', e => {           // مرحلة الالتقاط: تعمل حتى مع stopPropagation
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

/* ---------- نافذة تأكيد ---------- */
function askConfirm(title, text, okLabel) {
  return new Promise(res => {
    $('#cm-title').textContent = title;
    $('#cm-text').textContent = text;
    $('#cm-ok').textContent = okLabel || 'تأكيد';
    const m = $('#confirm-modal');
    m.classList.add('open');
    const done = v => { m.classList.remove('open'); $('#cm-ok').onclick = null; $('#cm-cancel').onclick = null; res(v); };
    $('#cm-ok').onclick = () => done(true);
    $('#cm-cancel').onclick = () => done(false);
  });
}

/* ---------- مسح الشات بالكامل ---------- */
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
    State.messages[other] = [];
    setTimeout(() => { if (State.currentChat === other) $('#messages').innerHTML = ''; renderInbox(); }, 500);
    toast('تم مسح الشات ✔');
  } catch (err) { console.error(err); toast('تعذّر مسح الشات'); }
}

/* ============================================================
   21) البحث داخل الشات
   ============================================================ */
/* تطبيع عربي: يتجاهل التشكيل والتطويل ويوحّد الألف والياء والتاء المربوطة */
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

function openSearch() {
  if (!State.currentChat) return;
  $('#search-bar').classList.add('open');
  $('#search-input').value = '';
  $('#search-results').innerHTML = '<div class="search-empty">اكتب كلمة أو جزءاً منها للبحث 🔍</div>';
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
$('#search-input').addEventListener('input', runSearch);

function runSearch() {
  const box = $('#search-results');
  const raw = $('#search-input').value.trim();
  if (!raw) { box.innerHTML = '<div class="search-empty">اكتب كلمة أو جزءاً منها للبحث 🔍</div>'; return; }
  const q = normMap(raw).out;
  const other = State.currentChat;
  const found = [];
  (State.messages[other] || []).slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).forEach(m => {
    if (m.blur && !m.revealed && m.from !== State.user) return;       // لا نكشف الرسائل المغبشة
    const txt = (!m.type || m.type === 'text') ? (m.text || '') : (m.fileName || '');
    if (!txt) return;
    const pos = normMap(txt).out.indexOf(q);
    if (pos !== -1) found.push({ m, txt });
  });
  box.innerHTML = '';
  if (!found.length) { box.innerHTML = '<div class="search-empty">لا توجد نتائج 🙁</div>'; return; }
  found.slice(0, 50).forEach(({ m, txt }) => {
    const { out, map } = normMap(txt);
    const p = map[out.indexOf(q)] || 0;
    const a = Math.max(0, p - 25), b = Math.min(txt.length, p + raw.length + 60);
    const snippet = (a > 0 ? '…' : '') + txt.slice(a, b) + (b < txt.length ? '…' : '');
    const d = new Date(m.timestamp || Date.now());
    const el = document.createElement('div');
    el.className = 'search-item';
    el.innerHTML = `<div class="si-head"><b>${m.from === State.user ? 'أنت' : escapeHtml(m.fromName || USERS[m.from].name)}</b>
      <span>${d.toLocaleDateString('ar')} ${formatTime(m.timestamp)}</span></div>
      <div class="si-text">${highlight(snippet, q)}</div>`;
    el.addEventListener('click', () => {
      closeSearch();
      const row = findRow(m._id);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
        setTimeout(() => row.classList.remove('flash'), 1800);
      }
    });
    box.appendChild(el);
  });
}

/* ============================================================
   22) زر تهكير 💀 (فخ) + تبديل الحساب
   ============================================================ */
$('#btn-hack').addEventListener('click', e => {
  e.stopPropagation();
  const ov = $('#hack-overlay');
  if (ov.classList.contains('show')) return;
  ov.classList.add('show');
  if (navigator.vibrate) navigator.vibrate([120, 60, 200]);
  setTimeout(() => { logout(); ov.classList.remove('show'); }, 2600);
});
$('#set-logout').addEventListener('click', logout);

/* ============================================================
   23) تأثير الموجة عند الضغط على أي زر
   ============================================================ */
document.addEventListener('pointerdown', e => {
  const t = e.target.closest('.btn, .icon-btn, .opt-btn, .inbox-item, .hack-btn, .menu-item, .search-item');
  if (!t) return;
  const r = t.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2;
  const sp = document.createElement('span');
  sp.className = 'ripple';
  sp.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  t.appendChild(sp);
  setTimeout(() => sp.remove(), 700);
});

/* ============================================================
   24) الإقلاع: الجلسة المحفوظة → "جار التحميل" → الحساب مباشرة
   ============================================================ */
(function boot() {
  let sess = null;
  try { sess = JSON.parse(localStorage.getItem('session_v1') || 'null'); } catch (e) {}
  if (sess && USERS[sess.user]) {
    document.body.dataset.theme = sess.user;
    const sc = localStorage.getItem('themeColor_' + sess.user);
    const c = THEME_COLORS.find(x => x.id === sc);
    if (c) applyThemeColor(c.v);
    goTo('screen-loading');
    setTimeout(() => startSession(sess.user), 1400);
  } else {
    goTo('screen-password');
  }
})();

console.log('%c✅ app.js — الإصدار النهائي جاهز', 'color:#10b981;font-weight:bold;font-size:14px');