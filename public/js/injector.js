// injector.js - Injection Calculator widget

function buildInjectionWidget(){document.getElementById('widget-tabs').innerHTML=['🧪 New Batch','📋 Batch Log','📈 Analytics'].map(function(t,i){return '<div class="widget-tab'+(i===0?' active':'')+'" onclick="injShowTab('+i+')">'+t+'</div>';}).join('');injShowTab(0);}

function injShowTab(idx){document.querySelectorAll('.widget-tab').forEach(function(t,i){t.classList.toggle('active',i===idx);});if(idx===0)injRenderCalc();else if(idx===1)injRenderLog();else injRenderAnalytics();}

function injRenderCalc(){var nd=new Date();document.getElementById('widget-content').innerHTML='<div class="wcard"><h3>📅 Date & Shift</h3><div class="wrow"><div class="wfield"><label>Date</label><input type="date" id="inj-date" value="'+nd.toISOString().split('T')[0]+'"/></div><div class="wfield"><label>Time</label><input type="time" id="inj-time" style="width:110px"></div><div class="wfield"><label>Shift</label><select id="inj-shift"><option>AM</option><option>PM</option></select></div></div></div><div class="wcard"><h3>🐟 Product</h3><div class="wfield"><label>Category</label><select id="inj-cat" onchange="injBuildItems()"><option value="">— Select Category —</option>'+Object.keys(INJ_CAT_LABELS).map(function(k){return '<option value="'+k+'">'+INJ_CAT_LABELS[k]+'</option>';}).join('')+'</select></div><div class="wfield" id="inj-item-wrap" style="display:none"><label>Size / Item</label><select id="inj-item"><option value="">— Select Size / Item —</option></select></div></div><div class="wcard"><h3>☑️ Select Tests</h3><div class="check-grid">'+INJ_STEPS.map(function(s,i){return '<label class="chk-item" id="chk-wrap-'+s.id+'"><input type="checkbox" id="chk-'+s.id+'" onchange="injUpdateSteps()"><div class="chk-item-lbl"><span>'+s.icon+' '+s.label+'</span><small>Step '+(i+1)+'</small></div></label>';}).join('')+'</div></div><div id="inj-steps"></div><div id="inj-results" style="display:none"></div><div class="wcard"><h3>📝 Notes</h3><div class="wfield"><textarea id="inj-notes" placeholder="Observations..."></textarea></div><div class="wbtn-row"><button class="wbtn wbtn-primary" onclick="injSave()">💾 Save Batch</button><button class="wbtn wbtn-danger" onclick="injRenderCalc()">Clear</button></div></div>';}

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
      record_time: (document.getElementById('inj-time')?.value||''),
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
  wc.innerHTML = '<div style="padding:16px;text-align:center;color:#888">Loading analytics…</div>';
  let data;
  try { data = await apiCall('GET','/api/records?type=injection&limit=500'); } catch(e){ wc.innerHTML='<p style="color:red">Error loading data.</p>'; return; }
  if(!data||!data.length){ wc.innerHTML='<div style="padding:32px;text-align:center;color:#888">📭 No injection records yet. Save some batches first.</div>'; return; }
  const cats=[...new Set(data.map(r=>r.category).filter(Boolean))].sort();
  const items=[...new Set(data.map(r=>r.item).filter(Boolean))].sort();
  wc.innerHTML=`<div style="padding:8px 12px">
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:flex-end">
      <div><div style="font-size:.72rem;color:#888;margin-bottom:2px">Category</div>
        <select id="inj-an-cat" style="padding:6px 10px;border-radius:6px;border:1px solid #ddd;font-size:.85rem">
          <option value="">All Categories</option>${cats.map(c=>'<option>'+c+'</option>').join('')}
        </select></div>
      <div><div style="font-size:.72rem;color:#888;margin-bottom:2px">Size</div>
        <select id="inj-an-item" style="padding:6px 10px;border-radius:6px;border:1px solid #ddd;font-size:.85rem">
          <option value="">All Sizes</option>${items.map(i=>'<option>'+i+'</option>').join('')}
        </select></div>
      <div><div style="font-size:.72rem;color:#888;margin-bottom:2px">From</div>
        <input type="date" id="inj-an-from" style="padding:6px 10px;border-radius:6px;border:1px solid #ddd;font-size:.85rem"></div>
      <div><div style="font-size:.72rem;color:#888;margin-bottom:2px">To</div>
        <input type="date" id="inj-an-to" style="padding:6px 10px;border-radius:6px;border:1px solid #ddd;font-size:.85rem"></div>
      <button onclick="injFilterAnalytics()" style="background:#1a3a6b;color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:.85rem">🔍 Filter</button>
      <button onclick="injPrintAnalytics()" style="background:#2e7d32;color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:.85rem">🖨️ Print / AI Export</button>
    </div>
    <div id="inj-an-results"></div>
  </div>`;
  window._injAnData=data;
  injFilterAnalytics();
}

function injFilterAnalytics() {
  const data=window._injAnData||[];
  const cat=document.getElementById('inj-an-cat')?.value||'';
  const item=document.getElementById('inj-an-item')?.value||'';
  const from=document.getElementById('inj-an-from')?.value||'';
  const to=document.getElementById('inj-an-to')?.value||'';
  let rows=data.filter(r=>{
    if(cat&&r.category!==cat)return false;
    if(item&&r.item!==item)return false;
    if(from&&r.record_date<from)return false;
    if(to&&r.record_date>to)return false;
    return true;
  }).sort((a,b)=>(b.record_date+(b.record_time||''))>(a.record_date+(a.record_time||''))?1:-1);
  const div=document.getElementById('inj-an-results');
  if(!div)return;
  if(!rows.length){div.innerHTML='<div style="text-align:center;color:#888;padding:32px">No records match filters.</div>';return;}
  const avgYield=(rows.reduce((s,r)=>s+(parseFloat(r.total_pct)||0),0)/rows.length).toFixed(1);
  const avgBrine=(rows.reduce((s,r)=>s+(parseFloat(r.brine_pct)||0),0)/rows.length).toFixed(1);
  const totalLbs=rows.reduce((s,r)=>s+(parseFloat(r.total_lbs)||0),0).toLocaleString(undefined,{maximumFractionDigits:0});
  div.innerHTML=`
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
    <div style="background:#e3f2fd;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.5rem;font-weight:700;color:#1a3a6b">${rows.length}</div><div style="font-size:.72rem;color:#666">Batches</div></div>
    <div style="background:#e8f5e9;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.5rem;font-weight:700;color:#2e7d32">${avgYield}%</div><div style="font-size:.72rem;color:#666">Avg Yield</div></div>
    <div style="background:#fff3e0;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.5rem;font-weight:700;color:#e65100">${avgBrine}%</div><div style="font-size:.72rem;color:#666">Avg Brine</div></div>
    <div style="background:#f3e5f5;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.5rem;font-weight:700;color:#6a1b9a">${totalLbs}</div><div style="font-size:.72rem;color:#666">Total Lbs</div></div>
  </div>
  <div style="overflow-x:auto">
  <table style="width:100%;border-collapse:collapse;font-size:.82rem;min-width:700px">
    <thead><tr style="background:#1a3a6b;color:#fff">
      <th style="padding:7px 8px;text-align:left;white-space:nowrap">Date</th>
      <th style="padding:7px 8px;text-align:left">Time</th>
      <th style="padding:7px 8px;text-align:left">Category</th>
      <th style="padding:7px 8px;text-align:left">Size</th>
      <th style="padding:7px 8px;text-align:right">Pre Lbs</th>
      <th style="padding:7px 8px;text-align:right">Post Lbs</th>
      <th style="padding:7px 8px;text-align:right">Brine%</th>
      <th style="padding:7px 8px;text-align:right;color:#90caf9">Yield%</th>
      <th style="padding:7px 8px;text-align:left">Tests Applied</th>
      <th style="padding:7px 8px;text-align:left">Notes</th>
    </tr></thead>
    <tbody>${rows.map((r,i)=>{
      const bd=r.batch_data||{};
      const steps=(bd.steps||[]).join(', ')||'—';
      const stepRows=Object.entries(bd.stepData||{}).map(([sid,s])=>{const p=[];if(s.in!=null)p.push('In: '+s.in+' lbs');if(s.lbs!=null)p.push('Change: '+s.lbs+' lbs');if(s.out!=null)p.push('Out: '+s.out+' lbs');if(s.pct!=null)p.push('Pct: '+s.pct+'%');if(s.temp)p.push(s.temp+'°F');if(s.time_mins)p.push(s.time_mins+' min');return p.length?'<span style="font-size:.75rem;color:#555">'+sid.toUpperCase()+': '+p.join(' | ')+'</span>':''}).filter(Boolean).join('<br>');
      return '<tr style="background:'+(i%2?'#f8f9fa':'#fff')+'">'+
        '<td style="padding:6px 8px;white-space:nowrap">'+(r.record_date||'').substring(0,10)+'</td>'+
        '<td style="padding:6px 8px">'+( r.record_time||'—')+'</td>'+
        '<td style="padding:6px 8px">'+( r.category||'—')+'</td>'+
        '<td style="padding:6px 8px">'+( r.item||'—')+'</td>'+
        '<td style="padding:6px 8px;text-align:right">'+(+r.pre_injection_lbs||0).toLocaleString()+'</td>'+
        '<td style="padding:6px 8px;text-align:right">'+(+r.post_injection_lbs||0).toLocaleString()+'</td>'+
        '<td style="padding:6px 8px;text-align:right">'+(+r.brine_pct||0).toFixed(1)+'%</td>'+
        '<td style="padding:6px 8px;text-align:right;font-weight:700;color:#1a3a6b">'+(+r.total_pct||0).toFixed(1)+'%</td>'+
        '<td style="padding:6px 8px"><div>'+steps+'</div>'+( stepRows?'<div style="margin-top:3px">'+stepRows+'</div>':'')+'</td>'+
        '<td style="padding:6px 8px;font-size:.78rem;color:#555">'+( r.notes||'')+'</td>'+
      '</tr>';
    }).join('')}</tbody>
  </table></div>`;
  window._injAnFiltered=rows;
}

function injPrintAnalytics() {
  const rows=window._injAnFiltered||window._injAnData||[];
  const cat=document.getElementById('inj-an-cat')?.value||'All Categories';
  const item=document.getElementById('inj-an-item')?.value||'All Sizes';
  const from=document.getElementById('inj-an-from')?.value||'';
  const to=document.getElementById('inj-an-to')?.value||'';
  if(!rows.length){toast('No data to export');return;}
  const avgYield=rows.length?(rows.reduce((s,r)=>s+(parseFloat(r.total_pct)||0),0)/rows.length).toFixed(1):'0';
  const avgBrine=rows.length?(rows.reduce((s,r)=>s+(parseFloat(r.brine_pct)||0),0)/rows.length).toFixed(1):'0';
  const totalLbs=rows.reduce((s,r)=>s+(parseFloat(r.total_lbs)||0),0).toLocaleString(undefined,{maximumFractionDigits:0});
  const filterStr=[cat!=='All Categories'?'Category: '+cat:'',item!=='All Sizes'?'Size: '+item:'',from?'From: '+from:'',to?'To: '+to:''].filter(Boolean).join(' | ')||'All Records';
  const tableRows=rows.map(r=>{
    const bd=r.batch_data||{};
    const steps=(bd.steps||[]).join(', ')||'None';
    const stepDetail=Object.entries(bd.stepData||{}).map(([sid,s])=>{const p=[];if(s.in!=null)p.push('In: '+s.in+' lbs');if(s.lbs!=null)p.push('Change: '+s.lbs+' lbs');if(s.out!=null)p.push('Out: '+s.out+' lbs');if(s.pct!=null)p.push('Pct: '+s.pct+'%');if(s.temp)p.push(s.temp+'°F');if(s.time_mins)p.push(s.time_mins+' min');return p.length?'<span style="font-size:.75rem;color:#555">'+sid.toUpperCase()+': '+p.join(' | ')+'</span>':''}).filter(Boolean).join('<br>');
    return '<tr><td style="white-space:nowrap">'+(r.record_date||'').substring(0,10)+'</td>'+
      '<td>'+(r.record_time||'—')+'</td>'+
      '<td>'+(r.category||'—')+'</td>'+
      '<td>'+(r.item||'—')+'</td>'+
      '<td style="text-align:right">'+(+r.pre_injection_lbs||0).toLocaleString()+'</td>'+
      '<td style="text-align:right">'+(+r.post_injection_lbs||0).toLocaleString()+'</td>'+
      '<td style="text-align:right">'+(+r.brine_pct||0).toFixed(1)+'%</td>'+
      '<td style="text-align:right;font-weight:700">'+(+r.total_pct||0).toFixed(1)+'%</td>'+
      '<td>'+steps+'<br>'+stepDetail+'</td>'+
      '<td>'+(r.notes||'')+'</td></tr>';
  }).join('');
  const html='<div style="background:#f5f5f5;padding:12px;border-radius:6px;margin-bottom:16px;font-size:.85rem">'+
    '<b>Filters:</b> '+filterStr+'<br>'+
    '<b>Batches:</b> '+rows.length+' &nbsp;|&nbsp; '+
    '<b>Avg Yield%:</b> '+avgYield+'% &nbsp;|&nbsp; '+
    '<b>Avg Brine%:</b> '+avgBrine+'% &nbsp;|&nbsp; '+
    '<b>Total Lbs Processed:</b> '+totalLbs+
    '</div>'+
    '<table style="border-collapse:collapse;width:100%;font-size:.82rem">'+
    '<thead><tr style="background:#1a3a6b;color:#fff">'+
    '<th style="padding:7px 8px">Date</th><th>Time</th><th>Category</th><th>Size</th>'+
    '<th style="text-align:right">Pre Lbs</th><th style="text-align:right">Post Lbs</th>'+
    '<th style="text-align:right">Brine%</th><th style="text-align:right">Yield%</th>'+
    '<th>Tests Applied</th><th>Notes</th></tr></thead>'+
    '<tbody>'+tableRows+'</tbody></table>';
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
