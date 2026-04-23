// flavor.js — Flavor Sample widget
// Tracks per-pond flavor grades so we know which ponds are Ready to Harvest,
// which are still on resample, and which are off (ranked by severity).
// All data is company-scoped via the JWT on the API side.

var _flavorState = { farmers: [], pond_groups: [], ponds: [], samples: [] };
var _flavorTab = 'dashboard';
var _flavorFarmerFilter = '';      // '' = all farmers
var _flavorSearch = '';
// When a group is in "manage mode" its pond pills expose the ✎ / × buttons for
// individual edit/delete. null = no group is in manage mode.
var _flavorPondManageGroupId = null;
// Set true when this widget is viewing another company's flavor data
// (BFN reading POTP's Battle Fish North farmer). Hides every mutation control.
var _flavorReadonly = false;

// ═══ Grade metadata ═════════════════════════════════════════════════════════
var FLAVOR_GRADES = [
  { key:'off_5',            label:'Off 5',                 short:'Off 5', severity:5, bucket:'off',   color:'#991b1b', bg:'#fee2e2' },
  { key:'off_4',            label:'Off 4',                 short:'Off 4', severity:4, bucket:'off',   color:'#991b1b', bg:'#fee2e2' },
  { key:'off_3',            label:'Off 3',                 short:'Off 3', severity:3, bucket:'off',   color:'#b45309', bg:'#fef3c7' },
  { key:'off_2',            label:'Off 2',                 short:'Off 2', severity:2, bucket:'off',   color:'#b45309', bg:'#fef3c7' },
  { key:'off_1',            label:'Off 1 (barely off)',    short:'Off 1', severity:1, bucket:'off',   color:'#92400e', bg:'#fef3c7' },
  { key:'good_resample_1',  label:'Good — Resample 1st Check',  short:'Good R1',       bucket:'good', color:'#065f46', bg:'#d1fae5' },
  { key:'good_resample_2',  label:'Good — Resample 2nd Check',  short:'Good R2',       bucket:'good', color:'#065f46', bg:'#d1fae5' },
  { key:'good_ready',       label:'Good — Ready to Harvest',    short:'READY',         bucket:'ready',color:'#166534', bg:'#dcfce7' },
  { key:'truck_sample',     label:'Truck Sample (delivery)',    short:'Truck',         bucket:'delivered', color:'#1e40af', bg:'#dbeafe' }
];
function flavorGradeMeta(key){ return FLAVOR_GRADES.find(function(g){return g.key===key;}) || null; }

var WINDOW_DAYS = 14;           // Good window is 14 days from the first Good sample.
var ALERT_THRESHOLD_DAYS = 3;   // Show "expires soon" alert if window ends within this many days.

// ═══ Entry point ════════════════════════════════════════════════════════════
function buildFlavorWidget(){
  var wt = document.getElementById('widget-tabs');
  var wc = document.getElementById('widget-content');
  wc.innerHTML = '<div id="flavor-panel" style="padding:0"></div>';
  // Load state FIRST so we know whether we're in readonly (linked viewer) mode,
  // then build the tab row. Linked viewers skip the Log Sample tab entirely.
  flavorLoadState(function(){
    var tabs = [
      { id:'dashboard', label:'📊 Dashboard' }
    ];
    if (!_flavorReadonly) tabs.push({ id:'log', label:'➕ Log Sample' });
    tabs.push({ id:'manage', label: _flavorReadonly ? '🏡 Farms & Ponds (read-only)' : '🏡 Farms & Ponds' });
    tabs.push({ id:'history', label:'📜 History' });
    wt.innerHTML = tabs.map(function(t){
      return '<button class="wtab" id="ftab-'+t.id+'" onclick="flavorShowTab(\''+t.id+'\')" '
        + 'style="padding:6px 12px;border:none;background:transparent;cursor:pointer;font-size:.78rem;'
        + 'border-bottom:2px solid transparent;color:#94a3b8">'+t.label+'</button>';
    }).join('');
    flavorShowTab('dashboard');
  });
}
window.buildFlavorWidget = buildFlavorWidget;

function flavorShowTab(tab){
  _flavorTab = tab;
  ['dashboard','log','manage','history'].forEach(function(t){
    var b = document.getElementById('ftab-'+t);
    if(!b) return;
    var active = (t===tab);
    b.style.borderBottomColor = active ? '#1a3a6b' : 'transparent';
    b.style.color = active ? '#1a3a6b' : '#94a3b8';
    b.style.fontWeight = active ? '600' : '400';
  });
  try {
    if(tab==='dashboard') flavorRenderDashboard();
    else if(tab==='log') flavorRenderLogForm();
    else if(tab==='manage') flavorRenderManage();
    else if(tab==='history') flavorRenderHistory();
  } catch (err) {
    console.error('[flavor] ' + tab + ' render failed:', err);
    var panel = document.getElementById('flavor-panel');
    if (panel) {
      panel.innerHTML = '<div style="padding:20px;color:#dc2626;font-family:monospace;white-space:pre-wrap;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin:14px">'
        + '<div style="font-weight:700;margin-bottom:8px">Error rendering the ' + tab + ' tab</div>'
        + '<div style="font-size:.82rem">' + (err && err.message ? err.message : String(err)) + '</div>'
        + (err && err.stack ? '<div style="font-size:.72rem;color:#7f1d1d;margin-top:8px;opacity:.7">' + err.stack.split('\n').slice(0, 5).join('<br>') + '</div>' : '')
        + '</div>';
    }
  }
}
window.flavorShowTab = flavorShowTab;

// ═══ Data load ══════════════════════════════════════════════════════════════
function flavorLoadState(cb){
  apiCall('GET','/api/flavor?action=get_state').then(function(d){
    try {
      _flavorReadonly = !!(d && d.readonly);
      _flavorState = {
        farmers: Array.isArray(d && d.farmers) ? d.farmers : [],
        pond_groups: Array.isArray(d && d.pond_groups) ? d.pond_groups : [],
        ponds: Array.isArray(d && d.ponds) ? d.ponds : [],
        samples: Array.isArray(d && d.samples) ? d.samples : []
      };
      // Normalize sample_date into 'YYYY-MM-DD' strings regardless of whether Neon
      // returned them as strings or Date objects — every downstream helper assumes strings.
      _flavorState.samples.forEach(function(s){
        if(s.sample_date instanceof Date) s.sample_date = s.sample_date.toISOString().split('T')[0];
        else if(typeof s.sample_date === 'string' && s.sample_date.length > 10) s.sample_date = s.sample_date.split('T')[0];
      });
    } catch (e) {
      console.error('[flavor] state load failed:', e);
      _flavorState = { farmers: [], pond_groups: [], ponds: [], samples: [] };
    }
    if(cb) cb();
  }).catch(function(e){
    console.error('[flavor] API get_state failed:', e);
    var panel = document.getElementById('flavor-panel');
    if(panel) panel.innerHTML = '<div style="padding:20px;color:#dc2626">Failed to load flavor data: '+ ((e&&e.message)||'unknown') +'</div>';
  });
}
function flavorRefresh(cb){ flavorLoadState(function(){ if(cb) cb(); else flavorShowTab(_flavorTab); }); }

// ═══ Status derivation per pond ════════════════════════════════════════════
// Given all samples for a pond, return the pond's current status + window info.
function derivePondStatus(pondId){
  var pondSamples = _flavorState.samples
    .filter(function(s){ return s.pond_id === pondId; })
    .slice()
    .sort(function(a,b){
      // Date descending, then created_at descending
      if(a.sample_date !== b.sample_date) return a.sample_date < b.sample_date ? 1 : -1;
      return (a.created_at||'') < (b.created_at||'') ? 1 : -1;
    });
  if(pondSamples.length === 0) return { state:'no_sample' };
  var latest = pondSamples[0];
  var meta = flavorGradeMeta(latest.grade);
  if(!meta) return { state:'unknown', latest:latest };

  if(meta.bucket === 'off') {
    return {
      state:'off',
      grade:latest.grade,
      meta:meta,
      latest:latest,
      days_since_sample:daysBetween(latest.sample_date, todayStr())
    };
  }
  if(meta.bucket === 'delivered') {
    return { state:'delivered', grade:latest.grade, meta:meta, latest:latest };
  }
  // Good family — walk oldest-to-newest to find the start of the current Good streak
  var goodSince = null;
  for(var i = pondSamples.length - 1; i >= 0; i--){
    var s = pondSamples[i];
    var m = flavorGradeMeta(s.grade);
    if(!m) continue;
    if(m.bucket === 'off'){ goodSince = null; continue; }
    if(m.bucket === 'good' || m.bucket === 'ready'){
      if(goodSince === null) goodSince = s.sample_date;
    }
  }
  var windowStart = goodSince || latest.sample_date;
  var windowEnd = addDays(windowStart, WINDOW_DAYS);
  var daysLeft = daysBetween(todayStr(), windowEnd); // positive if windowEnd > today
  return {
    state: meta.bucket === 'ready' ? 'ready' : 'in_resample',
    grade: latest.grade,
    meta: meta,
    latest: latest,
    window_start: windowStart,
    window_end: windowEnd,
    days_left: daysLeft,
    expired: daysLeft < 0
  };
}

// ═══ Utility ════════════════════════════════════════════════════════════════
function todayStr(){ return new Date().toISOString().split('T')[0]; }
function addDays(dateStr, n){
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}
function daysBetween(fromStr, toStr){
  var a = new Date(fromStr + 'T00:00:00');
  var b = new Date(toStr + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
function flavorEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function flavorPondLabel(pondId){
  var p = _flavorState.ponds.find(function(x){return x.id===pondId;});
  if(!p) return '?';
  var g = _flavorState.pond_groups.find(function(x){return x.id===p.pond_group_id;});
  var f = g ? _flavorState.farmers.find(function(x){return x.id===g.farmer_id;}) : null;
  var parts = [];
  if(f) parts.push(f.name);
  if(g) parts.push(g.name);
  parts.push(p.number);
  return parts.join(' › ');
}
function flavorFarmerIdForPond(pondId){
  var p = _flavorState.ponds.find(function(x){return x.id===pondId;});
  if(!p) return null;
  var g = _flavorState.pond_groups.find(function(x){return x.id===p.pond_group_id;});
  return g ? g.farmer_id : null;
}

// Reusable button styles
var FB = 'padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:.78rem;font-weight:600';
var FB_P = FB + ';background:#1a3a6b;color:#fff';
var FB_S = FB + ';background:#6366f1;color:#fff';
var FB_SUB = FB + ';background:#f1f5f9;color:#334155';
var FB_D = 'padding:3px 9px;border-radius:5px;border:none;cursor:pointer;font-size:.73rem;background:#fee2e2;color:#b91c1c';
var FINP = 'width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:.83rem;margin-bottom:8px;box-sizing:border-box';

// ═══ Tab: Dashboard ═════════════════════════════════════════════════════════
function flavorRenderDashboard(){
  var panel = document.getElementById('flavor-panel');
  if(!panel) return;

  var statuses = _flavorState.ponds.map(function(p){ return { pond:p, st:derivePondStatus(p.id) }; });

  if(_flavorFarmerFilter){
    statuses = statuses.filter(function(row){ return flavorFarmerIdForPond(row.pond.id) === _flavorFarmerFilter; });
  }
  if(_flavorSearch){
    var q = _flavorSearch.toLowerCase();
    statuses = statuses.filter(function(row){
      return flavorPondLabel(row.pond.id).toLowerCase().indexOf(q) >= 0;
    });
  }

  var ready = statuses.filter(function(r){ return r.st.state==='ready' && !r.st.expired; });
  var inResample = statuses.filter(function(r){ return r.st.state==='in_resample' && !r.st.expired; });
  var expired = statuses.filter(function(r){
    return (r.st.state==='ready' || r.st.state==='in_resample') && r.st.expired;
  });
  var off = statuses.filter(function(r){ return r.st.state==='off'; });

  ready.sort(function(a,b){ return (a.st.days_left||0) - (b.st.days_left||0); });
  inResample.sort(function(a,b){ return (a.st.days_left||0) - (b.st.days_left||0); });
  off.sort(function(a,b){
    var sa = a.st.meta ? a.st.meta.severity : 99;
    var sb = b.st.meta ? b.st.meta.severity : 99;
    if(sa !== sb) return sa - sb;
    return (a.st.latest.sample_date < b.st.latest.sample_date) ? 1 : -1;
  });

  var farmerOptions = '<option value="">All Farmers</option>' + _flavorState.farmers.map(function(f){
    var sel = (f.id === _flavorFarmerFilter) ? ' selected' : '';
    return '<option value="'+flavorEsc(f.id)+'"'+sel+'>'+flavorEsc(f.name)+'</option>';
  }).join('');

  var html = '<div style="padding:14px;max-width:960px;margin:0 auto">';
  if (_flavorReadonly) {
    html += '<div style="background:#dbeafe;border-left:3px solid #1e40af;border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:.78rem;color:#1e40af">'
      + '🔒 <strong>Read-only view</strong> — this data is synced from the owning company (Pride of the Pond). '
      + 'Samples, farmer/pond management, and edits happen on their side. Click a pond to view its full sample history.'
      + '</div>';
  }
  html += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">'
    + (_flavorReadonly ? '' : '<button style="'+FB_P+'" onclick="flavorShowTab(\'log\')">+ Log Sample</button>')
    + '<button style="'+FB_SUB+'" onclick="flavorRefresh()">Refresh</button>'
    + '<select style="'+FINP+';flex:1;min-width:160px;margin-bottom:0" onchange="_flavorFarmerFilter=this.value;flavorRenderDashboard()">'+farmerOptions+'</select>'
    + '<input type="text" placeholder="Search pond…" value="'+flavorEsc(_flavorSearch)+'" oninput="_flavorSearch=this.value;flavorRenderDashboard()" style="'+FINP+';flex:2;min-width:180px;margin-bottom:0">'
    + '</div>';

  if(_flavorState.ponds.length === 0){
    html += '<div style="background:#fff;border-radius:10px;padding:30px;text-align:center;color:#64748b;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + 'No ponds yet. Go to <a href="#" onclick="flavorShowTab(\'manage\');return false" style="color:#2563eb">Farms &amp; Ponds</a> to add your first farmer and ponds.'
      + '</div></div>';
    panel.innerHTML = html;
    return;
  }

  html += flavorRenderSectionWithPills('✅ READY TO HARVEST', '#166534', ready, 'ready', 'No ponds are currently ready to harvest.');
  html += flavorRenderSectionWithPills('🟡 GOOD — IN RESAMPLE PROCESS', '#92400e', inResample, 'resample', 'No ponds in resample.');
  html += flavorRenderSectionWithPills('🔴 OFF PONDS (closest-to-good first)', '#991b1b', off, 'off', 'No ponds are currently off.');
  if(expired.length > 0){
    expired.sort(function(a,b){ return (a.st.days_left||0) - (b.st.days_left||0); });
    html += flavorRenderSectionWithPills('⚠️ WINDOW EXPIRED — NEEDS RETEST', '#991b1b', expired, 'expired', '');
  }

  html += '</div>';
  panel.innerHTML = html;
}

// Buckets a list of {pond, st} rows into a Map keyed by "farmerId|groupId", preserving
// the input order so section-level sort (severity / days_left) carries through.
function flavorGroupByFarmerAndGroup(rows){
  var buckets = [];
  var byKey = {};
  rows.forEach(function(row){
    var pond = row.pond;
    var group = _flavorState.pond_groups.find(function(x){return x.id===pond.pond_group_id;});
    var farmer = group ? _flavorState.farmers.find(function(x){return x.id===group.farmer_id;}) : null;
    var farmerId = farmer ? farmer.id : 'unassigned';
    var groupId = group ? group.id : 'unassigned';
    var key = farmerId + '|' + groupId;
    if(!byKey[key]){
      byKey[key] = {
        farmerName: farmer ? farmer.name : 'Unassigned',
        groupName: group ? group.name : 'Unassigned',
        rows: []
      };
      buckets.push(byKey[key]);
    }
    byKey[key].rows.push(row);
  });
  return buckets;
}

// Renders one dashboard section: header, then a card with pond pills grouped by
// farmer › pond-group. `kind` is one of 'ready' | 'resample' | 'off' | 'expired'
// and controls the pill's tooltip/accent text.
function flavorRenderSectionWithPills(title, color, rows, kind, emptyMsg){
  var html = flavorSectionHeader(title, rows.length, color);
  if(rows.length === 0){
    if(emptyMsg){
      html += '<div style="background:#fff;border-radius:10px;padding:14px;color:#94a3b8;font-size:.84rem;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:16px">'+emptyMsg+'</div>';
    }
    return html;
  }
  var buckets = flavorGroupByFarmerAndGroup(rows);
  html += '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;margin-bottom:16px">';
  buckets.forEach(function(b, idx){
    html += '<div style="padding:10px 14px'+(idx>0?';border-top:1px solid #f1f5f9':'')+'">';
    html += '<div style="font-weight:600;font-size:.82rem;color:#1a3a6b;margin-bottom:6px">'
      + flavorEsc(b.farmerName) + ' <span style="color:#94a3b8;font-weight:400">›</span> '
      + flavorEsc(b.groupName)
      + ' <span style="color:#94a3b8;font-weight:400;font-size:.74rem">('+b.rows.length+' pond'+(b.rows.length===1?'':'s')+')</span></div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
    b.rows.forEach(function(row){ html += flavorDashPill(row, kind); });
    html += '</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// Dashboard pill — same visual style as Farms & Ponds pills. Click opens the
// pond's sample history modal (the modal carries a + Log Sample button).
function flavorDashPill(row, kind){
  var p = row.pond;
  var st = row.st;
  var cellBg = '#fff', cellColor = '#334155', accent = '', extra = '', tooltip = '';
  if(kind === 'ready' || kind === 'resample' || kind === 'expired'){
    if(kind === 'ready'){ cellBg = '#dcfce7'; cellColor = '#166534'; }
    else if(kind === 'resample'){ cellBg = '#fef3c7'; cellColor = '#92400e'; }
    else { cellBg = '#fee2e2'; cellColor = '#991b1b'; }
    if(kind === 'expired'){
      accent = '⚠ ';
      extra = '<span style="font-size:.72rem;font-weight:700;opacity:.85">Expired '+Math.abs(st.days_left)+'d</span>';
      tooltip = 'Expired ' + Math.abs(st.days_left) + ' day' + (Math.abs(st.days_left)===1?'':'s') + ' ago — needs retest';
    } else {
      if(st.days_left <= ALERT_THRESHOLD_DAYS) accent = '🚨 ';
      extra = '<span style="font-size:.72rem;font-weight:700;opacity:.85">'+st.days_left+'d left</span>';
      tooltip = (st.meta ? st.meta.label : '') + ' · ' + st.days_left + ' day' + (st.days_left===1?'':'s') + ' left · last sample ' + (st.latest ? st.latest.sample_date : '');
    }
  } else if(kind === 'off'){
    var sev = st.meta ? st.meta.severity : 3;
    if(sev <= 1){ cellBg = '#fef3c7'; cellColor = '#92400e'; }
    else if(sev <= 2){ cellBg = '#fed7aa'; cellColor = '#9a3412'; }
    else { cellBg = '#fecaca'; cellColor = '#7f1d1d'; }
    extra = '<span style="font-size:.72rem;font-weight:700;opacity:.85">'+(st.meta?st.meta.short:st.grade)+'</span>';
    tooltip = (st.meta ? st.meta.label : '') + ' · sampled ' + (st.latest ? st.latest.sample_date : '') + ' (' + (st.days_since_sample||0) + ' day' + (st.days_since_sample===1?'':'s') + ' ago)';
  }
  return '<span style="background:'+cellBg+';color:'+cellColor+';padding:10px 16px;border-radius:10px;font-size:.88rem;font-weight:600;display:inline-flex;align-items:center;gap:10px;min-width:120px;min-height:44px;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.06);cursor:pointer;transition:transform .08s ease,box-shadow .08s ease"'
    + ' title="'+flavorEsc(tooltip)+' — click for full history"'
    + ' onclick="flavorShowPondHistory(\''+p.id+'\')"'
    + ' onmouseover="this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 4px 8px rgba(0,0,0,.1)\'" onmouseout="this.style.transform=\'\';this.style.boxShadow=\'0 1px 3px rgba(0,0,0,.06)\'">'
    + '<span style="flex:1;white-space:nowrap">'+accent+flavorEsc(p.number)+'</span>'
    + (extra ? '<span style="background:rgba(255,255,255,.55);padding:2px 8px;border-radius:6px">'+extra+'</span>' : '')
    + '</span>';
}

function flavorSectionHeader(title, count, color){
  return '<div style="display:flex;align-items:baseline;justify-content:space-between;margin:10px 0 6px 2px">'
    + '<div style="font-weight:700;font-size:.85rem;color:'+color+';letter-spacing:.02em">'+title+'</div>'
    + '<div style="font-size:.76rem;color:#64748b">'+count+' pond'+(count===1?'':'s')+'</div>'
    + '</div>';
}

function flavorQuickLog(pondId){
  window._flavorPrefillPondId = pondId;
  flavorShowTab('log');
}

// ═══ Tab: Log Sample ════════════════════════════════════════════════════════
function flavorRenderLogForm(){
  var panel = document.getElementById('flavor-panel');
  if(!panel) return;

  var prefillPondId = window._flavorPrefillPondId || '';
  window._flavorPrefillPondId = null;
  var prefillFarmerId = prefillPondId ? flavorFarmerIdForPond(prefillPondId) : '';
  var prefillPond = prefillPondId ? _flavorState.ponds.find(function(x){return x.id===prefillPondId;}) : null;
  var prefillGroupId = prefillPond ? prefillPond.pond_group_id : '';

  var farmerOpts = '<option value="">— Select Farmer —</option>' + _flavorState.farmers.map(function(f){
    return '<option value="'+flavorEsc(f.id)+'"'+(f.id===prefillFarmerId?' selected':'')+'>'+flavorEsc(f.name)+'</option>';
  }).join('');

  var gradeOpts = '<option value="">— Select Grade —</option>' + FLAVOR_GRADES.map(function(g){
    return '<option value="'+flavorEsc(g.key)+'">'+flavorEsc(g.label)+'</option>';
  }).join('');

  var html = '<div style="padding:14px;max-width:560px;margin:0 auto">'
    + '<div style="font-weight:700;font-size:.95rem;margin-bottom:10px">Log a flavor sample</div>'
    + '<div style="background:#f0f7ff;border-left:3px solid #3b82f6;border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:.78rem;color:#1e40af">'
    + 'Pick the farmer, pond group, and pond. If a pond isn\'t in the list yet, add it in the <a href="#" onclick="flavorShowTab(\'manage\');return false" style="color:#2563eb">Farms &amp; Ponds</a> tab first.'
    + '</div>'
    + '<label style="font-size:.78rem;color:#64748b">Farmer</label>'
    + '<select id="fl-farmer" style="'+FINP+'" onchange="flavorLogFarmerChange()">'+farmerOpts+'</select>'
    + '<label style="font-size:.78rem;color:#64748b">Pond Group</label>'
    + '<select id="fl-group" style="'+FINP+'" onchange="flavorLogGroupChange()"></select>'
    + '<label style="font-size:.78rem;color:#64748b">Pond</label>'
    + '<select id="fl-pond" style="'+FINP+'"></select>'
    + '<label style="font-size:.78rem;color:#64748b">Sample Date</label>'
    + '<input type="date" id="fl-date" style="'+FINP+'" value="'+todayStr()+'">'
    + '<label style="font-size:.78rem;color:#64748b">Grade</label>'
    + '<select id="fl-grade" style="'+FINP+'">'+gradeOpts+'</select>'
    + '<label style="font-size:.78rem;color:#64748b">Sampled By (optional)</label>'
    + '<input type="text" id="fl-by" style="'+FINP+'" value="'+flavorEsc((typeof currentUser!=="undefined" && currentUser && currentUser.full_name) || '')+'">'
    + '<label style="font-size:.78rem;color:#64748b">Notes (optional)</label>'
    + '<textarea id="fl-notes" style="'+FINP+';resize:vertical;min-height:60px"></textarea>'
    + '<div id="fl-status" style="margin:8px 0;font-size:.82rem;min-height:18px"></div>'
    + '<div style="display:flex;gap:8px">'
    + '<button style="'+FB_P+';flex:1" onclick="flavorSubmitSample()">Save Sample</button>'
    + '<button style="'+FB_SUB+'" onclick="flavorShowTab(\'dashboard\')">Cancel</button>'
    + '</div></div>';
  panel.innerHTML = html;
  flavorLogFarmerChange();
  if(prefillGroupId) document.getElementById('fl-group').value = prefillGroupId;
  flavorLogGroupChange();
  if(prefillPondId) document.getElementById('fl-pond').value = prefillPondId;
}
function flavorLogFarmerChange(){
  var farmerId = document.getElementById('fl-farmer').value;
  var groups = _flavorState.pond_groups.filter(function(g){ return g.farmer_id === farmerId; });
  var sel = document.getElementById('fl-group');
  sel.innerHTML = '<option value="">— Select Pond Group —</option>' + groups.map(function(g){
    return '<option value="'+flavorEsc(g.id)+'">'+flavorEsc(g.name)+'</option>';
  }).join('');
  flavorLogGroupChange();
}
function flavorLogGroupChange(){
  var groupId = document.getElementById('fl-group').value;
  var ponds = _flavorState.ponds.filter(function(p){ return p.pond_group_id === groupId; });
  var sel = document.getElementById('fl-pond');
  sel.innerHTML = '<option value="">— Select Pond —</option>' + ponds.map(function(p){
    return '<option value="'+flavorEsc(p.id)+'">'+flavorEsc(p.number)+'</option>';
  }).join('');
}
window.flavorLogFarmerChange = flavorLogFarmerChange;
window.flavorLogGroupChange = flavorLogGroupChange;

function flavorSubmitSample(){
  var pond_id = document.getElementById('fl-pond').value;
  var grade = document.getElementById('fl-grade').value;
  var sample_date = document.getElementById('fl-date').value || todayStr();
  var sampled_by = document.getElementById('fl-by').value;
  var notes = document.getElementById('fl-notes').value;
  var status = document.getElementById('fl-status');
  if(!pond_id){ status.style.color='#dc2626'; status.textContent='Pick a pond.'; return; }
  if(!grade){ status.style.color='#dc2626'; status.textContent='Pick a grade.'; return; }
  status.style.color='#64748b';
  status.innerHTML='<div class="spinner-wrap" style="display:inline-block;vertical-align:middle"><div class="spinner"></div></div> Saving…';
  apiCall('POST','/api/flavor?action=save_sample', { pond_id:pond_id, grade:grade, sample_date:sample_date, sampled_by:sampled_by, notes:notes })
    .then(function(){
      status.style.color='#166534';
      status.textContent='✓ Saved.';
      flavorRefresh();
      setTimeout(function(){ flavorShowTab('dashboard'); }, 600);
    })
    .catch(function(e){
      status.style.color='#dc2626';
      status.textContent='Save failed: ' + ((e&&e.message)||'unknown');
    });
}
window.flavorSubmitSample = flavorSubmitSample;

// ═══ Tab: Manage Farms & Ponds ══════════════════════════════════════════════
function flavorRenderManage(){
  var panel = document.getElementById('flavor-panel');
  if(!panel) return;
  var html = '<div style="padding:14px;max-width:820px;margin:0 auto">';
  if (_flavorReadonly) {
    html += '<div style="background:#dbeafe;border-left:3px solid #1e40af;border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:.78rem;color:#1e40af">'
      + '🔒 <strong>Read-only</strong> — this is a synced view of the owning company\'s farms and ponds. '
      + 'Click any pond pill to see its sample history.'
      + '</div>';
  }
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-weight:700;font-size:.95rem">Farms &amp; Ponds</div>'
    + (_flavorReadonly ? '' : '<button style="'+FB_P+'" onclick="flavorAddFarmer()">+ Add Farmer</button>')
    + '</div>';
  if(_flavorState.farmers.length === 0){
    html += '<div style="background:#fff;border-radius:10px;padding:20px;text-align:center;color:#94a3b8;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + (_flavorReadonly ? 'No ponds have been synced for your company yet.' : 'No farmers yet. Click <strong>+ Add Farmer</strong> to get started.')
      + '</div>';
  }
  _flavorState.farmers.forEach(function(f){
    var groups = _flavorState.pond_groups.filter(function(g){return g.farmer_id===f.id;});
    html += '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:12px;overflow:hidden">'
      + '<div style="padding:10px 14px;background:#1a3a6b;color:#fff;display:flex;justify-content:space-between;align-items:center">'
      + '<div style="font-weight:700;font-size:.9rem">🏡 '+flavorEsc(f.name)+'</div>'
      + (_flavorReadonly ? '' :
         '<div style="display:flex;gap:6px">'
         + '<button style="'+FB_SUB+';padding:3px 9px;font-size:.72rem" onclick="flavorAddPondGroup(\''+f.id+'\')">+ Pond Group</button>'
         + '<button style="'+FB_SUB+';padding:3px 9px;font-size:.72rem" onclick="flavorEditFarmer(\''+f.id+'\')">Edit</button>'
         + '<button style="'+FB_D+'" onclick="flavorDeleteFarmer(\''+f.id+'\')">Del</button>'
         + '</div>')
      + '</div>';
    if(groups.length === 0){
      html += '<div style="padding:12px 14px;color:#94a3b8;font-size:.82rem">No pond groups yet.</div>';
    }
    groups.forEach(function(g){
      var ponds = _flavorState.ponds.filter(function(p){return p.pond_group_id===g.id;});
      var inManageMode = (_flavorPondManageGroupId === g.id);
      html += '<div style="padding:10px 14px;border-top:1px solid #f1f5f9">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;flex-wrap:wrap">'
        + '<div style="font-weight:600;font-size:.84rem;color:#334155">📍 '+flavorEsc(g.name)+' <span style="color:#94a3b8;font-weight:400;font-size:.76rem">('+ponds.length+' pond'+(ponds.length===1?'':'s')+')</span>'
          + (inManageMode ? ' <span style="background:#fef3c7;color:#92400e;padding:1px 8px;border-radius:10px;font-size:.66rem;font-weight:700;margin-left:4px">MANAGE MODE</span>' : '')
          + '</div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap">';
      if (_flavorReadonly) {
        // No buttons — pure read-only view
      } else if(inManageMode){
        html += '<button style="'+FB_P+';padding:3px 12px;font-size:.72rem" onclick="flavorExitPondManageMode()">✓ Done</button>';
      } else {
        html += '<button style="'+FB_SUB+';padding:3px 9px;font-size:.7rem" onclick="flavorAddPond(\''+g.id+'\')">+ Pond</button>'
          + '<button style="'+FB_SUB+';padding:3px 9px;font-size:.7rem" onclick="flavorBulkAddPonds(\''+g.id+'\')">Bulk Add</button>'
          + '<button style="'+FB_SUB+';padding:3px 9px;font-size:.7rem" onclick="flavorEditPondGroup(\''+g.id+'\')">Rename</button>'
          + '<button style="'+FB_D+'" onclick="flavorPondDeleteMenu(\''+g.id+'\')">Del</button>';
      }
      html += '</div></div>';
      if(ponds.length > 0){
        // Natural-numeric sort so "2 North" precedes "10 North".
        var sortedPonds = ponds.slice().sort(function(a, b){
          return String(a.number).localeCompare(String(b.number), undefined, { numeric:true, sensitivity:'base' });
        });
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
        sortedPonds.forEach(function(p){
          var st = derivePondStatus(p.id);
          var cellBg = '#fff', cellColor = '#334155', accent = '', tooltip = 'No sample yet';
          if(st.state === 'ready'){
            cellBg = '#dcfce7'; cellColor = '#166534';
            tooltip = 'Ready to Harvest · ' + (st.days_left>=0 ? st.days_left+' days left' : 'expired');
            if(st.days_left <= ALERT_THRESHOLD_DAYS && st.days_left >= 0) accent = '🚨 ';
            if(st.expired){ cellBg = '#fee2e2'; cellColor = '#991b1b'; accent = '⚠ '; tooltip = 'Window expired — needs retest'; }
          } else if(st.state === 'in_resample'){
            cellBg = '#fef3c7'; cellColor = '#92400e';
            tooltip = (st.meta ? st.meta.label : 'In Resample') + ' · ' + (st.days_left>=0 ? st.days_left+' days left' : 'expired');
            if(st.days_left <= ALERT_THRESHOLD_DAYS && st.days_left >= 0) accent = '🚨 ';
            if(st.expired){ cellBg = '#fee2e2'; cellColor = '#991b1b'; accent = '⚠ '; tooltip = 'Window expired — needs retest'; }
          } else if(st.state === 'off'){
            var sev = st.meta ? st.meta.severity : 3;
            if(sev <= 1){ cellBg = '#fef3c7'; cellColor = '#92400e'; }
            else if(sev <= 2){ cellBg = '#fed7aa'; cellColor = '#9a3412'; }
            else { cellBg = '#fecaca'; cellColor = '#7f1d1d'; }
            tooltip = (st.meta ? st.meta.label : 'Off') + ' · ' + (st.days_since_sample||0) + 'd ago';
          } else if(st.state === 'delivered'){
            cellBg = '#dbeafe'; cellColor = '#1e40af';
            tooltip = 'Truck Sample · ' + (st.latest ? st.latest.sample_date : '');
          }
          // Pill: rounded, status-colored. Click the pill itself to quick-log a sample.
          // In manage mode the ✎ / × buttons appear; otherwise they're hidden.
          // Rounded-rectangle pill: larger, more readable, still color-coded.
          // Click → quick-log a sample normally, OR open history when in readonly mode.
          var pillClickHandler = _flavorReadonly
            ? ('flavorShowPondHistory(\''+p.id+'\')')
            : ('flavorQuickLog(\''+p.id+'\')');
          var pillTooltipSuffix = _flavorReadonly
            ? ' — click to view sample history'
            : (inManageMode ? '' : ' — click to log a sample');
          html += '<span style="background:'+cellBg+';color:'+cellColor+';padding:10px 16px;border-radius:10px;font-size:.88rem;font-weight:600;display:inline-flex;align-items:center;gap:8px;min-width:100px;min-height:44px;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.06);cursor:'+((inManageMode&&!_flavorReadonly)?'default':'pointer')+';transition:transform .08s ease,box-shadow .08s ease" title="'+flavorEsc(tooltip)+pillTooltipSuffix+'"'
            + ((inManageMode && !_flavorReadonly) ? '' : ' onclick="'+pillClickHandler+'" onmouseover="this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 4px 8px rgba(0,0,0,.1)\'" onmouseout="this.style.transform=\'\';this.style.boxShadow=\'0 1px 3px rgba(0,0,0,.06)\'"')
            + '>'
            + '<span style="flex:1;white-space:nowrap">'+accent+flavorEsc(p.number)+'</span>';
          if(inManageMode && !_flavorReadonly){
            html += '<button title="Rename pond" style="background:rgba(255,255,255,.6);border:none;cursor:pointer;color:'+cellColor+';font-size:.82rem;padding:3px 8px;border-radius:6px;font-weight:700" onclick="event.stopPropagation();flavorEditPond(\''+p.id+'\')">✎</button>'
              + '<button title="Delete pond" style="background:rgba(255,255,255,.6);border:none;cursor:pointer;color:#991b1b;font-size:1.05rem;padding:1px 8px;border-radius:6px;font-weight:700;line-height:1" onclick="event.stopPropagation();flavorDeletePond(\''+p.id+'\')">×</button>';
          }
          html += '</span>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  });
  html += '</div>';
  panel.innerHTML = html;
}

function flavorAddFarmer(){
  var name = prompt('Farmer name (e.g., Battle Fish North):');
  if(!name) return;
  apiCall('POST','/api/flavor?action=save_farmer', { name:name.trim() })
    .then(function(){ flavorRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
function flavorEditFarmer(id){
  var f = _flavorState.farmers.find(function(x){return x.id===id;});
  if(!f) return;
  var newName = prompt('Farmer name:', f.name);
  if(!newName) return;
  apiCall('POST','/api/flavor?action=save_farmer', { id:id, name:newName.trim(), notes:f.notes||'' })
    .then(function(){ flavorRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
function flavorDeleteFarmer(id){
  var f = _flavorState.farmers.find(function(x){return x.id===id;});
  if(!f) return;
  if(!confirm('Archive "'+f.name+'" and all of its pond groups/ponds?\n\nSample history is preserved; this hides the farmer from active lists.')) return;
  apiCall('POST','/api/flavor?action=delete_farmer', { id:id })
    .then(function(){ flavorRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}

function flavorAddPondGroup(farmerId){
  var name = prompt('Pond group name (e.g., New Ponds, Denton, Hurt Place):');
  if(!name) return;
  apiCall('POST','/api/flavor?action=save_pond_group', { farmer_id:farmerId, name:name.trim() })
    .then(function(){ flavorRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
function flavorEditPondGroup(id){
  var g = _flavorState.pond_groups.find(function(x){return x.id===id;});
  if(!g) return;
  var newName = prompt('Pond group name:', g.name);
  if(!newName) return;
  apiCall('POST','/api/flavor?action=save_pond_group', { id:id, name:newName.trim(), farmer_id:g.farmer_id, notes:g.notes||'' })
    .then(function(){ flavorRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
function flavorDeletePondGroup(id){
  var g = _flavorState.pond_groups.find(function(x){return x.id===id;});
  if(!g) return;
  if(!confirm('Archive pond group "'+g.name+'" and all of its ponds?')) return;
  apiCall('POST','/api/flavor?action=delete_pond_group', { id:id })
    .then(function(){ flavorRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}

function flavorAddPond(groupId){
  var num = prompt('Pond number/name (e.g., "1 North", "4 South", "P27"):');
  if(!num) return;
  apiCall('POST','/api/flavor?action=save_pond', { pond_group_id:groupId, number:num.trim() })
    .then(function(){ flavorRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
function flavorBulkAddPonds(groupId){
  var raw = prompt('Paste pond numbers separated by commas or new lines\n\nExample:\n1 North, 1 South, 2 East, 2 Middle, 2 West, 3 North, 3 South');
  if(!raw) return;
  var numbers = raw.split(/[,\n]/).map(function(s){return s.trim();}).filter(Boolean);
  if(numbers.length === 0) return;
  apiCall('POST','/api/flavor?action=bulk_add_ponds', { pond_group_id:groupId, numbers:numbers })
    .then(function(r){
      var msg = 'Added ' + (r.created||0) + ' pond' + (r.created===1?'':'s') + '.';
      if(r.skipped) msg += '\nSkipped ' + r.skipped + ' already in this group.';
      alert(msg);
      flavorRefresh();
    })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
function flavorEditPond(id){
  var p = _flavorState.ponds.find(function(x){return x.id===id;});
  if(!p) return;
  var newNum = prompt('Pond number/name:', p.number);
  if(!newNum) return;
  apiCall('POST','/api/flavor?action=save_pond', { id:id, pond_group_id:p.pond_group_id, number:newNum.trim(), acres:p.acres, notes:p.notes||'' })
    .then(function(){ flavorRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
function flavorDeletePond(id){
  var p = _flavorState.ponds.find(function(x){return x.id===id;});
  if(!p) return;
  if(!confirm('Archive pond "'+p.number+'"?\n\nSample history is preserved.')) return;
  apiCall('POST','/api/flavor?action=delete_pond', { id:id })
    .then(function(){ flavorRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}

window.flavorAddFarmer = flavorAddFarmer;
window.flavorEditFarmer = flavorEditFarmer;
window.flavorDeleteFarmer = flavorDeleteFarmer;
window.flavorAddPondGroup = flavorAddPondGroup;
window.flavorEditPondGroup = flavorEditPondGroup;
window.flavorDeletePondGroup = flavorDeletePondGroup;
window.flavorAddPond = flavorAddPond;
window.flavorBulkAddPonds = flavorBulkAddPonds;
window.flavorEditPond = flavorEditPond;
window.flavorDeletePond = flavorDeletePond;
window.flavorQuickLog = flavorQuickLog;
window.flavorRefresh = flavorRefresh;

// ═══ Pond deletion menu (per pond group) ═══════════════════════════════════
// Click the Del button at the top of a pond group → modal with three choices:
// "Delete one pond" (enters manage mode), "Delete all ponds" (bulk), or Cancel.
function flavorPondDeleteMenu(groupId){
  var g = _flavorState.pond_groups.find(function(x){return x.id===groupId;});
  if(!g) return;
  var pondCount = _flavorState.ponds.filter(function(p){return p.pond_group_id===groupId;}).length;
  var overlay = document.createElement('div');
  overlay.id = 'fpdm-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:18px 20px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">'
    + '<div style="font-weight:700;font-size:.95rem;margin-bottom:4px">Delete ponds in ' + flavorEsc(g.name) + '</div>'
    + '<div style="font-size:.78rem;color:#64748b;margin-bottom:14px">' + pondCount + ' pond' + (pondCount===1?'':'s') + ' in this group</div>'
    + '<button style="'+FB_SUB+';width:100%;padding:10px 12px;margin-bottom:6px;text-align:left" onclick="flavorStartPondManageMode(\''+groupId+'\')">✎ Delete one pond at a time <span style="color:#94a3b8;font-weight:400;font-size:.72rem">(shows ✎ / × on each pill)</span></button>'
    + '<button style="'+FB_SUB+';width:100%;padding:10px 12px;margin-bottom:6px;text-align:left;color:#991b1b" onclick="flavorDeleteAllPondsInGroup(\''+groupId+'\')">🗑️ Delete all ' + pondCount + ' pond' + (pondCount===1?'':'s') + ' <span style="color:#94a3b8;font-weight:400;font-size:.72rem">(keeps the group, clears its ponds)</span></button>'
    + '<button style="'+FB_SUB+';width:100%;padding:8px 12px;margin-top:6px" onclick="flavorCloseDeleteMenu()">Cancel</button>'
    + '</div>';
  overlay.onclick = function(e){ if(e.target===overlay) flavorCloseDeleteMenu(); };
  document.body.appendChild(overlay);
}
function flavorCloseDeleteMenu(){
  var o = document.getElementById('fpdm-overlay');
  if(o) o.remove();
}
function flavorStartPondManageMode(groupId){
  flavorCloseDeleteMenu();
  _flavorPondManageGroupId = groupId;
  flavorRenderManage();
}
function flavorExitPondManageMode(){
  _flavorPondManageGroupId = null;
  flavorRenderManage();
}
function flavorDeleteAllPondsInGroup(groupId){
  flavorCloseDeleteMenu();
  var g = _flavorState.pond_groups.find(function(x){return x.id===groupId;});
  var count = _flavorState.ponds.filter(function(p){return p.pond_group_id===groupId;}).length;
  if(count === 0){ alert('No ponds to delete.'); return; }
  if(!confirm('Delete all ' + count + ' pond' + (count===1?'':'s') + ' from "' + (g?g.name:'this group') + '"?\n\nThe group itself stays. Sample history on each pond is preserved but the pond is archived.')) return;
  apiCall('POST','/api/flavor?action=delete_all_ponds_in_group', { pond_group_id:groupId })
    .then(function(r){
      alert('Deleted ' + (r.deleted||0) + ' pond' + (r.deleted===1?'':'s') + '.');
      _flavorPondManageGroupId = null;
      flavorRefresh();
    })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
window.flavorPondDeleteMenu = flavorPondDeleteMenu;
window.flavorCloseDeleteMenu = flavorCloseDeleteMenu;
window.flavorStartPondManageMode = flavorStartPondManageMode;
window.flavorExitPondManageMode = flavorExitPondManageMode;
window.flavorDeleteAllPondsInGroup = flavorDeleteAllPondsInGroup;

// ═══ Tab: History ═══════════════════════════════════════════════════════════
function flavorRenderHistory(){
  var panel = document.getElementById('flavor-panel');
  if(!panel) return;

  var farmerOptions = '<option value="">All Farmers</option>' + _flavorState.farmers.map(function(f){
    var sel = (f.id === _flavorFarmerFilter) ? ' selected' : '';
    return '<option value="'+flavorEsc(f.id)+'"'+sel+'>'+flavorEsc(f.name)+'</option>';
  }).join('');

  var samples = _flavorState.samples.slice();
  if(_flavorFarmerFilter){
    samples = samples.filter(function(s){ return flavorFarmerIdForPond(s.pond_id) === _flavorFarmerFilter; });
  }
  if(_flavorSearch){
    var q = _flavorSearch.toLowerCase();
    samples = samples.filter(function(s){ return flavorPondLabel(s.pond_id).toLowerCase().indexOf(q) >= 0; });
  }

  var html = '<div style="padding:14px;max-width:960px;margin:0 auto">'
    + '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">'
    + '<div style="font-weight:700;font-size:.95rem;margin-right:auto">Sample History (last 120 days)</div>'
    + '<select style="'+FINP+';flex:1;min-width:160px;max-width:240px;margin-bottom:0" onchange="_flavorFarmerFilter=this.value;flavorRenderHistory()">'+farmerOptions+'</select>'
    + '<input type="text" placeholder="Search pond…" value="'+flavorEsc(_flavorSearch)+'" oninput="_flavorSearch=this.value;flavorRenderHistory()" style="'+FINP+';flex:2;min-width:180px;max-width:320px;margin-bottom:0">'
    + '</div>';

  if(samples.length === 0){
    html += '<div style="background:#fff;border-radius:10px;padding:20px;text-align:center;color:#94a3b8;box-shadow:0 1px 4px rgba(0,0,0,.08)">No samples match the filter.</div>';
  } else {
    html += '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow-x:auto">'
      + '<table style="width:100%;font-size:.78rem;border-collapse:collapse"><thead><tr style="background:#1a3a6b;color:#fff">'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600">Date</th>'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600">Pond</th>'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600">Grade</th>'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600">Sampled By</th>'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600">Notes</th>'
      + '<th style="padding:8px 10px"></th>'
      + '</tr></thead><tbody>';
    samples.forEach(function(s){
      var meta = flavorGradeMeta(s.grade);
      var badge = meta ? ('<span style="background:'+meta.bg+';color:'+meta.color+';padding:2px 8px;border-radius:10px;font-size:.68rem;font-weight:600">'+flavorEsc(meta.label)+'</span>') : flavorEsc(s.grade);
      html += '<tr style="border-bottom:1px solid #f1f5f9">'
        + '<td style="padding:6px 10px;white-space:nowrap">'+flavorEsc(s.sample_date)+'</td>'
        + '<td style="padding:6px 10px">'+flavorEsc(flavorPondLabel(s.pond_id))+'</td>'
        + '<td style="padding:6px 10px">'+badge+'</td>'
        + '<td style="padding:6px 10px;color:#64748b">'+flavorEsc(s.sampled_by||'')+'</td>'
        + '<td style="padding:6px 10px;color:#64748b">'+flavorEsc(s.notes||'')+'</td>'
        + '<td style="padding:6px 10px;text-align:right">'
          + (_flavorReadonly ? '<span style="color:#94a3b8;font-size:.72rem">—</span>' : '<button style="'+FB_D+'" onclick="flavorDeleteSample(\''+s.id+'\')">Del</button>')
        + '</td>'
        + '</tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';
  panel.innerHTML = html;
}

function flavorDeleteSample(id){
  if(!confirm('Delete this sample?')) return;
  apiCall('POST','/api/flavor?action=delete_sample', { id:id })
    .then(function(){ flavorRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
window.flavorDeleteSample = flavorDeleteSample;

// Pond history modal
function flavorShowPondHistory(pondId){
  var overlay = document.createElement('div');
  overlay.id = 'fph-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:20px;max-width:640px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)"><div id="fph-body">Loading…</div></div>';
  overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };
  document.body.appendChild(overlay);
  apiCall('POST','/api/flavor?action=get_pond_history',{ pond_id:pondId }).then(function(r){
    var samples = Array.isArray(r.samples) ? r.samples : [];
    var body = document.getElementById('fph-body');
    var label = flavorPondLabel(pondId);
    // Show the pond's current status as a chip in the header too
    var st = derivePondStatus(pondId);
    var statusChip = '';
    if(st && st.meta){
      statusChip = '<span style="background:'+st.meta.bg+';color:'+st.meta.color+';padding:3px 10px;border-radius:10px;font-size:.72rem;font-weight:700;margin-left:8px">'+flavorEsc(st.meta.label)+'</span>';
    }
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">'
      + '<div style="flex:1;min-width:180px">'
      + '<div style="font-weight:700;font-size:1rem">'+flavorEsc(label)+statusChip+'</div>'
      + '<div style="font-size:.76rem;color:#64748b;margin-top:3px">'+samples.length+' sample'+(samples.length===1?'':'s')+' on record</div>'
      + '</div>'
      + '<div style="display:flex;gap:6px">'
      + (_flavorReadonly ? '' : '<button style="'+FB_P+'" onclick="flavorCloseHistoryAndLog(\''+pondId+'\')">+ Log Sample</button>')
      + '<button style="'+FB_SUB+'" onclick="flavorCloseHistory()">Close</button>'
      + '</div></div>';
    if(samples.length === 0){
      h += '<div style="padding:20px;text-align:center;color:#94a3b8;background:#f8fafc;border-radius:8px">'
        + (_flavorReadonly ? 'No sample history for this pond yet.' : 'No sample history for this pond yet. Click <strong>+ Log Sample</strong> to add the first one.')
        + '</div>';
    } else {
      h += '<div style="max-height:55vh;overflow-y:auto;border:1px solid #f1f5f9;border-radius:8px">';
      samples.forEach(function(s){
        var meta = flavorGradeMeta(s.grade);
        var badge = meta ? ('<span style="background:'+meta.bg+';color:'+meta.color+';padding:2px 8px;border-radius:10px;font-size:.68rem;font-weight:600;white-space:nowrap">'+flavorEsc(meta.short)+'</span>') : flavorEsc(s.grade);
        h += '<div style="padding:8px 10px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px">'
          + '<div style="font-size:.78rem;color:#64748b;min-width:90px">'+s.sample_date+'</div>'
          + badge
          + '<div style="flex:1;font-size:.76rem;color:#334155">'+flavorEsc(s.sampled_by||'')+ (s.notes?' · <span style="color:#64748b">'+flavorEsc(s.notes)+'</span>':'') +'</div>'
          + '</div>';
      });
      h += '</div>';
    }
    body.innerHTML = h;
  }).catch(function(e){
    var b = document.getElementById('fph-body');
    if(b) b.innerHTML = '<div style="color:#dc2626">Error: '+((e&&e.message)||'unknown')+'</div>';
  });
}
function flavorCloseHistory(){
  var o = document.getElementById('fph-overlay');
  if(o) o.remove();
}
function flavorCloseHistoryAndLog(pondId){
  flavorCloseHistory();
  flavorQuickLog(pondId);
}
window.flavorShowPondHistory = flavorShowPondHistory;
window.flavorCloseHistory = flavorCloseHistory;
window.flavorCloseHistoryAndLog = flavorCloseHistoryAndLog;
