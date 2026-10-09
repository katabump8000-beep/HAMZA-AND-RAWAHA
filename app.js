/* ============================================================
   app.js — منطق التطبيق الرئيسي
   ============================================================ */

/* ---------- مراجع سريعة ---------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------- الحالة ---------- */
const State = {
  user: null,           // 'hamza' أو 'rawaha'
  myProfile: {},
  otherProfile: {},
  replyTo: null,
  recording: false,
  paused: false,
  mediaRecorder: null,
  recChunks: [],
  recSeconds: 0,
  recTimer: null,
  currentReactionMsgId: null,
  pendingBlur: false,
  themeColor: '1'
};

const PASSWORD = '67';
const USERS = {
  hamza:  { name:'حمزة', tag:'J.C' },
  rawaha: { name:'رواحة', tag:'Itachi' }
};

/* ============================================================
   1) شاشة كلمة السر
   ============================================================ */
$('#btn-password').addEventListener('click', checkPassword);
$('#password-input').addEventListener('keydown', e => { if (e.key === 'Enter') checkPassword(); });

function checkPassword() {
  const v = $('#password-input').value.trim();
  if (v === PASSWORD) {
    $('#password-error').textContent = '';
    goTo('screen-permissions');
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
   2) شاشة الأذونات
   ============================================================ */
$('#bell-3d').addEventListener('click', requestAllPerms);
$('#btn-request-perms').addEventListener('click', requestAllPerms);
$('#btn-skip-perms').addEventListener('click', () => {
  // العودة لشاشة كلمة السر
  $('#password-input').value = '';
  goTo('screen-password');
});

async function requestAllPerms() {
  const bell = $('#bell-3d');
  bell.classList.add('ringing');

  const results = await Promise.allSettled([
    requestNotifications(),
    requestMicrophone(),
    requestCamera(),
    requestStorage()
  ]);

  bell.classList.remove('ringing');

  // سجّل النتائج
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

  // إذا كل الأذونات مقبولة → انتقل
  const allOk = results.every(r => r.status === 'fulfilled' && r.value);
  if (allOk) {
    $('#btn-request-perms').classList.add('done');
    $('#btn-request-perms').textContent = '✔ تم منح جميع الأذونات';
    setTimeout(() => goTo('screen-identity'), 700);
  } else {
    toast('بعض الأذونات مرفوضة — اضغط تخطي أو أعد المحاولة');
  }
}

async function requestNotifications() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const p = await Notification.requestPermission();
  return p === 'granted';
}

async function requestMicrophone() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio:true });
    s.getTracks().forEach(t => t.stop());
    return true;
  } catch { return false; }
}

async function requestCamera() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video:true });
    s.getTracks().forEach(t => t.stop());
    return true;
  } catch { return false; }
}

async function requestStorage() {
  // لا يوجد API رسمي — نعتبره دائماً مسموحاً
  // (الملفات تُرفع يدوياً من قبل المستخدم)
  return true;
}

/* ============================================================
   3) شاشة الهوية
   ============================================================ */
$$('.identity-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const uid = btn.dataset.user;
    State.user = uid;
    document.body.dataset.theme = uid;
    enterChat();
  });
});

/* ============================================================
   4) الدخول للشات
   ============================================================ */
function enterChat() {
  goTo('screen-chat');
  initChatUI();
  loadProfiles();
  Store.updateLastSeen(State.user);

  // تحديث آخر ظهور كل 20 ثانية
  setInterval(() => Store.updateLastSeen(State.user), 20000);

  // استقبال الرسائل
  Store.listenMessages((msg, id) => {
    if (!msg || !msg.from) return;
    renderMessage(msg, id);
    scrollToBottom();
  });

  // استقبال حالة المستخدمين
  Store.listenUsers(users => {
    const other = State.user === 'hamza' ? 'rawaha' : 'hamza';
    const o = users[other];
    if (o) {
      State.otherProfile = o;
      if (o.name) {
        $('#hdr-name').textContent = o.name;
        $('#hdr-avatar').innerHTML = o.avatar
          ? `<img src="${o.avatar}">`
          : (USERS[other].name[0]);
      }
      updateLastSeenUI(o.lastSeen);
    }
  });
}

function initChatUI() {
  const other = State.user === 'hamza' ? 'rawaha' : 'hamza';
  $('#hdr-name').textContent = USERS[other].name;
  $('#hdr-avatar').textContent = USERS[other].name[0];
  $('#pc-tag').textContent = USERS[State.user].tag;
}

function updateLastSeenUI(ts) {
  if (!ts) { $('#hdr-status').textContent = 'غير متصل'; return; }
  const diff = (Date.now() - ts) / 1000;
  const el = $('#hdr-status');
  if (diff < 30) { el.textContent = 'متصل الآن'; el.classList.add('online'); }
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
setInterval(() => {
  if (State.otherProfile.lastSeen) updateLastSeenUI(State.otherProfile.lastSeen);
}, 30000);

/* ============================================================
   5) تحميل بيانات البروفايل
   ============================================================ */
function loadProfiles() {
  const me = State.user;
  const saved = JSON.parse(localStorage.getItem('profile_' + me) || '{}');
  if (saved.name) $('#name-input').value = saved.name;
  if (saved.avatar) {
    $('#pc-avatar').innerHTML = `<img src="${saved.avatar}">`;
    $('#hdr-avatar').innerHTML = `<img src="${saved.avatar}">`;
  } else {
    $('#pc-avatar').textContent = USERS[me].name[0];
  }
  Store.listenUsers(users => {
    const u = users[me];
    if (u && u.name) {
      $('#name-input').value = u.name;
      if (u.avatar) {
        $('#pc-avatar').innerHTML = `<img src="${u.avatar}">`;
      }
    }
  });
}

/* ---------- فتح بطاقة البروفايل ---------- */
$('#open-profile').addEventListener('click', () => {
  $('#profile-card').classList.toggle('open');
  $('#palette-bar').classList.remove('open');
});

/* ---------- رفع صورة البروفايل ---------- */
$('#btn-upload-avatar').addEventListener('click', () => $('#avatar-upload').click());
$('#avatar-upload').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const url = await Store.uploadFile(f, p => toast(`جاري الرفع... ${Math.round(p*100)}%`));
    localStorage.setItem('profile_' + State.user, JSON.stringify({
      name: $('#name-input').value || USERS[State.user].name,
      avatar: url
    }));
    $('#pc-avatar').innerHTML = `<img src="${url}">`;
    $('#hdr-avatar').innerHTML = `<img src="${url}">`;
    toast('تم تحديث الصورة ✔');
  } catch { toast('فشل رفع الصورة'); }
});

/* ---------- حفظ البروفايل ---------- */
$('#btn-save-profile').addEventListener('click', () => {
  const name = $('#name-input').value.trim() || USERS[State.user].name;
  const avatar = $('#pc-avatar').querySelector('img')?.src || '';
  Store.saveUser(State.user, { name, avatar });
  localStorage.setItem('profile_' + State.user, JSON.stringify({ name, avatar }));
  toast('تم الحفظ ✔');
  $('#profile-card').classList.remove('open');
});

/* ============================================================
   6) الألوان (8 سمات + 12 لون نصوص)
   ============================================================ */
const THEME_COLORS = [
  { id:'1', v:'#ff2d2d' }, { id:'2', v:'#2d7fff' },
  { id:'3', v:'#ffd93d' }, { id:'4', v:'#2dff7f' },
  { id:'5', v:'#ff8a2d' }, { id:'6', v:'#a02dff' },
  { id:'7', v:'#ff2d9e' }, { id:'8', v:'#2dffd9' }
];

function buildPalette() {
  const wrap = $('#palette-colors');
  wrap.innerHTML = '';
  THEME_COLORS.forEach(c => {
    const s = document.createElement('div');
    s.className = 'swatch' + (c.id === State.themeColor ? ' active' : '');
    s.style.background = c.v;
    s.dataset.id = c.id;
    s.addEventListener('click', () => {
      State.themeColor = c.id;
      document.body.dataset.color = c.id;
      document.documentElement.style.setProperty('--accent', c.v);
      $$('.palette-colors .swatch').forEach(x => x.classList.toggle('active', x.dataset.id === c.id));
      localStorage.setItem('themeColor', c.id);
    });
    wrap.appendChild(s);
  });
}
buildPalette();
const savedColor = localStorage.getItem('themeColor');
if (savedColor) {
  const c = THEME_COLORS.find(x => x.id === savedColor);
  if (c) {
    State.themeColor = c.id;
    document.documentElement.style.setProperty('--accent', c.v);
    document.body.dataset.color = c.id;
  }
}

$('#btn-palette').addEventListener('click', () => {
  $('#palette-bar').classList.toggle('open');
  $('#profile-card').classList.remove('open');
});
$('#btn-palette-close').addEventListener('click', () => $('#palette-bar').classList.remove('open'));

/* ============================================================
   7) عرض الرسائل
   ============================================================ */
function renderMessage(msg, id) {
  const isMe = msg.from === State.user;
  const row = document.createElement('div');
  row.className = 'msg-row ' + (isMe ? 'me' : 'other');
  row.dataset.id = id;

  // الصورة الرمزية
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  const prof = msg.avatar;
  if (prof) avatar.innerHTML = `<img src="${prof}">`;
  else avatar.textContent = (msg.fromName || '?')[0];
  row.appendChild(avatar);

  // الفقاعة
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (msg.blur && !msg.revealed) bubble.classList.add('blurred');

  // الرد
  if (msg.replyTo) {
    const r = document.createElement('div');
    r.className = 'msg-reply';
    r.innerHTML = `<b>${msg.replyTo.name || ''}</b>${escapeHtml(msg.replyTo.text || '')}`;
    bubble.appendChild(r);
  }

  // المحتوى
  const content = document.createElement('div');
  content.className = 'msg-content';

  if (msg.type === 'image') {
    const img = document.createElement('img');
    img.src = msg.url; img.className = 'msg-image';
    img.addEventListener('click', () => openViewer('image', msg.url));
    content.appendChild(img);
  } else if (msg.type === 'audio') {
    const wrap = document.createElement('div');
    wrap.className = 'msg-audio';
    wrap.innerHTML = `<span>🎵</span><audio controls src="${msg.url}"></audio>`;
    content.appendChild(wrap);
  } else if (msg.type === 'file') {
    const wrap = document.createElement('div');
    wrap.className = 'msg-file';
    wrap.innerHTML = `<span class="f-ico">📄</span>
      <div><div class="f-name">${escapeHtml(msg.fileName || 'ملف')}</div>
      <a href="${msg.url}" download class="btn small" style="padding:4px 10px;font-size:11px;">تحميل</a></div>`;
    content.appendChild(wrap);
  } else {
    content.innerHTML = parseColorCodes(msg.text || '');
  }
  bubble.appendChild(content);

  // الوقت
  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = formatTime(msg.timestamp);
  bubble.appendChild(time);

  // التفاعلات
  if (msg.reactions && Object.keys(msg.reactions).length) {
    const rx = document.createElement('div');
    rx.className = 'msg-reactions';
    rx.innerHTML = Object.entries(msg.reactions)
      .map(([emo, users]) => `<span>${emo} ${users.length}</span>`).join('');
    bubble.appendChild(rx);
  }

  // أحداث
  bubble.addEventListener('click', () => {
    if (bubble.classList.contains('blurred') && !isMe) {
      bubble.classList.add('revealed');
      bubble.classList.remove('blurred');
      Store.updateMessage(id, { revealed: true });
    }
  });

  let pressTimer = null;
  bubble.addEventListener('touchstart', e => {
    pressTimer = setTimeout(() => openReactions(id, bubble), 500);
  }, { passive:true });
  bubble.addEventListener('touchend', () => clearTimeout(pressTimer));
  bubble.addEventListener('contextmenu', e => { e.preventDefault(); openReactions(id, bubble); });

  // السحب للرد
  attachSwipeToReply(bubble, msg);

  row.appendChild(bubble);
  $('#messages').appendChild(row);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* تحويل ~1نص~ إلى <span class="tc1">نص</span> */
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
   8) إرسال الرسائل
   ============================================================ */
$('#btn-send').addEventListener('click', sendTextMessage);
$('#msg-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
});
$('#msg-input').addEventListener('input', e => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
});

function sendTextMessage() {
  const input = $('#msg-input');
  const text = input.value.trim();
  if (!text) return;

  // أمر التحميل
  if (text === '.تحميل' && State.replyTo) {
    downloadReply(State.replyTo);
    input.value = '';
    clearReply();
    return;
  }

  Store.sendMessage({
    from: State.user,
    fromName: $('#name-input').value || USERS[State.user].name,
    avatar: $('#pc-avatar').querySelector('img')?.src || '',
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
  if (!r.url) { toast('لا يوجد ملف للتحميل'); return; }
  const a = document.createElement('a');
  a.href = r.url;
  a.download = r.fileName || 'download';
  a.click();
  toast('جاري التحميل...');
}

/* ============================================================
   9) الرد والسحب
   ============================================================ */
function attachSwipeToReply(bubble, msg) {
  let startX = 0, moved = false;
  bubble.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX; moved = false;
  }, { passive:true });
  bubble.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    if (dx > 60) { moved = true; bubble.style.transform = `translateX(${Math.min(dx,100)}px)`; }
  }, { passive:true });
  bubble.addEventListener('touchend', e => {
    if (moved) {
      bubble.style.transform = '';
      setReply(msg);
    }
  });
}

function setReply(msg) {
  State.replyTo = {
    name: msg.fromName || '',
    text: msg.text || (msg.type === 'image' ? '📷 صورة' : msg.type === 'audio' ? '🎵 تسجيل' : '📄 ملف'),
    url: msg.url,
    fileName: msg.fileName,
    type: msg.type
  };
  $('#rp-name').textContent = State.replyTo.name;
  $('#rp-text').textContent = State.replyTo.text;
  $('#reply-preview').classList.add('open');
}
function clearReply() {
  State.replyTo = null;
  $('#reply-preview').classList.remove('open');
}
$('#rp-cancel').addEventListener('click', clearReply);

/* ============================================================
   10) قائمة (+)
   ============================================================ */
$('#btn-plus').addEventListener('click', () => {
  $('#options-panel').classList.toggle('open');
  $('#emoji-picker').classList.remove('open');
});

$$('.opt-btn').forEach(b => {
  b.addEventListener('click', () => {
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
  const f = e.target.files[0]; if (!f) return;
  try {
    const url = await Store.uploadFile(f, p => toast(`رفع ${Math.round(p*100)}%`));
    Store.sendMessage({
      from: State.user,
      fromName: $('#name-input').value || USERS[State.user].name,
      avatar: $('#pc-avatar').querySelector('img')?.src || '',
      type: 'image', url, fileName: f.name,
      replyTo: State.replyTo, reactions: {}
    });
    clearReply();
  } catch { toast('فشل رفع الصورة'); }
  e.target.value = '';
});

/* رفع الموسيقى */
$('#music-input').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const url = await Store.uploadFile(f, p => toast(`رفع ${Math.round(p*100)}%`));
    Store.sendMessage({
      from: State.user,
      fromName: $('#name-input').value || USERS[State.user].name,
      avatar: $('#pc-avatar').querySelector('img')?.src || '',
      type: 'audio', url, fileName: f.name,
      replyTo: State.replyTo, reactions: {}
    });
    clearReply();
  } catch { toast('فشل رفع الصوت'); }
  e.target.value = '';
});

/* رفع الملفات */
$('#doc-input').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const url = await Store.uploadFile(f, p => toast(`رفع ${Math.round(p*100)}%`));
    Store.sendMessage({
      from: State.user,
      fromName: $('#name-input').value || USERS[State.user].name,
      avatar: $('#pc-avatar').querySelector('img')?.src || '',
      type: 'file', url, fileName: f.name,
      replyTo: State.replyTo, reactions: {}
    });
    clearReply();
  } catch { toast('فشل رفع الملف'); }
  e.target.value = '';
});

/* ============================================================
   11) الإيموجي
   ============================================================ */
const EMOJIS = ('😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 ☺️ 😚 😙 ' +
'🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 ' +
'😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥺 🥹 😢 😭 😤 😠 😡 🤬 🤥 🤡 💀 ☠️ ' +
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

$('#btn-emoji').addEventListener('click', () => {
  $('#emoji-picker').classList.toggle('open');
  $('#options-panel').classList.remove('open');
});

/* ============================================================
   12) التفاعلات
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
  s.addEventListener('click', () => {
    if (!State.currentReactionMsgId) return;
    addReaction(State.currentReactionMsgId, s.dataset.r);
    $('#reactions-bar').classList.remove('open');
  });
});

function addReaction(msgId, emo) {
  if (fbReady) {
    const ref = fbDB.ref(`messages/${msgId}/reactions/${emo}`);
    ref.transaction(cur => {
      cur = cur || [];
      const i = cur.indexOf(State.user);
      if (i >= 0) cur.splice(i,1);
      else cur.push(State.user);
      return cur;
    });
  } else {
    const msgs = JSON.parse(localStorage.getItem('local_msgs') || '[]');
    const i = parseInt(msgId.replace('local_', ''));
    const m = msgs[i]; if (!m) return;
    m.reactions = m.reactions || {};
    m.reactions[emo] = m.reactions[emo] || [];
    const k = m.reactions[emo].indexOf(State.user);
    if (k >= 0) m.reactions[emo].splice(k,1);
    else m.reactions[emo].push(State.user);
    localStorage.setItem('local_msgs', JSON.stringify(msgs));
    // إعادة رسم
    toast('تم التفاعل ' + emo);
  }
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
   13) التسجيل الصوتي
   ============================================================ */
$('#btn-mic').addEventListener('click', startRecording);
$('#rec-cancel').addEventListener('click', cancelRecording);
$('#rec-pause').addEventListener('click', pauseRecording);
$('#rec-draft').addEventListener('click', saveDraft);

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    State.mediaRecorder = new MediaRecorder(stream);
    State.recChunks = [];
    State.recSeconds = 0;
    State.recording = true;
    State.paused = false;

    State.mediaRecorder.ondataavailable = e => State.recChunks.push(e.data);
    State.mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(State.recChunks, { type:'audio/webm' });
      const f = new File([blob], 'voice_' + Date.now() + '.webm', { type:'audio/webm' });
      const url = await Store.uploadFile(f);
      Store.sendMessage({
        from: State.user,
        fromName: $('#name-input').value || USERS[State.user].name,
        avatar: $('#pc-avatar').querySelector('img')?.src || '',
        type: 'audio', url, fileName: 'تسجيل صوتي',
        replyTo: State.replyTo, reactions: {}
      });
      clearReply();
    };

    State.mediaRecorder.start();
    $('#record-panel').classList.add('open');
    $('#btn-mic').textContent = '⏹';
    startRecTimer();
  } catch { toast('لا يمكن الوصول للميكروفون'); }
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
    State.mediaRecorder.onstop = null;
    State.mediaRecorder.stop();
  }
  cleanupRecording();
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

async function saveDraft() {
  if (!State.mediaRecorder) return;
  // أنشئ blob مؤقت واحفظه في localStorage
  const chunks = State.recChunks.slice();
  const blob = new Blob(chunks, { type:'audio/webm' });
  const reader = new FileReader();
  reader.onload = () => {
    Store.saveDraft(State.user, reader.result);
    toast('⏳ تم حفظ المسودة');
    cancelRecording();
  };
  reader.readAsDataURL(blob);
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
}

/* ============================================================
   14) العارض والمشغل
   ============================================================ */
function openViewer(type, url) {
  const body = $('#viewer-body');
  body.innerHTML = type === 'image' ? `<img src="${url}">` : `<video src="${url}" controls></video>`;
  $('#viewer-download').onclick = () => {
    const a = document.createElement('a'); a.href = url; a.download = 'media'; a.click();
  };
  $('#viewer').classList.add('open');
}
$('#viewer-close').addEventListener('click', () => $('#viewer').classList.remove('open'));

/* ============================================================
   15) التوست
   ============================================================ */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ============================================================
   16) التنقل بين الشاشات
   ============================================================ */
function goTo(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#' + id).classList.add('active');
}

/* ---------- زر الرجوع من الشات ---------- */
$('#btn-back').addEventListener('click', () => {
  if (confirm('هل تريد الخروج؟')) {
    location.reload();
  }
});

/* ============================================================
   17) الجزيئات في الخلفية
   ============================================================ */
(function initParticles() {
  const c = $('#particles');
  const ctx = c.getContext('2d');
  let W, H, parts = [];
  function resize() {
    W = c.width = window.innerWidth;
    H = c.height = window.innerHeight;
  }
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
    const col = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#fff';
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

/* ============================================================
   18) منع إغلاق الصفحة أثناء التسجيل
   ============================================================ */
window.addEventListener('beforeunload', e => {
  if (State.recording) { e.preventDefault(); e.returnValue = ''; }
});

console.log('%c✅ التطبيق جاهز', 'color:#10b981;font-weight:bold;font-size:14px');