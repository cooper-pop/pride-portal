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
        var dt = new Date(String(e.record_date).replace(/-/g,'/')).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
        html += '<div class="log-entry"><div class="log-hdr"><div><div class="log-date">📅 '+dt+(e.shift?' — '+e.shift:'')+'</div><div class="log-badges"><span class="lbadge" style="background:'+(LINE_COLORS[e.line]||'#1a3a6b')+'">🏭 '+(e.line||'—')+'</span><span style="background:var(--light);border:1px solid var(--border);border-radius:5px;padding:2px 7px;font-size:0.7rem;color:var(--sub)">👤 '+e.recorded_by+'</span></div></div><button class="wbtn wbtn-danger" style="padding:4px 8px" onclick="yDelete(\''+e.id+'\')">✕</button></div>'+(currentUser?.role==='admin'?'<div style="background:#f0f4ff;border:1px solid #c5d0f0;border-radius:8px;padding:10px;margin:8px 0;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px"><div><label style="font-size:.7rem;color:#555;display:block">Date</label><input type="date" value="'+e.record_date+'" onchange="yUpdateRecord(\''+e.id+'\',\'record_date\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"></div><div><label style="font-size:.7rem;color:#555;display:block">Shift</label><select onchange="yUpdateRecord(\''+e.id+'\',\'shift\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"><option'+(e.shift==='AM'?' selected':'')+'>AM</option><option'+(e.shift==='PM'?' selected':'')+'>PM</option><option'+(e.shift==='Night'?' selected':'')+'>Night</option></select></div><div><label style="font-size:.7rem;color:#555;display:block">Line</label><input type="text" value="'+(e.line||'')+'" onchange="yUpdateRecord(\''+e.id+'\',\'line\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem" placeholder="Line #"></div><div><label style="font-size:.7rem;color:#555;display:block">Live Wt (lbs)</label><input type="number" step="0.01" value="'+e.live_weight_lbs+'" onchange="yUpdateRecord(\''+e.id+'\',\'live_weight_lbs\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"></div><div><label style="font-size:.7rem;color:#555;display:block">Dressed (lbs)</label><input type="number" step="0.01" value="'+e.dressed_weight_lbs+'" onchange="yUpdateRecord(\''+e.id+'\',\'dressed_weight_lbs\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"></div><div><label style="font-size:.7rem;color:#555;display:block">Fillet (lbs)</label><input type="number" step="0.01" value="'+e.fillet_weight_lbs+'" onchange="yUpdateRecord(\''+e.id+'\',\'fillet_weight_lbs\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"></div></div>':'')+'<div class="log-grid"><div class="lstat"><div class="lstat-lbl">Live Fish</div><div class="lstat-val">'+live+' lbs</div></div><div class="lstat"><div class="lstat-lbl">H&G</div><div class="lstat-val">'+(hg||'—')+(hg?' lbs':'')+'</div>'+(live&&hg?'<div class="lstat-pct">'+(hg/live*100).toFixed(1)+'%</div>':'')+'</div><div class="lstat"><div class="lstat-lbl">Filleted</div><div class="lstat-val">'+(fillet||'—')+(fillet?' lbs':'')+'</div>'+(live&&fillet?'<div class="lstat-pct">'+(fillet/live*100).toFixed(1)+'%</div>':'')+'</div><div class="lstat"><div class="lstat-lbl">Trimmed</div><div class="lstat-val">'+(trim||'—')+(trim?' lbs':'')+'</div>'+(live&&trim?'<div class="lstat-pct">'+(trim/live*100).toFixed(1)+'%</div>':'')+'</div></div>'+(e.notes?'<div class="log-notes"><strong>📝</strong> '+e.notes+'</div>':'')+'</div>';
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

function yDrawTrends(records) {
  var el = document.getElementById('widget-content');
  if (!el) return;
  window._yldAllRecords = records;
  yRenderTrends(records, 'ytd');
}

function yRenderTrends(records, period) {
  var el = document.getElementById('widget-content');
  if (!el) return;

  var LINES = ['Line 1','Line 2','Line 3','Line 4'];
  var LINE_COLORS = ['#1a3a6b','#d97706','#059669','#dc2626'];
  var PERIODS = [{key:'7d',label:'7 Days'},{key:'14d',label:'14 Days'},{key:'30d',label:'30 Days'},{key:'ytd',label:'YTD'}];

  function recDate(r){ var p=String(r.record_date).split('-'); return new Date(p[0],p[1]-1,p[2]); }
  function filletPct(r){ var l=parseFloat(r.live_weight_lbs)||0,f=parseFloat(r.fillet_weight_lbs)||0; return l>0?Math.round(f/l*1000)/10:null; }
  function trimPct(r){ var l=parseFloat(r.live_weight_lbs)||0,t=parseFloat(r.trim_weight_lbs)||0; return l>0?Math.round(t/l*1000)/10:null; }
  function avg(arr){ var v=arr.filter(function(x){return x!==null&&!isNaN(x);}); return v.length?Math.round(v.reduce(function(a,b){return a+b;},0)/v.length*10)/10:null; }
  function fmt(v){ return v!==null&&v!==undefined?v+'%':'—'; }

  function filterByPeriod(recs, key) {
    var now = new Date(); now.setHours(0,0,0,0);
    if (key==='ytd') {
      var jan1 = new Date(now.getFullYear(),0,1);
      return recs.filter(function(r){ return recDate(r)>=jan1; });
    }
    var days = key==='7d'?7:key==='14d'?14:30;
    var cut = new Date(now); cut.setDate(cut.getDate()-days);
    return recs.filter(function(r){ return recDate(r)>=cut; });
  }

  var filtered = filterByPeriod(records, period);
  var sorted = filtered.slice().sort(function(a,b){ return recDate(a)-recDate(b); });

  // Unique dates for x-axis
  var seenDates={}, allDates=[];
  sorted.forEach(function(r){ var d=String(r.record_date).substring(0,10); if(!seenDates[d]){seenDates[d]=true;allDates.push(d);} });

  // Build per-line datasets
  function buildDataset(recs, valueFn) {
    var result={};
    LINES.forEach(function(line){
      var byDate={};
      recs.forEach(function(r){
        if(r.line!==line) return;
        var d=String(r.record_date).substring(0,10);
        if(!byDate[d]) byDate[d]=[];
        var v=valueFn(r); if(v!==null) byDate[d].push(v);
      });
      result[line]=allDates.map(function(d){ var arr=byDate[d]; return arr&&arr.length?Math.round(arr.reduce(function(a,b){return a+b;},0)/arr.length*10)/10:null; });
    });
    return result;
  }

  var filletData = buildDataset(sorted, filletPct);
  var trimData   = buildDataset(sorted, trimPct);

  var xLabels = allDates.map(function(d){
    var p=d.split('-'); var dt=new Date(p[0],p[1]-1,p[2]);
    return dt.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  });

  // Summary averages across all records (not filtered) for the 3 fixed periods
  function summaryRows(allRecs) {
    var ps=[{label:'7 days',days:7},{label:'14 days',days:14},{label:'30 days',days:30}];
    return ps.map(function(p){
      var sub=filterByPeriod(allRecs,p.days===7?'7d':p.days===14?'14d':'30d');
      var fpct=LINES.map(function(l){ return avg(sub.filter(function(r){return r.line===l;}).map(filletPct)); });
      var tpct=LINES.map(function(l){ return avg(sub.filter(function(r){return r.line===l;}).map(trimPct)); });
      return {label:p.label, fpct:fpct, tpct:tpct, overallF:avg(sub.map(filletPct)), overallT:avg(sub.map(trimPct))};
    });
  }
  var summary = summaryRows(records);

  // Filter pill buttons
  var btnStyle = 'border:none;border-radius:6px;padding:5px 12px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .15s';
  var pillBar = '<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">';
  PERIODS.forEach(function(p){
    var active = p.key===period;
    var bg = active?'#1a3a6b':'#f1f5f9';
    var col = active?'#fff':'#475569';
    pillBar += '<button style="'+btnStyle+';background:'+bg+';color:'+col+'" onclick="yRenderTrends(window._yldAllRecords,''+p.key+'')">'+p.label+'</button>';
  });
  pillBar += '</div>';

  var cardStyle = 'background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.08)';
  var noDataMsg = sorted.length===0 ? '<div style="text-align:center;color:#94a3b8;padding:20px;font-size:.85rem">No records in this period</div>' : '';

  var html = '<div style="padding:4px 0 12px">';
  html += '<div style="'+cardStyle.replace('margin-bottom:14px','margin-bottom:14px')+'">'+pillBar;
  if(noDataMsg){ html += noDataMsg; }
  html += '</div>';

  if(!noDataMsg) {
    html += '<div style="'+cardStyle+'">';
    html += '<h3 style="margin:0 0 4px;font-size:.9rem;color:#1a3a6b;font-weight:700">Fillet Machine Yield % by Line</h3>';
    html += '<p style="margin:0 0 10px;font-size:.72rem;color:#64748b">Fillet weight as % of live weight — all 4 lines</p>';
    html += '<canvas id="yc-fillet" style="width:100%;height:220px;display:block"></canvas></div>';

    html += '<div style="'+cardStyle+'">';
    html += '<h3 style="margin:0 0 4px;font-size:.9rem;color:#1a3a6b;font-weight:700">Trim % by Line</h3>';
    html += '<p style="margin:0 0 10px;font-size:.72rem;color:#64748b">Trim weight as % of live weight — all 4 lines</p>';
    html += '<canvas id="yc-trim" style="width:100%;height:220px;display:block"></canvas></div>';
  }

  // Summary tables (always show all-time 7/14/30 day averages)
  function summaryTable(title, key) {
    var html2 = '<div style="'+cardStyle+'"><h3 style="margin:0 0 12px;font-size:.9rem;color:#1a3a6b;font-weight:700">'+title+'</h3>';
    html2 += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.78rem">';
    html2 += '<thead><tr style="background:#f1f5f9"><th style="padding:7px 10px;text-align:left;color:#475569">Period</th>';
    LINES.forEach(function(l,i){ html2 += '<th style="padding:7px 10px;text-align:center;color:'+LINE_COLORS[i]+'">'+l+'</th>'; });
    html2 += '<th style="padding:7px 10px;text-align:center;color:#1a3a6b;font-weight:700">Overall</th></tr></thead><tbody>';
    summary.forEach(function(row,i){
      html2 += '<tr style="border-top:1px solid #e2e8f0;'+(i%2?'background:#fafafa':'')+'">';
      html2 += '<td style="padding:7px 10px;font-weight:600;color:#374151">Last '+row.label+'</td>';
      var vals = key==='fillet'?row.fpct:row.tpct;
      vals.forEach(function(v){ html2 += '<td style="padding:7px 10px;text-align:center;color:#374151">'+fmt(v)+'</td>'; });
      html2 += '<td style="padding:7px 10px;text-align:center;font-weight:700;color:#1a3a6b">'+fmt(key==='fillet'?row.overallF:row.overallT)+'</td></tr>';
    });
    html2 += '</tbody></table></div></div>';
    return html2;
  }

  html += summaryTable('Average Fillet Yield % Summary','fillet');
  html += summaryTable('Average Trim % Summary','trim');
  html += '</div>';

  el.innerHTML = html;

  if(noDataMsg) return;

  function drawChart(canvasId, datasets, labels) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    function doChart() {
      var ctx = canvas.getContext('2d');
      new Chart(ctx, {
        type:'line',
        data:{
          labels:labels,
          datasets:datasets.map(function(ds,i){
            return {label:ds.label,data:ds.data,borderColor:LINE_COLORS[i],backgroundColor:LINE_COLORS[i]+'22',
              borderWidth:2.5,pointRadius:3,pointHoverRadius:5,tension:0.3,spanGaps:true};
          })
        },
        options:{
          responsive:true,maintainAspectRatio:false,
          interaction:{mode:'index',intersect:false},
          plugins:{
            legend:{position:'top',labels:{boxWidth:12,font:{size:11}}},
            tooltip:{callbacks:{label:function(c){ return c.dataset.label+': '+(c.parsed.y!==null?c.parsed.y+'%':'—'); }}}
          },
          scales:{
            x:{ticks:{font:{size:10},maxTicksLimit:14,maxRotation:45}},
            y:{ticks:{callback:function(v){return v+'%';},font:{size:10}},beginAtZero:false}
          }
        }
      });
    }
    if(typeof Chart!=='undefined'){ doChart(); }
    else {
      var s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      s.onload=doChart; document.head.appendChild(s);
    }
  }

  setTimeout(function(){
    drawChart('yc-fillet', LINES.map(function(l){ return {label:l,data:filletData[l]}; }), xLabels);
    drawChart('yc-trim',   LINES.map(function(l){ return {label:l,data:trimData[l]}; }),   xLabels);
  }, 80);
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

function yUpdateRecord(id, field, value) {
  if(typeof currentUser==='undefined'||!currentUser){toast('Not logged in');return;}
  apiCall('PUT','/api/records',{id,type:'yield',field,value})
    .then(function(){ toast('✅ Saved'); })
    .catch(function(e){ toast('❌ '+(e&&e.message||'Save failed')); });
}

// Expose to global scope for inline onclick handlers
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
window.yUpdateRecord = yUpdateRecord;
