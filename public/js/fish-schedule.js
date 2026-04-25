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
    // Per-farmer pond options sourced from the Flavor Sample widget's pond
    // tables, matched by farmer name (case-insensitive). Populated by
    // get_intake. Shape: { [farmerId]: [{group, number, label}, ...] }
    farmerPonds: {},
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

  // Build <option> HTML for a farmer's pond dropdown. Sourced from the
  // Flavor Sample widget's pond data (per-farmer, name-matched in get_intake).
  // Always includes:
  //   - "— Pick pond —" placeholder (selected when nothing's chosen)
  //   - The current value as a custom-tagged option if it doesn't match any
  //     flavor pond (so editing old loads doesn't drop their pond_ref)
  //   - "Other / Type custom..." sentinel that lets the user override
  function pondSelectOptions(farmerId, currentValue) {
    var ponds = (farmerId && _fsState.farmerPonds[farmerId]) || [];
    var current = currentValue || '';
    var labels = ponds.map(function (p) { return p.label; });
    var inList = labels.indexOf(current) >= 0;
    var html = '<option value="">— Pick pond —</option>';
    if (current && !inList) {
      // Preserve historical free-text values (loads created before this
      // change). Tag as "(custom)" so the operator knows it's not from the
      // flavor list.
      html += '<option value="' + esc(current) + '" selected>' + esc(current) + ' (custom)</option>';
    }
    if (ponds.length === 0 && !current) {
      html += '<option value="" disabled>(no ponds set up — add in Flavor Sample › Farms &amp; Ponds)</option>';
    }
    ponds.forEach(function (p) {
      var sel = (current === p.label) ? ' selected' : '';
      html += '<option value="' + esc(p.label) + '"' + sel + '>' + esc(p.label) + '</option>';
    });
    return html;
  }
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
        _fsState.farmerPonds = r.farmer_ponds || {};
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

    // Header: nav + range + bulk-entry + dock-config buttons
    var canEditDock = (typeof userCan === 'function') && userCan('fishschedule', 'edit');
    var canCreate2 = (typeof userCan === 'function') && userCan('fishschedule', 'create');
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;background:#fff;border-radius:10px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<button style="' + BTN_SUB + '" onclick="fsWeekNavIntake(-1)">← Prev</button>'
      + '<button style="' + BTN_SUB + '" onclick="fsGoTodayIntake()">This Week</button>'
      + '<button style="' + BTN_SUB + '" onclick="fsWeekNavIntake(1)">Next →</button>'
      + '<div style="flex:1;font-weight:700;color:#1a3a6b;font-size:1rem;margin-left:12px">'
      + prettyRange(_fsState.weekStart) + '</div>'
      + (canCreate2 ? '<button style="' + BTN_P + '" onclick="fsOpenBulkWizard()">🚀 Bulk Entry (1·2·3)</button>' : '')
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
      + '<select id="fs-l-farmer" onchange="fsLoadModalRefreshPonds()" style="' + INP + '">' + farmerOpts + '</select></div>'
      + '<div><label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin-bottom:4px">Pond <span style="color:#94a3b8;font-weight:400;font-size:.66rem">(from Flavor)</span></label>'
      + '<select id="fs-l-pond" style="' + INP + '">' + pondSelectOptions(initial.farmer_id, initial.pond_ref) + '</select></div>'
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
      // Tier1 → tier4 (smallest → largest). Same order as the Pricing row
      // below so each lbs input lines up vertically with its own $/lb input.
      + sizeInput('fs-l-sz04', dockConfig().tier1_label, initial.size_0_4_lbs)
      + sizeInput('fs-l-sz46', dockConfig().tier2_label, initial.size_4_6_lbs)
      + sizeInput('fs-l-sz68', dockConfig().tier3_label, initial.size_6_8_lbs)
      + sizeInput('fs-l-sz8p', dockConfig().tier4_label, initial.size_8_plus_lbs)
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

      // Pricing — one $/lb input per tier, ordered tier1 → tier4 (smallest
      // to largest). Values display as currency ($1.30 / $0.85 / etc) and
      // pre-fill from the dock config defaults. The legacy single "Dock
      // Price" convenience field was removed once dock config landed —
      // per-tier defaults make it redundant.
      + '<div style="background:' + (dockConfig().dock_active === false ? '#fef2f2' : '#ecfdf5') + ';border-radius:8px;padding:12px;margin-bottom:10px">'
      + '<div style="font-size:.78rem;font-weight:700;color:' + (dockConfig().dock_active === false ? '#991b1b' : '#065f46') + ';margin-bottom:8px">💰 Pricing '
      + (dockConfig().dock_active === false
          ? '<span style="font-weight:700;color:#991b1b">— DOCK OFF</span>'
          : '<span style="color:#94a3b8;font-weight:400;font-size:.72rem">($/lb per band — fills from dock config defaults)</span>')
      + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:8px">'
      + priceInput('fs-l-p04', dockConfig().tier1_label + ' $/lb', initial.price_0_4_per_lb, initial.dock_price_per_lb, dockConfig().tier1_default_price)
      + priceInput('fs-l-p46', dockConfig().tier2_label + ' $/lb', initial.price_4_6_per_lb, initial.dock_price_per_lb, dockConfig().tier2_default_price)
      + priceInput('fs-l-p68', dockConfig().tier3_label + ' $/lb', initial.price_6_8_per_lb, initial.dock_price_per_lb, dockConfig().tier3_default_price)
      + priceInput('fs-l-p8p', dockConfig().tier4_label + ' $/lb', initial.price_8_plus_per_lb, initial.dock_price_per_lb, dockConfig().tier4_default_price)
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
  // Displayed as currency ($1.30, $0.85, $0.00...). On focus we strip back
  // to the bare number for clean editing; on blur we reformat. Currency
  // formatting is purely cosmetic — fsLoadModalRecalc / fsSaveLoad both
  // run values through parseCurrency() before doing math.
  function priceInput(id, label, bandPrice, dockPrice, configDefault) {
    var v = null;
    if (bandPrice != null && bandPrice !== '') v = Number(bandPrice);
    else if (dockPrice != null && dockPrice !== '') v = Number(dockPrice);
    else if (configDefault != null && configDefault !== '') v = Number(configDefault);
    var display = (v != null && !isNaN(v)) ? formatCurrency(v) : '';
    return '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:4px">' + label + '</label>'
      + '<input id="' + id + '" type="text" inputmode="decimal" placeholder="$0.00" value="' + display + '"'
      + ' onfocus="fsCurrencyFocus(this)" onblur="fsCurrencyBlur(this);fsLoadModalRecalc()" oninput="fsLoadModalRecalc()"'
      + ' style="' + INP + '"></div>';
  }

  // Format a raw number as $X.XX (always 2 decimals).
  function formatCurrency(n) {
    if (n == null || n === '' || isNaN(n)) return '';
    return '$' + Number(n).toFixed(2);
  }
  // Parse "$1.30" / "1.30" / "  $1.3  " → 1.3 (number). Returns null if blank
  // or unparseable. Tolerant of stray whitespace and the $ being optional.
  function parseCurrency(s) {
    if (s == null) return null;
    var clean = String(s).replace(/[$,\s]/g, '').trim();
    if (clean === '') return null;
    var n = Number(clean);
    return isNaN(n) ? null : n;
  }
  // On focus: strip the "$" so the user types raw digits without fighting
  // the dollar sign. We hold off on validation here.
  function fsCurrencyFocus(el) {
    if (!el) return;
    el.value = String(el.value).replace(/[$,\s]/g, '');
    setTimeout(function () { try { el.select(); } catch (e) {} }, 0);
  }
  // On blur: re-format whatever the user left in the field. Empty stays
  // empty; anything parseable becomes "$X.XX".
  function fsCurrencyBlur(el) {
    if (!el) return;
    var n = parseCurrency(el.value);
    el.value = n == null ? '' : formatCurrency(n);
  }

  // Legacy no-op kept for any cached page that still has the old "Dock
  // Price" convenience field hooked to it. The field was removed once
  // dock-config defaults landed; per-tier prices are entered individually.
  function fsLoadModalFillBandPrices() { /* removed in dock-config UX pass */ }

  // Refresh the Pond dropdown when the user changes the Farmer selection.
  // Resets the pond selection (different farmer = different pond list);
  // operator picks again from the new farmer's ponds.
  function fsLoadModalRefreshPonds() {
    var farmerEl = document.getElementById('fs-l-farmer');
    var pondEl = document.getElementById('fs-l-pond');
    if (!farmerEl || !pondEl) return;
    var farmerId = parseInt(farmerEl.value, 10) || null;
    pondEl.innerHTML = pondSelectOptions(farmerId, '');
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

    // Price inputs display as currency ($1.30) so we parse with currency
    // helper instead of raw getNum.
    var getCur = function (id) {
      var el = document.getElementById(id);
      return el ? parseCurrency(el.value) : null;
    };
    var p46 = getCur('fs-l-p46');
    var p68 = getCur('fs-l-p68');
    var p8p = getCur('fs-l-p8p');
    var p04 = getCur('fs-l-p04');

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
      // Dock Price convenience field was removed; dock_price_per_lb is no
      // longer entered directly. Per-band prices are parsed from currency-
      // formatted text inputs (e.g., "$1.30") via parseCurrency.
      dock_price_per_lb: null,
      price_4_6_per_lb: parseCurrency(val('fs-l-p46')),
      price_6_8_per_lb: parseCurrency(val('fs-l-p68')),
      price_8_plus_per_lb: parseCurrency(val('fs-l-p8p')),
      price_0_4_per_lb: parseCurrency(val('fs-l-p04')),
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

  // ═══ BULK ENTRY WIZARD (Step 1 → 2 → 3) ════════════════════════════════
  // Cooper's data-entry flow has three stages, each happening at a
  // different point in the day:
  //
  //   Step 1 RECEIVING   — trucks arrive, get weighed, ticket logged.
  //                        Bulk-add multiple rows (one per truck).
  //   Step 2 DEDUCTIONS  — fish are inspected; bad ones (DOA, shad, turtles,
  //                        non-catfish, fingerlings) are weighed out per
  //                        farmer.
  //   Step 3 GRADING     — fish are sized into the dock-config tiers and
  //                        each tier gets its $/lb. Notes go here too.
  //
  // The wizard lets the user open at any step and edit any load on the
  // selected operating day. Steps 2 & 3 read from already-saved loads;
  // Step 1 stages new rows in memory and saves them all on commit.
  var _wiz = {
    day: null,        // operating day, ISO YYYY-MM-DD
    step: 1,
    newRows: []       // [{movement, farmer_id, pond, truck, plant}]
  };

  function fsOpenBulkWizard() {
    if (!userCan('fishschedule', 'create')) {
      toast('⚠️ Need create permission'); return;
    }
    // Default the operating day to today (or the first day of the current
    // week if today isn't in this week). One blank row pre-seeded.
    var today = new Date().toISOString().split('T')[0];
    _wiz.day = today;
    _wiz.step = 1;
    _wiz.newRows = [bulkEmptyRow()];
    fsBulkRender();
  }
  function bulkEmptyRow() {
    // Plant weight is captured in Step 2 (separate operation: empty truck
    // weighed AFTER unload, often hours later). Step 1 only carries the
    // receiving-time fields.
    return { movement: '', farmer_id: '', pond: '', truck: '' };
  }
  function fsBulkClose() {
    var m = document.getElementById('fs-wiz'); if (m) m.remove();
  }
  function fsBulkSetStep(n) {
    _wiz.step = n;
    fsBulkRender();
  }
  function fsBulkSetDay(iso) {
    _wiz.day = iso;
    fsBulkRender();
  }

  // ── Render shell ─────────────────────────────────────────────────────
  function fsBulkRender() {
    var existing = document.getElementById('fs-wiz');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'fs-wiz';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow-y:auto';

    var stepBtn = function (n, label) {
      var active = (_wiz.step === n);
      return '<button onclick="fsBulkSetStep(' + n + ')" style="padding:8px 14px;border:none;border-radius:8px;cursor:pointer;font-size:.84rem;font-weight:700;'
        + (active ? 'background:#1a3a6b;color:#fff' : 'background:#f1f5f9;color:#475569')
        + '">' + label + '</button>';
    };

    var content = '';
    if (_wiz.step === 1) content = bulkRenderStep1();
    else if (_wiz.step === 2) content = bulkRenderStep2();
    else if (_wiz.step === 3) content = bulkRenderStep3();
    else if (_wiz.step === 4) content = bulkRenderStep4();

    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:18px 20px;max-width:1100px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);margin-top:20px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap">'
      + '<div style="font-weight:800;font-size:1.15rem;color:#1a3a6b">🚀 Bulk Load Entry</div>'
      + '<div style="display:flex;gap:8px;align-items:center">'
      + '<label style="font-size:.78rem;color:#475569;font-weight:600">Operating Day:</label>'
      + '<input type="date" value="' + esc(_wiz.day) + '" onchange="fsBulkSetDay(this.value)" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:.84rem">'
      + '<button onclick="fsBulkClose()" style="background:#f1f5f9;color:#475569;border:none;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer">✕ Close</button>'
      + '</div></div>'
      + '<div style="display:flex;gap:8px;margin-bottom:14px;border-bottom:2px solid #e2e8f0;padding-bottom:12px;flex-wrap:wrap">'
      + stepBtn(1, '1. Receiving')
      + stepBtn(2, '2. Plant Weight')
      + stepBtn(3, '3. Deductions')
      + stepBtn(4, '4. Grading & Pricing')
      + '</div>'
      + content
      + '</div>';
    overlay.onclick = function (e) { if (e.target === overlay) fsBulkClose(); };
    document.body.appendChild(overlay);
  }

  // ── STEP 1: Receiving (bulk add new loads) ───────────────────────────
  function bulkRenderStep1() {
    var farmerOpts = '<option value="">— Pick farmer —</option>'
      + _fsState.farmers.map(function (f) {
          return '<option value="' + f.id + '">' + esc(f.name) + '</option>';
        }).join('');

    // Show counts + summary of loads already saved for this day
    var dayLoads = _fsState.loads.filter(function (l) { return l.day_date === _wiz.day; });
    var summary = dayLoads.length === 0
      ? '<span style="color:#94a3b8;font-size:.78rem">No loads saved yet for ' + prettyDate(_wiz.day) + '.</span>'
      : '<span style="color:#0369a1;font-size:.78rem;font-weight:600">' + dayLoads.length + ' load' + (dayLoads.length === 1 ? '' : 's') + ' already saved for ' + prettyDate(_wiz.day) + '.</span>';

    var rows = _wiz.newRows.map(function (r, idx) {
      // Farmer dropdown — bulk-rebuilt so the selected option reflects r.farmer_id
      var farmerSelect = '<option value="">— Pick farmer —</option>'
        + _fsState.farmers.map(function (f) {
            var sel = (String(f.id) === String(r.farmer_id)) ? ' selected' : '';
            return '<option value="' + f.id + '"' + sel + '>' + esc(f.name) + '</option>';
          }).join('');
      // Pond dropdown driven by the row's farmer_id. Re-renders on farmer
      // change via fsBulkUpdRow → fsBulkRender (full table rebuild). For
      // small N rows this is fine; would only matter at 100+ rows.
      var pondId = parseInt(r.farmer_id, 10) || null;
      var pondSelect = pondSelectOptions(pondId, r.pond);
      return '<tr style="border-bottom:1px solid #f1f5f9" data-row="' + idx + '">'
        + '<td style="padding:6px 6px"><input type="text" value="' + esc(r.movement || '') + '" oninput="fsBulkUpdRow(' + idx + ',\'movement\',this.value)" placeholder="Ticket #" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:.82rem;box-sizing:border-box"></td>'
        + '<td style="padding:6px 6px"><select onchange="fsBulkUpdRowFarmer(' + idx + ',this.value)" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:.82rem;box-sizing:border-box">'
        + farmerSelect
        + '</select></td>'
        + '<td style="padding:6px 6px"><select onchange="fsBulkUpdRow(' + idx + ',\'pond\',this.value)" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:.82rem;box-sizing:border-box">' + pondSelect + '</select></td>'
        + '<td style="padding:6px 6px"><input type="number" min="0" step="1" value="' + (r.truck || '') + '" oninput="fsBulkUpdRow(' + idx + ',\'truck\',this.value)" placeholder="lbs" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:.82rem;box-sizing:border-box"></td>'
        + '<td style="padding:6px 4px;text-align:center"><button onclick="fsBulkRemoveRow(' + idx + ')" title="Remove row" style="background:#fee2e2;color:#b91c1c;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:.7rem;font-weight:700">×</button></td>'
        + '</tr>';
    }).join('');

    return ''
      + '<div style="background:#f0f7ff;border-left:3px solid #1e40af;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:.78rem;color:#1e40af">'
      + '📋 <strong>Step 1 — Receiving:</strong> log every truck as it arrives. Just movement #, farmer, pond, and truck weight. Plant weight goes in Step 2 once unloaded.'
      + '</div>'
      + '<div style="margin-bottom:8px">' + summary + '</div>'
      + '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow-x:auto">'
      + '<table style="width:100%;border-collapse:collapse;font-size:.82rem;min-width:720px">'
      + '<thead><tr style="background:#1a3a6b;color:#fff">'
      + '<th style="padding:8px 6px;text-align:left">Movement #</th>'
      + '<th style="padding:8px 6px;text-align:left">Farmer *</th>'
      + '<th style="padding:8px 6px;text-align:left">Pond</th>'
      + '<th style="padding:8px 6px;text-align:left">Truck Wt</th>'
      + '<th style="padding:8px 6px;text-align:center"></th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table>'
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;flex-wrap:wrap;gap:10px">'
      + '<button onclick="fsBulkAddRow()" style="' + BTN_SUB + '">+ Add Row</button>'
      + '<div style="display:flex;gap:8px">'
      + '<button onclick="fsBulkSaveStep1()" style="' + BTN_P + ';padding:10px 18px">💾 Save All & Continue to Step 2 →</button>'
      + '</div>'
      + '</div>'
      + '<div id="fs-wiz-err" style="color:#ef4444;font-size:.78rem;margin-top:10px;display:none"></div>';
  }

  function fsBulkAddRow() {
    _wiz.newRows.push(bulkEmptyRow());
    fsBulkRender();
  }
  function fsBulkRemoveRow(idx) {
    _wiz.newRows.splice(idx, 1);
    if (_wiz.newRows.length === 0) _wiz.newRows.push(bulkEmptyRow());
    fsBulkRender();
  }
  function fsBulkUpdRow(idx, field, value) {
    if (!_wiz.newRows[idx]) return;
    _wiz.newRows[idx][field] = value;
    // Don't re-render on every keystroke (would steal focus). Difference
    // recompute on blur via setTimeout would be nicer; for now skip.
  }

  // When a row's farmer changes, the pond options change with it. Clear the
  // pond selection and rebuild the table so the new pond list shows. The
  // farmer dropdown was already changed, so focus loss isn't an issue —
  // the operator's next click will be on the pond column.
  function fsBulkUpdRowFarmer(idx, value) {
    if (!_wiz.newRows[idx]) return;
    _wiz.newRows[idx].farmer_id = value;
    _wiz.newRows[idx].pond = ''; // reset pond — different farmer's list
    fsBulkRender();
  }

  function fsBulkSaveStep1() {
    var err = document.getElementById('fs-wiz-err');
    var validRows = _wiz.newRows.filter(function (r) {
      return r.movement || r.farmer_id || r.pond || r.truck;
    });
    if (validRows.length === 0) {
      err.textContent = 'Nothing to save — fill at least one row.';
      err.style.display = 'block'; return;
    }
    // Validate each row has the minimum: farmer_id is required.
    for (var i = 0; i < validRows.length; i++) {
      if (!validRows[i].farmer_id) {
        err.textContent = 'Row ' + (i + 1) + ': farmer is required.';
        err.style.display = 'block'; return;
      }
    }
    err.style.display = 'none';
    var nowIso = new Date().toISOString();
    // Save sequentially so invoice numbers come out in row order. Parallel
    // would race the per-day sequence backfill. Plant weight (net_lbs) is
    // intentionally omitted — that's Step 2.
    var idx = 0;
    function next() {
      if (idx >= validRows.length) {
        toast('✓ Saved ' + validRows.length + ' load' + (validRows.length === 1 ? '' : 's'));
        fsLoadAndRenderIntake();
        _wiz.newRows = [bulkEmptyRow()];
        // Wait briefly for state refresh, then advance to Step 2
        setTimeout(function () { _wiz.step = 2; fsBulkRender(); }, 350);
        return;
      }
      var r = validRows[idx++];
      apiCall('POST', '/api/fish-schedule?action=save_load', {
        day_date: _wiz.day,
        arrived_at: nowIso,
        farmer_id: parseInt(r.farmer_id, 10),
        pond_ref: r.pond || null,
        movement_ticket_number: r.movement || null,
        gross_lbs: r.truck || null
      }).then(next).catch(function (e) {
        err.textContent = 'Save failed on row ' + idx + ': ' + (e.message || 'unknown');
        err.style.display = 'block';
      });
    }
    next();
  }

  // ── STEP 2: Plant Weight (per-load) ──────────────────────────────────
  // Trucks come in full, get weighed at the truck scale (Truck Weight, Step
  // 1). Then they unload — the fish go onto the plant scale, OR the empty
  // truck gets re-weighed. Either way the operator records the Plant Weight
  // here, often hours after the receiving step. Difference auto-computes
  // for sanity.
  function bulkRenderStep2() {
    var dayLoads = _fsState.loads.filter(function (l) { return l.day_date === _wiz.day; });
    if (dayLoads.length === 0) {
      return ''
        + '<div style="background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;padding:14px 18px;color:#92400e">'
        + 'No loads saved for ' + prettyDate(_wiz.day) + '. Go back to <strong>Step 1</strong> and log the trucks first.'
        + '</div>'
        + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">'
        + '<button onclick="fsBulkSetStep(1)" style="' + BTN_SUB + '">← Back to Step 1</button>'
        + '</div>';
    }
    var rows = dayLoads.map(function (l) {
      var farmer = _fsState.farmers.find(function (f) { return f.id === l.farmer_id; });
      var name = farmer ? farmer.name : '(unknown)';
      var color = farmer ? farmer.color : '#1a3a6b';
      var truckVal = l.gross_lbs == null ? '' : l.gross_lbs;
      var plantVal = l.net_lbs == null ? '' : l.net_lbs;
      // Live difference is rendered into a span that fsBulkRecalcStep2()
      // updates on input — avoids re-rendering the whole table (would steal
      // focus from whatever input the operator is typing in).
      var diff = (l.gross_lbs != null && l.net_lbs != null) ? (Number(l.gross_lbs) - Number(l.net_lbs)) : null;
      return '<tr style="border-bottom:1px solid #f1f5f9">'
        + '<td style="padding:8px 8px;font-weight:700">'
        + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + esc(color) + ';margin-right:6px"></span>'
        + esc(name) + (l.pond_ref ? ' <span style="color:#94a3b8;font-weight:400">› ' + esc(l.pond_ref) + '</span>' : '')
        + (l.movement_ticket_number ? '<div style="font-size:.7rem;color:#1e40af;font-weight:600;margin-top:2px">📋 #' + esc(l.movement_ticket_number) + '</div>' : '')
        + '</td>'
        + '<td style="padding:6px 6px"><input id="fs-wiz-truck-' + l.id + '" type="number" min="0" step="1" value="' + truckVal + '" oninput="fsBulkRecalcStep2(\'' + l.id + '\')" placeholder="lbs" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:.82rem;box-sizing:border-box"></td>'
        + '<td style="padding:6px 6px"><input id="fs-wiz-plant-' + l.id + '" type="number" min="0" step="1" value="' + plantVal + '" oninput="fsBulkRecalcStep2(\'' + l.id + '\')" placeholder="lbs" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:.82rem;box-sizing:border-box"></td>'
        + '<td style="padding:8px 8px;text-align:right;color:#475569;font-weight:600"><span id="fs-wiz-diff-' + l.id + '">' + (diff == null ? '—' : Number(diff).toLocaleString()) + '</span></td>'
        + '</tr>';
    }).join('');

    return ''
      + '<div style="background:#f0f7ff;border-left:3px solid #1e40af;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:.78rem;color:#1e40af">'
      + '⚖️ <strong>Step 2 — Plant Weight:</strong> as each truck unloads, record the plant-scale weight. Truck Weight already came in from Step 1; you can adjust it here too if needed. Difference = Truck − Plant.'
      + '</div>'
      + '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow-x:auto">'
      + '<table style="width:100%;border-collapse:collapse;font-size:.82rem;min-width:720px">'
      + '<thead><tr style="background:#1a3a6b;color:#fff">'
      + '<th style="padding:8px 8px;text-align:left">Farmer › Pond</th>'
      + '<th style="padding:8px 8px;text-align:left">Truck Wt</th>'
      + '<th style="padding:8px 8px;text-align:left">Plant Wt</th>'
      + '<th style="padding:8px 8px;text-align:right">Difference</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">'
      + '<button onclick="fsBulkSetStep(1)" style="' + BTN_SUB + '">← Back to Step 1</button>'
      + '<button onclick="fsBulkSaveStep2()" style="' + BTN_P + ';padding:10px 18px">💾 Save Plant Weights & Continue to Step 3 →</button>'
      + '</div>'
      + '<div id="fs-wiz-err" style="color:#ef4444;font-size:.78rem;margin-top:10px;display:none"></div>';
  }

  // Live recompute the Difference cell for one row without redrawing the
  // table (which would steal focus). Called on input from Truck/Plant.
  function fsBulkRecalcStep2(loadId) {
    var t = document.getElementById('fs-wiz-truck-' + loadId);
    var p = document.getElementById('fs-wiz-plant-' + loadId);
    var d = document.getElementById('fs-wiz-diff-' + loadId);
    if (!t || !p || !d) return;
    var tv = t.value === '' ? null : Number(t.value);
    var pv = p.value === '' ? null : Number(p.value);
    if (tv == null || pv == null || isNaN(tv) || isNaN(pv)) {
      d.textContent = '—';
      return;
    }
    d.textContent = Number(tv - pv).toLocaleString();
  }

  function fsBulkSaveStep2() {
    var err = document.getElementById('fs-wiz-err');
    var dayLoads = _fsState.loads.filter(function (l) { return l.day_date === _wiz.day; });
    if (dayLoads.length === 0) return;
    var num = function (id) {
      var el = document.getElementById(id);
      if (!el || !el.value) return null;
      var n = Number(el.value);
      return isNaN(n) ? null : n;
    };
    var idx = 0;
    function next() {
      if (idx >= dayLoads.length) {
        toast('✓ Plant weights saved');
        fsLoadAndRenderIntake();
        setTimeout(function () { _wiz.step = 3; fsBulkRender(); }, 350);
        return;
      }
      var l = dayLoads[idx++];
      // Re-send the full load body so the backend doesn't null anything
      // we're not editing here. Truck/Plant come from the inputs; everything
      // else is whatever the load already had.
      apiCall('POST', '/api/fish-schedule?action=save_load', {
        id: l.id,
        day_date: l.day_date,
        arrived_at: l.arrived_at,
        farmer_id: l.farmer_id,
        pond_ref: l.pond_ref,
        truck_ref: l.truck_ref,
        delivery_id: l.delivery_id,
        movement_ticket_number: l.movement_ticket_number,
        gross_lbs: num('fs-wiz-truck-' + l.id),
        tare_lbs: null,
        net_lbs: num('fs-wiz-plant-' + l.id),
        size_4_6_lbs: l.size_4_6_lbs,
        size_6_8_lbs: l.size_6_8_lbs,
        size_8_plus_lbs: l.size_8_plus_lbs,
        size_0_4_lbs: l.size_0_4_lbs,
        deduction_doa_lbs: l.deduction_doa_lbs,
        deduction_shad_lbs: l.deduction_shad_lbs,
        deduction_turtles_lbs: l.deduction_turtles_lbs,
        deduction_other_species_lbs: l.deduction_other_species_lbs,
        deduction_fingerlings_lbs: l.deduction_fingerlings_lbs,
        price_4_6_per_lb: l.price_4_6_per_lb,
        price_6_8_per_lb: l.price_6_8_per_lb,
        price_8_plus_per_lb: l.price_8_plus_per_lb,
        price_0_4_per_lb: l.price_0_4_per_lb,
        notes: l.notes
      }).then(next).catch(function (e) {
        err.textContent = 'Save failed: ' + (e.message || 'unknown');
        err.style.display = 'block';
      });
    }
    next();
  }

  // ── STEP 3: Deductions (per-load 5-category inputs) ──────────────────
  function bulkRenderStep3() {
    var dayLoads = _fsState.loads.filter(function (l) { return l.day_date === _wiz.day; });
    if (dayLoads.length === 0) {
      return ''
        + '<div style="background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;padding:14px 18px;color:#92400e">'
        + 'No loads saved for ' + prettyDate(_wiz.day) + '. Go back to <strong>Step 1</strong> and log the trucks first.'
        + '</div>'
        + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">'
        + '<button onclick="fsBulkSetStep(1)" style="' + BTN_SUB + '">← Back to Step 1</button>'
        + '</div>';
    }

    var rows = dayLoads.map(function (l) {
      var farmer = _fsState.farmers.find(function (f) { return f.id === l.farmer_id; });
      var name = farmer ? farmer.name : '(unknown)';
      var color = farmer ? farmer.color : '#1a3a6b';
      var ded = ['doa', 'shad', 'turtles', 'other_species', 'fingerlings'].map(function (k) {
        var v = Number(l['deduction_' + k + '_lbs']) || 0;
        return '<td style="padding:6px 6px"><input id="fs-wiz-ded-' + l.id + '-' + k + '" type="number" min="0" step="1" value="' + (v === 0 ? '' : v) + '" placeholder="0" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:.82rem;box-sizing:border-box;text-align:right"></td>';
      }).join('');
      return '<tr style="border-bottom:1px solid #f1f5f9">'
        + '<td style="padding:6px 8px;font-weight:700">'
        + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + esc(color) + ';margin-right:6px"></span>'
        + esc(name) + (l.pond_ref ? ' <span style="color:#94a3b8;font-weight:400">› ' + esc(l.pond_ref) + '</span>' : '')
        + (l.movement_ticket_number ? '<div style="font-size:.7rem;color:#1e40af;font-weight:600;margin-top:2px">📋 #' + esc(l.movement_ticket_number) + '</div>' : '')
        + '</td>'
        + '<td style="padding:6px 8px;text-align:right;font-weight:600;color:#1a3a6b">' + (l.net_lbs ? Number(l.net_lbs).toLocaleString() : '—') + '</td>'
        + ded
        + '</tr>';
    }).join('');

    return ''
      + '<div style="background:#fef2f2;border-left:3px solid #991b1b;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:.78rem;color:#991b1b">'
      + '✂️ <strong>Step 3 — Deductions:</strong> per farmer, weigh out the bad fish by category. Leave blank if zero.'
      + '</div>'
      + '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow-x:auto">'
      + '<table style="width:100%;border-collapse:collapse;font-size:.82rem;min-width:920px">'
      + '<thead><tr style="background:#991b1b;color:#fff">'
      + '<th style="padding:8px 8px;text-align:left">Farmer › Pond</th>'
      + '<th style="padding:8px 8px;text-align:right">Plant Wt</th>'
      + '<th style="padding:8px 6px;text-align:right">DOA</th>'
      + '<th style="padding:8px 6px;text-align:right">Shad</th>'
      + '<th style="padding:8px 6px;text-align:right">Turtles</th>'
      + '<th style="padding:8px 6px;text-align:right">Other Species</th>'
      + '<th style="padding:8px 6px;text-align:right">Fingerlings</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">'
      + '<button onclick="fsBulkSetStep(2)" style="' + BTN_SUB + '">← Back to Step 2</button>'
      + '<button onclick="fsBulkSaveStep3()" style="' + BTN_P + ';padding:10px 18px">💾 Save Deductions & Continue to Step 4 →</button>'
      + '</div>'
      + '<div id="fs-wiz-err" style="color:#ef4444;font-size:.78rem;margin-top:10px;display:none"></div>';
  }

  function fsBulkSaveStep3() {
    var err = document.getElementById('fs-wiz-err');
    var dayLoads = _fsState.loads.filter(function (l) { return l.day_date === _wiz.day; });
    if (dayLoads.length === 0) return;
    var num = function (id) {
      var el = document.getElementById(id);
      if (!el || !el.value) return null;
      var n = Number(el.value);
      return isNaN(n) ? null : n;
    };
    var idx = 0;
    function next() {
      if (idx >= dayLoads.length) {
        toast('✓ Deductions saved');
        fsLoadAndRenderIntake();
        setTimeout(function () { _wiz.step = 4; fsBulkRender(); }, 350);
        return;
      }
      var l = dayLoads[idx++];
      // Send full load body (server upserts) — preserve everything we already
      // had on the load, just overlay the deductions. arrived_at + truck_ref
      // + delivery_id are forwarded so the backend doesn't null them.
      apiCall('POST', '/api/fish-schedule?action=save_load', {
        id: l.id,
        day_date: l.day_date,
        arrived_at: l.arrived_at,
        farmer_id: l.farmer_id,
        pond_ref: l.pond_ref,
        truck_ref: l.truck_ref,
        delivery_id: l.delivery_id,
        movement_ticket_number: l.movement_ticket_number,
        gross_lbs: l.gross_lbs,
        tare_lbs: null,
        net_lbs: l.net_lbs,
        size_4_6_lbs: l.size_4_6_lbs,
        size_6_8_lbs: l.size_6_8_lbs,
        size_8_plus_lbs: l.size_8_plus_lbs,
        size_0_4_lbs: l.size_0_4_lbs,
        deduction_doa_lbs: num('fs-wiz-ded-' + l.id + '-doa'),
        deduction_shad_lbs: num('fs-wiz-ded-' + l.id + '-shad'),
        deduction_turtles_lbs: num('fs-wiz-ded-' + l.id + '-turtles'),
        deduction_other_species_lbs: num('fs-wiz-ded-' + l.id + '-other_species'),
        deduction_fingerlings_lbs: num('fs-wiz-ded-' + l.id + '-fingerlings'),
        price_4_6_per_lb: l.price_4_6_per_lb,
        price_6_8_per_lb: l.price_6_8_per_lb,
        price_8_plus_per_lb: l.price_8_plus_per_lb,
        price_0_4_per_lb: l.price_0_4_per_lb,
        notes: l.notes
      }).then(next).catch(function (e) {
        err.textContent = 'Save failed: ' + (e.message || 'unknown');
        err.style.display = 'block';
      });
    }
    next();
  }

  // ── STEP 4: Grading & Pricing ────────────────────────────────────────
  // Stacked cards (one per load) because each card has 8 numeric inputs +
  // 4 currency inputs + a notes field. Per-farmer pricing memory:
  // when a load doesn't have its own prices yet, look up the most recent
  // OTHER load by the same farmer (any day) with prices and use those.
  function bulkRenderStep4() {
    var dayLoads = _fsState.loads.filter(function (l) { return l.day_date === _wiz.day; });
    if (dayLoads.length === 0) {
      return ''
        + '<div style="background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;padding:14px 18px;color:#92400e">'
        + 'No loads saved for ' + prettyDate(_wiz.day) + '. Go back to Step 1 to log them first.'
        + '</div>'
        + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">'
        + '<button onclick="fsBulkSetStep(3)" style="' + BTN_SUB + '">← Back to Step 3</button>'
        + '</div>';
    }
    var dc = dockConfig();
    var cards = dayLoads.map(function (l) {
      var farmer = _fsState.farmers.find(function (f) { return f.id === l.farmer_id; });
      var name = farmer ? farmer.name : '(unknown)';
      var color = farmer ? farmer.color : '#1a3a6b';
      // Per-farmer pricing memory: most recent other load by this farmer
      // with any per-band price set. Falls through to dock-config defaults.
      var farmerPrior = null;
      _fsState.loads.forEach(function (x) {
        if (x.id === l.id) return;
        if (x.farmer_id !== l.farmer_id) return;
        if (x.price_0_4_per_lb == null && x.price_4_6_per_lb == null
            && x.price_6_8_per_lb == null && x.price_8_plus_per_lb == null) return;
        if (!farmerPrior || (x.day_date > farmerPrior.day_date)) farmerPrior = x;
      });
      var priceFor = function (key) {
        if (l[key] != null && l[key] !== '') return Number(l[key]);
        if (farmerPrior && farmerPrior[key] != null) return Number(farmerPrior[key]);
        return null;
      };
      var p04 = priceFor('price_0_4_per_lb') ?? dc.tier1_default_price;
      var p46 = priceFor('price_4_6_per_lb') ?? dc.tier2_default_price;
      var p68 = priceFor('price_6_8_per_lb') ?? dc.tier3_default_price;
      var p8p = priceFor('price_8_plus_per_lb') ?? dc.tier4_default_price;

      var totalDed = (Number(l.deduction_doa_lbs) || 0)
        + (Number(l.deduction_shad_lbs) || 0)
        + (Number(l.deduction_turtles_lbs) || 0)
        + (Number(l.deduction_other_species_lbs) || 0)
        + (Number(l.deduction_fingerlings_lbs) || 0);
      var payable = (Number(l.net_lbs) || 0) - totalDed;

      var cur = function (n) {
        return n == null || isNaN(n) ? '' : '$' + Number(n).toFixed(2);
      };
      var sz = function (id, label, v) {
        return '<div><label style="display:block;font-size:.66rem;color:#475569;font-weight:600;margin-bottom:3px;min-height:24px">' + esc(label) + '</label>'
          + '<input id="' + id + '" type="number" min="0" step="1" value="' + (v == null || v === 0 ? '' : v) + '" placeholder="0" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:.82rem;box-sizing:border-box"></div>';
      };
      var pr = function (id, label, v) {
        return '<div><label style="display:block;font-size:.66rem;color:#475569;font-weight:600;margin-bottom:3px;min-height:24px">' + esc(label) + ' $/lb</label>'
          + '<input id="' + id + '" type="text" inputmode="decimal" value="' + cur(v) + '" placeholder="$0.00"'
          + ' onfocus="fsCurrencyFocus(this)" onblur="fsCurrencyBlur(this)" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:.82rem;box-sizing:border-box"></div>';
      };
      var farmerPriorTag = farmerPrior
        ? '<span style="font-size:.68rem;color:#0369a1;font-weight:600;margin-left:6px">prices from prior ' + esc(farmerPrior.day_date) + '</span>'
        : '';

      return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:10px">'
        + '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:10px">'
        + '<div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(color) + ';margin-right:8px"></span>'
        + '<strong style="font-size:.92rem;color:#0f172a">' + esc(name) + '</strong>'
        + (l.pond_ref ? ' <span style="color:#94a3b8">› ' + esc(l.pond_ref) + '</span>' : '')
        + (l.invoice_number ? ' <span style="font-size:.72rem;color:#64748b">Inv #' + esc(l.invoice_number) + '</span>' : '')
        + farmerPriorTag
        + '</div>'
        + '<div style="font-size:.78rem;color:#64748b">Plant <strong>' + (l.net_lbs ? Number(l.net_lbs).toLocaleString() : '—')
        + '</strong> − Ded <strong>' + Number(totalDed).toLocaleString() + '</strong> = '
        + '<strong style="color:#065f46">' + Number(payable).toLocaleString() + ' lbs payable</strong></div>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px">'
        + sz('fs-wiz-sz-' + l.id + '-tier1', dc.tier1_label, l.size_0_4_lbs)
        + sz('fs-wiz-sz-' + l.id + '-tier2', dc.tier2_label, l.size_4_6_lbs)
        + sz('fs-wiz-sz-' + l.id + '-tier3', dc.tier3_label, l.size_6_8_lbs)
        + sz('fs-wiz-sz-' + l.id + '-tier4', dc.tier4_label, l.size_8_plus_lbs)
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px">'
        + pr('fs-wiz-pr-' + l.id + '-tier1', dc.tier1_label, p04)
        + pr('fs-wiz-pr-' + l.id + '-tier2', dc.tier2_label, p46)
        + pr('fs-wiz-pr-' + l.id + '-tier3', dc.tier3_label, p68)
        + pr('fs-wiz-pr-' + l.id + '-tier4', dc.tier4_label, p8p)
        + '</div>'
        + '<input id="fs-wiz-notes-' + l.id + '" type="text" placeholder="Notes (optional)" value="' + esc(l.notes || '') + '" style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:5px;font-size:.82rem;box-sizing:border-box">'
        + '</div>';
    }).join('');

    return ''
      + '<div style="background:#ecfdf5;border-left:3px solid #065f46;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:.78rem;color:#065f46">'
      + '📏 <strong>Step 4 — Grading & Pricing:</strong> grade each farmer\'s fish into bands and confirm $/lb. Per-farmer prior prices auto-fill when available.'
      + '</div>'
      + cards
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">'
      + '<button onclick="fsBulkSetStep(3)" style="' + BTN_SUB + '">← Back to Step 3</button>'
      + '<button onclick="fsBulkSaveStep4()" style="' + BTN_P + ';padding:10px 18px">✓ Save All & Done</button>'
      + '</div>'
      + '<div id="fs-wiz-err" style="color:#ef4444;font-size:.78rem;margin-top:10px;display:none"></div>';
  }

  function fsBulkSaveStep4() {
    var err = document.getElementById('fs-wiz-err');
    var dayLoads = _fsState.loads.filter(function (l) { return l.day_date === _wiz.day; });
    if (dayLoads.length === 0) return;
    var num = function (id) {
      var el = document.getElementById(id);
      if (!el || !el.value) return null;
      var n = Number(el.value);
      return isNaN(n) ? null : n;
    };
    var pr = function (id) {
      var el = document.getElementById(id);
      return el ? parseCurrency(el.value) : null;
    };
    var notes = function (id) {
      var el = document.getElementById(id);
      return el ? (el.value || null) : null;
    };
    var idx = 0;
    function next() {
      if (idx >= dayLoads.length) {
        toast('✓ Grading saved');
        fsLoadAndRenderIntake();
        setTimeout(fsBulkClose, 350);
        return;
      }
      var l = dayLoads[idx++];
      apiCall('POST', '/api/fish-schedule?action=save_load', {
        id: l.id,
        day_date: l.day_date,
        arrived_at: l.arrived_at,
        farmer_id: l.farmer_id,
        pond_ref: l.pond_ref,
        truck_ref: l.truck_ref,
        delivery_id: l.delivery_id,
        movement_ticket_number: l.movement_ticket_number,
        gross_lbs: l.gross_lbs,
        tare_lbs: null,
        net_lbs: l.net_lbs,
        // Tier1=size_0_4, tier2=size_4_6, tier3=size_6_8, tier4=size_8_plus
        size_0_4_lbs: num('fs-wiz-sz-' + l.id + '-tier1'),
        size_4_6_lbs: num('fs-wiz-sz-' + l.id + '-tier2'),
        size_6_8_lbs: num('fs-wiz-sz-' + l.id + '-tier3'),
        size_8_plus_lbs: num('fs-wiz-sz-' + l.id + '-tier4'),
        deduction_doa_lbs: l.deduction_doa_lbs,
        deduction_shad_lbs: l.deduction_shad_lbs,
        deduction_turtles_lbs: l.deduction_turtles_lbs,
        deduction_other_species_lbs: l.deduction_other_species_lbs,
        deduction_fingerlings_lbs: l.deduction_fingerlings_lbs,
        price_0_4_per_lb: pr('fs-wiz-pr-' + l.id + '-tier1'),
        price_4_6_per_lb: pr('fs-wiz-pr-' + l.id + '-tier2'),
        price_6_8_per_lb: pr('fs-wiz-pr-' + l.id + '-tier3'),
        price_8_plus_per_lb: pr('fs-wiz-pr-' + l.id + '-tier4'),
        notes: notes('fs-wiz-notes-' + l.id)
      }).then(next).catch(function (e) {
        err.textContent = 'Save failed: ' + (e.message || 'unknown');
        err.style.display = 'block';
      });
    }
    next();
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
  window.fsLoadModalRefreshPonds = fsLoadModalRefreshPonds;
  window.fsLoadModalFillBandPrices = fsLoadModalFillBandPrices;
  // Currency formatting handlers used by inline onfocus/onblur on the
  // per-tier $/lb inputs.
  window.fsCurrencyFocus = fsCurrencyFocus;
  window.fsCurrencyBlur = fsCurrencyBlur;
  // Dock config (manager+ only — backend enforces, frontend hides button)
  window.fsOpenDockConfig = fsOpenDockConfig;
  window.fsSaveDockConfig = fsSaveDockConfig;
  // Bulk Entry wizard (3-step Receiving → Deductions → Grading flow)
  window.fsOpenBulkWizard = fsOpenBulkWizard;
  window.fsBulkClose = fsBulkClose;
  window.fsBulkSetStep = fsBulkSetStep;
  window.fsBulkSetDay = fsBulkSetDay;
  window.fsBulkAddRow = fsBulkAddRow;
  window.fsBulkRemoveRow = fsBulkRemoveRow;
  window.fsBulkUpdRow = fsBulkUpdRow;
  window.fsBulkUpdRowFarmer = fsBulkUpdRowFarmer;
  window.fsBulkSaveStep1 = fsBulkSaveStep1;
  window.fsBulkSaveStep2 = fsBulkSaveStep2;
  window.fsBulkSaveStep3 = fsBulkSaveStep3;
  window.fsBulkSaveStep4 = fsBulkSaveStep4;
  window.fsBulkRecalcStep2 = fsBulkRecalcStep2;
  // Fish Payable (invoice rollup)
  window.fsWeekNavPayable = fsWeekNavPayable;
  window.fsGoTodayPayable = fsGoTodayPayable;
  window.fsPrintPayable = fsPrintPayable;
})();
