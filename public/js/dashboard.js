// dashboard.js - Dashboard and widget routing
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  const _el=document.getElementById(id); if(_el) _el.classList.add('active');

  if (id === 'screen-user-mgmt') {
    settingsShowTab('users');
    loadSettingsUsers();
    if (typeof buildAdminWidget === 'function') buildAdminWidget();
  }
}

function buildDash() {
  var c = COMPANIES[currentCompany];
  document.getElementById('dash-co-name').textContent = c.name;
  document.getElementById('dash-logo').src = c.logo;
  document.getElementById('dash-role').textContent = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
  document.getElementById('dash-user').textContent = '👤 ' + (currentUser.full_name || currentUser.username);
  var now = new Date();
  var hr = now.getHours();
  var greet = hr < 12 ? 'Good Morning' : hr < 17 ? 'Good Afternoon' : 'Good Evening';
  document.getElementById('dash-date').textContent = now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  document.getElementById('dash-greeting').textContent = greet + ', ' + (currentUser.full_name || currentUser.username) + ' 👋';
  document.getElementById('admin-btn').style.display = currentUser.role === 'admin' ? 'block' : 'none';

  var apps = [];
  if (currentCompany === 'potp') {
    apps = [
      { id:'yield',     label:'Yield Calc',    icon:'⚖️', color:'#1a3a6b' },
      { id:'injection', label:'Injection Calc', icon:'💉',   color:'#c0392b' },
      { id:'trimmer',   label:'Trimmer Log',   icon:'✂️', color:'#1d9e75' },
      { id:'ai',        label:'AI Analysis',   icon:'🤖',    color:'#8e44ad' },
      { id:'todo',      label:'To-Do List',    icon:'📋',    color:'#1a3a6b' },
      { id:'parts',     label:'Parts',          icon:'⚙️', color:'#7c3aed' },
      { id:'flavor',    label:'Flavor Samples', icon:'🎣',   color:'#0891b2' },
      { id:'fishschedule', label:'Fish Schedule', icon:'🐟', color:'#059669' }
    ];
  } else {
    apps = [{ id:'coming', label:'Coming Soon', icon:'🚧', color:'#5a6a85' }];
  }
  var dock = document.getElementById('dash-dock');
  dock.innerHTML = apps.map(function(a){
    return '<div class="app-icon" onclick="openWidget(\''+a.id+'\',\''+a.label+'\')"><div class="app-icon-img" style="background:'+a.color+'">'+a.icon+'</div><div class="app-icon-label">'+a.label+'</div></div>';
  }).join('');
}

function closeWidget() {
  document.getElementById('widget-overlay').classList.remove('open');
  document.getElementById('widget-content').innerHTML = '';
  document.getElementById('widget-tabs').innerHTML = '';
  document.getElementById('ai-input-area').style.display = 'none';
  if(typeof startMsgPolling !== "undefined") startMsgPolling();
  setTimeout(function(){ if(typeof wireSignOut === "function") wireSignOut(); }, 50);
  if(typeof wireSignOut !== "undefined") wireSignOut();
}

function openWidget(id, label) {
  document.getElementById('widget-title').textContent = label;
  document.getElementById('widget-overlay').classList.add('open');
  document.getElementById('ai-input-area').style.display = 'none';
  if (id === 'yield') buildYieldWidget();
  else if (id === 'injection') buildInjectionWidget();
  else if (id === 'trimmer') buildTrimmerWidget();
  else if (id === 'ai') buildAIWidget();
  else if (id === 'admin') buildAdminWidget();
  else if (id === 'todo') todoRender();
  else if (id === 'parts') buildPartsWidget();
  else if (id === 'flavor') buildFlavorWidget();
  else if (id === 'fishschedule') buildFishScheduleWidget();
  else document.getElementById('widget-content').innerHTML = '<div class="log-empty">🚧 Coming soon for Battle Fish North.</div>';
}

window.showScreen = showScreen;
window.buildDash = buildDash;
window.closeWidget = closeWidget;
window.openWidget = openWidget;

function settingsShowTab(tab){
  var tabs=['users','grades'];
  tabs.forEach(function(t){
    var btn=document.getElementById('settings-tab-'+t);
    var panel=document.getElementById('settings-panel-'+t);
    if(btn&&panel){
      if(t===tab){
        btn.style.borderBottomColor='#1a3a6b';
        btn.style.color='#1a3a6b';
        btn.style.fontWeight='600';
        panel.style.display='';
      } else {
        btn.style.borderBottomColor='transparent';
        btn.style.color='#64748b';
        btn.style.fontWeight='500';
        panel.style.display='none';
      }
    }
  });
  if(tab==='grades'){
    apiCall('GET','/api/records?action=get_grade_config')
      .then(function(cfg){
        window._gradeConfig=cfg||{};
        if(typeof renderGradeConfig==='function'){
          var gs=document.getElementById('grade-config-section-settings');
          if(gs){
            var orig=document.getElementById('grade-config-section');
            if(orig)orig.id='grade-config-section-bak';
            gs.id='grade-config-section';
            renderGradeConfig();
            gs.id='grade-config-section-settings';
            if(orig)orig.id='grade-config-section';
          }
        }
      }).catch(function(){window._gradeConfig={};});
  }
}

function loadSettingsUsers(){
  var ul=document.getElementById('um-user-list');
  if(!ul)return;
  ul.innerHTML='<div style="color:#94a3b8;font-size:.8rem;padding:12px">Loading...</div>';
  apiCall('GET','/api/users').then(function(data){
    var users=(data&&data.users)||data||[];
    if(!users.length){ul.innerHTML='<div style="color:#94a3b8;padding:12px">No users found.</div>';return;}
    var roleColor={admin:'#dbeafe',manager:'#d1fae5',supervisor:'#fef9c3'};
    ul.innerHTML=users.map(function(u){
      var bg=roleColor[u.role]||'#f1f5f9';
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-bottom:1px solid #f1f5f9">'
        +'<div><div style="font-weight:600;font-size:.87rem;color:#1e293b">'+u.full_name+'</div>'
        +'<div style="font-size:.73rem;color:#64748b">@'+u.username+(u.email?' &middot; '+u.email:'')+'</div></div>'
        +'<span style="font-size:.72rem;padding:3px 12px;border-radius:20px;background:'+bg+';color:#1e293b;font-weight:600">'+u.role+'</span>'
        +'</div>';
    }).join('');
  }).catch(function(){
    ul.innerHTML='<div style="color:#ef4444;padding:12px">Failed to load users.</div>';
  });
}

function settingsTab(tab){
  document.getElementById('settings-tab-users').style.display=tab==='users'?'block':'none';
  document.getElementById('settings-tab-grades').style.display=tab==='grades'?'block':'none';
  document.getElementById('stab-users').style.color=tab==='users'?'#1a3a6b':'#94a3b8';
  document.getElementById('stab-users').style.borderBottomColor=tab==='users'?'#1a3a6b':'transparent';
  document.getElementById('stab-grades').style.color=tab==='grades'?'#1a3a6b':'#94a3b8';
  document.getElementById('stab-grades').style.borderBottomColor=tab==='grades'?'#1a3a6b':'transparent';
  if(tab==='grades'){
    apiCall('GET','/api/records?action=get_grade_config')
      .then(function(cfg){window._gradeConfig=cfg||{};renderGradeConfigInSettings();})
      .catch(function(){window._gradeConfig={};renderGradeConfigInSettings();});
  }
}

function renderGradeConfigInSettings(){
  var div=document.getElementById('grade-config-section-settings');
  if(!div||typeof renderGradeConfig!=='function')return;
  var orig=document.getElementById('grade-config-section');
  if(orig)orig.id='grade-config-section-bak';
  div.id='grade-config-section';
  renderGradeConfig();
  div.id='grade-config-section-settings';
  if(orig)orig.id='grade-config-section';
  div.querySelectorAll('button').forEach(function(btn){
    if(btn.textContent.includes('Save Grade')){
      btn.onclick=function(){saveGradeConfigFromSettings();};
    }
  });
}

function saveGradeConfigFromSettings(){
  var div=document.getElementById('grade-config-section-settings');
  if(!div)return;
  var orig=document.getElementById('grade-config-section');
  if(orig)orig.id='grade-config-section-bak';
  div.id='grade-config-section';
  saveGradeConfig();
  div.id='grade-config-section-settings';
  if(orig)orig.id='grade-config-section';
}