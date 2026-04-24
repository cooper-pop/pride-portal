// alerts.js — Plant-wide alert banner
//
// Currently surfaces one class of alert: truck_sample_fail events on any
// flavor pond. These are contamination events ("the worst problem that
// could happen to us") so the banner is red, pulsing, and sits above every
// widget with z-index 10000 so you can't miss it on any screen.
//
// Flow:
//   - Polls /api/flavor?action=get_active_alerts every ALERT_POLL_MS
//   - Renders the banner only when there's at least one unresolved fail
//   - View button → opens the Flavor widget (dashboard tab)
//   - Acknowledge button (manager+) → modal → POST dismiss_alert
//
// The backend enforces who can dismiss; the frontend only hides the button
// for supervisors to keep the UX clean.

(function () {
  var ALERT_POLL_MS = 60000; // 1 minute — fast enough for "contain asap" flow
  var _timer = null;
  var _lastAlerts = [];      // cache so re-render doesn't flicker

  // Initialize banner DOM lazily the first time we render. Keeps index.html
  // thin and decoupled from this module.
  function ensureBanner() {
    if (document.getElementById('global-alert-banner')) return;
    var bar = document.createElement('div');
    bar.id = 'global-alert-banner';
    bar.style.cssText = [
      'position:fixed',
      'top:0', 'left:0', 'right:0',
      'z-index:10000',
      'background:#991b1b',
      'color:#fff',
      'padding:10px 16px',
      'box-shadow:0 4px 20px rgba(220,38,38,.5)',
      'display:none',
      'font-family:inherit',
      'animation:alertPulse 1.6s ease-in-out infinite'
    ].join(';');
    bar.innerHTML = ''
      + '<div style="max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
      + '  <span style="font-size:1.4rem;line-height:1">🚨</span>'
      + '  <div id="gab-text" style="flex:1;min-width:200px;font-size:.9rem;font-weight:700;letter-spacing:.02em">TRUCK SAMPLE FAIL</div>'
      + '  <button id="gab-view" style="background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:6px;padding:6px 12px;font-size:.8rem;font-weight:700;cursor:pointer">View</button>'
      + '  <button id="gab-ack" style="background:#fff;color:#991b1b;border:none;border-radius:6px;padding:6px 12px;font-size:.8rem;font-weight:700;cursor:pointer">Acknowledge</button>'
      + '</div>';
    document.body.appendChild(bar);

    // Inject pulse keyframes once — CSS file might not include them yet
    // and we don't want to depend on deploy ordering.
    if (!document.getElementById('alert-pulse-style')) {
      var st = document.createElement('style');
      st.id = 'alert-pulse-style';
      st.textContent = '@keyframes alertPulse {'
        + '0%,100% { box-shadow: 0 4px 20px rgba(220,38,38,.5); background:#991b1b; }'
        + '50%    { box-shadow: 0 6px 28px rgba(220,38,38,.9); background:#b91c1c; }'
        + '}';
      document.head.appendChild(st);
    }

    document.getElementById('gab-view').onclick = function () {
      // Navigate into the Flavor widget's dashboard tab so the user sees
      // the failing pond immediately. openWidget is the existing dashboard
      // dispatcher — safe to call from anywhere.
      if (typeof openWidget === 'function') {
        openWidget('flavor', 'Flavor Sample');
      }
    };
    document.getElementById('gab-ack').onclick = openAckModal;
  }

  // Hide the Acknowledge button for supervisors. (The backend still blocks
  // it — this is just cleaner UX.)
  function applyAckButtonPerms() {
    var btn = document.getElementById('gab-ack');
    if (!btn) return;
    var canDismiss = (typeof userCan === 'function') && userCan('flavor', 'edit');
    btn.style.display = canDismiss ? '' : 'none';
  }

  function render(alerts) {
    ensureBanner();
    var bar = document.getElementById('global-alert-banner');
    var txt = document.getElementById('gab-text');
    if (!bar || !txt) return;

    if (!alerts || alerts.length === 0) {
      bar.style.display = 'none';
      // Clear any body-padding shim
      document.body.style.paddingTop = '';
      return;
    }

    // Summarize: if one, show full detail; if many, show count + most recent
    var latest = alerts[0];
    var label = latest.farmer_name + ' › ' + latest.pond_group_name + ' › pond ' + latest.pond_number;
    var dateStr = latest.sample_date ? String(latest.sample_date).split('T')[0] : '';
    var prefix = alerts.length === 1
      ? '🚨 TRUCK SAMPLE FAIL'
      : ('🚨 ' + alerts.length + ' TRUCK SAMPLE FAILS');
    txt.textContent = prefix + ' — ' + label + (dateStr ? ' · sampled ' + dateStr : '') + ' — contain immediately';

    bar.style.display = 'block';
    applyAckButtonPerms();

    // Push the page down so the fixed banner doesn't cover the header.
    // 48px is a comfortable single-line height; grows if text wraps.
    requestAnimationFrame(function () {
      var h = bar.offsetHeight;
      document.body.style.paddingTop = h + 'px';
    });
  }

  function check() {
    // Only poll when authenticated with flavor view perms. Supervisors and up
    // see the banner; lower-role sessions shouldn't fetch at all.
    if (typeof currentUser === 'undefined' || !currentUser) return;
    if (typeof userCan === 'function' && !userCan('flavor', 'view')) return;
    apiCall('GET', '/api/flavor?action=get_active_alerts')
      .then(function (r) {
        _lastAlerts = r && r.alerts ? r.alerts : [];
        render(_lastAlerts);
      })
      .catch(function (err) {
        // Silent. A blip shouldn't keep flashing an error. Banner stays
        // as whatever we had last; next tick will try again.
        if (err && err.message && !/401|403/.test(err.message)) {
          console.warn('[alerts] poll failed:', err.message);
        }
      });
  }

  // Start/stop. Idempotent — calling start() twice doesn't create two timers.
  function start() {
    stop();
    check();
    _timer = setInterval(check, ALERT_POLL_MS);
  }
  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    var bar = document.getElementById('global-alert-banner');
    if (bar) bar.style.display = 'none';
    document.body.style.paddingTop = '';
  }

  // Ack modal — dismisses a single alert with a required reason. If there
  // are multiple alerts active, we dismiss the most-recent one and let the
  // next poll surface the next one. Manager can keep clicking to work down
  // the list.
  function openAckModal() {
    var alert = _lastAlerts[0];
    if (!alert) return;
    var existing = document.getElementById('gab-ack-modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'gab-ack-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10050;display:flex;align-items:center;justify-content:center;padding:20px';
    var dateStr = alert.sample_date ? String(alert.sample_date).split('T')[0] : '';
    overlay.innerHTML = ''
      + '<div style="background:#fff;border-radius:12px;padding:22px;max-width:520px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.4);border-top:6px solid #991b1b">'
      + '  <div style="font-size:1.15rem;font-weight:700;color:#991b1b;margin-bottom:6px">🚨 Acknowledge Truck Sample Fail</div>'
      + '  <div style="font-size:.82rem;color:#64748b;margin-bottom:14px">You\'re confirming you\'ve seen this contamination event and taking action.</div>'
      + '  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;margin-bottom:14px">'
      + '    <div style="font-size:.78rem;color:#64748b;margin-bottom:4px">Farmer › Pond Group › Pond</div>'
      + '    <div style="font-weight:700;color:#991b1b">' + escHtml(alert.farmer_name) + ' › ' + escHtml(alert.pond_group_name) + ' › pond ' + escHtml(alert.pond_number) + '</div>'
      + '    <div style="font-size:.78rem;color:#64748b;margin-top:8px">Sampled: <strong>' + escHtml(dateStr) + '</strong>'
      + (alert.sampled_by ? ' by <strong>' + escHtml(alert.sampled_by) + '</strong>' : '') + '</div>'
      + (alert.notes ? '    <div style="font-size:.78rem;color:#475569;margin-top:6px;font-style:italic">"' + escHtml(alert.notes) + '"</div>' : '')
      + '  </div>'
      + '  <label style="display:block;font-size:.78rem;color:#475569;font-weight:600;margin-bottom:6px">What action are you taking? <span style="color:#991b1b">*</span></label>'
      + '  <textarea id="gab-ack-reason" rows="3" placeholder="e.g., Fish quarantined in vat 4, destroy order issued, QA notified" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:.86rem;box-sizing:border-box;resize:vertical;font-family:inherit"></textarea>'
      + '  <div id="gab-ack-err" style="color:#991b1b;font-size:.8rem;margin-top:8px;display:none"></div>'
      + '  <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">'
      + '    <button onclick="document.getElementById(\'gab-ack-modal\').remove()" style="padding:8px 14px;background:#f1f5f9;color:#334155;border:none;border-radius:6px;font-weight:600;cursor:pointer">Cancel</button>'
      + '    <button id="gab-ack-save" style="padding:8px 14px;background:#991b1b;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer">Acknowledge & Dismiss</button>'
      + '  </div>'
      + '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    setTimeout(function () {
      var el = document.getElementById('gab-ack-reason'); if (el) el.focus();
    }, 60);
    document.getElementById('gab-ack-save').onclick = function () {
      var reason = (document.getElementById('gab-ack-reason').value || '').trim();
      var err = document.getElementById('gab-ack-err');
      if (!reason) {
        err.textContent = 'Action required — describe what you\'re doing about the failed sample.';
        err.style.display = 'block';
        return;
      }
      err.style.display = 'none';
      apiCall('POST', '/api/flavor?action=dismiss_alert', { sample_id: alert.id, reason: reason })
        .then(function () {
          var m = document.getElementById('gab-ack-modal'); if (m) m.remove();
          if (typeof toast === 'function') toast('✓ Alert dismissed');
          check(); // immediate refresh
        })
        .catch(function (e) {
          err.textContent = (e && e.message) || 'Dismiss failed';
          err.style.display = 'block';
        });
    };
  }

  function escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Expose start/stop globally so auth.js can call them
  window.globalAlertsStart = start;
  window.globalAlertsStop = stop;
  window.globalAlertsCheck = check;
})();
