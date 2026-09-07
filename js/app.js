/* =====================================================
   GRAND BARBER — Telegram Mini App logic
   Talks to Google Apps Script Web App (no own server).
   ===================================================== */
(function () {
  'use strict';

  /* ---------- config (FILL AT SETUP) ---------- */
  var CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbzOky1RIC8hGPd6M5P19Ebd89jw24G6WB2aJ6tCttL0IdH9Q9MFR7iJHBZxn0p_5BdgtQ/exec',
    TOKEN: 'ab1da03e5c6b1d5fddc2863c64808f29'
  };

  var LS_ONBOARDED = 'gb_onboarded_v1';
  var CACHE = {}; // { clients: [], settings: {} }

  var telg = window.Telegram && window.Telegram.WebApp;
  if (telg) {
    telg.ready();
    telg.expand();
    try { telg.setHeaderColor('#0c0c0d'); telg.setBackgroundColor('#0c0c0d'); } catch (e) {}
  }

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- API ---------- */
  function api(action, body, method) {
    var m = method || (action === 'listClients' || action === 'getSettings' || action === 'init' ? 'GET' : 'POST');
    var url = CONFIG.API_URL + '?action=' + encodeURIComponent(action) + '&token=' + encodeURIComponent(CONFIG.TOKEN);
    var opts = { method: m };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts)
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'server error');
        return res.data;
      });
  }

  /* ---------- utils ---------- */
  function todayISO() {
    var d = new Date();
    return fmtISO(d);
  }
  function fmtISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtUz(iso) {
    if (!iso) return '-';
    var p = iso.split('-');
    var months = ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'];
    return Number(p[2]) + '-' + months[Number(p[1]) - 1];
  }
  function fmtShort(iso) {
    if (!iso) return '-';
    var p = iso.split('-');
    return p[2] + '.' + p[1];
  }
  function maskPhone(phone) {
    var c = String(phone || '').replace(/\D/g, '').replace(/^998/, '');
    if (c.length >= 9) { return '+998 ' + c.slice(0, 2) + ' *** ** ' + c.slice(-3); }
    return phone || '-';
  }
  function normalizePhone(raw) {
    if (!raw || !String(raw).trim()) throw new Error('Telefon raqam kiritilishi shart');
    var c = String(raw).replace(/\D/g, '');
    if (c.length === 12 && c.indexOf('998') === 0) c = c.slice(3);
    else if (c.length === 10 && c.indexOf('8') === 0) c = c.slice(1);
    if (c.length >= 9) c = c.slice(-9);
    if (c.length === 9) return '+998' + c;
    throw new Error('Telefon raqam noto‘g‘ri. Masalan: 90 123 45 67');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.add('hidden'); }, 2600);
  }

  /* ---------- state ---------- */
  var currentTab = 'home';
  var editingId = null;
  var searchQ = '';
  var sortMode = 'last'; // 'last' or 'alpha'

  /* ---------- views / panels ---------- */
  function showView(name) {
    var v = document.querySelectorAll('.view');
    for (var i = 0; i < v.length; i++) {
      v[i].classList.remove('active');
      v[i].classList.add('hidden');
    }
    var el = $('view-' + name);
    el.classList.remove('hidden');
    el.classList.add('active');
  }
  function showPanel(name) {
    var p = document.querySelectorAll('.panel');
    for (var i = 0; i < p.length; i++) p[i].classList.remove('active');
    $('panel-' + name).classList.add('active');
    var t = document.querySelectorAll('.tab');
    for (var j = 0; j < t.length; j++) t[j].classList.toggle('active', t[j].dataset.view === name);
    currentTab = name;
  }

  /* ---------- data accessors ---------- */
  function clients() { return CACHE.clients || []; }
  function settings() { return CACHE.settings || { reminderDays: 20, barberPhone: '' }; }
  function reminderDays() { return Number(settings().reminderDays) || 20; }
  function reminderDate(iso) {
    if (!iso) return null;
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + reminderDays());
    return fmtISO(d);
  }
  function todayArrivals() {
    var t = todayISO();
    var out = [];
    clients().forEach(function (c) {
      (c.visitHistory || []).forEach(function (v) {
        if (v.date === t) out.push({ client: c, time: v.time });
      });
    });
    out.sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); });
    return out;
  }

  /* ---------- rendering ---------- */
  function renderAll() {
    renderHome();
    renderClientsList();
    renderStats();
    renderSettings();
  }

  function renderHome() {
    var arr = todayArrivals();
    $('today-count').textContent = 'Bugun: ' + arr.length + ' ta mijoz keldi';
    $('today-date-text').textContent = initCap(fmtUz(todayISO()));
    if (!arr.length) {
      $('today-list').innerHTML = '<div class="empty"><span class="glyph">✂</span>Bugun hali tashrif yo‘q</div>';
    } else {
      $('today-list').innerHTML = arr.map(function (a) {
        return '<div class="tl-item" data-open="' + a.client.id + '"><span class="name">' + esc(a.client.name) + '</span><span class="time">' + esc(a.time) + '</span></div>';
      }).join('');
    }

    var dueToday = clients().filter(function (c) { return reminderDate(c.lastVisit) === todayISO(); }).length;
    $('home-stats').innerHTML = [
      { b: clients().length, l: 'Jami mijoz' },
      { b: arr.length, l: 'Bugun kelgan' },
      { b: dueToday, l: 'Eslatma bugun' }
    ].map(function (s) {
      return '<div class="stat-card"><b>' + s.b + '</b><span>' + s.l + '</span></div>';
    }).join('');
  }

  function initCap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function renderClientsList() {
    var list = [];
    clients().forEach(function (c) { list.push(c); });
    if (searchQ) {
      var q = searchQ.toLowerCase();
      list = list.filter(function (c) {
        return c.name.toLowerCase().indexOf(q) !== -1 || String(c.phone || '').replace(/\D/g, '').indexOf(q.replace(/\D/g, '')) !== -1;
      });
    }
    if (sortMode === 'alpha') list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else list.sort(function (a, b) { return (b.lastVisit || '').localeCompare(a.lastVisit || ''); });

    var t = todayISO();
    var el = $('client-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty"><span class="glyph">👤</span>Mijoz topilmadi</div>';
      return;
    }
    el.innerHTML = list.map(function (c) {
      var cameToday = (c.visitHistory || []).some(function (v) { return v.date === t; });
      var due = reminderDate(c.lastVisit);
      return '<div class="client-card" data-open="' + c.id + '">' +
        '<div class="cc-top"><span class="cc-name">' + esc(c.name) + '</span>' + (cameToday ? '<span class="badge green">Bugun keldi</span>' : '') + '</div>' +
        '<div class="cc-phone">' + maskPhone(c.phone) + '</div>' +
        '<div class="cc-arrived">Oxirgi: ' + fmtShort(c.lastVisit) + (due && due === t ? ' · <span style="color:var(--gold)">Eslatma bugun!</span>' : '') + '</div>' +
        '</div>';
    }).join('');
  }

  function renderStats() {
    var t = todayISO();
    var allVisits = [];
    clients().forEach(function (c) { (c.visitHistory || []).forEach(function (v) { allVisits.push(v.date); }); });
    var todayCount = allVisits.filter(function (d) { return d === t; }).length;

    var weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    var monthStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
    function fmtStart(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    var ws = fmtStart(weekStart), ms = fmtStart(monthStart);

    var weekCount = allVisits.filter(function (d) { return d >= ws && d <= t; }).length;
    var monthCount = allVisits.filter(function (d) { return d >= ms && d <= t; }).length;
    var dueToday = clients().filter(function (c) { return reminderDate(c.lastVisit) === t; }).length;

    $('stats-today').innerHTML = [
      { b: clients().length, l: '👥 Jami mijozlar' },
      { b: todayCount, l: '✂ Bugun tashrif' },
      { b: dueToday, l: '🔔 Bugungi eslatma' },
      { b: monthCount, l: '📅 Shu oy' }
    ].map(function (s) { return '<div class="stat-card"><b>' + s.b + '</b><span>' + s.l + '</span></div>'; }).join('');

    $('stats-periods').innerHTML =
      '<div class="srow"><span>Bu hafta tashriflar</span><b>' + weekCount + '</b></div>' +
      '<div class="srow"><span>Bu oy tashriflar</span><b>' + monthCount + '</b></div>';
  }

  function renderSettings() {
    $('settings-list').innerHTML = [
      { label: '⏰ Eslatma kuni', value: reminderDays() + ' kun', act: 'remind' },
      { label: '📱 Telefon raqam', value: settings().barberPhone || '—', act: 'phone' },
      { label: '🌐 API holati', value: '', act: 'health' }
    ].map(function (it) {
      return '<div class="set-item" data-act="' + it.act + '"><div><b>' + it.label + '</b><small>' + it.value + '</small></div><span class="chev">›</span></div>';
    }).join('');
  }

  /* ---------- client detail ---------- */
  function openClient(id) {
    var c = getById(id);
    if (!c) return;
    showView('client');
    $('client-detail-name').textContent = c.name;
    var due = reminderDate(c.lastVisit);
    var dueRow = (due === todayISO())
      ? '<div class="due-row">🔔 Bugun eslatma kuni! Sartarosh SMS yuboradi.</div>'
      : (due ? '<div class="due-row">🔔 Keyingi eslatma: ' + fmtUz(due) + '</div>' : '');
    var hist = (c.visitHistory || []).slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    $('client-detail-body').innerHTML =
      '<div class="detail-head"><div class="big">' + esc(c.name) + '</div>' +
      '<div class="detail-phone">📞 ' + maskPhone(c.phone) + '</div>' +
      (c.note ? '<div class="detail-note">' + esc(c.note) + '</div>' : '') +
      '</div>' + dueRow +
      '<div class="sub-label">Tashriflar tarixi</div>' +
      (hist.length ? hist.map(function (h) {
        return '<div class="vh-item"><span class="date">' + fmtUz(h.date) + '</span><span class="time">' + esc(h.time) + '</span></div>';
      }).join('') : '<div class="empty"><span class="glyph">📭</span>Hali tashrif yo‘q</div>') +
      '<div class="vh-count">Jami tashriflar: <b>' + hist.length + '</b></div>' +
      '<div class="detail-actions">' +
      '<button class="btn btn-gold btn-block" data-mark="' + c.id + '">✂ Bugun keldi</button>' +
      '<button class="btn btn-ghost btn-block" data-edit="' + c.id + '">Tahrirlash</button>' +
      '<button class="btn btn-danger btn-block" data-del="' + c.id + '">O‘chirish</button>' +
      '</div>';
  }

  function getById(id) {
    for (var i = 0; i < clients().length; i++) if (String(clients()[i].id) === String(id)) return clients()[i];
    return null;
  }

  /* ---------- form ---------- */
  function openForm(id) {
    editingId = id;
    var c = id ? getById(id) : null;
    $('form-title').textContent = c ? 'Tahrirlash' : 'Yangi mijoz';
    $('f-id').value = c ? c.id : '';
    $('f-name').value = c ? c.name : '';
    $('f-phone').value = c ? c.phone : '';
    $('f-note').value = c ? (c.note || '') : '';
    $('f-today').checked = true;
    showView('form');
  }

  /* ---------- actions ---------- */
  function refresh() {
    return api('listClients').then(function (data) {
      CACHE.clients = data || [];
      return api('getSettings');
    }).then(function (s) {
      CACHE.settings = s || CACHE.settings;
      renderAll();
    });
  }

  function markVisited(id) {
    var c = getById(id);
    if (!c) return;
    api('markVisitedToday', { id: id }).then(function () {
      toast('✅ ' + c.name + ' — bugungi tashrif yozildi');
      return refresh();
    }).then(function () {
      if (document.getElementById('view-client').classList.contains('active')) openClient(id);
    }).catch(function (e) { toast('Xato: ' + e.message); });
  }

  function saveForm(e) {
    e.preventDefault();
    var name = String($('f-name').value).trim();
    var phoneRaw = $('f-phone').value.trim();
    var note = $('f-note').value.trim();
    if (!name) { toast('Ism kiritilishi shart'); return; }
    var phone;
    try { phone = normalizePhone(phoneRaw); } catch (err) { toast(err.message); return; }
    var id = $('f-id').value;
    var visitedToday = $('f-today').checked;

    if (id) {
      api('updateClient', { id: id, name: name, phone: phone, note: note }, 'POST').then(refresh).then(function () {
        toast('✅ O‘zgartirildi');
        showView('app'); showPanel('clients');
      }).catch(function (err) { toast('Xato: ' + err.message); });
    } else {
      api('createClient', { name: name, phone: phone, note: note, visitedToday: visitedToday }, 'POST')
        .then(refresh).then(function () {
          toast(visitedToday ? '✅ Mijoz qo‘shildi va "bugun keldi" belgilandi' : '✅ Mijoz qo‘shildi');
          showView('app'); showPanel('home'); renderHome();
        }).catch(function (err) { toast('Xato: ' + err.message); });
    }
  }

  function deleteClient(id) {
    var c = getById(id);
    if (!c) return;
    if (!confirm('"' + c.name + '" o‘chirilsinmi?')) return;
    api('deleteClient', { id: id }).then(refresh).then(function () {
      toast('🗑 O‘chirildi');
      showView('app'); showPanel('clients');
    }).catch(function (err) { toast('Xato: ' + err.message); });
  }

  /* ---------- onboarding ---------- */
  function checkOnboard() {
    if (localStorage.getItem(LS_ONBOARDED) === '1') {
      startApp();
      return;
    }
    // Check server: already has barberPhone?
    api('getSettings').then(function (s) {
      if (s && s.barberPhone) {
        localStorage.setItem(LS_ONBOARDED, '1');
        startApp();
      } else {
        showView('onboard');
      }
    }).catch(function () {
      showView('onboard');
    });
  }

  function startApp() {
    showView('app');
    refresh();
  }

  /* ---------- settings ---------- */
  function handleSettings(act) {
    if (act === 'remind') {
      var v = prompt('Necha kundan keyin eslatma yuborilsin?', reminderDays());
      var n = parseInt(v, 10);
      if (n >= 1 && n <= 90) {
        api('saveSettings', { reminderDays: n }, 'POST').then(refresh).then(function () { toast('✅ Saqlandi'); });
      } else if (v !== null) { toast('1-90 oralig‘ida bo‘lishi kerak'); }
    } else if (act === 'phone') {
      var v = prompt('Telefon raqam:', settings().barberPhone || '');
      if (!v) return;
      try {
        var p = normalizePhone(v);
        api('saveSettings', { barberPhone: p }, 'POST').then(refresh).then(function () { toast('✅ Saqlandi'); });
      } catch (e) { toast(e.message); }
    } else if (act === 'health') {
      api('init').then(function () { toast('✅ Ulanish yaxshi'); }).catch(function (e) { toast('Xato: ' + e.message); });
    }
  }

  /* ---------- wiring ---------- */
  function wire() {
    // onboarding
    $('ob-next').addEventListener('click', function () {
      var v = $('ob-phone').value.trim();
      if (!v) { toast('Telefon raqam kiriting'); return; }
      var p;
      try { p = normalizePhone(v); } catch (e) { toast(e.message); return; }
      api('saveSettings', { barberPhone: p }, 'POST').then(function () {
        localStorage.setItem(LS_ONBOARDED, '1');
        startApp();
        toast('✅ Tayyor!');
      }).catch(function (e) { toast('Xato: ' + e.message); });
    });
    $('ob-phone').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('ob-next').click(); });

    // tabs
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener('click', function () {
      showPanel(this.dataset.view);
    });

    $('btn-settings-top').addEventListener('click', function () { showPanel('settings'); });
    $('btn-add-client').addEventListener('click', function () { openForm(null); });

    // delegation: dynamic lists
    $('content').addEventListener('click', function (e) {
      var card = e.target.closest('[data-open]');
      if (card && (e.target.closest('.client-card') || e.target.closest('.tl-item'))) { openClient(card.dataset.open); return; }
    });
    $('client-detail-body').addEventListener('click', function (e) {
      var mark = e.target.closest('[data-mark]'); if (mark) { markVisited(mark.dataset.mark); return; }
      var edit = e.target.closest('[data-edit]'); if (edit) { openForm(edit.dataset.edit); return; }
      var del = e.target.closest('[data-del]'); if (del) { deleteClient(del.dataset.del); return; }
    });
    $('settings-list').addEventListener('click', function (e) {
      var it = e.target.closest('[data-act]'); if (it) handleSettings(it.dataset.act);
    });

    // back buttons
    $('client-back').addEventListener('click', function () { showView('app'); renderAll(); });
    $('form-back').addEventListener('click', function () { showView('app'); showPanel('clients'); renderAll(); });

    // clients panel
    $('client-search').addEventListener('input', function (e) { searchQ = e.target.value; renderClientsList(); });
    $('btn-sort').addEventListener('click', function () {
      sortMode = sortMode === 'last' ? 'alpha' : 'last';
      this.textContent = sortMode === 'last' ? 'Sanasi' : 'A-Z';
      renderClientsList();
    });

    // form
    $('client-form').addEventListener('submit', saveForm);
  }

  /* ---------- init ---------- */
  function init() {
    wire();
    if (CONFIG.API_URL.indexOf('REPLACE') !== -1) {
      // Not configured yet — show onboarding anyway, API calls will fail gracefully
    }
    checkOnboard();
  }

  init();
})();
