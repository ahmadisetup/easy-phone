/* ═══════════════════════════════════════════════════
   گوشی آسان — اپلیکیشن سالمندانه
   تماس ساده | پیام آماده | فرمان صوتی | یادآور دارو | دکمه اضطراری
   ═══════════════════════════════════════════════════ */
'use strict';

/* ─────────── ابزارهای پایه ─────────── */
const $  = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const faDig = s => String(s).replace(/\d/g, d => FA_DIGITS[d]);

function normFa(s) {
  return String(s)
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/ۀ|هٔ/g, 'ه')
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normPhone(p) {
  return String(p)
    .replace(/[۰-۹]/g, d => FA_DIGITS.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[\s\-()]/g, '')
    .trim();
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayKey = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const hmNow = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const toMin = hm => parseInt(hm.slice(0, 2), 10) * 60 + parseInt(hm.slice(3, 5), 10);

function openLink(href) {
  const a = document.createElement('a');
  a.href = href;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 3000);
}

/* ─────────── داده‌ها ─────────── */
const STORE_KEY = 'gooshi-asan-v1';
const PALETTE = ['#283593', '#00695C', '#6A1B9A', '#1565C0', '#AD1457', '#5D4037', '#E65100', '#37474F'];

function defaults() {
  return {
    version: 1,
    pin: null,
    contacts: [],   // {id,name,relation,phone,color,emergency}
    messages: ['زنگ بزن برایم', 'خوب هستم', 'به مقصد رسیدم', 'سالم و سلامت هستم'],
    meds: [],       // {id,name,times:['08:00',...]}
    taken: {},      // {dateKey:{medId:[times]}}
    spokenOverdue: {}
  };
}

let data = defaults();

function loadData() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) data = Object.assign(defaults(), JSON.parse(raw));
  } catch (e) { /* شروع تازه */ }
}
function saveData() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {}
}

/* ─────────── روتر صفحات ─────────── */
let navStack = [];
function showScreen(id) {
  const target = $(id);
  if (!target || target.classList.contains('current')) return;
  const cur = document.querySelector('.screen.current');
  if (cur) { navStack.push(cur.id); cur.classList.remove('current'); }
  target.classList.add('current');
}
function closeScreen() {
  const cur = document.querySelector('.screen.current');
  const prev = navStack.pop() || 'screen-home';
  $$('.screen.current').forEach(s => s.classList.remove('current'));
  $(prev).classList.add('current');
}
function goHome() {
  navStack = [];
  $$('.screen.current').forEach(s => s.classList.remove('current'));
  $('screen-home').classList.add('current');
  renderHome();
}

/* ─────────── توست ─────────── */
let toastTimer = null;
function toast(msg, ms = 3800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ─────────── صدا (بیپ) و لرزش ─────────── */
let actx = null;
function ensureCtx() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function beep(freq = 880, dur = 0.15, vol = 0.5, type = 'square') {
  const c = ensureCtx();
  if (!c) return;
  try {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(c.destination);
    const t = c.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur + 0.03);
  } catch (e) {}
}
const chime    = () => { beep(1046, 0.12, 0.6, 'sine'); setTimeout(() => beep(1318, 0.2, 0.6, 'sine'), 150); };
const sosBeep  = () => { beep(950, 0.35, 0.8, 'sawtooth'); setTimeout(() => beep(720, 0.35, 0.8, 'sawtooth'), 380); };
const okBeep   = () => { beep(880, 0.09, 0.5, 'sine'); setTimeout(() => beep(1174, 0.15, 0.5, 'sine'), 100); };
const vibrate  = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

/* ─────────── گفتار (TTS) ─────────── */
let faVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  faVoice = vs.find(v => /^fa/i.test(v.lang)) || null;
  updateTtsStatus();
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text, rate = 0.85) {
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fa-IR';
    if (faVoice) u.voice = faVoice;
    u.rate = rate;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function updateTtsStatus() {
  const el = $('ttsStatus');
  if (!el) return;
  if (!('speechSynthesis' in window)) { el.textContent = 'این مرورگر گفتار پشتیبانی نمی‌کند.'; return; }
  el.textContent = faVoice
    ? '✅ صدای فارسی آماده است: ' + faVoice.name
    : '⚠️ صدای فارسی در فهرست نبود؛ اگر شنیدن مشکل داشت از تنظیمات گوشی، Text-to-speech زبان فارسی را نصب کنید.';
}

/* ─────────── ساعت و تاریخ ─────────── */
function updateClock() {
  const now = new Date();
  try {
    $('clock').textContent = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    $('dateLine').textContent = new Intl.DateTimeFormat('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  } catch (e) {
    $('clock').textContent = faDig(String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'));
  }
}

/* ─────────── وضعیت داروها ─────────── */
function isTaken(medId, time) {
  const t = data.taken[todayKey()];
  return !!(t && t[medId] && t[medId].includes(time));
}
function setTaken(medId, time, yes) {
  const k = todayKey();
  data.taken[k] = data.taken[k] || {};
  data.taken[k][medId] = data.taken[k][medId] || [];
  const arr = data.taken[k][medId];
  const i = arr.indexOf(time);
  if (yes && i < 0) arr.push(time);
  if (!yes && i >= 0) arr.splice(i, 1);
  saveData();
}
function medRowsToday() {
  const rows = [];
  for (const m of data.meds)
    for (const t of m.times)
      rows.push({ med: m, time: t, taken: isTaken(m.id, t) });
  rows.sort((a, b) => toMin(a.time) - toMin(b.time));
  return rows;
}
function nextMedToday() {
  const nm = toMin(hmNow());
  return medRowsToday().find(r => !r.taken && toMin(r.time) >= nm);
}
function overdueMeds() {
  const nm = toMin(hmNow());
  return medRowsToday().filter(r => !r.taken && toMin(r.time) < nm && nm - toMin(r.time) <= 480);
}

/* ─────────── رندر خانه ─────────── */
function renderHome() {
  updateClock();

  // کاشی‌های مخاطب
  const grid = $('contactsGrid');
  grid.innerHTML = '';
  $('noContacts').hidden = data.contacts.length > 0;
  for (const c of data.contacts) {
    const tile = document.createElement('div');
    tile.className = 'contact-tile';
    tile.style.background = c.color || PALETTE[0];
    tile.setAttribute('role', 'button');
    tile.setAttribute('tabindex', '0');
    tile.setAttribute('aria-label', 'تماس با ' + c.name);
    if (c.emergency) {
      const b = document.createElement('span');
      b.className = 'contact-sos-badge';
      b.textContent = '🆘';
      tile.appendChild(b);
    }
    const nm = document.createElement('div');
    nm.className = 'contact-name'; nm.textContent = c.name;
    const rl = document.createElement('div');
    rl.className = 'contact-relation'; rl.textContent = c.relation || '';
    tile.appendChild(nm); tile.appendChild(rl);

    const msg = document.createElement('button');
    msg.className = 'contact-msg';
    msg.textContent = '✉️';
    msg.setAttribute('aria-label', 'پیام به ' + c.name);
    msg.addEventListener('click', e => { e.stopPropagation(); beep(700, 0.06, 0.3); messagePicker(c); });
    tile.appendChild(msg);

    const doCall = () => { beep(880, 0.06, 0.3); callContact(c); };
    tile.addEventListener('click', doCall);
    tile.addEventListener('keydown', e => { if (e.key === 'Enter') doCall(); });
    grid.appendChild(tile);
  }

  // نوار دارو
  const bar = $('btnNextMed');
  if (data.meds.length === 0) { bar.hidden = true; }
  else {
    bar.hidden = false;
    const next = nextMedToday();
    const left = overdueMeds().length;
    let txt;
    if (next) txt = 'بعدی: ' + next.med.name + ' — ساعت ' + faDig(next.time);
    else if (left > 0) txt = left + ' دارو هنوز نگذشته — بزنید';
    else txt = 'همه داروهای امروز مصرف شد ✅';
    $('nextMedInfo').textContent = txt;
  }

  // بنر داروی عقب‌افتاده
  const od = overdueMeds();
  const banner = $('overdueBanner');
  if (od.length) {
    banner.hidden = false;
    banner.textContent = '⏰ ' + faDig(od.length) + ' داروی امروز نگذشته: ' + od.map(r => r.med.name).join('، ');
  } else banner.hidden = true;

  renderMeds();
}

/* ─────────── تماس و پیام ─────────── */
function callContact(c) {
  const ph = normPhone(c.phone);
  if (!ph) { toast('شماره ثبت نشده است'); return; }
  openLink('tel:' + ph);
}
function sendSms(c, body) {
  const ph = normPhone(c.phone);
  if (!ph) { toast('شماره ثبت نشده است'); return; }
  beep(760, 0.08, 0.4);
  openLink('sms:' + ph + '?body=' + encodeURIComponent(body));
}

/* تأیید بزرگ */
let confirmCb = null;
function showConfirm(title, sub, yesLabel, onYes) {
  $('confirmTitle').textContent = title;
  $('confirmSub').textContent = sub || '';
  $('confirmYes').textContent = yesLabel || 'بله';
  confirmCb = onYes;
  showScreen('screen-confirm');
}
$('confirmYes').addEventListener('click', () => { const cb = confirmCb; closeScreen(); confirmCb = null; cb && cb(); });
$('confirmNo').addEventListener('click', () => { confirmCb = null; closeScreen(); });

/* انتخاب پیام آماده */
let msgTarget = null;
function messagePicker(contact) {
  msgTarget = contact;
  $('msgTitle').textContent = 'چه پیامی به «' + contact.name + '» بفرستم؟';
  const box = $('msgChoices');
  box.innerHTML = '';
  if (data.messages.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'پیام آماده‌ای ثبت نشده (از تنظیمات اضافه کنید)';
    box.appendChild(p);
  }
  for (const mText of data.messages) {
    const b = document.createElement('button');
    b.className = 'msg-choice';
    b.textContent = mText;
    b.addEventListener('click', () => { closeScreen(); sendSms(msgTarget, mText); });
    box.appendChild(b);
  }
  showScreen('screen-msg');
}

/* ─────────── اضطراری (SOS) ─────────── */
let sosTimers = [];
function clearSosTimers() { sosTimers.forEach(t => { clearInterval(t); clearTimeout(t); }); sosTimers = []; }

function openSos() {
  clearSosTimers();
  showScreen('screen-sos');
  const cd = $('sosCountdown'), ac = $('sosActions'), cnt = $('sosCount');
  ac.hidden = true; cd.hidden = false;
  $('sosCancel').style.display = '';
  let n = 3;
  cnt.textContent = faDig(n);
  sosBeep(); vibrate([300]);
  const iv = setInterval(() => {
    n--;
    if (n <= 0) {
      clearSosTimers();
      cd.hidden = true; ac.hidden = false;
      $('sosCancel').style.display = 'none';
      renderSosActions();
    } else {
      cnt.textContent = faDig(n);
      sosBeep(); vibrate([300]);
    }
  }, 1000);
  sosTimers.push(iv);
}
$('sosCancel').addEventListener('click', () => { clearSosTimers(); goHome(); });

function emergencyContacts() {
  return data.contacts.filter(c => c.emergency);
}
function renderSosActions() {
  const box = $('sosContacts');
  box.innerHTML = '';
  const ems = emergencyContacts();

  if (ems.length) {
    const p = ems[0];
    const call = document.createElement('button');
    call.className = 'sos-bigcall';
    call.innerHTML = '📞 تماس با ' + esc(p.name);
    call.addEventListener('click', () => callContact(p));
    box.appendChild(call);

    const loc = document.createElement('button');
    loc.className = 'sos-location';
    loc.innerHTML = '📍 موقعیت من را برای ' + esc(p.name) + ' بفرست';
    loc.addEventListener('click', () => sendLocation(p, loc));
    box.appendChild(loc);

    for (const c of ems.slice(1)) {
      const r = document.createElement('button');
      r.className = 'sos-contact-row';
      r.innerHTML = '📞 تماس با ' + esc(c.name) + (c.relation ? ' (' + esc(c.relation) + ')' : '');
      r.addEventListener('click', () => callContact(c));
      box.appendChild(r);
    }
  } else {
    const note = document.createElement('p');
    note.style.fontSize = '24px';
    note.style.fontWeight = '700';
    note.innerHTML = 'هنوز مخاطب اضطراری ثبت نشده است.<br>از ⚙ تنظیمات → مخاطبین، گزینه «مخاطب اضطراری» را فعال کنید.';
    box.appendChild(note);
  }
}
$('sosAmbulance').addEventListener('click', () => openLink('tel:115'));

function sendLocation(contact, btn) {
  const orig = btn.innerHTML;
  if (!navigator.geolocation) { finishSms(null); return; }
  btn.innerHTML = '⏳ در حال یافتن موقعیت…';
  navigator.geolocation.getCurrentPosition(
    pos => { btn.innerHTML = orig; finishSms(pos.coords); },
    err => {
      btn.innerHTML = orig;
      showConfirm('موقعیت پیدا نشد', 'پیام بدون موقعیت مکانی فرستاده شود؟', 'بله، بفرست', () => finishSms(null));
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
  function finishSms(coords) {
    let body = 'به کمک نیاز دارم! لطفاً تماس بگیرید.';
    if (coords) body = 'به کمک نیاز دارم! اینجا هستم: https://maps.google.com/?q=' + coords.latitude.toFixed(6) + ',' + coords.longitude.toFixed(6);
    sendSms(contact, body);
  }
}
$('btnSos').addEventListener('click', () => { sosBeep(); openSos(); });

/* ─────────── فرمان صوتی ─────────── */
let recog = null;
function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('مرورگر شما فرمان صوتی را پشتیبانی نمی‌کند؛ کروم را به‌روز کنید'); return; }
  if (recog) { try { recog.abort(); } catch (e) {} }
  recog = new SR();
  recog.lang = 'fa-IR';
  recog.interimResults = true;
  recog.maxAlternatives = 3;
  $('voiceHeard').textContent = '';
  $('voiceStatus').textContent = 'دارم گوش می‌دهم…';
  showScreen('screen-voice');

  let gotFinal = false;
  recog.onresult = e => {
    let interim = '', final_ = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final_ += r[0].transcript; else interim += r[0].transcript;
    }
    if (final_) { gotFinal = true; $('voiceHeard').textContent = final_; closeVoice(); handleCommand(final_); }
    else $('voiceHeard').textContent = interim;
  };
  recog.onerror = e => {
    closeVoice();
    const m = {
      'no-speech': 'صدایی نشنیدم؛ دوباره دکمه را بزنید',
      'not-allowed': 'اجازه میکروفون داده نشد؛ از تنظیمات گوشی اجازه دهید',
      'network': 'برای فرمان صوتی، اینترنت لازم است',
      'audio-capture': 'میکروفون پیدا نشد'
    }[e.error] || 'خطا در شنیدن صدا';
    toast(m, 5000); speak(m);
  };
  recog.onend = () => { if (!gotFinal && $('screen-voice').classList.contains('current')) closeVoice(); };
  try { recog.start(); } catch (e) { closeVoice(); toast('میکروفون در دسترس نیست'); }
}
function closeVoice() {
  if (recog) { try { recog.abort(); } catch (e) {} }
  if ($('screen-voice').classList.contains('current')) closeScreen();
}
$('btnVoice').addEventListener('click', () => { beep(660, 0.08, 0.4); startVoice(); });
$('voiceCancel').addEventListener('click', closeVoice);

function findContactIn(text) {
  const t = normFa(text);
  let best = null, bestLen = 0;
  for (const c of data.contacts) {
    for (const key of [c.name, c.relation]) {
      const k = normFa(key || '');
      if (k && k.length >= 2 && t.includes(k) && k.length > bestLen) { best = c; bestLen = k.length; }
    }
  }
  return best;
}
function handleCommand(raw) {
  const t = normFa(raw);
  if (/(کمک|امداد|اضطرار|نجات)/.test(t)) { speak('کمک اضطراری'); openSos(); return; }
  if (/(دارو|قرص)/.test(t)) { speak('این هم داروهای امروز شما'); showScreen('screen-meds'); renderMeds(); return; }

  const c = findContactIn(t);
  if (/(پیام|پیامک|اس ام اس|sms)/i.test(t)) {
    if (c) messagePicker(c);
    else { toast('به چه کسی پیام بدهم؟ نام مخاطب را بگویید', 5000); speak('به چه کسی پیام بدهم؟'); }
    return;
  }
  if (/(تماس|زنگ|تلفن|بگیر|صدا کن)/.test(t)) {
    if (c) {
      speak('تماس با ' + c.name + '؟');
      showConfirm('تماس با ' + c.name + '؟', (c.relation || '') + ' — ' + normPhone(c.phone), '📞 بله، تماس بگیر', () => callContact(c));
    } else { toast('با چه کسی تماس بدهم؟ نام مخاطب را بگویید', 5000); speak('با چه کسی تماس بدهم؟'); }
    return;
  }
  const msg = 'متوجه نشدم. بگویید: «تماس با …»، «پیام به …»، «دارو» یا «کمک»';
  toast(msg, 6000); speak('متوجه نشدم. مثلا بگویید تماس با ' + (data.contacts[0] ? data.contacts[0].name : 'علی'));
}

/* ─────────── صفحه داروها ─────────── */
function renderMeds() {
  const list = $('medsList');
  if (!list) return;
  const rows = medRowsToday();
  $('medsEmpty').hidden = data.meds.length > 0;
  list.innerHTML = '';
  const nm = toMin(hmNow());
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'med-row' + (r.taken ? ' done' : (toMin(r.time) < nm ? ' due' : ''));

    const tm = document.createElement('div');
    tm.className = 'med-time'; tm.textContent = faDig(r.time);

    const nameEl = document.createElement('div');
    nameEl.className = 'med-name'; nameEl.textContent = r.med.name;

    const btn = document.createElement('button');
    btn.className = 'med-take' + (r.taken ? ' taken' : '');
    btn.textContent = r.taken ? '✓ خوردم' : 'خوردم';
    btn.addEventListener('click', () => {
      setTaken(r.med.id, r.time, !r.taken);
      if (!r.taken) { okBeep(); vibrate(120); speak('آفرین، داروی ' + r.med.name + ' مصرف شد'); }
      renderMeds(); renderHomeBarOnly();
    });

    row.appendChild(tm); row.appendChild(nameEl); row.appendChild(btn);
    list.appendChild(row);
  }
}
$('btnNextMed').addEventListener('click', () => { showScreen('screen-meds'); renderMeds(); });

/* فقط نوار خانه را به‌روز کن (بدون بازسازی کاشی‌ها) */
function renderHomeBarOnly() {
  const bar = $('btnNextMed');
  if (data.meds.length === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  const next = nextMedToday();
  const left = overdueMeds().length;
  let txt;
  if (next) txt = 'بعدی: ' + next.med.name + ' — ساعت ' + faDig(next.time);
  else if (left > 0) txt = faDig(left) + ' دارو هنوز نگذشته — بزنید';
  else txt = 'همه داروهای امروز مصرف شد ✅';
  $('nextMedInfo').textContent = txt;
  const banner = $('overdueBanner');
  if (left) { banner.hidden = false; banner.textContent = '⏰ ' + faDig(left) + ' داروی امروز نگذشته: ' + overdueMeds().map(r => r.med.name).join('، '); }
  else banner.hidden = true;
}
$('overdueBanner').addEventListener('click', () => { showScreen('screen-meds'); renderMeds(); });

/* ─────────── موتور یادآوری (وقتی اپ باز است) ─────────── */
let snoozes = {};          // medId@time → timestamp
let alarmOpen = false;
let alarmSnoozeKeys = [];  // کلیدهای داروهای هشدارِ باز
let alarmLoop = null, alarmTtsTimers = [];

function checkAlarms() {
  if (!data.meds.length || alarmOpen) return;
  const nm = toMin(hmNow());
  const due = [];
  for (const m of data.meds) {
    for (const t of m.times) {
      const k = m.id + '@' + t;
      const diff = nm - toMin(t);
      if (diff >= 0 && diff <= 360 && !isTaken(m.id, t) && !(snoozes[k] > Date.now())) {
        due.push({ med: m, time: t, key: k });
      }
    }
  }
  if (due.length) openAlarm(due);
}
function openAlarm(due) {
  alarmOpen = true;
  alarmSnoozeKeys = due.map(d => d.key);
  const list = $('alarmList');
  list.innerHTML = '';
  const remaining = due.slice();
  for (const d of due) {
    const box = document.createElement('div');
    box.className = 'alarm-med';
    const nm = document.createElement('div');
    nm.className = 'med-name'; nm.textContent = d.med.name + ' — ' + faDig(d.time);
    const btn = document.createElement('button');
    btn.className = 'med-take'; btn.textContent = '✓ خوردم';
    btn.addEventListener('click', () => {
      setTaken(d.med.id, d.time, true);
      okBeep(); vibrate(150);
      speak('آفرین، داروی ' + d.med.name + ' مصرف شد');
      box.remove();
      const i = remaining.indexOf(d); if (i >= 0) remaining.splice(i, 1);
      if (!remaining.length) closeAlarm();
    });
    box.appendChild(nm); box.appendChild(btn);
    list.appendChild(box);
  }
  showScreen('screen-alarm');
  vibrate([400, 200, 400, 200, 600]);
  speak('وقت دارو! ' + due.map(d => d.med.name).join(' و ') + ' را مصرف کنید');
  let loops = 0;
  alarmLoop = setInterval(() => { chime(); if (++loops > 40) clearInterval(alarmLoop); }, 2400);
  alarmTtsTimers = [
    setTimeout(() => { if (alarmOpen) speak('لطفا داروی ' + remaining.map(d => d.med.name).join(' و ') + ' را مصرف کنید'); }, 12000),
    setTimeout(() => { if (alarmOpen) speak('هنوز منتظر مصرف دارو هستیم'); }, 26000)
  ];
  chime();
}
function closeAlarm() {
  alarmOpen = false;
  clearInterval(alarmLoop);
  alarmTtsTimers.forEach(clearTimeout);
  if ($('screen-alarm').classList.contains('current')) closeScreen();
  renderHomeBarOnly(); renderMeds();
}
$('alarmSnooze').addEventListener('click', () => {
  for (const k of alarmSnoozeKeys) snoozes[k] = Date.now() + 10 * 60 * 1000;
  closeAlarm();
  toast('۱۰ دقیقه دیگر دوباره یادآوری می‌شود');
});
$('alarmDismiss').addEventListener('click', () => {
  for (const k of alarmSnoozeKeys) snoozes[k] = Date.now() + 10 * 60 * 1000;
  closeAlarm();
});

/* ─────────── خروجی تقویم (.ics) ─────────── */
function pad2(n) { return String(n).padStart(2, '0'); }
function icsStamp(d) {
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + pad2(d.getMinutes()) + '00';
}
function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function buildIcs() {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gooshi Asan//FA//', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const stamp = icsStamp(new Date());
  for (const m of data.meds) {
    for (const t of m.times) {
      const [h, mi] = t.split(':').map(Number);
      const d = new Date();
      d.setHours(h, mi, 0, 0);
      if (d <= new Date()) d.setDate(d.getDate() + 1);
      L.push(
        'BEGIN:VEVENT',
        'UID:' + m.id + '-' + t.replace(':', '') + '@gooshi-asan',
        'DTSTAMP:' + stamp,
        'DTSTART:' + icsStamp(d),
        'DURATION:PT10M',
        'RRULE:FREQ=DAILY',
        'SUMMARY:' + icsEsc('💊 دارو: ' + m.name),
        'DESCRIPTION:' + icsEsc('یادآوری مصرف دارو از برنامه گوشی آسان'),
        'BEGIN:VALARM',
        'TRIGGER:PT0M',
        'ACTION:DISPLAY',
        'DESCRIPTION:' + icsEsc('وقت دارو: ' + m.name),
        'END:VALARM',
        'END:VEVENT'
      );
    }
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}
$('btnCalExport').addEventListener('click', () => {
  if (!data.meds.length) { toast('اول دارویی ثبت کنید'); return; }
  downloadFile('gooshi-asan-daro.ics', 'text/calendar;charset=utf-8', '\uFEFF' + buildIcs());
  toast('فایل یادآور دانلود شد؛ آن را باز کنید تا در تقویم گوشی قرار گیرد', 6000);
  speak('فایل یادآور آماده شد. آن را در تقویم گوشی ذخیره کنید');
});
function downloadFile(name, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2500);
}

/* ─────────── صفحه رمز ─────────── */
let pinCtx = null;
function buildPinPad() {
  const pad = $('pinPad');
  pad.innerHTML = '';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'clr'];
  for (const k of keys) {
    const b = document.createElement('button');
    b.className = 'pin-key' + (k === 'del' || k === 'clr' ? ' aux' : '');
    b.textContent = k === 'del' ? '⌫' : k === 'clr' ? 'پاک' : faDig(k);
    b.addEventListener('click', () => pinPress(k === 'del' ? 'del' : k === 'clr' ? 'clr' : k));
    pad.appendChild(b);
  }
}
function pinFlow(cfg) {
  pinCtx = { ...cfg, buf: '', stage: 0, first: '' };
  $('pinTitle').textContent = cfg.title;
  $('pinError').hidden = true;
  renderPinDots();
  showScreen('screen-pin');
}
function renderPinDots() {
  const box = $('pinDots');
  box.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const d = document.createElement('span');
    d.className = 'pin-dot' + (i < pinCtx.buf.length ? ' filled' : '');
    box.appendChild(d);
  }
}
function pinPress(k) {
  if (!pinCtx) return;
  if (k === 'del') pinCtx.buf = pinCtx.buf.slice(0, -1);
  else if (k === 'clr') pinCtx.buf = '';
  else if (pinCtx.buf.length < 4) pinCtx.buf += k;
  renderPinDots();
  if (pinCtx.buf.length === 4) setTimeout(submitPin, 180);
}
function submitPin() {
  const { mode } = pinCtx;
  const entered = pinCtx.buf;
  if (mode === 'verify') {
    if (entered === data.pin) { const cb = pinCtx.onOk; pinCtx = null; closeScreen(); cb && cb(); }
    else { $('pinError').hidden = false; pinCtx.buf = ''; setTimeout(renderPinDots, 400); vibrate(200); }
    return;
  }
  if (mode === 'set') {
    if (pinCtx.stage === 0) {
      pinCtx.first = entered; pinCtx.stage = 1; pinCtx.buf = '';
      $('pinTitle').textContent = 'دوباره همان رمز را بزنید';
      $('pinError').hidden = true; renderPinDots();
    } else {
      if (entered === pinCtx.first) {
        data.pin = pinCtx.first; saveData();
        const cb = pinCtx.onOk; pinCtx = null; closeScreen(); cb && cb();
      } else {
        $('pinError').textContent = 'رمزها یکسان نبود؛ از نو وارد کنید';
        $('pinError').hidden = false;
        pinCtx.stage = 0; pinCtx.buf = '';
        $('pinTitle').textContent = 'یک رمز ۴ رقمی انتخاب کنید';
        setTimeout(renderPinDots, 400);
      }
    }
  }
}
$('pinClose').addEventListener('click', () => { pinCtx = null; closeScreen(); });

/* ─────────── تنظیمات ─────────── */
function requestSettings() {
  if (data.pin == null) openSettings(false);
  else pinFlow({ title: 'رمز تنظیمات', mode: 'verify', onOk: () => openSettings(false) });
}
function openSettings(firstTime) {
  $('setupBanner').hidden = !firstTime;
  showScreen('screen-settings');
  renderSettings();
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function renderSettings() {
  /* مخاطبین */
  const cl = $('setContacts');
  cl.innerHTML = '';
  data.contacts.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'set-row';
    const info = document.createElement('div');
    info.className = 'grow';
    info.innerHTML = '<b>' + esc(c.name) + '</b>' + (c.relation ? ' — ' + esc(c.relation) : '') +
      (c.emergency ? ' <span style="color:#D50000">🆘 اضطراری</span>' : '') +
      '<span class="sub" dir="ltr">' + esc(normPhone(c.phone)) + '</span>';
    row.appendChild(info);
    row.appendChild(mkIconBtn('⬆', 'بالا', () => { if (i > 0) { [data.contacts[i - 1], data.contacts[i]] = [data.contacts[i], data.contacts[i - 1]]; saveData(); renderSettings(); renderHome(); } }));
    row.appendChild(mkIconBtn('⬇', 'پایین', () => { if (i < data.contacts.length - 1) { [data.contacts[i + 1], data.contacts[i]] = [data.contacts[i], data.contacts[i + 1]]; saveData(); renderSettings(); renderHome(); } }));
    row.appendChild(mkIconBtn('✏️', 'ویرایش', () => editContact(c)));
    row.appendChild(mkIconBtn('🗑️', 'حذف', () => showConfirm('حذف ' + c.name + '؟', '', 'بله، حذف کن', () => {
      data.contacts = data.contacts.filter(x => x.id !== c.id); saveData(); renderSettings(); renderHome();
    }), true));
    cl.appendChild(row);
  });
  if (!data.contacts.length) cl.innerHTML = '<p class="small">هنوز مخاطبی نیست. با دکمه زیر، خانواده را اضافه کنید.</p>';

  /* داروها */
  const ml = $('setMeds');
  ml.innerHTML = '';
  data.meds.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'set-row';
    const info = document.createElement('div');
    info.className = 'grow';
    info.innerHTML = '<b>💊 ' + esc(m.name) + '</b><span class="sub">' + m.times.map(t => faDig(t)).join(' ، ') + '</span>';
    row.appendChild(info);
    row.appendChild(mkIconBtn('✏️', 'ویرایش', () => editMed(m)));
    row.appendChild(mkIconBtn('🗑️', 'حذف', () => showConfirm('حذف ' + m.name + '؟', '', 'بله، حذف کن', () => {
      data.meds = data.meds.filter(x => x.id !== m.id); saveData(); renderSettings(); renderHome();
    }), true));
    ml.appendChild(row);
  });
  if (!data.meds.length) ml.innerHTML = '<p class="small">دارویی ثبت نشده. یادآوری دارو را با دکمه زیر اضافه کنید.</p>';

  /* پیام‌ها */
  const ms = $('setMsgs');
  ms.innerHTML = '';
  data.messages.forEach((mText, i) => {
    const row = document.createElement('div');
    row.className = 'set-row';
    const info = document.createElement('div');
    info.className = 'grow';
    info.innerHTML = '💬 ' + esc(mText);
    row.appendChild(info);
    row.appendChild(mkIconBtn('🗑️', 'حذف', () => { data.messages.splice(i, 1); saveData(); renderSettings(); }, true));
    ms.appendChild(row);
  });

  updateTtsStatus();
}
function mkIconBtn(label, aria, fn, danger) {
  const b = document.createElement('button');
  b.className = 'icon-btn' + (danger ? ' danger' : '');
  b.textContent = label;
  b.setAttribute('aria-label', aria);
  b.addEventListener('click', fn);
  return b;
}

/* ─────────── ویرایشگر مخاطب ─────────── */
function closeModal() { $('editorHost').innerHTML = ''; }
function modalShell(title) {
  $('editorHost').innerHTML =
    '<div class="modal"><div class="modal-box">' +
    '<h3>' + title + '</h3><div id="modalBody"></div>' +
    '<div class="modal-actions">' +
    '<button class="btn-no" id="mCancel">بی‌خیال</button>' +
    '<button class="btn-yes" id="mSave">💾 ذخیره</button>' +
    '</div></div></div>';
  $('mCancel').addEventListener('click', closeModal);
  return $('modalBody');
}

function editContact(c) {
  const isNew = !c;
  c = c || { id: uid(), name: '', relation: '', phone: '', color: PALETTE[data.contacts.length % PALETTE.length], emergency: false };
  const body = modalShell(isNew ? 'افزودن مخاطب' : 'ویرایش مخاطب');
  body.innerHTML =
    '<label>نام (روی دکمه بزرگ نمایش داده می‌شود)</label>' +
    '<input type="text" id="cName" maxlength="24" value="' + esc(c.name) + '" placeholder="مثلاً: علی">' +
    '<label>نسبت (اختیاری)</label>' +
    '<input type="text" id="cRel" maxlength="24" value="' + esc(c.relation) + '" placeholder="مثلاً: پسر">' +
    '<label>شماره تلفن</label>' +
    '<input type="tel" id="cPhone" dir="ltr" maxlength="20" value="' + esc(c.phone) + '" placeholder="09121234567">' +
    '<label>رنگ دکمه</label><div class="swatches" id="cColors"></div>' +
    '<div class="check-row"><input type="checkbox" id="cEmg" ' + (c.emergency ? 'checked' : '') + '>' +
    '<label for="cEmg" style="margin:0">🆘 مخاطب اضطراری (در صفحه کمک بیاید)</label></div>';
  let chosen = c.color;
  const sw = $('cColors');
  PALETTE.forEach(col => {
    const b = document.createElement('button');
    b.className = 'swatch' + (col === chosen ? ' sel' : '');
    b.style.background = col;
    b.addEventListener('click', () => { chosen = col; sw.querySelectorAll('.swatch').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); });
    sw.appendChild(b);
  });
  $('mSave').addEventListener('click', () => {
    const name = $('cName').value.trim();
    const phone = normPhone($('cPhone').value);
    if (!name) { toast('نام را وارد کنید'); return; }
    if (!phone) { toast('شماره تلفن را وارد کنید'); return; }
    Object.assign(c, { name, relation: $('cRel').value.trim(), phone, color: chosen, emergency: $('cEmg').checked });
    if (isNew) data.contacts.push(c);
    saveData(); closeModal(); renderSettings(); renderHome();
    toast('ذخیره شد ✅');
  });
}

/* ─────────── ویرایشگر دارو ─────────── */
function editMed(m) {
  const isNew = !m;
  m = m || { id: uid(), name: '', times: [] };
  const body = modalShell(isNew ? 'افزودن دارو' : 'ویرایش دارو');
  body.innerHTML =
    '<label>نام دارو</label>' +
    '<input type="text" id="mName" maxlength="30" value="' + esc(m.name) + '" placeholder="مثلاً: قرص فشار خون">' +
    '<label>ساعت‌های مصرف</label>' +
    '<div class="time-chips" id="mChips"></div>' +
    '<div class="row"><input type="time" id="mTime" dir="ltr">' +
    '<button class="btn-mini" id="mAddTime">افزودن ساعت</button></div>';
  const chips = $('mChips');
  function renderChips() {
    chips.innerHTML = '';
    m.times.forEach((t, i) => {
      const chip = document.createElement('span');
      chip.className = 'time-chip';
      chip.textContent = faDig(t);
      const x = document.createElement('button');
      x.textContent = '✕';
      x.addEventListener('click', () => { m.times.splice(i, 1); renderChips(); });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }
  renderChips();
  $('mAddTime').addEventListener('click', () => {
    const v = $('mTime').value;
    if (!/^\d{2}:\d{2}$/.test(v)) { toast('یک ساعت انتخاب کنید'); return; }
    if (!m.times.includes(v)) { m.times.push(v); m.times.sort(); renderChips(); }
  });
  $('mSave').addEventListener('click', () => {
    const name = $('mName').value.trim();
    if (!name) { toast('نام دارو را وارد کنید'); return; }
    if (!m.times.length) { toast('حداقل یک ساعت اضافه کنید'); return; }
    Object.assign(m, { name });
    if (isNew) data.meds.push(m);
    saveData(); closeModal(); renderSettings(); renderHome();
    toast('ذخیره شد ✅');
  });
}

/* ─────────── بقیهٔ تنظیمات ─────────── */
$('btnAddContact').addEventListener('click', () => editContact(null));
$('btnAddMed').addEventListener('click', () => editMed(null));
$('btnAddMsg').addEventListener('click', () => {
  const v = $('newMsgInput').value.trim();
  if (!v) { toast('متن پیام را بنویسید'); return; }
  data.messages.push(v); saveData();
  $('newMsgInput').value = '';
  renderSettings(); toast('افزوده شد ✅');
});
$('btnChangePin').addEventListener('click', () => {
  pinFlow({
    title: 'رمز فعلی', mode: 'verify',
    onOk: () => setTimeout(() => pinFlow({ title: 'رمز جدید ۴ رقمی', mode: 'set', onOk: () => toast('رمز عوض شد ✅') }), 250)
  });
});
$('btnTestTts').addEventListener('click', () => { pickVoice(); speak('سلام. این صدای یادآوری برنامه گوشی آسان است.'); });
$('btnTestMic').addEventListener('click', () => startVoice());
$('btnBackup').addEventListener('click', () => {
  downloadFile('gooshi-asan-backup.json', 'application/json;charset=utf-8', JSON.stringify(data, null, 2));
  toast('فایل پشتیبان دانلود شد');
});
$('fileRestore').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result);
      if (!j || !Array.isArray(j.contacts)) throw 0;
      showConfirm('بازیابی پشتیبان؟', 'اطلاعات فعلی جایگزین می‌شود', 'بله، بازیابی کن', () => {
        data = Object.assign(defaults(), j);
        saveData(); renderSettings(); renderHome(); toast('بازیابی شد ✅');
      });
    } catch (err) { toast('فایل پشتیبان معتبر نیست'); }
  };
  r.readAsText(f);
  e.target.value = '';
});

/* ─────────── راه‌اندازی اول ─────────── */
$('setupStart').addEventListener('click', () => {
  pinFlow({
    title: 'یک رمز ۴ رقمی انتخاب کنید', mode: 'set',
    onOk: () => setTimeout(() => openSettings(true), 250)
  });
});

/* ─────────── دکمه‌های بازگشت ─────────── */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-back],[data-close]');
  if (!b) return;
  if (b.dataset.back === 'home') goHome(); else closeScreen();
});
$('btnSettings').addEventListener('click', requestSettings);

/* ─────────── شروع ─────────── */
function init() {
  loadData();
  buildPinPad();
  renderHome();
  updateClock();
  setInterval(updateClock, 10000);
  setInterval(checkAlarms, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateClock(); renderHomeBarOnly(); checkAlarms(); } });
  /* یادآوری شفاهی داروهای جا‌مانده هنگام باز شدن */
  const od = overdueMeds();
  if (od.length) setTimeout(() => speak('یادآوری: ' + od.map(r => r.med.name).join(' و ') + ' هنوز مصرف نشده است'), 1500);
  if (data.pin == null) showScreen('screen-setup');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
init();
