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