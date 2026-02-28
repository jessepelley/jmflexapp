/* ═══════════════════════════════════════════════════
   JM FLEX APP — app.js
   Offline-first fitness tracker with server sync
═══════════════════════════════════════════════════ */
'use strict';

/* ── Constants ───────────────────────────────────── */
const STORAGE_KEY   = 'jmflex_data';
const SYNC_INTERVAL = 30000;
const CATEGORIES    = ['Back','Legs','Forearms','Biceps','Triceps','Abs','Shoulders','Chest','Glutes'];
const LB_MAX        = 10; // max exercises shown on leaderboard

/* ── Default data structure ──────────────────────── */
function defaultData() {
  return {
    clients: [],
    exercises: [],
    records: [],       // one record per (clientId, exerciseId) = personal best
    settings: {
      apiKey: '',
      apiUrl: 'https://jjjp.ca/jmflexapp',
      genderFilter: 'male',
      clientModeActive: false,
      activeClientId: null,
      lastSync: 0
    }
  };
}

/* ── App State ───────────────────────────────────── */
const App = {
  data: defaultData(),
  currentView: 'leaderboard',
  isOnline: navigator.onLine,
  syncTimer: null,
  syncPending: false,
  lbCategoryFilter: 'all',   // 'all' or category name
  listSearchQuery: '',
  detailClientId: null,      // client being viewed in clientDetail view

  // keypad state
  keypadTarget: null,  // 'weight' | 'reps'
  keypadValue: '',

  // selected items in add-record form
  addForm: {
    clientId: null, clientName: '',
    exerciseId: null, exerciseName: '', exerciseCat: '',
    weight: '', reps: ''
  }
};

/* ═══════════════════════════════════════════════════
   STORAGE
═══════════════════════════════════════════════════ */
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.data)); }
  catch(e) { console.error('Storage save failed', e); }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      App.data = deepMerge(defaultData(), parsed);
    }
  } catch(e) {
    console.error('Storage load failed', e);
    App.data = defaultData();
  }
}

function deepMerge(base, override) {
  const result = Object.assign({}, base);
  for (const key of Object.keys(override)) {
    if (override[key] !== null && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = deepMerge(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

/* ═══════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0,2) || '?';
}

function fmt(n) {
  const num = parseFloat(n);
  if (isNaN(num)) return '0';
  return num % 1 === 0 ? num.toString() : num.toFixed(1);
}

function fmtVolume(n) {
  if (n >= 1000) return (n/1000).toFixed(1) + 'k';
  return String(n);
}

function genderLabel(gender) {
  return gender === 'male' ? 'Male' : 'Female';
}

function $id(id) { return document.getElementById(id); }

function showToast(msg, type = 'info', duration = 2500) {
  const el = $id('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), duration);
}

/* ═══════════════════════════════════════════════════
   API SYNC
═══════════════════════════════════════════════════ */
function apiUrl(action) {
  const base = (App.data.settings.apiUrl || '').replace(/\/+$/, '');
  return `${base}/api.php?action=${action}`;
}

function apiHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-API-Key': App.data.settings.apiKey
  };
}

async function apiCall(action, body) {
  try {
    const res = await fetch(apiUrl(action), {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch(e) {
    return { error: e.message };
  }
}

async function validateApiKey(url, key) {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api.php?action=validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key })
    });
    const data = await res.json();
    return data.success === true;
  } catch(e) {
    return false;
  }
}

async function syncToServer() {
  if (!App.data.settings.apiKey || !App.data.settings.apiUrl) return;
  setSyncStatus('syncing');
  const result = await apiCall('sync', {
    data: App.data,
    timestamp: App.data.settings.lastSync
  });
  if (result.error) {
    setSyncStatus('offline');
    App.syncPending = true;
    return;
  }
  if (result.data) {
    // Server returned (possibly merged) data
    const serverSettings = App.data.settings; // keep local settings
    App.data = result.data;
    App.data.settings = Object.assign({}, result.data.settings || {}, {
      apiKey: serverSettings.apiKey,
      apiUrl: serverSettings.apiUrl,
      genderFilter: serverSettings.genderFilter,
      clientModeActive: serverSettings.clientModeActive,
      activeClientId: serverSettings.activeClientId,
      lastSync: result.timestamp || Date.now()
    });
    save();
    renderCurrentView();
    updateHeaderState();
  }
  setSyncStatus('synced');
  App.syncPending = false;
}

async function pushData() {
  if (!App.data.settings.apiKey) return;
  const result = await apiCall('push', { data: App.data });
  if (!result.error && result.timestamp) {
    App.data.settings.lastSync = result.timestamp;
    save();
    setSyncStatus('synced');
    App.syncPending = false;
  } else {
    App.syncPending = true;
    setSyncStatus('offline');
  }
}

function setSyncStatus(status) {
  const dot = $id('syncDot');
  if (!dot) return;
  dot.className = `sync-dot ${status}`;
  dot.title = { synced: 'Synced', syncing: 'Syncing…', offline: 'Offline' }[status] || '';
}

function startSyncTimer() {
  if (App.syncTimer) clearInterval(App.syncTimer);
  App.syncTimer = setInterval(() => {
    if (navigator.onLine) syncToServer();
  }, SYNC_INTERVAL);
}

window.addEventListener('online', () => {
  App.isOnline = true;
  setSyncStatus('syncing');
  if (App.syncPending) syncToServer();
  else syncToServer();
});
window.addEventListener('offline', () => {
  App.isOnline = false;
  setSyncStatus('offline');
});

/* ═══════════════════════════════════════════════════
   DATA — CLIENTS
═══════════════════════════════════════════════════ */
function getClients(genderFilter) {
  let list = App.data.clients || [];
  if (genderFilter) list = list.filter(c => c.gender === genderFilter);
  return list.sort((a,b) => a.name.localeCompare(b.name));
}

function getClient(id) {
  return (App.data.clients || []).find(c => c.id === id);
}

function saveClient(fields) {
  // fields: {id?, name, gender, isTrainer}
  if (fields.id) {
    const idx = App.data.clients.findIndex(c => c.id === fields.id);
    if (idx >= 0) App.data.clients[idx] = Object.assign(App.data.clients[idx], fields);
  } else {
    App.data.clients.push({ ...fields, id: uid() });
  }
  save(); pushData();
}

function deleteClient(id) {
  App.data.clients = App.data.clients.filter(c => c.id !== id);
  App.data.records = App.data.records.filter(r => r.clientId !== id);
  save(); pushData();
}

/* ═══════════════════════════════════════════════════
   DATA — EXERCISES
═══════════════════════════════════════════════════ */
function getExercises() {
  return (App.data.exercises || []).sort((a,b) => a.name.localeCompare(b.name));
}

function getExercise(id) {
  return (App.data.exercises || []).find(e => e.id === id);
}

function saveExercise(fields) {
  if (fields.id) {
    const idx = App.data.exercises.findIndex(e => e.id === fields.id);
    if (idx >= 0) App.data.exercises[idx] = Object.assign(App.data.exercises[idx], fields);
  } else {
    App.data.exercises.push({ ...fields, id: uid() });
  }
  save(); pushData();
}

function deleteExercise(id) {
  App.data.exercises = App.data.exercises.filter(e => e.id !== id);
  App.data.records = App.data.records.filter(r => r.exerciseId !== id);
  save(); pushData();
}

/* ═══════════════════════════════════════════════════
   DATA — RECORDS
═══════════════════════════════════════════════════ */
function getRecord(clientId, exerciseId) {
  return (App.data.records || []).find(r => r.clientId === clientId && r.exerciseId === exerciseId);
}

function getExerciseRecords(exerciseId, genderFilter) {
  let records = (App.data.records || []).filter(r => r.exerciseId === exerciseId);
  if (genderFilter) {
    records = records.filter(r => {
      const client = getClient(r.clientId);
      return client && client.gender === genderFilter;
    });
  }
  return records.sort((a,b) => b.weight - a.weight || b.reps - a.reps);
}

function isNewBest(existing, newWeight, newReps) {
  if (!existing) return true;
  if (newWeight > existing.weight) return true;
  if (newWeight === existing.weight && newReps > existing.reps) return true;
  return false;
}

// Returns { saved: bool, wasGold: bool, isGold: bool }
function saveRecord(clientId, exerciseId, weight, reps) {
  const volume = Math.round(weight * reps);
  const existing = getRecord(clientId, exerciseId);
  const client = getClient(clientId);
  if (!client) return { saved: false };

  // Was this client already #1 before?
  const gender = client.gender;
  const prevRankings = getExerciseRecords(exerciseId, gender);
  const wasGold = prevRankings.length > 0 && prevRankings[0].clientId === clientId;

  if (!isNewBest(existing, weight, reps)) {
    return { saved: false, existing };
  }

  const now = Date.now();
  if (existing) {
    existing.weight = weight;
    existing.reps = reps;
    existing.volume = volume;
    existing.updatedAt = now;
  } else {
    App.data.records.push({ id: uid(), clientId, exerciseId, weight, reps, volume, updatedAt: now });
  }

  save(); pushData();

  // Check if now #1
  const newRankings = getExerciseRecords(exerciseId, gender);
  const isGold = newRankings.length > 0 && newRankings[0].clientId === clientId;

  return { saved: true, wasGold, isGold };
}

// Overwrite a record unconditionally (used to correct bad data)
function forceUpdateRecord(clientId, exerciseId, weight, reps) {
  const volume = Math.round(weight * reps);
  const existing = getRecord(clientId, exerciseId);
  const now = Date.now();
  if (existing) {
    existing.weight = weight;
    existing.reps   = reps;
    existing.volume = volume;
    existing.updatedAt = now;
  } else {
    App.data.records.push({ id: uid(), clientId, exerciseId, weight, reps, volume, updatedAt: now });
  }
  save(); pushData();
  return { saved: true };
}

/* ═══════════════════════════════════════════════════
   LEADERBOARD LOGIC
═══════════════════════════════════════════════════ */
function getLeaderboardData() {
  const gender = App.data.settings.genderFilter;
  const clientIds = new Set(getClients(gender).map(c => c.id));

  // Filter records to current gender
  let records = (App.data.records || []).filter(r => clientIds.has(r.clientId));

  // Apply category filter
  if (App.lbCategoryFilter !== 'all') {
    const exIds = new Set(
      (App.data.exercises || [])
        .filter(e => e.category === App.lbCategoryFilter)
        .map(e => e.id)
    );
    records = records.filter(r => exIds.has(r.exerciseId));
  }

  // Group by exercise, keep track of most recent update and top client
  const map = new Map(); // exerciseId → {latestAt, topRecord, count}
  for (const r of records) {
    const ex = map.get(r.exerciseId);
    if (!ex) {
      map.set(r.exerciseId, { latestAt: r.updatedAt || 0, topRecord: r, count: 1 });
    } else {
      ex.count++;
      if ((r.updatedAt || 0) > ex.latestAt) ex.latestAt = r.updatedAt || 0;
      // Best = highest weight, then reps
      if (r.weight > ex.topRecord.weight ||
          (r.weight === ex.topRecord.weight && r.reps > ex.topRecord.reps)) {
        ex.topRecord = r;
      }
    }
  }

  // Sort by most recent activity, take top N
  const entries = Array.from(map.entries())
    .sort((a,b) => b[1].latestAt - a[1].latestAt)
    .slice(0, LB_MAX);

  return entries.map(([exerciseId, info]) => ({
    exercise: getExercise(exerciseId),
    topRecord: info.topRecord,
    topClient: getClient(info.topRecord.clientId),
    count: info.count
  })).filter(e => e.exercise && e.topClient);
}

/* ═══════════════════════════════════════════════════
   RENDERING — VIEWS
═══════════════════════════════════════════════════ */
function renderCurrentView() {
  const area = $id('contentArea');
  if (!area) return;
  const v = App.currentView;
  if (v === 'leaderboard')   area.innerHTML = renderLeaderboard();
  else if (v === 'clients')       area.innerHTML = renderClients();
  else if (v === 'exercises')     area.innerHTML = renderExercises();
  else if (v === 'settings')      area.innerHTML = renderSettings();
  else if (v === 'clientDetail')  area.innerHTML = renderClientDetail();
  else if (v === 'add')           { openAddRecordModal(); return; }
  attachViewHandlers(v);
}

/* ── Leaderboard ─────────────────────────────────── */
function renderLeaderboard() {
  const gender = App.data.settings.genderFilter;
  const lb = getLeaderboardData();

  // Category filter pills
  const usedCats = new Set();
  (App.data.records || []).forEach(r => {
    const ex = getExercise(r.exerciseId);
    if (ex) usedCats.add(ex.category);
  });

  const pills = ['all', ...CATEGORIES.filter(c => usedCats.has(c))].map(c => {
    const label = c === 'all' ? 'All' : c;
    const active = App.lbCategoryFilter === c ? 'active' : '';
    return `<button class="filter-pill ${active}" data-cat="${escHtml(c)}">${escHtml(label)}</button>`;
  }).join('');

  let cards = '';
  if (lb.length === 0) {
    cards = `<div class="lb-empty">
      <div class="lb-empty-icon">🏋️</div>
      <div class="lb-empty-text">No records yet</div>
      <div class="lb-empty-sub">Tap ➕ to add the first record</div>
    </div>`;
  } else {
    cards = lb.map(item => renderLbCard(item)).join('');
  }

  const clientMode = App.data.settings.clientModeActive;
  const activeClient = clientMode ? getClient(App.data.settings.activeClientId) : null;
  const modeNote = activeClient
    ? `<span style="color:var(--c-accent);font-weight:700">${escHtml(activeClient.name)}'s view</span>`
    : `<span>${genderLabel(gender)}</span>`;

  return `
    <div class="leaderboard-header">
      <div>
        <div class="lb-title">🏆 LEADERBOARD</div>
        <div class="lb-subtitle">${modeNote} · Top ${LB_MAX} active exercises</div>
      </div>
    </div>
    <div class="lb-filter-pills">${pills}</div>
    <div class="lb-list">${cards}</div>`;
}

function renderLbCard(item) {
  const { exercise, topRecord, topClient } = item;
  const allRecords = getExerciseRecords(exercise.id, App.data.settings.genderFilter);
  const vol = fmtVolume(topRecord.volume || topRecord.weight * topRecord.reps);
  const roleLabel = topClient.isTrainer ? '<span class="trainer-badge">TRAINER</span>' : '';

  return `<div class="lb-card" data-ex-id="${escHtml(exercise.id)}">
    <div class="lb-card-top">
      <div class="lb-card-left">
        <div class="lb-ex-name">${escHtml(exercise.name)}</div>
        <span class="lb-cat-pill">${escHtml(exercise.category || '')}</span>
      </div>
      <span class="lb-rank-count">${allRecords.length} athlete${allRecords.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="lb-top-client">
      <span class="lb-medal">🥇</span>
      <div class="lb-client-info">
        <div class="lb-client-name">${escHtml(topClient.name)} ${roleLabel}</div>
        <div class="lb-client-role">${genderLabel(topClient.gender)}</div>
      </div>
      <div class="lb-metrics">
        <div class="lb-metric">
          <div class="lb-metric-val">${fmt(topRecord.weight)}</div>
          <div class="lb-metric-lbl">lbs</div>
        </div>
        <div class="lb-metric">
          <div class="lb-metric-val">${fmt(topRecord.reps)}</div>
          <div class="lb-metric-lbl">reps</div>
        </div>
      </div>
    </div>
    <div class="lb-volume-row">
      <span class="lb-volume-lbl">Volume:</span>
      <span class="lb-volume-val">${vol} lbs</span>
    </div>
  </div>`;
}

/* ── Clients View ────────────────────────────────── */
function renderClients() {
  const gender = App.data.settings.genderFilter;
  const clients = getClients(gender);
  const q = App.listSearchQuery.toLowerCase();
  const filtered = q ? clients.filter(c => c.name.toLowerCase().includes(q)) : clients;

  const trainers = filtered.filter(c => c.isTrainer);
  const regular  = filtered.filter(c => !c.isTrainer);

  let html = `
    <div class="list-search-bar">
      <div class="search-box">
        <span class="search-box-icon">🔍</span>
        <input class="search-box-input" id="clientListSearch" type="search" placeholder="Search clients…" value="${escHtml(q)}" autocorrect="off">
      </div>
    </div>
    <div class="list-toolbar">
      <button class="btn-icon-text" id="addClientBtn">➕ Add Client</button>
      <button class="btn-icon-text" id="importClientsBtn">📥 Import CSV</button>
      <button class="btn-icon-text" id="exportClientsBtn">📤 Export CSV</button>
      <input type="file" id="importClientsFile" accept=".csv" class="hidden">
    </div>`;

  if (trainers.length > 0) {
    html += `<div class="list-section-header">Trainers</div><div class="list-items">`;
    html += trainers.map(c => renderClientCard(c)).join('');
    html += `</div>`;
  }
  html += `<div class="list-section-header">Clients (${genderLabel(gender)})</div><div class="list-items">`;
  if (regular.length === 0) {
    html += `<div style="padding:20px;color:var(--c-text2);text-align:center">No clients found</div>`;
  } else {
    html += regular.map(c => renderClientCard(c)).join('');
  }
  html += `</div>`;
  return html;
}

function renderClientCard(c) {
  const avatar = initials(c.name);
  const roleClass = c.isTrainer ? 'trainer' : c.gender;
  const badge = c.isTrainer ? `<span class="trainer-badge">TRAINER</span>` : '';
  const recCount = (App.data.records || []).filter(r => r.clientId === c.id).length;
  const sessionBtn = !c.isTrainer
    ? `<button class="list-card-session-btn" data-client-session="${escHtml(c.id)}">Session</button>`
    : '';

  return `<div class="list-card" data-client-id="${escHtml(c.id)}">
    <div class="list-card-avatar ${roleClass}">${avatar}</div>
    <div class="list-card-info">
      <div class="list-card-name">${escHtml(c.name)} ${badge}</div>
      <div class="list-card-meta">${genderLabel(c.gender)} · ${recCount} record${recCount !== 1 ? 's' : ''}</div>
    </div>
    <div class="list-card-right">
      ${sessionBtn}
      <span class="list-arrow">›</span>
    </div>
  </div>`;
}

/* ── Client Detail View ──────────────────────────── */
function renderClientDetail() {
  const client = getClient(App.detailClientId);
  if (!client) return `<div style="padding:20px;color:var(--c-text2)">Client not found.</div>`;

  const records = (App.data.records || [])
    .filter(r => r.clientId === client.id)
    .map(r => ({ ...r, exercise: getExercise(r.exerciseId) }))
    .filter(r => r.exercise)
    .sort((a, b) => (b.volume || 0) - (a.volume || 0));

  const totalVolume = records.reduce((sum, r) => sum + (r.volume || r.weight * r.reps || 0), 0);
  const avatar = initials(client.name);
  const roleClass = client.isTrainer ? 'trainer' : client.gender;
  const badge = client.isTrainer ? `<span class="trainer-badge">TRAINER</span>` : '';

  let recordRows = '';
  if (records.length === 0) {
    recordRows = `<div style="padding:20px;color:var(--c-text2);text-align:center">No records yet</div>`;
  } else {
    recordRows = records.map(r => `
      <div class="list-card" style="cursor:default">
        <div class="list-card-avatar" style="border-radius:10px;font-size:12px">${escHtml((r.exercise.category||'?').substring(0,3).toUpperCase())}</div>
        <div class="list-card-info">
          <div class="list-card-name">${escHtml(r.exercise.name)}</div>
          <div class="list-card-meta">${escHtml(r.exercise.category||'')} · ${fmt(r.weight)} lbs × ${fmt(r.reps)} reps</div>
        </div>
        <div class="list-card-right" style="text-align:right;gap:8px;display:flex;flex-direction:column;align-items:flex-end">
          <div style="font-weight:700;color:var(--c-light)">${fmtVolume(r.volume || r.weight * r.reps)} lbs</div>
          <button class="btn btn-sm btn-outline" data-edit-record-client="${escHtml(client.id)}" data-edit-record-exercise="${escHtml(r.exercise.id)}" style="font-size:11px;padding:2px 8px">Edit</button>
        </div>
      </div>`).join('');
  }

  return `
    <div class="view" style="padding-top:16px">
      <div class="view-header" style="padding:0 0 16px;display:flex;align-items:center;gap:12px">
        <button class="btn btn-sm btn-outline" id="backToClientsBtn">← Back</button>
        <span class="view-title" style="flex:1">Client Profile</span>
        <button class="btn btn-sm btn-outline" id="editClientDetailBtn">Edit</button>
      </div>

      <div class="list-card" style="margin-bottom:20px;cursor:default">
        <div class="list-card-avatar ${roleClass}" style="width:52px;height:52px;font-size:20px">${avatar}</div>
        <div class="list-card-info">
          <div class="list-card-name" style="font-size:18px">${escHtml(client.name)} ${badge}</div>
          <div class="list-card-meta">${genderLabel(client.gender)}</div>
        </div>
        ${!client.isTrainer ? `<button class="list-card-session-btn" id="startSessionDetailBtn">Session</button>` : ''}
      </div>

      <div class="settings-group" style="margin-bottom:20px">
        <div class="settings-group-title">Stats</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px 16px">
          <div style="text-align:center">
            <div style="font-size:28px;font-weight:800;color:var(--c-accent)">${records.length}</div>
            <div style="font-size:12px;color:var(--c-text2)">Personal Bests</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:28px;font-weight:800;color:var(--c-light)">${fmtVolume(totalVolume)}</div>
            <div style="font-size:12px;color:var(--c-text2)">Total Volume (lbs)</div>
          </div>
        </div>
      </div>

      <div class="list-section-header">Personal Bests (${records.length})</div>
      <div class="list-items">${recordRows}</div>
    </div>`;
}

/* ── Exercises View ──────────────────────────────── */
function renderExercises() {
  const exercises = getExercises();
  const q = App.listSearchQuery.toLowerCase();
  const filtered = q ? exercises.filter(e => e.name.toLowerCase().includes(q) || (e.category||'').toLowerCase().includes(q)) : exercises;

  // Group by category
  const byCat = {};
  for (const e of filtered) {
    const cat = e.category || 'Uncategorized';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(e);
  }

  let items = '';
  for (const cat of [...CATEGORIES, 'Uncategorized']) {
    if (!byCat[cat] || byCat[cat].length === 0) continue;
    items += `<div class="list-section-header">${escHtml(cat)}</div><div class="list-items">`;
    items += byCat[cat].map(e => renderExerciseCard(e)).join('');
    items += `</div>`;
  }
  if (!items) items = `<div style="padding:20px;color:var(--c-text2);text-align:center">No exercises found</div>`;

  return `
    <div class="list-search-bar">
      <div class="search-box">
        <span class="search-box-icon">🔍</span>
        <input class="search-box-input" id="exListSearch" type="search" placeholder="Search exercises…" value="${escHtml(q)}" autocorrect="off">
      </div>
    </div>
    <div class="list-toolbar">
      <button class="btn-icon-text" id="addExerciseBtn">➕ Add Exercise</button>
      <button class="btn-icon-text" id="importExercisesBtn">📥 Import CSV</button>
      <button class="btn-icon-text" id="exportExercisesBtn">📤 Export CSV</button>
      <input type="file" id="importExercisesFile" accept=".csv" class="hidden">
    </div>
    ${items}`;
}

function renderExerciseCard(e) {
  const recCount = (App.data.records || []).filter(r => r.exerciseId === e.id).length;
  return `<div class="list-card" data-exercise-id="${escHtml(e.id)}">
    <div class="list-card-avatar" style="border-radius:10px;font-size:12px">${escHtml((e.category||'?').substring(0,3).toUpperCase())}</div>
    <div class="list-card-info">
      <div class="list-card-name">${escHtml(e.name)}</div>
      <div class="list-card-meta">${escHtml(e.category || 'Uncategorized')} · ${recCount} record${recCount !== 1 ? 's' : ''}</div>
    </div>
    <div class="list-card-right">
      <span class="cat-badge">${escHtml(e.category||'')}</span>
      <span class="list-arrow">›</span>
    </div>
  </div>`;
}

/* ── Settings View ───────────────────────────────── */
function renderSettings() {
  const s = App.data.settings;
  const syncTime = s.lastSync ? new Date(s.lastSync).toLocaleTimeString() : 'Never';

  return `
    <div class="view" style="padding-top:16px">
      <div class="view-header" style="padding:0 0 12px">
        <span class="view-title">⚙️ Settings</span>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Connection</div>
        <div class="settings-row">
          <span class="settings-row-icon">🔗</span>
          <div class="settings-row-info">
            <div class="settings-row-label">API URL</div>
            <div class="settings-row-sub">${escHtml(s.apiUrl || 'Not set')}</div>
          </div>
          <button class="btn btn-sm btn-outline" id="editApiUrlBtn">Edit</button>
        </div>
        <div class="settings-row">
          <span class="settings-row-icon">🔑</span>
          <div class="settings-row-info">
            <div class="settings-row-label">API Key</div>
            <div class="settings-row-sub">${s.apiKey ? '••••••••' : 'Not set'}</div>
          </div>
          <button class="btn btn-sm btn-outline" id="editApiKeyBtn">Edit</button>
        </div>
        <div class="settings-row">
          <span class="settings-row-icon">🔄</span>
          <div class="settings-row-info">
            <div class="settings-row-label">Last Sync</div>
            <div class="settings-row-sub">${syncTime}</div>
          </div>
          <button class="btn btn-sm btn-outline" id="syncNowBtn">Sync Now</button>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Client Session Mode</div>
        <div class="settings-row">
          <span class="settings-row-icon">👤</span>
          <div class="settings-row-info">
            <div class="settings-row-label">Session Mode</div>
            <div class="settings-row-sub">Focus the app on one client</div>
          </div>
          <button class="btn btn-sm ${s.clientModeActive ? 'btn-danger' : 'btn-outline'}" id="toggleClientModeBtn">
            ${s.clientModeActive ? 'End Session' : 'Start Session'}
          </button>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Data Management</div>
        <div class="settings-row" id="exportAllRow" style="cursor:pointer">
          <span class="settings-row-icon">📤</span>
          <div class="settings-row-info">
            <div class="settings-row-label">Export All Data</div>
            <div class="settings-row-sub">Download complete JSON backup</div>
          </div>
          <span class="settings-chevron">›</span>
        </div>
        <div class="settings-row" id="importAllRow" style="cursor:pointer">
          <span class="settings-row-icon">📥</span>
          <div class="settings-row-info">
            <div class="settings-row-label">Import Data</div>
            <div class="settings-row-sub">Restore from JSON backup</div>
          </div>
          <span class="settings-chevron">›</span>
        </div>
        <div class="settings-row" id="clearDataRow" style="cursor:pointer">
          <span class="settings-row-icon">🗑️</span>
          <div class="settings-row-info">
            <div class="settings-row-label">Clear All Local Data</div>
            <div class="settings-row-sub" style="color:var(--c-danger)">Cannot be undone</div>
          </div>
          <span class="settings-chevron">›</span>
        </div>
      </div>

      <input type="file" id="importAllFile" accept=".json" class="hidden">

      <div class="settings-group">
        <div class="settings-group-title">About</div>
        <div class="settings-row" id="githubLinkRow" style="cursor:pointer">
          <span class="settings-row-icon">🐙</span>
          <div class="settings-row-info">
            <div class="settings-row-label">GitHub Repository</div>
            <div class="settings-row-sub">jessepelley/jmflexapp</div>
          </div>
          <span class="settings-chevron">›</span>
        </div>
        <div class="settings-row">
          <span class="settings-row-icon">📋</span>
          <div class="settings-row-info">
            <div class="settings-row-label">Version History</div>
            <div class="settings-row-sub" style="line-height:1.6">
              <strong style="color:var(--c-accent)">v2.0</strong> — Client detail view, search fix, cache busting<br>
              <strong>v1.0</strong> — Initial release: leaderboard, records, sync, CSV
            </div>
          </div>
        </div>
      </div>

      <div style="text-align:center;padding:20px;color:var(--c-muted);font-size:12px">
        JM Flex App v2.0 · Built for iPad &amp; iPhone
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════
   VIEW EVENT HANDLERS
═══════════════════════════════════════════════════ */
function attachViewHandlers(view) {
  if (view === 'leaderboard')  attachLeaderboardHandlers();
  else if (view === 'clients')      attachClientsHandlers();
  else if (view === 'exercises')    attachExercisesHandlers();
  else if (view === 'settings')     attachSettingsHandlers();
  else if (view === 'clientDetail') attachClientDetailHandlers();
}

function attachLeaderboardHandlers() {
  // Category filter pills
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      App.lbCategoryFilter = pill.dataset.cat;
      renderCurrentView();
    });
  });

  // Leaderboard cards — open exercise detail
  document.querySelectorAll('.lb-card').forEach(card => {
    card.addEventListener('click', () => openExerciseDetail(card.dataset.exId));
  });
}

function attachClientsHandlers() {
  const addBtn = $id('addClientBtn');
  if (addBtn) addBtn.addEventListener('click', () => openClientForm(null));

  const search = $id('clientListSearch');
  if (search) {
    search.addEventListener('input', () => { App.listSearchQuery = search.value; renderCurrentView(); });
    search.focus();
    const len = search.value.length;
    search.setSelectionRange(len, len);
  }

  // Open client detail view
  document.querySelectorAll('[data-client-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-client-session]')) return;
      App.detailClientId = card.dataset.clientId;
      App.currentView = 'clientDetail';
      // Keep 'clients' nav tab active
      document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === 'clients');
      });
      renderCurrentView();
    });
  });

  // Session buttons
  document.querySelectorAll('[data-client-session]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      startClientSession(btn.dataset.clientSession);
    });
  });

  // CSV import/export
  const importBtn = $id('importClientsBtn');
  const importFile = $id('importClientsFile');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (e) => importCsvClients(e.target.files[0]));
  }
  const exportBtn = $id('exportClientsBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportCsvClients);
}

function attachExercisesHandlers() {
  const addBtn = $id('addExerciseBtn');
  if (addBtn) addBtn.addEventListener('click', () => openExerciseForm(null));

  const search = $id('exListSearch');
  if (search) {
    search.addEventListener('input', () => { App.listSearchQuery = search.value; renderCurrentView(); });
    search.focus();
    const len = search.value.length;
    search.setSelectionRange(len, len);
  }

  // Edit exercise
  document.querySelectorAll('[data-exercise-id]').forEach(card => {
    card.addEventListener('click', () => openExerciseForm(card.dataset.exerciseId));
  });

  // CSV import/export
  const importBtn = $id('importExercisesBtn');
  const importFile = $id('importExercisesFile');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (e) => importCsvExercises(e.target.files[0]));
  }
  const exportBtn = $id('exportExercisesBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportCsvExercises);
}

function attachSettingsHandlers() {
  const editUrlBtn = $id('editApiUrlBtn');
  if (editUrlBtn) editUrlBtn.addEventListener('click', () => {
    const val = prompt('Server URL:', App.data.settings.apiUrl);
    if (val !== null) { App.data.settings.apiUrl = val.trim(); save(); renderCurrentView(); }
  });

  const editKeyBtn = $id('editApiKeyBtn');
  if (editKeyBtn) editKeyBtn.addEventListener('click', () => {
    const val = prompt('API Key:', '');
    if (val !== null) { App.data.settings.apiKey = val.trim(); save(); renderCurrentView(); }
  });

  const syncBtn = $id('syncNowBtn');
  if (syncBtn) syncBtn.addEventListener('click', () => { syncToServer(); showToast('Syncing…', 'info'); });

  const toggleMode = $id('toggleClientModeBtn');
  if (toggleMode) toggleMode.addEventListener('click', () => {
    if (App.data.settings.clientModeActive) {
      endClientSession();
    } else {
      // Pick a client first
      showToast('Go to Clients tab and tap "Session" to start', 'info', 3000);
    }
    renderCurrentView();
  });

  const exportAllRow = $id('exportAllRow');
  if (exportAllRow) exportAllRow.addEventListener('click', exportAllData);

  const importAllRow = $id('importAllRow');
  const importAllFile = $id('importAllFile');
  if (importAllRow && importAllFile) {
    importAllRow.addEventListener('click', () => importAllFile.click());
    importAllFile.addEventListener('change', (e) => importAllData(e.target.files[0]));
  }

  const clearRow = $id('clearDataRow');
  if (clearRow) clearRow.addEventListener('click', () => {
    if (confirm('Clear ALL local data? This cannot be undone.')) {
      App.data = defaultData();
      save();
      showToast('Data cleared', 'info');
      renderCurrentView();
    }
  });

  const githubRow = $id('githubLinkRow');
  if (githubRow) githubRow.addEventListener('click', () => {
    window.open('https://github.com/jessepelley/jmflexapp', '_blank');
  });
}

function attachClientDetailHandlers() {
  const backBtn = $id('backToClientsBtn');
  if (backBtn) backBtn.addEventListener('click', () => switchView('clients'));

  const editBtn = $id('editClientDetailBtn');
  if (editBtn) editBtn.addEventListener('click', () => openClientForm(App.detailClientId));

  const sessionBtn = $id('startSessionDetailBtn');
  if (sessionBtn) sessionBtn.addEventListener('click', () => startClientSession(App.detailClientId));

  document.querySelectorAll('[data-edit-record-client]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditRecordModal(btn.dataset.editRecordClient, btn.dataset.editRecordExercise);
    });
  });
}

/* ═══════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════ */
function switchView(view) {
  App.listSearchQuery = '';
  if (view === 'add') {
    openAddRecordModal();
    return;
  }
  App.currentView = view;

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  renderCurrentView();
}

/* ═══════════════════════════════════════════════════
   MODALS
═══════════════════════════════════════════════════ */
function openModal(id) {
  $id('modalBackdrop').classList.remove('hidden');
  const el = $id(id);
  el.classList.remove('hidden');
  requestAnimationFrame(() => el.classList.add('open'));
}

function closeModal(id) {
  const el = $id(id);
  el.classList.remove('open');
  setTimeout(() => {
    el.classList.add('hidden');
    $id('modalBackdrop').classList.add('hidden');
  }, 300);
}

function closeAllModals() {
  document.querySelectorAll('.modal-sheet').forEach(m => {
    m.classList.remove('open');
    setTimeout(() => m.classList.add('hidden'), 300);
  });
  $id('modalBackdrop').classList.add('hidden');
}

/* ── Add Record Modal ────────────────────────────── */
function openAddRecordModal() {
  // Reset form
  const s = App.data.settings;
  App.addForm = { clientId: null, clientName: '', exerciseId: null, exerciseName: '', exerciseCat: '', weight: '', reps: '', forceUpdate: false };
  // Restore normal modal title / button
  const titleEl = $id('addRecordModal').querySelector('.modal-title');
  const saveBtn = $id('saveRecordBtn');
  if (titleEl) titleEl.textContent = 'Add Record';
  if (saveBtn) saveBtn.textContent = 'SAVE RECORD';

  resetAddForm();

  // If client mode active, pre-fill client
  if (s.clientModeActive && s.activeClientId) {
    const c = getClient(s.activeClientId);
    if (c) selectClient(c.id, c.name);
  }

  openModal('addRecordModal');
  updateVolumeDisplay();

  // Focus exercise search if client already selected
  setTimeout(() => {
    if (App.addForm.clientId) {
      $id('exerciseSearch').focus();
    } else {
      $id('clientSearch').focus();
    }
  }, 350);
}

function openEditRecordModal(clientId, exerciseId) {
  const client   = getClient(clientId);
  const exercise = getExercise(exerciseId);
  const record   = getRecord(clientId, exerciseId);
  if (!client || !exercise || !record) return;

  App.addForm = { clientId: null, clientName: '', exerciseId: null, exerciseName: '', exerciseCat: '', weight: '', reps: '', forceUpdate: true };
  resetAddForm();

  selectClient(client.id, client.name);
  selectExercise(exercise.id, exercise.name, exercise.category || '');

  App.addForm.weight = String(record.weight);
  App.addForm.reps   = String(record.reps);
  $id('weightDisplay').textContent = fmt(record.weight);
  $id('repsDisplay').textContent   = fmt(record.reps);
  $id('weightVal').value = record.weight;
  $id('repsVal').value   = record.reps;

  // Signal edit mode in the UI
  const titleEl = $id('addRecordModal').querySelector('.modal-title');
  const saveBtn = $id('saveRecordBtn');
  if (titleEl) titleEl.textContent = 'Edit Record';
  if (saveBtn) saveBtn.textContent = 'SAVE CHANGES';

  updateVolumeDisplay();
  openModal('addRecordModal');
}

function resetAddForm() {
  const af = App.addForm;

  // Client section
  const csg = $id('clientSelectorGroup');
  // If client mode, hide client selector
  if (App.data.settings.clientModeActive && App.data.settings.activeClientId) {
    if (csg) csg.style.display = 'none';
  } else {
    if (csg) csg.style.display = '';
  }

  const cs = $id('clientSearch'); if (cs) cs.value = '';
  const cb = $id('selectedClientBadge'); if (cb) cb.classList.add('hidden');
  const cr = $id('clientSearchResults'); if (cr) cr.classList.add('hidden');
  $id('selectedClientId').value = '';

  const es = $id('exerciseSearch'); if (es) es.value = '';
  const eb = $id('selectedExerciseBadge'); if (eb) eb.classList.add('hidden');
  const er = $id('exerciseSearchResults'); if (er) er.classList.add('hidden');
  $id('selectedExerciseId').value = '';

  $id('weightDisplay').textContent = '—';
  $id('repsDisplay').textContent = '—';
  $id('weightVal').value = '';
  $id('repsVal').value = '';
  $id('volumeRow').classList.add('hidden');
}

function selectClient(id, name) {
  App.addForm.clientId = id;
  App.addForm.clientName = name;
  $id('selectedClientId').value = id;
  $id('selectedClientName').textContent = name;
  $id('selectedClientBadge').classList.remove('hidden');
  $id('clientSearch').value = '';
  $id('clientSearchResults').classList.add('hidden');
}

function selectExercise(id, name, cat) {
  App.addForm.exerciseId = id;
  App.addForm.exerciseName = name;
  App.addForm.exerciseCat = cat;
  $id('selectedExerciseId').value = id;
  $id('selectedExerciseName').textContent = name;
  $id('selectedExerciseCat').textContent = cat;
  $id('selectedExerciseBadge').classList.remove('hidden');
  $id('exerciseSearch').value = '';
  $id('exerciseSearchResults').classList.add('hidden');
}

function updateVolumeDisplay() {
  const w = parseFloat(App.addForm.weight);
  const r = parseFloat(App.addForm.reps);
  if (w > 0 && r > 0) {
    const vol = Math.round(w * r);
    $id('volumeDisplay').textContent = fmtVolume(vol);
    $id('volumeRow').classList.remove('hidden');
  } else {
    $id('volumeRow').classList.add('hidden');
  }
}

function attachAddRecordHandlers() {
  // Client search
  const clientSearch = $id('clientSearch');
  if (clientSearch) {
    clientSearch.addEventListener('input', () => {
      renderSearchResults('client', clientSearch.value);
    });
    clientSearch.addEventListener('focus', () => {
      if (clientSearch.value) renderSearchResults('client', clientSearch.value);
    });
  }

  // Exercise search
  const exerciseSearch = $id('exerciseSearch');
  if (exerciseSearch) {
    exerciseSearch.addEventListener('input', () => {
      renderSearchResults('exercise', exerciseSearch.value);
    });
    exerciseSearch.addEventListener('focus', () => {
      if (exerciseSearch.value) renderSearchResults('exercise', exerciseSearch.value);
    });
  }

  // Clear buttons
  const clearClient = $id('clearClientBtn');
  if (clearClient) clearClient.addEventListener('click', () => {
    App.addForm.clientId = null; App.addForm.clientName = '';
    $id('selectedClientBadge').classList.add('hidden');
    $id('clientSearch').value = '';
    $id('clientSearch').focus();
  });

  const clearExercise = $id('clearExerciseBtn');
  if (clearExercise) clearExercise.addEventListener('click', () => {
    App.addForm.exerciseId = null; App.addForm.exerciseName = '';
    $id('selectedExerciseBadge').classList.add('hidden');
    $id('exerciseSearch').value = '';
    $id('exerciseSearch').focus();
  });

  // Weight / Reps buttons
  const weightBtn = $id('weightBtn');
  if (weightBtn) weightBtn.addEventListener('click', () => openKeypad('weight'));
  const repsBtn = $id('repsBtn');
  if (repsBtn) repsBtn.addEventListener('click', () => openKeypad('reps'));

  // Save
  const saveBtn = $id('saveRecordBtn');
  if (saveBtn) saveBtn.addEventListener('click', handleSaveRecord);
}

function renderSearchResults(type, query) {
  const q = query.toLowerCase().trim();
  const gender = App.data.settings.genderFilter;

  if (type === 'client') {
    const clients = getClients(gender);
    const results = q ? clients.filter(c => c.name.toLowerCase().includes(q)) : clients.slice(0, 8);
    const container = $id('clientSearchResults');
    if (!container) return;
    if (results.length === 0) { container.classList.add('hidden'); return; }
    container.innerHTML = results.map(c => `
      <div class="search-result-item" data-client-result="${escHtml(c.id)}" data-name="${escHtml(c.name)}">
        <div>
          <div class="search-result-name">${escHtml(c.name)}</div>
          <div class="search-result-meta">${genderLabel(c.gender)}${c.isTrainer ? ' · TRAINER' : ''}</div>
        </div>
      </div>`).join('');
    container.classList.remove('hidden');

    container.querySelectorAll('[data-client-result]').forEach(item => {
      item.addEventListener('click', () => selectClient(item.dataset.clientResult, item.dataset.name));
    });
  } else {
    const exercises = getExercises();
    const results = q ? exercises.filter(e => e.name.toLowerCase().includes(q) || (e.category||'').toLowerCase().includes(q)) : exercises.slice(0, 8);
    const container = $id('exerciseSearchResults');
    if (!container) return;
    if (results.length === 0) { container.classList.add('hidden'); return; }
    container.innerHTML = results.map(e => `
      <div class="search-result-item" data-ex-result="${escHtml(e.id)}" data-name="${escHtml(e.name)}" data-cat="${escHtml(e.category||'')}">
        <div>
          <div class="search-result-name">${escHtml(e.name)}</div>
          <div class="search-result-meta">${escHtml(e.category || 'Uncategorized')}</div>
        </div>
      </div>`).join('');
    container.classList.remove('hidden');

    container.querySelectorAll('[data-ex-result]').forEach(item => {
      item.addEventListener('click', () => selectExercise(item.dataset.exResult, item.dataset.name, item.dataset.cat));
    });
  }
}

function handleSaveRecord() {
  const af = App.addForm;
  if (!af.clientId)   { showToast('Please select a client', 'error'); return; }
  if (!af.exerciseId) { showToast('Please select an exercise', 'error'); return; }
  const weight = parseFloat(af.weight);
  const reps = parseFloat(af.reps);
  if (!weight || weight <= 0) { showToast('Please enter weight', 'error'); return; }
  if (!reps || reps <= 0)     { showToast('Please enter reps', 'error'); return; }

  let result;
  if (af.forceUpdate) {
    result = forceUpdateRecord(af.clientId, af.exerciseId, weight, reps);
  } else {
    result = saveRecord(af.clientId, af.exerciseId, weight, reps);
  }

  if (!result.saved && result.existing) {
    const ex = result.existing;
    showToast(`Existing best: ${fmt(ex.weight)} lbs × ${fmt(ex.reps)} reps`, 'info', 3500);
    closeModal('addRecordModal');
    return;
  }

  closeModal('addRecordModal');

  if (af.forceUpdate) {
    showToast(`✓ Record updated — ${fmt(weight)} lbs × ${fmt(reps)} reps`, 'success');
    if (App.currentView === 'clientDetail') renderCurrentView();
  } else if (result.isGold && !result.wasGold) {
    // New #1 — confetti!
    triggerConfetti();
    showToast(`🥇 NEW #1 for ${af.exerciseName}!`, 'success', 4000);
  } else if (result.saved) {
    showToast(`✓ Record saved — ${fmt(weight)} lbs × ${fmt(reps)} reps`, 'success');
  }

  if (App.currentView === 'leaderboard') renderCurrentView();
}

/* ── Exercise Detail Modal ───────────────────────── */
function openExerciseDetail(exerciseId) {
  const exercise = getExercise(exerciseId);
  if (!exercise) return;

  $id('exDetailName').textContent = exercise.name;
  $id('exDetailCat').textContent = exercise.category || '';

  const gender = App.data.settings.genderFilter;
  const rankings = getExerciseRecords(exerciseId, gender);
  const body = $id('exDetailBody');

  if (rankings.length === 0) {
    body.innerHTML = `<div class="detail-empty">No records for ${genderLabel(gender)} athletes yet</div>`;
  } else {
    const medals = ['🥇','🥈','🥉'];
    body.innerHTML = `<div class="detail-ranking-list">` +
      rankings.map((r, i) => {
        const client = getClient(r.clientId);
        if (!client) return '';
        const medal = medals[i] || null;
        const rankEl = medal
          ? `<span class="rank-medal">${medal}</span>`
          : `<span class="rank-num">${i+1}</span>`;
        const vol = fmtVolume(r.volume || r.weight * r.reps);
        const badge = client.isTrainer ? '<span class="trainer-badge" style="font-size:9px">TRAINER</span>' : '';
        return `<div class="rank-card">
          ${rankEl}
          <div class="rank-info">
            <div class="rank-name">${escHtml(client.name)} ${badge}</div>
            <div class="rank-role">${genderLabel(client.gender)}</div>
            <div class="rank-vol">Vol: ${vol} lbs</div>
          </div>
          <div class="rank-stats">
            <div class="rank-stat">
              <div class="rank-stat-val">${fmt(r.weight)}</div>
              <div class="rank-stat-lbl">lbs</div>
            </div>
            <div class="rank-stat">
              <div class="rank-stat-val">${fmt(r.reps)}</div>
              <div class="rank-stat-lbl">reps</div>
            </div>
          </div>
          <button class="rank-edit-btn" data-edit-record="${escHtml(r.clientId)}" data-ex-id="${escHtml(exerciseId)}">Edit</button>
        </div>`;
      }).join('') + `</div>
      <div style="margin-top:14px">
        <button class="btn btn-primary btn-full" id="addToExBtn">➕ Add / Update Record</button>
      </div>`;

    // Edit record buttons
    body.querySelectorAll('[data-edit-record]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeModal('exerciseDetailModal');
        openAddRecordForClient(btn.dataset.editRecord, exerciseId);
      });
    });

    const addToExBtn = body.querySelector('#addToExBtn');
    if (addToExBtn) addToExBtn.addEventListener('click', () => {
      closeModal('exerciseDetailModal');
      openAddRecordForExercise(exerciseId);
    });
  }

  openModal('exerciseDetailModal');
}

function openAddRecordForClient(clientId, exerciseId) {
  const client = getClient(clientId);
  const exercise = getExercise(exerciseId);
  if (!client || !exercise) return;
  resetAddForm();
  selectClient(client.id, client.name);
  selectExercise(exercise.id, exercise.name, exercise.category || '');
  openModal('addRecordModal');
  setTimeout(() => $id('weightBtn').click(), 350);
}

function openAddRecordForExercise(exerciseId) {
  const exercise = getExercise(exerciseId);
  if (!exercise) return;
  resetAddForm();
  if (App.data.settings.clientModeActive && App.data.settings.activeClientId) {
    const c = getClient(App.data.settings.activeClientId);
    if (c) selectClient(c.id, c.name);
  }
  selectExercise(exercise.id, exercise.name, exercise.category || '');
  openModal('addRecordModal');
  setTimeout(() => {
    if (!App.addForm.clientId) $id('clientSearch').focus();
    else $id('weightBtn').click();
  }, 350);
}

/* ── Client Form Modal ───────────────────────────── */
function openClientForm(clientId) {
  const existing = clientId ? getClient(clientId) : null;
  $id('clientFormTitle').textContent = existing ? 'Edit Client' : 'Add Client';
  $id('editClientId').value = clientId || '';
  $id('clientName').value = existing ? existing.name : '';
  $id('deleteClientBtn').classList.toggle('hidden', !existing);

  // Reset gender segmented control
  const genderCtrl = $id('clientGenderControl');
  genderCtrl.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === (existing ? existing.gender : 'male'));
  });

  // Reset role segmented control
  const roleCtrl = $id('clientRoleControl');
  roleCtrl.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === (existing && existing.isTrainer ? 'trainer' : 'client'));
  });

  openModal('clientFormModal');
  setTimeout(() => $id('clientName').focus(), 350);
}

function attachClientFormHandlers() {
  // Segmented controls
  document.querySelectorAll('#clientGenderControl .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#clientGenderControl .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.querySelectorAll('#clientRoleControl .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#clientRoleControl .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const saveBtn = $id('saveClientBtn');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const name = $id('clientName').value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }
    const gender = document.querySelector('#clientGenderControl .seg-btn.active')?.dataset.val || 'male';
    const isTrainer = document.querySelector('#clientRoleControl .seg-btn.active')?.dataset.val === 'trainer';
    const id = $id('editClientId').value || null;
    saveClient({ id, name, gender, isTrainer });
    closeModal('clientFormModal');
    showToast(id ? 'Client updated' : 'Client added', 'success');
    if (App.currentView === 'clients') renderCurrentView();
  });

  const deleteBtn = $id('deleteClientBtn');
  if (deleteBtn) deleteBtn.addEventListener('click', () => {
    const id = $id('editClientId').value;
    if (!id) return;
    const client = getClient(id);
    if (confirm(`Delete ${client ? client.name : 'this client'} and all their records?`)) {
      deleteClient(id);
      closeModal('clientFormModal');
      showToast('Client deleted', 'info');
      if (App.currentView === 'clients') renderCurrentView();
    }
  });
}

/* ── Exercise Form Modal ─────────────────────────── */
function openExerciseForm(exerciseId) {
  const existing = exerciseId ? getExercise(exerciseId) : null;
  $id('exerciseFormTitle').textContent = existing ? 'Edit Exercise' : 'Add Exercise';
  $id('editExerciseId').value = exerciseId || '';
  $id('exerciseName').value = existing ? existing.name : '';
  $id('deleteExerciseBtn').classList.toggle('hidden', !existing);

  // Category grid
  const grid = $id('categoryGrid');
  grid.innerHTML = CATEGORIES.map(cat => `
    <button class="cat-btn${existing && existing.category === cat ? ' active' : ''}" data-cat="${escHtml(cat)}">${escHtml(cat)}</button>
  `).join('');

  // Attach category selection
  grid.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  openModal('exerciseFormModal');
  setTimeout(() => $id('exerciseName').focus(), 350);
}

function attachExerciseFormHandlers() {
  const saveBtn = $id('saveExerciseBtn');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const name = $id('exerciseName').value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }
    const category = document.querySelector('#categoryGrid .cat-btn.active')?.dataset.cat || CATEGORIES[0];
    const id = $id('editExerciseId').value || null;
    saveExercise({ id, name, category });
    closeModal('exerciseFormModal');
    showToast(id ? 'Exercise updated' : 'Exercise added', 'success');
    if (App.currentView === 'exercises') renderCurrentView();
  });

  const deleteBtn = $id('deleteExerciseBtn');
  if (deleteBtn) deleteBtn.addEventListener('click', () => {
    const id = $id('editExerciseId').value;
    if (!id) return;
    const ex = getExercise(id);
    if (confirm(`Delete ${ex ? ex.name : 'this exercise'} and all its records?`)) {
      deleteExercise(id);
      closeModal('exerciseFormModal');
      showToast('Exercise deleted', 'info');
      if (App.currentView === 'exercises') renderCurrentView();
    }
  });
}

/* ═══════════════════════════════════════════════════
   NUMERIC KEYPAD
═══════════════════════════════════════════════════ */
function openKeypad(field) {
  App.keypadTarget = field;
  const cur = App.addForm[field] || '';
  App.keypadValue = cur;

  $id('keypadLabel').textContent = field === 'weight' ? 'Weight (lbs)' : 'Reps';
  $id('keypadDisplay').textContent = cur || '—';

  const overlay = $id('keypadOverlay');
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('open'));

  // Highlight active metric button
  document.querySelectorAll('.metric-input-btn').forEach(b => b.classList.remove('active'));
  const btn = $id(field === 'weight' ? 'weightBtn' : 'repsBtn');
  if (btn) btn.classList.add('active');
}

function closeKeypad(apply = true) {
  const overlay = $id('keypadOverlay');
  overlay.classList.remove('open');
  setTimeout(() => overlay.classList.add('hidden'), 280);

  document.querySelectorAll('.metric-input-btn').forEach(b => b.classList.remove('active'));

  if (apply && App.keypadTarget) {
    const val = App.keypadValue;
    const field = App.keypadTarget;
    App.addForm[field] = val;

    const display = $id(field === 'weight' ? 'weightDisplay' : 'repsDisplay');
    const hidden  = $id(field === 'weight' ? 'weightVal'     : 'repsVal');
    if (val) { display.textContent = fmt(val); if (hidden) hidden.value = val; }
    else     { display.textContent = '—'; }

    updateVolumeDisplay();
  }
  App.keypadTarget = null;
}

function handleKeyInput(key) {
  if (key === 'del') {
    App.keypadValue = App.keypadValue.slice(0, -1);
  } else if (key === '.') {
    if (!App.keypadValue.includes('.')) App.keypadValue += '.';
  } else {
    // Prevent leading zeros
    if (App.keypadValue === '0') App.keypadValue = key;
    else App.keypadValue += key;
  }
  $id('keypadDisplay').textContent = App.keypadValue || '—';
}

/* ═══════════════════════════════════════════════════
   CLIENT SESSION MODE
═══════════════════════════════════════════════════ */
function startClientSession(clientId) {
  const client = getClient(clientId);
  if (!client) return;
  App.data.settings.clientModeActive = true;
  App.data.settings.activeClientId = clientId;
  App.data.settings.genderFilter = client.gender;
  save();
  updateHeaderState();
  switchView('leaderboard');
  showToast(`Session started for ${client.name}`, 'success');
}

function endClientSession() {
  App.data.settings.clientModeActive = false;
  App.data.settings.activeClientId = null;
  save();
  updateHeaderState();
  renderCurrentView();
  showToast('Session ended', 'info');
}

function updateHeaderState() {
  const s = App.data.settings;
  const gender = s.genderFilter;

  // Gender toggle
  const gtMale   = $id('gtMale');
  const gtFemale = $id('gtFemale');
  if (gtMale)   gtMale.classList.toggle('active', gender === 'male');
  if (gtFemale) gtFemale.classList.toggle('active', gender === 'female');

  // Client banner
  const banner = $id('clientBanner');
  if (banner) {
    if (s.clientModeActive && s.activeClientId) {
      const c = getClient(s.activeClientId);
      banner.classList.remove('hidden');
      $id('cbName').textContent = c ? c.name : '—';
      $id('cbGender').textContent = c ? genderLabel(c.gender) : '';
    } else {
      banner.classList.add('hidden');
    }
  }
}

/* ═══════════════════════════════════════════════════
   SETUP SCREEN
═══════════════════════════════════════════════════ */
function showSetupScreen() {
  $id('setupScreen').classList.remove('hidden');
  $id('app').classList.add('hidden');
}

function showApp() {
  $id('setupScreen').classList.add('hidden');
  $id('app').classList.remove('hidden');
}

async function handleSetupConnect() {
  const url = $id('setupUrl').value.trim() || 'https://jjjp.ca/jmflexapp';
  const key = $id('setupApiKey').value.trim();
  const errorEl = $id('setupError');

  if (!key) { errorEl.textContent = 'API Key is required'; errorEl.classList.remove('hidden'); return; }

  const btn = $id('setupConnectBtn');
  btn.textContent = 'Connecting…';
  btn.disabled = true;
  errorEl.classList.add('hidden');

  const valid = await validateApiKey(url, key);

  btn.textContent = 'CONNECT';
  btn.disabled = false;

  if (valid) {
    App.data.settings.apiUrl = url;
    App.data.settings.apiKey = key;
    save();
    showApp();
    syncToServer();
    startSyncTimer();
    updateHeaderState();
    renderCurrentView();
  } else {
    errorEl.textContent = 'Connection failed. Check URL and API key.';
    errorEl.classList.remove('hidden');
  }
}

/* ═══════════════════════════════════════════════════
   CSV IMPORT / EXPORT
═══════════════════════════════════════════════════ */
function csvEscape(val) {
  const s = String(val == null ? '' : val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g,''));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = [];
    let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    vals.push(cur.trim());
    const row = {};
    headers.forEach((h, i) => row[h] = (vals[i] || '').replace(/^"|"$/g,''));
    return row;
  });
}

function downloadText(text, filename, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsvClients() {
  const rows = ['id,name,gender,isTrainer'];
  for (const c of App.data.clients) {
    rows.push([csvEscape(c.id), csvEscape(c.name), csvEscape(c.gender), csvEscape(c.isTrainer ? '1' : '0')].join(','));
  }
  downloadText(rows.join('\n'), 'jmflex-clients.csv');
  showToast('Clients exported', 'success');
}

function importCsvClients(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const rows = parseCsv(e.target.result);
      let added = 0;
      for (const row of rows) {
        if (!row.name) continue;
        const existing = App.data.clients.find(c => c.id === row.id);
        const obj = { id: row.id || uid(), name: row.name, gender: row.gender === 'female' ? 'female' : 'male', isTrainer: row.istrainer === '1' || row.istrainer === 'true' };
        if (existing) { Object.assign(existing, obj); }
        else { App.data.clients.push(obj); added++; }
      }
      save(); pushData(); renderCurrentView();
      showToast(`Imported ${rows.length} clients`, 'success');
    } catch(e) { showToast('Import failed: invalid CSV', 'error'); }
  };
  reader.readAsText(file);
}

function exportCsvExercises() {
  const rows = ['id,name,category'];
  for (const e of App.data.exercises) {
    rows.push([csvEscape(e.id), csvEscape(e.name), csvEscape(e.category || '')].join(','));
  }
  downloadText(rows.join('\n'), 'jmflex-exercises.csv');
  showToast('Exercises exported', 'success');
}

function importCsvExercises(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const rows = parseCsv(e.target.result);
      for (const row of rows) {
        if (!row.name) continue;
        const cat = CATEGORIES.find(c => c.toLowerCase() === (row.category||'').toLowerCase()) || CATEGORIES[0];
        const existing = App.data.exercises.find(ex => ex.id === row.id);
        const obj = { id: row.id || uid(), name: row.name, category: cat };
        if (existing) Object.assign(existing, obj);
        else App.data.exercises.push(obj);
      }
      save(); pushData(); renderCurrentView();
      showToast(`Imported ${rows.length} exercises`, 'success');
    } catch(e) { showToast('Import failed: invalid CSV', 'error'); }
  };
  reader.readAsText(file);
}

function exportAllData() {
  downloadText(JSON.stringify(App.data, null, 2), 'jmflex-backup.json', 'application/json');
  showToast('Backup exported', 'success');
}

function importAllData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.clients || !parsed.exercises) throw new Error('Invalid format');
      const apiKey = App.data.settings.apiKey;
      const apiUrl = App.data.settings.apiUrl;
      App.data = deepMerge(defaultData(), parsed);
      App.data.settings.apiKey = apiKey;
      App.data.settings.apiUrl = apiUrl;
      save(); renderCurrentView(); updateHeaderState();
      showToast('Data imported successfully', 'success');
    } catch(e) { showToast('Import failed: invalid JSON', 'error'); }
  };
  reader.readAsText(file);
}

/* ═══════════════════════════════════════════════════
   CONFETTI
═══════════════════════════════════════════════════ */
function triggerConfetti() {
  const canvas = $id('confettiCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.classList.remove('hidden');

  const colors = ['#feea05','#1b5ca5','#5a84cf','#a3c6ff','#ffffff','#ff6b35','#00e676'];
  const particles = [];

  for (let i = 0; i < 140; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -10 - Math.random() * 200,
      w: 6 + Math.random() * 8,
      h: 3 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.15,
      vx: (Math.random() - 0.5) * 2.5,
      vy: 2 + Math.random() * 3.5,
      alpha: 1
    });
  }

  let start = null;
  const duration = 3800;

  function draw(ts) {
    if (!start) start = ts;
    const elapsed = ts - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let alive = 0;
    for (const p of particles) {
      p.x  += p.vx;
      p.y  += p.vy;
      p.rot += p.rotV;
      p.vx += (Math.random() - 0.5) * 0.1;
      if (elapsed > duration * 0.6) p.alpha = Math.max(0, 1 - (elapsed - duration * 0.6) / (duration * 0.4));

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();

      if (p.y < canvas.height + 20 && p.alpha > 0) alive++;
    }

    if (alive > 0 && elapsed < duration + 500) {
      requestAnimationFrame(draw);
    } else {
      canvas.classList.add('hidden');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  requestAnimationFrame(draw);
}

/* ═══════════════════════════════════════════════════
   GLOBAL EVENT DELEGATION
═══════════════════════════════════════════════════ */
function attachGlobalHandlers() {
  // Bottom nav
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Modal close buttons
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });

  // Backdrop close
  $id('modalBackdrop').addEventListener('click', closeAllModals);

  // Gender toggle
  $id('genderToggle').addEventListener('click', () => {
    App.data.settings.genderFilter = App.data.settings.genderFilter === 'male' ? 'female' : 'male';
    save();
    updateHeaderState();
    renderCurrentView();
  });

  // Client banner exit
  $id('cbExit').addEventListener('click', endClientSession);

  // Keypad keys
  $id('keypadGrid')?.querySelectorAll('.key-btn').forEach(btn => {
    btn.addEventListener('click', () => handleKeyInput(btn.dataset.key));
  });
  $id('keypadDone')?.addEventListener('click', () => closeKeypad(true));
  $id('keypadBackdrop')?.addEventListener('click', () => closeKeypad(true));

  // Attach static modal form handlers
  attachClientFormHandlers();
  attachExerciseFormHandlers();
  attachAddRecordHandlers();

  // Observe add-record modal open to re-attach dynamic handlers
  const addModal = $id('addRecordModal');
  if (addModal) {
    const obs = new MutationObserver(() => {
      if (!addModal.classList.contains('hidden')) {
        attachAddRecordHandlers();
      }
    });
    obs.observe(addModal, { attributes: true, attributeFilter: ['class'] });
  }
}

// Find keypad grid by searching under keypadOverlay
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.key-btn').forEach(btn => {
    btn.addEventListener('click', () => handleKeyInput(btn.dataset.key));
  });
  $id('keypadDone').addEventListener('click', () => closeKeypad(true));
  $id('keypadBackdrop').addEventListener('click', () => closeKeypad(true));
});

/* ═══════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════ */
function init() {
  load();

  const s = App.data.settings;

  // Check if API key is already set (app was previously configured)
  if (s.apiKey) {
    showApp();
    updateHeaderState();
    renderCurrentView();
    startSyncTimer();
    // Try to sync on load
    if (navigator.onLine) setTimeout(syncToServer, 1000);
    else setSyncStatus('offline');
  } else {
    showSetupScreen();
    // Pre-fill URL if stored
    if (s.apiUrl) $id('setupUrl').value = s.apiUrl;
  }

  attachGlobalHandlers();

  // Setup screen connect button
  $id('setupConnectBtn').addEventListener('click', handleSetupConnect);
  $id('setupApiKey').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSetupConnect();
  });

  // Close search results when tapping outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      document.querySelectorAll('.search-results').forEach(r => r.classList.add('hidden'));
    }
  });
}

// Boot
init();
