// auth.js - Authentication and session management

function loadSession() {
  try {
    var saved = localStorage.getItem('potp_v2_session');
    if (!saved) return false;
    var s = JSON.parse(saved);
    authToken = s.token; currentUser = s.user; currentCompany = s.company;
    return true;
  } catch(e) { return false; }
}

function saveSession() {
  localStorage.setItem('potp_v2_session', JSON.stringify({ token: authToken, user: currentUser, company: currentCompany }));
}

function clearSession() {
  localStorage.removeItem('potp_v2_session');
  authToken = null; currentUser = null; currentCompany = null;
  // Stop the global alert poller so a signed-out browser doesn't keep
  // hitting the API and flashing the banner.
  if (typeof globalAlertsStop === 'function') globalAlertsStop();
}

function selectCompany(co) {
  currentCompany = co;
  var c = COMPANIES[co];
  document.getElementById('login-co-name').textContent = c.name;
  document.getElementById('login-logo').src = c.logo;
  document.getElementById('login-btn').style.background = c.color;
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').style.display = 'none';
  showScreen('screen-login');
  setTimeout(function(){ document.getElementById('login-user').focus(); }, 300);
}

async function doLogin() {
  var username = document.getElementById('login-user').value.trim();
  var password = document.getElementById('login-pass').value;
  var errEl = document.getElementById('login-error');
  var btn = document.getElementById('login-btn');
  if (!username || !password) { errEl.textContent = 'Enter username and password.'; errEl.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Signing in...'; errEl.style.display = 'none';
  try {
    var slug = COMPANIES[currentCompany].slug;
    var data = await apiCall('POST', '/api/login', { username: username, password: password, company_slug: slug });
    authToken = data.token;
    currentUser = data.user;
    saveSession();
    if (currentUser && currentUser.force_password_change) {
      window._pendingPasskeySetup = currentUser && currentUser.needs_passkey_setup;
      showScreen('screen-change-password');
    } else if (currentUser && currentUser.needs_passkey_setup) {
      buildDash(); showScreen('screen-passkey-setup');
    } else {
      buildDash(); showScreen('screen-dash');
    }
    // Start plant-wide alert polling after any successful auth so the
    // banner surfaces active contamination events immediately.
    if (typeof globalAlertsStart === 'function') globalAlertsStart();
  } catch(e) {
    errEl.textContent = 'Incorrect username or password.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

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
// Expose functions globally for inline onclick handlers
window.loadSession = loadSession;
window.saveSession = saveSession;
window.clearSession = clearSession;
window.selectCompany = selectCompany;
window.doLogin = doLogin;
window.setupPasskey = setupPasskey;
window.skipPasskeySetup = skipPasskeySetup;
window.base64urlToBuffer = base64urlToBuffer;
window.bufferToBase64url = bufferToBase64url;
window.submitPasswordChange = submitPasswordChange;
// Expose to global scope for inline onclick handlers
window.loadSession = loadSession;
window.saveSession = saveSession;
window.clearSession = clearSession;
window.selectCompany = selectCompany;
window.doLogin = doLogin;
window.setupPasskey = setupPasskey;
window.skipPasskeySetup = skipPasskeySetup;
window.base64urlToBuffer = base64urlToBuffer;
window.bufferToBase64url = bufferToBase64url;
window.submitPasswordChange = submitPasswordChange;

// ── SIGN OUT BUTTON ──
// ── COMPANY CARD RENDERING ──
function renderCompanyCards() {
  var container = document.querySelector('.portal-cards');
  if (!container) return;
  fetch('/api/auth?action=get_companies')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.ok || !d.companies || !d.companies.length) return;
      container.innerHTML = '';
      var M = {'pride-of-the-pond':'potp','battle-fish-north':'bfn'};
      d.companies.forEach(function(c) {
        var key = M[c.slug] || c.slug;
        var co = (typeof COMPANIES!=='undefined'&&COMPANIES[key])||{};
        var coName = co.name || c.name;
        var coColor = co.color || '#1a3a6b';
        var initials = coName.split(' ').map(function(w){return w[0];}).join('').substring(0,3);

        var card = document.createElement('div');
        card.className = 'portal-card ' + key + '-card';

        var header = document.createElement('div');
        header.className = 'pc-header';
        card.appendChild(header);

        function makeFallbackLogo() {
          var fb = document.createElement('div');
          fb.className = 'pc-logo';
          fb.style.cssText = 'background:'+coColor+';display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.4rem;font-weight:700;';
          fb.textContent = initials;
          return fb;
        }

        if (co.logo) {
          var img = document.createElement('img');
          img.className = 'pc-logo';
          img.src = co.logo;
          img.alt = coName;
          img.onerror = function() {
            img.parentNode.replaceChild(makeFallbackLogo(), img);
          };
          header.appendChild(img);
        } else {
          header.appendChild(makeFallbackLogo());
        }

        var nm = document.createElement('div');
        nm.className = 'pc-name';
        nm.textContent = coName;
        header.appendChild(nm);

        var footer = document.createElement('div');
        footer.className = 'pc-footer';
        footer.textContent = 'Sign in →';
        card.appendChild(footer);

        card.addEventListener('click', function() { selectCompany(key); });
        container.appendChild(card);
      });
    }).catch(function(e){console.warn('cards:',e);});
}



document.addEventListener('DOMContentLoaded', function() {
  renderCompanyCards();
  var logoutBtn = document.getElementById('logout-btn');
  if(logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      // Stop message polling
      if(typeof stopMsgPolling === 'function') stopMsgPolling();
      // Close any open widget
      if(typeof closeWidget === 'function') closeWidget();
      // Clear session data
      clearSession();
      // Remove all stored sessions
      Object.keys(localStorage).filter(function(k){ return k.endsWith('_session'); })
        .forEach(function(k){ localStorage.removeItem(k); });
      // Show login screen
      document.getElementById('screen-dashboard').style.display = 'none';
      document.getElementById('screen-login').style.display = '';
      document.getElementById('login-user').value = '';
      document.getElementById('login-pass').value = '';
    });
  }
});


// Global sign-out function callable from anywhere after buildDash
function doSignOut() {
  // Stop message polling
  if(typeof stopMsgPolling === 'function') stopMsgPolling();
  // Close any open widget
  if(typeof closeWidget === 'function') closeWidget();
  // Clear session data
  clearSession();
  // Remove all stored sessions
  Object.keys(localStorage).filter(function(k){ return k.endsWith('_session'); })
  .forEach(function(k){ localStorage.removeItem(k); });
}
window.doSignOut = doSignOut;

// Wire sign-out button - callable after dynamic render
function wireSignOut() {
  var btn = document.getElementById('logout-btn');
  if (!btn) return;
  btn.onclick = function() {
    if (typeof stopMsgPolling === 'function') stopMsgPolling();
    if (typeof closeWidget === 'function') closeWidget();
    localStorage.clear();
    sessionStorage.clear();
    window.currentUser = null;
    location.reload();
  };
}
window.wireSignOut = wireSignOut;

function doSignOut() {
  if(typeof stopMsgPolling === 'function') stopMsgPolling();
  if(typeof closeWidget === 'function') closeWidget();
  // Clear all session data
  Object.keys(localStorage).filter(function(k){
    return k.indexOf('_session') > -1 || k.indexOf('_company') > -1;
  }).forEach(function(k){ localStorage.removeItem(k); });
  window.currentUser = null;
  window.currentCompany = null;
  // Reload to return to login screen
  location.reload();
}
window.doSignOut = doSignOut;

// Delegated Sign Out handler — survives DOM re-renders
(function() {
  var _soWired = false;
  function attachSignOut() {
    if (_soWired) return;
    _soWired = true;
    document.addEventListener('click', function(e) {
      var t = e.target;
      if (t && (t.id === 'logout-btn' || (t.closest && t.closest('#logout-btn')))) {
        e.preventDefault();
        if (typeof stopMsgPolling === 'function') stopMsgPolling();
        if (typeof closeWidget === 'function') closeWidget();
        localStorage.clear();
        sessionStorage.clear();
        window.currentUser = null;
        location.reload();
      }
    });
  }
  // Attach immediately and also when DOM is ready
  attachSignOut();
  document.addEventListener('DOMContentLoaded', attachSignOut);
})();
