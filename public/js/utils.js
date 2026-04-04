// utils.js - Shared utilities

async function apiCall(method, path, body) {
  var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
  if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(path, opts);
  var data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function setSyncBadge(s) {
  ['sync-badge','sync-badge-widget'].forEach(function(id){
    var b = document.getElementById(id);
    if (!b) return;
    b.className = 'sync-badge ' + s;
    b.textContent = s==='synced'?'💾 Saved':s==='syncing'?'⏳ Saving...':'⚠️ Error';
    b.style.display = 'block';
  });
}

function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2500);
}