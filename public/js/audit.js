// audit.js — Audit Log tab in Settings (admin-only).
//
// Renders into #audit-log-section (lives inside the Settings modal, admin-only).
// Pulls from /api/audit. Filters: action, user, success-only, time window.
//
// Design: dense table, color-coded rows (failures red, admin actions blue),
// click a row to expand the JSON details. One-page load (limit 100) with a
// "Load more" button for deeper history.

var _auditState = {
  events: [],
  actions: [],
  usernames: [],
  total: 0,
  offset: 0,
  filters: { action: '', username: '', success: '', since: '' },
  expanded: {} // id -> bool
};

function loadAuditLog() {
  var el = document.getElementById('audit-log-section');
  if (!el) return;
  el.innerHTML = '<div style="color:#94a3b8;padding:20px;text-align:center">Loading audit events…</div>';
  _auditState.offset = 0;
  _auditState.expanded = {};
  fetchAuditPage(true);
}

function fetchAuditPage(replace) {
  var qs = buildAuditQuery();
  apiCall('GET', '/api/audit?' + qs)
    .then(function (data) {
      _auditState.actions = data.actions || [];
      _auditState.usernames = data.usernames || [];
      _auditState.total = data.total || 0;
      if (replace) _auditState.events = data.events || [];
      else _auditState.events = _auditState.events.concat(data.events || []);
      renderAuditLog();
    })
    .catch(function (err) {
      var el = document.getElementById('audit-log-section');
      if (el) el.innerHTML = '<div style="color:#ef4444;padding:12px">Failed to load: ' + escapeAudit(err.message || 'unknown error') + '</div>';
    });
}

function buildAuditQuery() {
  var f = _auditState.filters;
  var parts = ['limit=100', 'offset=' + _auditState.offset];
  if (f.action) parts.push('action=' + encodeURIComponent(f.action));
  if (f.username) parts.push('username=' + encodeURIComponent(f.username));
  if (f.success) parts.push('success=' + encodeURIComponent(f.success));
  if (f.since) parts.push('since=' + encodeURIComponent(f.since));
  return parts.join('&');
}

function renderAuditLog() {
  var el = document.getElementById('audit-log-section');
  if (!el) return;

  var f = _auditState.filters;

  // Filter bar
  var html = '';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">';

  // Action dropdown
  html += '<select onchange="auditSetFilter(\'action\', this.value)" style="' + AU_SELECT + '">';
  html += '<option value=""' + (!f.action ? ' selected' : '') + '>All actions</option>';
  _auditState.actions.forEach(function (a) {
    html += '<option value="' + escapeAudit(a) + '"' + (f.action === a ? ' selected' : '') + '>' + escapeAudit(a) + '</option>';
  });
  html += '</select>';

  // Username dropdown
  html += '<select onchange="auditSetFilter(\'username\', this.value)" style="' + AU_SELECT + '">';
  html += '<option value=""' + (!f.username ? ' selected' : '') + '>All users</option>';
  _auditState.usernames.forEach(function (u) {
    html += '<option value="' + escapeAudit(u) + '"' + (f.username === u ? ' selected' : '') + '>' + escapeAudit(u) + '</option>';
  });
  html += '</select>';

  // Success filter
  html += '<select onchange="auditSetFilter(\'success\', this.value)" style="' + AU_SELECT + '">';
  html += '<option value=""' + (!f.success ? ' selected' : '') + '>All outcomes</option>';
  html += '<option value="true"' + (f.success === 'true' ? ' selected' : '') + '>Success only</option>';
  html += '<option value="false"' + (f.success === 'false' ? ' selected' : '') + '>Failures only</option>';
  html += '</select>';

  // Time window dropdown — ISO since for each option
  html += '<select onchange="auditSetSince(this.value)" style="' + AU_SELECT + '">';
  var windowOpts = [
    { label: 'All time', value: '' },
    { label: 'Last 24 hours', value: auditSinceIso(24) },
    { label: 'Last 7 days', value: auditSinceIso(24 * 7) },
    { label: 'Last 30 days', value: auditSinceIso(24 * 30) }
  ];
  windowOpts.forEach(function (o) {
    html += '<option value="' + o.value + '"' + (f.since === o.value ? ' selected' : '') + '>' + o.label + '</option>';
  });
  html += '</select>';

  // Refresh button
  html += '<button onclick="loadAuditLog()" style="margin-left:auto;background:#1a3a6b;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:.75rem;font-weight:600;cursor:pointer">&#x21bb; Refresh</button>';
  html += '</div>';

  // Summary line
  html += '<div style="font-size:.72rem;color:#64748b;margin-bottom:8px">';
  html += 'Showing ' + _auditState.events.length + ' of ' + _auditState.total + ' event' + (_auditState.total === 1 ? '' : 's');
  if (f.action || f.username || f.success || f.since) html += ' (filtered)';
  html += '</div>';

  // Events table
  if (!_auditState.events.length) {
    html += '<div style="color:#94a3b8;padding:30px;text-align:center;font-size:.85rem">No audit events match these filters.</div>';
  } else {
    html += '<div style="max-height:560px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:.76rem">';
    html += '<thead style="position:sticky;top:0;background:#f1f5f9;z-index:1"><tr>';
    ['Time', 'User', 'Action', '', 'IP', 'Details'].forEach(function (h) {
      html += '<th style="padding:8px 10px;text-align:left;color:#475569;font-weight:600;border-bottom:1px solid #cbd5e1">' + h + '</th>';
    });
    html += '</tr></thead><tbody>';

    _auditState.events.forEach(function (e) {
      var isFailure = e.success === false;
      // Row color: failures red, admin-only actions light blue, else white
      var rowBg = isFailure ? '#fef2f2'
                : isAdminAction(e.action) ? '#eff6ff'
                : '#fff';
      var actionColor = isFailure ? '#b91c1c'
                      : isAdminAction(e.action) ? '#1e40af'
                      : '#0f172a';
      var expanded = !!_auditState.expanded[e.id];

      html += '<tr onclick="auditToggleRow(\'' + e.id + '\')" style="background:' + rowBg + ';cursor:pointer;border-bottom:1px solid #f1f5f9" onmouseover="this.style.filter=\'brightness(0.97)\'" onmouseout="this.style.filter=\'\'">';
      html += '<td style="padding:7px 10px;white-space:nowrap;color:#334155">' + auditFormatTime(e.created_at) + '</td>';
      html += '<td style="padding:7px 10px;white-space:nowrap;color:#334155">' + escapeAudit(e.username || '—') + '</td>';
      html += '<td style="padding:7px 10px;white-space:nowrap;font-family:ui-monospace,monospace;font-size:.72rem;color:' + actionColor + ';font-weight:600">' + escapeAudit(e.action) + '</td>';
      html += '<td style="padding:7px 10px;text-align:center">' + (isFailure ? '<span style="color:#dc2626;font-weight:700">✗</span>' : '<span style="color:#16a34a">✓</span>') + '</td>';
      html += '<td style="padding:7px 10px;white-space:nowrap;color:#64748b;font-family:ui-monospace,monospace;font-size:.7rem">' + escapeAudit(e.ip_address || '—') + '</td>';
      html += '<td style="padding:7px 10px;color:#475569">' + auditShortDetails(e) + '</td>';
      html += '</tr>';

      if (expanded) {
        html += '<tr style="background:' + rowBg + '"><td colspan="6" style="padding:0 10px 10px 10px">';
        html += '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:10px;font-family:ui-monospace,monospace;font-size:.7rem;white-space:pre-wrap;color:#334155">';
        var full = {
          id: e.id,
          created_at: e.created_at,
          company_id: e.company_id,
          user_id: e.user_id,
          username: e.username,
          action: e.action,
          success: e.success,
          resource_type: e.resource_type,
          resource_id: e.resource_id,
          ip_address: e.ip_address,
          user_agent: e.user_agent,
          details: e.details
        };
        html += escapeAudit(JSON.stringify(full, null, 2));
        html += '</div></td></tr>';
      }
    });
    html += '</tbody></table></div>';

    // Load more button
    if (_auditState.events.length < _auditState.total) {
      html += '<div style="text-align:center;margin-top:12px">';
      html += '<button onclick="auditLoadMore()" style="background:#fff;border:1px solid #cbd5e1;color:#1a3a6b;border-radius:6px;padding:8px 20px;font-size:.78rem;font-weight:600;cursor:pointer">Load more (' + (_auditState.total - _auditState.events.length) + ' remaining)</button>';
      html += '</div>';
    }
  }

  el.innerHTML = html;
}

// ── Helpers ────────────────────────────────────────────────────────────────

var AU_SELECT = 'padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:.76rem;background:#fff;color:#0f172a;cursor:pointer';

// Admin-flavored actions get blue highlighting so you can scan for
// privileged operations (password resets by admins, role changes, deactivations).
function isAdminAction(action) {
  if (!action) return false;
  return action.indexOf('password_reset_by_admin') >= 0
      || action.indexOf('role_change') >= 0
      || action.indexOf('deactivate') >= 0
      || action.indexOf('force_password_change_flag') >= 0
      || action.indexOf('passkey.delete_by_admin') >= 0
      || action.indexOf('user.create_for_company') >= 0
      || action.indexOf('user.bulk_seed') >= 0;
}

function auditFormatTime(iso) {
  if (!iso) return '—';
  try {
    var d = new Date(iso);
    // Local date + time, compact.
    var dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    var timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return dateStr + ' ' + timeStr;
  } catch (e) {
    return iso;
  }
}

// Produce a readable 1-line summary of an event's details object.
function auditShortDetails(e) {
  var d = e.details || {};
  var parts = [];
  if (e.resource_type && e.resource_id) parts.push(escapeAudit(e.resource_type) + ':' + escapeAudit(String(e.resource_id).slice(0, 8)));
  // Pull a few high-signal keys to show inline.
  var highSignal = ['reason', 'role', 'new_role', 'new_username', 'target_company_slug', 'company_slug', 'count', 'type', 'field'];
  highSignal.forEach(function (k) {
    if (d[k] !== undefined && d[k] !== null) parts.push(k + '=' + escapeAudit(String(d[k])));
  });
  if (parts.length === 0) return '<span style="color:#94a3b8">(click to expand)</span>';
  return parts.join(' &middot; ');
}

function auditSinceIso(hoursAgo) {
  var d = new Date();
  d.setHours(d.getHours() - hoursAgo);
  return d.toISOString();
}

// HTML-escape untrusted strings to prevent any stored XSS from user-controlled
// audit fields (username, details values).
function escapeAudit(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Event handlers (exposed to window for inline onclick/onchange) ─────────

function auditSetFilter(key, value) {
  _auditState.filters[key] = value;
  _auditState.offset = 0;
  _auditState.expanded = {};
  fetchAuditPage(true);
}

function auditSetSince(value) {
  _auditState.filters.since = value;
  _auditState.offset = 0;
  _auditState.expanded = {};
  fetchAuditPage(true);
}

function auditLoadMore() {
  _auditState.offset = _auditState.events.length;
  fetchAuditPage(false);
}

function auditToggleRow(id) {
  _auditState.expanded[id] = !_auditState.expanded[id];
  renderAuditLog();
}

window.loadAuditLog = loadAuditLog;
window.auditSetFilter = auditSetFilter;
window.auditSetSince = auditSetSince;
window.auditLoadMore = auditLoadMore;
window.auditToggleRow = auditToggleRow;
