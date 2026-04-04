// auth.js - Authentication

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
}

// ── NAV ──────────────────────────────────────────────────────────────────────
document.getElementById('card-potp').addEventListener('click', function(){ selectCompany('potp'); });
document.getElementById('card-bfn').addEventListener('click', function(){ selectCompany('bfn'); });

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

document.getElementById('login-pass').addEventListener('keydown', function(e){ if(e.key==='Enter') doLogin(); });
document.getElementById('login-btn').addEventListener('click', doLogin);
document.getElementById('back-link').addEventListener('click', function(){ showScreen('screen-select'); });

async function doLogin() {
  var username = document.getElementById('login-user').value.trim();
  var password = document.getElementById('login-pass').value;
  var errEl = document.getElementById('login-error');
  var btn = document.getElementById('login-btn');
  if (!username || !password) { errEl.textContent = 'Enter username and password.'; errEl.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Signing in...'; errEl.style.display = 'none';
  try {
    var slug = COMPANIES[currentCompany].slug;
    var data = await apiCall('POST', '/api/login', { username: username, password: password, company_slug: currentCompany });
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
  } catch(e) {
    errEl.textContent = 'Incorrect username or password.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

document.getElementById('logout-btn').addEventListener('click', function(){
  clearSession(); currentCompany = null; showScreen('screen-select');
});

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