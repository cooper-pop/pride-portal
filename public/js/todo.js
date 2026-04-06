// ============================================================
//  TODO WIDGET  - Tasks / Schedule / Messages / Grades / Manage
// ============================================================

var _todoTab = 0;
var _todoDate = new Date().toISOString().split('T')[0];
var _todoTasks = [];
var _todoMessages = [];
var _todoGrades = [];
var _todoEngagement = [];
var _todoAllTasks = [];
var _todoUsers = [];
var _todoSessionStart = Date.now();
var _todoTaskStartTime = null;
var _todoPhotoData = null;
var _smPhotoData = null;

function calcGrade(completed, total, missed) {
  if (!total) return {letter:'N/A', color:'#999'};
  var missedPct = missed/total;
  var completedPct = completed/total;
  if (missedPct >= 0.5) return {letter:'F', color:'#dc2626'};
  if (missedPct >= 0.3) return {letter:'D', color:'#ea580c'};
  if (completedPct >= 0.98) return {letter:'A+', color:'#15803d'};
  if (completedPct >= 0.90) return {letter:'A', color:'#16a34a'};
  if (completedPct >= 0.80) return {letter:'B', color:'#2563eb'};
  if (completedPct >= 0.65) return {letter:'C', color:'#d97706'};
  return {letter:'D', color:'#ea580c'};
}

function fmtTime(secs) {
  secs = parseInt(secs)||0;
  var h=Math.floor(secs/3600), m=Math.floor((secs%3600)/60), s=secs%60;
  if(h>0) return h+'h '+m+'m';
  if(m>0) return m+'m '+s+'s';
  return s+'s';
}

function fmtDate(d) {
  if(!d) return '';
  var p=d.split('T')[0].split('-');
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[parseInt(p[1])-1]+' '+parseInt(p[2])+', '+p[0];
}

function priorityBg(p) {
  if(p==='High') return 'background:#fee2e2;color:#dc2626;border:1px solid #fca5a5';
  if(p==='Low') return 'background:#dcfce7;color:#16a34a;border:1px solid #86efac';
  return 'background:#fef9c3;color:#ca8a04;border:1px solid #fde047';
}

function catIcon(c) {
  var icons={Production:'⚙️',Maintenance:'🔧',Quality:'📊',Safety:'🦺',General:'📋'};
  return icons[c]||'📋';
}

function statusBadge(s) {
  var map={pending:{bg:'#f1f5f9',color:'#64748b',label:'Pending'},
    in_progress:{bg:'#eff6ff',color:'#2563eb',label:'In Progress'},
    complete:{bg:'#dcfce7',color:'#16a34a',label:'Complete'},
    overdue:{bg:'#fee2e2',color:'#dc2626',label:'Overdue'},
    waiting_parts:{bg:'#f3e8ff',color:'#7c3aed',label:'⏳ Waiting on Parts'}};
  var m=map[s]||map.pending;
  return '<span style="padding:2px 8px;border-radius:12px;font-size:.72rem;font-weight:600;background:'+m.bg+';color:'+m.color+'">'+m.label+'</span>';
}

// ── Main render ──
async function todoRender() {
  var wc = document.getElementById('widget-content');
  if(!wc) return;
  try { await apiCall('POST','/api/tasks?action=spawn_instances',{}); } catch(e){}
  var isAdmin = currentUser&&currentUser.role==='admin';
  var tabs = ['📋 My Tasks','📅 Schedule','💬 Messages','📊 Grades'];
  if(isAdmin) tabs.push('⚙️ Manage');
  var tabBar = '<div style="display:flex;border-bottom:2px solid #e2e8f0;overflow-x:auto;white-space:nowrap">';
  tabs.forEach(function(t,i) {
    var active = _todoTab===i;
    tabBar += '<button id="todo-tab-'+i+'" onclick="todoTab('+i+')" style="padding:10px 14px;border:none;background:'+(active?'#fff':'transparent')+';border-bottom:3px solid '+(active?'#1a3a6b':'transparent')+';font-weight:'+(active?'700':'400')+';color:'+(active?'#1a3a6b':'#64748b')+';cursor:pointer;font-size:.82rem;flex-shrink:0">'+t+'</button>';
  });
  tabBar += '</div>';
  wc.innerHTML = tabBar + '<div id="todo-body" style="padding:16px;overflow-y:auto;max-height:420px"></div>';
  todoLoadTab();
}

function todoTab(i) {
  _todoTab = i;
  for(var j=0;j<8;j++) {
    var btn = document.getElementById('todo-tab-'+j);
    if(!btn) continue;
    var active = j===i;
    btn.style.borderBottom = active?'3px solid #1a3a6b':'3px solid transparent';
    btn.style.fontWeight = active?'700':'400';
    btn.style.color = active?'#1a3a6b':'#64748b';
    btn.style.background = active?'#fff':'transparent';
  }
  todoLoadTab();
}

async function todoLoadTab() {
  var body = document.getElementById('todo-body');
  if(!body) return;
  body.innerHTML = '<div style="text-align:center;padding:24px;color:#94a3b8">Loading...</div>';
  try {
    if(_todoTab===0) await todoMyTasks(body);
    else if(_todoTab===1) await todoSchedule(body);
    else if(_todoTab===2) await todoMessages(body);
    else if(_todoTab===3) await todoGrades(body);
    else if(_todoTab===4) await todoManage(body);
  } catch(e) {
    body.innerHTML = '<p style="color:#dc2626;padding:16px">Error: '+e.message+'</p>';
  }
}

// ── TAB 0: MY TASKS ──
async function todoMyTasks(body) {
  var tasks = await apiCall('POST','/api/tasks',{action:'my_tasks'});
  _todoTasks = tasks;
  var msgs = await apiCall('POST','/api/tasks',{action:'messages'});
  _todoMessages = msgs;
  var pending = tasks.filter(function(t){return t.status!=='complete'&&t.status!=='waiting_parts';}).length;
  var done = tasks.filter(function(t){return t.status==='complete';}).length;
  var today = new Date().toISOString().split('T')[0];
  var overdue = tasks.filter(function(t){return t.status==='pending'&&t.instance_date<today;}).length;
  var html = '';
  msgs.forEach(function(m) {
    html += '<div style="background:#fffbeb;border:2px solid #f59e0b;border-radius:10px;padding:12px;margin-bottom:10px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start">';
    html += '<div><div style="font-weight:700;color:#92400e;font-size:.82rem">💬 Message from '+m.from_name+'</div>';
    html += '<div style="color:#78350f;margin:6px 0">'+m.body+'</div>';
    if(m.photo) html += '<img src="'+m.photo+'" style="max-width:100%;border-radius:6px;margin-top:6px;max-height:150px">';
    html += '</div><button data-msgid="'+m.id+'" class="todo-ack-btn" style="background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:.75rem;cursor:pointer;white-space:nowrap;margin-left:8px">Got It ✓</button></div></div>';
  });
  html += '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">';
  html += '<div style="flex:1;min-width:80px;background:#eff6ff;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.4rem;font-weight:700;color:#2563eb">'+pending+'</div><div style="font-size:.72rem;color:#64748b">Pending</div></div>';
  html += '<div style="flex:1;min-width:80px;background:#dcfce7;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.4rem;font-weight:700;color:#16a34a">'+done+'</div><div style="font-size:.72rem;color:#64748b">Done</div></div>';
  if(overdue) html += '<div style="flex:1;min-width:80px;background:#fee2e2;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.4rem;font-weight:700;color:#dc2626">'+overdue+'</div><div style="font-size:.72rem;color:#64748b">Overdue</div></div>';
  html += '</div>';
  if(!tasks.length) html += '<div style="text-align:center;padding:32px;color:#94a3b8"><div style="font-size:2rem">✅</div><div>No tasks for today!</div></div>';
  else tasks.forEach(function(t){ html += todoTaskCard(t); });
  body.innerHTML = html;
  body.querySelectorAll('.todo-ack-btn').forEach(function(btn) {
    btn.addEventListener('click', function(){ todoAckMsg(parseInt(this.dataset.msgid)); });
  });
  body.querySelectorAll('.todo-start-btn').forEach(function(btn) {
    btn.addEventListener('click', function(){ todoStartComplete(parseInt(this.dataset.id)); });
  });
  body.querySelectorAll('.todo-parts-btn').forEach(function(btn) {
    btn.addEventListener('click', function(){ todoShowWaitingParts(parseInt(this.dataset.id)); });
  });
  body.querySelectorAll('.todo-step-check').forEach(function(chk) {
    chk.addEventListener('change', function(){ todoToggleStep(parseInt(this.dataset.tid), parseInt(this.dataset.idx), this.checked); });
  });
}

function todoTaskCard(t) {
  var steps = t.steps||[];
  var stepsDone = (t.step_completions||[]).length;
  var isComplete = t.status==='complete';
  var today = new Date().toISOString().split('T')[0];
  var isOverdue = t.status==='pending' && t.instance_date<today;
  var c = '<div style="border:1px solid '+(isOverdue?'#fca5a5':'#e2e8f0')+';border-radius:10px;padding:12px;margin-bottom:10px;background:'+(isOverdue?'#fff5f5':'#fff')+'">';
  c += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">';
  c += '<div><div style="font-weight:700;color:#1e293b">'+catIcon(t.category)+' '+t.title+'</div>';
  if(t.description) c += '<div style="font-size:.78rem;color:#64748b;margin-top:2px">'+t.description+'</div>';
  c += '</div><div style="display:flex;gap:4px;flex-shrink:0">';
  c += '<span style="padding:2px 7px;border-radius:10px;font-size:.7rem;font-weight:600;'+priorityBg(t.priority)+'">'+t.priority+'</span>';
  c += statusBadge(t.status)+'</div></div>';
  if(t.due_time||t.shift!=='Any') {
    c += '<div style="font-size:.75rem;color:#64748b;margin-bottom:8px">'+(t.due_time?'🕐 Due: '+t.due_time.substring(0,5)+' ':'')+( t.shift!=='Any'?'· '+t.shift+' shift':'')+'</div>';
  }
  if(steps.length) {
    var pct = isComplete?100:Math.round(stepsDone/steps.length*100);
    c += '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:.72rem;color:#64748b;margin-bottom:3px"><span>Steps: '+stepsDone+'/'+steps.length+'</span><span>'+pct+'%</span></div>';
    c += '<div style="height:5px;background:#e2e8f0;border-radius:3px"><div style="height:5px;background:#1a3a6b;border-radius:3px;width:'+pct+'%"></div></div></div>';
    if(!isComplete) {
      c += '<div style="margin-bottom:8px">';
      steps.forEach(function(s,i) {
        var done = (t.step_completions||[]).includes(i);
        c += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #f1f5f9">';
        c += '<input type="checkbox" class="todo-step-check" data-tid="'+t.id+'" data-idx="'+i+'" '+(done?'checked':'')+' style="cursor:pointer">';
        c += '<span style="font-size:.8rem;color:'+(done?'#94a3b8':'#1e293b')+';text-decoration:'+(done?'line-through':'none')+'">'+s+'</span></div>';
      });
      c += '</div>';
    }
  }
  if(!isComplete && t.status!=='waiting_parts') {
    var lbl = t.status==='in_progress'?'📷 Add Completion Photo':'▶ Start / Complete';
    c += '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">';
    c += '<button class="todo-start-btn" data-id="'+t.id+'" style="background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:.82rem;font-weight:600">'+lbl+'</button>';
    if(t.status==='in_progress'||t.status==='pending') {
      c += '<button class="todo-parts-btn" data-id="'+t.id+'" style="background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:.82rem;font-weight:600">⏳ Waiting on Parts</button>';
    }
    c += '</div>';
  } else if(t.status==='waiting_parts') {
    c += '<div style="margin-top:8px;background:#f3e8ff;border:1px solid #c4b5fd;border-radius:8px;padding:10px">';
    c += '<div style="font-weight:700;color:#7c3aed;font-size:.82rem;margin-bottom:4px">⏳ Waiting on Parts</div>';
    if(t.parts_number) c += '<div style="font-size:.8rem;color:#6d28d9">Part #: <strong>'+t.parts_number+'</strong></div>';
    if(t.parts_note) c += '<div style="font-size:.78rem;color:#6d28d9;margin-top:2px">'+t.parts_note+'</div>';
    if(t.parts_photo) c += '<img src="'+t.parts_photo+'" style="max-width:100%;border-radius:6px;margin-top:6px;max-height:120px;cursor:pointer" class="todo-photo-thumb">';
    if(t.parts_ordered) c += '<div style="font-size:.75rem;color:#16a34a;margin-top:4px;font-weight:600">✅ Part ordered'+(t.parts_eta?' · ETA: '+fmtDate(t.parts_eta):'')+'</div>';
    else c += '<div style="font-size:.75rem;color:#92400e;margin-top:4px">⏳ Awaiting order — grade not affected</div>';
    c += '</div>';
  } else {
    c += '<div style="margin-top:6px;font-size:.75rem;color:#16a34a">✅ Completed '+fmtDate(t.completed_at)+'</div>';
    if(t.completion_photo) c += '<div style="margin-top:4px"><img src="'+t.completion_photo+'" style="max-width:120px;border-radius:6px;cursor:pointer" class="todo-photo-thumb"></div>';
  }
  c += '</div>';
  return c;
}

function todoStartComplete(instanceId) {
  var task = _todoTasks.find(function(t){return t.id===instanceId;});
  if(!task) return;
  if(task.status==='pending') {
    _todoTaskStartTime = Date.now();
    apiCall('POST','/api/tasks?action=update_instance',{instance_id:instanceId,status:'in_progress'})
      .then(function(){ task.status='in_progress'; todoLoadTab(); });
    return;
  }
  _todoPhotoData = null;
  var modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div style="background:#fff;border-radius:14px;padding:20px;width:100%;max-width:420px"><h3 style="margin:0 0 12px;color:#1a3a6b">✅ Complete Task</h3><p style="font-size:.85rem;color:#64748b;margin:0 0 12px"><strong>'+task.title+'</strong></p><div style="margin-bottom:12px"><label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:4px">📷 Completion Photo (Required)</label><input type="file" id="todo-photo-input" accept="image/*" style="width:100%;font-size:.8rem"><div id="todo-photo-preview" style="margin-top:8px"></div></div><div style="margin-bottom:12px"><label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:4px">📝 Note (Optional)</label><textarea id="todo-note-input" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:.82rem;box-sizing:border-box" placeholder="Add a note..."></textarea></div><div style="display:flex;gap:8px"><button id="todo-submit-btn" style="flex:1;background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600">Submit</button><button id="todo-cancel-btn" style="flex:1;background:#f1f5f9;color:#64748b;border:none;border-radius:8px;padding:10px;cursor:pointer">Cancel</button></div></div>';
  document.body.appendChild(modal);
  document.getElementById('todo-photo-input').addEventListener('change', function() {
    var file = this.files[0];
    if(!file) return;
    if(file.size>1048576){ toast('Photo must be under 1MB'); this.value=''; return; }
    var reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('todo-photo-preview').innerHTML = '<img src="'+e.target.result+'" style="max-width:100%;border-radius:6px;max-height:120px">';
      _todoPhotoData = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('todo-submit-btn').addEventListener('click', function(){ todoSubmitComplete(instanceId, modal); });
  document.getElementById('todo-cancel-btn').addEventListener('click', function(){ modal.remove(); });
}

async function todoSubmitComplete(instanceId, modal) {
  if(!_todoPhotoData){ toast('📷 Please select a completion photo'); return; }
  var note = (document.getElementById('todo-note-input')||{}).value||'';
  var task = _todoTasks.find(function(t){return t.id===instanceId;});
  var taskTime = _todoTaskStartTime?Math.round((Date.now()-_todoTaskStartTime)/1000):0;
  try {
    await apiCall('POST','/api/tasks?action=update_instance',{
      instance_id:instanceId, status:'complete',
      completion_photo:_todoPhotoData, completion_note:note,
      step_completions:(task&&task.step_completions)||[]
    });
    if(taskTime>0) apiCall('POST','/api/tasks?action=log_session',{task_time_seconds:taskTime}).catch(function(){});
    _todoPhotoData=null; _todoTaskStartTime=null;
    if(modal) modal.remove();
    toast('✅ Task completed!');
    todoLoadTab(); todoBadgeUpdate();
  } catch(e){ toast('❌ '+e.message); }
}

async function todoToggleStep(instanceId, stepIdx, checked) {
  var task = _todoTasks.find(function(t){return t.id===instanceId;});
  if(!task) return;
  var steps = task.step_completions||[];
  var updated = checked?Array.from(new Set(steps.concat(stepIdx))):steps.filter(function(s){return s!==stepIdx;});
  task.step_completions = updated;
  apiCall('POST','/api/tasks?action=update_instance',{instance_id:instanceId,status:task.status,step_completions:updated}).catch(function(e){toast('❌ '+e.message);});
}

async function todoAckMsg(msgId) {
  await apiCall('POST','/api/tasks?action=ack_message',{message_id:msgId}).catch(function(){});
  _todoMessages = _todoMessages.filter(function(m){return m.id!==msgId;});
  todoLoadTab(); todoBadgeUpdate();
}

// ── TAB 1: SCHEDULE ──
async function todoSchedule(body) {
  var tasks = await apiCall('POST','/api/tasks',{action:'day_tasks',date:_todoDate});
  var isAdmin = currentUser&&currentUser.role==='admin';
  var today = new Date().toISOString().split('T')[0];
  var prevDate = new Date(new Date(_todoDate).getTime()-86400000).toISOString().split('T')[0];
  var nextDate = new Date(new Date(_todoDate).getTime()+86400000).toISOString().split('T')[0];
  var dateObj = new Date(_todoDate+'T12:00:00');
  var dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var dayLabel = _todoDate===today?'Today':dayNames[dateObj.getDay()]+', '+monthNames[dateObj.getMonth()]+' '+dateObj.getDate();
  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">';
  html += '<button id="todo-prev-day" style="background:#f1f5f9;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:1rem">‹</button>';
  html += '<div style="text-align:center"><div style="font-weight:700;color:#1a3a6b">'+dayLabel+'</div><div style="font-size:.75rem;color:#94a3b8">'+_todoDate+'</div></div>';
  html += '<button id="todo-next-day" style="background:#f1f5f9;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:1rem">›</button></div>';
  if(isAdmin) html += '<button id="todo-create-btn" style="width:100%;background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600;margin-bottom:14px;font-size:.85rem">+ Create Task for This Day</button>';
  if(!tasks.length) html += '<div style="text-align:center;padding:32px;color:#94a3b8"><div style="font-size:2rem">📅</div><div>No tasks scheduled for this day</div></div>';
  else {
    if(isAdmin) {
      var grouped = {};
      tasks.forEach(function(t){ var k=t.assigned_username||'Unknown'; (grouped[k]=grouped[k]||[]).push(t); });
      Object.keys(grouped).forEach(function(uname) {
        html += '<div style="margin-bottom:16px"><div style="font-weight:700;color:#1a3a6b;font-size:.85rem;padding:6px 10px;background:#f1f5f9;border-radius:6px;margin-bottom:8px">👤 '+uname+'</div>';
        grouped[uname].forEach(function(t){ html += todoSchedCard(t); });
        html += '</div>';
      });
    } else tasks.forEach(function(t){ html += todoSchedCard(t); });
  }
  body.innerHTML = html;
  var prevBtn = document.getElementById('todo-prev-day');
  var nextBtn = document.getElementById('todo-next-day');
  var createBtn = document.getElementById('todo-create-btn');
  if(prevBtn) prevBtn.addEventListener('click', function(){ _todoDate=prevDate; todoLoadTab(); });
  if(nextBtn) nextBtn.addEventListener('click', function(){ _todoDate=nextDate; todoLoadTab(); });
  if(createBtn) createBtn.addEventListener('click', todoShowCreateTask);
}

function todoSchedCard(t) {
  return '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start"><div style="width:42px;text-align:center;flex-shrink:0"><div style="font-size:1.2rem">'+catIcon(t.category)+'</div><div style="font-size:.65rem;color:#94a3b8;margin-top:2px">'+(t.due_time?t.due_time.substring(0,5):'Any')+'</div></div><div style="flex:1"><div style="font-weight:600;color:#1e293b;font-size:.85rem">'+t.title+'</div>'+(t.description?'<div style="font-size:.75rem;color:#64748b">'+t.description+'</div>':'')+'<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap"><span style="padding:1px 6px;border-radius:8px;font-size:.68rem;'+priorityBg(t.priority)+'">'+t.priority+'</span>'+statusBadge(t.status)+'</div></div></div>';
}

// ── TAB 2: MESSAGES ──
async function todoMessages(body) {
  var msgs = await apiCall('POST','/api/tasks',{action:'messages'});
  _todoMessages = msgs;
  var isAdmin = currentUser&&currentUser.role==='admin';
  var html = '';
  if(isAdmin) html += '<button id="todo-send-msg-btn" style="width:100%;background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600;margin-bottom:14px;font-size:.85rem">✉️ Send Message to User</button>';
  if(!msgs.length) html += '<div style="text-align:center;padding:32px;color:#94a3b8"><div style="font-size:2rem">✉️</div><div>No pending messages</div></div>';
  else msgs.forEach(function(m) {
    html += '<div style="background:#fffbeb;border:2px solid #f59e0b;border-radius:10px;padding:14px;margin-bottom:10px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">';
    html += '<div style="flex:1"><div style="font-weight:700;color:#92400e;font-size:.82rem;margin-bottom:4px">💬 From '+m.from_name+'</div><div style="color:#78350f">'+m.body+'</div>';
    if(m.photo) html += '<img src="'+m.photo+'" style="max-width:100%;border-radius:6px;margin-top:8px;max-height:200px">';
    html += '<div style="font-size:.7rem;color:#94a3b8;margin-top:6px">'+fmtDate(m.created_at)+'</div></div>';
    html += '<button class="todo-ack-btn" data-msgid="'+m.id+'" style="background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:.8rem;font-weight:600;white-space:nowrap;flex-shrink:0">Got It ✓</button>';
    html += '</div></div>';
  });
  body.innerHTML = html;
  var sendBtn = document.getElementById('todo-send-msg-btn');
  if(sendBtn) sendBtn.addEventListener('click', todoShowSendMessage);
  body.querySelectorAll('.todo-ack-btn').forEach(function(btn) {
    btn.addEventListener('click', function(){ todoAckMsg(parseInt(this.dataset.msgid)); });
  });
}

// ── TAB 3: GRADES ──
async function todoGrades(body) {
  var isAdmin = currentUser&&currentUser.role==='admin';
  var grades = await apiCall('POST','/api/tasks',{action:'grades'});
  var engagement = [];
  if(isAdmin) { try { engagement = await apiCall('POST','/api/tasks',{action:'engagement'}); } catch(e){} }
  _todoGrades = grades; _todoEngagement = engagement;
  var html = '';
  if(!isAdmin) {
    var g = grades[0];
    if(!g){ body.innerHTML='<p style="color:#94a3b8;text-align:center;padding:24px">No task data yet</p>'; return; }
    var grade = calcGrade(parseInt(g.completed)||0, parseInt(g.total_tasks)||0, parseInt(g.missed)||0);
    html += '<div style="text-align:center;padding:20px;background:linear-gradient(135deg,#1a3a6b,#2563eb);border-radius:14px;color:#fff;margin-bottom:16px">';
    html += '<div style="font-size:4rem;font-weight:900">'+grade.letter+'</div>';
    html += '<div style="font-size:.9rem;opacity:.9">Your 30-Day Performance Grade</div></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">';
    html += '<div style="background:#f8fafc;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.3rem;font-weight:700;color:#1a3a6b">'+(g.total_tasks||0)+'</div><div style="font-size:.72rem;color:#64748b">Total</div></div>';
    html += '<div style="background:#dcfce7;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.3rem;font-weight:700;color:#16a34a">'+(g.completed||0)+'</div><div style="font-size:.72rem;color:#64748b">Done</div></div>';
    html += '<div style="background:#fee2e2;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.3rem;font-weight:700;color:#dc2626">'+(g.missed||0)+'</div><div style="font-size:.72rem;color:#64748b">Missed</div></div></div>';
    html += '<div style="background:#f8fafc;border-radius:8px;padding:12px"><div style="font-size:.8rem;font-weight:600;color:#1e293b;margin-bottom:8px">📈 Grading Scale</div>';
    var scale=[['A+','#16a34a','All tasks completed on time'],['A','#22c55e','90%+ completion'],['B','#2563eb','80-89% completion'],['C','#d97706','65-79% completion'],['D','#ea580c','30-64% / late'],['F','#dc2626','50%+ missed']];
    scale.forEach(function(s){ html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="width:24px;height:24px;border-radius:50%;background:'+s[1]+';color:#fff;font-size:.65rem;font-weight:700;display:flex;align-items:center;justify-content:center">'+s[0]+'</span><span style="font-size:.78rem;color:#64748b">'+s[2]+'</span></div>'; });
    html += '</div>';
  } else {
    html += '<div style="font-weight:700;color:#1a3a6b;margin-bottom:12px">👥 Employee Performance — Last 30 Days</div>';
    grades.forEach(function(g) {
      var grade = calcGrade(parseInt(g.completed)||0, parseInt(g.total_tasks)||0, parseInt(g.missed)||0);
      var eng = engagement.find(function(e){return e.id===g.id;});
      var secs = parseInt((eng&&eng.total_session_seconds)||0);
      html += '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:12px">';
      html += '<div style="width:36px;height:36px;border-radius:50%;background:'+grade.color+';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:'+(grade.letter.length>1?'.75':'1')+'rem;flex-shrink:0">'+grade.letter+'</div>';
      html += '<div style="flex:1"><div style="font-weight:600;color:#1e293b">'+g.username+' <span style="font-size:.72rem;color:#94a3b8;font-weight:400">'+g.role+'</span></div>';
      html += '<div style="font-size:.75rem;color:#64748b">'+(g.total_tasks?g.completed+'/'+g.total_tasks+' tasks · '+(g.missed||0)+' missed':'No tasks')+(secs?' · '+fmtTime(secs)+' in app':'')+'</div></div></div>';
    });
  }
  body.innerHTML = html;
}

// ── TAB 4: MANAGE ──
async function todoManage(body) {
  if(!currentUser||currentUser.role!=='admin'){ body.innerHTML='<p>Admin only</p>'; return; }
  var allTasks = await apiCall('POST','/api/tasks',{action:'all_tasks'});
  var grades = await apiCall('POST','/api/tasks',{action:'grades'});
  _todoAllTasks = allTasks; _todoUsers = grades;
  var html = '<div style="display:flex;gap:8px;margin-bottom:16px">';
  html += '<button id="todo-new-task-btn" style="flex:1;background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600;font-size:.82rem">+ New Task</button>';
  html += '<button id="todo-send-msg-btn2" style="flex:1;background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600;font-size:.82rem">✉️ Message User</button></div>';
  try {
    var eng = await apiCall('POST','/api/tasks',{action:'engagement'});
    html += '<div style="background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:14px">';
    html += '<div style="font-weight:700;color:#1a3a6b;font-size:.85rem;margin-bottom:8px">⏱ App Engagement (Last 30 Days)</div>';
    eng.forEach(function(e) {
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #e2e8f0">';
      html += '<span style="font-size:.8rem;font-weight:600">'+e.username+'</span>';
      html += '<span style="font-size:.75rem;color:#64748b">'+fmtTime(parseInt(e.total_session_seconds)||0)+' · '+(e.tasks_completed||0)+' tasks</span></div>';
    });
    html += '</div>';
  } catch(ex){}
  html += '<div style="font-weight:700;color:#1a3a6b;margin-bottom:8px">Active Tasks ('+allTasks.length+')</div>';
  // Parts waiting section
  try {
    var waitingParts = await apiCall('GET','/api/tasks?action=waiting_parts_list');
    if(waitingParts && waitingParts.length>0) {
      html += '<div style="background:#f3e8ff;border:1px solid #c4b5fd;border-radius:10px;padding:12px;margin-bottom:14px">';
      html += '<div style="font-weight:700;color:#7c3aed;font-size:.85rem;margin-bottom:8px">⏳ Parts Requests ('+waitingParts.length+')</div>';
      waitingParts.forEach(function(p) {
        html += '<div style="background:#fff;border-radius:8px;padding:10px;margin-bottom:6px;border:1px solid #ddd6fe">';
        html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">';
        html += '<div style="flex:1">';
        html += '<div style="font-weight:600;font-size:.83rem">'+p.title+' — <span style="color:#7c3aed">'+p.assigned_username+'</span></div>';
        if(p.parts_number) html += '<div style="font-size:.78rem;color:#6d28d9">Part #: <strong>'+p.parts_number+'</strong></div>';
        if(p.parts_note) html += '<div style="font-size:.75rem;color:#64748b">'+p.parts_note+'</div>';
        if(p.parts_photo) html += '<img src="'+p.parts_photo+'" style="max-width:100%;border-radius:6px;margin-top:4px;max-height:80px">';
        html += '</div>';
        html += '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">';
        if(!p.parts_ordered) {
          html += '<button class="todo-order-btn" data-id="'+p.id+'" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:.75rem;font-weight:600">📦 Mark Ordered</button>';
        } else if(!p.parts_received) {
          html += '<span style="font-size:.72rem;color:#16a34a;font-weight:600">✅ Ordered'+(p.parts_eta?' ETA: '+fmtDate(p.parts_eta):'')+'</span>';
          html += '<button class="todo-received-btn" data-id="'+p.id+'" style="background:#16a34a;color:#fff;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:.75rem;font-weight:600">✅ Part Arrived!</button>';
        } else {
          html += '<span style="font-size:.72rem;color:#16a34a;font-weight:600">✅ Part received</span>';
        }
        html += '</div></div></div>';
      });
      html += '</div>';
    }
  } catch(ex){}
  if(!allTasks.length) html += '<div style="text-align:center;padding:24px;color:#94a3b8">No tasks created yet</div>';
  else allTasks.forEach(function(t) {
    html += '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px"><div style="display:flex;justify-content:space-between;align-items:flex-start">';
    html += '<div><div style="font-weight:600;font-size:.85rem">'+catIcon(t.category)+' '+t.title+'</div>';
    html += '<div style="font-size:.73rem;color:#64748b">'+t.assigned_to+' · '+(t.recurring!=='none'?'🔄 '+t.recurring:'One-time')+' · '+fmtDate(t.due_date)+' · ✅ '+t.completions+' done'+(parseInt(t.overdue_count)>0?' · 🔴 '+t.overdue_count+' overdue':'')+'</div></div>';
    html += '<button class="todo-del-task" data-tid="'+t.id+'" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:.75rem">Delete</button></div></div>';
  });
  body.innerHTML = html;
  var newBtn = document.getElementById('todo-new-task-btn');
  var msgBtn = document.getElementById('todo-send-msg-btn2');
  if(newBtn) newBtn.addEventListener('click', todoShowCreateTask);
  if(msgBtn) msgBtn.addEventListener('click', todoShowSendMessage);
  body.querySelectorAll('.todo-del-task').forEach(function(btn) {
    btn.addEventListener('click', function(){ todoDeleteTask(parseInt(this.dataset.tid)); });
  });
  body.querySelectorAll('.todo-order-btn').forEach(function(btn) {
    btn.addEventListener('click', function(){
      var id = parseInt(this.dataset.id);
      var m=document.createElement('div');
      m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
      m.innerHTML='<div style="background:#fff;border-radius:12px;padding:20px;width:100%;max-width:340px"><h3 style="margin:0 0 12px;color:#7c3aed">📦 Mark Part Ordered</h3><label style="font-size:.82rem;font-weight:600;display:block;margin-bottom:4px">Expected Arrival Date (optional)</label><input type="date" id="eta-input" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box;margin-bottom:12px"><div style="display:flex;gap:8px"><button id="eta-ok" style="flex:1;background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600">Confirm</button><button id="eta-no" style="flex:1;background:#f1f5f9;color:#64748b;border:none;border-radius:8px;padding:10px;cursor:pointer">Cancel</button></div></div>';
      document.body.appendChild(m);
      document.getElementById('eta-ok').addEventListener('click',function(){
        var eta=document.getElementById('eta-input').value||null;
        m.remove();
        apiCall('POST','/api/tasks?action=mark_parts_ordered',{instance_id:id,parts_eta:eta})
          .then(function(){ toast('📦 Part ordered! Employee notified.'); todoLoadTab(); })
          .catch(function(e){ toast('❌ '+e.message); });
      });
      document.getElementById('eta-no').addEventListener('click',function(){ m.remove(); });
    });
  });
  body.querySelectorAll('.todo-received-btn').forEach(function(btn) {
    btn.addEventListener('click', function(){
      var id = parseInt(this.dataset.id);
      if(!confirm('Mark part as received and reopen task?')) return;
      apiCall('POST','/api/tasks?action=mark_parts_received',{instance_id:id})
        .then(function(){ toast('✅ Part received! Task reopened and user notified.'); todoLoadTab(); })
        .catch(function(e){ toast('❌ '+e.message); });
    });
  });
}

async function todoDeleteTask(taskId) {
  if(!confirm('Delete this task?')) return;
  await apiCall('POST','/api/tasks?action=delete_task',{task_id:taskId});
  toast('🗑 Task deleted'); todoLoadTab();
}

// ── CREATE TASK MODAL ──
function todoShowCreateTask() {
  var users = _todoUsers||[];
  var modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px;overflow-y:auto';
  var userOpts = '<option value="all">Everyone</option>'+users.map(function(u){ return '<option value="'+u.id+'">'+u.username+' ('+u.role+')</option>'; }).join('');
  var dayOpts = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(d){ return '<label style="display:flex;align-items:center;gap:3px;font-size:.78rem"><input type="checkbox" class="ct-day-check" value="'+d+'">'+d+'</label>'; }).join('');
  modal.innerHTML = '<div style="background:#fff;border-radius:14px;padding:20px;width:100%;max-width:460px;max-height:90vh;overflow-y:auto"><h3 style="margin:0 0 14px;color:#1a3a6b">📋 Create Task</h3><div style="display:grid;gap:10px"><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Title *</label><input id="ct-title" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box"></div><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Description</label><textarea id="ct-desc" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box"></textarea></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Category</label><select id="ct-cat" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px"><option>Production</option><option>Maintenance</option><option>Quality</option><option>Safety</option><option>General</option></select></div><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Priority</label><select id="ct-pri" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px"><option>High</option><option selected>Medium</option><option>Low</option></select></div></div><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Assign To *</label><select id="ct-user" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px">'+userOpts+'</select></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Due Date</label><input type="date" id="ct-date" value="'+_todoDate+'" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box"></div><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Due Time</label><input type="time" id="ct-time" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box"></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Shift</label><select id="ct-shift" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px"><option value="Any">Any</option><option>AM</option><option>PM</option><option>Night</option></select></div><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Recurring</label><select id="ct-rec" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px"><option value="none">One-time</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div></div><div id="ct-rec-days" style="display:none"><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:4px">Days (for weekly)</label><div style="display:flex;gap:4px;flex-wrap:wrap">'+dayOpts+'</div></div><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:4px">Checklist Steps</label><div id="ct-steps"></div><button id="ct-add-step" style="background:#f1f5f9;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:.78rem;margin-top:4px">+ Add Step</button></div></div><div style="display:flex;gap:8px;margin-top:16px"><button id="ct-submit" style="flex:1;background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600">Create Task</button><button id="ct-cancel" style="flex:1;background:#f1f5f9;color:#64748b;border:none;border-radius:8px;padding:10px;cursor:pointer">Cancel</button></div></div>';
  document.body.appendChild(modal);
  document.getElementById('ct-rec').addEventListener('change', function() {
    document.getElementById('ct-rec-days').style.display = this.value==='weekly'?'block':'none';
  });
  document.getElementById('ct-add-step').addEventListener('click', function() {
    var c = document.getElementById('ct-steps');
    var r = document.createElement('div'); r.style.cssText='display:flex;gap:4px;margin-bottom:4px';
    r.innerHTML='<input placeholder="Step '+(c.children.length+1)+'..." style="flex:1;padding:6px;border:1px solid #e2e8f0;border-radius:6px;font-size:.8rem"><button style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 8px;cursor:pointer">×</button>';
    r.querySelector('button').addEventListener('click', function(){ r.remove(); });
    c.appendChild(r);
  });
  document.getElementById('ct-submit').addEventListener('click', function(){ todoSubmitTask(modal); });
  document.getElementById('ct-cancel').addEventListener('click', function(){ modal.remove(); });
}

async function todoSubmitTask(modal) {
  var title = (document.getElementById('ct-title')||{}).value||'';
  if(!title.trim()){ toast('Title is required'); return; }
  var rec = (document.getElementById('ct-rec')||{}).value||'none';
  var recDays = '';
  if(rec==='weekly') recDays = Array.from(document.querySelectorAll('.ct-day-check:checked')).map(function(i){return i.value;}).join(',');
  var steps = Array.from(document.querySelectorAll('#ct-steps input')).map(function(i){return i.value.trim();}).filter(Boolean);
  try {
    await apiCall('POST','/api/tasks?action=create_task',{
      title:title.trim(),
      description:(document.getElementById('ct-desc')||{}).value||'',
      category:(document.getElementById('ct-cat')||{}).value||'General',
      priority:(document.getElementById('ct-pri')||{}).value||'Medium',
      assigned_to:(document.getElementById('ct-user')||{}).value,
      due_date:(document.getElementById('ct-date')||{}).value||null,
      due_time:(document.getElementById('ct-time')||{}).value||null,
      shift:(document.getElementById('ct-shift')||{}).value||'Any',
      recurring:rec, recurring_days:recDays, steps:steps
    });
    if(modal) modal.remove();
    toast('✅ Task created!');
    _todoTab=4; todoLoadTab(); todoBadgeUpdate();
  } catch(e){ toast('❌ '+e.message); }
}

// ── SEND MESSAGE MODAL ──
function todoShowSendMessage() {
  var users = _todoUsers||[];
  var modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  var userOpts = users.map(function(u){ return '<option value="'+u.id+'">'+u.username+' ('+u.role+')</option>'; }).join('');
  modal.innerHTML = '<div style="background:#fff;border-radius:14px;padding:20px;width:100%;max-width:420px"><h3 style="margin:0 0 14px;color:#1a3a6b">✉️ Send Message</h3><div style="display:grid;gap:10px"><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">To *</label><select id="sm-user" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px">'+userOpts+'</select></div><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Message *</label><textarea id="sm-body" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box" placeholder="Type your message..."></textarea></div><div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">📷 Photo (Optional, max 1MB)</label><input type="file" id="sm-photo" accept="image/*" style="width:100%;font-size:.8rem"><div id="sm-preview" style="margin-top:6px"></div></div></div><div style="display:flex;gap:8px;margin-top:16px"><button id="sm-send" style="flex:1;background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600">Send</button><button id="sm-cancel" style="flex:1;background:#f1f5f9;color:#64748b;border:none;border-radius:8px;padding:10px;cursor:pointer">Cancel</button></div></div>';
  document.body.appendChild(modal);
  _smPhotoData = null;
  document.getElementById('sm-photo').addEventListener('change', function() {
    var file = this.files[0];
    if(!file) return;
    if(file.size>1048576){ toast('Photo must be under 1MB'); this.value=''; return; }
    var reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('sm-preview').innerHTML = '<img src="'+e.target.result+'" style="max-width:100%;border-radius:6px;max-height:100px">';
      _smPhotoData = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('sm-send').addEventListener('click', function(){ todoSendMessage(modal); });
  document.getElementById('sm-cancel').addEventListener('click', function(){ modal.remove(); });
}

async function todoSendMessage(modal) {
  var to = parseInt((document.getElementById('sm-user')||{}).value);
  var body = ((document.getElementById('sm-body')||{}).value||'').trim();
  if(!body){ toast('Message is required'); return; }
  try {
    await apiCall('POST','/api/tasks?action=send_message',{to_user_id:to, body:body, photo:_smPhotoData||null});
    _smPhotoData=null;
    if(modal) modal.remove();
    toast('✅ Message sent!');
  } catch(e){ toast('❌ '+e.message); }
}


// ── WAITING ON PARTS MODAL ──
var _partsPhotoData = null;

function todoShowWaitingParts(instanceId) {
  var task = _todoTasks.find(function(t){return t.id===instanceId;});
  if(!task) return;
  _partsPhotoData = null;
  var modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div style="background:#fff;border-radius:14px;padding:20px;width:100%;max-width:440px">'
    +'<h3 style="margin:0 0 6px;color:#7c3aed">⏳ Waiting on Parts</h3>'
    +'<p style="font-size:.82rem;color:#64748b;margin:0 0 14px"><strong>'+task.title+'</strong> — your grade will NOT be affected while waiting</p>'
    +'<div style="display:grid;gap:10px">'
    +'<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Part Number</label>'
    +'<input id="wp-partnum" placeholder="e.g. MC-4421-B" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box;font-size:.85rem"></div>'
    +'<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Description / Note</label>'
    +'<textarea id="wp-note" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box;font-size:.82rem" placeholder="Describe what part is needed and why..."></textarea></div>'
    +'<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">📷 Photo of Part (Optional, max 1MB)</label>'
    +'<input type="file" id="wp-photo" accept="image/*" style="width:100%;font-size:.8rem">'
    +'<div id="wp-preview" style="margin-top:6px"></div></div>'
    +'</div>'
    +'<p style="font-size:.75rem;color:#7c3aed;margin:10px 0 0;background:#f3e8ff;padding:8px;border-radius:6px">📋 This will automatically notify the admin to order the part. You will be notified when it arrives.</p>'
    +'<div style="display:flex;gap:8px;margin-top:14px">'
    +'<button id="wp-submit" style="flex:1;background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600">Submit Parts Request</button>'
    +'<button id="wp-cancel" style="flex:1;background:#f1f5f9;color:#64748b;border:none;border-radius:8px;padding:10px;cursor:pointer">Cancel</button>'
    +'</div></div>';
  document.body.appendChild(modal);
  document.getElementById('wp-photo').addEventListener('change', function() {
    var file = this.files[0];
    if(!file) return;
    if(file.size>1048576){ toast('Photo must be under 1MB'); this.value=''; return; }
    var reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('wp-preview').innerHTML = '<img src="'+e.target.result+'" style="max-width:100%;border-radius:6px;max-height:100px">';
      _partsPhotoData = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('wp-submit').addEventListener('click', function(){ todoSubmitWaitingParts(instanceId, modal); });
  document.getElementById('wp-cancel').addEventListener('click', function(){ modal.remove(); });
}

async function todoSubmitWaitingParts(instanceId, modal) {
  var partNum = (document.getElementById('wp-partnum')||{}).value||'';
  var note = (document.getElementById('wp-note')||{}).value||'';
  if(!partNum && !note && !_partsPhotoData) { toast('Please provide a part number, note, or photo'); return; }
  try {
    await apiCall('POST','/api/tasks?action=update_instance',{
      instance_id: instanceId,
      status: 'waiting_parts',
      parts_note: note||null,
      parts_number: partNum||null,
      parts_photo: _partsPhotoData||null
    });
    _partsPhotoData = null;
    if(modal) modal.remove();
    toast('⏳ Parts request submitted! Admin notified. Grade protected.');
    todoLoadTab(); todoBadgeUpdate();
  } catch(e) { toast('❌ '+e.message); }
}

window.todoShowWaitingParts = todoShowWaitingParts;
window.todoSubmitWaitingParts = todoSubmitWaitingParts;

// ── BADGE UPDATE ──
async function todoBadgeUpdate() {
  try {
    var tasks = await apiCall('POST','/api/tasks',{action:'my_tasks'});
    var msgs = await apiCall('POST','/api/tasks',{action:'messages'});
    var today = new Date().toISOString().split('T')[0];
    var pending = tasks.filter(function(t){return t.status!=='complete';}).length;
    var overdue = tasks.filter(function(t){return t.status==='pending'&&t.instance_date<today;}).length;
    var total = pending + msgs.length;
    var badge = document.getElementById('todo-badge');
    if(badge) {
      if(!total){ badge.style.display='none'; return; }
      badge.textContent = total;
      badge.style.background = overdue?'#dc2626':'#f59e0b';
      badge.style.display = 'flex';
    }
  } catch(e){}
}

// Expose to global
window.todoRender=todoRender;
window.todoTab=todoTab;
window.todoLoadTab=todoLoadTab;
window.todoAckMsg=todoAckMsg;
window.todoStartComplete=todoStartComplete;
window.todoSubmitComplete=todoSubmitComplete;
window.todoToggleStep=todoToggleStep;
window.todoDeleteTask=todoDeleteTask;
window.todoShowCreateTask=todoShowCreateTask;
window.todoSubmitTask=todoSubmitTask;
window.todoShowSendMessage=todoShowSendMessage;
window.todoSendMessage=todoSendMessage;
window.todoBadgeUpdate=todoBadgeUpdate;

// ════════════════════════════════════════════════════════
//  MESSAGE NOTIFICATION SYSTEM
//  Shows a persistent banner on login + every widget open
// ════════════════════════════════════════════════════════

var _msgCheckInterval = null;

// Check for unread messages and show banner if any
async function checkAndShowMsgBanner() {
  if (!currentUser) return;
  try {
    var msgs = await apiCall('GET', '/api/tasks?action=messages');
    if (msgs && msgs.length > 0) {
      showMsgBanner(msgs);
    } else {
      hideMsgBanner();
    }
  } catch(e) {}
}

function showMsgBanner(msgs) {
  // Remove existing banner if any
  var existing = document.getElementById('msg-alert-banner');
  if (existing) existing.remove();

  var banner = document.createElement('div');
  banner.id = 'msg-alert-banner';
  banner.style.cssText = [
    'position:fixed',
    'top:0','left:0','right:0',
    'z-index:99999',
    'background:#f59e0b',
    'box-shadow:0 4px 20px rgba(0,0,0,.4)',
    'display:flex',
    'flex-direction:column',
    'max-height:60vh',
    'overflow-y:auto',
  ].join(';');

  var header = document.createElement('div');
  header.style.cssText = 'background:#d97706;padding:10px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:1';
  header.innerHTML = '<span style="font-size:1.3rem">🔔</span>' +
    '<span style="font-weight:800;color:#fff;font-size:.95rem">You have '+msgs.length+' new message'+(msgs.length>1?'s':'')+' — must acknowledge to continue</span>';
  banner.appendChild(header);

  msgs.forEach(function(m) {
    var card = document.createElement('div');
    card.style.cssText = 'background:#fffbeb;border-bottom:2px solid #f59e0b;padding:14px 16px;display:flex;align-items:flex-start;gap:12px';
    var txt = document.createElement('div');
    txt.style.cssText = 'flex:1';
    txt.innerHTML = '<div style="font-weight:700;color:#92400e;font-size:.85rem;margin-bottom:4px">💬 From: '+m.from_name+'</div>' +
      '<div style="color:#78350f;font-size:.9rem;line-height:1.4">'+m.body+'</div>' +
      (m.photo ? '<img src="'+m.photo+'" style="max-width:200px;border-radius:6px;margin-top:8px;max-height:120px">' : '') +
      '<div style="font-size:.72rem;color:#92400e;margin-top:4px;opacity:.7">'+new Date(m.created_at).toLocaleString()+'</div>';
    var ackBtn = document.createElement('button');
    ackBtn.textContent = 'Got It ✓';
    ackBtn.dataset.msgid = m.id;
    ackBtn.style.cssText = 'background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:10px 16px;cursor:pointer;font-weight:700;font-size:.85rem;white-space:nowrap;flex-shrink:0;margin-top:2px';
    ackBtn.addEventListener('click', function() {
      var id = parseInt(this.dataset.msgid);
      apiCall('POST', '/api/tasks?action=ack_message', {message_id: id})
        .then(function() {
          card.style.opacity = '0.4';
          card.style.pointerEvents = 'none';
          ackBtn.textContent = '✅ Acknowledged';
          // Remove this card after short delay and recheck
          setTimeout(function() {
            card.remove();
            // Recount remaining
            var remaining = banner.querySelectorAll('[data-msgid]').length;
            if (remaining === 0) {
              hideMsgBanner();
              todoBadgeUpdate();
            } else {
              header.querySelector('span:last-child').textContent =
                'You have '+remaining+' new message'+(remaining>1?'s':'')+' — must acknowledge to continue';
            }
          }, 600);
        })
        .catch(function(e) { alert('Error: '+e.message); });
    });
    card.appendChild(txt);
    card.appendChild(ackBtn);
    banner.appendChild(card);
  });

  document.body.appendChild(banner);

  // Push page content down so banner is visible
  var mainContent = document.getElementById('screen-dashboard');
  if (mainContent) mainContent.style.paddingTop = banner.offsetHeight + 'px';
}

function hideMsgBanner() {
  var b = document.getElementById('msg-alert-banner');
  if (b) b.remove();
  // Restore padding
  var mainContent = document.getElementById('screen-dashboard');
  if (mainContent) mainContent.style.paddingTop = '';
}

// Start polling for messages every 60 seconds while logged in
function startMsgPolling() {
  if (_msgCheckInterval) clearInterval(_msgCheckInterval);
  checkAndShowMsgBanner();
  _msgCheckInterval = setInterval(checkAndShowMsgBanner, 60000);
}

function stopMsgPolling() {
  if (_msgCheckInterval) { clearInterval(_msgCheckInterval); _msgCheckInterval = null; }
  hideMsgBanner();
}

window.checkAndShowMsgBanner = checkAndShowMsgBanner;
window.showMsgBanner = showMsgBanner;
window.hideMsgBanner = hideMsgBanner;
window.startMsgPolling = startMsgPolling;
window.stopMsgPolling = stopMsgPolling;
