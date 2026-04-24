// alerts.js — Plant-wide emergency alert system
//
// Currently surfaces one class of alert: truck_sample_fail events on any
// flavor pond. These are contamination events ("the worst problem that
// could happen to us") so we go heavy:
//
//   1. PERSISTENT BANNER at the top of every screen (z-index 10000)
//   2. FULL-SCREEN EMERGENCY MODAL the first time each user's session
//      sees a new alert — forces a "Seen" click before continuing
//   3. AUDIO PING so people notice even if their eyes are on the scale,
//      not the monitor
//
// Two separate dismissal concepts:
//   - "Seen" (per-user, per-session) — you've acknowledged the modal;
//     won't pop again unless a NEW alert appears. Stored in localStorage.
//   - "Dismissed" (plant-wide, manager-only) — the underlying fail is
//     resolved; banner clears for everyone. Stored server-side via
//     /api/flavor?action=dismiss_alert.
//
// Flow:
//   - Polls /api/flavor?action=get_active_alerts every ALERT_POLL_MS
//   - New alert ID detected → emergency modal + audio ping
//   - Banner stays up until manager dismisses
//   - "View" jumps into the Flavor widget

(function () {
  var ALERT_POLL_MS = 15000; // 15s — contamination events need to reach
                             // other users' screens fast. Payload is tiny.
  var SEEN_STORAGE_KEY = 'potp_seen_alert_ids';
  var _timer = null;
  var _lastAlerts = [];      // cache so re-render doesn't flicker
  var _inModal = false;      // suppress duplicate modals when polling overlaps

  // Per-user "I've seen it" state. We only fire the emergency modal for
  // alert IDs not in this set. Stored in localStorage so a refresh doesn't
  // re-fire the modal for alerts the user already saw.
  function getSeenIds() {
    try {
      var raw = localStorage.getItem(SEEN_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function markSeen(ids) {
    try {
      var seen = getSeenIds();
      var set = {};
      seen.forEach(function (id) { set[id] = true; });
      ids.forEach(function (id) { set[id] = true; });
      // Cap size so localStorage doesn't grow unbounded — 500 is plenty,
      // alerts roll over on resolution anyway
      var merged = Object.keys(set).slice(-500);
      localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(merged));
    } catch (e) {}
  }

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

    // Fire the emergency modal for any alerts this user's session hasn't
    // seen yet. We collect them all into one modal so a user landing on a
    // screen with 3 unseen fails gets one big "3 emergencies" card, not 3
    // stacked modals.
    var seen = getSeenIds();
    var seenSet = {};
    seen.forEach(function (id) { seenSet[id] = true; });
    var unseen = alerts.filter(function (a) { return !seenSet[a.id]; });
    if (unseen.length > 0 && !_inModal) {
      openEmergencyModal(unseen);
    }
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

  // Emergency modal — pops once per user-session per alert ID. Blocks the
  // whole UI with a red card until the user clicks "I've seen it". That's
  // distinct from the manager dismissal — this only closes the modal and
  // records the ID in localStorage so we don't nag. The banner stays up
  // until a manager actually resolves the underlying fail.
  //
  // Plays a 3-beep audio ping. Browsers may block autoplay if the user
  // hasn't interacted with the page yet; if so, the visual modal still
  // fires. After any click anywhere, subsequent pings will work.
  function openEmergencyModal(unseenAlerts) {
    if (_inModal) return;
    _inModal = true;
    // Kick off the audio first — best-effort; catches autoplay blocks silently
    playAlertBeeps();

    var existing = document.getElementById('gab-emergency-modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'gab-emergency-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:10100;display:flex;align-items:center;justify-content:center;padding:20px;animation:alertFadeIn .2s ease-out';

    var listHtml = unseenAlerts.map(function (a) {
      var dateStr = a.sample_date ? String(a.sample_date).split('T')[0] : '';
      return '<div style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:12px 14px;margin-bottom:10px;text-align:left">'
        + '<div style="font-weight:700;font-size:1rem">' + escHtml(a.farmer_name) + ' › ' + escHtml(a.pond_group_name) + ' › pond ' + escHtml(a.pond_number) + '</div>'
        + '<div style="font-size:.82rem;opacity:.9;margin-top:4px">Sampled <strong>' + escHtml(dateStr) + '</strong>'
        + (a.sampled_by ? ' by <strong>' + escHtml(a.sampled_by) + '</strong>' : '') + '</div>'
        + (a.notes ? '<div style="font-size:.8rem;font-style:italic;margin-top:6px;opacity:.85">"' + escHtml(a.notes) + '"</div>' : '')
        + '</div>';
    }).join('');

    var headline = unseenAlerts.length === 1
      ? '🚨 EMERGENCY ALERT'
      : '🚨 ' + unseenAlerts.length + ' EMERGENCY ALERTS';
    var subline = unseenAlerts.length === 1
      ? 'A truck sample has FAILED. Contain the fish immediately.'
      : unseenAlerts.length + ' truck samples have FAILED. Contain the fish immediately.';

    overlay.innerHTML = ''
      + '<div style="background:linear-gradient(135deg,#991b1b 0%,#7f1d1d 100%);color:#fff;border-radius:14px;padding:28px 28px 22px;max-width:540px;width:100%;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 2px #fff inset,0 0 0 6px #991b1b inset;text-align:center;animation:alertShake .6s ease-in-out">'
      + '  <div style="font-size:2.4rem;margin-bottom:6px;animation:alertPulse 1s ease-in-out infinite">🚨</div>'
      + '  <div style="font-size:1.4rem;font-weight:800;letter-spacing:.06em;margin-bottom:8px">' + headline + '</div>'
      + '  <div style="font-size:.95rem;opacity:.95;margin-bottom:18px">' + escHtml(subline) + '</div>'
      + '  <div style="max-height:260px;overflow-y:auto;margin-bottom:16px">' + listHtml + '</div>'
      + '  <button id="gab-em-seen" style="background:#fff;color:#991b1b;border:none;border-radius:10px;padding:14px 28px;font-size:1rem;font-weight:800;cursor:pointer;letter-spacing:.04em;box-shadow:0 4px 14px rgba(0,0,0,.3);width:100%">✓ I\'ve Seen It</button>'
      + '  <div style="font-size:.72rem;opacity:.75;margin-top:10px">Banner at the top stays until a manager acknowledges. This confirms you\'re aware.</div>'
      + '</div>';

    document.body.appendChild(overlay);

    // Inject the emergency modal animations if not already present
    if (!document.getElementById('alert-emergency-style')) {
      var st = document.createElement('style');
      st.id = 'alert-emergency-style';
      st.textContent = ''
        + '@keyframes alertFadeIn { from { opacity:0 } to { opacity:1 } }'
        + '@keyframes alertShake {'
        + '  0%,100% { transform: translateX(0) }'
        + '  10%,30%,50%,70%,90% { transform: translateX(-6px) }'
        + '  20%,40%,60%,80% { transform: translateX(6px) }'
        + '}';
      document.head.appendChild(st);
    }

    document.getElementById('gab-em-seen').onclick = function () {
      markSeen(unseenAlerts.map(function (a) { return a.id; }));
      overlay.remove();
      _inModal = false;
    };
  }

  // Web Audio API beep — 3 short pulses at alternating pitches. No audio
  // file needed; the browser synthesizes it. Silently no-ops when autoplay
  // is blocked or AudioContext isn't available.
  function playAlertBeeps() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      // iOS Safari requires resume() after a user gesture — this returns a
      // promise we don't await; if it rejects, the beeps silently skip.
      if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
      var now = ctx.currentTime;
      var beep = function (startAt, freq, duration) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(startAt); osc.stop(startAt + duration + 0.05);
      };
      beep(now,       1000, 0.22);
      beep(now + 0.3,  800, 0.22);
      beep(now + 0.6, 1200, 0.35);
    } catch (e) { /* no audio, oh well — visual still fires */ }
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
