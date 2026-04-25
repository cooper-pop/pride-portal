// fish-schedule.js — Live Fish Scheduling widget (Phase 1)
//
// Weekly calendar of expected deliveries from farmers / live haulers. Each
// day has 4 time-slot lanes: Start Up (previous evening) / Morning / Noon /
// Afternoon. Per delivery: farmer + expected pounds + optional notes. Days
// can be toggled to No Kill.
//
// Later phases add per-vat tracking + actual vs expected logging.

(function () {
  var TIME_SLOTS = [
    { key: 'startup',   label: 'Start Up',  icon: '🌅', desc: 'prev evening' },
    { key: 'morning',   label: 'Morning',   icon: '☀️', desc: '' },
    { key: 'noon',      label: 'Noon',      icon: '🕛', desc: '' },
    { key: 'afternoon', label: 'Afternoon', icon: '🌆', desc: '' }
  ];
  var DAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  var _fsState = {
    tab: 'schedule',
    weekStart: '',    // ISO YYYY-MM-DD (Sunday)
    farmers: [],      // [{id, name, color}]
    days: [],         // [{day_date, is_no_kill, deliveries: [...]}]
    // Intake state (Phase B):
    loads: [],        // [{id, day_date, farmer_id, gross_lbs, ..., payable_total}]
    deliveries: [],   // Flat list of scheduled deliveries for the week (for "attach to schedule" dropdown)
    // Dock price profile (lazy-loaded on first Intake render). Used to label
    // size bands + price inputs everywhere they're displayed.
    dockConfig: null,
    loading: false
  };

  // Default dock config used when the API hasn't responded yet (e.g., initial
  // render before the fetch completes). Matches the Excel-style 4-band setup.
  var DEFAULT_DOCK_CONFIG = {
    dock_active: true,
    tier1_label: '0–4 lb',     tier1_min_lbs: 0, tier1_max_lbs: 4,    tier1_default_price: null,
    tier2_label: '4–5.99 lb',  tier2_min_lbs: 4, tier2_max_lbs: 5.99, tier2_default_price: null,
    tier3_label: '6–7.99 lb',  tier3_min_lbs: 6, tier3_max_lbs: 7.99, tier3_default_price: null,
    tier4_label: '8+ lb',      tier4_min_lbs: 8, tier4_max_lbs: null, tier4_default_price: null
  };
  function dockConfig() { return _fsState.dockConfig || DEFAULT_DOCK_CONFIG; }
  function loadDockConfig(cb) {
    apiCall('GET', '/api/fish-schedule?action=get_dock_config')
      .then(function (r) { _fsState.dockConfig = r && r.config ? r.config : DEFAULT_DOCK_CONFIG; if (cb) cb(); })
      .catch(function () { _fsState.dockConfig = DEFAULT_DOCK_CONFIG; if (cb) cb(); });
  }

  // Button / card styles (match other widgets)
  var BTN = 'padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:.78rem;font-weight:600';
  var BTN_P = BTN + ';background:#1a3a6b;color:#fff';
  var BTN_SUB = BTN + ';background:#f1f5f9;color:#334155';
  var BTN_D = 'padding:2px 8px;border-radius:5px;border:none;cursor:pointer;font-size:.68rem;background:#fee2e2;color:#b91c1c';
  var INP = 'width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:.85rem;box-sizing:border-box';

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtLbs(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US') + ' lbs';
  }
  function isoDate(d) { return d.toISOString().split('T')[0]; }
  // Week = Sunday through Saturday. Given any ISO date (or today), returns
  // that week's Sunday as a YYYY-MM-DD string.
  function weekStartOf(iso) {
    var d = new Date((iso || isoDate(new Date())) + 'T00:00:00');
    d.setDate(d.getDate() - d.getDay());
    return isoDate(d);
  }
  function addDaysIso(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }
  function prettyDay(iso) {
    var d = new Date(iso + 'T00:00:00');
    return DAY_ABBR[d.getDay()] + ' ' + d.getDate();
  }
  function prettyRange(weekStart) {
    var a = new Date(weekStart + 'T00:00:00');
    var b = new Date(weekStart + 'T00:00:00'); b.setDate(b.getDate() + 6);
    var opts = { month: 'short', day: 'numeric' };
    return a.toLocaleDateString('en-US', opts) + ' – ' + b.toLocaleDateString('en-US', opts) + ', ' + b.getFullYear();
  }

  // ═══ ENTRY ═════════════════════════════════════════════════════════════
  function buildFishScheduleWidget() {
    var wt = document.getElementById('widget-tabs');
    var tabs = [
      { id: 'schedule', label: '📅 Schedule' },
      { id: 'intake',   label: '🐟 Intake' },
      { id: 'payable',  label: '💵 Fish Payable' },
      { id: 'farmers',  label: '🚜 Farmers' }
    ];
    wt.innerHTML = tabs.map(function (t) {
      return '<button class="wtab" id="fs-tab-' + t.id + '" onclick="fsShowTab(\'' + t.id + '\')" '
        + 'style="padding:6px 12px;border:none;background:transparent;cursor:pointer;font-size:.78rem;'
        + 'border-bottom:2px solid transparent;color:#94a3b8">' + t.label + '</button>';
    }).join('');

    if (!_fsState.weekStart) _fsState.weekStart = weekStartOf();
    fsShowTab('schedule');
  }

  function fsShowTab(tab) {
    _fsState.tab = tab;
    ['schedule', 'intake', 'payable', 'farmers'].forEach(function (t) {
      var btn = document.getElementById('fs-tab-' + t);
      if (!btn) return;
      var active = (t === tab);
      btn.style.color = active ? '#1a3a6b' : '#94a3b8';
      btn.style.borderBottomColor = active ? '#1a3a6b' : 'transparent';
    });
    if (tab === 'schedule') fsLoadAndRenderSchedule();
    else if (tab === 'intake') fsLoadAndRenderIntake();
    else if (tab === 'payable') fsLoadAndRenderPayable();
    else if (tab === 'farmers') fsLoadAndRenderFarmers();
  }

  // ═══ SCHEDULE TAB ══════════════════════════════════════════════════════
  function fsLoadAndRenderSchedule() {
    var panel = document.getElementById('widget-content');
    panel.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner-wrap"><div class="spinner"></div></div>Loading schedule…</div>';
    apiCall('GET', '/api/fish-schedule?action=get_state&week_start=' + _fsState.weekStart)
      .then(function (r) {
        _fsState.farmers = r.farmers || [];
        _fsState.days = r.days || [];
        fsRenderSchedule();
      })
      .catch(function (err) {
        panel.innerHTML = '<div style="padding:20px;color:#ef4444">Failed to load: ' + esc(err.message) + '</div>';
      });
  }

  function fsRenderSchedule() {
    var panel = document.getElementById('widget-content');
    if (!panel) return;

    var canEdit = (typeof userCan === 'function') && userCan('fishschedule', 'edit');
    var canCreate = (typeof userCan === 'function') && userCan('fishschedule', 'create');
    var canDelete = (typeof userCan === 'function') && userCan('fishschedule', 'delete');

    // Weekly total = sum of expected_lbs across every delivery this week
    var weeklyTotal = 0;
    _fsState.days.forEach(function (day) {
      day.deliveries.forEach(function (dl) { weeklyTotal += (parseInt(dl.expected_lbs, 10) || 0); });
    });

    var html = '<div style="padding:14px;max-width:100%;margin:0 auto">';

    // Header: nav + range + total
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;background:#fff;border-radius:10px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<button style="' + BTN_SUB + '" onclick="fsWeekNav(-1)">← Prev</button>'
      + '<button style="' + BTN_SUB + '" onclick="fsGoToday()">This Week</button>'
      + '<button style="' + BTN_SUB + '" onclick="fsWeekNav(1)">Next →</button>'
      + '<div style="flex:1;font-weight:700;color:#1a3a6b;font-size:1rem;margin-left:12px">'
      + prettyRange(_fsState.weekStart) + '</div>'
      + '<div style="font-size:.76rem;color:#64748b;font-weight:600">Weekly Total</div>'
      + '<div style="font-size:1.05rem;color:#1a3a6b;font-weight:700">' + fmtLbs(weeklyTotal) + '</div>'
      + '</div>';

    if (_fsState.farmers.length === 0) {
      html += '<div style="background:#fef3c7;border:1px solid #fde68a;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:.82rem;color:#92400e">'
        + '⚠️ No farmers added yet. Switch to the <strong>🚜 Farmers</strong> tab to add your first farmer before scheduling deliveries.'
        + '</div>';
    }

    // 7-day grid. auto-fit minmax means it'll stack on narrow screens.
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;align-items:stretch">';
    _fsState.days.forEach(function (day) {
      html += fsRenderDayCard(day, { canEdit: canEdit, canCreate: canCreate, canDelete: canDelete });
    });
    html += '</div>';

    html += '</div>';
    panel.innerHTML = html;
  }

  function fsRenderDayCard(day, permsLocal) {
    var dailyTotal = 0;
    day.deliveries.forEach(function (dl) { dailyTotal += (parseInt(dl.expected_lbs, 10) || 0); });

    var isToday = (day.day_date === isoDate(new Date()));
    var header = isToday
      ? '<div style="background:#1a3a6b;color:#fff;padding:8px 10px;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:space-between">'
      : '<div style="background:#f1f5f9;color:#334155;padding:8px 10px;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:space-between">';
    header += '<div style="font-weight:700;font-size:.82rem">' + prettyDay(day.day_date) + '</div>';

    if (permsLocal.canEdit) {
      header += '<button title="Toggle No Kill" onclick="fsToggleNoKill(\'' + day.day_date + '\')" style="background:' + (day.is_no_kill ? '#fee2e2' : 'rgba(255,255,255,.2)') + ';color:' + (day.is_no_kill ? '#991b1b' : (isToday ? '#fff' : '#334155')) + ';border:none;border-radius:5px;padding:2px 8px;font-size:.68rem;font-weight:700;cursor:pointer">'
        + (day.is_no_kill ? '🚫 No Kill' : 'Set No Kill') + '</button>';
    } else if (day.is_no_kill) {
      header += '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:5px;font-size:.68rem;font-weight:700">🚫 No Kill</span>';
    }
    header += '</div>';

    var bodyBg = day.is_no_kill ? '#fafafa' : '#fff';
    var bodyOpacity = day.is_no_kill ? 0.55 : 1;

    var body = '<div style="background:' + bodyBg + ';border-radius:0 0 8px 8px;padding:6px;opacity:' + bodyOpacity + ';flex:1;display:flex;flex-direction:column">';

    TIME_SLOTS.forEach(function (slot) {
      var slotDeliveries = day.deliveries.filter(function (d) { return d.time_slot === slot.key; });
      body += '<div style="border-bottom:1px solid #f1f5f9;padding:5px 4px 7px">';
      body += '<div style="display:flex;align-items:center;justify-content:space-between;font-size:.68rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">'
        + '<span>' + slot.icon + ' ' + slot.label + (slot.desc ? ' <span style="text-transform:none;font-weight:400;color:#94a3b8">(' + slot.desc + ')</span>' : '') + '</span>'
        + (permsLocal.canCreate && !day.is_no_kill
          ? '<button title="Add delivery" onclick="fsAddDelivery(\'' + day.day_date + '\',\'' + slot.key + '\')" style="background:none;border:1px dashed #cbd5e1;color:#64748b;border-radius:4px;padding:0 6px;font-size:.78rem;font-weight:700;cursor:pointer;line-height:1.2">+</button>'
          : '')
        + '</div>';

      if (slotDeliveries.length === 0) {
        body += '<div style="font-size:.72rem;color:#cbd5e1;font-style:italic;padding:2px 4px">—</div>';
      } else {
        slotDeliveries.forEach(function (dl) {
          var farmer = _fsState.farmers.find(function (f) { return f.id === dl.farmer_id; });
          var farmerName = farmer ? farmer.name : '(deleted)';
          var color = farmer ? (farmer.color || '#1a3a6b') : '#64748b';

          // Actual-vs-expected: if a Phase-B load has been attached, show
          // the net received with a variance arrow. Green ↑ if over, amber
          // ↓ if under, neutral if within 5%.
          var actual = (dl.actual_net_lbs != null) ? Number(dl.actual_net_lbs) : null;
          var expected = (dl.expected_lbs != null) ? Number(dl.expected_lbs) : null;
          var actualRow = '';
          if (actual != null) {
            var varianceBadge = '';
            if (expected != null && expected > 0) {
              var diff = actual - expected;
              var pct = (diff / expected) * 100;
              var arrow = Math.abs(pct) < 5 ? '≈' : (diff > 0 ? '↑' : '↓');
              var badgeColor = Math.abs(pct) < 5 ? '#64748b' : (diff > 0 ? '#059669' : '#b45309');
              varianceBadge = ' <span style="color:' + badgeColor + ';font-weight:700">' + arrow + ' '
                + (diff > 0 ? '+' : '') + Math.round(pct) + '%</span>';
            }
            actualRow = '<div style="font-size:.68rem;color:#059669;font-weight:600">✓ ' + fmtLbs(actual)
              + ' recv'
              + (dl.linked_load_count > 1 ? ' (' + dl.linked_load_count + ' loads)' : '')
              + varianceBadge + '</div>';
          }

          body += '<div style="background:#fff;border:1px solid #e2e8f0;border-left:3px solid ' + color + ';border-radius:5px;padding:4px 6px;margin-bottom:3px;display:flex;align-items:center;gap:4px">'
            + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:.74rem;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(farmerName) + '">' + esc(farmerName) + '</div>'
            + '<div style="font-size:.7rem;color:#1a3a6b;font-weight:700">' + fmtLbs(dl.expected_lbs) + ' exp</div>'
            + actualRow
            + (dl.notes ? '<div style="font-size:.66rem;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(dl.notes) + '">' + esc(dl.notes) + '</div>' : '')
            + '</div>'
            + (permsLocal.canEdit ? '<button title="Edit" onclick="fsEditDelivery(' + dl.id + ')" style="background:none;border:none;cursor:pointer;color:#64748b;font-size:.82rem;padding:0 4px">✎</button>' : '')
            + (permsLocal.canDelete ? '<button title="Delete" onclick="fsDeleteDelivery(' + dl.id + ')" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:.82rem;padding:0 4px">×</button>' : '')
            + '</div>';
        });
      }
      body += '</div>';
    });

    body += '<div style="padding:6px 8px;background:#f8fafc;border-radius:5px;display:flex;justify-content:space-between;align-items:center;font-size:.74rem;margin-top:6px">'
      + '<span style="color:#64748b;font-weight:600">Daily Total</span>'
      + '<span style="color:#1a3a6b;font-weight:700">' + fmtLbs(dailyTotal) + '</span>'
      + '</div>';

    body += '</div>';

    return '<div style="background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);display:flex;flex-direction:column;min-height:260px">' + header + body + '</div>';
  }

  function fsWeekNav(delta) {
    _fsState.weekStart = addDaysIso(_fsState.weekStart, delta * 7);
    fsLoadAndRenderSchedule();
  }
  function fsGoToday() {
    _fsState.weekStart = weekStartOf();
    fsLoadAndRenderSchedule();
  }

  function fsToggleNoKill(dayDate) {
    var day = _fsState.days.find(function (d) { return d.day_date === dayDate; });
    var newVal = !(day && day.is_no_kill);
    apiCall('POST', '/api/fish-schedule?action=save_day', {
      day_date: dayDate,
      is_no_kill: newVal,
      notes: (day && day.notes) || null
    }).then(function () {
      if (day) day.is_no_kill = newVal;
      fsRenderSchedule();
      toast(newVal ? '🚫 Marked No Kill' : 'Cleared No Kill');
    }).catch(function (err) { toast('⚠️ ' + err.message); });
  }

  // ── Delivery modal ───────────────────────────────────────────────────
  function fsAddDelivery(dayDate, timeSlot) {
    fsOpenDeliveryModal({ day_date: dayDate, time_slot: timeSlot });
  }
  function fsEditDelivery(id) {
    var found;
    _fsState.days.some(function (day) {
      var d = day.deliveries.find(function (x) { return x.id === id; });
      if (d) {
        found = { id: d.id, day_date: day.day_date, farmer_id: d.farmer_id,
                  time_slot: d.time_slot, expected_lbs: d.expected_lbs, notes: d.notes };
        return true;
      }
      return false;
    });
    if (found) fsOpenDeliveryModal(found);
  }
  function fsDeleteDelivery(id) {
    if (!confirm('Delete this delivery?')) return;
    apiCall('POST', '/api/fish-schedule?action=delete_delivery', { id: id })
      .then(function () { toast('Deleted'); fsLoadAndRenderSchedule(); })
      .catch(function (err) { toast('⚠️ ' + err.message); });
  }

  function fsOpenDeliveryModal(initial) {
    var isEdit = !!initial.id;
    var overlay = document.createElement('div');
    overlay.id = 'fs-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    var farmerOpts = _fsState.farmers.map(function (f) {
      return '<option value="' + f.id + '"' + (f.id === initial.farmer_id ? ' selected' : '') + '>' + esc(f.name) + '</option>';
    }).join('');
    var slotOpts = TIME_SLOTS.map(function (s) {
      return '<option value="' + s.key + '"' + (s.key === initial.time_slot ? ' selected' : '') + '>' + s.icon + ' ' + s.label + '</option>';
    }).join('');

    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:20px;max-width:460px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">'
      + '<div style="font-weight:700;font-size:1.05rem;color:#1a3a6b;margin-bottom:12px">' + (isEdit ? '✎ Edit Delivery' : '+ New Delivery') + '</div>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Date</label>'
      + '<input id="fs-m-date" type="date" value="' + esc(initial.day_date || '') + '" style="' + INP + '">'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Time Slot</label>'
      + '<select id="fs-m-slot" style="' + INP + '">' + slotOpts + '</select>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Farmer</label>'
      + '<select id="fs-m-farmer" style="' + INP + '">' + (farmerOpts || '<option value="">(no farmers — add one first)</option>') + '</select>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Expected Pounds</label>'
      + '<input id="fs-m-lbs" type="number" min="0" step="100" placeholder="e.g., 25000" value="' + (initial.expected_lbs == null ? '' : initial.expected_lbs) + '" style="' + INP + '">'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Notes <span style="font-weight:400;color:#94a3b8">(optional)</span></label>'
      + '<textarea id="fs-m-notes" rows="2" placeholder="e.g., truck #3, call driver at 4pm" style="' + INP + ';resize:vertical">' + esc(initial.notes || '') + '</textarea>'
      + '<div id="fs-m-err" style="color:#ef4444;font-size:.78rem;margin-top:8px;display:none"></div>'
      + '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">'
      + (isEdit ? '<button style="' + BTN_D + ';padding:8px 14px;font-size:.78rem" onclick="fsDeleteFromModal(' + initial.id + ')">Delete</button>' : '')
      + '<button style="' + BTN_SUB + ';padding:8px 14px" onclick="document.getElementById(\'fs-modal\').remove()">Cancel</button>'
      + '<button style="' + BTN_P + ';padding:8px 14px" onclick="fsSaveDelivery(' + (initial.id || 'null') + ')">Save</button>'
      + '</div>'
      + '</div>';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    setTimeout(function () { var el = document.getElementById('fs-m-lbs'); if (el) el.focus(); }, 80);
  }

  function fsSaveDelivery(id) {
    var dayDate = document.getElementById('fs-m-date').value;
    var timeSlot = document.getElementById('fs-m-slot').value;
    var farmerId = document.getElementById('fs-m-farmer').value;
    var lbs = document.getElementById('fs-m-lbs').value;
    var notes = document.getElementById('fs-m-notes').value.trim();
    var err = document.getElementById('fs-m-err');
    err.style.display = 'none';
    if (!dayDate || !timeSlot || !farmerId) {
      err.textContent = 'Date, slot, and farmer are required.';
      err.style.display = 'block';
      return;
    }
    var body = {
      day_date: dayDate,
      time_slot: timeSlot,
      farmer_id: parseInt(farmerId, 10),
      expected_lbs: lbs === '' ? null : parseInt(lbs, 10),
      notes: notes || null
    };
    if (id) body.id = id;
    apiCall('POST', '/api/fish-schedule?action=save_delivery', body)
      .then(function () {
        document.getElementById('fs-modal').remove();
        toast(id ? 'Saved' : 'Delivery added');
        fsLoadAndRenderSchedule();
      })
      .catch(function (e) {
        err.textContent = e.message;
        err.style.display = 'block';
      });
  }

  function fsDeleteFromModal(id) {
    if (!confirm('Delete this delivery?')) return;
    apiCall('POST', '/api/fish-schedule?action=delete_delivery', { id: id })
      .then(function () {
        var m = document.getElementById('fs-modal'); if (m) m.remove();
        toast('Deleted');
        fsLoadAndRenderSchedule();
      })
      .catch(function (err) { toast('⚠️ ' + err.message); });
  }

  // ═══ INTAKE TAB (Phase B) ══════════════════════════════════════════════
  // Per-load intake entry. One card per truck actually received. Captures
  // gross/tare/net, size breakdown (0-4 / 4-6 / 6-8 / 8+ lbs per fish),
  // deductions in pounds, optional dock price, farmer + pond traceability.
  // Payable $ and payable lbs auto-compute on save (and preview live in
  // the modal).
  function fmtMoney(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPrice(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    return '$' + Number(n).toFixed(2) + '/lb';
  }
  // Stubborn one: strip trailing zeros so 5000.00 shows as 5,000 but 5000.50
  // stays 5,000.5 — Cooper's sheet doesn't show decimal zeros.
  function fmtLbsLoose(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    var v = Number(n);
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function fsLoadAndRenderIntake() {
    var panel = document.getElementById('widget-content');
    panel.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner-wrap"><div class="spinner"></div></div>Loading intake…</div>';
    // Two parallel fetches — get_intake and get_dock_config. Dock config
    // drives the size-band labels + default prices; we don't render until
    // both are in so labels stay consistent on first paint.
    Promise.all([
      apiCall('GET', '/api/fish-schedule?action=get_intake&week_start=' + _fsState.weekStart),
      _fsState.dockConfig
        ? Promise.resolve({ config: _fsState.dockConfig })
        : apiCall('GET', '/api/fish-schedule?action=get_dock_config').catch(function () { return { config: DEFAULT_DOCK_CONFIG }; })
    ]).then(function (results) {
        var r = results[0];
        var dc = results[1];
        _fsState.farmers = r.farmers || [];
        _fsState.deliveries = r.deliveries || [];
        _fsState.loads = r.loads || [];
        if (dc && dc.config) _fsState.dockConfig = dc.config;
        fsRenderIntake();
      })
      .catch(function (err) {
        panel.innerHTML = '<div style="padding:20px;color:#ef4444">Failed to load: ' + esc(err.message) + '</div>';
      });
  }

  function fsRenderIntake() {
    var panel = document.getElementById('widget-content');
    if (!panel) return;

    var canCreate = (typeof userCan === 'function') && userCan('fishschedule', 'create');
    var canEdit = (typeof userCan === 'function') && userCan('fishschedule', 'edit');
    var canDelete = (typeof userCan === 'function') && userCan('fishschedule', 'delete');

    // Bucket loads by day + compute weekly totals
    var byDay = {}; // iso date → [loads]
    var weekly = { net: 0, payable_lbs: 0, payable_total: 0, deduct: 0, loads: 0,
                   sz04: 0, sz46: 0, sz68: 0, sz8p: 0 };
    _fsState.loads.forEach(function (l) {
      var d = l.day_date;
      (byDay[d] = byDay[d] || []).push(l);
      weekly.net += Number(l.net_lbs) || 0;
      weekly.payable_lbs += Number(l.payable_lbs) || 0;
      weekly.payable_total += Number(l.payable_total) || 0;
      weekly.deduct += Number(l.deduction_lbs) || 0;
      weekly.sz04 += Number(l.size_0_4_lbs) || 0;
      weekly.sz46 += Number(l.size_4_6_lbs) || 0;
      weekly.sz68 += Number(l.size_6_8_lbs) || 0;
      weekly.sz8p += Number(l.size_8_plus_lbs) || 0;
      weekly.loads++;
    });

    // Days of the week, even empty ones, so operators can add loads for
    // any day without navigating elsewhere
    var weekDays = [];
    for (var i = 0; i < 7; i++) weekDays.push(addDaysIso(_fsState.weekStart, i));

    var html = '<div style="padding:14px;max-width:100%;margin:0 auto">';

    // Header: nav + range + dock-config button
    var canEditDock = (typeof userCan === 'function') && userCan('fishschedule', 'edit');
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;background:#fff;border-radius:10px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<button style="' + BTN_SUB + '" onclick="fsWeekNavIntake(-1)">← Prev</button>'
      + '<button style="' + BTN_SUB + '" onclick="fsGoTodayIntake()">This Week</button>'
      + '<button style="' + BTN_SUB + '" onclick="fsWeekNavIntake(1)">Next →</button>'
      + '<div style="flex:1;font-weight:700;color:#1a3a6b;font-size:1rem;margin-left:12px">'
      + prettyRange(_fsState.weekStart) + '</div>'
      + (canEditDock ? '<button style="' + BTN_SUB + '" onclick="fsOpenDockConfig()">⚙️ Dock Settings</button>' : '')
      + '</div>';

    // DOCK OFF banner — when the dock is paused, the entire intake flow
    // becomes a no-buy. Big visible warning so operators know not to set
    // expectations with farmers.
    var dc = dockConfig();
    if (dc.dock_active === false) {
      html += '<div style="background:#7f1d1d;color:#fff;border-radius:10px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 12px rgba(127,29,29,.3)">'
        + '<span style="font-size:1.4rem">⛔</span>'
        + '<div style="flex:1"><div style="font-weight:800;letter-spacing:.04em">DOCK IS OFF</div>'
        + '<div style="font-size:.78rem;opacity:.9">No fish are being purchased. Manager can re-enable in Dock Settings.</div></div>'
        + '</div>';
    }

    // Weekly summary strip
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:14px">'
      + summaryChip('🚚 Loads', String(weekly.loads), '#0369a1')
      + summaryChip('📦 Net Received', fmtLbsLoose(weekly.net) + ' lbs', '#1a3a6b')
      + summaryChip('✂️ Deductions', fmtLbsLoose(weekly.deduct) + ' lbs', '#991b1b')
      + summaryChip('💰 Payable', fmtLbsLoose(weekly.payable_lbs) + ' lbs', '#065f46')
      + summaryChip('💵 Total $', fmtMoney(weekly.payable_total), '#065f46')
      + '</div>';

    // Size band strip (weekly)
    if (weekly.net > 0) {
      html += '<div style="background:#fff;border-radius:10px;padding:10px 14px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
        + '<div style="font-size:.72rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Size Breakdown (weekly)</div>'
        + sizeBandBar(weekly.sz04, weekly.sz46, weekly.sz68, weekly.sz8p)
        + '</div>';
    }

    if (_fsState.farmers.length === 0) {
      html += '<div style="background:#fef3c7;border:1px solid #fde68a;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:.82rem;color:#92400e">'
        + '⚠️ No farmers added yet. Switch to the <strong>🚜 Farmers</strong> tab to add your first farmer before recording loads.'
        + '</div>';
    }

    // One section per day
    weekDays.forEach(function (d) {
      var dayLoads = byDay[d] || [];
      var dayNet = 0, dayPay = 0, dayDeduct = 0;
      dayLoads.forEach(function (l) {
        dayNet += Number(l.net_lbs) || 0;
        dayPay += Number(l.payable_total) || 0;
        dayDeduct += Number(l.deduction_lbs) || 0;
      });
      var isToday = (d === isoDate(new Date()));

      html += '<div style="background:#fff;border-radius:10px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden">';
      html += '<div style="background:' + (isToday ? '#1a3a6b' : '#f1f5f9') + ';color:' + (isToday ? '#fff' : '#334155') + ';padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
        + '<div style="font-weight:700;font-size:.95rem">' + prettyDay(d) + '</div>'
        + '<div style="flex:1"></div>'
        + (dayLoads.length
            ? '<div style="font-size:.74rem;opacity:.85">' + dayLoads.length + ' load' + (dayLoads.length === 1 ? '' : 's')
              + ' · ' + fmtLbsLoose(dayNet) + ' lbs net'
              + (dayDeduct > 0 ? ' · −' + fmtLbsLoose(dayDeduct) + ' ded' : '')
              + (dayPay > 0 ? ' · ' + fmtMoney(dayPay) : '')
              + '</div>'
            : '<div style="font-size:.74rem;opacity:.6;font-style:italic">no loads</div>')
        + (canCreate
            ? '<button style="background:rgba(255,255,255,' + (isToday ? '.18' : '0') + ');border:1px solid ' + (isToday ? 'rgba(255,255,255,.3)' : '#cbd5e1') + ';color:' + (isToday ? '#fff' : '#1a3a6b') + ';border-radius:6px;padding:4px 10px;font-size:.74rem;font-weight:700;cursor:pointer" onclick="fsAddLoad(\'' + d + '\')">+ Add Load</button>'
            : '')
        + '</div>';

      if (dayLoads.length === 0) {
        html += '<div style="padding:14px;text-align:center;color:#94a3b8;font-size:.8rem;font-style:italic">No loads recorded yet for this day.</div>';
      } else {
        html += '<div style="padding:6px 10px">';
        dayLoads.forEach(function (l) {
          html += fsRenderLoadCard(l, { canEdit: canEdit, canDelete: canDelete });
        });
        html += '</div>';
      }
      html += '</div>';
    });

    html += '</div>';
    panel.innerHTML = html;
  }

  function summaryChip(label, value, color) {
    return '<div style="background:#fff;border-radius:10px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<div style="font-size:.68rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em">' + label + '</div>'
      + '<div style="font-size:1.05rem;font-weight:700;color:' + color + ';margin-top:2px">' + value + '</div>'
      + '</div>';
  }

  // Stacked bar showing % of pounds in each size band. Only rendered when
  // at least one band has weight. Colors: blue→teal→green→amber (small→big).
  function sizeBandBar(sz04, sz46, sz68, sz8p) {
    var total = (sz04 || 0) + (sz46 || 0) + (sz68 || 0) + (sz8p || 0);
    if (total <= 0) return '<div style="color:#94a3b8;font-size:.74rem;font-style:italic">No size-grade data yet.</div>';
    // Pull labels from dock config so the bar matches whatever Cooper has
    // configured for today's tiers.
    var dc = dockConfig();
    var bands = [
      { label: dc.tier1_label, lbs: sz04 || 0, color: '#0369a1' },
      { label: dc.tier2_label, lbs: sz46 || 0, color: '#0891b2' },
      { label: dc.tier3_label, lbs: sz68 || 0, color: '#059669' },
      { label: dc.tier4_label, lbs: sz8p || 0, color: '#ca8a04' }
    ];
    var bar = '<div style="display:flex;height:18px;border-radius:4px;overflow:hidden;background:#f1f5f9">';
    bands.forEach(function (b) {
      if (b.lbs <= 0) return;
      var pct = (b.lbs / total) * 100;
      bar += '<div title="' + b.label + ': ' + fmtLbsLoose(b.lbs) + ' lbs (' + pct.toFixed(1) + '%)" '
        + 'style="width:' + pct + '%;background:' + b.color + '"></div>';
    });
    bar += '</div>';

    var legend = '<div style="display:flex;gap:14px;margin-top:6px;flex-wrap:wrap;font-size:.72rem;color:#475569">';
    bands.forEach(function (b) {
      var pct = total > 0 ? ((b.lbs / total) * 100).toFixed(1) : '0';
      legend += '<div style="display:flex;align-items:center;gap:5px">'
        + '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + b.color + '"></span>'
        + '<span>' + b.label + ': <strong>' + fmtLbsLoose(b.lbs) + '</strong> (' + pct + '%)</span>'
        + '</div>';
    });
    legend += '</div>';
    return bar + legend;
  }

  function fsRenderLoadCard(l, p) {
    var farmer = _fsState.farmers.find(function (f) { return f.id === l.farmer_id; });
    var farmerName = farmer ? farmer.name : '(unknown farmer)';
    var color = farmer ? (farmer.color || '#1a3a6b') : '#64748b';

    // Size bands — only render rows that have values to keep cards tight
    var bands = [];
    if (Number(l.size_0_4_lbs) > 0) bands.push(['0–4', l.size_0_4_lbs]);
    if (Number(l.size_4_6_lbs) > 0) bands.push(['4–6', l.size_4_6_lbs]);
    if (Number(l.size_6_8_lbs) > 0) bands.push(['6–8', l.size_6_8_lbs]);
    if (Number(l.size_8_plus_lbs) > 0) bands.push(['8+', l.size_8_plus_lbs]);

    var html = '<div style="border:1px solid #e2e8f0;border-left:4px solid ' + color + ';border-radius:8px;margin:6px 0;padding:10px 12px;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">';

    // Left column: farmer + pond + truck + arrived + movement ticket
    html += '<div style="flex:1;min-width:160px">'
      + '<div style="font-weight:700;color:#0f172a;font-size:.9rem">' + esc(farmerName) + '</div>'
      + (l.pond_ref ? '<div style="font-size:.72rem;color:#64748b">🏞️ ' + esc(l.pond_ref) + '</div>' : '')
      + (l.movement_ticket_number ? '<div style="font-size:.72rem;color:#1e40af;font-weight:600">📋 mvmt #' + esc(l.movement_ticket_number) + '</div>' : '')
      + (l.truck_ref ? '<div style="font-size:.72rem;color:#64748b">🚚 ' + esc(l.truck_ref) + '</div>' : '')
      + (l.arrived_at ? '<div style="font-size:.7rem;color:#94a3b8">arr. ' + esc(formatArrivedShort(l.arrived_at)) + '</div>' : '')
      + (l.delivery_id ? '<div style="font-size:.68rem;color:#0369a1;margin-top:2px">🔗 scheduled</div>' : '')
      + '</div>';

    // Middle column: weights (Truck / Plant / Difference, matching the modal)
    html += '<div style="min-width:130px">'
      + '<div style="font-size:.68rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.04em">Weight</div>';
    if (l.gross_lbs != null || l.tare_lbs != null) {
      html += '<div style="font-size:.74rem;color:#475569">'
        + 'Truck ' + fmtLbsLoose(l.gross_lbs) + ' − Plant ' + fmtLbsLoose(l.tare_lbs)
        + '</div>';
    }
    html += '<div style="font-size:.92rem;color:#1a3a6b;font-weight:700">Diff ' + fmtLbsLoose(l.net_lbs) + ' lbs</div>';
    if (Number(l.deduction_lbs) > 0) {
      // Show per-category breakdown in tooltip + inline for the live ones
      var dedParts = [];
      if (Number(l.deduction_doa_lbs) > 0) dedParts.push('DOA ' + fmtLbsLoose(l.deduction_doa_lbs));
      if (Number(l.deduction_shad_lbs) > 0) dedParts.push('Shad ' + fmtLbsLoose(l.deduction_shad_lbs));
      if (Number(l.deduction_turtles_lbs) > 0) dedParts.push('Turtles ' + fmtLbsLoose(l.deduction_turtles_lbs));
      if (Number(l.deduction_other_species_lbs) > 0) dedParts.push('Other ' + fmtLbsLoose(l.deduction_other_species_lbs));
      if (Number(l.deduction_fingerlings_lbs) > 0) dedParts.push('Finger ' + fmtLbsLoose(l.deduction_fingerlings_lbs));
      var breakdown = dedParts.length > 0
        ? dedParts.join(' · ')
        : (l.deduction_reason || ''); // fallback for pre-category loads
      html += '<div style="font-size:.74rem;color:#991b1b" title="' + esc(breakdown) + '">'
        + '− ' + fmtLbsLoose(l.deduction_lbs) + ' ded'
        + (breakdown ? ' <span style="color:#64748b;font-size:.68rem">(' + esc(breakdown) + ')</span>' : '')
        + '</div>';
    }
    html += '</div>';

    // Size bands
    if (bands.length) {
      html += '<div style="min-width:120px">'
        + '<div style="font-size:.68rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.04em">Size Bands</div>';
      bands.forEach(function (b) {
        html += '<div style="font-size:.74rem;color:#475569">'
          + '<span style="color:#94a3b8">' + b[0] + ':</span> '
          + '<strong>' + fmtLbsLoose(b[1]) + '</strong>'
          + '</div>';
      });
      html += '</div>';
    }

    // Pricing
    if (l.dock_price_per_lb != null || l.payable_total != null) {
      html += '<div style="min-width:120px">'
        + '<div style="font-size:.68rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.04em">Pay</div>'
        + (l.dock_price_per_lb != null ? '<div style="font-size:.74rem;color:#475569">' + fmtPrice(l.dock_price_per_lb) + '</div>' : '')
        + (l.payable_lbs != null ? '<div style="font-size:.74rem;color:#475569">Payable ' + fmtLbsLoose(l.payable_lbs) + ' lbs</div>' : '')
        + (l.payable_total != null ? '<div style="font-size:.92rem;color:#065f46;font-weight:700">' + fmtMoney(l.payable_total) + '</div>' : '')
        + '</div>';
    }

    // Notes (full width)
    if (l.notes) {
      html += '<div style="flex-basis:100%;font-size:.74rem;color:#64748b;background:#f8fafc;border-radius:5px;padding:5px 8px;margin-top:4px">📝 ' + esc(l.notes) + '</div>';
    }

    // Action buttons
    if (p.canEdit || p.canDelete) {
      html += '<div style="display:flex;flex-direction:column;gap:4px">';
      if (p.canEdit) html += '<button title="Edit" onclick="fsEditLoad(' + l.id + ')" style="background:#f1f5f9;color:#1a3a6b;border:none;border-radius:5px;padding:4px 8px;font-size:.72rem;font-weight:600;cursor:pointer">✎ Edit</button>';
      if (p.canDelete) html += '<button title="Delete" onclick="fsDeleteLoad(' + l.id + ')" style="background:#fee2e2;color:#991b1b;border:none;border-radius:5px;padding:4px 8px;font-size:.72rem;font-weight:600;cursor:pointer">× Delete</button>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function formatArrivedShort(ts) {
    try {
      var d = new Date(ts);
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return String(ts); }
  }

  function fsWeekNavIntake(delta) {
    _fsState.weekStart = addDaysIso(_fsState.weekStart, delta * 7);
    fsLoadAndRenderIntake();
  }
  function fsGoTodayIntake() {
    _fsState.weekStart = weekStartOf();
    fsLoadAndRenderIntake();
  }

  // ── Load modal ────────────────────────────────────────────────────────
  function fsAddLoad(dayDate) {
    fsOpenLoadModal({ day_date: dayDate });
  }
  function fsEditLoad(id) {
    var l = _fsState.loads.find(function (x) { return x.id === id; });
    if (l) fsOpenLoadModal(l);
  }
  function fsDeleteLoad(id) {
    if (!confirm('Delete this load record? Historical load will be gone for good.')) return;
    apiCall('POST', '/api/fish-schedule?action=delete_load', { id: id })
      .then(function () { toast('Load deleted'); fsLoadAndRenderIntake(); })
      .catch(function (err) { toast('⚠️ ' + err.message); });
  }

  function fsOpenLoadModal(initial) {
    var isEdit = !!initial.id;
    var overlay = document.createElement('div');
    overlay.id = 'fs-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto';

    var farmerOpts = '<option value="">— Select farmer —</option>'
      + _fsState.farmers.map(function (f) {
          return '<option value="' + f.id + '"' + (f.id === initial.farmer_id ? ' selected' : '') + '>' + esc(f.name) + '</option>';
        }).join('');

    // Arrived-at / scheduled-delivery dropdowns were removed from the form
    // per Cooper's request. For new loads fsSaveLoad stamps arrived_at =
    // now() on create so the invoice-number sequence still has a stable
    // per-day ordering. Historical loads keep their values untouched.

    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:20px;max-width:720px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:calc(100vh - 40px);overflow-y:auto">'
      + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">'
      + '<div style="font-weight:700;font-size:1.1rem;color:#1a3a6b">' + (isEdit ? '✎ Edit Load' : '🐟 New Load') + '</div>'
      + (isEdit && initial.invoice_number
          ? '<div style="font-size:.78rem;color:#64748b">Invoice <strong style="color:#1a3a6b">#' + esc(initial.invoice_number) + '</strong></div>'
          : (!isEdit ? '<div style="font-size:.72rem;color:#94a3b8;font-style:italic">Invoice # auto-generated on save</div>' : ''))
      + '</div>'

      // Movement Ticket # — the farmer's reference number from their farm-side
      // scale weighing. Distinct from our auto-generated Invoice #. Kept at
      // the top so it's the first thing entered when the truck pulls in.
      + '<div style="background:#f0f7ff;border-left:3px solid #1e40af;border-radius:6px;padding:10px 12px;margin-bottom:12px">'
      + '<label style="display:block;font-size:.72rem;color:#1e40af;font-weight:700;margin-bottom:4px">📋 Movement Ticket # <span style="color:#94a3b8;font-weight:400">— from farmer\'s farm-side scale</span></label>'
      + '<input id="fs-l-movticket" type="text" placeholder="e.g., 12345" value="' + esc(initial.movement_ticket_number || '') + '" style="' + INP + '">'
      + '</div>'

      // Row 1: date only (arrived time, truck/driver, scheduled delivery link
      // removed per Cooper's request — the invoice only needs day + farmer +
      // pond + weights/bands/prices. Underlying schema columns still exist so
      // historical loads don't lose data; they're just not prompted for.)
      + '<div style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:10px;margin-bottom:10px">'
      + '<div><label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin-bottom:4px">Day</label>'
      + '<input id="fs-l-date" type="date" value="' + esc(initial.day_date || '') + '" style="' + INP + '"></div>'
      + '<div><label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin-bottom:4px">Farmer *</label>'
      + '<select id="fs-l-farmer" style="' + INP + '">' + farmerOpts + '</select></div>'
      + '<div><label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin-bottom:4px">Pond</label>'
      + '<input id="fs-l-pond" type="text" placeholder="e.g., Pond 4" value="' + esc(initial.pond_ref || '') + '" style="' + INP + '"></div>'
      + '</div>'

      // Weight section. Cooper's data model:
      //   Truck Weight (gross_lbs)  — full truck on arrival
      //   Plant Weight (net_lbs)    — fish weight at the plant scale.
      //                               THIS is what payable + invoicing run on.
      //   Difference                — Truck − Plant. Display only — represents
      //                               transit/scale variance, not used in math.
      //
      // Note the schema mapping: Plant Weight maps to net_lbs (the existing
      // "fish weight" column used by Production Report, Fish Payable, etc.).
      // The legacy tare_lbs column is no longer written — historical loads
      // keep whatever value they had.
      + '<div style="background:#f8fafc;border-radius:8px;padding:12px;margin-bottom:10px">'
      + '<div style="font-size:.78rem;font-weight:700;color:#1a3a6b;margin-bottom:8px">⚖️ Weight</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">'
      + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:4px">Truck Weight (lbs)</label>'
      + '<input id="fs-l-truck" type="number" min="0" step="1" placeholder="e.g., 42000" value="' + (initial.gross_lbs == null ? '' : initial.gross_lbs) + '" oninput="fsLoadModalRecalc()" style="' + INP + '"></div>'
      + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:4px">Plant Weight (lbs)</label>'
      + '<input id="fs-l-plant" type="number" min="0" step="1" placeholder="e.g., 24000" value="' + (initial.net_lbs == null ? '' : initial.net_lbs) + '" oninput="fsLoadModalRecalc()" style="' + INP + '"></div>'
      + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:4px">Difference (lbs) <span style="color:#94a3b8;font-weight:400">auto</span></label>'
      + '<input id="fs-l-diff" type="number" readonly placeholder="auto" style="' + INP + ';background:#fff;color:#475569"></div>'
      + '</div></div>'

      // Size bands — labels driven by company dock-price config so
      // operators see "Small / Medium / Large / Extra" or whatever the
      // current category names are. Schema columns are positional:
      //   tier1 → size_0_4_lbs   tier2 → size_4_6_lbs
      //   tier3 → size_6_8_lbs   tier4 → size_8_plus_lbs
      + '<div style="background:#f8fafc;border-radius:8px;padding:12px;margin-bottom:10px">'
      + '<div style="font-size:.78rem;font-weight:700;color:#1a3a6b;margin-bottom:8px">📏 Size Bands <span style="color:#94a3b8;font-weight:400;font-size:.72rem">(processed fish, lbs per band)</span></div>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">'
      + sizeInput('fs-l-sz46', dockConfig().tier2_label, initial.size_4_6_lbs)
      + sizeInput('fs-l-sz68', dockConfig().tier3_label, initial.size_6_8_lbs)
      + sizeInput('fs-l-sz8p', dockConfig().tier4_label, initial.size_8_plus_lbs)
      + sizeInput('fs-l-sz04', dockConfig().tier1_label, initial.size_0_4_lbs)
      + '</div>'
      + '<div id="fs-l-size-warn" style="font-size:.7rem;color:#92400e;margin-top:6px;display:none"></div>'
      + '</div>'

      // Deductions — 5 categorized buckets (Cooper's classification):
      //   1. Dead on Arrival (fish that died in transit)
      //   2. Shad (bycatch — we don't want em)
      //   3. Turtles
      //   4. Other Species (non-catfish — bass, carp, etc.)
      //   5. Fingerlings (undersize)
      // Each category has its own lbs input. Total = sum, auto-computed.
      + '<div style="background:#fef2f2;border-radius:8px;padding:12px;margin-bottom:10px">'
      + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">'
      + '<div style="font-size:.78rem;font-weight:700;color:#991b1b">✂️ Deductions <span style="color:#94a3b8;font-weight:400;font-size:.72rem">(lbs by category)</span></div>'
      + '<div style="font-size:.72rem;color:#475569">Total: <span id="fs-l-deduct-total" style="font-weight:700;color:#991b1b">0</span> lbs</div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">'
      + dedInput('fs-l-dedDoa',         'Dead on Arrival', initial.deduction_doa_lbs)
      + dedInput('fs-l-dedShad',        'Shad',            initial.deduction_shad_lbs)
      + dedInput('fs-l-dedTurtles',     'Turtles',         initial.deduction_turtles_lbs)
      + dedInput('fs-l-dedOtherSpecies','Other Species',   initial.deduction_other_species_lbs)
      + dedInput('fs-l-dedFingerlings', 'Fingerlings',     initial.deduction_fingerlings_lbs)
      + '</div></div>'

      // Pricing — four bands each with their own $/lb, matching FISH PAYABLE TOTAL.
      // "Dock Price" convenience field populates all bands; overrides are kept
      // if the user already set them individually.
      + '<div style="background:' + (dockConfig().dock_active === false ? '#fef2f2' : '#ecfdf5') + ';border-radius:8px;padding:12px;margin-bottom:10px">'
      + '<div style="font-size:.78rem;font-weight:700;color:' + (dockConfig().dock_active === false ? '#991b1b' : '#065f46') + ';margin-bottom:8px">💰 Pricing '
      + (dockConfig().dock_active === false
          ? '<span style="font-weight:700;color:#991b1b">— DOCK OFF</span>'
          : '<span style="color:#94a3b8;font-weight:400;font-size:.72rem">($/lb per band — fills from dock config defaults)</span>')
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:10px;margin-bottom:8px">'
      + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:4px">Dock Price</label>'
      + '<input id="fs-l-price" type="number" min="0" step="0.01" placeholder="e.g., 1.35" value="' + (initial.dock_price_per_lb == null ? '' : initial.dock_price_per_lb) + '" oninput="fsLoadModalFillBandPrices();fsLoadModalRecalc()" style="' + INP + '"></div>'
      // Per-tier price inputs. Default value falls back through:
      //   load's saved per-band → dock config tier default → load's flat dock price
      // Labels match the size-band labels exactly so it's obvious which
      // price drives which band.
      + priceInput('fs-l-p46', dockConfig().tier2_label + ' $/lb', initial.price_4_6_per_lb, initial.dock_price_per_lb, dockConfig().tier2_default_price)
      + priceInput('fs-l-p68', dockConfig().tier3_label + ' $/lb', initial.price_6_8_per_lb, initial.dock_price_per_lb, dockConfig().tier3_default_price)
      + priceInput('fs-l-p8p', dockConfig().tier4_label + ' $/lb', initial.price_8_plus_per_lb, initial.dock_price_per_lb, dockConfig().tier4_default_price)
      + priceInput('fs-l-p04', dockConfig().tier1_label + ' $/lb', initial.price_0_4_per_lb, initial.dock_price_per_lb, dockConfig().tier1_default_price)
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:4px">Payable Lbs <span style="color:#94a3b8;font-weight:400">auto</span></label>'
      + '<input id="fs-l-paylbs" type="text" readonly placeholder="—" style="' + INP + ';background:#fff;color:#065f46;font-weight:700"></div>'
      + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:4px">Total $ <span style="color:#94a3b8;font-weight:400">auto</span></label>'
      + '<input id="fs-l-paytotal" type="text" readonly placeholder="—" style="' + INP + ';background:#fff;color:#065f46;font-weight:700"></div>'
      + '</div></div>'

      // Notes
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin-bottom:4px">Notes <span style="color:#94a3b8;font-weight:400">(optional)</span></label>'
      + '<textarea id="fs-l-notes" rows="2" placeholder="e.g., ran long, driver needed to unload at dock 2" style="' + INP + ';resize:vertical">' + esc(initial.notes || '') + '</textarea>'

      + '<div id="fs-l-err" style="color:#ef4444;font-size:.78rem;margin-top:10px;display:none"></div>'
      + '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">'
      + (isEdit ? '<button style="' + BTN_D + ';padding:8px 14px;font-size:.78rem" onclick="fsDeleteLoadFromModal(' + initial.id + ')">Delete</button>' : '')
      + '<button style="' + BTN_SUB + ';padding:8px 14px" onclick="document.getElementById(\'fs-modal\').remove()">Cancel</button>'
      + '<button style="' + BTN_P + ';padding:8px 14px" onclick="fsSaveLoad(' + (initial.id || 'null') + ')">Save Load</button>'
      + '</div>'
      + '</div>';

    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    setTimeout(function () {
      var el = document.getElementById('fs-l-farmer'); if (el) el.focus();
      fsLoadModalRecalc(); // initial payable computation
    }, 80);
  }

  function sizeInput(id, label, v) {
    return '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:4px">' + label + '</label>'
      + '<input id="' + id + '" type="number" min="0" step="1" placeholder="0" value="' + (v == null ? '' : v) + '" oninput="fsLoadModalRecalc()" style="' + INP + '"></div>';
  }

  // Compact deduction-category input. Label above, tight number input below.
  function dedInput(id, label, v) {
    var val = (v == null || Number(v) === 0) ? '' : v;
    return '<div><label style="display:block;font-size:.66rem;color:#475569;font-weight:600;margin-bottom:3px;min-height:28px;line-height:1.1">' + label + '</label>'
      + '<input id="' + id + '" type="number" min="0" step="1" placeholder="0" value="' + val + '" oninput="fsLoadModalRecalc()" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:.82rem;width:100%;box-sizing:border-box"></div>';
  }

  // Per-band price input. Default value cascades through:
  //   1. The load's saved per-band price (when editing an existing load)
  //   2. The load's flat dock_price_per_lb (legacy / convenience override)
  //   3. The dock config's tier default (today's standing price for this band)
  //   4. Empty
  // Result: a fresh New Load opens pre-populated with whatever Cooper has
  // set as today's per-band rates in Dock Settings.
  function priceInput(id, label, bandPrice, dockPrice, configDefault) {
    var v = '';
    if (bandPrice != null && bandPrice !== '') v = bandPrice;
    else if (dockPrice != null && dockPrice !== '') v = dockPrice;
    else if (configDefault != null && configDefault !== '') v = configDefault;
    return '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:4px">' + label + '</label>'
      + '<input id="' + id + '" type="number" min="0" step="0.01" placeholder="—" value="' + v + '" oninput="fsLoadModalRecalc()" style="' + INP + '"></div>';
  }

  // Typing a dock price auto-fills every band-price input with it. Non-
  // destructive in the sense that the user can type over any individual band
  // afterwards; but repeatedly editing the dock price DOES overwrite band
  // overrides (matches how people actually use the convenience field).
  function fsLoadModalFillBandPrices() {
    var dock = document.getElementById('fs-l-price');
    if (!dock || dock.value === '') return;
    ['fs-l-p46', 'fs-l-p68', 'fs-l-p8p', 'fs-l-p04'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = dock.value;
    });
  }

  // Live recompute — Cooper's flow:
  //   Difference   = Truck − Plant       (display only; transit/scale variance)
  //   Deduction    = Σ five categories   (DOA + Shad + Turtles + Other + Fingerlings)
  //   Payable Lbs  = Plant − Deductions  (the lbs farmer gets paid for)
  //   Amount $     = Σ (band_lbs × band_price)  over all 4 bands
  //
  // The Net / 0–4 band auto-suggests Payable − (4-5.99 + 6-7.99 + 8+) but
  // user can override with a different number. All bands are PROCESSED fish
  // (not deducts, not transit loss).
  function fsLoadModalRecalc() {
    var getNum = function (id) {
      var el = document.getElementById(id);
      if (!el) return null;
      var v = el.value;
      if (v === '' || v == null) return null;
      var n = Number(v);
      return isNaN(n) ? null : n;
    };
    var truck = getNum('fs-l-truck');     // Truck Weight (gross_lbs on save)
    var plant = getNum('fs-l-plant');     // Plant Weight (net_lbs on save) — fish weight
    var diffField = document.getElementById('fs-l-diff');

    // Difference: pure display, always Truck − Plant when both present.
    var diff = (truck != null && plant != null) ? (truck - plant) : null;
    if (diffField) diffField.value = diff == null ? '' : diff;

    // Sum the 5 deduction categories.
    var dedDoa = getNum('fs-l-dedDoa') || 0;
    var dedShad = getNum('fs-l-dedShad') || 0;
    var dedTurtles = getNum('fs-l-dedTurtles') || 0;
    var dedOther = getNum('fs-l-dedOtherSpecies') || 0;
    var dedFinger = getNum('fs-l-dedFingerlings') || 0;
    var deduct = dedDoa + dedShad + dedTurtles + dedOther + dedFinger;
    var dedTotalEl = document.getElementById('fs-l-deduct-total');
    if (dedTotalEl) dedTotalEl.textContent = Number(deduct).toLocaleString();

    // Payable Lbs = Plant Weight − Deductions. This is what the farmer
    // gets paid for and the basis for the size-band remainder.
    var payLbs = (plant == null) ? null : Math.max(0, plant - deduct);

    var sz46 = getNum('fs-l-sz46') || 0;
    var sz68 = getNum('fs-l-sz68') || 0;
    var sz8p = getNum('fs-l-sz8p') || 0;

    // Net / 0–4 band: auto-suggest Payable − graded bands. If user typed a
    // value (it's a regular input now), respect that; otherwise auto-fill.
    var sz04El = document.getElementById('fs-l-sz04');
    var sz04Manual = getNum('fs-l-sz04');
    var sz04Auto = (payLbs == null) ? null : Math.max(0, payLbs - sz46 - sz68 - sz8p);
    var sz04 = sz04Manual != null ? sz04Manual : sz04Auto;
    if (sz04El && sz04Manual == null && sz04Auto != null) {
      sz04El.value = sz04Auto;
    }

    var p46 = getNum('fs-l-p46');
    var p68 = getNum('fs-l-p68');
    var p8p = getNum('fs-l-p8p');
    var p04 = getNum('fs-l-p04');

    // Amount = Σ (band_lbs × band_price) over all 4 bands.
    var amount = 0;
    var hasAny = false;
    if (p46 != null && sz46 > 0) { amount += sz46 * p46; hasAny = true; }
    if (p68 != null && sz68 > 0) { amount += sz68 * p68; hasAny = true; }
    if (p8p != null && sz8p > 0) { amount += sz8p * p8p; hasAny = true; }
    if (p04 != null && sz04 != null && sz04 > 0) { amount += sz04 * p04; hasAny = true; }
    var payTot = hasAny ? Math.round(amount * 100) / 100 : null;

    var paylbsEl = document.getElementById('fs-l-paylbs');
    var paytotEl = document.getElementById('fs-l-paytotal');
    if (paylbsEl) paylbsEl.value = payLbs == null ? '' : Number(payLbs).toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (paytotEl) paytotEl.value = payTot == null ? '' : '$' + Number(payTot).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Size-band reconciliation: bands should add up to Payable Lbs (within
    // tolerance — small rounding noise is fine).
    var bandSum = sz46 + sz68 + sz8p + (sz04 || 0);
    var warn = document.getElementById('fs-l-size-warn');
    if (warn) {
      if (bandSum > 0 && payLbs != null && Math.abs(bandSum - payLbs) > Math.max(50, payLbs * 0.02)) {
        warn.style.display = 'block';
        warn.textContent = '⚠️ Size bands sum to ' + Number(bandSum).toLocaleString() + ' lbs but payable is '
          + Number(payLbs).toLocaleString() + ' lbs (' + (bandSum > payLbs ? '+' : '') + Number(bandSum - payLbs).toLocaleString() + ').';
      } else {
        warn.style.display = 'none';
      }
    }
  }

  // Farmer change — filter delivery dropdown to just this farmer's
  // scheduled deliveries (plus current selection)
  function fsLoadModalRefreshDeliveries() {
    var farmerEl = document.getElementById('fs-l-farmer');
    var delEl = document.getElementById('fs-l-delivery');
    if (!farmerEl || !delEl) return;
    var farmerId = parseInt(farmerEl.value, 10);
    var currentId = parseInt(delEl.value, 10);

    var opts = '<option value="">— None —</option>';
    _fsState.deliveries.forEach(function (d) {
      if (farmerId && d.farmer_id !== farmerId && d.id !== currentId) return;
      var farmer = _fsState.farmers.find(function (f) { return f.id === d.farmer_id; });
      var farmerName = farmer ? farmer.name : '(unknown)';
      var label = d.day_date + ' ' + d.time_slot + ' · ' + farmerName
        + (d.expected_lbs ? ' · ' + Number(d.expected_lbs).toLocaleString() + ' lbs exp.' : '');
      opts += '<option value="' + d.id + '"' + (d.id === currentId ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    delEl.innerHTML = opts;
  }

  function fsSaveLoad(id) {
    var err = document.getElementById('fs-l-err');
    err.style.display = 'none';
    var val = function (sel) {
      var el = document.getElementById(sel);
      return el ? el.value : '';
    };

    var farmerId = val('fs-l-farmer');
    var dayDate = val('fs-l-date');
    if (!dayDate) { err.textContent = 'Day is required.'; err.style.display = 'block'; return; }
    if (!farmerId) { err.textContent = 'Farmer is required.'; err.style.display = 'block'; return; }

    // arrived_at / truck_ref / delivery_id were removed from the form per
    // Cooper's request. For NEW loads, stamp arrived_at = now() so the
    // invoice-number sequence has a stable per-day order (01, 02, 03...
    // in save order). For EDITS, preserve whatever the load already had
    // so the backend UPDATE doesn't null out existing values — pull from
    // _fsState.loads by id.
    var preserved = {};
    if (id) {
      var existing = _fsState.loads.find(function (x) { return x.id === id; });
      if (existing) {
        preserved.arrived_at = existing.arrived_at || null;
        preserved.truck_ref = existing.truck_ref || null;
        preserved.delivery_id = existing.delivery_id || null;
      }
    } else {
      preserved.arrived_at = new Date().toISOString();
      preserved.truck_ref = null;
      preserved.delivery_id = null;
    }
    var body = {
      day_date: dayDate,
      arrived_at: preserved.arrived_at,
      farmer_id: parseInt(farmerId, 10),
      pond_ref: val('fs-l-pond') || null,
      truck_ref: preserved.truck_ref,
      delivery_id: preserved.delivery_id,
      movement_ticket_number: val('fs-l-movticket') || null,
      // Schema mapping for Cooper's data model:
      //   Truck Weight  → gross_lbs (full truck on arrival)
      //   Plant Weight  → net_lbs   (fish weight at plant — used for payable
      //                              + invoice math everywhere downstream)
      // The legacy tare_lbs column is left null on new entries; existing
      // historical loads keep their old values untouched.
      gross_lbs: val('fs-l-truck') || null,
      tare_lbs: null,
      net_lbs: val('fs-l-plant') || null,
      // size_0_4_lbs is auto-computed server-side (net - graded bands);
      // we still send the readonly display value for debug/inspection.
      size_0_4_lbs: val('fs-l-sz04') || null,
      size_4_6_lbs: val('fs-l-sz46') || null,
      size_6_8_lbs: val('fs-l-sz68') || null,
      size_8_plus_lbs: val('fs-l-sz8p') || null,
      // Individual deduction categories — backend sums them into
      // deduction_lbs. We also send deduction_lbs=null so the backend
      // prefers the sum-of-categories path over any legacy total.
      deduction_lbs: null,
      deduction_reason: null,
      deduction_doa_lbs: val('fs-l-dedDoa') || null,
      deduction_shad_lbs: val('fs-l-dedShad') || null,
      deduction_turtles_lbs: val('fs-l-dedTurtles') || null,
      deduction_other_species_lbs: val('fs-l-dedOtherSpecies') || null,
      deduction_fingerlings_lbs: val('fs-l-dedFingerlings') || null,
      dock_price_per_lb: val('fs-l-price') || null,
      price_4_6_per_lb: val('fs-l-p46') || null,
      price_6_8_per_lb: val('fs-l-p68') || null,
      price_8_plus_per_lb: val('fs-l-p8p') || null,
      price_0_4_per_lb: val('fs-l-p04') || null,
      notes: val('fs-l-notes') || null
    };
    if (id) body.id = id;

    apiCall('POST', '/api/fish-schedule?action=save_load', body)
      .then(function () {
        document.getElementById('fs-modal').remove();
        toast(id ? 'Load saved' : 'Load added');
        fsLoadAndRenderIntake();
      })
      .catch(function (e) {
        err.textContent = e.message;
        err.style.display = 'block';
      });
  }

  // ═══ DOCK SETTINGS MODAL ═══════════════════════════════════════════════
  // Manager+ edits the company's active dock price profile: the four tier
  // labels, their min/max ranges, default $/lb, and the master dock on/off
  // toggle. Saved config feeds the Intake modal labels + price defaults.
  function fsOpenDockConfig() {
    if (!userCan('fishschedule', 'edit')) {
      toast('⚠️ Only managers can change dock settings');
      return;
    }
    // Ensure we have current config (might not be loaded yet on first paint)
    if (!_fsState.dockConfig) {
      loadDockConfig(function () { fsOpenDockConfig(); });
      return;
    }
    var c = _fsState.dockConfig;
    var existing = document.getElementById('fs-dock-modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'fs-dock-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px';

    var tierRow = function (n, label, min, max, price) {
      return '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1.2fr;gap:8px;align-items:end;margin-bottom:8px">'
        + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:3px">Tier ' + n + ' Label</label>'
        + '<input id="fs-dc-t' + n + '-label" type="text" value="' + esc(label || '') + '" placeholder="e.g., 4–5.99 lb" style="' + INP + '"></div>'
        + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:3px">Min Lbs</label>'
        + '<input id="fs-dc-t' + n + '-min" type="number" step="0.01" value="' + (min == null ? '' : min) + '" style="' + INP + '"></div>'
        + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:3px">Max Lbs <span style="color:#94a3b8;font-weight:400">(blank = no cap)</span></label>'
        + '<input id="fs-dc-t' + n + '-max" type="number" step="0.01" value="' + (max == null ? '' : max) + '" style="' + INP + '"></div>'
        + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:3px">Default $/lb</label>'
        + '<input id="fs-dc-t' + n + '-price" type="number" step="0.001" min="0" value="' + (price == null ? '' : price) + '" placeholder="—" style="' + INP + '"></div>'
        + '</div>';
    };

    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:22px;max-width:760px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:calc(100vh - 40px);overflow-y:auto">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'
      + '<div style="font-weight:800;font-size:1.1rem;color:#1a3a6b">⚙️ Dock Price Settings</div>'
      + '<div style="font-size:.7rem;color:#94a3b8">Last updated ' + (c.updated_at ? esc(String(c.updated_at).split('T')[0]) : 'never')
      + (c.updated_by ? ' by ' + esc(c.updated_by) : '') + '</div>'
      + '</div>'
      + '<div style="background:#f8fafc;border-radius:8px;padding:12px;margin-bottom:14px">'
      + '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:.88rem;font-weight:700;color:#1a3a6b">'
      + '<input id="fs-dc-active" type="checkbox" ' + (c.dock_active === false ? '' : 'checked') + ' style="width:18px;height:18px;cursor:pointer">'
      + '<span>Dock is active (buying fish)</span>'
      + '</label>'
      + '<div style="font-size:.72rem;color:#64748b;margin-left:28px;margin-top:4px">Uncheck to pause buying. A red banner shows on the Intake tab while off.</div>'
      + '</div>'
      + '<div style="font-size:.78rem;font-weight:700;color:#1a3a6b;margin-bottom:8px">Tier Configuration</div>'
      + '<div style="font-size:.72rem;color:#64748b;margin-bottom:10px">Edit each tier\'s label, size range, and default $/lb. Changes apply to all new loads. Existing loads keep whatever they were saved with.</div>'
      + tierRow(1, c.tier1_label, c.tier1_min_lbs, c.tier1_max_lbs, c.tier1_default_price)
      + tierRow(2, c.tier2_label, c.tier2_min_lbs, c.tier2_max_lbs, c.tier2_default_price)
      + tierRow(3, c.tier3_label, c.tier3_min_lbs, c.tier3_max_lbs, c.tier3_default_price)
      + tierRow(4, c.tier4_label, c.tier4_min_lbs, c.tier4_max_lbs, c.tier4_default_price)
      + '<div id="fs-dc-err" style="color:#ef4444;font-size:.78rem;margin-top:10px;display:none"></div>'
      + '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">'
      + '<button onclick="document.getElementById(\'fs-dock-modal\').remove()" style="' + BTN_SUB + ';padding:8px 14px">Cancel</button>'
      + '<button onclick="fsSaveDockConfig()" style="' + BTN_P + ';padding:8px 14px">Save Settings</button>'
      + '</div>'
      + '</div>';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }

  function fsSaveDockConfig() {
    var v = function (id) {
      var el = document.getElementById(id);
      return el ? el.value : '';
    };
    var body = {
      dock_active: document.getElementById('fs-dc-active').checked,
      tier1_label: v('fs-dc-t1-label'),
      tier1_min_lbs: v('fs-dc-t1-min'),
      tier1_max_lbs: v('fs-dc-t1-max'),
      tier1_default_price: v('fs-dc-t1-price'),
      tier2_label: v('fs-dc-t2-label'),
      tier2_min_lbs: v('fs-dc-t2-min'),
      tier2_max_lbs: v('fs-dc-t2-max'),
      tier2_default_price: v('fs-dc-t2-price'),
      tier3_label: v('fs-dc-t3-label'),
      tier3_min_lbs: v('fs-dc-t3-min'),
      tier3_max_lbs: v('fs-dc-t3-max'),
      tier3_default_price: v('fs-dc-t3-price'),
      tier4_label: v('fs-dc-t4-label'),
      tier4_min_lbs: v('fs-dc-t4-min'),
      tier4_max_lbs: v('fs-dc-t4-max'),
      tier4_default_price: v('fs-dc-t4-price')
    };
    var err = document.getElementById('fs-dc-err');
    apiCall('POST', '/api/fish-schedule?action=save_dock_config', body)
      .then(function (r) {
        _fsState.dockConfig = r.config;
        var m = document.getElementById('fs-dock-modal'); if (m) m.remove();
        toast('Dock settings saved');
        // Refresh the intake tab so labels + the on/off banner update
        if (_fsState.tab === 'intake') fsLoadAndRenderIntake();
      })
      .catch(function (e) {
        if (err) { err.textContent = e.message; err.style.display = 'block'; }
      });
  }

  function fsDeleteLoadFromModal(id) {
    if (!confirm('Delete this load record?')) return;
    apiCall('POST', '/api/fish-schedule?action=delete_load', { id: id })
      .then(function () {
        var m = document.getElementById('fs-modal'); if (m) m.remove();
        toast('Load deleted');
        fsLoadAndRenderIntake();
      })
      .catch(function (err) { toast('⚠️ ' + err.message); });
  }

  // ═══ FISH PAYABLE TAB ══════════════════════════════════════════════════
  // Per-load invoice rollup mirroring the yield master FISH PAYABLE TOTAL
  // sheet. Columns (Excel-exact):
  //   Farmer · Invoice # · Date · Gross · Deduct ·
  //   4-5.99 Lbs+Price · 6-7.99 Lbs+Price · 8+ Lbs+Price ·
  //   Net (0-4 remainder) Lbs+Price · Amount
  //
  // One row per load. Weekly totals at the bottom. Printable via the shared
  // printReport() helper.
  function fsLoadAndRenderPayable() {
    var panel = document.getElementById('widget-content');
    panel.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner-wrap"><div class="spinner"></div></div>Loading invoice…</div>';
    apiCall('GET', '/api/fish-schedule?action=get_payable&week_start=' + _fsState.weekStart)
      .then(function (r) {
        _fsState.payable = r;
        fsRenderPayable();
      })
      .catch(function (err) {
        panel.innerHTML = '<div style="padding:20px;color:#ef4444">Failed to load: ' + esc(err.message) + '</div>';
      });
  }

  function fsRenderPayable() {
    var panel = document.getElementById('widget-content');
    if (!panel) return;
    var p = _fsState.payable || {};
    var rows = p.rows || [];

    var html = '<div style="padding:14px;max-width:100%;margin:0 auto">';

    // Header: nav + range + print
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;background:#fff;border-radius:10px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<button style="' + BTN_SUB + '" onclick="fsWeekNavPayable(-1)">← Prev</button>'
      + '<button style="' + BTN_SUB + '" onclick="fsGoTodayPayable()">This Week</button>'
      + '<button style="' + BTN_SUB + '" onclick="fsWeekNavPayable(1)">Next →</button>'
      + '<div style="flex:1;font-weight:700;color:#1a3a6b;font-size:1rem;margin-left:12px">'
      + prettyRange(_fsState.weekStart) + '</div>'
      + '<button onclick="fsPrintPayable()" style="' + BTN_SUB + '">🖨️ Print</button>'
      + '</div>';

    if (rows.length === 0) {
      html += '<div style="background:#fff;border-radius:10px;padding:40px 20px;text-align:center;color:#94a3b8;font-size:.88rem;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
        + 'No intake loads recorded this week. Add loads in the <strong>🐟 Intake</strong> tab and they\'ll invoice here automatically.'
        + '</div>';
      html += '</div>';
      panel.innerHTML = html;
      return;
    }

    // Totals accumulator
    var totals = {
      gross: 0, deduct: 0, net: 0,
      sz46: 0, sz68: 0, sz8p: 0, sz04: 0,
      amt46: 0, amt68: 0, amt8p: 0, amt04: 0,
      amount: 0
    };

    html += '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow-x:auto">'
      + '<table class="fp-table" style="width:100%;border-collapse:collapse;font-size:.78rem;min-width:1200px">'
      + '<thead><tr style="background:#1a3a6b;color:#fff">'
      + '<th style="padding:8px 10px;text-align:left">Farmer</th>'
      + '<th style="padding:8px 10px;text-align:left">Invoice #</th>'
      + '<th style="padding:8px 10px;text-align:center">Date</th>'
      + '<th style="padding:8px 10px;text-align:right">Gross Lbs</th>'
      + '<th style="padding:8px 10px;text-align:right">Deduct</th>'
      + '<th style="padding:8px 10px;text-align:right;background:#0891b2">' + esc(dockConfig().tier2_label) + ' Lbs</th>'
      + '<th style="padding:8px 10px;text-align:right;background:#0891b2">Price</th>'
      + '<th style="padding:8px 10px;text-align:right;background:#059669">' + esc(dockConfig().tier3_label) + ' Lbs</th>'
      + '<th style="padding:8px 10px;text-align:right;background:#059669">Price</th>'
      + '<th style="padding:8px 10px;text-align:right;background:#ca8a04">' + esc(dockConfig().tier4_label) + ' Lbs</th>'
      + '<th style="padding:8px 10px;text-align:right;background:#ca8a04">Price</th>'
      + '<th style="padding:8px 10px;text-align:right;background:#0369a1">' + esc(dockConfig().tier1_label) + ' Lbs</th>'
      + '<th style="padding:8px 10px;text-align:right;background:#0369a1">Price</th>'
      + '<th style="padding:8px 10px;text-align:right;background:#065f46">Amount</th>'
      + '</tr></thead><tbody>';

    rows.forEach(function (r, i) {
      var striped = (i % 2 === 1) ? 'background:#f8fafc' : '';
      var dateCell = r.day_date ? prettyDate(r.day_date) : '—';
      var farmerName = r.farmer_name || '(unknown)';
      var color = r.farmer_color || '#1a3a6b';

      var gross = Number(r.gross_lbs) || 0;
      var deduct = Number(r.deduction_lbs) || 0;
      var net = Number(r.net_lbs) || 0;
      var sz46 = Number(r.size_4_6_lbs) || 0;
      var sz68 = Number(r.size_6_8_lbs) || 0;
      var sz8p = Number(r.size_8_plus_lbs) || 0;
      var sz04 = Number(r.size_0_4_lbs) || 0;
      var p46 = Number(r.price_4_6_per_lb);
      var p68 = Number(r.price_6_8_per_lb);
      var p8p = Number(r.price_8_plus_per_lb);
      var p04 = Number(r.price_0_4_per_lb);
      var amt = Number(r.payable_total) || 0;

      totals.gross += gross;
      totals.deduct += deduct;
      totals.net += net;
      totals.sz46 += sz46; totals.sz68 += sz68; totals.sz8p += sz8p; totals.sz04 += sz04;
      if (!isNaN(p46) && sz46 > 0) totals.amt46 += sz46 * p46;
      if (!isNaN(p68) && sz68 > 0) totals.amt68 += sz68 * p68;
      if (!isNaN(p8p) && sz8p > 0) totals.amt8p += sz8p * p8p;
      if (!isNaN(p04) && sz04 > 0) totals.amt04 += sz04 * p04;
      totals.amount += amt;

      html += '<tr style="border-bottom:1px solid #f1f5f9;' + striped + '">'
        + '<td style="padding:7px 10px;font-weight:600"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + esc(color) + ';margin-right:6px"></span>' + esc(farmerName) + '</td>'
        + '<td style="padding:7px 10px;font-family:monospace;color:#1a3a6b">' + esc(r.invoice_number || '—') + '</td>'
        + '<td style="padding:7px 10px;text-align:center;color:#64748b">' + dateCell + '</td>'
        + '<td style="padding:7px 10px;text-align:right">' + fmtN(gross) + '</td>'
        + '<td style="padding:7px 10px;text-align:right;color:#991b1b">' + (deduct > 0 ? fmtN(deduct) : '—') + '</td>'
        + '<td style="padding:7px 10px;text-align:right">' + (sz46 > 0 ? fmtN(sz46) : '—') + '</td>'
        + '<td style="padding:7px 10px;text-align:right">' + (isFinite(p46) && !isNaN(p46) ? fmt$(p46) : '—') + '</td>'
        + '<td style="padding:7px 10px;text-align:right">' + (sz68 > 0 ? fmtN(sz68) : '—') + '</td>'
        + '<td style="padding:7px 10px;text-align:right">' + (isFinite(p68) && !isNaN(p68) ? fmt$(p68) : '—') + '</td>'
        + '<td style="padding:7px 10px;text-align:right">' + (sz8p > 0 ? fmtN(sz8p) : '—') + '</td>'
        + '<td style="padding:7px 10px;text-align:right">' + (isFinite(p8p) && !isNaN(p8p) ? fmt$(p8p) : '—') + '</td>'
        + '<td style="padding:7px 10px;text-align:right">' + (sz04 > 0 ? fmtN(sz04) : '—') + '</td>'
        + '<td style="padding:7px 10px;text-align:right">' + (isFinite(p04) && !isNaN(p04) ? fmt$(p04) : '—') + '</td>'
        + '<td style="padding:7px 10px;text-align:right;color:#065f46;font-weight:700">' + (amt > 0 ? fmtMoney(amt) : '—') + '</td>'
        + '</tr>';
    });

    // Totals row — weighted averages for prices (amount_band / lbs_band)
    var wp46 = totals.sz46 > 0 ? totals.amt46 / totals.sz46 : null;
    var wp68 = totals.sz68 > 0 ? totals.amt68 / totals.sz68 : null;
    var wp8p = totals.sz8p > 0 ? totals.amt8p / totals.sz8p : null;
    var wp04 = totals.sz04 > 0 ? totals.amt04 / totals.sz04 : null;
    html += '<tr style="background:#e0e7ff;font-weight:700;border-top:3px double #1a3a6b">'
      + '<td style="padding:9px 10px;color:#1a3a6b" colspan="3">WEEKLY TOTAL (' + rows.length + ' load' + (rows.length === 1 ? '' : 's') + ')</td>'
      + '<td style="padding:9px 10px;text-align:right;color:#1a3a6b">' + fmtN(totals.gross) + '</td>'
      + '<td style="padding:9px 10px;text-align:right;color:#991b1b">' + fmtN(totals.deduct) + '</td>'
      + '<td style="padding:9px 10px;text-align:right">' + fmtN(totals.sz46) + '</td>'
      + '<td style="padding:9px 10px;text-align:right;font-weight:500;color:#475569">' + (wp46 != null ? fmt$(wp46) : '—') + '</td>'
      + '<td style="padding:9px 10px;text-align:right">' + fmtN(totals.sz68) + '</td>'
      + '<td style="padding:9px 10px;text-align:right;font-weight:500;color:#475569">' + (wp68 != null ? fmt$(wp68) : '—') + '</td>'
      + '<td style="padding:9px 10px;text-align:right">' + fmtN(totals.sz8p) + '</td>'
      + '<td style="padding:9px 10px;text-align:right;font-weight:500;color:#475569">' + (wp8p != null ? fmt$(wp8p) : '—') + '</td>'
      + '<td style="padding:9px 10px;text-align:right">' + fmtN(totals.sz04) + '</td>'
      + '<td style="padding:9px 10px;text-align:right;font-weight:500;color:#475569">' + (wp04 != null ? fmt$(wp04) : '—') + '</td>'
      + '<td style="padding:9px 10px;text-align:right;color:#065f46;font-size:.92rem">' + fmtMoney(totals.amount) + '</td>'
      + '</tr>';

    html += '</tbody></table></div>';
    html += '<div style="font-size:.72rem;color:#94a3b8;margin-top:8px;font-style:italic">'
      + 'Column prices show the dock price per band for each load. Weekly total price columns show volume-weighted averages. '
      + '"Net Lbs" is the 0–4 lb remainder auto-computed from net minus the three graded bands.'
      + '</div>';
    html += '</div>';
    panel.innerHTML = html;
  }

  function fsWeekNavPayable(delta) {
    _fsState.weekStart = addDaysIso(_fsState.weekStart, delta * 7);
    fsLoadAndRenderPayable();
  }
  function fsGoTodayPayable() {
    _fsState.weekStart = weekStartOf();
    fsLoadAndRenderPayable();
  }

  // Payable-tab formatting helpers. fmtMoney is already defined earlier
  // in the file (Phase B) — we reuse it rather than redefine.
  function fmtN(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function fmt$(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    return '$' + Number(n).toFixed(3);
  }
  function prettyDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Build a printable HTML blob from the current payable state and hand it
  // to printReport(). Matches the in-app table but with a cleaner print-
  // friendly palette (black/white).
  function fsPrintPayable() {
    var p = _fsState.payable || {};
    var rows = p.rows || [];
    if (rows.length === 0) { toast('⚠️ No invoice data to print'); return; }
    var periodStr = prettyRange(_fsState.weekStart);
    var title = 'Fish Payable — ' + periodStr;
    var body = '<p style="margin-bottom:14px;color:#64748b">Period: <strong>' + esc(periodStr) + '</strong></p>';
    var dc = dockConfig();
    body += '<table><thead><tr>'
      + '<th>Farmer</th><th>Invoice #</th><th>Date</th>'
      + '<th>Gross Lbs</th><th>Deduct</th>'
      + '<th>' + esc(dc.tier2_label) + ' Lbs</th><th>Price</th>'
      + '<th>' + esc(dc.tier3_label) + ' Lbs</th><th>Price</th>'
      + '<th>' + esc(dc.tier4_label) + ' Lbs</th><th>Price</th>'
      + '<th>' + esc(dc.tier1_label) + ' Lbs</th><th>Price</th>'
      + '<th>Amount</th>'
      + '</tr></thead><tbody>';
    var t = { gross: 0, deduct: 0, net: 0, sz46: 0, sz68: 0, sz8p: 0, sz04: 0, amount: 0 };
    rows.forEach(function (r) {
      var gross = Number(r.gross_lbs) || 0;
      var deduct = Number(r.deduction_lbs) || 0;
      var net = Number(r.net_lbs) || 0;
      var sz46 = Number(r.size_4_6_lbs) || 0;
      var sz68 = Number(r.size_6_8_lbs) || 0;
      var sz8p = Number(r.size_8_plus_lbs) || 0;
      var sz04 = Number(r.size_0_4_lbs) || 0;
      var p46 = Number(r.price_4_6_per_lb);
      var p68 = Number(r.price_6_8_per_lb);
      var p8p = Number(r.price_8_plus_per_lb);
      var p04 = Number(r.price_0_4_per_lb);
      var amt = Number(r.payable_total) || 0;
      t.gross += gross; t.deduct += deduct; t.net += net;
      t.sz46 += sz46; t.sz68 += sz68; t.sz8p += sz8p; t.sz04 += sz04;
      t.amount += amt;
      body += '<tr>'
        + '<td>' + esc(r.farmer_name || '—') + '</td>'
        + '<td>' + esc(r.invoice_number || '—') + '</td>'
        + '<td>' + (r.day_date ? prettyDate(r.day_date) : '—') + '</td>'
        + '<td>' + fmtN(gross) + '</td>'
        + '<td>' + (deduct > 0 ? fmtN(deduct) : '—') + '</td>'
        + '<td>' + (sz46 > 0 ? fmtN(sz46) : '—') + '</td>'
        + '<td>' + (!isNaN(p46) ? fmt$(p46) : '—') + '</td>'
        + '<td>' + (sz68 > 0 ? fmtN(sz68) : '—') + '</td>'
        + '<td>' + (!isNaN(p68) ? fmt$(p68) : '—') + '</td>'
        + '<td>' + (sz8p > 0 ? fmtN(sz8p) : '—') + '</td>'
        + '<td>' + (!isNaN(p8p) ? fmt$(p8p) : '—') + '</td>'
        + '<td>' + (sz04 > 0 ? fmtN(sz04) : '—') + '</td>'
        + '<td>' + (!isNaN(p04) ? fmt$(p04) : '—') + '</td>'
        + '<td>' + (amt > 0 ? fmtMoney(amt) : '—') + '</td>'
        + '</tr>';
    });
    body += '<tr style="background:#e0e7ff;font-weight:700"><td colspan="3">WEEKLY TOTAL</td>'
      + '<td>' + fmtN(t.gross) + '</td><td>' + fmtN(t.deduct) + '</td>'
      + '<td>' + fmtN(t.sz46) + '</td><td>—</td>'
      + '<td>' + fmtN(t.sz68) + '</td><td>—</td>'
      + '<td>' + fmtN(t.sz8p) + '</td><td>—</td>'
      + '<td>' + fmtN(t.sz04) + '</td><td>—</td>'
      + '<td>' + fmtMoney(t.amount) + '</td></tr>';
    body += '</tbody></table>';
    if (typeof printReport === 'function') {
      printReport(title, body);
    } else {
      toast('⚠️ Print helper not loaded');
    }
  }

  // ═══ FARMERS TAB ═══════════════════════════════════════════════════════
  function fsLoadAndRenderFarmers() {
    var panel = document.getElementById('widget-content');
    panel.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner-wrap"><div class="spinner"></div></div>Loading farmers…</div>';
    apiCall('GET', '/api/fish-schedule?action=get_state&week_start=' + _fsState.weekStart)
      .then(function (r) {
        _fsState.farmers = r.farmers || [];
        fsRenderFarmers();
      })
      .catch(function (err) {
        panel.innerHTML = '<div style="padding:20px;color:#ef4444">Failed to load: ' + esc(err.message) + '</div>';
      });
  }

  function fsRenderFarmers() {
    var panel = document.getElementById('widget-content');
    var canCreate = (typeof userCan === 'function') && userCan('fishschedule', 'create');
    var canEdit = (typeof userCan === 'function') && userCan('fishschedule', 'edit');
    var canDelete = (typeof userCan === 'function') && userCan('fishschedule', 'delete');

    var html = '<div style="padding:14px;max-width:720px;margin:0 auto">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap">'
      + '<div style="font-weight:700;color:#1a3a6b;font-size:1rem">🚜 Farmers / Live Haulers</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
      + (canCreate ? '<button style="' + BTN_SUB + '" onclick="fsImportFlvFarmers()" title="Copy farmers from the Flavor Sample widget">📥 Import from Flavor</button>' : '')
      + (canCreate ? '<button style="' + BTN_P + '" onclick="fsEditFarmer(null)">+ Add Farmer</button>' : '')
      + '</div>'
      + '</div>';

    if (_fsState.farmers.length === 0) {
      html += '<div style="background:#fef3c7;border:1px solid #fde68a;padding:14px;border-radius:8px;color:#92400e;font-size:.86rem">'
        + 'No farmers yet. Add your live haulers (Battle Fish North, Adams Lane, DREC, etc.) so you can schedule deliveries.'
        + '</div>';
    } else {
      html += '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden">';
      _fsState.farmers.forEach(function (f, i) {
        html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;' + (i > 0 ? 'border-top:1px solid #f1f5f9' : '') + '">'
          + '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + esc(f.color || '#1a3a6b') + ';flex-shrink:0"></span>'
          + '<div style="flex:1;font-weight:600;color:#0f172a;font-size:.88rem">' + esc(f.name) + '</div>'
          + (f.notes ? '<div style="font-size:.74rem;color:#64748b;margin-right:8px">' + esc(f.notes) + '</div>' : '')
          + (canEdit ? '<button style="' + BTN_SUB + ';padding:4px 10px;font-size:.74rem" onclick="fsEditFarmer(' + f.id + ')">Edit</button>' : '')
          + (canDelete ? '<button style="' + BTN_D + ';margin-left:4px" onclick="fsDeleteFarmer(' + f.id + ',\'' + esc(f.name).replace(/'/g, '') + '\')">Remove</button>' : '')
          + '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    panel.innerHTML = html;
  }

  function fsEditFarmer(id) {
    var f = id ? _fsState.farmers.find(function (x) { return x.id === id; }) : null;
    var isEdit = !!f;

    var overlay = document.createElement('div');
    overlay.id = 'fs-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    var colors = ['#1a3a6b', '#0369a1', '#0891b2', '#059669', '#ca8a04', '#ea580c', '#dc2626', '#7c3aed', '#be185d'];
    var swatchHtml = colors.map(function (c) {
      var selStyle = (f && f.color === c) ? 'border:3px solid #0f172a' : 'border:2px solid #fff';
      return '<button type="button" data-color="' + c + '" onclick="document.getElementById(\'fs-fm-color\').value=\'' + c + '\';document.querySelectorAll(\'[data-color]\').forEach(function(b){b.style.border=\'2px solid #fff\'});this.style.border=\'3px solid #0f172a\'" style="width:30px;height:30px;border-radius:50%;background:' + c + ';cursor:pointer;' + selStyle + '"></button>';
    }).join('');

    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:20px;max-width:420px;width:100%">'
      + '<div style="font-weight:700;color:#1a3a6b;font-size:1.05rem;margin-bottom:12px">' + (isEdit ? '✎ Edit Farmer' : '+ New Farmer') + '</div>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Name</label>'
      + '<input id="fs-fm-name" type="text" placeholder="e.g., Battle Fish North" value="' + esc(f ? f.name : '') + '" style="' + INP + '">'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:10px 0 4px">Color</label>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">' + swatchHtml + '</div>'
      + '<input id="fs-fm-color" type="hidden" value="' + esc(f ? f.color : '#1a3a6b') + '">'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:10px 0 4px">Notes <span style="font-weight:400;color:#94a3b8">(optional)</span></label>'
      + '<input id="fs-fm-notes" type="text" placeholder="e.g., primary supplier, contact James" value="' + esc(f ? f.notes : '') + '" style="' + INP + '">'
      + '<div id="fs-fm-err" style="color:#ef4444;font-size:.78rem;margin-top:8px;display:none"></div>'
      + '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">'
      + '<button style="' + BTN_SUB + ';padding:8px 14px" onclick="document.getElementById(\'fs-modal\').remove()">Cancel</button>'
      + '<button style="' + BTN_P + ';padding:8px 14px" onclick="fsSaveFarmer(' + (id || 'null') + ')">Save</button>'
      + '</div>'
      + '</div>';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    setTimeout(function () { var el = document.getElementById('fs-fm-name'); if (el) el.focus(); }, 80);
  }

  function fsSaveFarmer(id) {
    var name = document.getElementById('fs-fm-name').value.trim();
    var color = document.getElementById('fs-fm-color').value;
    var notes = document.getElementById('fs-fm-notes').value.trim();
    var err = document.getElementById('fs-fm-err');
    err.style.display = 'none';
    if (!name) {
      err.textContent = 'Name is required.';
      err.style.display = 'block';
      return;
    }
    var body = { name: name, color: color, notes: notes || null };
    if (id) body.id = id;
    apiCall('POST', '/api/fish-schedule?action=save_farmer', body)
      .then(function () {
        document.getElementById('fs-modal').remove();
        toast(id ? 'Saved' : 'Farmer added');
        fsLoadAndRenderFarmers();
      })
      .catch(function (e) {
        err.textContent = e.message;
        err.style.display = 'block';
      });
  }

  // One-click copy of non-archived flavor farmers into the schedule's farmer
  // list. Dedupe by case-insensitive name. Confirms first so Cooper sees the
  // count before it runs.
  function fsImportFlvFarmers() {
    if (!confirm('Copy all farmers from the Flavor Sample widget into the Live Fish scheduler?\n\nExisting farmers with the same name will be skipped. You can edit colors and notes after import.')) return;
    apiCall('POST', '/api/fish-schedule?action=import_flv_farmers', {})
      .then(function (r) {
        var msg = '';
        if (r.imported === 0 && r.total_flv === 0) {
          msg = 'No farmers found on the Flavor Sample widget.';
        } else if (r.imported === 0) {
          msg = 'All ' + r.total_flv + ' farmer' + (r.total_flv === 1 ? '' : 's') + ' already exist — nothing to import.';
        } else {
          msg = 'Imported ' + r.imported + ' farmer' + (r.imported === 1 ? '' : 's')
            + (r.skipped ? ' (' + r.skipped + ' skipped as duplicates)' : '') + '.';
        }
        toast(msg);
        fsLoadAndRenderFarmers();
      })
      .catch(function (err) { toast('⚠️ ' + err.message); });
  }

  function fsDeleteFarmer(id, name) {
    if (!confirm('Remove ' + (name || 'this farmer') + '? Historical deliveries stay intact, but they won\'t appear in the farmer dropdown for new deliveries.')) return;
    apiCall('POST', '/api/fish-schedule?action=delete_farmer', { id: id })
      .then(function () { toast('Removed'); fsLoadAndRenderFarmers(); })
      .catch(function (err) { toast('⚠️ ' + err.message); });
  }

  // Expose globally for inline onclick handlers
  window.buildFishScheduleWidget = buildFishScheduleWidget;
  window.fsShowTab = fsShowTab;
  window.fsWeekNav = fsWeekNav;
  window.fsGoToday = fsGoToday;
  window.fsToggleNoKill = fsToggleNoKill;
  window.fsAddDelivery = fsAddDelivery;
  window.fsEditDelivery = fsEditDelivery;
  window.fsDeleteDelivery = fsDeleteDelivery;
  window.fsSaveDelivery = fsSaveDelivery;
  window.fsDeleteFromModal = fsDeleteFromModal;
  window.fsEditFarmer = fsEditFarmer;
  window.fsSaveFarmer = fsSaveFarmer;
  window.fsDeleteFarmer = fsDeleteFarmer;
  window.fsImportFlvFarmers = fsImportFlvFarmers;
  // Intake (Phase B)
  window.fsWeekNavIntake = fsWeekNavIntake;
  window.fsGoTodayIntake = fsGoTodayIntake;
  window.fsAddLoad = fsAddLoad;
  window.fsEditLoad = fsEditLoad;
  window.fsDeleteLoad = fsDeleteLoad;
  window.fsSaveLoad = fsSaveLoad;
  window.fsDeleteLoadFromModal = fsDeleteLoadFromModal;
  window.fsLoadModalRecalc = fsLoadModalRecalc;
  window.fsLoadModalRefreshDeliveries = fsLoadModalRefreshDeliveries;
  window.fsLoadModalFillBandPrices = fsLoadModalFillBandPrices;
  // Dock config (manager+ only — backend enforces, frontend hides button)
  window.fsOpenDockConfig = fsOpenDockConfig;
  window.fsSaveDockConfig = fsSaveDockConfig;
  // Fish Payable (invoice rollup)
  window.fsWeekNavPayable = fsWeekNavPayable;
  window.fsGoTodayPayable = fsGoTodayPayable;
  window.fsPrintPayable = fsPrintPayable;
})();
