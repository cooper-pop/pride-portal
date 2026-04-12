// admin.js - Admin panel and user management

function buildAdminWidget() {
  document.getElementById('widget-tabs').innerHTML = ['👥 Users','➕ Add User','⚙️ Grade Config'].map(function(t,i){
    return '<div class="widget-tab'+(i===0?' active':'')+'" onclick="adminShowTab('+i+')">'+t+'</div>';
  }).join('');
  adminShowTab(0);

  // Render grade settings panel
  setTimeout(function(){
    var adminContent=document.getElementById('widget-content');
    if(adminContent)renderGradeSettings(adminContent);
  },100);

  var _ac=document.getElementById('widget-content');if(_ac&&typeof renderGradeSettings==='function')renderGradeSettings(_ac);
}

function adminShowTab(idx) {
  document.querySelectorAll('.widget-tab').forEach(function(t,i){ t.classList.toggle('active',i===idx); });
  if (idx===0) adminRenderUsers(); else if (idx===1) adminRenderAddUser(); else adminRenderGradeConfig();
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
// Expose functions globally for inline onclick handlers
window.buildAdminWidget = buildAdminWidget;
window.adminShowTab = adminShowTab;
window.adminRenderUsers = adminRenderUsers;
window.adminRenderAddUser = adminRenderAddUser;
window.adminAddUser = adminAddUser;
window.adminDeleteUser = adminDeleteUser;
window.loadUserMgmt = loadUserMgmt;
window.loadPasskeyStatus = loadPasskeyStatus;
window.umShowAddModal = umShowAddModal;
window.umEditUser = umEditUser;
window.umCloseModal = umCloseModal;
window.umSaveUser = umSaveUser;
window.umResetPasskey = umResetPasskey;
window.umToggleActive = umToggleActive;
// Expose to global scope for inline onclick handlers
window.buildAdminWidget = buildAdminWidget;
window.adminShowTab = adminShowTab;
window.adminRenderUsers = adminRenderUsers;
window.adminRenderAddUser = adminRenderAddUser;
window.adminAddUser = adminAddUser;
window.adminDeleteUser = adminDeleteUser;
window.loadUserMgmt = loadUserMgmt;
window.loadPasskeyStatus = loadPasskeyStatus;
window.umShowAddModal = umShowAddModal;
window.umEditUser = umEditUser;
window.umCloseModal = umCloseModal;
window.umSaveUser = umSaveUser;
window.umResetPasskey = umResetPasskey;
window.umToggleActive = umToggleActive;

function renderGradeSettings(container){
  var S=window._gradeSettings||{};
  var penalty=typeof S.penalty==='number'?S.penalty:0.5;
  var minLph=typeof S.min_lph==='number'?S.min_lph:100;
  var minFil=typeof S.min_fillet==='number'?S.min_fillet:61;
  var minNug=typeof S.min_nugget==='number'?S.min_nugget:17;
  var maxMis=typeof S.max_miscut==='number'?S.max_miscut:7.5;
  var minYld=typeof S.min_yield==='number'?S.min_yield:70;
  var h='<div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:12px">';
  h+='<h4 style="margin:0 0 10px;color:#1a3a6b;font-size:.85rem;font-weight:700">Trimmer Grade Settings</h4>';
  h+='<div style="font-size:.72rem;color:#64748b;margin-bottom:10px">F-floor thresholds: a metric below these values triggers a grade penalty. Penalty is subtracted per failing metric.</div>';
  var fields=[
    {key:'penalty',label:'Penalty per F-floor metric',val:penalty,step:0.5,min:0,max:3},
    {key:'min_lph',label:'Min Lbs/Hr (F threshold)',val:minLph,step:1,min:50,max:150},
    {key:'min_fillet',label:'Min Fillet% (F threshold)',val:minFil,step:0.5,min:50,max:75},
    {key:'min_nugget',label:'Min Nugget% (F threshold)',val:minNug,step:0.5,min:10,max:25},
    {key:'max_miscut',label:'Max Miscut% (F threshold)',val:maxMis,step:0.5,min:2,max:15},
    {key:'min_yield',label:'Min Total Yield% (F threshold)',val:minYld,step:1,min:50,max:85}
  ];
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">';
  fields.forEach(function(f){
    h+='<div><label style="display:block;font-size:.7rem;color:#374151;font-weight:600;margin-bottom:2px">'+f.label+'</label>';
    h+='<input type="number" data-key="'+f.key+'" value="'+f.val+'" step="'+f.step+'" min="'+f.min+'" max="'+f.max+'" style="width:100%;padding:5px 7px;border:1px solid #cbd5e1;border-radius:5px;font-size:.78rem"></div>';
  });
  h+='</div>';
  h+='<div style="font-size:.68rem;color:#64748b;margin-bottom:8px">Base grades from Lbs/Hr: A+(>=150) A(>=125) B(>=115) C(>=110) D(>=100) F(<100)</div>';
  h+='<button id="save-grade-settings" style="background:#1a3a6b;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:.75rem;font-weight:600;cursor:pointer">Save Grade Settings</button>';
  h+='<span id="grade-settings-msg" style="margin-left:10px;font-size:.72rem;color:#059669"></span>';
  h+='</div>';
  container.innerHTML+=h;
  document.getElementById('save-grade-settings')?.addEventListener('click',function(){
    var settings={};
    container.querySelectorAll('input[data-key]').forEach(function(inp){
      settings[inp.dataset.key]=parseFloat(inp.value);
    });
    apiCall('POST','/api/settings',settings).then(function(){
      window._gradeSettings=settings;
      var msg=document.getElementById('grade-settings-msg');
      if(msg){msg.textContent='Saved!';setTimeout(function(){msg.textContent='';},2000);}
    }).catch(function(){
      var msg=document.getElementById('grade-settings-msg');
      if(msg)msg.style.color='#ef4444',msg.textContent='Error saving.';
    });
  });
}
async function adminRenderGradeConfig(){
  const el=document.getElementById('widget-content');
  if(!el)return;
  el.innerHTML='<div style="text-align:center;padding:20px"><div class="spinner"></div>Loading...</div>';
  const cfg=await apiCall('GET','/api/records?action=grade_config').catch(()=>null);
  if(!cfg){el.innerHTML='<div class="log-empty">Error loading config</div>';return;}

  function row(label,id,val,step,min,max,unit){
    return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9">'
      +'<div style="flex:1;font-size:.8rem;color:#374151">'+label+'</div>'
      +'<input id="gc-'+id+'" type="number" value="'+val+'" step="'+step+'" min="'+min+'" max="'+max
      +'" style="width:80px;padding:3px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:.8rem;text-align:right">'
      +'<span style="font-size:.75rem;color:#64748b;width:30px">'+unit+'</span>'
      +'</div>';
  }

  var grades=cfg.grades||[];
  var pens=cfg.penalties||{};

  var h='<div style="padding:4px">';
  h+='<div style="font-size:.9rem;font-weight:700;color:#1a3a6b;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e2e8f0">Base Grade Thresholds (lbs/hr)</div>';
  h+='<div style="font-size:.72rem;color:#64748b;margin-bottom:8px">Minimum lbs/hr required for each base grade</div>';
  grades.forEach(function(g,i){
    if(g.label==='F')return;
    h+=row(g.label+' grade',  'g'+i, g.minLph, 1, 0, 300, 'lbs/hr');
  });

  h+='<div style="font-size:.9rem;font-weight:700;color:#1a3a6b;margin:16px 0 10px;padding-bottom:6px;border-bottom:2px solid #e2e8f0">F-Floor Penalty Thresholds</div>';
  h+='<div style="font-size:.72rem;color:#64748b;margin-bottom:8px">Each metric that crosses its F-floor threshold deducts one letter grade</div>';

  var penKeys=['lph','fillet','nugget','miscut','yield'];
  var penLabels={lph:'Speed (lbs/hr) below',fillet:'Fillet% below',nugget:'Nugget% below',miscut:'Miscut% above',yield:'Yield% below'};
  var penUnits={lph:'lph',fillet:'%',nugget:'%',miscut:'%',yield:'%'};
  var penSteps={lph:1,fillet:0.5,nugget:0.5,miscut:0.1,yield:1};
  penKeys.forEach(function(k){
    var p=pens[k]||{};
    h+=row(penLabels[k],'p_'+k,p.threshold,penSteps[k],0,200,penUnits[k]);
  });

  h+='<div style="margin-top:16px;display:flex;gap:10px">';
  h+='<button onclick="adminSaveGradeConfig()" style="background:#1a3a6b;color:#fff;border:none;border-radius:7px;padding:8px 18px;font-size:.82rem;font-weight:600;cursor:pointer">Save Changes</button>';
  h+='<button onclick="adminResetGradeConfig()" style="background:#f1f5f9;color:#374151;border:1px solid #d1d5db;border-radius:7px;padding:8px 14px;font-size:.82rem;cursor:pointer">Reset Defaults</button>';
  h+='<span id="gc-msg" style="font-size:.78rem;line-height:2;color:#059669"></span>';
  h+='</div></div>';
  el.innerHTML=h;
}

async function adminSaveGradeConfig(){
  const msg=document.getElementById('gc-msg');
  if(msg)msg.textContent='Saving...';
  const cfg=await apiCall('GET','/api/records?action=grade_config').catch(()=>null);
  if(!cfg)return;
  var grades=cfg.grades||[];
  grades.forEach(function(g,i){
    var inp=document.getElementById('gc-g'+i);
    if(inp&&g.label!=='F') g.minLph=parseFloat(inp.value)||g.minLph;
  });
  var pens=cfg.penalties||{};
  ['lph','fillet','nugget','miscut','yield'].forEach(function(k){
    var inp=document.getElementById('gc-p_'+k);
    if(inp&&pens[k]) pens[k].threshold=parseFloat(inp.value)||pens[k].threshold;
  });
  cfg.grades=grades; cfg.penalties=pens;
  await apiCall('POST','/api/records?action=grade_config',cfg).catch(()=>null);
  // Bust the trimmer grade cache
  window._gradeConfig=cfg;
  if(msg)msg.textContent='Saved!';
  setTimeout(function(){if(msg)msg.textContent='';},2000);
}

async function adminResetGradeConfig(){
  const defaults={
    grades:[
      {label:'A+',minLph:150,color:'#059669'},
      {label:'A', minLph:125,color:'#10b981'},
      {label:'B', minLph:115,color:'#3b82f6'},
      {label:'C', minLph:110,color:'#f59e0b'},
      {label:'D', minLph:100,color:'#f97316'},
      {label:'F', minLph:0,  color:'#ef4444'}
    ],
    penalties:{
      lph:   {enabled:true,threshold:100,direction:'below',label:'Speed (lbs/hr)'},
      fillet:{enabled:true,threshold:61, direction:'below',label:'Fillet%'},
      nugget:{enabled:true,threshold:17, direction:'below',label:'Nugget%'},
      miscut:{enabled:true,threshold:7.5,direction:'above',label:'Miscut%'},
      yield: {enabled:true,threshold:70, direction:'below',label:'Yield%'}
    }
  };
  await apiCall('POST','/api/records?action=grade_config',defaults).catch(()=>null);
  window._gradeConfig=defaults;
  adminRenderGradeConfig();
}