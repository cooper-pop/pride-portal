// dashboard.js - Dashboard and widget routing

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  const _el=document.getElementById(id); if(_el) _el.classList.add('active');

  if (id === 'screen-user-mgmt') {
    var settingsGradeDiv = document.getElementById('grade-config-section-settings');
    if (settingsGradeDiv) {
      apiCall('GET', '/api/records?action=get_grade_config')
        .then(function(cfg) {
          window._gradeConfig = cfg || {};
          if (typeof renderGradeConfig === 'function') {
            // Temporarily point renderGradeConfig at the settings div
            var orig = document.getElementById('grade-config-section');
            if (orig) orig.id = 'grade-config-section-bak';
            settingsGradeDiv.id = 'grade-config-section';
            renderGradeConfig();
            settingsGradeDiv.id = 'grade-config-section-settings';
            if (orig) orig.id = 'grade-config-section';
          }
        }).catch(function() { window._gradeConfig = {}; });
    }
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
      { id:'injection', label:'Injection Calc', icon:'💉', color:'#c0392b' },
      { id:'trimmer',   label:'Trimmer Log',   icon:'✂️', color:'#1d9e75' },
      { id:'ai',        label:'AI Analysis',   icon:'🤖', color:'#8e44ad' },
      { id:'todo',       label:'To-Do List',    icon:'📋', color:'#1a3a6b' }
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

  // Start message notification polling
  if(typeof startMsgPolling !== "undefined") startMsgPolling();
  setTimeout(function(){ if(typeof wireSignOut === "function") wireSignOut(); }, 50);
  // Wire sign out button after dynamic render
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
  else document.getElementById('widget-content').innerHTML = '<div class="log-empty">🚧 Coming soon for Battle Fish North.</div>';
}
// Expose functions globally for inline onclick handlers
window.showScreen = showScreen;
window.buildDash = buildDash;
window.closeWidget = closeWidget;
window.openWidget = openWidget;
// Expose to global scope for inline onclick handlers
window.showScreen = showScreen;
window.buildDash = buildDash;
window.closeWidget = closeWidget;
window.openWidget = openWidget;

function settingsShowTab(tab){
  document.getElementById('settings-panel-users').style.display=tab==='users'?'block':'none';
  document.getElementById('settings-panel-grades').style.display=tab==='grades'?'block':'none';
  var tu=document.getElementById('settings-tab-users');
  var tg=document.getElementById('settings-tab-grades');
  if(tu){tu.style.borderBottomColor=tab==='users'?'#1a3a6b':'transparent';tu.style.color=tab==='users'?'#1a3a6b':'#64748b';}
  if(tg){tg.style.borderBottomColor=tab==='grades'?'#1a3a6b':'transparent';tg.style.color=tab==='grades'?'#1a3a6b':'#64748b';}
  if(tab==='grades'){
    apiCall('GET','/api/records?action=get_grade_config')
      .then(function(cfg){
        window._gradeConfig=cfg||{};
        var gs=document.getElementById('grade-config-section-settings');
        if(gs&&typeof renderGradeConfig==='function'){
          var bak=document.getElementById('grade-config-section');
          if(bak)bak.id='grade-config-section-bak';
          gs.id='grade-config-section';
          renderGradeConfig();
          gs.id='grade-config-section-settings';
          if(bak)bak.id='grade-config-section';
        }
      }).catch(function(){window._gradeConfig={};});
  }
}
