

// Helper: find closest modal overlay
function todoFindModal(el) {
  let node = el;
  while(node) {
    if(node.style && node.style.position==='fixed') return node;
    node = node.parentElement;
  }
  return null;
}
// ════════════════════════════════════════════════════════
//  TODO WIDGET  — Tasks / Schedule / Messages / Grades / Manage
// ════════════════════════════════════════════════════════

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

// ── Grade calculator ─────────────────────────────────────
function calcGrade(completed, total, missed) {
  if (!total) return {letter:'N/A', color:'#999'};
  const missedPct = missed/total;
  const completedPct = completed/total;
  if (missedPct >= 0.5) return {letter:'F', color:'#dc2626'};
  if (missedPct >= 0.3) return {letter:'D', color:'#ea580c'};
  if (completedPct >= 0.98) return {letter:'A+', color:'#15803d'};
  if (completedPct >= 0.90) return {letter:'A', color:'#16a34a'};
  if (completedPct >= 0.80) return {letter:'B', color:'#2563eb'};
  if (completedPct >= 0.65) return {letter:'C', color:'#d97706'};
  return {letter:'D', color:'#ea580c'};
}

// ── Format seconds ───────────────────────────────────────
function fmtTime(secs) {
  const h=Math.floor(secs/3600), m=Math.floor((secs%3600)/60), s=secs%60;
  if(h>0) return h+'h '+m+'m';
  if(m>0) return m+'m '+s+'s';
  return s+'s';
}

// ── Safe date format ─────────────────────────────────────
function fmtDate(d) {
  if(!d) return '';
  const p=d.split('T')[0].split('-');
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[parseInt(p[1])-1]+' '+parseInt(p[2])+', '+p[0];
}

// ── Priority styles ──────────────────────────────────────
function priorityStyle(p) {
  if(p==='High') return 'background:#fee2e2;color:#dc2626;border:1px solid #fca5a5';
  if(p==='Low') return 'background:#dcfce7;color:#16a34a;border:1px solid #86efac';
  return 'background:#fef9c3;color:#ca8a04;border:1px solid #fde047';
}

// ── Category icon ────────────────────────────────────────
function catIcon(c) {
  const icons={Production:'⚙️',Maintenance:'🔧',Quality:'📊',Safety:'🦺',General:'📋'};
  return icons[c]||'📋';
}

// ── Status badge ─────────────────────────────────────────
function statusBadge(s) {
  const map={
    pending:{bg:'#f1f5f9',color:'#64748b',label:'Pending'},
    in_progress:{bg:'#eff6ff',color:'#2563eb',label:'In Progress'},
    complete:{bg:'#dcfce7',color:'#16a34a',label:'Complete'},
    overdue:{bg:'#fee2e2',color:'#dc2626',label:'Overdue'}
  };
  const m=map[s]||map.pending;
  return '<span style="padding:2px 8px;border-radius:12px;font-size:.72rem;font-weight:600;background:'+m.bg+';color:'+m.color+'">'+m.label+'</span>';
}

// ── Open Todo Widget ─────────────────────────────────────
function openTodo() {
  openWidget('todo');
}

// ── Main render ──────────────────────────────────────────
async function todoRender() {
  const wc = document.getElementById('widget-content');
  if(!wc) return;

  // Spawn recurring instances on each open
  try { await apiCall('POST','/api/tasks?action=spawn_instances',{}); } catch(e){}

  // Tab bar
  const isAdmin = currentUser?.role==='admin';
  const tabs = ['📋 My Tasks','📅 Schedule','💬 Messages','📊 Grades'];
  if(isAdmin) tabs.push('⚙️ Manage');

  wc.innerHTML = '<div style="display:flex;border-bottom:2px solid #e2e8f0;margin-bottom:0;overflow-x:auto;white-space:nowrap">' +
    tabs.map((t,i)=>'<button onclick="todoTab('+i+')" id="todo-tab-'+i+'" style="padding:10px 14px;border:none;background:'+(_todoTab===i?'#fff':'transparent')+';border-bottom:'+(_todoTab===i?'3px solid #1a3a6b':'3px solid transparent')+';font-weight:'+(_todoTab===i?'700':'400')+';color:'+(_todoTab===i?'#1a3a6b':'#64748b')+';cursor:pointer;font-size:.82rem;flex-shrink:0">'+t+'</button>').join('') +
  '</div><div id="todo-body" style="padding:16px;overflow-y:auto;max-height:420px"></div>';

  todoLoadTab();
}

function todoTab(i) {
  _todoTab = i;
  // Re-render tab bar highlight
  document.querySelectorAll('[id^="todo-tab-"]').forEach((btn,idx)=>{
    btn.style.borderBottom = idx===i?'3px solid #1a3a6b':'3px solid transparent';
    btn.style.fontWeight = idx===i?'700':'400';
    btn.style.color = idx===i?'#1a3a6b':'#64748b';
    btn.style.background = idx===i?'#fff':'transparent';
  });
  todoLoadTab();
}

async function todoLoadTab() {
  const body = document.getElementById('todo-body');
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

// ════════════════ TAB 0: MY TASKS ════════════════════════
async function todoMyTasks(body) {
  const tasks = await apiCall('GET','/api/tasks?action=my_tasks');
  _todoTasks = tasks;

  const pending = tasks.filter(t=>t.status!=='complete');
  const done = tasks.filter(t=>t.status==='complete');
  const overdue = tasks.filter(t=>t.status==='pending' && t.instance_date < new Date().toISOString().split('T')[0]);

  // Get unread messages count
  const msgs = await apiCall('GET','/api/tasks?action=messages');
  _todoMessages = msgs;

  let html = '';

  // Message banners
  if(msgs.length) {
    html += msgs.map(m=>'<div style="background:#fffbeb;border:2px solid #f59e0b;border-radius:10px;padding:12px;margin-bottom:10px">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
      '<div><div style="font-weight:700;color:#92400e;font-size:.82rem">💬 Message from '+m.from_name+'</div>'+
      '<div style="color:#78350f;margin:6px 0">'+m.body+'</div>'+
      (m.photo?'<img src="'+m.photo+'" style="max-width:100%;border-radius:6px;margin-top:6px;max-height:150px" />':'')+'</div>'+
      '<button onclick="todoAckMsg('+m.id+')" style="background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:.75rem;cursor:pointer;white-space:nowrap;margin-left:8px">Got It ✓</button>'+
      '</div></div>').join('');
  }

  // Summary bar
  html += '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">';
  html += '<div style="flex:1;min-width:80px;background:#eff6ff;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.4rem;font-weight:700;color:#2563eb">'+pending.length+'</div><div style="font-size:.72rem;color:#64748b">Pending</div></div>';
  html += '<div style="flex:1;min-width:80px;background:#dcfce7;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.4rem;font-weight:700;color:#16a34a">'+done.length+'</div><div style="font-size:.72rem;color:#64748b">Done</div></div>';
  if(overdue.length) html += '<div style="flex:1;min-width:80px;background:#fee2e2;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.4rem;font-weight:700;color:#dc2626">'+overdue.length+'</div><div style="font-size:.72rem;color:#64748b">Overdue</div></div>';
  html += '</div>';

  if(!tasks.length) {
    html += '<div style="text-align:center;padding:32px;color:#94a3b8"><div style="font-size:2rem">✅</div><div>No tasks for today!</div></div>';
  } else {
    html += tasks.map(t=>todoTaskCard(t)).join('');
  }

  body.innerHTML = html;
}

function todoTaskCard(t) {
  const steps = t.steps || [];
  const stepsDone = (t.step_completions||[]).length;
  const isComplete = t.status==='complete';
  const isOverdue = t.status==='pending' && t.instance_date < new Date().toISOString().split('T')[0];

  let card = '<div style="border:1px solid '+(isOverdue?'#fca5a5':'#e2e8f0')+';border-radius:10px;padding:12px;margin-bottom:10px;background:'+(isOverdue?'#fff5f5':'#fff')+'">';
  // Header
  card += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">';
  card += '<div><div style="font-weight:700;color:#1e293b">'+catIcon(t.category)+' '+t.title+'</div>';
  if(t.description) card += '<div style="font-size:.78rem;color:#64748b;margin-top:2px">'+t.description+'</div>';
  card += '</div><div style="display:flex;gap:4px;flex-shrink:0">';
  card += '<span style="padding:2px 7px;border-radius:10px;font-size:.7rem;font-weight:600;'+priorityStyle(t.priority)+'">'+t.priority+'</span>';
  card += statusBadge(t.status)+'</div></div>';
  // Time + shift
  if(t.due_time || t.shift!=='Any') {
    card += '<div style="font-size:.75rem;color:#64748b;margin-bottom:8px">'+
      (t.due_time?'🕐 Due: '+t.due_time.substring(0,5)+' ':'')+(t.shift!=='Any'?'· '+t.shift+' shift':'')+'</div>';
  }
  // Progress bar for steps
  if(steps.length) {
    const pct = isComplete?100:Math.round(stepsDone/steps.length*100);
    card += '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:.72rem;color:#64748b;margin-bottom:3px"><span>Steps: '+stepsDone+'/'+steps.length+'</span><span>'+pct+'%</span></div>';
    card += '<div style="height:5px;background:#e2e8f0;border-radius:3px"><div style="height:5px;background:#1a3a6b;border-radius:3px;width:'+pct+'%"></div></div></div>';
    // Step list
    if(!isComplete) {
      card += '<div style="margin-bottom:8px">'+steps.map((s,i)=>{
        const done = (t.step_completions||[]).includes(i);
        return '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #f1f5f9">'+
          '<input type="checkbox" '+(done?'checked ':'')+' onchange="todoToggleStep('+t.id+','+i+',this.checked)" style="cursor:pointer">'+
          '<span style="font-size:.8rem;color:'+(done?'#94a3b8':'#1e293b')+';text-decoration:'+(done?'line-through':'none')+'">'+s+'</span></div>';
      }).join('')+'</div>';
    }
  }
  // Complete button (only if not done)
  if(!isComplete) {
    card += '<div style="display:flex;gap:8px;align-items:center;margin-top:8px">'+
      '<button onclick="todoStartComplete('+t.id+')" style="background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:.82rem;font-weight:600">'+
      (t.status==='in_progress'?'📷 Add Completion Photo':'▶ Start / Complete')+'</button>'+
      (t.status==='in_progress'?'<span style="font-size:.72rem;color:#64748b">Photo required to finish</span>':'')+'</div>';
  } else {
    card += '<div style="margin-top:6px;font-size:.75rem;color:#16a34a">✅ Completed '+fmtDate(t.completed_at)+'</div>';
    if(t.completion_photo) card += '<div style="margin-top:4px"><img src="'+t.completion_photo+'" style="max-width:120px;border-radius:6px;cursor:pointer" onclick="todoShowPhoto(this.src)"></div>';
  }
  card += '</div>';
  return card;
}

// Complete task flow (requires photo on final step)
function todoStartComplete(instanceId) {
  const task = _todoTasks.find(t=>t.id===instanceId);
  if(!task) return;

  // Mark as in_progress first
  if(task.status==='pending') {
    _todoTaskStartTime = Date.now();
    apiCall('POST','/api/tasks?action=update_instance',{instance_id:instanceId, status:'in_progress'})
      .then(()=>{ task.status='in_progress'; todoLoadTab(); });
    return;
  }

  // Show completion modal with photo upload
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div style="background:#fff;border-radius:14px;padding:20px;width:100%;max-width:420px">'+
    '<h3 style="margin:0 0 12px;color:#1a3a6b">✅ Complete Task</h3>'+
    '<p style="font-size:.85rem;color:#64748b;margin:0 0 12px"><strong>'+task.title+'</strong></p>'+
    '<div style="margin-bottom:12px"><label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:4px">📷 Completion Photo (Required)</label>'+
    '<input type="file" id="todo-photo-input" accept="image/*" style="width:100%;font-size:.8rem">'+
    '<div id="todo-photo-preview" style="margin-top:8px"></div></div>'+
    '<div style="margin-bottom:12px"><label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:4px">📝 Note (Optional)</label>'+
    '<textarea id="todo-note-input" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:.82rem;box-sizing:border-box" placeholder="Add a note..."></textarea></div>'+
    '<div style="display:flex;gap:8px">'+
    '<button onclick="todoSubmitComplete('+instanceId+',todoFindModal(this)" style="flex:1;background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600">Submit</button>'+
    '<button onclick="todoFindModal(this).remove()" style="flex:1;background:#f1f5f9;color:#64748b;border:none;border-radius:8px;padding:10px;cursor:pointer">Cancel</button>'+
    '</div></div>';

  document.body.appendChild(modal);

  // Preview photo
  document.getElementById('todo-photo-input').onchange = function() {
    const file = this.files[0];
    if(!file) return;
    if(file.size > 1048576) { toast('Photo must be under 1MB'); this.value=''; return; }
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('todo-photo-preview').innerHTML = '<img src="'+e.target.result+'" style="max-width:100%;border-radius:6px;max-height:120px">';
      window._todoPhotoData = e.target.result;
    };
    reader.readAsDataURL(file);
  };
}

async function todoSubmitComplete(instanceId, modal) {
  const photo = window._todoPhotoData;
  if(!photo) { toast('📷 Please select a completion photo'); return; }
  const note = document.getElementById('todo-note-input')?.value || '';
  const task = _todoTasks.find(t=>t.id===instanceId);
  const taskTime = _todoTaskStartTime ? Math.round((Date.now()-_todoTaskStartTime)/1000) : 0;

  try {
    await apiCall('POST','/api/tasks?action=update_instance',{
      instance_id: instanceId,
      status: 'complete',
      completion_photo: photo,
      completion_note: note,
      step_completions: task?.step_completions||[]
    });
    // Log task time
    if(taskTime>0) await apiCall('POST','/api/tasks?action=log_session',{task_time_seconds:taskTime}).catch(()=>{});
    window._todoPhotoData = null;
    _todoTaskStartTime = null;
    if(modal) modal.remove();
    toast('✅ Task completed!');
    todoLoadTab();
    todoBadgeUpdate();
  } catch(e) { toast('❌ '+e.message); }
}

async function todoToggleStep(instanceId, stepIdx, checked) {
  const task = _todoTasks.find(t=>t.id===instanceId);
  if(!task) return;
  const steps = task.step_completions||[];
  const updated = checked ? [...new Set([...steps, stepIdx])] : steps.filter(s=>s!==stepIdx);
  task.step_completions = updated;
  await apiCall('POST','/api/tasks?action=update_instance',{
    instance_id: instanceId, status: task.status, step_completions: updated
  }).catch(e=>toast('❌ '+e.message));
}

async function todoAckMsg(msgId) {
  await apiCall('POST','/api/tasks?action=ack_message',{message_id:msgId}).catch(()=>{});
  _todoMessages = _todoMessages.filter(m=>m.id!==msgId);
  todoLoadTab();
  todoBadgeUpdate();
}

function todoShowPhoto(src) {
  const overlay = document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.onclick=()=>overlay.remove();
  overlay.innerHTML='<img src="'+src+'" style="max-width:95%;max-height:90vh;border-radius:10px">';
  document.body.appendChild(overlay);
}

// ════════════════ TAB 1: SCHEDULE ════════════════════════
async function todoSchedule(body) {
  const tasks = await apiCall('GET','/api/tasks?action=day_tasks&date='+_todoDate);
  const isAdmin = currentUser?.role==='admin';

  // Day navigation
  const today = new Date().toISOString().split('T')[0];
  const prevDate = new Date(new Date(_todoDate).getTime()-86400000).toISOString().split('T')[0];
  const nextDate = new Date(new Date(_todoDate).getTime()+86400000).toISOString().split('T')[0];

  const dateObj = new Date(_todoDate+'T12:00:00');
  const dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayLabel = _todoDate===today ? 'Today' : dayNames[dateObj.getDay()]+', '+monthNames[dateObj.getMonth()]+' '+dateObj.getDate();

  let html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'+
    '<button onclick="todoNavDay(''+prevDate+'')" style="background:#f1f5f9;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:1rem">‹</button>'+
    '<div style="text-align:center"><div style="font-weight:700;color:#1a3a6b">'+dayLabel+'</div><div style="font-size:.75rem;color:#94a3b8">'+_todoDate+'</div></div>'+
    '<button onclick="todoNavDay(''+nextDate+'')" style="background:#f1f5f9;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:1rem">›</button>'+
    '</div>';

  if(isAdmin) {
    html += '<button onclick="todoShowCreateTask()" style="width:100%;background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600;margin-bottom:14px;font-size:.85rem">+ Create Task for This Day</button>';
  }

  if(!tasks.length) {
    html += '<div style="text-align:center;padding:32px;color:#94a3b8"><div style="font-size:2rem">📅</div><div>No tasks scheduled for this day</div></div>';
  } else {
    // Group by user if admin
    if(isAdmin) {
      const grouped = {};
      tasks.forEach(t=>{ (grouped[t.assigned_username]=grouped[t.assigned_username]||[]).push(t); });
      html += Object.entries(grouped).map(([uname,utasks])=>
        '<div style="margin-bottom:16px"><div style="font-weight:700;color:#1a3a6b;font-size:.85rem;padding:6px 10px;background:#f1f5f9;border-radius:6px;margin-bottom:8px">👤 '+uname+'</div>'+
        utasks.map(t=>todoScheduleCard(t)).join('')+'</div>'
      ).join('');
    } else {
      html += tasks.map(t=>todoScheduleCard(t)).join('');
    }
  }

  body.innerHTML = html;
}

function todoScheduleCard(t) {
  return '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start">'+
    '<div style="width:42px;text-align:center;flex-shrink:0">'+
    '<div style="font-size:1.2rem">'+catIcon(t.category)+'</div>'+
    '<div style="font-size:.65rem;color:#94a3b8;margin-top:2px">'+(t.due_time?t.due_time.substring(0,5):'Any')+'</div>'+
    '</div>'+
    '<div style="flex:1">'+
    '<div style="font-weight:600;color:#1e293b;font-size:.85rem">'+t.title+'</div>'+
    (t.description?'<div style="font-size:.75rem;color:#64748b">'+t.description+'</div>':'')+
    '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">'+
    '<span style="padding:1px 6px;border-radius:8px;font-size:.68rem;'+priorityStyle(t.priority)+'">'+t.priority+'</span>'+
    statusBadge(t.status)+'</div>'+
    '</div></div>';
}

function todoNavDay(date) {
  _todoDate = date;
  todoLoadTab();
}

// ════════════════ TAB 2: MESSAGES ════════════════════════
async function todoMessages(body) {
  const msgs = await apiCall('GET','/api/tasks?action=messages');
  _todoMessages = msgs;
  const isAdmin = currentUser?.role==='admin';

  let html = '';
  if(isAdmin) {
    html += '<button onclick="todoShowSendMessage()" style="width:100%;background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600;margin-bottom:14px;font-size:.85rem">✉️ Send Message to User</button>';
  }

  if(!msgs.length) {
    html += '<div style="text-align:center;padding:32px;color:#94a3b8"><div style="font-size:2rem">✉️</div><div>No pending messages</div></div>';
  } else {
    html += msgs.map(m=>'<div style="background:#fffbeb;border:2px solid #f59e0b;border-radius:10px;padding:14px;margin-bottom:10px">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'+
      '<div style="flex:1"><div style="font-weight:700;color:#92400e;font-size:.82rem;margin-bottom:4px">💬 From '+m.from_name+'</div>'+
      '<div style="color:#78350f">'+m.body+'</div>'+
      (m.photo?'<img src="'+m.photo+'" style="max-width:100%;border-radius:6px;margin-top:8px;max-height:200px;cursor:pointer" onclick="todoShowPhoto(this.src)" />':'')+
      '<div style="font-size:.7rem;color:#94a3b8;margin-top:6px">'+fmtDate(m.created_at)+'</div></div>'+
      '<button onclick="todoAckMsg('+m.id+')" style="background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:.8rem;font-weight:600;white-space:nowrap;flex-shrink:0">Got It ✓</button>'+
      '</div></div>').join('');
  }
  body.innerHTML = html;
}

// ════════════════ TAB 3: GRADES ══════════════════════════
async function todoGrades(body) {
  const isAdmin = currentUser?.role==='admin';
  let grades, engagement=[];
  try {
    grades = await apiCall('GET','/api/tasks?action=grades');
    if(isAdmin) engagement = await apiCall('GET','/api/tasks?action=engagement');
  } catch(e) { body.innerHTML='<p style="color:#dc2626">Error loading grades: '+e.message+'</p>'; return; }

  _todoGrades = grades;
  _todoEngagement = engagement;

  let html = '';

  if(!isAdmin) {
    // User sees own grade prominently
    const g = grades[0];
    if(!g) { body.innerHTML='<p style="color:#94a3b8;text-align:center;padding:24px">No task data yet</p>'; return; }
    const grade = calcGrade(parseInt(g.completed)||0, parseInt(g.total_tasks)||0, parseInt(g.missed)||0);
    html += '<div style="text-align:center;padding:20px 16px;background:linear-gradient(135deg,#1a3a6b,#2563eb);border-radius:14px;color:#fff;margin-bottom:16px">'+
      '<div style="font-size:4rem;font-weight:900;color:'+grade.color.replace('#','').match(/../g).map(h=>parseInt(h,16)).reduce((a,v,i)=>a+(i<3?v>200:''),'')>1?grade.color:'#fff'+'">'+grade.letter+'</div>'+
      '<div style="font-size:.9rem;opacity:.9">Your 30-Day Performance Grade</div></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">'+
      '<div style="background:#f8fafc;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.3rem;font-weight:700;color:#1a3a6b">'+g.total_tasks+'</div><div style="font-size:.72rem;color:#64748b">Total</div></div>'+
      '<div style="background:#dcfce7;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.3rem;font-weight:700;color:#16a34a">'+(g.completed||0)+'</div><div style="font-size:.72rem;color:#64748b">Done</div></div>'+
      '<div style="background:#fee2e2;border-radius:8px;padding:10px;text-align:center"><div style="font-size:1.3rem;font-weight:700;color:#dc2626">'+(g.missed||0)+'</div><div style="font-size:.72rem;color:#64748b">Missed</div></div></div>';
    html += '<div style="background:#f8fafc;border-radius:8px;padding:12px"><div style="font-size:.8rem;font-weight:600;color:#1e293b;margin-bottom:8px">📈 Grading Scale</div>'+
      ['A+ — All tasks completed on time','A — 90%+ completion rate','B — 80–89% completion','C — 65–79% completion','D — 30–64% / very late completions','F — 50%+ tasks missed'].map((l,i)=>{
        const colors=['#16a34a','#22c55e','#2563eb','#d97706','#ea580c','#dc2626'];
        return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="width:24px;height:24px;border-radius:50%;background:'+colors[i]+';color:#fff;font-size:.65rem;font-weight:700;display:flex;align-items:center;justify-content:center">'+l.split(' ')[0]+'</span><span style="font-size:.78rem;color:#64748b">'+l.split('— ')[1]+'</span></div>';
      }).join('')+'</div>';
    body.innerHTML = html;
    return;
  }

  // Admin sees all employees ranked
  html += '<div style="font-weight:700;color:#1a3a6b;margin-bottom:12px">👥 Employee Performance — Last 30 Days</div>';
  html += grades.map((g,rank)=>{
    const grade = calcGrade(parseInt(g.completed)||0, parseInt(g.total_tasks)||0, parseInt(g.missed)||0);
    const eng = engagement.find(e=>e.id===g.id);
    const totalSecs = parseInt(eng?.total_session_seconds)||0;
    return '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:12px">'+
      '<div style="width:36px;height:36px;border-radius:50%;background:'+grade.color+';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:'+( grade.letter.length>1?'.75':'1')+'rem;flex-shrink:0">'+grade.letter+'</div>'+
      '<div style="flex:1">'+
      '<div style="font-weight:600;color:#1e293b">'+g.username+' <span style="font-size:.72rem;color:#94a3b8;font-weight:400">'+g.role+'</span></div>'+
      '<div style="font-size:.75rem;color:#64748b">'+
      (g.total_tasks?g.completed+'/'+g.total_tasks+' tasks · '+(g.missed||0)+' missed':'No tasks assigned')+
      (totalSecs?' · '+fmtTime(totalSecs)+' in app':'')+
      '</div></div>'+
      '</div>';
  }).join('');

  body.innerHTML = html;
}

// ════════════════ TAB 4: MANAGE (admin) ══════════════════
async function todoManage(body) {
  if(currentUser?.role!=='admin') { body.innerHTML='<p>Admin only</p>'; return; }

  const [allTasks, users] = await Promise.all([
    apiCall('GET','/api/tasks?action=all_tasks'),
    apiCall('GET','/api/records?type=users').catch(()=>[])
  ]);
  _todoAllTasks = allTasks;

  // Get users list from existing auth
  const usersRes = await fetch('/api/auth',{headers:{'Authorization':'Bearer '+sessionStorage.getItem('jwt')}}).then(r=>r.ok?r.json():null).catch(()=>null);

  // Build users from grades since we have them
  const grades = await apiCall('GET','/api/tasks?action=grades');
  _todoUsers = grades;

  let html = '<div style="display:flex;gap:8px;margin-bottom:16px">'+
    '<button onclick="todoShowCreateTask()" style="flex:1;background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600;font-size:.82rem">+ New Task</button>'+
    '<button onclick="todoShowSendMessage()" style="flex:1;background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600;font-size:.82rem">✉️ Message User</button>'+
    '</div>';

  // Engagement summary
  try {
    const eng = await apiCall('GET','/api/tasks?action=engagement');
    html += '<div style="background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:14px">'+
      '<div style="font-weight:700;color:#1a3a6b;font-size:.85rem;margin-bottom:8px">⏱ App Engagement (Last 30 Days)</div>'+
      eng.map(e=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #e2e8f0">'+
        '<span style="font-size:.8rem;font-weight:600">'+e.username+'</span>'+
        '<span style="font-size:.75rem;color:#64748b">'+
        fmtTime(parseInt(e.total_session_seconds)||0)+' total · '+
        (e.tasks_completed||0)+' tasks done · '+
        (e.last_seen?'Last: '+fmtDate(e.last_seen):'Never')+
        '</span></div>'
      ).join('')+'</div>';
  } catch(e){}

  // Task list
  html += '<div style="font-weight:700;color:#1a3a6b;margin-bottom:8px">Active Tasks ('+allTasks.length+')</div>';
  if(!allTasks.length) {
    html += '<div style="text-align:center;padding:24px;color:#94a3b8">No tasks created yet</div>';
  } else {
    html += allTasks.map(t=>'<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
      '<div><div style="font-weight:600;font-size:.85rem">'+catIcon(t.category)+' '+t.title+'</div>'+
      '<div style="font-size:.73rem;color:#64748b">Assigned: '+(t.assigned_to==='all'?'Everyone':t.assigned_to)+' · '+
      (t.recurring!=='none'?'🔄 '+t.recurring:'One-time')+' · '+
      (t.due_date?fmtDate(t.due_date):'No date')+
      ' · ✅ '+t.completions+' done'+(parseInt(t.overdue_count)>0?' · 🔴 '+t.overdue_count+' overdue':'')+'</div></div>'+
      '<button onclick="todoDeleteTask('+t.id+')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:.75rem">Delete</button>'+
      '</div></div>'
    ).join('');
  }

  body.innerHTML = html;
}

async function todoDeleteTask(taskId) {
  if(!confirm('Delete this task and all its instances?')) return;
  await apiCall('POST','/api/tasks?action=delete_task',{task_id:taskId});
  toast('🗑 Task deleted');
  todoLoadTab();
}

// ════════════════ CREATE TASK MODAL ══════════════════════
function todoShowCreateTask() {
  const grades = _todoUsers;
  const userOptions = '<option value="all">Everyone</option>'+
    grades.map(u=>'<option value="'+u.id+'">'+u.username+' ('+u.role+')</option>').join('');

  const modal = document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px;overflow-y:auto';
  modal.innerHTML='<div style="background:#fff;border-radius:14px;padding:20px;width:100%;max-width:460px;max-height:90vh;overflow-y:auto">'+
    '<h3 style="margin:0 0 14px;color:#1a3a6b">📋 Create Task</h3>'+
    '<div style="display:grid;gap:10px">'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Title *</label><input id="ct-title" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box"></div>'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Description</label><textarea id="ct-desc" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box"></textarea></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Category</label><select id="ct-cat" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px"><option>Production</option><option>Maintenance</option><option>Quality</option><option>Safety</option><option>General</option></select></div>'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Priority</label><select id="ct-pri" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px"><option>High</option><option selected>Medium</option><option>Low</option></select></div>'+
    '</div>'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Assign To *</label><select id="ct-user" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px">'+userOptions+'</select></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Due Date</label><input type="date" id="ct-date" value="'+new Date().toISOString().split('T')[0]+'" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box"></div>'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Due Time</label><input type="time" id="ct-time" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box"></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Shift</label><select id="ct-shift" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px"><option value="Any">Any</option><option>AM</option><option>PM</option><option>Night</option></select></div>'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Recurring</label><select id="ct-rec" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px"><option value="none">One-time</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div>'+
    '</div>'+
    '<div id="ct-rec-days" style="display:none"><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:4px">Days (for weekly)</label><div style="display:flex;gap:4px;flex-wrap:wrap">'+
    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>'<label style="display:flex;align-items:center;gap:3px;font-size:.78rem"><input type="checkbox" value="'+d+'">'+d+'</label>').join('')+
    '</div></div>'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:4px">Checklist Steps</label>'+
    '<div id="ct-steps"></div>'+
    '<button onclick="todoAddStep()" style="background:#f1f5f9;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:.78rem;margin-top:4px">+ Add Step</button></div>'+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-top:16px">'+
    '<button onclick="todoSubmitTask(todoFindModal(this)" style="flex:1;background:#1a3a6b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600">Create Task</button>'+
    '<button onclick="todoFindModal(this).remove()" style="flex:1;background:#f1f5f9;color:#64748b;border:none;border-radius:8px;padding:10px;cursor:pointer">Cancel</button>'+
    '</div></div>';

  document.body.appendChild(modal);
  document.getElementById('ct-rec').onchange = function() {
    document.getElementById('ct-rec-days').style.display = this.value==='weekly'?'block':'none';
  };
}

function todoAddStep() {
  const container = document.getElementById('ct-steps');
  const idx = container.children.length;
  const row = document.createElement('div');
  row.style.cssText='display:flex;gap:4px;margin-bottom:4px';
  row.innerHTML='<input placeholder="Step '+(idx+1)+'..." style="flex:1;padding:6px;border:1px solid #e2e8f0;border-radius:6px;font-size:.8rem">'+
    '<button onclick="this.parentElement.remove()" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 8px;cursor:pointer">×</button>';
  container.appendChild(row);
}

async function todoSubmitTask(modal) {
  const title = document.getElementById('ct-title')?.value?.trim();
  if(!title) { toast('Title is required'); return; }
  const recurring = document.getElementById('ct-rec')?.value;
  let recurringDays = '';
  if(recurring==='weekly') {
    const checked = Array.from(document.querySelectorAll('#ct-rec-days input:checked')).map(i=>i.value);
    recurringDays = checked.join(',');
  }
  const steps = Array.from(document.querySelectorAll('#ct-steps input')).map(i=>i.value.trim()).filter(Boolean);
  const assignedVal = document.getElementById('ct-user')?.value;

  try {
    await apiCall('POST','/api/tasks?action=create_task',{
      title,
      description: document.getElementById('ct-desc')?.value||'',
      category: document.getElementById('ct-cat')?.value||'General',
      priority: document.getElementById('ct-pri')?.value||'Medium',
      assigned_to: assignedVal,
      due_date: document.getElementById('ct-date')?.value||null,
      due_time: document.getElementById('ct-time')?.value||null,
      shift: document.getElementById('ct-shift')?.value||'Any',
      recurring,
      recurring_days: recurringDays,
      steps
    });
    if(modal) modal.remove();
    toast('✅ Task created!');
    _todoTab=4; todoLoadTab();
    todoBadgeUpdate();
  } catch(e) { toast('❌ '+e.message); }
}

// ════════════════ SEND MESSAGE MODAL ═════════════════════
function todoShowSendMessage() {
  const grades = _todoUsers;
  const userOptions = grades.map(u=>'<option value="'+u.id+'">'+u.username+' ('+u.role+')</option>').join('');

  const modal = document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML='<div style="background:#fff;border-radius:14px;padding:20px;width:100%;max-width:420px">'+
    '<h3 style="margin:0 0 14px;color:#1a3a6b">✉️ Send Message</h3>'+
    '<div style="display:grid;gap:10px">'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">To *</label><select id="sm-user" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px">'+userOptions+'</select></div>'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">Message *</label><textarea id="sm-body" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box" placeholder="Type your message..."></textarea></div>'+
    '<div><label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:3px">📷 Photo (Optional, max 1MB)</label>'+
    '<input type="file" id="sm-photo" accept="image/*" style="width:100%;font-size:.8rem">'+
    '<div id="sm-preview" style="margin-top:6px"></div></div>'+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-top:16px">'+
    '<button onclick="todoSubmitMessage(todoFindModal(this)" style="flex:1;background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600">Send</button>'+
    '<button onclick="todoFindModal(this).remove()" style="flex:1;background:#f1f5f9;color:#64748b;border:none;border-radius:8px;padding:10px;cursor:pointer">Cancel</button>'+
    '</div></div>';

  document.body.appendChild(modal);

  document.getElementById('sm-photo').onchange = function() {
    const file = this.files[0];
    if(!file) return;
    if(file.size>1048576) { toast('Photo must be under 1MB'); this.value=''; return; }
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('sm-preview').innerHTML='<img src="'+e.target.result+'" style="max-width:100%;border-radius:6px;max-height:100px">';
      window._smPhotoData = e.target.result;
    };
    reader.readAsDataURL(file);
  };
}

async function todoSubmitMessage(modal) {
  const to_user_id = parseInt(document.getElementById('sm-user')?.value);
  const body = document.getElementById('sm-body')?.value?.trim();
  if(!body) { toast('Message is required'); return; }
  try {
    await apiCall('POST','/api/tasks?action=send_message',{
      to_user_id, body, photo: window._smPhotoData||null
    });
    window._smPhotoData=null;
    if(modal) modal.remove();
    toast('✅ Message sent!');
  } catch(e) { toast('❌ '+e.message); }
}

// ════════════════ DASHBOARD BADGE ════════════════════════
async function todoBadgeUpdate() {
  try {
    const tasks = await apiCall('GET','/api/tasks?action=my_tasks');
    const msgs = await apiCall('GET','/api/tasks?action=messages');
    const pending = tasks.filter(t=>t.status!=='complete').length;
    const overdue = tasks.filter(t=>t.status==='pending'&&t.instance_date<new Date().toISOString().split('T')[0]).length;
    const total = pending + msgs.length;
    const badge = document.getElementById('todo-badge');
    if(badge) {
      if(total===0) { badge.style.display='none'; return; }
      badge.textContent = total;
      badge.style.background = overdue>0?'#dc2626':'#f59e0b';
      badge.style.display='flex';
    }
  } catch(e){}
}

// Expose to global
window.openTodo=openTodo;
window.todoRender=todoRender;
window.todoTab=todoTab;
window.todoLoadTab=todoLoadTab;
window.todoNavDay=todoNavDay;
window.todoAckMsg=todoAckMsg;
window.todoShowPhoto=todoShowPhoto;
window.todoStartComplete=todoStartComplete;
window.todoSubmitComplete=todoSubmitComplete;
window.todoToggleStep=todoToggleStep;
window.todoDeleteTask=todoDeleteTask;
window.todoShowCreateTask=todoShowCreateTask;
window.todoAddStep=todoAddStep;
window.todoSubmitTask=todoSubmitTask;
window.todoShowSendMessage=todoShowSendMessage;
window.todoSubmitMessage=todoSubmitMessage;
window.todoBadgeUpdate=todoBadgeUpdate;
window.todoFindModal=todoFindModal;
