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
    loading: false
  };

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
    ['schedule', 'farmers'].forEach(function (t) {
      var btn = document.getElementById('fs-tab-' + t);
      if (!btn) return;
      var active = (t === tab);
      btn.style.color = active ? '#1a3a6b' : '#94a3b8';
      btn.style.borderBottomColor = active ? '#1a3a6b' : 'transparent';
    });
    if (tab === 'schedule') fsLoadAndRenderSchedule();
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
          body += '<div style="background:#fff;border:1px solid #e2e8f0;border-left:3px solid ' + color + ';border-radius:5px;padding:4px 6px;margin-bottom:3px;display:flex;align-items:center;gap:4px">'
            + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:.74rem;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(farmerName) + '">' + esc(farmerName) + '</div>'
            + '<div style="font-size:.7rem;color:#1a3a6b;font-weight:700">' + fmtLbs(dl.expected_lbs) + '</div>'
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
})();
