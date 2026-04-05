// injector.js - Injection Calculator widget

function buildInjectionWidget(){document.getElementById('widget-tabs').innerHTML=['🧪 New Batch','📋 Batch Log'].map(function(t,i){return '<div class="widget-tab'+(i===0?' active':'')+'" onclick="injShowTab('+i+')">'+t+'</div>';}).join('');injShowTab(0);}

function injShowTab(idx){document.querySelectorAll('.widget-tab').forEach(function(t,i){t.classList.toggle('active',i===idx);});if(idx===0)injRenderCalc();else injRenderLog();}

function injRenderCalc(){var nd=new Date();document.getElementById('widget-content').innerHTML='<div class="wcard"><h3>📅 Date & Shift</h3><div class="wrow"><div class="wfield"><label>Date</label><input type="date" id="inj-date" value="'+nd.toISOString().split('T')[0]+'"/></div><div class="wfield"><label>Shift</label><select id="inj-shift"><option>AM</option><option>PM</option></select></div></div></div><div class="wcard"><h3>🐟 Product</h3><div class="wfield"><label>Category</label><select id="inj-cat" onchange="injBuildItems()"><option value="">— Select Category —</option>'+Object.keys(INJ_CAT_LABELS).map(function(k){return '<option value="'+k+'">'+INJ_CAT_LABELS[k]+'</option>';}).join('')+'</select></div><div class="wfield" id="inj-item-wrap" style="display:none"><label>Size / Item</label><select id="inj-item"><option value="">— Select Size / Item —</option></select></div></div><div class="wcard"><h3>☑️ Select Tests</h3><div class="check-grid">'+INJ_STEPS.map(function(s,i){return '<label class="chk-item" id="chk-wrap-'+s.id+'"><input type="checkbox" id="chk-'+s.id+'" onchange="injUpdateSteps()"><div class="chk-item-lbl"><span>'+s.icon+' '+s.label+'</span><small>Step '+(i+1)+'</small></div></label>';}).join('')+'</div></div><div id="inj-steps"></div><div id="inj-results" style="display:none"></div><div class="wcard"><h3>📝 Notes</h3><div class="wfield"><textarea id="inj-notes" placeholder="Observations..."></textarea></div><div class="wbtn-row"><button class="wbtn wbtn-primary" onclick="injSave()">💾 Save Batch</button><button class="wbtn wbtn-danger" onclick="injRenderCalc()">Clear</button></div></div>';}

function injBuildItems(){var cat=document.getElementById('inj-cat').value;var wrap=document.getElementById('inj-item-wrap');if(!cat){wrap.style.display='none';return;}document.getElementById('inj-item').innerHTML='<option value="">— Select Size / Item —</option>'+(INJ_PRODUCTS[cat]||[]).map(function(i){return '<option value="'+i+'">'+i+'</option>';}).join('');wrap.style.display='flex';}

function injGetChecked(){return INJ_STEPS.filter(function(s){var el=document.getElementById('chk-'+s.id);return el&&el.checked;});}

function injUpdateSteps(){INJ_STEPS.forEach(function(s){var chk=document.getElementById('chk-'+s.id);var wrap=document.getElementById('chk-wrap-'+s.id);if(chk&&wrap)wrap.className='chk-item'+(chk.checked?' chk-'+s.id:'');});var checked=injGetChecked();var html='';checked.forEach(function(s,idx){var isAuto=idx>0;var prev=checked[idx-1];html+='<div class="wcard"><div class="step-card '+s.cls+'"><div class="step-title">'+s.icon+' '+s.label+(isAuto?'<span class="auto-badge">Auto-filled from '+prev.label+'</span>':'')+'</div><div class="wrow"><div class="wfield"><label>'+s.inLbl+' (lbs)</label><input type="number" id="'+s.id+'-in" placeholder="0.00" step="0.01"'+(isAuto?' readonly style="background:#e8f5e9;border-color:#9be0c4;font-weight:700"':'')+' oninput="injCalcAll()"/></div><div class="wfield"><label>'+s.outLbl+' (lbs)</label><input type="number" id="'+s.id+'-out" placeholder="0.00" step="0.01" oninput="injOnOut(\''+s.id+'\','+idx+')"/></div></div><div class="step-result" id="'+s.id+'-result"></div></div></div>';});document.getElementById('inj-steps').innerHTML=html;document.getElementById('inj-results').style.display='none';}

function injOnOut(stepId,idx){var checked=injGetChecked();var outEl=document.getElementById(stepId+'-out');if(!outEl)return;var outVal=outEl.value;if(idx<checked.length-1){var nextIn=document.getElementById(checked[idx+1].id+'-in');if(nextIn&&nextIn.readOnly)nextIn.value=outVal;}injCalcAll();}

function injCalcAll(){var checked=injGetChecked();var firstIn=null,lastOut=null,pills=[],hasAny=false;checked.forEach(function(s){var inEl=document.getElementById(s.id+'-in');var outEl=document.getElementById(s.id+'-out');var res=document.getElementById(s.id+'-result');var inW=inEl?parseFloat(inEl.value)||0:0;var outW=outEl?parseFloat(outEl.value)||0:0;if(inW&&outW){hasAny=true;var p=(outW-inW)/inW*100;var diff=outW-inW;if(res){res.style.display='block';res.className='step-result '+(p>=0?'pos':'neg');res.textContent=s.icon+' '+(p>=0?'+':'')+p.toFixed(2)+'% ('+(diff>=0?'+':'')+diff.toFixed(2)+' lbs)';}if(firstIn===null)firstIn=inW;lastOut=outW;pills.push({s:s,p:p,diff:diff});}else{if(res)res.style.display='none';}});var resDiv=document.getElementById('inj-results');if(!resDiv)return;if(!hasAny){resDiv.style.display='none';return;}resDiv.style.display='block';var pillColors={soak:'var(--green)',inj:'var(--blue)',dehy:'var(--purple)',glaze:'var(--teal)'};var pillHtml='<div class="pill-row">'+pills.map(function(x){return '<div class="pill" style="background:'+pillColors[x.s.id]+'">'+x.s.icon+' '+x.s.label+': '+(x.p>=0?'+':'')+x.p.toFixed(2)+'%</div>';}).join('')+'</div>';var totalHtml='';if(pills.length>1&&firstIn!==null&&lastOut!==null){var tp=(lastOut-firstIn)/firstIn*100;var tl=lastOut-firstIn;totalHtml='<div class="total-banner"><div><div class="total-banner-lbl">🏆 Total Pickup</div><div class="total-banner-sub">'+(tl>=0?'+':'')+tl.toFixed(2)+' lbs overall</div></div><div class="total-banner-val">'+(tp>=0?'+':'')+tp.toFixed(2)+'%</div></div>';}resDiv.innerHTML=pillHtml+totalHtml;}

async function injSave(){
  var cat=document.getElementById('inj-cat').value; var item=document.getElementById('inj-item').value;
  if(!cat||!item){toast('Please select a product.');return;}
  var checked=injGetChecked(); if(!checked.length){toast('Select at least one test.');return;}
  var stepData={}; var firstIn=null,lastOut=null;
  for(var i=0;i<checked.length;i++){var s=checked[i];var inW=parseFloat(document.getElementById(s.id+'-in').value)||0;var outW=parseFloat(document.getElementById(s.id+'-out').value)||0;if(!inW||!outW){toast('Enter both weights for '+s.label+'.');return;}if(firstIn===null)firstIn=inW;lastOut=outW;stepData[s.id]={in:inW,out:outW,pct:parseFloat(((outW-inW)/inW*100).toFixed(2)),lbs:parseFloat((outW-inW).toFixed(3))};}
  var totalPct=checked.length>1?parseFloat(((lastOut-firstIn)/firstIn*100).toFixed(2)):null;
  var totalLbs=checked.length>1?parseFloat((lastOut-firstIn).toFixed(3)):null;
  setSyncBadge('syncing');
  try {
    await apiCall('POST','/api/records?type=injection',{
      record_date: document.getElementById('inj-date').value,
      record_time: document.getElementById('inj-time') ? document.getElementById('inj-time').value : new Date().toTimeString().substring(0,5),
      shift: document.getElementById('inj-shift').value,
      category: INJ_CAT_LABELS[cat], item: item,
      pre_injection_lbs: firstIn, post_injection_lbs: lastOut,
      brine_pct: totalPct, total_pct: totalPct, total_lbs: totalLbs,
      batch_data: { steps: checked.map(function(s){return s.id;}), stepData: stepData },
      notes: document.getElementById('inj-notes').value.trim()
    });
    setSyncBadge('synced'); toast('✅ Batch saved!'); injRenderCalc();
  } catch(e){ setSyncBadge('error'); toast('⚠️ Save failed: '+e.message); }
}

async function injRenderLog(){
  document.getElementById('widget-content').innerHTML='<div class="spinner-wrap"><div class="spinner"></div>Loading...</div>';
  try {
    var log = await apiCall('GET','/api/records?type=injection');
    var stepColors={soak:'var(--green)',inj:'var(--blue)',dehy:'var(--purple)',glaze:'var(--teal)'};
    var stepIcons={soak:'🪣',inj:'💉',dehy:'🌡️',glaze:'✨'};
    var stepLabels={soak:'Soak',inj:'Injection',dehy:'Dehydration',glaze:'Glaze'};
    var html='<div class="wcard" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:0.82rem;font-weight:700;color:var(--blue)">'+log.length+' batch'+(log.length===1?'':'es')+'</span><button class="wbtn wbtn-danger" style="padding:5px 10px;font-size:0.73rem" onclick="injRenderLog()">🔄 Refresh</button></div>';
    if(!log.length){html+='<div class="log-empty">No batches yet.</div>';}
    else {
      log.forEach(function(e){
        var bd=e.batch_data||{};var steps=bd.steps||[];var sd=bd.stepData||{};
        var dt=new Date(e.record_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
        var stepsHtml=steps.map(function(sid){var d=sd[sid];if(!d)return '';return '<div class="log-step log-step-'+sid+'"><div class="log-step-title">'+stepIcons[sid]+' '+stepLabels[sid]+'</div><div class="log-grid"><div class="lstat"><div class="lstat-lbl">In</div><div class="lstat-val">'+d.in+' lbs</div></div><div class="lstat"><div class="lstat-lbl">Out</div><div class="lstat-val">'+d.out+' lbs</div></div><div class="lstat"><div class="lstat-lbl">Pickup</div><div class="lstat-val" style="color:'+(d.pct>=0?'var(--green)':'var(--red)')+'">'+(d.pct>=0?'+':'')+d.pct+'%</div></div></div></div>';}).join('');
        var totalHtml=e.total_pct!==null&&e.total_pct!==undefined?'<div class="log-total"><span style="font-size:0.78rem;font-weight:700;color:rgba(255,255,255,0.9)">🏆 Total Pickup</span><span style="font-size:1rem;font-weight:700;color:#fff">'+(e.total_pct>=0?'+':'')+e.total_pct+'%</span></div>':'';
        var badgesHtml=steps.map(function(sid){return '<span class="lbadge" style="background:'+stepColors[sid]+'">'+stepIcons[sid]+' '+stepLabels[sid]+'</span>';}).join('');
        html+='<div class="log-entry"><div class="batch-title">'+(e.category||'')+(e.item?' — '+e.item:'')+'</div><div class="batch-meta"><span>📅 '+dt+(e.shift?' — '+e.shift:'')+'</span><span style="background:var(--light);border:1px solid var(--border);border-radius:5px;padding:2px 7px;font-size:0.7rem;color:var(--sub)">👤 '+e.recorded_by+'</span></div><div class="log-badges" style="margin-bottom:8px">'+badgesHtml+'</div>'+stepsHtml+totalHtml+(e.notes?'<div class="log-notes"><strong>📝 Notes:</strong> '+e.notes+'</div>':'')+'<div style="text-align:right;margin-top:6px"><button class="wbtn wbtn-danger" style="font-size:0.72rem;padding:4px 9px" onclick="injDelete(\''+e.id+'\')">✕ Delete</button></div></div>';
      });
    }
    document.getElementById('widget-content').innerHTML=html;
  } catch(e){ document.getElementById('widget-content').innerHTML='<div class="log-empty">⚠️ '+e.message+'</div>'; }
}

async function injDelete(id){if(!confirm('Delete this batch?'))return;try{await apiCall('DELETE','/api/records?type=injection&id='+id);injRenderLog();}catch(e){toast('⚠️ Delete failed');}}
// Expose functions globally for inline onclick handlers
window.buildInjectionWidget = buildInjectionWidget;
window.injShowTab = injShowTab;
window.injRenderCalc = injRenderCalc;
window.injBuildItems = injBuildItems;
window.injGetChecked = injGetChecked;
window.injUpdateSteps = injUpdateSteps;
window.injOnOut = injOnOut;
window.injCalcAll = injCalcAll;
window.injSave = injSave;
window.injRenderLog = injRenderLog;
window.injDelete = injDelete;

async function injRenderAnalytics() {
  const wc = document.getElementById('widget-content');
  wc.innerHTML = '<div style="padding:20px;text-align:center"><div class="spinner-wrap"><div class="spinner"></div><div>Loading analytics…</div></div></div>';
  let data;
  try { data = await apiCall('GET','/api/records?type=injection&limit=500'); } catch(e){ wc.innerHTML='<p style="color:red;padding:16px">Error loading data.</p>'; return; }
  if(!data||!data.length){ wc.innerHTML='<div style="padding:32px;text-align:center;color:#888">No injection records yet. Save some batches first.</div>'; return; }

  const cats  = [...new Set(data.map(r=>r.category).filter(Boolean))].sort();
  const items = [...new Set(data.map(r=>r.item).filter(Boolean))].sort();
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now()-30*86400000).toISOString().split('T')[0];

  wc.innerHTML = `<div style="padding:10px 12px">
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:center">
      <select id="inj-an-cat" style="padding:6px 10px;border-radius:6px;border:1px solid #ddd;font-size:.84rem;background:#fff">
        <option value="">All Categories</option>
        ${cats.map(c=>'<option>'+c+'</option>').join('')}
      </select>
      <select id="inj-an-item" style="padding:6px 10px;border-radius:6px;border:1px solid #ddd;font-size:.84rem;background:#fff">
        <option value="">All Sizes</option>
        ${items.map(i=>'<option>'+i+'</option>').join('')}
      </select>
      <label style="font-size:.8rem;color:#555">From <input type="date" id="inj-an-from" value="${monthAgo}" style="padding:5px 8px;border-radius:6px;border:1px solid #ddd;font-size:.84rem"></label>
      <label style="font-size:.8rem;color:#555">To <input type="date" id="inj-an-to" value="${today}" style="padding:5px 8px;border-radius:6px;border:1px solid #ddd;font-size:.84rem"></label>
      <button onclick="injFilterAnalytics()" style="background:#1a3a6b;color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:.84rem;font-weight:600">🔍 Filter</button>
      <button onclick="injPrintAnalytics()" style="background:#2e7d32;color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:.84rem;font-weight:600">🖨️ Print / AI Export</button>
    </div>
    <div id="inj-an-results"></div>
  </div>`;

  window._injAnData = data;
  injFilterAnalytics();
}

function injFilterAnalytics() {
  const data = window._injAnData || [];
  const cat  = document.getElementById('inj-an-cat')?.value  || '';
  const item = document.getElementById('inj-an-item')?.value || '';
  const from = document.getElementById('inj-an-from')?.value || '';
  const to   = document.getElementById('inj-an-to')?.value   || '';

  const filtered = data.filter(r=>{
    if(cat  && r.category !== cat)  return false;
    if(item && r.item    !== item)  return false;
    if(from && r.record_date < from) return false;
    if(to   && r.record_date > to)   return false;
    return true;
  }).sort((a,b)=>{
    const da = (a.record_date||'')+(a.record_time||'00:00');
    const db = (b.record_date||'')+(b.record_time||'00:00');
    return db.localeCompare(da);
  });

  const div = document.getElementById('inj-an-results');
  if(!div) return;
  if(!filtered.length){
    div.innerHTML='<div style="text-align:center;color:#888;padding:32px">No records match these filters.</div>';
    window._injAnFiltered = [];
    return;
  }

  const avgYield = (filtered.reduce((s,r)=>s+(parseFloat(r.total_pct)||0),0)/filtered.length).toFixed(1);
  const avgBrine = (filtered.reduce((s,r)=>s+(parseFloat(r.brine_pct)||0),0)/filtered.length).toFixed(1);
  const totalLbs = filtered.reduce((s,r)=>s+(parseFloat(r.total_lbs)||0),0);

  const rows = filtered.map((r,i)=>{
    const steps    = r.batch_data?.steps || [];
    const stepData = r.batch_data?.stepData || [];
    const stepsStr = steps.length ? steps.join(', ') : '—';
    // Build step detail pills
    const stepDetails = stepData.map(s=>{
      const pts=[];
      if(s.pre_lbs)   pts.push('Pre: '+Number(s.pre_lbs).toLocaleString()+' lbs');
      if(s.post_lbs)  pts.push('Post: '+Number(s.post_lbs).toLocaleString()+' lbs');
      if(s.temp)      pts.push('Temp: '+s.temp+'°F');
      if(s.time_mins) pts.push('Time: '+s.time_mins+' min');
      if(s.pct)       pts.push('Pct: '+s.pct+'%');
      return pts.length ? '<b>'+s.id+'</b>: '+pts.join(' · ') : '<b>'+s.id+'</b>';
    }).join('<br>');

    return '<tr style="background:'+(i%2?'#f8f9fa':'#fff')+'">'+
      '<td style="padding:6px 8px;white-space:nowrap">'+(r.record_date||'—')+'</td>'+
      '<td style="padding:6px 8px;white-space:nowrap">'+(r.record_time||'—')+'</td>'+
      '<td style="padding:6px 8px">'+(r.category||'—')+'</td>'+
      '<td style="padding:6px 8px">'+(r.item||'—')+'</td>'+
      '<td style="padding:6px 8px;text-align:right">'+Number(r.pre_injection_lbs||0).toLocaleString()+'</td>'+
      '<td style="padding:6px 8px;text-align:right">'+Number(r.post_injection_lbs||0).toLocaleString()+'</td>'+
      '<td style="padding:6px 8px;text-align:right">'+parseFloat(r.brine_pct||0).toFixed(1)+'%</td>'+
      '<td style="padding:6px 8px;text-align:right;font-weight:700;color:#1a3a6b">'+parseFloat(r.total_pct||0).toFixed(1)+'%</td>'+
      '<td style="padding:6px 8px;font-size:.78rem;line-height:1.5;min-width:140px">'+
        '<div style="color:#333">'+stepsStr+'</div>'+
        (stepDetails?'<div style="color:#666;margin-top:2px">'+stepDetails+'</div>':'')+
      '</td>'+
      '<td style="padding:6px 8px;font-size:.78rem;color:#555">'+(r.notes||'')+
        (r.shift?'<div style="color:#888">Shift: '+r.shift+'</div>':'')+
      '</td>'+
    '</tr>';
  }).join('');

  div.innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">'+
      '<div style="background:#e3f2fd;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.5rem;font-weight:700;color:#1a3a6b">'+filtered.length+'</div><div style="font-size:.75rem;color:#555">Records</div></div>'+
      '<div style="background:#e8f5e9;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.5rem;font-weight:700;color:#2e7d32">'+avgYield+'%</div><div style="font-size:.75rem;color:#555">Avg Yield%</div></div>'+
      '<div style="background:#fff3e0;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.5rem;font-weight:700;color:#e65100">'+avgBrine+'%</div><div style="font-size:.75rem;color:#555">Avg Brine%</div></div>'+
      '<div style="background:#f3e5f5;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.5rem;font-weight:700;color:#6a1b9a">'+totalLbs.toLocaleString(undefined,{maximumFractionDigits:0})+'</div><div style="font-size:.75rem;color:#555">Total Lbs</div></div>'+
    '</div>'+
    '<div style="overflow-x:auto">'+
    '<table style="width:100%;border-collapse:collapse;font-size:.82rem">'+
      '<thead><tr style="background:#1a3a6b;color:#fff">'+
        '<th style="padding:7px 8px;text-align:left;white-space:nowrap">Date</th>'+
        '<th style="padding:7px 8px;text-align:left">Time</th>'+
        '<th style="padding:7px 8px;text-align:left">Category</th>'+
        '<th style="padding:7px 8px;text-align:left">Size</th>'+
        '<th style="padding:7px 8px;text-align:right">Pre Lbs</th>'+
        '<th style="padding:7px 8px;text-align:right">Post Lbs</th>'+
        '<th style="padding:7px 8px;text-align:right">Brine%</th>'+
        '<th style="padding:7px 8px;text-align:right">Yield%</th>'+
        '<th style="padding:7px 8px;text-align:left">Tests Applied</th>'+
        '<th style="padding:7px 8px;text-align:left">Notes / Shift</th>'+
      '</tr></thead>'+
      '<tbody>'+rows+'</tbody>'+
    '</table></div>';

  window._injAnFiltered = filtered;
}

function injPrintAnalytics() {
  const data = window._injAnFiltered || window._injAnData || [];
  if(!data.length){ toast('⚠️ No data to export.'); return; }

  const catVal  = document.getElementById('inj-an-cat')?.value  || 'All Categories';
  const itemVal = document.getElementById('inj-an-item')?.value || 'All Sizes';
  const fromVal = document.getElementById('inj-an-from')?.value || '';
  const toVal   = document.getElementById('inj-an-to')?.value   || '';

  const avgYield = (data.reduce((s,r)=>s+(parseFloat(r.total_pct)||0),0)/data.length).toFixed(1);
  const avgBrine = (data.reduce((s,r)=>s+(parseFloat(r.brine_pct)||0),0)/data.length).toFixed(1);
  const totalLbs = data.reduce((s,r)=>s+(parseFloat(r.total_lbs)||0),0).toLocaleString(undefined,{maximumFractionDigits:0});
  const filterStr = [
    catVal!=='All Categories'?'Category: '+catVal:'',
    itemVal!=='All Sizes'?'Size: '+itemVal:'',
    fromVal?'From: '+fromVal:'',
    toVal?'To: '+toVal:''
  ].filter(Boolean).join(' · ') || 'All Records';

  const rows = data.map(r=>{
    const steps    = r.batch_data?.steps || [];
    const stepData = r.batch_data?.stepData || [];
    const stepsStr = steps.length ? steps.join(', ') : '—';
    const stepDetails = stepData.map(s=>{
      const pts=[];
      if(s.pre_lbs)   pts.push('Pre Lbs: '+Number(s.pre_lbs).toLocaleString());
      if(s.post_lbs)  pts.push('Post Lbs: '+Number(s.post_lbs).toLocaleString());
      if(s.temp)      pts.push('Temp: '+s.temp+'°F');
      if(s.time_mins) pts.push('Time: '+s.time_mins+' min');
      if(s.pct)       pts.push('Pct: '+s.pct+'%');
      return '<b>'+s.id+'</b>: '+pts.join(', ');
    }).join('<br>');

    return '<tr>'+
      '<td style="padding:5px 8px;white-space:nowrap">'+(r.record_date||'')+(r.record_time?' '+r.record_time:'')+'</td>'+
      '<td style="padding:5px 8px">'+(r.category||'—')+'</td>'+
      '<td style="padding:5px 8px">'+(r.item||'—')+'</td>'+
      '<td style="padding:5px 8px;text-align:right">'+Number(r.pre_injection_lbs||0).toLocaleString()+'</td>'+
      '<td style="padding:5px 8px;text-align:right">'+Number(r.post_injection_lbs||0).toLocaleString()+'</td>'+
      '<td style="padding:5px 8px;text-align:right">'+parseFloat(r.brine_pct||0).toFixed(1)+'%</td>'+
      '<td style="padding:5px 8px;text-align:right;font-weight:700">'+parseFloat(r.total_pct||0).toFixed(1)+'%</td>'+
      '<td style="padding:5px 8px;font-size:.78rem">'+stepsStr+(stepDetails?'<br>'+stepDetails:'')+'</td>'+
      '<td style="padding:5px 8px;font-size:.78rem">'+(r.notes||'')+(r.shift?' ['+r.shift+']':'')+'</td>'+
    '</tr>';
  }).join('');

  const html =
    '<div style="background:#f5f7fa;border-radius:6px;padding:12px 16px;margin-bottom:16px;font-size:.88rem;line-height:1.7">'+
      '<strong>Filters:</strong> '+filterStr+'<br>'+
      '<strong>Records:</strong> '+data.length+
      ' &nbsp;·  <strong>Avg Yield%:</strong> '+avgYield+
      '% &nbsp;·  <strong>Avg Brine%:</strong> '+avgBrine+
      '% &nbsp;·  <strong>Total Lbs:</strong> '+totalLbs+
    '</div>'+
    '<table style="border-collapse:collapse;width:100%;font-size:.8rem">'+
      '<thead><tr style="background:#1a3a6b;color:#fff">'+
        '<th style="padding:7px 8px;text-align:left">Date / Time</th>'+
        '<th style="padding:7px 8px">Category</th>'+
        '<th style="padding:7px 8px">Size</th>'+
        '<th style="padding:7px 8px;text-align:right">Pre Lbs</th>'+
        '<th style="padding:7px 8px;text-align:right">Post Lbs</th>'+
        '<th style="padding:7px 8px;text-align:right">Brine%</th>'+
        '<th style="padding:7px 8px;text-align:right">Yield%</th>'+
        '<th style="padding:7px 8px">Tests Applied</th>'+
        '<th style="padding:7px 8px">Notes</th>'+
      '</tr></thead>'+
      '<tbody>'+rows+'</tbody>'+
    '</table>';

  printReport('Injection Calculator Analytics — Pride of the Pond', html);
}

// Expose to global scope for inline onclick handlers
window.buildInjectionWidget = buildInjectionWidget;
window.injShowTab = injShowTab;
window.injRenderCalc = injRenderCalc;
window.injBuildItems = injBuildItems;
window.injGetChecked = injGetChecked;
window.injUpdateSteps = injUpdateSteps;
window.injOnOut = injOnOut;
window.injCalcAll = injCalcAll;
window.injSave = injSave;
window.injRenderLog = injRenderLog;
window.injDelete = injDelete;
window.injRenderAnalytics = injRenderAnalytics;
window.injFilterAnalytics = injFilterAnalytics;
window.injPrintAnalytics = injPrintAnalytics;
