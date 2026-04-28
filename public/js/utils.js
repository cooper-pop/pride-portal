// utils.js - Global state and shared utilities

// ── STATE ───────────────────────────────────────────────────────────────────
var currentUser = null;
var authToken = null;
var currentCompany = null; // 'potp' | 'bfn'
var aiHistory = [];

var COMPANIES = {
  bfn: { name:'Battle Fish North', slug:'battle-fish-north', logo:'/images/bfn-logo.jpg', color:'#1a3a5c' },
  potp: { name:'Pride of the Pond', slug:'pride-of-the-pond', logo:'https://i.postimg.cc/jjT8VwcZ/Pride-of-the-Pond-New.jpg', color:'#1a3a6b' },
};

// ── API HELPERS ──────────────────────────────────────────────────────────────

async function apiCall(method, path, body) {
  var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
  if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(path, opts);
  var data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function setSyncBadge(s) {
  ['sync-badge','sync-badge-widget'].forEach(function(id){
    var b = document.getElementById(id);
    if (!b) return;
    b.className = 'sync-badge ' + s;
    b.textContent = s==='synced'?'💾 Saved':s==='syncing'?'⏳ Saving...':'⚠️ Error';
    b.style.display = 'block';
  });
}

function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2500);
}

// ═══ RBAC — mirrors api/_permissions.js ════════════════════════════════════
// Keep this table in sync with api/_permissions.js · WIDGET_PERMS so the UI
// filters match what the backend will allow. The backend is the authority —
// this is only for UX (hide buttons / tabs the user can't use).
var ROLE_LEVELS = { supervisor: 1, manager: 2, admin: 3 };
var WIDGET_PERMS = {
  bids:      { view:'manager',    create:'manager',    edit:'manager',    delete:'manager' },
  yield:     { view:'supervisor', create:'supervisor', edit:'manager',    delete:'manager' },
  trimmer:   { view:'supervisor', create:'supervisor', edit:'manager',    delete:'manager' },
  injection: { view:'supervisor', create:'supervisor', edit:'manager',    delete:'manager' },
  flavor:        { view:'supervisor', create:'supervisor', edit:'manager', delete:'manager' },
  fishschedule:  { view:'supervisor', create:'manager',    edit:'manager', delete:'manager' },
  production:    { view:'supervisor', create:'manager',    edit:'manager', delete:'manager' },
  // Employee Schedule — supervisors view, managers edit teams/shifts.
  staffschedule: { view:'supervisor', create:'manager',    edit:'manager', delete:'manager' },
  // Production Report (Phase C) — read-only dashboard. Manager+ only because
  // it surfaces farmer pricing + payables that supervisors shouldn't see.
  productionreport: { view:'manager' },
  parts:         { view:'supervisor', create:'supervisor', edit:'manager', delete:'manager' },
  todo:      { view:'supervisor', create:'supervisor', edit:'manager',    delete:'manager' },
  ai:        { view:'manager',    create:'manager',    edit:'manager',    delete:'manager' },
  contracts: { view:'manager',    create:'admin',      edit:'admin',      delete:'admin',   ask:'manager' },
  settings:  { view:'admin',      create:'admin',      edit:'admin',      delete:'admin' }
};
// Returns true if the current user can perform `action` on `widget`.
function userCan(widget, action) {
  if (!currentUser) return false;
  var userLevel = ROLE_LEVELS[currentUser.role] || 0;
  var perms = WIDGET_PERMS[widget];
  if (!perms) return userLevel >= ROLE_LEVELS.admin;
  var required = perms[action];
  if (!required) return userLevel >= ROLE_LEVELS.admin;
  return userLevel >= (ROLE_LEVELS[required] || 99);
}
window.userCan = userCan;

// Widget constants
// ── STATE ───────────────────────────────────────────────────────────────────
var currentUser = null;
var authToken = null;
var currentCompany = null; // 'potp' | 'bfn'
var aiHistory = [];

// ── STATE ───────────────────────────────────────────────────────────────────
var currentUser = null;
var authToken = null;
var currentCompany = null; // 'potp' | 'bfn'
var aiHistory = [];

// Shared widget constants

// ── STATE ───────────────────────────────────────────────────────────────────
var currentUser = null;

// ── STATE ───────────────────────────────────────────────────────────────────
var currentUser = null;

// Yield widget globals
var ALL_LINES = ['Line 1','Line 2','Line 3','Line 4','Gut/Whole'];
var yActiveTrend = ALL_LINES.slice();
var yCharts = {};

// Injection widget globals
var INJ_CAT_LABELS={fillets:'Fillets',splits:'Splits',deepskin:'Deepskin Fillets',strips:'Premium Strips',wholefish:'Whole Fish',nuggets:'Nuggets',steaks:'Steaks',bites:'Bites'};

// Inter-function globals from original source
// ══════════════════════════════════════════════════════════════════════════════
// YIELD CALCULATOR
// ══════════════════════════════════════════════════════════════════════════════
var LINE_COLORS = {'Line 1':'#1a3a6b','Line 2':'#c0392b','Line 3':'#1d9e75','Line 4':'#e67e22','Gut/Whole':'#8e44ad'};
var ALL_LINES = ['Line 1','Line 2','Line 3','Line 4','Gut/Whole'];
var yActiveTrend = ALL_LINES.slice();
var yCharts = {};

// ══════════════════════════════════════════════════════════════════════════════
// INJECTION CALCULATOR
// ══════════════════════════════════════════════════════════════════════════════
var INJ_PRODUCTS={fillets:['2-3 oz','3-4 oz','4-5 oz','4.5-5.5 oz','5-6 oz','6-7 oz','7-9 oz','9-11 oz','11+ oz'],splits:['2-3 oz','3-4 oz','4-5 oz','4.5-5.5 oz','5-6 oz','6-7 oz','7-9 oz','9-11 oz','11+ oz'],deepskin:['7-9 oz Deepskin Fillet','11-13 oz Deepskin Fillet'],strips:['Premium Strips'],wholefish:['3-5 oz','5-7 oz','7-9 oz','9-11 oz','13-15 oz','15-17 oz'],nuggets:['Nuggets'],steaks:['Steaks'],bites:['Bites']};
var INJ_CAT_LABELS={fillets:'Fillets',splits:'Splits',deepskin:'Deepskin Fillets',strips:'Premium Strips',wholefish:'Whole Fish',nuggets:'Nuggets',steaks:'Steaks',bites:'Bites'};
var INJ_STEPS=[{id:'soak',label:'Soak',icon:'🪣',inLbl:'Beginning Weight',outLbl:'Finished Weight',cls:'step-soak'},{id:'inj',label:'Injection',icon:'💉',inLbl:'Incoming Weight',outLbl:'Outgoing Weight',cls:'step-inj'},{id:'dehy',label:'Dehydration',icon:'🌡️',inLbl:'Incoming Weight',outLbl:'Finished Weight',cls:'step-dehy'},{id:'glaze',label:'Glaze',icon:'✨',inLbl:'Incoming Weight',outLbl:'Outgoing Weight',cls:'step-glaze'}];

// ══════════════════════════════════════════════════════════════════════════════
// TRIMMER LOG
// ============================================================
var trimRows = [];
var trimDeletedIds = new Set();
var trimCharts = {};