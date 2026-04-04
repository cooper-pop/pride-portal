// trimmer.js - Trimmer Log and Analytics

// trimmer.js - Trimmer Log

function buildTrimmerWidget() {
  var tabs = ["&#x1F4F7; Upload C.A.T.2","&#x2702;&#xFE0F; Manual Entry","&#x1F4CB; History","&#x1F4CA; Analytics"];
  document.getElementById("widget-tabs").innerHTML = tabs.map(function(t,i){ return '<div class="widget-tab'+(i===0?" active":"")+'" onclick="trimShowTab('+i+')">'+t+'</div>'; }).join("");
  trimRows=[trimEmptyRow()]; trimShowTab(0);
}

function trimShowTab(idx) {
  document.querySelectorAll(".widget-tab").forEach(function(t,i){ t.classList.toggle("active",i===idx); });
  if(idx===0)trimRenderUpload(); else if(idx===1)trimRenderForm(); else if(idx===2)trimRenderHistory(); else trimRenderAnalytics();
}

function trimRenderUpload() {
  document.getElementById("widget-content").innerHTML =
    '<div class="wcard"><h3>&#x1F4F7; Upload C.A.T.2 Report</h3>'+
    '<p style="font-size:0.82rem;color:var(--sub);margin-bottom:14px">Upload a PDF or photo of your C.A.T.2 report. Claude reads every row and auto-fills for review.</p>'+
    '<div class="upload-drop-zone">'+
    '<div style="font-size:2rem;margin-bottom:8px">&#x1F4C4;</div>'+
    '<div style="display:flex;gap:10px;margin-top:4px">'+
    '<button onclick="event.stopPropagation();document.getElementById(\'trim-file-input\').click()" style="flex:1;padding:8px;border:1.5px solid var(--blue);border-radius:8px;background:#f0f4ff;color:var(--blue);font-weight:600;cursor:pointer;font-size:0.82rem">📁 Upload File</button>'+
    '<button onclick="event.stopPropagation();document.getElementById(\'trim-camera-input\').click()" style="flex:1;padding:8px;border:1.5px solid var(--green);border-radius:8px;background:#f0fff4;color:var(--green);font-weight:600;cursor:pointer;font-size:0.82rem">📷 Take Photo</button>'+
    '</div>'+
    '<div style="font-size:0.75rem;color:var(--sub);margin-top:6px">PDF, JPG, PNG supported</div></div>'+
    '<input type="file" id="trim-file-input" accept="image/*,application/pdf" style="display:none" onchange="trimHandleFile(this)"/>'+
    '<input type="file" id="trim-camera-input" accept="image/*" capture="environment" style="display:none" onchange="trimHandleFile(this)"/>'+
    '<div id="trim-upload-status" style="display:none;margin-top:12px"></div></div>';
}

async function trimHandleFile(input) {
  var file=input.files[0]; if(!file)return;
  var statusEl=document.getElementById("trim-upload-status");
  statusEl.style.display="block";
  statusEl.innerHTML='<div class="spinner-wrap"><div class="spinner"></div><div>Reading with AI - about 15 seconds...</div></div>';
  try {
    var base64=await new Promise(function(resolve,reject){ var reader=new FileReader(); reader.onload=function(e){resolve(e.target.result.split(",")[1]);}; reader.onerror=reject; reader.readAsDataURL(file); });
    var mediaType=file.type==="application/pdf"?"application/pdf":(file.type||"image/jpeg");
    var result=await apiCall("POST","/api/extract",{image_base64:base64,media_type:mediaType});
    var entries=result.entries||[]; var flagCount=result.flag_count||0;
    trimRows=entries.map(function(e){ return {emp_number:e.emp_number||"",full_name:e.full_name||"",trim_number:e.trim_number||"",minutes_worked:e.total_minutes||e.minutes_worked||"",incoming_lbs:e.incoming_lbs||"",fillet_lbs:e.fillet_lbs||"",nugget_lbs:e.nugget_lbs||"",misccut_lbs:e.misccut_lbs||"",fillet_yield_pct:e.fillet_yield_pct||"",nugget_yield_pct:e.nugget_yield_pct||"",misccut_yield_pct:e.misccut_yield_pct||"",total_yield_pct:e.total_yield_pct||"",realtime_lbs_per_hour:e.realtime_lbs_per_hour||"",eighthour_lbs_per_hour:e.eighthour_lbs_per_hour||"",hours_worked:e.hours_worked||"",flagged:e.flagged||false,validation_flags:e.validation_flags||[]}; });
    if(!trimRows.length)trimRows=[trimEmptyRow()];
    var fm=flagCount>0?' - <span style="color:var(--gold)">&#x26A0; '+flagCount+' row'+(flagCount>1?'s':'')+' flagged</span>':"";
    statusEl.innerHTML='<div style="background:#e8f5e9;border-radius:8px;padding:10px 14px;font-size:0.85rem;color:#1b5e20;font-weight:600">&#x2705; Extracted '+entries.length+' trimmers from '+(result.report_date||'report')+fm+'</div>';
    setTimeout(function(){ trimShowTab(1); if(flagCount>0)toast('&#x26A0; '+flagCount+' row'+(flagCount>1?' need':' needs')+' review'); if(result.report_date){var d=document.getElementById("trim-date");if(d)d.value=result.report_date;} },1200);
  } catch(err){ statusEl.innerHTML='<div style="background:#fef0f0;border-radius:8px;padding:10px 14px;font-size:0.85rem;color:var(--red)">&#x26A0; Extraction failed: '+err.message+'</div>'; }
}

function trimEmptyRow(){ return {emp_number:"",full_name:"",trim_number:"",minutes_worked:"",incoming_lbs:"",fillet_lbs:"",nugget_lbs:"",misccut_lbs:"",flagged:false,validation_flags:[],total_lbs:''}; }

function trimRenderForm() {
  var nd=new Date(); var _ed=document.getElementById('trim-date')?.value; if(_ed) nd=new Date(_ed+'T12:00:00'); var hf=trimRows.some(function(r){return r.flagged;});
  var tr2=trimRows.map(function(r,i){
    var mins=parseFloat(r.minutes_worked)||0,inc=parseFloat(r.incoming_lbs)||0;
    var lph=r.realtime_lbs_per_hour||(mins>0&&inc>0?(inc/(mins/60)).toFixed(1):"-");
    var bg=r.flagged?'style="background:#fffbe6"':'';
    var tip=r.flagged&&r.validation_flags&&r.validation_flags[0]?'<div style="font-size:0.65rem;color:var(--gold);margin-top:2px">&#x26A0; '+r.validation_flags[0].message+'</div>':"";
    return '<tr '+bg+'><td><input type="text" value="'+(r.emp_number||'')+'" oninput="trimUpdate('+i+',\'emp_number\',this.value)" placeholder="Emp#" style="width:56px"/></td>'+
      '<td><div><input type="text" value="'+(r.full_name||'')+'" oninput="trimUpdate('+i+',\'full_name\',this.value)" placeholder="Name" style="width:110px"/>'+tip+'</div></td>'+
      '<td><input type="text" value="'+(r.trim_number||'')+'" oninput="trimUpdate('+i+',\'trim_number\',this.value)" placeholder="Code" style="width:60px"/></td>'+
      '<td><input type="number" value="'+(r.minutes_worked||'')+'" oninput="trimUpdate('+i+',\'minutes_worked\',this.value)" step="1" style="width:58px"/></td>'+
      '<td><input type="number" value="'+(r.incoming_lbs||'')+'" oninput="trimUpdate('+i+',\'incoming_lbs\',this.value)" step="0.1" style="width:70px"/></td>'+
      '<td><input type="number" value="'+(r.fillet_lbs||'')+'" oninput="trimUpdate('+i+',\'fillet_lbs\',this.value)" step="0.1" style="width:70px"/></td>'+
      '<td><input type="number" value="'+(r.nugget_lbs||'')+'" oninput="trimUpdate('+i+',\'nugget_lbs\',this.value)" step="0.1" style="width:70px"/></td>'+
      '<td><input type="number" value="'+(r.misccut_lbs||'')+'" oninput="trimUpdate('+i+',\'misccut_lbs\',this.value)" step="0.1" style="width:70px"/></td>'+
      '<td><input type="number" value="'+(r.total_lbs||(parseFloat(r.fillet_lbs||0)+parseFloat(r.nugget_lbs||0)+parseFloat(r.misccut_lbs||0)).toFixed(1))+'" oninput="trimUpdate('+i+',\'total_lbs\',this.value)" step="0.1" style="width:70px"/></td>'+
      '<td class="calc-cell">'+lph+'</td>'+
      '<td class="del-cell"><button class="del-btn" onclick="trimDeleteRow('+i+')">&#x2715;</button></td></tr>';
  }).join('');
  var fb=hf?'<div style="background:#fffbe6;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:0.83rem;color:#7a5500"><strong>&#x26A0; Flagged rows highlighted.</strong> Review before saving.</div>':"";
  document.getElementById("widget-content").innerHTML=fb+
    '<div class="wcard"><h3>&#x1F4C5; Report Info</h3><div class="wrow"><div class="wfield"><label>Date</label><input type="date" id="trim-date" value="'+nd.toISOString().split("T")[0]+'"/></div><div class="wfield"><label>Shift</label><select id="trim-shift"><option>AM</option><option>PM</option></select></div></div><div class="wfield"><label>Notes</label><input type="text" id="trim-notes" placeholder="Any observations..."/></div></div>'+
    '<div class="wcard"><h3>&#x2702;&#xFE0F; Trimmer Entries <span style="font-size:0.75rem;font-weight:400;color:var(--sub)">'+trimRows.length+' rows</span></h3>'+
    '<div class="trim-table-wrap"><table class="trim-table"><thead><tr><th>Emp#</th><th>Name</th><th>Code</th><th>Min</th><th>In lbs</th><th>Fillet</th><th>Nugget</th><th>Misc-cut</th><th>Total lbs</th><th>Total %</th><th>Lbs/Hr</th><th></th></tr></thead><tbody id="trim-tbody">'+tr2+'</tbody></table></div>'+
    '<div class="wbtn-row" style="margin-top:10px"><button class="wbtn wbtn-outline" onclick="trimAddRow()">+ Add Row</button></div></div>'+
    '<div class="wbtn-row"><button class="wbtn wbtn-green" onclick="trimSave()">&#x1F4BE; Save Report</button><button class="wbtn wbtn-danger" onclick="trimReset()">Clear All</button></div>';
}

function trimUpdate(i,field,val){ trimRows[i][field]=val; var m=parseFloat(trimRows[i].minutes_worked)||0,n=parseFloat(trimRows[i].incoming_lbs)||0; var tb=document.getElementById("trim-tbody"); if(!tb)return; var rw=tb.rows[i]; if(rw)rw.cells[10].textContent=m>0&&n>0?(n/(m/60)).toFixed(1):"-"; }

function trimAddRow(){ trimRows.push(trimEmptyRow()); trimRenderForm(); }

function trimDeleteRow(i){ if(trimRows.length<=1){trimRows[0]=trimEmptyRow();trimRenderForm();return;} trimRows.splice(i,1); trimRenderForm(); }

function trimReset(){ trimRows=[trimEmptyRow()]; trimRenderForm(); }

async function trimSave() {
  var date=document.getElementById("trim-date").value, shift=document.getElementById("trim-shift").value;
  if(!date){toast("Set the date.");return;}
  var vr=trimRows.filter(function(r){return r.full_name||r.emp_number;});
  if(!vr.length){toast("Add at least one entry.");return;}
  var fr=vr.filter(function(r){return r.flagged;});
  if(fr.length&&!confirm(fr.length+" row"+(fr.length>1?"s are":" is")+" flagged. Save anyway?"))return;
  setSyncBadge("syncing");
  try{ await apiCall("POST","/api/records?type=trimmer",{report_date:date,shift:shift,notes:document.getElementById("trim-notes").value.trim(),source:"cat2_upload",entries:vr}); setSyncBadge("synced"); toast("Report saved - "+vr.length+" trimmers recorded!"); trimRows=[trimEmptyRow()]; trimRenderForm(); }
  catch(err){ setSyncBadge("error"); toast("Save failed: "+err.message); }
}

async function trimSaveEntry(entryId, reportId) {
  var row = document.getElementById('erow-'+entryId);
  var inputs = row.querySelectorAll('.hist-inp');
  var data = { entry_id: entryId };
  inputs.forEach(function(inp){ data[inp.dataset.field] = inp.value; });
  // recalc yields
  var inc = parseFloat(data.incoming_lbs)||0;
  var fil = parseFloat(data.fillet_lbs)||0;
  var nug = parseFloat(data.nugget_lbs)||0;
  var mis = parseFloat(data.misccut_lbs)||0;
  data.fillet_yield_pct  = inc>0?(fil/inc*100):0;
  data.nugget_yield_pct  = inc>0?(nug/inc*100):0;
  data.misccut_yield_pct = inc>0?(mis/inc*100):0;
  data.total_lbs = fil+nug+mis;
  data.total_yield_pct = inc>0?(data.total_lbs/inc*100):0;
  data.minutes_worked = parseFloat(data.minutes_worked)||0;
  data.realtime_lbs_per_hour = data.minutes_worked>0?(data.total_lbs/(data.minutes_worked/60)):0;
  try {
    await apiCall('PATCH', '/api/records', { type:'entry', ...data });
    toast('✅ Saved');
    trimRenderHistory();
  } catch(e) { toast('❌ Save failed: '+e.message); }
}

async function trimDeleteEntry(entryId, btn) {
  // no confirm needed - button is deliberate
  try {
    await apiCall('DELETE', '/api/records?type=trimmer-entry&id='+entryId);
    trimDeletedIds.add(entryId);
    // Remove the row from DOM immediately - no full reload needed
    const row = btn && btn.closest ? btn.closest('tr') : null;
    if (row) { row.style.opacity='0.3'; row.style.transition='opacity 0.2s'; setTimeout(()=>row.remove(),200); }
    else trimRenderHistory();
    toast('Entry deleted');
  } catch(e) { toast('❌ '+e.message); }
}

async function trimDeleteReport(reportId) {
  // no confirm needed - button is deliberate
  try {
    await apiCall('DELETE', '/api/records?type=trimmer&id='+reportId);
    toast('Report deleted');
    trimRenderHistory();
  } catch(e) { toast('❌ '+e.message); }
}

async function trimRenderHistory() {
    const isAdmin = currentUser && currentUser.role === 'admin';
    const wc = document.getElementById('widget-content');
    wc.innerHTML = '<div style="padding:8px"><div id="trim-history-wrap"><div class="spinner-wrap"><div class="spinner"></div><div>Loading history…</div></div></div></div>';
    let reports = [];
    try {
      const data = await apiCall('GET', '/api/records?type=trimmer');
      reports = Array.isArray(data) ? data : [];
    } catch(e) { document.getElementById('trim-history-wrap').innerHTML = '<p style="color:#ef4444;padding:16px">Failed to load: '+e.message+'</p>'; return; }
    const wrap = document.getElementById('trim-history-wrap');
    if (!reports.length) { wrap.innerHTML = '<p style="color:var(--sub);text-align:center;padding:24px">No reports found.</p>'; return; }
    const sorted = [...reports].sort((a,b) => new Date(b.report_date) - new Date(a.report_date));
    let html = '';
    sorted.forEach(rpt => {
      const d = (rpt.report_date||'').slice(0,10);
      const entries = rpt.entries || [];
      const totalLbs = entries.reduce((s,e) => s+(parseFloat(e.total_lbs)||0),0);
      html += '<div class="wcard" style="margin-bottom:16px">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
      html += '<div><div style="font-weight:700">'+(isAdmin ? '<input type="date" value="'+d+'" data-id="'+rpt.id+'" onchange="trimUpdateDate(this)" style="font-size:0.95rem;font-weight:700;border:none;border-bottom:2px solid var(--blue);background:transparent;cursor:pointer;color:inherit;padding:0"/>' : d)+' — '+(rpt.shift||'')+' Shift</div>';
      html += '<div style="font-size:0.78rem;color:var(--sub)">'+entries.length+' trimmers · '+totalLbs.toFixed(1)+' total lbs</div></div>';
      if (isAdmin) html += '<button onclick="trimDeleteReport(\''+rpt.id+'\',this)" style="background:none;border:1px solid #fca5a5;color:#ef4444;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:0.75rem">🗑 Delete Report</button>';
      html += '</div>';
      if (isAdmin) html += '<div style="font-size:0.7rem;color:var(--sub);margin-bottom:4px">✏️ Click any value to edit — saves automatically.</div>';
      html += '<div style="overflow-x:auto"><table class="trim-table" style="width:100%;font-size:0.76rem"><thead><tr>';
      ['Emp#','Name','Code','Min','In Lbs','Fillet','F%','Nugget','N%','MiscCut','MC%','Tot Lbs','Tot%','Lbs/Hr',''].forEach(h => { html += '<th>'+h+'</th>'; });
      html += '</tr></thead><tbody>';
      entries.filter(e => !trimDeletedIds.has(e.id)).forEach(e => {
        const ei = (id,field,val,w) => '<td><input class="hist-edit" data-id="'+id+'" data-field="'+field+'" value="'+(val||'')+'" style="width:'+w+'px;font-size:0.74rem;border:none;border-bottom:1px solid #e2e8f0;background:transparent;text-align:center;padding:2px" onchange="trimSaveCell(this)"/></td>';
        html += '<tr>';
        if (isAdmin) {
          html += ei(e.id,'emp_number',e.emp_number,44);
          html += ei(e.id,'full_name',e.full_name,110);
          html += ei(e.id,'trim_number',e.trim_number,54);
          html += ei(e.id,'minutes_worked',e.minutes_worked,38);
          html += ei(e.id,'incoming_lbs',e.incoming_lbs,50);
          html += ei(e.id,'fillet_lbs',e.fillet_lbs,46);
          html += '<td>'+(parseFloat(e.fillet_yield_pct)||0).toFixed(1)+'%</td>';
          html += ei(e.id,'nugget_lbs',e.nugget_lbs,46);
          html += '<td>'+(parseFloat(e.nugget_yield_pct)||0).toFixed(1)+'%</td>';
          html += ei(e.id,'misccut_lbs',e.misccut_lbs,46);
          html += '<td>'+(parseFloat(e.misccut_yield_pct)||0).toFixed(1)+'%</td>';
          html += '<td>'+(parseFloat(e.total_lbs)||0).toFixed(1)+'</td>';
          html += '<td>'+(parseFloat(e.total_yield_pct)||0).toFixed(1)+'%</td>';
          html += '<td>'+(parseFloat(e.realtime_lbs_per_hour)||0).toFixed(1)+'</td>';
          html += '<td><button onclick="trimDeleteEntry(\''+e.id+'\',this)" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:1rem;padding:0 4px">✕</button></td>';
        } else {
          html += '<td>'+(e.emp_number||'')+'</td><td>'+(e.full_name||'')+'</td><td>'+(e.trim_number||'')+'</td>';
          html += '<td>'+(e.minutes_worked||0)+'</td><td>'+(e.incoming_lbs||0)+'</td>';
          html += '<td>'+(e.fillet_lbs||0)+'</td><td>'+(parseFloat(e.fillet_yield_pct)||0).toFixed(1)+'%</td>';
          html += '<td>'+(e.nugget_lbs||0)+'</td><td>'+(parseFloat(e.nugget_yield_pct)||0).toFixed(1)+'%</td>';
          html += '<td>'+(e.misccut_lbs||0)+'</td><td>'+(parseFloat(e.misccut_yield_pct)||0).toFixed(1)+'%</td>';
          html += '<td>'+(parseFloat(e.total_lbs)||0).toFixed(1)+'</td><td>'+(parseFloat(e.total_yield_pct)||0).toFixed(1)+'%</td>';
          html += '<td>'+(parseFloat(e.realtime_lbs_per_hour)||0).toFixed(1)+'</td><td></td>';
        }
        html += '</tr>';
      });
      html += '</tbody></table></div></div>';
    });
    wrap.innerHTML = html;
  }

  async function trimUpdateDate(input) {
    const reportId = input.dataset.id;
    const newDate = input.value;
    if (!newDate) return;
    input.style.borderBottom = '2px solid #f59e0b';
    try {
      await apiCall('PATCH', '/api/records?type=trimmer&id='+reportId, { report_date: newDate });
      input.style.borderBottom = '2px solid #22c55e';
      setTimeout(()=>{ input.style.borderBottom='2px solid var(--blue)'; },1500);
    } catch(e) { input.style.borderBottom='2px solid #ef4444'; toast('Date save failed'); }
  }

  async function trimSaveCell(input) {
    const id = input.dataset.id;
    const field = input.dataset.field;
    const val = input.value.trim();
    input.style.borderBottom = '2px solid #f59e0b';
    try {
      const numFields = ['minutes_worked','incoming_lbs','fillet_lbs','nugget_lbs','misccut_lbs','total_lbs'];
      const body = { id };
      body[field] = numFields.includes(field) ? (parseFloat(val)||0) : val;
      await apiCall('PATCH', '/api/records?type=trimmer-entry', body);
      input.style.borderBottom = '2px solid #22c55e';
      setTimeout(()=>{ input.style.borderBottom='1px solid #e2e8f0'; },1500);
    } catch(e) { input.style.borderBottom = '2px solid #ef4444'; toast('Save failed'); }
  }

function buildAIWidget() {
  aiHistory = [];
  document.getElementById('widget-tabs').innerHTML = '';
  document.getElementById('ai-input-area').style.display = 'block';
  setTimeout(function(){var b=document.querySelector('[data-print-ai]');if(b)b.addEventListener('click',function(){printReport('AI Analysis Report',document.getElementById('ai-chat').innerHTML);});},100);
  document.getElementById('widget-content').innerHTML =
    '<div class="wcard" style="margin-bottom:8px"><div style="font-size:0.85rem;font-weight:700;color:var(--purple);margin-bottom:8px">🤖 Ask anything about your data</div>' +
    '<div class="ai-quick">'+
    ['Who are the top trimmers this week?','Show weekly employee rankings','Who is underperforming and why?','Injection pickup trend last 30 days','Compare AM vs PM shift yield','Generate monthly summary'].map(function(q){
      return '<button class="ai-quick-btn" onclick="aiAsk(\''+q+'\')">'+q+'</button>';
    }).join('')+'</div></div>' +
    '<div style="display:flex;justify-content:flex-end;padding:4px 0"><button onclick="printReport(\'AI Analysis Report\',document.getElementById(\'ai-chat\').innerHTML)" style="font-size:0.75rem;padding:4px 10px;border:1px solid #1a3a6b;border-radius:4px;background:#fff;color:#1a3a6b;cursor:pointer">🖨️ Print</button></div><div class="ai-chat" id="ai-chat"></div>';
}

function aiAsk(q) {
  document.getElementById('ai-input').value = q;
  aiSend();
}

async function aiSend() {
  var input = document.getElementById('ai-input');
  var q = input.value.trim();
  if (!q) return;
  input.value = '';
  var btn = document.getElementById('ai-send-btn');
  btn.disabled = true; btn.textContent = '...';
  var chat = document.getElementById('ai-chat');
  if (!chat) return;
  chat.innerHTML += '<div class="ai-msg user">'+q+'</div>';
  chat.innerHTML += '<div class="ai-msg assistant" id="ai-thinking">⏳ Analyzing your data...</div>';
  chat.scrollTop = chat.scrollHeight;
  try {
    var data = await apiCall('POST','/api/ai',{ query: q });
    var thinkEl = document.getElementById('ai-thinking');
    if (thinkEl) { var _t=data.response,_h=_t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); _h=_h.replace(/((?:[^\n]*\|[^\n]*\n)+)/g,function(blk){var rows=blk.trim().split('\n').filter(function(l){return l.trim()&&!/^[\s|:-]+$/.test(l.trim());});if(rows.length<2)return blk;var out='<table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:0.85rem">';rows.forEach(function(row,ri){var cells=row.split('|').slice(1,-1);var tag=ri===0?'th':'td';var st=ri===0?'background:#1e3a8a;color:#fff;padding:4px 8px;text-align:left':'padding:3px 8px;border-bottom:1px solid #e2e8f0';out+='<tr>'+cells.map(function(c){return'<'+tag+' style="'+st+'">'+c.trim()+'</'+tag+'>';}).join('')+'</tr>';});return out+'</table>';}); _h=_h.replace(/^## (.+)$/gm,'<h3 style="margin:10px 0 5px;font-size:.98rem;color:#1e3a8a;border-bottom:1px solid #e2e8f0;padding-bottom:3px">$1</h3>').replace(/^### (.+)$/gm,'<h4 style="margin:8px 0 3px;font-size:.88rem;color:#1e3a8a">$1</h4>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/^[-*] (.+)$/gm,'<li style="margin:2px 0 2px 16px">$1</li>').replace(/^\d+\. (.+)$/gm,'<li style="margin:2px 0 2px 16px">$1</li>').replace(/\n\n+/g,'</p><p style="margin:6px 0">').replace(/\n/g,'<br>'); thinkEl.innerHTML='<p style="margin:0">'+_h+'</p>'; }
    else chat.innerHTML += '<div class="ai-msg assistant">'+data.response+'</div>';
  } catch(e) {
    var thinkEl2 = document.getElementById('ai-thinking');
    if (thinkEl2) thinkEl2.textContent = '⚠️ Error: '+e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Send';
    chat.scrollTop = chat.scrollHeight;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — USER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════
function buildAdminWidget() {
  document.getElementById('widget-tabs').innerHTML = ['👥 Users','➕ Add User'].map(function(t,i){
    return '<div class="widget-tab'+(i===0?' active':'')+'" onclick="adminShowTab('+i+')">'+t+'</div>';
  }).join('');
  adminShowTab(0);
}

function adminShowTab(idx) {
  document.querySelectorAll('.widget-tab').forEach(function(t,i){ t.classList.toggle('active',i===idx); });
  if (idx===0) adminRenderUsers(); else adminRenderAddUser();
}

async function adminRenderUsers() {
  document.getElementById('widget-content').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>Loading...</div>';
  try {
    var users = await apiCall('GET','/api/users');
    var rolePillClass = { admin:'role-admin', manager:'role-manager', supervisor:'role-supervisor' };
    var html = '<div class="wcard" style="padding:10px 14px;font-size:0.82rem;font-weight:700;color:var(--blue)">'+users.length+' user'+(users.length===1?'':'s')+' — '+currentUser.company_name+'</div>';
    if (!users.length) html += '<div class="log-empty">No users yet.</div>';
    else {
      users.forEach(function(u){
        var isMe = u.id === currentUser.id;
        html += '<div class="user-row"><div><div class="user-row-name">'+u.full_name+(isMe?' <span style="font-size:0.7rem;color:var(--sub)">(you)</span>':'')+'</div><div class="user-row-meta">@'+u.username+'</div></div><span class="role-pill '+(rolePillClass[u.role]||'role-supervisor')+'">'+u.role+'</span>'+(isMe?'':'<button class="wbtn wbtn-danger" style="padding:4px 9px;font-size:0.72rem" onclick="adminDeleteUser(\''+u.id+'\',\''+u.full_name+'\')">Remove</button>')+'</div>';
      });
    }
    document.getElementById('widget-content').innerHTML = html;
  } catch(e){ document.getElementById('widget-content').innerHTML='<div class="log-empty">⚠️ '+e.message+'</div>'; }
}

function adminRenderAddUser() {
  document.getElementById('widget-content').innerHTML =
    '<div class="wcard"><h3>➕ Add New User</h3>' +
    '<div class="wfield"><label>Full Name</label><input type="text" id="nu-name" placeholder="John Smith"/></div>' +
    '<div class="wfield"><label>Username</label><input type="text" id="nu-user" placeholder="jsmith" autocapitalize="none"/></div>' +
    '<div class="wfield"><label>Password</label><input type="password" id="nu-pass" placeholder="Set a strong password"/></div>' +
    '<div class="wfield"><label>Role</label><select id="nu-role"><option value="supervisor">Supervisor</option><option value="manager">Manager</option><option value="admin">Admin</option></select></div>' +
    '<div class="wbtn-row"><button class="wbtn wbtn-primary" onclick="adminAddUser()">Create User</button></div></div>';
}

async function adminAddUser() {
  var name = document.getElementById('nu-name').value.trim();
  var user = document.getElementById('nu-user').value.trim();
  var pass = document.getElementById('nu-pass').value;
  var role = document.getElementById('nu-role').value;
  if (!name||!user||!pass) { toast('All fields required.'); return; }
  if (pass.length < 6) { toast('Password must be at least 6 characters.'); return; }
  try {
    await apiCall('POST','/api/users',{ full_name:name, username:user, password:pass, role:role });
    toast('✅ User '+name+' created!');
    adminShowTab(0);
  } catch(e){ toast('⚠️ '+e.message); }
}

async function adminDeleteUser(id, name) {
  if (!confirm('Remove '+name+' from the portal?')) return;
  try { await apiCall('DELETE','/api/users?id='+id); adminRenderUsers(); toast('User removed.'); }
  catch(e){ toast('⚠️ '+e.message); }
}

// ── INIT ─────────────────────────────────────────────────────────────────────
(function init() {
  if (loadSession() && authToken && currentUser && currentCompany) {
    if (currentUser && currentUser.force_password_change) {
      window._pendingPasskeySetup = currentUser && currentUser.needs_passkey_setup;
      showScreen('screen-change-password');
    } else if (currentUser && currentUser.needs_passkey_setup) {
      buildDash(); showScreen('screen-passkey-setup');
    } else {
      buildDash(); showScreen('screen-dash');
    }
  }
})();


// ── PASSKEY SETUP ──────────────────────────────────────────────────────────
async function setupPasskey() {
  try {
    const ch = await apiCall('POST', '/api/passkey?action=register-challenge');
    const credOpts = {
      challenge: base64urlToBuffer(ch.challenge),
      rp: ch.rp,
      user: { id: base64urlToBuffer(ch.user.id), name: ch.user.name, displayName: ch.user.displayName },
      pubKeyCredParams: ch.pubKeyCredParams,
      authenticatorSelection: ch.authenticatorSelection,
      timeout: ch.timeout,
      attestation: ch.attestation
    };
    const cred = await navigator.credentials.create({ publicKey: credOpts });
    await apiCall('POST', '/api/passkey?action=register-verify', {
      credential: {
        id: cred.id,
        rawId: bufferToBase64url(cred.rawId),
        type: cred.type,
        response: {
          clientDataJSON: bufferToBase64url(cred.response.clientDataJSON),
          attestationObject: bufferToBase64url(cred.response.attestationObject)
        }
      },
      device_name: 'iPhone'
    });
    toast('✅ Face ID set up successfully!');
    showScreen('screen-dash');
  } catch(err) {
    toast('Setup failed: ' + err.message);
  }
}

function skipPasskeySetup() {
  showScreen('screen-dash');
  toast('You can set up Face ID later in Settings');
}

function base64urlToBuffer(b64) {
  const s = b64.replace(/-/g,'+').replace(/_/g,'/');
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return arr.buffer;
}
function bufferToBase64url(buf) {
  const arr = new Uint8Array(buf);
  let s = '';
  arr.forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

// ── FORCE PASSWORD CHANGE ──────────────────────────────────────────────────
async function submitPasswordChange() {
  const np = document.getElementById('new-pwd').value;
  const cp = document.getElementById('confirm-pwd').value;
  const err = document.getElementById('chpwd-error');
  err.style.display = 'none';
  if (np.length < 8) { err.textContent='Password must be at least 8 characters'; err.style.display='block'; return; }
  if (np !== cp) { err.textContent='Passwords do not match'; err.style.display='block'; return; }
  try {
    await apiCall('PATCH', '/api/users', { id: currentUser.id, password: np });
    toast('Password updated!');
    buildDash();
    if (window._pendingPasskeySetup) { showScreen('screen-passkey-setup'); }
    else { showScreen('screen-dash'); }
  } catch(e) { err.textContent=e.message; err.style.display='block'; }
}

// ── USER MANAGEMENT ────────────────────────────────────────────────────────
let umEditId = null;

async function loadUserMgmt() {
  showScreen('screen-user-mgmt');
  const wrap = document.getElementById('um-table-wrap');
  wrap.innerHTML = '<div style="text-align:center;padding:40px;color:var(--sub)">Loading...</div>';
  try {
    const users = await apiCall('GET', '/api/users');
    wrap.innerHTML = `<table class="um-table">
      <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Passkey</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td><strong>${u.full_name}</strong></td>
        <td>${u.username}</td>
        <td style="color:var(--sub);font-size:0.82rem">${u.email||'-'}</td>
        <td><span class="role-badge role-${u.role}">${u.role}</span></td>
        <td><span class="status-dot status-${u.active?'active':'inactive'}"></span>${u.active?'Active':'Inactive'}</td>
        <td id="pk-${u.id}" style="font-size:0.82rem;color:var(--sub)">...</td>
        <td>
          <button class="um-action-btn" onclick="umEditUser('${u.id}','${u.full_name}','${u.username}','${u.email||''}','${u.role}')">Edit</button>
          <button class="um-action-btn" onclick="umResetPasskey('${u.id}','${u.full_name}')">Reset Key</button>
          <button class="um-action-btn danger" onclick="umToggleActive('${u.id}',${u.active})">${u.active?'Deactivate':'Activate'}</button>
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
    // Load passkey status per user
    users.forEach(u => loadPasskeyStatus(u.id));
  } catch(e) { wrap.innerHTML = '<div style="color:var(--red);padding:20px">Error: '+e.message+'</div>'; }
}

async function loadPasskeyStatus(uid) {
  try {
    const pks = await apiCall('GET', '/api/passkey?user_id='+uid);
    const el = document.getElementById('pk-'+uid);
    if (el) el.textContent = pks.length ? '✅ '+pks[0].device_name : '⚠️ Not set';
  } catch(e) {}
}

function umShowAddModal() {
  umEditId = null;
  document.getElementById('modal-title').textContent = 'Add User';
  document.getElementById('um-full-name').value = '';
  document.getElementById('um-username').value = '';
  document.getElementById('um-email').value = '';
  document.getElementById('um-role').value = 'supervisor';
  document.getElementById('um-password').value = '';
  document.getElementById('um-pwd-field').style.display = 'block';
  document.getElementById('modal-error').style.display = 'none';
  document.getElementById('user-modal').style.display = 'flex';
}

function umEditUser(id, name, username, email, role) {
  umEditId = id;
  document.getElementById('modal-title').textContent = 'Edit User';
  document.getElementById('um-full-name').value = name;
  document.getElementById('um-username').value = username;
  document.getElementById('um-email').value = email;
  document.getElementById('um-role').value = role;
  document.getElementById('um-password').value = '';
  document.getElementById('um-pwd-field').style.display = 'block';
  document.getElementById('modal-error').style.display = 'none';
  document.getElementById('user-modal').style.display = 'flex';
}

function umCloseModal() { document.getElementById('user-modal').style.display = 'none'; }

async function umSaveUser() {
  const err = document.getElementById('modal-error');
  err.style.display = 'none';
  const full_name = document.getElementById('um-full-name').value.trim();
  const username = document.getElementById('um-username').value.trim();
  const email = document.getElementById('um-email').value.trim();
  const role = document.getElementById('um-role').value;
  const password = document.getElementById('um-password').value;
  if (!full_name || !username) { err.textContent='Name and username required'; err.style.display='block'; return; }
  try {
    if (umEditId) {
      const body = { id: umEditId, full_name, email, role };
      if (password) body.password = password;
      await apiCall('PATCH', '/api/users', body);
      toast('User updated');
    } else {
      const pwd = password || username + Math.floor(100+Math.random()*900) + '!';
      await apiCall('POST', '/api/users', { username, full_name, email, role, password: pwd });
      toast('User created — temp password: ' + pwd);
    }
    umCloseModal();
    loadUserMgmt();
  } catch(e) { err.textContent=e.message; err.style.display='block'; }
}

async function umResetPasskey(uid, name) {
  if (!confirm('Reset passkey for ' + name + '? They will need to set up Face ID again on next login.')) return;
  try {
    const pks = await apiCall('GET', '/api/passkey?user_id='+uid);
    for (const pk of pks) await apiCall('DELETE', '/api/passkey?id='+pk.id);
    toast('Passkey reset for ' + name);
    loadUserMgmt();
  } catch(e) { toast('Error: '+e.message); }
  // Inject print button at top of analytics content
  setTimeout(function(){
    var _wc = document.getElementById('widget-content');
    if(_wc && !_wc.querySelector('.analytics-print-btn')){
      var _pb = document.createElement('div');
      _pb.className = 'analytics-print-btn';
      _pb.style.cssText = 'display:flex;justify-content:flex-end;padding:4px 8px 0';
      _pb.innerHTML = '<button onclick="printReport(\'Trimmer Analytics\',document.getElementById(\'widget-content\').innerHTML)" style="font-size:0.75rem;padding:4px 10px;border:1px solid #1a3a6b;border-radius:4px;background:#fff;color:#1a3a6b;cursor:pointer">🖨️ Print</button>';
      _wc.prepend(_pb);
    }
  }, 100);
}

async function umToggleActive(uid, currentlyActive) {
  const action = currentlyActive ? 'deactivate' : 'activate';
  if (!confirm('Are you sure you want to ' + action + ' this user?')) return;
  try {
    await apiCall('PATCH', '/api/users', { id: uid, active: !currentlyActive });
    toast('User ' + action + 'd');
    loadUserMgmt();
  } catch(e) { toast('Error: '+e.message); }
}

  async