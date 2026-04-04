// admin.js - Admin panel

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

  async function trimRenderAnalytics() {
    const wc = document.getElementById("widget-content");
    wc.innerHTML = "<div style=\"padding:8px\"><div class=\"spinner-wrap\"><div class=\"spinner\"></div><div>Loading analytics…</div></div></div>";
    let data;
    try { data = await apiCall("GET", "/api/analytics?type=rankings&days=30"); }
    catch(e) { wc.innerHTML = "<p style=\"color:#ef4444;padding:16px\">Analytics failed: " + e.message + "</p>"; return; }
    const rankings = data.rankings || [];
    const shiftAvg = parseFloat(data.shift_avg_lph) || 0;
    let html = "<div style=\"padding:8px\">";
    html += "<div class=\"wcard\" style=\"margin-bottom:12px\">";
    html += "<div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:10px\">";
    html += "<h3 style=\"margin:0;font-size:1rem\">📈 Trimmer Rankings — Last 30 Days</h3>";
    html += "<span style=\"font-size:0.78rem;color:var(--sub)\">Team avg: " + shiftAvg.toFixed(1) + " lbs/hr</span></div>";
    html += "<div style=\"overflow-x:auto\"><table class=\"trim-table\" style=\"width:100%;font-size:0.78rem\"><thead><tr>";
    ["Rank","Name","Days","Avg Lbs/Hr","8Hr Lbs/Hr","Fillet%","Nugget%","MiscCut%","Tot Yield%",""].forEach(function(h){ html += "<th>" + h + "</th>"; });
    html += "</tr></thead><tbody>";
    rankings.forEach(function(r,i){
      const under = r.underperformer;
      const bg = under ? "#fef2f2" : (i<3 ? "#f0fdf4" : "");
      html += "<tr style=\"background:" + bg + "\">";
      html += "<td style=\"font-weight:700;text-align:center\">" + (i+1) + "</td>";
      html += "<td style=\"font-weight:600\">" + (r.full_name || r.emp_number || "") + "</td>";
      html += "<td style=\"text-align:center\">" + (r.days_worked||0) + "</td>";
      html += "<td style=\"text-align:center;font-weight:700;color:" + (under?"#ef4444":"#16a34a") + "\">" + parseFloat(r.avg_lph||0).toFixed(1) + "</td>";
      html += "<td style=\"text-align:center\">" + parseFloat(r.avg_8hr_lph||0).toFixed(1) + "</td>";
      html += "<td style=\"text-align:center\">" + parseFloat(r.avg_fillet_pct||0).toFixed(1) + "%</td>";
      html += "<td style=\"text-align:center\">" + parseFloat(r.avg_nugget_pct||0).toFixed(1) + "%</td>";
      html += "<td style=\"text-align:center\">" + parseFloat(r.avg_misccut_pct||0).toFixed(1) + "%</td>";
      html += "<td style=\"text-align:center\">" + parseFloat(r.avg_total_yield||0).toFixed(1) + "%</td>";
      const enc = encodeURIComponent(r.full_name||r.emp_number||"");
      html += "<td><button onclick=\"trimShowTrend('" + enc + "',this)\" style=\"background:none;border:1px solid var(--blue);color:var(--blue);border-radius:6px;padding:2px 8px;cursor:pointer;font-size:0.72rem\">Trend ▾</button></td>";
      html += "</tr>";
      if(under) html += "<tr style=\"background:#fef2f2\"><td colspan=\"10\" style=\"font-size:0.72rem;color:#ef4444;padding:2px 8px\">⚠ " + r.underperformer_reason + "</td></tr>";
    });
    html += "</tbody></table></div></div>";
    html += "<div id=\"trim-trend-area\"></div></div>";
    wc.innerHTML = html;
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
    area.innerHTML = "<div class=\"spinner-wrap\"><div class=\"spinner\"></div><div>Loading trend…</div></div>";
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
    html += "<h3 style=\"font-size:0.95rem;margin-bottom:4px\">📉 " + name + " — Last 90 Days (" + trends.length + " shifts)</h3>";
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
    html += "<div style=\"font-size:0.7rem;color:#64748b;text-align:right\">"+fPct[0].toFixed(1)+"% → "+fPct[fPct.length-1].toFixed(1)+"%</div></div>";
    html += "<div style=\"flex:0 0 auto\"><div style=\"font-size:0.75rem;color:#64748b;margin-bottom:2px\">Nugget % trend</div>";
    html += "<div style=\"border:1px solid #e2e8f0;border-radius:6px;padding:4px\">" + trimSparkline(nPct,"#ca8a04",220,70) + "</div>";
    html += "<div style=\"font-size:0.7rem;color:#64748b;text-align:right\">"+nPct[0].toFixed(1)+"% → "+nPct[nPct.length-1].toFixed(1)+"%</div></div>";
    html += "<div style=\"flex:0 0 auto\"><div style=\"font-size:0.75rem;color:#64748b;margin-bottom:2px\">MiscCut % trend</div>";
    html += "<div style=\"border:1px solid #e2e8f0;border-radius:6px;padding:4px\">" + trimSparkline(mcPct,"#9333ea",220,70) + "</div>";
    html += "<div style=\"font-size:0.7rem;color:#64748b;text-align:right\">"+mcPct[0].toFixed(1)+"% → "+mcPct[mcPct.length-1].toFixed(1)+"%</div></div>";
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