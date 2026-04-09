// trimmer.js - Trimmer Log and Analytics

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
    '<button onclick="event.stopPropagation();document.getElementById(\'trim-file-input\').click()" style="flex:1;padding:8px;border:1.5px solid var(--blue);border-radius:8px;background:#f0f4ff;color:var(--blue);font-weight:600;cursor:pointer;font-size:0.82rem">ð Upload File</button>'+
    '<button onclick="event.stopPropagation();document.getElementById(\'trim-camera-input\').click()" style="flex:1;padding:8px;border:1.5px solid var(--green);border-radius:8px;background:#f0fff4;color:var(--green);font-weight:600;cursor:pointer;font-size:0.82rem">ð· Take Photo</button>'+
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
    toast('â Saved');
    trimRenderHistory();
  } catch(e) { toast('â Save failed: '+e.message); }
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
  } catch(e) { toast('â '+e.message); }
}

async function trimDeleteReport(reportId) {
  // no confirm needed - button is deliberate
  try {
    await apiCall('DELETE', '/api/records?type=trimmer&id='+reportId);
    toast('Report deleted');
    trimRenderHistory();
  } catch(e) { toast('â '+e.message); }
}

async function trimRenderHistory() {
    const isAdmin = currentUser && currentUser.role === 'admin';
    const wc = document.getElementById('widget-content');
    wc.innerHTML = '<div style="padding:8px"><div id="trim-history-wrap"><div class="spinner-wrap"><div class="spinner"></div><div>Loading historyâ¦</div></div></div></div>';
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
      html += '<div><div style="font-weight:700">'+(isAdmin ? '<input type="date" value="'+d+'" data-id="'+rpt.id+'" onchange="trimUpdateDate(this)" style="font-size:0.95rem;font-weight:700;border:none;border-bottom:2px solid var(--blue);background:transparent;cursor:pointer;color:inherit;padding:0"/>' : d)+' â '+(rpt.shift||'')+' Shift</div>';
      html += '<div style="font-size:0.78rem;color:var(--sub)">'+entries.length+' trimmers Â· '+totalLbs.toFixed(1)+' total lbs</div></div>';
      if (isAdmin) html += '<button onclick="trimDeleteReport(\''+rpt.id+'\',this)" style="background:none;border:1px solid #fca5a5;color:#ef4444;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:0.75rem">ð Delete Report</button>';
      html += '</div>';
      if (isAdmin) html += '<div style="font-size:0.7rem;color:var(--sub);margin-bottom:4px">âï¸ Click any value to edit â saves automatically.</div>';
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
          html += '<td><button onclick="trimDeleteEntry(\''+e.id+'\',this)" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:1rem;padding:0 4px">â</button></td>';
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

// trimUpdateDate not found

// trimSaveCell not found

async function trimRenderAnalytics() {
  var el = document.getElementById('widget-content');
  if (!el) return;
  if (!window._trimPeriod) window._trimPeriod = 30;
  el.innerHTML = '<div style="text-align:center;padding:30px"><div class="spinner"></div>Loading...</div>';

  function calcGrade(row) {
    var lph = parseFloat(row.avg_lph || 0);
    var fil = parseFloat(row.avg_fillet_pct || 0);
    var nug = parseFloat(row.avg_nugget_pct || 0);
    var mis = parseFloat(row.avg_misccut_pct || 999);
    var yld = parseFloat(row.avg_total_yield || 0);
    if (lph >= 150 && fil >= 65 && nug >= 20 && mis < 5  && yld >= 90) return {l:'A+',bg:'#059669',c:'#fff'};
    if (lph >= 125 && fil >= 63 && nug >= 19 && mis < 6  && yld >= 85) return {l:'A', bg:'#10b981',c:'#fff'};
    if (lph >= 115 && fil >= 62 && nug >= 18 && mis < 6.5&& yld >= 80) return {l:'B', bg:'#3b82f6',c:'#fff'};
    if (lph >= 110 && fil >= 61 && nug >= 17.5&& mis < 7 && yld >= 75) return {l:'C', bg:'#f59e0b',c:'#fff'};
    if (lph >= 100 && fil >= 61 && nug >= 17  && mis < 7.5&& yld >= 70) return {l:'D', bg:'#f97316',c:'#fff'};
    return {l:'F', bg:'#ef4444', c:'#fff'};
  }

  function pill(label, days, active) {
    return '<button data-d="' + days + '" style="border:none;border-radius:6px;padding:5px 12px;font-size:.75rem;font-weight:600;cursor:pointer;background:' + (active ? '#1a3a6b' : '#f1f5f9') + ';color:' + (active ? '#fff' : '#475569') + '">' + label + '</button>';
  }

  apiCall('GET', '/api/analytics?type=rankings&days=' + window._trimPeriod).then(function(data) {
    var rows = data.rankings || [];
    var teamAvg = parseFloat(data.shift_avg_lph || 0);
    var days = window._trimPeriod;
    var pLabel = days === 7 ? '7' : days === 30 ? '30' : days === 60 ? '60' : 'YTD';

    var h = '<div id="tp" style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">';
    h += pill('7 Day', 7, days===7) + pill('30 Day', 30, days===30) + pill('60 Day', 60, days===60) + pill('YTD', 365, days===365);
    h += '</div>';
    h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
    h += '<h3 style="margin:0;font-size:.88rem;color:#1a3a6b;font-weight:700">&#127942; Rankings &#8212; Last ' + pLabel + ' Days <span style="font-weight:400;font-size:.75rem;color:#64748b">Team avg: ' + teamAvg + ' lbs/hr</span></h3>';
    h += '<button id="tpb" style="background:#1a3a6b;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:.72rem;cursor:pointer">&#128438; Print</button>';
    h += '</div>';
    h += '<div style="overflow-x:auto"><table id="trt" style="width:100%;border-collapse:collapse;font-size:.75rem">';
    h += '<thead><tr style="background:#1a3a6b;color:#fff">';
    var cols = ['#','Name','Days','Avg Lbs/Hr','8Hr Lbs/Hr','Fillet%','Nugget%','MiscCut%','Tot Yield%','Grade','Trend'];
    for (var ci=0; ci<cols.length; ci++) {
      h += '<th style="padding:6px 8px;text-align:' + (ci <= 2 ? 'center' : 'left') + ';white-space:nowrap">' + cols[ci] + '</th>';
    }
    h += '</tr></thead><tbody>';

    for (var ri=0; ri<rows.length; ri++) {
      var r = rows[ri];
      var g = calcGrade(r);
      var lph = parseFloat(r.avg_lph || 0);
      var yld = parseFloat(r.avg_total_yield || 0);
      var fil = r.avg_fillet_pct || '';
      var nug = r.avg_nugget_pct || '';
      var mis = r.avg_misccut_pct || '';
      var nm = r.full_name || '';
      var sid = nm.replace(/[^a-zA-Z0-9]/g, '_') + '_' + ri;
      var under = r.underperformer;
      var tIcon = under ? '&#8681;' : '&#8680;';
      var tCol  = under ? '#ef4444' : '#f59e0b';
      var rowBg = ri % 2 === 0 ? '#fff' : '#f8fafc';
      var borderL = under ? 'border-left:3px solid #ef4444;' : '';
      h += '<tr style="border-top:1px solid #e2e8f0;background:' + rowBg + ';' + borderL + '">';
      h += '<td style="padding:5px 8px;text-align:center;font-weight:700;color:#1a3a6b">' + (ri+1) + '</td>';
      h += '<td style="padding:5px 8px;font-weight:600;color:#1a3a6b">' + nm + '</td>';
      h += '<td style="padding:5px 8px;text-align:center">' + (r.days_worked || '') + '</td>';
      h += '<td style="padding:5px 8px;font-weight:700;color:' + (lph >= teamAvg ? '#059669' : '#ef4444') + '">' + lph + '</td>';
      h += '<td style="padding:5px 8px">' + (r.avg_8hr_lph || '') + '</td>';
      h += '<td style="padding:5px 8px">' + (fil !== '' ? fil + '%' : '') + '</td>';
      h += '<td style="padding:5px 8px">' + (nug !== '' ? nug + '%' : '') + '</td>';
      h += '<td style="padding:5px 8px">' + (mis !== '' ? mis + '%' : '') + '</td>';
      h += '<td style="padding:5px 8px;font-weight:600">' + (yld ? yld + '%' : '') + '</td>';
      h += '<td style="padding:5px 8px"><span style="display:inline-block;min-width:30px;text-align:center;padding:2px 6px;border-radius:20px;font-weight:800;font-size:.75rem;background:' + g.bg + ';color:' + g.c + '">' + g.l + '</span></td>';
      h += '<td style="padding:5px 8px"><button class="ttb" data-sid="' + sid + '" data-nm="' + nm + '" data-yld="' + yld + '" data-avg="' + lph + '" data-fil="' + fil + '" data-nug="' + nug + '" data-mis="' + mis + '" data-gl="' + g.l + '" data-gbg="' + g.bg + '" data-gc="' + g.c + '" style="border:none;background:none;cursor:pointer;font-size:1rem;color:' + tCol + ';font-weight:700;padding:2px 5px;border-radius:4px" title="View breakdown">' + tIcon + '</button></td>';
      h += '</tr>';
      h += '<tr id="bd-' + sid + '" style="display:none"><td colspan="11" style="padding:0"><div class="tbb" style="padding:10px 14px;background:#eff6ff;border-left:4px solid #1a3a6b"></div></td></tr>';
    }
    h += '</tbody></table></div>';

    if (!document.getElementById('tps')) {
      var s = document.createElement('style');
      s.id = 'tps';
      s.innerHTML = '@media print{body *{visibility:hidden}#trt,#trt *,.tpa,.tpa *{visibility:visible}#trt{position:fixed;top:0;left:0;width:100%;font-size:10px}.tpa{position:fixed;top:0;left:0;width:100%}}';
      document.head.appendChild(s);
    }

    el.innerHTML = h;

    document.getElementById('tpb').addEventListener('click', function() { window.print(); });

    document.querySelectorAll('#tp button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        window._trimPeriod = parseInt(this.dataset.d);
        trimRenderAnalytics();
      });
    });

    document.querySelectorAll('.ttb').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sid = this.dataset.sid, nm = this.dataset.nm;
        var yld = this.dataset.yld, avg = this.dataset.avg;
        var fil = this.dataset.fil, nug = this.dataset.nug, mis = this.dataset.mis;
        var gl = this.dataset.gl, gbg = this.dataset.gbg, gc = this.dataset.gc;
        var row = document.getElementById('bd-' + sid);
        var box = row ? row.querySelector('.tbb') : null;
        if (!row || !box) return;
        if (row.style.display !== 'none') { row.style.display = 'none'; return; }
        row.style.display = '';
        box.innerHTML = '<span style="color:#94a3b8">&#x2728; Generating AI coaching...</span>';
        var prompt = 'Catfish processing plant coach. Trimmer "' + nm + '": ' + avg + ' lbs/hr, ' + fil + '% fillet, ' + nug + '% nugget, ' + mis + '% miscut, ' + yld + '% total yield, grade ' + gl + '. Grade requires ALL of: A+(150lph/65%fil/20%nug/<5%mis/90%yld) A(125/63/19/<6/85) B(115/62/18/<6.5/80) C(110/61/17.5/<7/75) D(100/61/17/<7.5/70). Give 2-3 specific tips targeting weakest metrics. Be brief and numbered.';
        apiCall('POST', '/api/ai', {query: prompt}).then(function(d) {
          var text = d.response || d.text || d.content || 'Unable to generate.';
          box.innerHTML = '<div class="tpa" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">' +
            '<div style="text-align:center;flex:0 0 auto"><div style="width:56px;height:56px;border-radius:50%;background:' + gbg + ';display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:900;color:' + gc + '">' + gl + '</div><div style="font-size:.65rem;color:#64748b;margin-top:2px">Grade</div></div>' +
            '<div style="flex:1;min-width:160px"><strong style="color:#1a3a6b;display:block;margin-bottom:3px;font-size:.8rem">' + nm + ' — AI Coaching</strong>' +
            '<div style="font-size:.72rem;color:#374151;margin-bottom:5px">' + avg + ' lbs/hr &nbsp;|&nbsp; Fillet: ' + fil + '% &nbsp;|&nbsp; Nugget: ' + nug + '% &nbsp;|&nbsp; Miscut: ' + mis + '% &nbsp;|&nbsp; Yield: ' + yld + '%</div>' +
            '<div style="font-size:.75rem;line-height:1.55;color:#374151">' + text.replace(/
/g, '<br>') + '</div></div>' +
            '<div style="flex:0 0 auto"><button onclick="window.print()" style="background:#1a3a6b;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:.7rem;cursor:pointer">&#128438; Print</button></div>' +
            '</div>';
        }).catch(function() { box.innerHTML = '<span style="color:#ef4444">Error generating suggestion.</span>'; });
      });
    });
  }).catch(function(e) { el.innerHTML = '<div class="log-empty">' + e.message + '</div>'; });
}

function trimSparkline(values, color, w, h) {
    if(!values||!values.length) return "";
    const min = Math.min.apply(null,values), max = Math.max.apply(null,values);
    const range = max-min || 1;
    const pts = values.map(function(v,i){
      const x = (i/(values.length-1||1))*w;
      const y = h - ((v-min)/range)*(h-4) - 2;
      return x.toFixed(1)+","+y.toFixed(1);
    }).join(" ");
    return "<svg width=\""+w+"\" height=\""+h+"\" style=\"display:block\"><polyline points=\""+pts+"\" fill=\"none\" stroke=\""+color+"\" stroke-width=\"2\" stroke-linejoin=\"round\"/></svg>";
  }

function trimBarChart(labels, values, color, title) {
    const max = Math.max.apply(null,values)||1;
    const barW = Math.max(18, Math.min(40, Math.floor(340/values.length)));
    const w = barW*values.length+40, h = 120;
    let svg = "<svg width=\""+w+"\" height=\""+h+"\" style=\"display:block;overflow:visible\">";
    svg += "<text x=\"0\" y=\"12\" font-size=\"11\" fill=\"#64748b\">"+title+"</text>";
    values.forEach(function(v,i){
      const bh = Math.max(2,((v/max)*(h-30)));
      const x = i*barW+20, y = h-bh-16;
      svg += "<rect x=\""+x+"\" y=\""+y+"\" width=\""+(barW-3)+"\" height=\""+bh+"\" fill=\""+color+"\" rx=\"2\"/>";
      svg += "<text x=\""+(x+(barW-3)/2)+"\" y=\""+(h-2)+"\" font-size=\"9\" text-anchor=\"middle\" fill=\"#64748b\">"+labels[i]+"</text>";
      svg += "<text x=\""+(x+(barW-3)/2)+"\" y=\""+(y-2)+"\" font-size=\"9\" text-anchor=\"middle\" fill=\""+color+"\">"+parseFloat(v).toFixed(1)+"</text>";
    });
    svg += "</svg>";
    return svg;
  }

async function trimShowTrend(encodedName, btn) {
    const name = decodeURIComponent(encodedName);
    const area = document.getElementById("trim-trend-area");
    if(!area) return;
    area.innerHTML = "<div class=\"spinner-wrap\"><div class=\"spinner\"></div><div>Loading trendâ¦</div></div>";
    btn.disabled = true;
    let data;
    try { data = await apiCall("GET", "/api/analytics?type=trimmer_trends&days=90&trimmer_name="+encodedName); }
    catch(e) { area.innerHTML = "<p style=\"color:#ef4444\">Trend failed: " + e.message + "</p>"; btn.disabled=false; return; }
    const trends = data.trends || [];
    if(!trends.length){ area.innerHTML = "<p style=\"text-align:center;padding:16px;color:var(--sub)\">No data for "+name+"</p>"; btn.disabled=false; return; }
    // Extract series
    const dates = trends.map(function(t){ return (t.report_date||"").slice(5,10); });
    const lph = trends.map(function(t){ return parseFloat(t.realtime_lbs_per_hour||0); });
    const fPct = trends.map(function(t){ return parseFloat(t.fillet_yield_pct||0); });
    const nPct = trends.map(function(t){ return parseFloat(t.nugget_yield_pct||0); });
    const mcPct = trends.map(function(t){ return parseFloat(t.misccut_yield_pct||0); });
    const totPct = trends.map(function(t){ return parseFloat(t.total_yield_pct||0); });
    const inLbs = trends.map(function(t){ return parseFloat(t.incoming_lbs||0); });
    // Build charts
    let html = "<div class=\"wcard\" style=\"margin-top:12px\">";
    html += "<h3 style=\"font-size:0.95rem;margin-bottom:4px\">ð " + name + " â Last 90 Days (" + trends.length + " shifts)</h3>";
    // Summary stats
    const avgLph = lph.reduce(function(a,b){return a+b;},0)/lph.length;
    const avgFillet = fPct.reduce(function(a,b){return a+b;},0)/fPct.length;
    const avgNugget = nPct.reduce(function(a,b){return a+b;},0)/nPct.length;
    const avgMisc = mcPct.reduce(function(a,b){return a+b;},0)/mcPct.length;
    const avgTot = totPct.reduce(function(a,b){return a+b;},0)/totPct.length;
    html += "<div style=\"display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px\">";
    html += "<div style=\"background:#f0fdf4;border-radius:8px;padding:8px 14px;text-align:center\"><div style=\"font-size:1.1rem;font-weight:700;color:#16a34a\">"+avgLph.toFixed(1)+"</div><div style=\"font-size:0.7rem;color:#64748b\">Avg Lbs/Hr</div></div>";
    html += "<div style=\"background:#eff6ff;border-radius:8px;padding:8px 14px;text-align:center\"><div style=\"font-size:1.1rem;font-weight:700;color:#2563eb\">"+avgFillet.toFixed(1)+"%</div><div style=\"font-size:0.7rem;color:#64748b\">Avg Fillet</div></div>";
    html += "<div style=\"background:#fefce8;border-radius:8px;padding:8px 14px;text-align:center\"><div style=\"font-size:1.1rem;font-weight:700;color:#ca8a04\">"+avgNugget.toFixed(1)+"%</div><div style=\"font-size:0.7rem;color:#64748b\">Avg Nugget</div></div>";
    html += "<div style=\"background:#fdf4ff;border-radius:8px;padding:8px 14px;text-align:center\"><div style=\"font-size:1.1rem;font-weight:700;color:#9333ea\">"+avgMisc.toFixed(1)+"%</div><div style=\"font-size:0.7rem;color:#64748b\">Avg MiscCut</div></div>";
    html += "<div style=\"background:#f0fdf4;border-radius:8px;padding:8px 14px;text-align:center\"><div style=\"font-size:1.1rem;font-weight:700;color:#16a34a\">"+avgTot.toFixed(1)+"%</div><div style=\"font-size:0.7rem;color:#64748b\">Avg Tot Yield</div></div>";
    html += "</div>";
    // Charts row
    html += "<div style=\"display:flex;flex-wrap:wrap;gap:16px;overflow-x:auto\">";
    html += "<div style=\"flex:0 0 auto\"><div style=\"font-size:0.75rem;color:#64748b;margin-bottom:2px\">Lbs/Hr per shift</div>";
    html += trimBarChart(dates, lph, "#16a34a", "")+"</div>";
    html += "<div style=\"flex:0 0 auto\"><div style=\"font-size:0.75rem;color:#64748b;margin-bottom:2px\">Fillet % trend</div>";
    html += "<div style=\"border:1px solid #e2e8f0;border-radius:6px;padding:4px\">" + trimSparkline(fPct,"#2563eb",220,70) + "</div>";
    html += "<div style=\"font-size:0.7rem;color:#64748b;text-align:right\">"+fPct[0].toFixed(1)+"% â "+fPct[fPct.length-1].toFixed(1)+"%</div></div>";
    html += "<div style=\"flex:0 0 auto\"><div style=\"font-size:0.75rem;color:#64748b;margin-bottom:2px\">Nugget % trend</div>";
    html += "<div style=\"border:1px solid #e2e8f0;border-radius:6px;padding:4px\">" + trimSparkline(nPct,"#ca8a04",220,70) + "</div>";
    html += "<div style=\"font-size:0.7rem;color:#64748b;text-align:right\">"+nPct[0].toFixed(1)+"% â "+nPct[nPct.length-1].toFixed(1)+"%</div></div>";
    html += "<div style=\"flex:0 0 auto\"><div style=\"font-size:0.75rem;color:#64748b;margin-bottom:2px\">MiscCut % trend</div>";
    html += "<div style=\"border:1px solid #e2e8f0;border-radius:6px;padding:4px\">" + trimSparkline(mcPct,"#9333ea",220,70) + "</div>";
    html += "<div style=\"font-size:0.7rem;color:#64748b;text-align:right\">"+mcPct[0].toFixed(1)+"% â "+mcPct[mcPct.length-1].toFixed(1)+"%</div></div>";
    html += "</div>";
    // Detail table
    html += "<details style=\"margin-top:12px\"><summary style=\"font-size:0.8rem;color:var(--blue);cursor:pointer\">Show raw data (" + trends.length + " shifts)</summary>";
    html += "<div style=\"overflow-x:auto;margin-top:6px\"><table class=\"trim-table\" style=\"width:100%;font-size:0.74rem\"><thead><tr>";
    ["Date","Shift","In Lbs","Fillet%","Nugget%","MiscCut%","Tot%","Lbs/Hr"].forEach(function(h){ html += "<th>"+h+"</th>"; });
    html += "</tr></thead><tbody>";
    trends.forEach(function(t){
      html += "<tr>";
      html += "<td>"+(t.report_date||"").slice(0,10)+"</td>";
      html += "<td>"+(t.shift||"")+"</td>";
      html += "<td>"+parseFloat(t.incoming_lbs||0).toFixed(0)+"</td>";
      html += "<td>"+parseFloat(t.fillet_yield_pct||0).toFixed(1)+"%</td>";
      html += "<td>"+parseFloat(t.nugget_yield_pct||0).toFixed(1)+"%</td>";
      html += "<td>"+parseFloat(t.misccut_yield_pct||0).toFixed(1)+"%</td>";
      html += "<td>"+parseFloat(t.total_yield_pct||0).toFixed(1)+"%</td>";
      html += "<td style=\"font-weight:700\">"+parseFloat(t.realtime_lbs_per_hour||0).toFixed(1)+"</td>";
      html += "</tr>";
    });
    html += "</tbody></table></div></details>";
    html += "</div>";
    area.innerHTML = html;
    area.scrollIntoView({behavior:"smooth",block:"start"});
    btn.disabled = false;
  }
// Expose functions globally for inline onclick handlers
window.buildTrimmerWidget = buildTrimmerWidget;
window.trimShowTab = trimShowTab;
window.trimRenderUpload = trimRenderUpload;
window.trimHandleFile = trimHandleFile;
window.trimEmptyRow = trimEmptyRow;
window.trimRenderForm = trimRenderForm;
window.trimUpdate = trimUpdate;
window.trimAddRow = trimAddRow;
window.trimDeleteRow = trimDeleteRow;
window.trimReset = trimReset;
window.trimSave = trimSave;
window.trimSaveEntry = trimSaveEntry;
window.trimDeleteEntry = trimDeleteEntry;
window.trimDeleteReport = trimDeleteReport;
window.trimRenderHistory = trimRenderHistory;
window.trimRenderAnalytics = trimRenderAnalytics;
window.trimSparkline = trimSparkline;
window.trimBarChart = trimBarChart;
window.trimShowTrend = trimShowTrend;

var _trimPeriod = 30;
function trimSetPeriod(days) {
  _trimPeriod = days;
  trimRenderAnalytics();
}

// Expose to global scope for inline onclick handlers
window.buildTrimmerWidget = buildTrimmerWidget;
window.trimShowTab = trimShowTab;
window.trimRenderUpload = trimRenderUpload;
window.trimHandleFile = trimHandleFile;
window.trimEmptyRow = trimEmptyRow;
window.trimRenderForm = trimRenderForm;
window.trimUpdate = trimUpdate;
window.trimAddRow = trimAddRow;
window.trimDeleteRow = trimDeleteRow;
window.trimReset = trimReset;
window.trimSave = trimSave;
window.trimSaveEntry = trimSaveEntry;
window.trimDeleteEntry = trimDeleteEntry;
window.trimDeleteReport = trimDeleteReport;
window.trimRenderHistory = trimRenderHistory;
window.trimRenderAnalytics = trimRenderAnalytics;
window.trimSparkline = trimSparkline;
window.trimBarChart = trimBarChart;
window.trimShowTrend = trimShowTrend;
window.trimSetPeriod = trimSetPeriod;


// ââ TRIMMER GRADING SYSTEM ââ
function getTrimmerGrade(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return {letter:'N/A', color:'#94a3b8', bg:'#f8fafc'};
  if (pct >= 100) return {letter:'A+', color:'#fff', bg:'#059669'};
  if (pct >= 90)  return {letter:'A',  color:'#fff', bg:'#10b981'};
  if (pct >= 80)  return {letter:'B',  color:'#fff', bg:'#3b82f6'};
  if (pct >= 65)  return {letter:'C',  color:'#fff', bg:'#f59e0b'};
  if (pct >= 50)  return {letter:'D',  color:'#fff', bg:'#f97316'};
  return           {letter:'F',  color:'#fff', bg:'#dc2626'};
}

function getTrimmerTrend(curr, prev) {
  if (curr===null||prev===null) return {arrow:'â', color:'#94a3b8'};
  if (curr > prev+2)  return {arrow:'â', color:'#059669'};
  if (curr < prev-2)  return {arrow:'â', color:'#dc2626'};
  return               {arrow:'â', color:'#64748b'};
}

function buildTrimmerGrades() {
  var el = document.getElementById('widget-content');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:30px"><div class="spinner"></div> Loading grades...</div>';
  apiCall('GET','/api/records?type=trimmer').then(function(records){
    if(!records||!records.length){ el.innerHTML='<div class="log-empty">No trimmer records found.</div>'; return; }
    var PERIODS=[{key:'7d',label:'7 Days',days:7},{key:'14d',label:'14 Days',days:14},{key:'30d',label:'30 Days',days:30},{key:'ytd',label:'YTD',days:null}];
    var now=new Date(); now.setHours(0,0,0,0);
    function recDate(r){ var p=String(r.record_date||r.created_at||'').substring(0,10).split('-'); return p.length===3?new Date(p[0],p[1]-1,p[2]):new Date(0); }
    function filterP(recs,days){ if(!days){var j=new Date(now.getFullYear(),0,1); return recs.filter(function(r){return recDate(r)>=j;});} var cut=new Date(now); cut.setDate(cut.getDate()-days); return recs.filter(function(r){return recDate(r)>=cut;}); }
    function compPct(recs){ if(!recs.length) return null; var done=recs.filter(function(r){return r.fillet_weight_lbs>0||r.status==='completed';}).length; return Math.round(done/recs.length*100); }
    var trimmers={};
    records.forEach(function(r){ var n=r.trimmer_name||r.recorded_by||'Unknown'; if(!trimmers[n]) trimmers[n]=[]; trimmers[n].push(r); });
    var names=Object.keys(trimmers).sort();
    var activePeriod=window._tgPeriod||'30d';

    function render(period){
      window._tgPeriod=period;
      var pConf=PERIODS.find(function(p){return p.key===period;})||PERIODS[2];
      var btnS='border:none;border-radius:6px;padding:5px 12px;font-size:.75rem;font-weight:600;cursor:pointer;margin-right:4px';
      var cardS='background:#fff;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)';
      var html='<div style="padding:4px 0 12px">';
      html+='<div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap" id="tg-pills">';
      PERIODS.forEach(function(p){ var a=p.key===period; html+='<button data-period="'+p.key+'" style="'+btnS+';background:'+(a?'#1a3a6b':'#f1f5f9')+';color:'+(a?'#fff':'#475569')+'">'+p.label+'</button>'; });
      html+='</div>';

      names.forEach(function(name){
        var allR=trimmers[name];
        var curr=filterP(allR,pConf.days);
        var prev=filterP(allR,pConf.days?pConf.days*2:null).filter(function(r){return !curr.includes(r);});
        var cPct=compPct(curr), pPct=compPct(prev);
        var grade=getTrimmerGrade(cPct), trend=getTrimmerTrend(cPct,pPct);
        var safeName=name.replace(/[^a-z0-9]/gi,'_');

        html+='<div style="'+cardS+'">';
        html+='<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">';
        html+='<div style="width:54px;height:54px;border-radius:10px;background:'+grade.bg+';display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:800;color:'+grade.color+'">'+grade.letter+'</div>';
        html+='<div style="flex:1"><div style="font-weight:700;font-size:.95rem;color:#1a3a6b">'+name+'</div>';
        html+='<div style="font-size:.78rem;color:#64748b;margin-top:2px">'+(cPct!==null?cPct+'% completion rate':'No data')+'</div></div>';
        html+='<div style="text-align:center"><div style="font-size:1.6rem;color:'+trend.color+'">'+trend.arrow+'</div>';
        html+='<div style="font-size:.65rem;color:#94a3b8">'+(pPct!==null?'prev '+pPct+'%':'')+'</div></div></div>';

        // Mini period breakdown
        html+='<div style="display:flex;gap:6px;margin-bottom:12px">';
        PERIODS.forEach(function(pp){
          var pR=filterP(allR,pp.days), pPct2=compPct(pR), pg=getTrimmerGrade(pPct2);
          html+='<div style="flex:1;text-align:center;background:#f8fafc;border-radius:8px;padding:5px 2px">';
          html+='<div style="font-size:.62rem;color:#64748b">'+pp.label+'</div>';
          html+='<div style="font-size:.88rem;font-weight:700;color:'+pg.bg+'">'+pg.letter+'</div>';
          html+='<div style="font-size:.62rem;color:#94a3b8">'+(pPct2!==null?pPct2+'%':'â')+'</div></div>';
        });
        html+='</div>';

        // AI suggestion button
        var avgW=0; var fw=curr.map(function(r){return parseFloat(r.fillet_weight_lbs)||0;}).filter(function(x){return x>0;});
        if(fw.length) avgW=Math.round(fw.reduce(function(a,b){return a+b;},0)/fw.length*10)/10;
        html+='<button data-name="'+name+'" data-pct="'+(cPct||0)+'" data-grade="'+grade.letter+'" data-wt="'+avgW+'" data-period="'+pConf.label+'" class="tg-ai-btn" style="width:100%;background:#f0f4ff;border:1px solid #c7d7fd;border-radius:8px;padding:8px;font-size:.78rem;color:#3730a3;cursor:pointer;text-align:left;font-weight:500">â¨ Generate AI improvement suggestions for '+name+'</button>';
        html+='<div id="tg-ai-'+safeName+'" style="display:none;margin-top:8px;padding:10px;background:#f8fafc;border-radius:8px;font-size:.78rem;color:#374151;line-height:1.6"></div>';
        html+='</div>';
      });
      html+='</div>';
      el.innerHTML=html;

      // Wire pills
      document.querySelectorAll('#tg-pills button').forEach(function(b){ b.addEventListener('click',function(){ render(this.dataset.period); }); });

      // Wire AI buttons
      document.querySelectorAll('.tg-ai-btn').forEach(function(btn){
        btn.addEventListener('click',function(){
          var nm=this.dataset.name, pct=this.dataset.pct, gr=this.dataset.grade, wt=this.dataset.wt, per=this.dataset.period;
          var rid='tg-ai-'+nm.replace(/[^a-z0-9]/gi,'_');
          var res=document.getElementById(rid); if(!res) return;
          this.disabled=true; this.textContent='Generating...';
          var self=this;
          res.style.display='block';
          res.innerHTML='<div class="spinner" style="display:inline-block;margin-right:6px"></div>Analyzing performance...';
          var prompt='You are a catfish processing plant performance coach. Trimmer name: '+nm+'. Current grade: '+gr+' ('+pct+'% completion) over the last '+per+'. Average fillet weight: '+wt+' lbs. Provide exactly 3 numbered, specific, actionable improvement suggestions. Each suggestion should be 2 sentences. Be direct, practical and encouraging. Keep total response under 180 words.';
          fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:350,messages:[{role:'user',content:prompt}]})})
          .then(function(r){return r.json();}).then(function(d){
            var text=(d.content&&d.content[0]&&d.content[0].text)||'Unable to generate.';
            res.innerHTML='<strong style="color:#1a3a6b;display:block;margin-bottom:6px">â¨ AI Suggestions for '+nm+':</strong>'+text.replace(/\n/g,'<br>');
            self.textContent='â» Refresh suggestions';
            self.disabled=false;
          }).catch(function(){
            res.innerHTML='Error generating suggestions.';
            self.textContent='â¨ Generate AI improvement suggestions for '+nm;
            self.disabled=false;
          });
        });
      });
    }
    render(activePeriod);
  }).catch(function(e){ el.innerHTML='<div class="log-empty">'+e.message+'</div>'; });
}

function buildTrimmerGrades() {
  var el = document.getElementById('widget-content');
  if(!el) return;
  el.innerHTML = '<div style="text-align:center;padding:30px"><div class="spinner"></div>Loading grades...</div>';
  apiCall('GET','/api/records?type=trimmer').then(function(recs){
    window._tgRecs = recs;
    renderTrimmerGrades(recs,'30d');
  }).catch(function(e){ el.innerHTML='<div class="log-empty">'+e.message+'</div>'; });
}

function renderTrimmerGrades(records, period) {
  var el = document.getElementById('widget-content');
  if(!el) return;
  window._tgRecs = window._tgRecs||records;
  var PERIODS=[{key:'7d',label:'7 Days'},{key:'14d',label:'14 Days'},{key:'30d',label:'30 Days'},{key:'ytd',label:'YTD'}];
  function recDate(r){ var p=String(r.report_date||r.record_date||'').split('-'); return new Date(p[0],p[1]-1,p[2]); }
  function filterPeriod(recs,key){
    var now=new Date(); now.setHours(0,0,0,0);
    var cut = key==='ytd' ? new Date(now.getFullYear(),0,1) : (function(){ var d=new Date(now); d.setDate(d.getDate()-(key==='7d'?7:key==='14d'?14:30)); return d; })();
    return recs.filter(function(r){ return recDate(r)>=cut; });
  }
  function calcCompletion(recs, name) {
    var mine=recs.filter(function(r){ return (r.trimmer_name||r.recorded_by||r.name||'')===name; });
    if(!mine.length) return null;
    var done=mine.filter(function(r){ return r.status==='complete'||r.completed||r.grade; }).length;
    return Math.round(done/mine.length*100);
  }
  function letterGrade(pct) {
    if(pct===null) return {g:'N/A',c:'#94a3b8',bg:'#f8fafc'};
    if(pct>=100) return {g:'A+',c:'#fff',bg:'#059669'};
    if(pct>=90)  return {g:'A', c:'#fff',bg:'#10b981'};
    if(pct>=80)  return {g:'B', c:'#fff',bg:'#3b82f6'};
    if(pct>=65)  return {g:'C', c:'#fff',bg:'#f59e0b'};
    if(pct>=50)  return {g:'D', c:'#fff',bg:'#f97316'};
    return         {g:'F', c:'#fff',bg:'#dc2626'};
  }
  var allRecs=window._tgRecs||[];
  var nameSet={};
  allRecs.forEach(function(r){ var n=r.trimmer_name||r.recorded_by||r.name; if(n) nameSet[n]=true; });
  var names=Object.keys(nameSet).sort();
  var filtered=filterPeriod(allRecs,period);
  var prevKey=period==='7d'?'14d':period==='14d'?'30d':period==='30d'?'ytd':'ytd';
  var prevFiltered=filterPeriod(allRecs,prevKey);
  var cs='background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);';
  var btnSt='border:none;border-radius:6px;padding:5px 12px;font-size:.75rem;font-weight:600;cursor:pointer;';
  var html='<div style="padding:4px 0 12px">';
  html+='<div id="tg-pills" style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">';
  PERIODS.forEach(function(p){
    var act=p.key===period;
    html+='<button data-period="'+p.key+'" style="'+btnSt+'background:'+(act?'#1a3a6b':'#f1f5f9')+';color:'+(act?'#fff':'#475569')+'">'+p.label+'</button>';
  });
  html+='</div>';
  if(!names.length){
    html+='<div style="'+cs+'text-align:center;color:#94a3b8;padding:24px">No trimmer records found. Add records in the Trimmer Log first.</div>';
  } else {
    names.forEach(function(name){
      var pct=calcCompletion(filtered,name);
      var prevPct=calcCompletion(prevFiltered,name);
      var gr=letterGrade(pct);
      var trend='';
      if(pct!==null&&prevPct!==null){
        if(pct>prevPct+2) trend=' <span style="color:#059669" title="Improving vs previous period">&#8593; Improving</span>';
        else if(pct<prevPct-2) trend=' <span style="color:#dc2626" title="Regressing vs previous period">&#8595; Regressing</span>';
        else trend=' <span style="color:#64748b" title="Stable">&#8594; Stable</span>';
      }
      var safeId='ai-'+name.replace(/[^a-zA-Z0-9]/g,'_');
      html+='<div style="'+cs+'">';
      html+='<div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">';
      html+='<div style="width:54px;height:54px;border-radius:10px;background:'+gr.bg+';display:flex;align-items:center;justify-content:center;color:'+gr.c+';font-size:1.35rem;font-weight:800;flex-shrink:0">'+gr.g+'</div>';
      html+='<div><div style="font-weight:700;color:#1a3a6b;font-size:.95rem">'+name+'</div>';
      html+='<div style="font-size:.8rem;color:#64748b;margin-top:1px">'+(pct!==null?pct+'% completion rate':'No data for this period')+trend+'</div></div></div>';
      html+='<div id="'+safeId+'" style="font-size:.78rem;color:#475569;line-height:1.5;border-top:1px solid #f1f5f9;padding-top:8px"><em style="color:#94a3b8">&#129302; Loading AI suggestions...</em></div>';
      html+='</div>';
    });
  }
  html+='</div>';
  el.innerHTML=html;
  document.querySelectorAll('#tg-pills button').forEach(function(btn){
    btn.addEventListener('click',function(){ renderTrimmerGrades(window._tgRecs,this.getAttribute('data-period')); });
  });
  if(names.length){
    names.forEach(function(name){
      var pct=calcCompletion(filtered,name);
      if(pct===null) return;
      var gr=letterGrade(pct);
      var safeId='ai-'+name.replace(/[^a-zA-Z0-9]/g,'_');
      var aiEl=document.getElementById(safeId);
      if(!aiEl) return;
      var periodLabel=period==='7d'?'7 days':period==='14d'?'14 days':period==='30d'?'30 days':'year to date';
      fetch('https://api.anthropic.com/v1/messages',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          model:'claude-sonnet-4-20250514',
          max_tokens:1000,
          messages:[{role:'user',content:'You are a catfish processing plant supervisor reviewing trimmer performance. Trimmer "'+name+'" earned a grade of '+gr.g+' ('+pct+'% task completion) over the past '+periodLabel+'. Give exactly 2 specific, actionable improvement suggestions. Each suggestion should be 1 sentence. Use a bullet point (\u2022) before each. Be direct and practical. No intro text, just the 2 bullets.'}]
        })
      }).then(function(r){return r.json();})
      .then(function(d){
        var text=(d.content&&d.content[0]&&d.content[0].text)||'';
        var aiEl2=document.getElementById(safeId);
        if(aiEl2&&text) aiEl2.innerHTML='<strong style="color:#1a3a6b">AI Suggestions:</strong><br>'+text.replace(/\n/g,'<br>');
        else if(aiEl2) aiEl2.innerHTML='';
      }).catch(function(){ var aiEl2=document.getElementById(safeId); if(aiEl2) aiEl2.innerHTML=''; });
    });
  }
}