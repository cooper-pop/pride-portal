// injector.js - Injection Calculator widget

function buildInjectionWidget(){document.getElementById('widget-tabs').innerHTML=['🧪 New Batch','📋 Batch Log','📈 Analytics','📂 Import Excel'].map(function(t,i){return '<div class="widget-tab'+(i===0?' active':'')+'" onclick="injShowTab('+i+')">'+t+'</div>';}).join('');injShowTab(0);}

function injShowTab(idx){
  const isAdmin = (typeof currentUser!=='undefined' && currentUser?.role==='admin');
  var canView = typeof currentUser!=='undefined' && (currentUser?.role==='admin'||currentUser?.role==='manager');
  // Block non-managers/admins from Batch Log (1) and Analytics (2)
  if((idx===1||idx===2) && !canView){
    document.getElementById('widget-content').innerHTML='<div style="padding:40px;text-align:center;color:#888"><div style="font-size:2rem;margin-bottom:12px">🔒</div><div style="font-size:1rem;font-weight:600;color:#1a3a6b">Admin Access Only</div><div style="font-size:.85rem;margin-top:6px">Batch Log and Analytics are restricted to administrators.</div></div>';
    // Still update tab highlight
    document.querySelectorAll('.widget-tab').forEach(function(t,i){t.classList.toggle('active',i===idx);});
    return;
  }
  document.querySelectorAll('.widget-tab').forEach(function(t,i){t.classList.toggle('active',i===idx);});
  if(idx===0)injRenderCalc();
  else if(idx===1)injRenderLog();
  else if(idx===2)injRenderAnalytics();
  else injRenderImport();
}

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
    var html='<div class="wcard" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:0.82rem;font-weight:700;color:var(--blue)">'+log.length+' batch'+(log.length===1?'':'es')+'</span><button class="wbtn wbtn-success" style="padding:5px 10px;font-size:0.73rem;background:#2e7d32;color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="injPrintLog()">🖨️ Print</button><button class="wbtn wbtn-danger" style="padding:5px 10px;font-size:0.73rem" onclick="injRenderLog()">🔄 Refresh</button></div>';
    if(!log.length){html+='<div class="log-empty">No batches yet.</div>';}
    else {
      log.forEach(function(e){
        var bd=e.batch_data||{};var steps=bd.steps||[];var sd=bd.stepData||{};
        var dt=(function(d){if(!d)return '—';const p=d.split('-');const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return months[parseInt(p[1])-1]+' '+parseInt(p[2])+', '+p[0];})(e.record_date);
        var stepsHtml=steps.map(function(sid){var d=sd[sid];if(!d)return '';return '<div class="log-step log-step-'+sid+'"><div class="log-step-title">'+stepIcons[sid]+' '+stepLabels[sid]+'</div><div class="log-grid"><div class="lstat"><div class="lstat-lbl">In</div><div class="lstat-val">'+d.in+' lbs</div></div><div class="lstat"><div class="lstat-lbl">Out</div><div class="lstat-val">'+d.out+' lbs</div></div><div class="lstat"><div class="lstat-lbl">Pickup</div><div class="lstat-val" style="color:'+(d.pct>=0?'var(--green)':'var(--red)')+'">'+(d.pct>=0?'+':'')+d.pct+'%</div></div></div></div>';}).join('');
        var totalHtml=e.total_pct!==null&&e.total_pct!==undefined?'<div class="log-total"><span style="font-size:0.78rem;font-weight:700;color:rgba(255,255,255,0.9)">🏆 Total Pickup</span><span style="font-size:1rem;font-weight:700;color:#fff">'+(e.total_pct>=0?'+':'')+e.total_pct+'%</span></div>':'';
        var badgesHtml=steps.map(function(sid){return '<span class="lbadge" style="background:'+stepColors[sid]+'">'+stepIcons[sid]+' '+stepLabels[sid]+'</span>';}).join('');
        html+='<div class="log-entry"><div class="batch-title">'+(e.category||'')+(e.item?' — '+e.item:'')+'</div><div class="batch-meta"><span>📅 '+dt+(e.shift?' — '+e.shift:'')+'</span><span style="background:var(--light);border:1px solid var(--border);border-radius:5px;padding:2px 7px;font-size:0.7rem;color:var(--sub)">👤 '+e.recorded_by+'</span></div><div class="log-badges" style="margin-bottom:8px">'+badgesHtml+'</div>'+stepsHtml+totalHtml+(e.notes?'<div class="log-notes"><strong>📝 Notes:</strong> '+e.notes+'</div>':'')+'<div style="text-align:right;margin-top:6px">'+(userCan('injection','delete')?'<button class="wbtn wbtn-danger" style="font-size:0.72rem;padding:4px 9px" onclick="injDelete(\''+e.id+'\')">✕ Delete</button>':'')+(userCan('injection','edit')?'<div style="background:#f0f4ff;border:1px solid #c5d0f0;border-radius:8px;padding:10px;margin:8px 0;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px"><div><label style="font-size:.7rem;color:#555;display:block">Date</label><input type="date" value="'+e.record_date+'" onchange="injUpdateRecord(\''+e.id+'\',\'record_date\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"></div><div><label style="font-size:.7rem;color:#555;display:block">Time</label><input type="time" value="'+(e.record_time||'')+'" onchange="injUpdateRecord(\''+e.id+'\',\'record_time\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"></div><div><label style="font-size:.7rem;color:#555;display:block">Pre Lbs</label><input type="number" step="0.01" value="'+e.pre_injection_lbs+'" onchange="injUpdateRecord(\''+e.id+'\',\'pre_injection_lbs\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"></div><div><label style="font-size:.7rem;color:#555;display:block">Post Lbs</label><input type="number" step="0.01" value="'+e.post_injection_lbs+'" onchange="injUpdateRecord(\''+e.id+'\',\'post_injection_lbs\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"></div><div><label style="font-size:.7rem;color:#555;display:block">Shift</label><select onchange="injUpdateRecord(\''+e.id+'\',\'shift\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"><option'+(e.shift==='AM'?' selected':'')+'>AM</option><option'+(e.shift==='PM'?' selected':'')+'>PM</option><option'+(e.shift==='Night'?' selected':'')+'>Night</option></select></div><div><label style="font-size:.7rem;color:#555;display:block">Notes</label><input type="text" value="'+(e.notes||'')+'" onchange="injUpdateRecord(\''+e.id+'\',\'notes\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem" placeholder="Notes..."></div></div>':'')+'</div></div>';
      });
    }
    document.getElementById('widget-content').innerHTML=html;
    if(!userCan('injection','delete')){ document.querySelectorAll('.wbtn-danger').forEach(function(b){ if(b.getAttribute('onclick')&&/injDelete/.test(b.getAttribute('onclick'))) b.style.display='none'; }); }
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

  // Helper: compute yield% from pre/post when total_pct is null
  function getYieldPct(r){
    if(r.total_pct!=null&&r.total_pct!=='')return parseFloat(r.total_pct);
    const pre=parseFloat(r.pre_injection_lbs)||0;
    const post=parseFloat(r.post_injection_lbs)||0;
    if(pre>0&&post>0) return ((post-pre)/pre*100);
    return 0;
  }
  function getBrinePct(r){
    if(r.brine_pct!=null&&r.brine_pct!=='')return parseFloat(r.brine_pct);
    // brine = inj step lbs gained / pre_lbs * 100
    const bd=r.batch_data||{};
    const sd=bd.stepData||{};
    const injStep=sd['inj'];
    if(injStep&&injStep.pct!=null) return parseFloat(injStep.pct)||0;
    return 0;
  }
  function getTotalLbs(r){
    if(r.total_lbs!=null&&r.total_lbs!=='')return parseFloat(r.total_lbs)||0;
    const pre=parseFloat(r.pre_injection_lbs)||0;
    const post=parseFloat(r.post_injection_lbs)||0;
    return post-pre;
  }

  const avgYield=(rows.reduce((s,r)=>s+getYieldPct(r),0)/rows.length).toFixed(1);
  const avgBrine=(rows.reduce((s,r)=>s+getBrinePct(r),0)/rows.length).toFixed(1);
  const totalLbs=rows.reduce((s,r)=>s+(parseFloat(r.post_injection_lbs)||0),0).toLocaleString(undefined,{maximumFractionDigits:0});

  div.innerHTML=`
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
    <div style="background:#e3f2fd;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.5rem;font-weight:700;color:#1a3a6b">${rows.length}</div><div style="font-size:.72rem;color:#666">Batches</div></div>
    <div style="background:#e8f5e9;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.5rem;font-weight:700;color:#2e7d32">${avgYield}%</div><div style="font-size:.72rem;color:#666">Avg Yield</div></div>
    <div style="background:#fff3e0;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.5rem;font-weight:700;color:#e65100">${avgBrine}%</div><div style="font-size:.72rem;color:#666">Avg Brine (INJ)</div></div>
    <div style="background:#f3e5f5;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.5rem;font-weight:700;color:#6a1b9a">${totalLbs}</div><div style="font-size:.72rem;color:#666">Total Post Lbs</div></div>
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
      <th style="padding:7px 8px;text-align:left;min-width:160px">Tests Applied</th>
      <th style="padding:7px 8px;text-align:left">Notes</th>
    </tr></thead>
    <tbody>${rows.map((r,i)=>{
      const bd=r.batch_data||{};
      const steps=(bd.steps||[]).map(s=>s.toUpperCase()).join(', ')||'—';
      const sd=bd.stepData||{};
      // Compact step detail: one line per step
      const stepLines=Object.entries(sd).map(([sid,s])=>{
        const p=[];
        if(s.in!=null)p.push('In:'+s.in);
        if(s.lbs!=null)p.push((s.lbs>=0?'+':'')+s.lbs+'lbs');
        if(s.out!=null)p.push('Out:'+s.out);
        if(s.pct!=null)p.push(parseFloat(s.pct).toFixed(1)+'%');
        return '<div style="white-space:nowrap;font-size:.72rem;color:#444"><b>'+sid.toUpperCase()+'</b> '+p.join(' ')+'</div>';
      }).join('');
      const yPct = getYieldPct(r);
      const bPct = getBrinePct(r);
      const yColor = yPct>10?'#2e7d32':yPct>5?'#1a3a6b':'#c62828';
      return '<tr style="background:'+(i%2?'#f8f9fa':'#fff')+'">'+
        '<td style="padding:6px 8px;white-space:nowrap">'+r.record_date+'</td>'+
        '<td style="padding:6px 8px;white-space:nowrap">'+(r.record_time||'—')+'</td>'+
        '<td style="padding:6px 8px">'+(r.category||'—')+'</td>'+
        '<td style="padding:6px 8px;white-space:nowrap">'+(r.item||'—')+'</td>'+
        '<td style="padding:6px 8px;text-align:right">'+(parseFloat(r.pre_injection_lbs)||0).toLocaleString()+'</td>'+
        '<td style="padding:6px 8px;text-align:right">'+(parseFloat(r.post_injection_lbs)||0).toLocaleString()+'</td>'+
        '<td style="padding:6px 8px;text-align:right">'+bPct.toFixed(1)+'%</td>'+
        '<td style="padding:6px 8px;text-align:right;font-weight:700;color:'+yColor+'">'+yPct.toFixed(1)+'%</td>'+
        '<td style="padding:6px 8px"><div style="font-size:.78rem;color:#333;margin-bottom:2px">'+steps+'</div>'+stepLines+'</td>'+
        '<td style="padding:6px 8px;font-size:.78rem;color:#555">'+(r.notes||'')+'</td>'+
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

  function getYieldPct(r){
    if(r.total_pct!=null&&r.total_pct!=='')return parseFloat(r.total_pct);
    const pre=parseFloat(r.pre_injection_lbs)||0, post=parseFloat(r.post_injection_lbs)||0;
    return pre>0&&post>0?(post-pre)/pre*100:0;
  }
  function getBrinePct(r){
    if(r.brine_pct!=null&&r.brine_pct!=='')return parseFloat(r.brine_pct);
    const sd=(r.batch_data||{}).stepData||{};
    return parseFloat((sd['inj']||{}).pct)||0;
  }

  const avgYield=(rows.reduce((s,r)=>s+getYieldPct(r),0)/rows.length).toFixed(1);
  const avgBrine=(rows.reduce((s,r)=>s+getBrinePct(r),0)/rows.length).toFixed(1);
  const totalPostLbs=rows.reduce((s,r)=>s+(parseFloat(r.post_injection_lbs)||0),0).toLocaleString(undefined,{maximumFractionDigits:0});
  const filterStr=[cat!=='All Categories'?'Category: '+cat:'',item!=='All Sizes'?'Size: '+item:'',from?'From: '+from:'',to?'To: '+to:''].filter(Boolean).join(' | ')||'All Records';

  const tableRows=rows.map(r=>{
    const bd=r.batch_data||{};
    const steps=(bd.steps||[]).map(s=>s.toUpperCase()).join(', ')||'None';
    const sd=bd.stepData||{};
    const stepDetail=Object.entries(sd).map(([sid,s])=>{
      const p=[];
      if(s.in!=null)p.push('In: '+s.in+' lbs');
      if(s.lbs!=null)p.push((s.lbs>=0?'+':'')+s.lbs+' lbs');
      if(s.out!=null)p.push('Out: '+s.out+' lbs');
      if(s.pct!=null)p.push(parseFloat(s.pct).toFixed(1)+'%');
      return '<b>'+sid.toUpperCase()+':</b> '+p.join(' | ');
    }).join('<br>');
    const yPct=getYieldPct(r), bPct=getBrinePct(r);
    return '<tr><td style="white-space:nowrap">'+r.record_date+'</td>'+
      '<td>'+(r.record_time||'—')+'</td>'+
      '<td>'+(r.category||'—')+'</td>'+
      '<td>'+(r.item||'—')+'</td>'+
      '<td style="text-align:right">'+(parseFloat(r.pre_injection_lbs)||0).toLocaleString()+'</td>'+
      '<td style="text-align:right">'+(parseFloat(r.post_injection_lbs)||0).toLocaleString()+'</td>'+
      '<td style="text-align:right">'+bPct.toFixed(1)+'%</td>'+
      '<td style="text-align:right;font-weight:700">'+yPct.toFixed(1)+'%</td>'+
      '<td>'+steps+'<br><span style="font-size:.8rem">'+stepDetail+'</span></td>'+
      '<td>'+(r.notes||'')+'</td></tr>';
  }).join('');

  const html='<div style="background:#f5f5f5;padding:12px;border-radius:6px;margin-bottom:16px;font-size:.85rem">'+
    '<b>Filters:</b> '+filterStr+'<br>'+
    '<b>Batches:</b> '+rows.length+' &nbsp;|&nbsp; '+
    '<b>Avg Yield%:</b> '+avgYield+'% &nbsp;|&nbsp; '+
    '<b>Avg Brine (INJ)%:</b> '+avgBrine+'% &nbsp;|&nbsp; '+
    '<b>Total Post Lbs:</b> '+totalPostLbs+
    '</div>'+(userCan('injection','edit')?'<div style="background:#f0f4ff;border:1px solid #c5d0f0;border-radius:8px;padding:10px;margin:8px 0;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px"><div><label style="font-size:.7rem;color:#555;display:block">Date</label><input type="date" value="'+r.record_date+'" onchange="injUpdateRecord(\''+r.id+'\',\'record_date\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"></div><div><label style="font-size:.7rem;color:#555;display:block">Time</label><input type="time" value="'+(r.record_time||'')+'" onchange="injUpdateRecord(\''+r.id+'\',\'record_time\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"></div><div><label style="font-size:.7rem;color:#555;display:block">Pre Lbs</label><input type="number" step="0.01" value="'+r.pre_injection_lbs+'" onchange="injUpdateRecord(\''+r.id+'\',\'pre_injection_lbs\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"></div><div><label style="font-size:.7rem;color:#555;display:block">Post Lbs</label><input type="number" step="0.01" value="'+r.post_injection_lbs+'" onchange="injUpdateRecord(\''+r.id+'\',\'post_injection_lbs\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"></div><div><label style="font-size:.7rem;color:#555;display:block">Shift</label><select onchange="injUpdateRecord(\''+r.id+'\',\'shift\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem"><option'+(r.shift==='AM'?' selected':'')+'>AM</option><option'+(r.shift==='PM'?' selected':'')+'>PM</option><option'+(r.shift==='Night'?' selected':'')+'>Night</option></select></div><div><label style="font-size:.7rem;color:#555;display:block">Notes</label><input type="text" value="'+(r.notes||'')+'" onchange="injUpdateRecord(\''+r.id+'\',\'notes\',this.value)" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:.8rem" placeholder="Notes..."></div></div>':'')+
    '<table style="border-collapse:collapse;width:100%;font-size:.82rem">'+
    '<thead><tr style="background:#1a3a6b;color:#fff">'+
    '<th style="padding:7px 8px">Date</th><th>Time</th><th>Category</th><th>Size</th>'+
    '<th style="text-align:right">Pre Lbs</th><th style="text-align:right">Post Lbs</th>'+
    '<th style="text-align:right">Brine%</th><th style="text-align:right">Yield%</th>'+
    '<th>Tests Applied</th><th>Notes</th></tr></thead>'+
    '<tbody>'+tableRows+'</tbody></table>';
  printReport('Injection Calculator Analytics — Pride of the Pond', html);
}


async function injPrintLog() {
  const isAdmin = (typeof currentUser!=='undefined' && currentUser?.role==='admin');
  if(!isAdmin){ toast('Admin access required'); return; }
  let data;
  try { data = await apiCall('GET','/api/records?type=injection&limit=500'); } catch(e){ toast('Error loading data'); return; }
  if(!data||!data.length){ toast('No records to print'); return; }
  function getYieldPct(r){ if(r.total_pct!=null&&r.total_pct!=='')return parseFloat(r.total_pct); const pre=parseFloat(r.pre_injection_lbs)||0,post=parseFloat(r.post_injection_lbs)||0; return pre>0&&post>0?(post-pre)/pre*100:0; }
  function getBrinePct(r){ if(r.brine_pct!=null&&r.brine_pct!=='')return parseFloat(r.brine_pct); const sd=(r.batch_data||{}).stepData||{}; return parseFloat((sd['inj']||{}).pct)||0; }
  const rows = data.sort((a,b)=>b.record_date>a.record_date?1:-1);
  const tableRows = rows.map(r=>{
    const bd=r.batch_data||{}, steps=(bd.steps||[]).map(s=>s.toUpperCase()).join(', ')||'—';
    const sd=bd.stepData||{};
    const detail=Object.entries(sd).map(([sid,s])=>{const p=[];if(s.in!=null)p.push('In:'+s.in);if(s.lbs!=null)p.push((s.lbs>=0?'+':'')+s.lbs+'lbs');if(s.pct!=null)p.push(parseFloat(s.pct).toFixed(1)+'%');return '<b>'+sid.toUpperCase()+':</b> '+p.join(' ');}).join(' &nbsp;|&nbsp; ');
    return '<tr><td>'+r.record_date+'</td><td>'+(r.record_time||'—')+'</td><td>'+(r.shift||'')+'</td><td>'+(r.category||'—')+'</td><td>'+(r.item||'—')+'</td><td style="text-align:right">'+(parseFloat(r.pre_injection_lbs)||0)+'</td><td style="text-align:right">'+(parseFloat(r.post_injection_lbs)||0)+'</td><td style="text-align:right">'+getBrinePct(r).toFixed(1)+'%</td><td style="text-align:right;font-weight:700">'+getYieldPct(r).toFixed(1)+'%</td><td style="font-size:.8rem">'+steps+'<br>'+detail+'</td><td>'+(r.notes||'')+'</td></tr>';
  }).join('');
  const html='<div style="background:#f5f5f5;padding:12px;border-radius:6px;margin-bottom:16px;font-size:.85rem"><b>Total Batches:</b> '+rows.length+' &nbsp;|&nbsp; <b>Generated:</b> '+new Date().toLocaleString()+'</div>'+
    '<table style="border-collapse:collapse;width:100%;font-size:.8rem"><thead><tr style="background:#1a3a6b;color:#fff"><th style="padding:6px">Date</th><th>Time</th><th>Shift</th><th>Category</th><th>Size</th><th style="text-align:right">Pre Lbs</th><th style="text-align:right">Post Lbs</th><th style="text-align:right">Brine%</th><th style="text-align:right">Yield%</th><th>Tests Applied</th><th>Notes</th></tr></thead><tbody>'+tableRows+'</tbody></table>';
  printReport('Injection Batch Log — Pride of the Pond', html);
}


async function injUpdateRecord(id, field, value) {
  if(typeof currentUser==='undefined'||currentUser?.role!=='admin'){toast('Admin only');return;}
  try{await apiCall('PUT','/api/records',{id,type:'injection',field,value});toast('✅ Saved');}
  catch(e){toast('❌ '+e.message);}
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
window.injPrintLog = injPrintLog;
window.injUpdateRecord = injUpdateRecord;

// ════════════════════════════════════════════
// INJECTION CALC — EXCEL IMPORT
// ════════════════════════════════════════════

var INJ_IMPORT_FIELDS = ["record_date","record_time","shift","category","item","pre_injection_lbs","post_injection_lbs","brine_pct","total_lbs","notes"];
var INJ_IMPORT_LABELS = {record_date:"Date",record_time:"Time",shift:"Shift",category:"Category",item:"Item/Product",pre_injection_lbs:"Pre Lbs",post_injection_lbs:"Post Lbs",brine_pct:"Brine %",total_lbs:"Total Lbs",notes:"Notes"};

function injRenderImport() {
  var el = document.getElementById("widget-content");
  el.innerHTML = "";
  var wrap = document.createElement("div");
  wrap.style.cssText = "padding:16px";
  var hdr = document.createElement("div");
  hdr.style.cssText = "margin-bottom:14px";
  hdr.innerHTML = "<div style=\"font-weight:700;font-size:.95rem;color:#1e293b\">📂 Import Excel Batches</div><div style=\"font-size:.75rem;color:#64748b;margin-top:2px\">Upload a spreadsheet — Claude maps the columns, you review and edit before submitting</div>";
  wrap.appendChild(hdr);
  var body = document.createElement("div");
  body.id = "inj-import-body";
  wrap.appendChild(body);
  el.appendChild(wrap);
  injShowImportDropZone();
}

function injShowImportDropZone() {
  var body = document.getElementById("inj-import-body");
  if (!body) return;
  body.innerHTML = "";
  var zone = document.createElement("div");
  zone.id = "inj-drop-zone";
  zone.style.cssText = "border:2px dashed #cbd5e1;border-radius:12px;padding:32px 20px;text-align:center;cursor:pointer;background:#f8fafc;transition:all .2s";
  zone.innerHTML = "<div style=\"font-size:40px;margin-bottom:10px\">📊</div><div style=\"font-weight:600;font-size:.95rem;color:#1e293b;margin-bottom:4px\">Click to browse or drag & drop</div><div style=\"font-size:.8rem;color:#94a3b8\">.xlsx · .xls · .csv — any format, Claude maps the columns</div>";
  var fi = document.createElement("input");
  fi.type = "file"; fi.id = "inj-xlsx-input"; fi.accept = ".xlsx,.xls,.csv"; fi.style.display = "none";
  fi.addEventListener("change", function() { if (this.files && this.files[0]) injParseExcel(this.files[0]); });
  zone.appendChild(fi);
  zone.addEventListener("click", function(e) { if (e.target !== fi) fi.click(); });
  zone.addEventListener("dragover", function(e) { e.preventDefault(); zone.style.borderColor="#1a56db"; zone.style.background="#eff6ff"; });
  zone.addEventListener("dragleave", function() { zone.style.borderColor="#cbd5e1"; zone.style.background="#f8fafc"; });
  zone.addEventListener("drop", function(e) {
    e.preventDefault(); zone.style.borderColor="#cbd5e1"; zone.style.background="#f8fafc";
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) injParseExcel(f);
  });
  body.appendChild(zone);
}

async function injParseExcel(file) {
  var body = document.getElementById("inj-import-body");
  if (!body) return;
  body.innerHTML = "<div style=\"text-align:center;padding:32px;color:#64748b\"><div style=\"font-size:28px;margin-bottom:8px\">⏳</div>Reading spreadsheet…</div>";
  if (!window.XLSX) {
    await new Promise(function(res, rej) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  var reader = new FileReader();
  reader.onerror = function() {
    body.innerHTML = "<div style=\"color:#ef4444;padding:16px\">❌ Could not read file.</div>";
    injShowImportDropZone();
  };
  reader.onload = async function(e) {
    try {
      var wb = XLSX.read(e.target.result, {type:"array", cellDates:true});
      var ws = wb.Sheets[wb.SheetNames[0]];
      var raw = XLSX.utils.sheet_to_json(ws, {defval:"", raw:false});
      if (!raw.length) {
        body.innerHTML = "<div style=\"color:#ef4444;padding:16px\">No data found in file.</div>";
        injShowImportDropZone(); return;
      }
      var headers = Object.keys(raw[0]);
      body.innerHTML = "<div style=\"text-align:center;padding:24px;color:#64748b\"><div style=\"font-size:28px;margin-bottom:8px\">🤖</div>Asking Claude to map " + raw.length + " rows…</div>";
      var token = (JSON.parse(localStorage.getItem("potp_v2_session")||"{}").token)||"";
      var prompt = "Injection batch log spreadsheet for a catfish processing facility. Column headers: " + JSON.stringify(headers) + ". Sample rows: " + JSON.stringify(raw.slice(0,3)) + ". Map each column to one of: record_date, record_time, shift (AM/PM/Night), category (product type), item (product name), pre_injection_lbs, post_injection_lbs, brine_pct, total_lbs, steps (soak/inj/dehy/glaze), notes. Return ONLY valid JSON like: {\"record_date\":\"Date\",\"shift\":\"Shift\",\"pre_injection_lbs\":\"Start Weight\"}. Use null for unmatched fields.";
      var aiResp = await fetch("/api/ai", {method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+token}, body:JSON.stringify({query:prompt})}).then(function(r){return r.json();}).catch(function(){return {};});
      var mapping = {};
      try { var txt = aiResp.response||""; var m = txt.match(/\{[\s\S]*\}/); if(m) mapping = JSON.parse(m[0]); } catch(ex){}
      injShowReviewTable(raw, mapping, file.name);
    } catch(ex) {
      body.innerHTML = "<div style=\"color:#ef4444;padding:16px\">❌ Error: " + ex.message + "</div>";
      injShowImportDropZone();
    }
  };
  reader.readAsArrayBuffer(file);
}

function injShowReviewTable(raw, mapping, filename) {
  var body = document.getElementById("inj-import-body");
  if (!body) return;
  window._injImportRows = raw.map(function(row, i) {
    function get(field) { return mapping[field] && row[mapping[field]] !== undefined ? String(row[mapping[field]]).trim() : ""; }
    return { _idx:i, _include:true, record_date:get("record_date"), record_time:get("record_time"), shift:get("shift")||"AM", category:get("category"), item:get("item"), pre_injection_lbs:get("pre_injection_lbs"), post_injection_lbs:get("post_injection_lbs"), brine_pct:get("brine_pct"), total_lbs:get("total_lbs"), steps:get("steps"), notes:get("notes") };
  });
  window._injHiddenCols = {};
  body.innerHTML = "";
  var banner = document.createElement("div");
  banner.style.cssText = "margin-bottom:12px;padding:12px 16px;background:#f0fdf4;border-radius:8px;border-left:3px solid #16a34a;font-size:.85rem;color:#166534";
  banner.innerHTML = "✅ <strong>" + raw.length + " rows</strong> read from <strong>" + filename + "</strong>. Claude mapped the columns — review, edit, delete rows/columns, then submit.";
  body.appendChild(banner);
  var bar = document.createElement("div");
  bar.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px";
  bar.innerHTML = "<span style=\"font-size:.8rem;color:#64748b\">✕ on column header to hide it · 🗑 on row to delete it</span><span style=\"flex:1\"></span>";
  var submitBtn = document.createElement("button");
  submitBtn.textContent = "💾 Submit All Checked";
  submitBtn.style.cssText = "padding:9px 20px;background:#1a56db;color:#fff;border:none;border-radius:8px;font-size:.88rem;font-weight:600;cursor:pointer";
  submitBtn.onclick = injImportSubmit;
  bar.appendChild(submitBtn);
  body.appendChild(bar);
  var scroll = document.createElement("div");
  scroll.style.cssText = "overflow-x:auto";
  var table = document.createElement("table");
  table.id = "inj-import-table";
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:.78rem";
  var thead = document.createElement("thead");
  var hrow = document.createElement("tr");
  hrow.style.background = "#f1f5f9";
  // ✓ and # headers
  ["✓","#"].forEach(function(h) {
    var th = document.createElement("th");
    th.textContent = h;
    th.style.cssText = "padding:6px 8px;border:1px solid #e2e8f0;text-align:center;white-space:nowrap;min-width:30px";
    hrow.appendChild(th);
  });
  // Field headers with delete-column button
  INJ_IMPORT_FIELDS.forEach(function(field) {
    var th = document.createElement("th");
    th.style.cssText = "padding:4px 6px;border:1px solid #e2e8f0;text-align:left;white-space:nowrap;min-width:70px;position:relative";
    th.dataset.col = field;
    var label = document.createElement("span");
    label.textContent = INJ_IMPORT_LABELS[field];
    label.style.cssText = "font-size:.78rem;margin-right:4px";
    var delCol = document.createElement("button");
    delCol.textContent = "✕";
    delCol.title = "Hide this column";
    delCol.style.cssText = "background:#fee2e2;color:#dc2626;border:none;border-radius:3px;cursor:pointer;font-size:.65rem;padding:0 3px;line-height:1.4;margin-left:2px;vertical-align:middle";
    delCol.dataset.col = field;
    delCol.addEventListener("click", function() {
      window._injHiddenCols[this.dataset.col] = true;
      injRenderImportRows();
      // Hide the header
      var allTh = document.querySelectorAll('#inj-import-table th[data-col="'+this.dataset.col+'"]');
      allTh.forEach(function(t){t.style.display='none';});
    });
    th.appendChild(label); th.appendChild(delCol);
    hrow.appendChild(th);
  });
  // Delete-row column header
  var thDel = document.createElement("th");
  thDel.style.cssText = "padding:6px 8px;border:1px solid #e2e8f0;text-align:center;white-space:nowrap;width:32px";
  thDel.textContent = "🗑";
  hrow.appendChild(thDel);
  thead.appendChild(hrow); table.appendChild(thead);
  var tbody = document.createElement("tbody");
  tbody.id = "inj-import-tbody";
  table.appendChild(tbody); scroll.appendChild(table); body.appendChild(scroll);
  var bar2 = document.createElement("div");
  bar2.style.cssText = "margin-top:10px;text-align:right";
  var submitBtn2 = document.createElement("button");
  submitBtn2.textContent = "💾 Submit All Checked";
  submitBtn2.style.cssText = "padding:9px 20px;background:#1a56db;color:#fff;border:none;border-radius:8px;font-size:.88rem;font-weight:600;cursor:pointer";
  submitBtn2.onclick = injImportSubmit;
  bar2.appendChild(submitBtn2); body.appendChild(bar2);
  injRenderImportRows();
}
function injRenderImportRows() {
  var tbody = document.getElementById("inj-import-tbody");
  if (!tbody) return;
  var rows = window._injImportRows || [];
  var hidden = window._injHiddenCols || {};
  tbody.innerHTML = "";
  var IS = "width:100%;padding:3px 5px;border:1px solid #e2e8f0;border-radius:3px;font-size:.75rem;box-sizing:border-box";
  rows.forEach(function(row, i) {
    var tr = document.createElement("tr");
    tr.style.background = row._include ? "" : "#f8fafc";
    tr.style.opacity = row._include ? "" : "0.5";
    // Checkbox
    var tdChk = document.createElement("td");
    tdChk.style.cssText = "padding:3px 6px;border:1px solid #e2e8f0;text-align:center";
    var chk = document.createElement("input");
    chk.type = "checkbox"; chk.checked = row._include; chk.style.cursor = "pointer";
    chk.dataset.rowIdx = i;
    chk.addEventListener("change", function() {
      window._injImportRows[parseInt(this.dataset.rowIdx)]._include = this.checked;
      injRenderImportRows();
    });
    tdChk.appendChild(chk); tr.appendChild(tdChk);
    // Row number
    var tdN = document.createElement("td");
    tdN.textContent = i+1; tdN.style.cssText = "padding:3px 6px;border:1px solid #e2e8f0;color:#94a3b8;text-align:center";
    tr.appendChild(tdN);
    // Fields
    INJ_IMPORT_FIELDS.forEach(function(field) {
      var td = document.createElement("td");
      td.style.cssText = "padding:2px 4px;border:1px solid #e2e8f0";
      td.dataset.col = field;
      if (hidden[field]) { td.style.display = "none"; tr.appendChild(td); return; }
      if (field === "shift") {
        var sel = document.createElement("select");
        sel.style.cssText = IS; sel.dataset.rowIdx = i; sel.dataset.field = field;
        ["AM","PM","Night"].forEach(function(opt) {
          var o = document.createElement("option");
          o.value = opt; o.textContent = opt;
          if (row[field] === opt) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", function() { window._injImportRows[parseInt(this.dataset.rowIdx)][this.dataset.field] = this.value; });
        td.appendChild(sel);
      } else {
        var inp = document.createElement("input");
        inp.type = "text"; inp.value = row[field] || ""; inp.style.cssText = IS;
        inp.style.minWidth = field === "notes" ? "120px" : "65px";
        inp.dataset.rowIdx = i; inp.dataset.field = field;
        inp.addEventListener("input", function() { window._injImportRows[parseInt(this.dataset.rowIdx)][this.dataset.field] = this.value; });
        td.appendChild(inp);
      }
      tr.appendChild(td);
    });
    // Delete row button
    var tdDel = document.createElement("td");
    tdDel.style.cssText = "padding:2px 4px;border:1px solid #e2e8f0;text-align:center";
    var delBtn = document.createElement("button");
    delBtn.textContent = "🗑";
    delBtn.title = "Delete this row";
    delBtn.style.cssText = "background:none;border:none;cursor:pointer;font-size:.85rem;padding:2px 4px;color:#ef4444;border-radius:3px";
    delBtn.dataset.rowIdx = i;
    delBtn.addEventListener("click", function() {
      window._injImportRows.splice(parseInt(this.dataset.rowIdx), 1);
      injRenderImportRows();
    });
    tdDel.appendChild(delBtn); tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
}
async function injImportSubmit() {
  var rows = (window._injImportRows||[]).filter(function(r){return r._include && r.record_date;});
  if (!rows.length) { alert("No rows checked with a date. Fill in dates or check at least one row."); return; }
  var body = document.getElementById("inj-import-body");
  if (body) body.innerHTML = "<div style=\"text-align:center;padding:32px;color:#64748b\"><div style=\"font-size:28px;margin-bottom:8px\">⏳</div>Saving " + rows.length + " batches…</div>";
  var ok = 0; var fail = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var preV = parseFloat(r.pre_injection_lbs)||null;
    var postV = parseFloat(r.post_injection_lbs)||null;
    var brineV = parseFloat(r.brine_pct)||null;
    var totV = parseFloat(r.total_lbs)||(preV&&postV?Math.round((postV-preV)*100)/100:null);
    var stepArr = r.steps ? r.steps.split(/[,\/\s]+/).map(function(s){return s.trim().toLowerCase();}).filter(Boolean) : [];
    try {
      await apiCall("POST","/api/records?type=injection",{
        record_date:r.record_date, record_time:r.record_time||"", shift:r.shift||"AM",
        category:r.category||"", item:r.item||"",
        pre_injection_lbs:preV, post_injection_lbs:postV, brine_pct:brineV, total_pct:brineV, total_lbs:totV,
        batch_data:{steps:stepArr, source:"excel_import"}, notes:r.notes||"", source:"excel_import", locked:true
      });
      ok++;
    } catch(ex) { fail++; }
  }
  window._injImportRows = null;
  if (!body) return;
  body.innerHTML = "";
  var result = document.createElement("div");
  result.style.padding = "16px";
  var box = document.createElement("div");
  box.style.cssText = "padding:20px;background:" + (fail?"#fef2f2":"#f0fdf4") + ";border-radius:10px;text-align:center;margin-bottom:14px";
  box.innerHTML = "<div style=\"font-size:32px;margin-bottom:6px\">" + (fail?"⚠️":"✅") + "</div><div style=\"font-weight:700;font-size:1rem;color:#1e293b;margin-bottom:4px\">" + ok + " batch" + (ok===1?"":"es") + " imported" + (fail?" · "+fail+" failed":"") + "</div><div style=\"font-size:.82rem;color:#64748b\">Records are locked — editing is admin-only.</div>";
  result.appendChild(box);
  var btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;justify-content:center";
  var b1 = document.createElement("button");
  b1.textContent = "📂 Import Another"; b1.style.cssText = "padding:8px 16px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:.85rem;font-weight:600;cursor:pointer";
  b1.onclick = function(){injShowTab(3);};
  var b2 = document.createElement("button");
  b2.textContent = "📋 View Batch Log"; b2.style.cssText = "padding:8px 16px;background:#1a56db;color:#fff;border:none;border-radius:8px;font-size:.85rem;font-weight:600;cursor:pointer";
  b2.onclick = function(){injShowTab(1);};
  btnRow.appendChild(b1); btnRow.appendChild(b2); result.appendChild(btnRow);
  body.appendChild(result);
}
window.injRenderImport = injRenderImport;
window.injShowImportDropZone = injShowImportDropZone;
window.injParseExcel = injParseExcel;
window.injShowReviewTable = injShowReviewTable;
window.injRenderImportRows = injRenderImportRows;
window.injImportSubmit = injImportSubmit;