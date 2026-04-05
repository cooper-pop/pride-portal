// yield.js - Yield Calculator widget

function buildYieldWidget() {
  document.getElementById('widget-tabs').innerHTML = ['⚖️ Yield Calc','📋 Records','📈 Trends'].map(function(t,i){
    return '<div class="widget-tab'+(i===0?' active':'')+'" onclick="yShowTab('+i+')">'+t+'</div>';
  }).join('');
  yShowTab(0);
}

function yShowTab(idx) {
  document.querySelectorAll('.widget-tab').forEach(function(t,i){ t.classList.toggle('active',i===idx); });
  if (idx===0) yRenderCalc(); else if (idx===1) yRenderLog(); else yRenderTrends();
}

function yRenderCalc() {
  var nd = new Date();
  document.getElementById('widget-content').innerHTML =
    '<div class="wcard"><h3>📅 Date</h3><div class="wrow"><div class="wfield"><label>Date</label><input type="date" id="y-date" value="'+nd.toISOString().split('T')[0]+'"/></div><div class="wfield"><label>Shift</label><select id="y-shift"><option>AM</option><option>PM</option></select></div></div></div>' +
    '<div class="wcard"><h3>🏭 Production Line</h3><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">'+ALL_LINES.map(function(l){ return '<label class="line-btn"><input type="radio" name="yline" value="'+l+'"> '+l+'</label>'; }).join('')+'</div></div>' +
    '<div class="wcard"><h3>🐟 Processing Weights</h3><div class="wlabel">Starting Weight</div><div class="wrow"><div class="wfield"><label>Live Fish (lbs)</label><input type="number" id="y-live" placeholder="0.00" step="0.01" oninput="yCalc()"/></div></div><div class="wlabel">Processing Stages</div><div class="wrow"><div class="wfield"><label>Headed & Gutted (lbs)</label><input type="number" id="y-hg" placeholder="0.00" step="0.01" oninput="yCalc()"/><span class="ybadge" id="y-hg-pct">—</span></div><div class="wfield"><label>Filleted (lbs)</label><input type="number" id="y-fillet" placeholder="0.00" step="0.01" oninput="yCalc()"/><span class="ybadge" id="y-fillet-pct">—</span></div></div><div class="wrow"><div class="wfield"><label>Trimmed Total (lbs)</label><input type="number" id="y-trim" placeholder="0.00" step="0.01" oninput="yCalc()"/><span class="ybadge" id="y-trim-pct">—</span></div></div></div>' +
    '<div class="wcard"><h3>📝 Notes</h3><div class="wfield"><textarea id="y-notes" placeholder="Describe any issues or events..."></textarea></div><div class="wbtn-row"><button class="wbtn wbtn-primary" onclick="ySave()">💾 Record Entry</button><button class="wbtn wbtn-danger" onclick="yClear()">Clear</button></div></div>';
}

function yCalc() {
  var live = parseFloat(document.getElementById('y-live').value) || 0;
  [['hg','y-hg-pct'],['fillet','y-fillet-pct'],['trim','y-trim-pct']].forEach(function(pair){
    var v = parseFloat(document.getElementById('y-'+pair[0]).value) || 0;
    var el = document.getElementById(pair[1]);
    if (el) el.textContent = live>0&&v>0 ? (v/live*100).toFixed(1)+'% yield' : '—';
  });
}

function yClear() {
  ['y-live','y-hg','y-fillet','y-trim','y-notes'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  ['y-hg-pct','y-fillet-pct','y-trim-pct'].forEach(function(id){ var el=document.getElementById(id); if(el) el.textContent='—'; });
  var chk = document.querySelector('input[name="yline"]:checked'); if(chk) chk.checked=false;
  var de = document.getElementById('y-date'); if(de) de.value=new Date().toISOString().split('T')[0];
}

async function ySave() {
  var live = parseFloat(document.getElementById('y-live').value) || 0;
  if (!live) { toast('Enter Live Fish weight.'); return; }
  var lineEl = document.querySelector('input[name="yline"]:checked');
  if (!lineEl) { toast('Select a production line.'); return; }
  var dv = document.getElementById('y-date').value;
  if (!dv) { toast('Set date.'); return; }
  var hg = parseFloat(document.getElementById('y-hg').value) || 0;
  var fillet = parseFloat(document.getElementById('y-fillet').value) || 0;
  var trim = parseFloat(document.getElementById('y-trim').value) || 0;
  var yieldPct = live > 0 && trim > 0 ? parseFloat((trim/live*100).toFixed(2)) : null;
  setSyncBadge('syncing');
  try {
    await apiCall('POST', '/api/records?type=yield', {
      record_date: dv,
      shift: document.getElementById('y-shift').value,
      line: lineEl.value,
      live_weight_lbs: live,
      dressed_weight_lbs: hg || null,
      fillet_weight_lbs: fillet || null,
      trim_weight_lbs: trim || null,
      yield_pct: yieldPct,
      notes: document.getElementById('y-notes').value.trim()
    });
    setSyncBadge('synced');
    toast('✅ Entry recorded!');
    yClear();
  } catch(e) { setSyncBadge('error'); toast('⚠️ Save failed: ' + e.message); }
}

async function yRenderLog() {
  document.getElementById('widget-content').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>Loading...</div>';
  try {
    var log = await apiCall('GET', '/api/records?type=yield');
    var html = '<div class="wcard" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:0.82rem;font-weight:700;color:var(--blue)">'+log.length+' entr'+(log.length===1?'y':'ies')+'</span><button class="wbtn wbtn-danger" style="padding:5px 10px;font-size:0.73rem" onclick="yRenderLog()">🔄 Refresh</button></div>';
    if (!log.length) { html += '<div class="log-empty">No entries yet.</div>'; }
    else {
      log.forEach(function(e){
        var live = parseFloat(e.live_weight_lbs) || 0;
        var hg = parseFloat(e.dressed_weight_lbs) || 0;
        var fillet = parseFloat(e.fillet_weight_lbs) || 0;
        var trim = parseFloat(e.trim_weight_lbs) || 0;
        var dt = new Date(e.record_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
        html += '<div class="log-entry"><div class="log-hdr"><div><div class="log-date">📅 '+dt+(e.shift?' — '+e.shift:'')+'</div><div class="log-badges"><span class="lbadge" style="background:'+(LINE_COLORS[e.line]||'#1a3a6b')+'">🏭 '+(e.line||'—')+'</span><span style="background:var(--light);border:1px solid var(--border);border-radius:5px;padding:2px 7px;font-size:0.7rem;color:var(--sub)">👤 '+e.recorded_by+'</span></div></div><button class="wbtn wbtn-danger" style="padding:4px 8px" onclick="yDelete(\''+e.id+'\')">✕</button></div><div class="log-grid"><div class="lstat"><div class="lstat-lbl">Live Fish</div><div class="lstat-val">'+live+' lbs</div></div><div class="lstat"><div class="lstat-lbl">H&G</div><div class="lstat-val">'+(hg||'—')+(hg?' lbs':'')+'</div>'+(live&&hg?'<div class="lstat-pct">'+(hg/live*100).toFixed(1)+'%</div>':'')+'</div><div class="lstat"><div class="lstat-lbl">Filleted</div><div class="lstat-val">'+(fillet||'—')+(fillet?' lbs':'')+'</div>'+(live&&fillet?'<div class="lstat-pct">'+(fillet/live*100).toFixed(1)+'%</div>':'')+'</div><div class="lstat"><div class="lstat-lbl">Trimmed</div><div class="lstat-val">'+(trim||'—')+(trim?' lbs':'')+'</div>'+(live&&trim?'<div class="lstat-pct">'+(trim/live*100).toFixed(1)+'%</div>':'')+'</div></div>'+(e.notes?'<div class="log-notes"><strong>📝</strong> '+e.notes+'</div>':'')+'</div>';
      });
    }
    document.getElementById('widget-content').innerHTML = html;
  } catch(e) { document.getElementById('widget-content').innerHTML = '<div class="log-empty">⚠️ Failed to load: '+e.message+'</div>'; }
}

async function yDelete(id) {
  if (!confirm('Delete this entry?')) return;
  try { await apiCall('DELETE', '/api/records?type=yield&id='+id); yRenderLog(); } catch(e) { toast('⚠️ Delete failed'); }
}

function yRenderTrends() {
  document.getElementById('widget-content').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>Loading...</div>';
  apiCall('GET', '/api/records?type=yield').then(function(log){ yDrawTrends(log); }).catch(function(e){ document.getElementById('widget-content').innerHTML='<div class="log-empty">⚠️ '+e.message+'</div>'; });
}

function yDrawTrends(log) {
  Object.values(yCharts).forEach(function(c){ c.destroy(); }); yCharts = {};
  var filterHtml = '<div class="wcard" style="padding:12px 14px"><div style="font-size:0.78rem;font-weight:700;color:var(--blue);margin-bottom:8px">Filter by Line</div><div style="display:flex;flex-wrap:wrap;gap:7px">'+ALL_LINES.map(function(l){ var active=yActiveTrend.indexOf(l)>=0; var bg=active?LINE_COLORS[l]:'#eee'; var col=active?'#fff':'#666'; return '<button style="padding:5px 12px;border-radius:20px;border:none;background:'+bg+';color:'+col+';font-size:0.78rem;font-weight:600;cursor:pointer" onclick="yToggleLine(\''+l+'\')">'+l+'</button>'; }).join('')+'</div></div>';
  var toShow = yActiveTrend.filter(function(l){ return log.some(function(e){ return e.line===l; }); });
  if (!log.length||!toShow.length) { document.getElementById('widget-content').innerHTML=filterHtml+'<div class="log-empty">No data yet.</div>'; return; }
  var chartsHtml = '';
  toShow.forEach(function(line){ var id='ychart-'+line.replace(/[\/ ]/g,'-'); chartsHtml+='<div class="chart-card"><div class="chart-card-title">🏭 '+line+' — Yield % Over Time</div><div style="position:relative;width:100%;height:200px"><canvas id="'+id+'"></canvas></div></div>'; });
  document.getElementById('widget-content').innerHTML = filterHtml+chartsHtml;
  toShow.forEach(function(line){
    var entries = log.filter(function(e){ return e.line===line; }).sort(function(a,b){ return new Date(a.record_date)-new Date(b.record_date); });
    var color = LINE_COLORS[line];
    var id = 'ychart-'+line.replace(/[\/ ]/g,'-');
    var ctx = document.getElementById(id); if(!ctx) return;
    var live_vals = entries.map(function(e){ return parseFloat(e.live_weight_lbs)||0; });
    var trim_vals = entries.map(function(e){ return parseFloat(e.trim_weight_lbs)||0; });
    var fillet_vals = entries.map(function(e){ return parseFloat(e.fillet_weight_lbs)||0; });
    yCharts[id] = new Chart(ctx, { type:'line', data:{ labels:entries.map(function(e){ return new Date(e.record_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}); }), datasets:[{ label:'Trimmed %', data:entries.map(function(e,i){ return live_vals[i]>0&&trim_vals[i]>0?parseFloat((trim_vals[i]/live_vals[i]*100).toFixed(1)):null; }), borderColor:color, backgroundColor:color+'22', fill:true, tension:0.3, pointRadius:3, borderWidth:2, spanGaps:true },{ label:'Filleted %', data:entries.map(function(e,i){ return live_vals[i]>0&&fillet_vals[i]>0?parseFloat((fillet_vals[i]/live_vals[i]*100).toFixed(1)):null; }), borderColor:color+'88', fill:false, tension:0.3, pointRadius:3, borderWidth:1.5, spanGaps:true }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:{ font:{size:9}, maxRotation:45, autoSkip:true, maxTicksLimit:6 }, grid:{ display:false } }, y:{ ticks:{ font:{size:10}, callback:function(v){ return v+'%'; } }, min:0, max:100 } } } });
  });
}

function yToggleLine(line) {
  var idx = yActiveTrend.indexOf(line);
  if (idx>=0) { if(yActiveTrend.length>1) yActiveTrend.splice(idx,1); }
  else { yActiveTrend.push(line); }
  apiCall('GET','/api/records?type=yield').then(function(log){ yDrawTrends(log); });
}
// Expose functions globally for inline onclick handlers
window.buildYieldWidget = buildYieldWidget;
window.yShowTab = yShowTab;
window.yRenderCalc = yRenderCalc;
window.yCalc = yCalc;
window.yClear = yClear;
window.ySave = ySave;
window.yRenderLog = yRenderLog;
window.yDelete = yDelete;
window.yRenderTrends = yRenderTrends;
window.yDrawTrends = yDrawTrends;
window.yToggleLine = yToggleLine;