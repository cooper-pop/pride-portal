// admin.js - Admin panel and user management

function buildAdminWidget() {
  document.getElementById('widget-tabs').innerHTML = ['👥 Users','➕ Add User'].map(function(t,i){
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