// production.js — Production Log widget (Phase A)
//
// Replaces the MON/TUE/.../FREEZER-IQF/ICE PACK/COOLER sheets in the
// yield master Excel. Per-day per-SKU finished-product tracking.
//
// Tabs:
//   📅 Daily Entry   — pick a date, see every SKU with BEGIN/LW/FREEZER/ADJUST/SHIPPED/BALANCE
//   📦 Weekly Roll   — Mon-Sat (+Mon2/Tue2) grid, one row per SKU, produced lbs per day
//   🗂️ SKUs          — catalog management (admin + manager)
//
// Data entry pattern: FREEZER and SHIPPED are inline-edit (number inputs,
// save on blur). ADJUST opens a modal for per-row adjustments + cross-pool
// transfers. BEGIN / LW / BALANCE are read-only (computed server-side).

(function () {
  var POOLS = ['FREEZER-IQF', 'ICE PACK', 'COOLER'];

  var _ps = {
    tab: 'daily',
    entryDate: '',         // ISO YYYY-MM-DD for daily tab
    activePool: 'FREEZER-IQF',
    weekStart: '',         // Monday of selected week (weekly tab)
    day: null,             // cached daily response
    week: null,            // cached weekly response
    skus: []
  };

  var BTN = 'padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:.78rem;font-weight:600';
  var BTN_P = BTN + ';background:#1a3a6b;color:#fff';
  var BTN_SUB = BTN + ';background:#f1f5f9;color:#334155';
  var BTN_D = 'padding:2px 8px;border-radius:5px;border:none;cursor:pointer;font-size:.68rem;background:#fee2e2;color:#b91c1c';
  var INP = 'width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:.85rem;box-sizing:border-box';
  var CELL_INP = 'width:100%;padding:4px 6px;border:1px solid transparent;border-radius:4px;font-size:.78rem;text-align:right;background:transparent;box-sizing:border-box';

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtLbs(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    var v = Number(n);
    return (v === 0 ? '0' : v.toLocaleString('en-US', { maximumFractionDigits: 1 }));
  }
  function todayIso() { return new Date().toISOString().split('T')[0]; }
  function mondayOf(iso) {
    var d = new Date((iso || todayIso()) + 'T00:00:00');
    var dow = d.getDay();
    var back = dow === 0 ? 6 : dow - 1;
    d.setDate(d.getDate() - back);
    return d.toISOString().split('T')[0];
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }
  function dayAbbr(iso) {
    var names = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    return names[new Date(iso + 'T00:00:00').getDay()];
  }

  // ═══ ENTRY ════════════════════════════════════════════════════════════
  function buildProductionWidget() {
    var wt = document.getElementById('widget-tabs');
    var tabs = [
      { id: 'daily',  label: '📅 Daily Entry' },
      { id: 'weekly', label: '📦 Weekly Roll' },
      { id: 'skus',   label: '🗂️ SKUs' }
    ];
    wt.innerHTML = tabs.map(function (t) {
      return '<button class="wtab" id="pr-tab-' + t.id + '" onclick="prShowTab(\'' + t.id + '\')" '
        + 'style="padding:6px 12px;border:none;background:transparent;cursor:pointer;font-size:.78rem;'
        + 'border-bottom:2px solid transparent;color:#94a3b8">' + t.label + '</button>';
    }).join('');

    if (!_ps.entryDate) _ps.entryDate = todayIso();
    if (!_ps.weekStart) _ps.weekStart = mondayOf();
    prShowTab('daily');
  }

  function prShowTab(tab) {
    _ps.tab = tab;
    ['daily', 'weekly', 'skus'].forEach(function (t) {
      var btn = document.getElementById('pr-tab-' + t);
      if (!btn) return;
      var active = (t === tab);
      btn.style.color = active ? '#1a3a6b' : '#94a3b8';
      btn.style.borderBottomColor = active ? '#1a3a6b' : 'transparent';
    });
    if (tab === 'daily') loadDaily();
    else if (tab === 'weekly') loadWeekly();
    else if (tab === 'skus') loadSkus();
  }

  // ═══ DAILY ENTRY ══════════════════════════════════════════════════════
  function loadDaily() {
    var panel = document.getElementById('widget-content');
    panel.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner-wrap"><div class="spinner"></div></div>Loading…</div>';
    apiCall('GET', '/api/production?action=get_day&entry_date=' + _ps.entryDate)
      .then(function (r) {
        _ps.day = r;
        renderDaily();
      })
      .catch(function (err) {
        panel.innerHTML = '<div style="padding:20px;color:#ef4444">Failed to load: ' + esc(err.message) + '</div>';
      });
  }

  function renderDaily() {
    var panel = document.getElementById('widget-content');
    var rows = _ps.day.rows || [];
    var hasSkus = rows.length > 0;
    var isAdmin = (typeof userCan === 'function') && userCan('settings', 'view');
    var canEdit = (typeof userCan === 'function') && userCan('production', 'edit');
    var canCreate = (typeof userCan === 'function') && userCan('production', 'create');

    var html = '<div style="padding:14px;max-width:100%;margin:0 auto">';

    // Header: date + pool pills
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;background:#fff;border-radius:10px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<label style="font-size:.74rem;font-weight:600;color:#475569">Date:</label>'
      + '<input type="date" value="' + esc(_ps.entryDate) + '" onchange="prSetDate(this.value)" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:.82rem">'
      + '<button style="' + BTN_SUB + '" onclick="prDateStep(-1)">← Prev Day</button>'
      + '<button style="' + BTN_SUB + '" onclick="prToday()">Today</button>'
      + '<button style="' + BTN_SUB + '" onclick="prDateStep(1)">Next Day →</button>'
      + '<div style="flex:1"></div>'
      + '<div style="font-size:.72rem;color:#64748b">LW = balance at end of ' + esc(_ps.day.lw_date) + '</div>'
      + '</div>';

    // Pool pills
    html += '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
    POOLS.forEach(function (p) {
      var poolRows = rows.filter(function (r) { return r.pool === p; });
      var active = (p === _ps.activePool);
      html += '<button onclick="prSelectPool(\'' + p + '\')" style="padding:7px 14px;border-radius:8px;border:1px solid ' + (active ? '#1a3a6b' : '#cbd5e1') + ';background:' + (active ? '#1a3a6b' : '#fff') + ';color:' + (active ? '#fff' : '#334155') + ';font-size:.78rem;font-weight:600;cursor:pointer">'
        + p + ' <span style="opacity:.7;margin-left:4px">(' + poolRows.length + ')</span></button>';
    });
    html += '</div>';

    if (!hasSkus) {
      html += '<div style="background:#fef3c7;border:1px solid #fde68a;padding:16px;border-radius:8px;color:#92400e;font-size:.86rem">'
        + '⚠️ No SKUs set up yet. ';
      if (isAdmin) {
        html += '<button onclick="prSeedSkus()" style="' + BTN_P + ';margin-left:8px">Seed from Excel</button> '
          + '— this creates the ~100 SKUs from your yield master file.';
      } else {
        html += 'Ask an admin to run the one-time SKU seed.';
      }
      html += '</div></div>';
      panel.innerHTML = html;
      return;
    }

    // Filter to active pool
    var poolRows = rows.filter(function (r) { return r.pool === _ps.activePool; });

    // Group by category inside the pool for readability
    var byCat = {};
    poolRows.forEach(function (r) {
      var cat = r.category || 'OTHER';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(r);
    });

    // Pool totals
    var poolTotals = { produced: 0, shipped: 0, balance: 0 };
    poolRows.forEach(function (r) {
      poolTotals.produced += Number(r.produced_lbs || 0);
      poolTotals.shipped += Number(r.shipped_lbs || 0);
      poolTotals.balance += Number(r.balance_lbs || 0);
    });

    html += '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden">';

    // Table header. NEW Lbs/Case column between SKU and Begin so operators
    // have case-size context when reading produced/shipped pounds.
    html += '<table style="width:100%;border-collapse:collapse;font-size:.78rem">'
      + '<thead style="position:sticky;top:0;background:#1a3a6b;color:#fff;z-index:1"><tr>'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600;min-width:140px">Item</th>'
      + '<th style="padding:8px 6px;text-align:left;font-weight:600;width:80px;font-size:.68rem;opacity:.85">SKU</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:60px;font-size:.68rem;opacity:.85">Lbs/Case</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:70px">Begin</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:70px">LW</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:90px;background:#1e40af">Freezer</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:80px">Adjust</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:80px">Shipped</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:80px;background:#0f766e">Balance</th>'
      + '</tr></thead><tbody>';

    Object.keys(byCat).sort().forEach(function (cat) {
      // Category header row. Spans the full 9-column table now.
      html += '<tr style="background:#f8fafc"><td colspan="9" style="padding:6px 10px;font-size:.7rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.05em">'
        + esc(cat) + '</td></tr>';
      byCat[cat].forEach(function (r) {
        html += renderDailyRow(r, canEdit || canCreate);
      });
    });

    // Totals footer
    html += '<tr style="background:#f1f5f9;font-weight:700">'
      + '<td style="padding:10px 10px" colspan="5">TOTAL ' + _ps.activePool + '</td>'
      + '<td style="padding:10px 6px;text-align:right;color:#1e40af">' + fmtLbs(poolTotals.produced) + '</td>'
      + '<td></td>'
      + '<td style="padding:10px 6px;text-align:right">' + fmtLbs(poolTotals.shipped) + '</td>'
      + '<td style="padding:10px 6px;text-align:right;color:#0f766e">' + fmtLbs(poolTotals.balance) + '</td>'
      + '</tr>';

    html += '</tbody></table></div>';
    html += '</div>';
    panel.innerHTML = html;
  }

  function renderDailyRow(r, writable) {
    var readonlyAttr = writable ? '' : ' readonly';
    var producedInput = '<input type="number" step="0.1" min="0" value="' + (Number(r.produced_lbs) || '') + '" '
      + 'data-sku="' + r.sku_id + '" data-field="produced_lbs" onblur="prSaveCell(this)" '
      + 'style="' + CELL_INP + ';background:' + (writable ? '#eff6ff' : 'transparent') + '"' + readonlyAttr + ' placeholder="0">';
    var shippedInput = '<input type="number" step="0.1" min="0" value="' + (Number(r.shipped_lbs) || '') + '" '
      + 'data-sku="' + r.sku_id + '" data-field="shipped_lbs" onblur="prSaveCell(this)" '
      + 'style="' + CELL_INP + ';background:' + (writable ? '#fef2f2' : 'transparent') + '"' + readonlyAttr + ' placeholder="0">';
    var adjCell;
    if (writable) {
      var hasAdj = r.adjust_count > 0;
      var adjColor = r.adjust_lbs > 0 ? '#065f46' : (r.adjust_lbs < 0 ? '#991b1b' : '#64748b');
      adjCell = '<button onclick="prOpenAdjust(' + r.sku_id + ')" style="background:' + (hasAdj ? '#fef3c7' : 'transparent') + ';border:1px dashed #cbd5e1;border-radius:4px;padding:3px 8px;font-size:.72rem;color:' + adjColor + ';cursor:pointer;width:100%;font-weight:' + (hasAdj ? '700' : '500') + '">'
        + (r.adjust_lbs === 0 ? '+ Adj' : (r.adjust_lbs > 0 ? '+' : '') + fmtLbs(r.adjust_lbs)) + (hasAdj ? ' ·' + r.adjust_count : '') + '</button>';
    } else {
      adjCell = '<span style="font-size:.72rem;color:#64748b">' + (r.adjust_lbs === 0 ? '—' : fmtLbs(r.adjust_lbs)) + '</span>';
    }
    // Lbs/Case cell — COOLER items have null (tubs not cases) → em-dash.
    var casesCell = (r.lbs_per_case == null || r.lbs_per_case === '')
      ? '<span style="color:#cbd5e1">—</span>'
      : esc(String(r.lbs_per_case));
    return '<tr>'
      + '<td style="padding:5px 10px;color:#0f172a;font-weight:500">' + esc(r.item_name) + '</td>'
      + '<td style="padding:5px 6px;color:#64748b;font-family:ui-monospace,monospace;font-size:.68rem">' + esc(r.sku || '') + '</td>'
      + '<td style="padding:5px 6px;text-align:right;color:#64748b;font-size:.74rem">' + casesCell + '</td>'
      + '<td style="padding:5px 6px;text-align:right;color:#64748b">' + (r.begin_lbs === 0 ? '—' : fmtLbs(r.begin_lbs)) + '</td>'
      + '<td style="padding:5px 6px;text-align:right;color:#94a3b8;font-size:.72rem">' + (r.lw_lbs === 0 ? '—' : fmtLbs(r.lw_lbs)) + '</td>'
      + '<td style="padding:3px 4px">' + producedInput + '</td>'
      + '<td style="padding:3px 4px">' + adjCell + '</td>'
      + '<td style="padding:3px 4px">' + shippedInput + '</td>'
      + '<td style="padding:5px 6px;text-align:right;color:' + (r.balance_lbs === 0 ? '#cbd5e1' : '#0f766e') + ';font-weight:700">' + fmtLbs(r.balance_lbs) + '</td>'
      + '</tr>';
  }

  function prSaveCell(input) {
    var skuId = parseInt(input.getAttribute('data-sku'), 10);
    var field = input.getAttribute('data-field');
    var value = input.value === '' ? 0 : Number(input.value);
    if (isNaN(value) || value < 0) { toast('⚠️ Enter a non-negative number'); input.focus(); return; }

    // Pull sibling field to submit a full row save (API expects both)
    var row = (_ps.day.rows || []).find(function (r) { return r.sku_id === skuId; });
    if (!row) return;
    var produced = field === 'produced_lbs' ? value : Number(row.produced_lbs || 0);
    var shipped = field === 'shipped_lbs' ? value : Number(row.shipped_lbs || 0);

    // Optimistically update local state so balance displays instantly
    row.produced_lbs = produced;
    row.shipped_lbs = shipped;
    row.balance_lbs = Number(row.begin_lbs || 0) + produced + Number(row.adjust_lbs || 0) - shipped;

    apiCall('POST', '/api/production?action=save_entry', {
      sku_id: skuId, entry_date: _ps.entryDate,
      produced_lbs: produced, shipped_lbs: shipped
    }).then(function () {
      // Re-render just the row's balance cell rather than full reload.
      // Row shape now: Item | SKU | Lbs/Case | Begin | LW | Freezer | Adjust | Shipped | Balance
      // (9 cells; Balance is index 8).
      var cells = input.closest('tr').querySelectorAll('td');
      if (cells && cells.length >= 9) {
        cells[8].textContent = fmtLbs(row.balance_lbs);
        cells[8].style.color = row.balance_lbs === 0 ? '#cbd5e1' : '#0f766e';
      }
    }).catch(function (err) {
      toast('⚠️ Save failed: ' + err.message);
      loadDaily(); // full reload on failure
    });
  }

  function prSetDate(iso) { _ps.entryDate = iso; loadDaily(); }
  function prDateStep(delta) { _ps.entryDate = addDays(_ps.entryDate, delta); loadDaily(); }
  function prToday() { _ps.entryDate = todayIso(); loadDaily(); }
  function prSelectPool(p) { _ps.activePool = p; renderDaily(); }

  // ── Adjustment modal ────────────────────────────────────────────────
  function prOpenAdjust(skuId) {
    var row = (_ps.day.rows || []).find(function (r) { return r.sku_id === skuId; });
    if (!row) return;

    var overlay = document.createElement('div');
    overlay.id = 'pr-adj-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

    // Existing adjustments list
    var existingHtml = '';
    if (row.adjustments && row.adjustments.length) {
      existingHtml = '<div style="margin-top:10px;border-top:1px solid #e2e8f0;padding-top:10px"><div style="font-size:.72rem;color:#475569;font-weight:700;margin-bottom:6px">EXISTING ADJUSTMENTS TODAY</div>';
      row.adjustments.forEach(function (a) {
        var color = a.delta > 0 ? '#065f46' : '#991b1b';
        var sign = a.delta > 0 ? '+' : '';
        existingHtml += '<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #f1f5f9">'
          + '<span style="font-weight:700;color:' + color + ';min-width:70px">' + sign + fmtLbs(a.delta) + ' lbs</span>'
          + '<span style="flex:1;font-size:.76rem;color:#334155">' + esc(a.note || '') + (a.transfer_pair_id ? ' <span style="background:#dbeafe;color:#1e40af;padding:1px 5px;border-radius:4px;font-size:.62rem;font-weight:600;margin-left:4px">TRANSFER</span>' : '') + '</span>'
          + '<button onclick="prDeleteAdjustment(' + a.id + ')" style="' + BTN_D + '">Del</button>'
          + '</div>';
      });
      existingHtml += '</div>';
    }

    // SKU dropdown for transfer target
    var transferOpts = (_ps.day.rows || [])
      .filter(function (s) { return s.sku_id !== skuId; })
      .map(function (s) { return '<option value="' + s.sku_id + '">[' + s.pool + '] ' + esc(s.item_name) + (s.sku ? ' — ' + esc(s.sku) : '') + '</option>'; })
      .join('');

    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:20px;max-width:540px;width:100%;max-height:90vh;overflow-y:auto">'
      + '<div style="font-weight:700;color:#1a3a6b;font-size:1.05rem;margin-bottom:4px">Adjust: ' + esc(row.item_name) + '</div>'
      + '<div style="font-size:.74rem;color:#64748b;margin-bottom:12px">[' + row.pool + ']' + (row.sku ? ' · SKU ' + esc(row.sku) : '') + ' · Entry date ' + _ps.entryDate + '</div>'

      // Tabs: Simple adjust vs Cross-pool transfer
      + '<div style="display:flex;gap:0;border-bottom:1px solid #e2e8f0;margin-bottom:12px">'
      + '<button id="pr-adj-t-simple" onclick="prAdjTab(\'simple\')" style="flex:1;padding:8px;border:none;background:transparent;cursor:pointer;font-size:.78rem;font-weight:600;color:#1a3a6b;border-bottom:2px solid #1a3a6b">Correction</button>'
      + '<button id="pr-adj-t-transfer" onclick="prAdjTab(\'transfer\')" style="flex:1;padding:8px;border:none;background:transparent;cursor:pointer;font-size:.78rem;font-weight:600;color:#94a3b8;border-bottom:2px solid transparent">Pool Transfer</button>'
      + '</div>'

      // Simple correction form
      + '<div id="pr-adj-pane-simple">'
      + '<div style="font-size:.72rem;color:#64748b;margin-bottom:8px">Add pounds (positive) or subtract (negative). E.g. -5 for a scale error correction.</div>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:6px 0 4px">Pounds (±)</label>'
      + '<input id="pr-adj-delta" type="number" step="0.1" placeholder="e.g., -5 or +12" style="' + INP + '">'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Note <span style="font-weight:400;color:#94a3b8">(why)</span></label>'
      + '<input id="pr-adj-note" type="text" placeholder="e.g., recounted, scale re-zero" style="' + INP + '">'
      + '<div id="pr-adj-err" style="color:#ef4444;font-size:.76rem;margin-top:6px;display:none"></div>'
      + '</div>'

      // Transfer form (hidden by default)
      + '<div id="pr-adj-pane-transfer" style="display:none">'
      + '<div style="font-size:.72rem;color:#64748b;margin-bottom:8px">Move pounds from this SKU into another SKU (e.g. IQF 3-5 Fillets → Ice Pack 3-5 Fillets). Creates two paired adjustments.</div>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:6px 0 4px">Move to SKU</label>'
      + '<select id="pr-adj-to-sku" style="' + INP + '">' + transferOpts + '</select>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Pounds to move</label>'
      + '<input id="pr-adj-tlbs" type="number" step="0.1" min="0" placeholder="e.g., 10" style="' + INP + '">'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Note</label>'
      + '<input id="pr-adj-tnote" type="text" placeholder="e.g., repack from freezer to ice pack" style="' + INP + '">'
      + '<div id="pr-adj-terr" style="color:#ef4444;font-size:.76rem;margin-top:6px;display:none"></div>'
      + '</div>'

      + existingHtml

      + '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">'
      + '<button style="' + BTN_SUB + ';padding:8px 14px" onclick="document.getElementById(\'pr-adj-modal\').remove()">Close</button>'
      + '<button id="pr-adj-save" style="' + BTN_P + ';padding:8px 14px" onclick="prSaveAdjustment(' + skuId + ')">Add Correction</button>'
      + '</div>'
      + '</div>';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    setTimeout(function () { var el = document.getElementById('pr-adj-delta'); if (el) el.focus(); }, 80);
  }

  function prAdjTab(which) {
    document.getElementById('pr-adj-pane-simple').style.display = (which === 'simple' ? 'block' : 'none');
    document.getElementById('pr-adj-pane-transfer').style.display = (which === 'transfer' ? 'block' : 'none');
    document.getElementById('pr-adj-t-simple').style.color = which === 'simple' ? '#1a3a6b' : '#94a3b8';
    document.getElementById('pr-adj-t-simple').style.borderBottomColor = which === 'simple' ? '#1a3a6b' : 'transparent';
    document.getElementById('pr-adj-t-transfer').style.color = which === 'transfer' ? '#1a3a6b' : '#94a3b8';
    document.getElementById('pr-adj-t-transfer').style.borderBottomColor = which === 'transfer' ? '#1a3a6b' : 'transparent';
    var btn = document.getElementById('pr-adj-save');
    btn.textContent = which === 'simple' ? 'Add Correction' : 'Save Transfer';
    btn.setAttribute('data-which', which);
  }

  function prSaveAdjustment(skuId) {
    var btn = document.getElementById('pr-adj-save');
    var which = btn.getAttribute('data-which') || 'simple';
    if (which === 'simple') {
      var delta = document.getElementById('pr-adj-delta').value;
      var note = document.getElementById('pr-adj-note').value.trim();
      var err = document.getElementById('pr-adj-err');
      err.style.display = 'none';
      if (delta === '' || isNaN(Number(delta)) || Number(delta) === 0) {
        err.textContent = 'Enter a non-zero number (use negative for subtract).'; err.style.display = 'block'; return;
      }
      apiCall('POST', '/api/production?action=save_adjustment', {
        sku_id: skuId, entry_date: _ps.entryDate, delta_lbs: Number(delta), note: note || null
      }).then(function () {
        document.getElementById('pr-adj-modal').remove();
        toast('Adjustment saved');
        loadDaily();
      }).catch(function (e) { err.textContent = e.message; err.style.display = 'block'; });
    } else {
      var toSku = document.getElementById('pr-adj-to-sku').value;
      var lbs = document.getElementById('pr-adj-tlbs').value;
      var note = document.getElementById('pr-adj-tnote').value.trim();
      var err = document.getElementById('pr-adj-terr');
      err.style.display = 'none';
      if (!toSku || !lbs || isNaN(Number(lbs)) || Number(lbs) <= 0) {
        err.textContent = 'Pick a destination SKU and a positive pound amount.'; err.style.display = 'block'; return;
      }
      apiCall('POST', '/api/production?action=save_transfer', {
        from_sku_id: skuId, to_sku_id: parseInt(toSku, 10), entry_date: _ps.entryDate,
        lbs: Number(lbs), note: note || null
      }).then(function () {
        document.getElementById('pr-adj-modal').remove();
        toast('Transfer saved');
        loadDaily();
      }).catch(function (e) { err.textContent = e.message; err.style.display = 'block'; });
    }
  }

  function prDeleteAdjustment(id) {
    if (!confirm('Delete this adjustment? If it\'s part of a pool transfer, both sides will be removed.')) return;
    apiCall('POST', '/api/production?action=delete_adjustment', { id: id })
      .then(function () {
        var m = document.getElementById('pr-adj-modal'); if (m) m.remove();
        toast('Deleted');
        loadDaily();
      })
      .catch(function (err) { toast('⚠️ ' + err.message); });
  }

  // ═══ WEEKLY ROLL ═══════════════════════════════════════════════════════
  function loadWeekly() {
    var panel = document.getElementById('widget-content');
    panel.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner-wrap"><div class="spinner"></div></div>Loading week…</div>';
    apiCall('GET', '/api/production?action=get_week&week_start=' + _ps.weekStart)
      .then(function (r) {
        _ps.week = r;
        renderWeekly();
      })
      .catch(function (err) {
        panel.innerHTML = '<div style="padding:20px;color:#ef4444">Failed: ' + esc(err.message) + '</div>';
      });
  }

  function renderWeekly() {
    var panel = document.getElementById('widget-content');
    var days = _ps.week.days || [];
    var rows = (_ps.week.rows || []).filter(function (r) { return r.pool === _ps.activePool; });

    var html = '<div style="padding:14px;max-width:100%;margin:0 auto">';

    // Header: week nav
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;background:#fff;border-radius:10px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<button style="' + BTN_SUB + '" onclick="prWeekStep(-1)">← Prev Week</button>'
      + '<button style="' + BTN_SUB + '" onclick="prThisWeek()">This Week</button>'
      + '<button style="' + BTN_SUB + '" onclick="prWeekStep(1)">Next Week →</button>'
      + '<div style="flex:1;font-weight:700;color:#1a3a6b;font-size:.94rem;margin-left:10px">Week of ' + esc(_ps.weekStart) + '</div>'
      + '</div>';

    // Pool pills
    html += '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
    POOLS.forEach(function (p) {
      var active = (p === _ps.activePool);
      html += '<button onclick="prSelectPoolWeek(\'' + p + '\')" style="padding:7px 14px;border-radius:8px;border:1px solid ' + (active ? '#1a3a6b' : '#cbd5e1') + ';background:' + (active ? '#1a3a6b' : '#fff') + ';color:' + (active ? '#fff' : '#334155') + ';font-size:.78rem;font-weight:600;cursor:pointer">' + p + '</button>';
    });
    html += '</div>';

    // Table. Column order: Item | Lbs/Case | MON..SAT + MON2 + TUE2 | CASES | LBS
    html += '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:auto">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:.76rem"><thead><tr style="background:#1a3a6b;color:#fff">'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600;min-width:160px;position:sticky;left:0;background:#1a3a6b;z-index:2">Item</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:66px;font-size:.68rem;opacity:.85">Lbs/Case</th>';
    days.forEach(function (d, i) {
      var label = (i === 7) ? 'TUE2' : (i === 6 ? 'MON2' : dayAbbr(d));
      html += '<th style="padding:8px 6px;text-align:right;font-weight:600;min-width:70px">' + label + '<br><span style="font-size:.62rem;opacity:.75;font-weight:400">' + d.slice(5) + '</span></th>';
    });
    html += '<th style="padding:8px 10px;text-align:right;font-weight:600">Cases</th>'
      + '<th style="padding:8px 10px;text-align:right;font-weight:600;background:#0f766e">LBS</th>';
    html += '</tr></thead><tbody>';

    // Category grouping
    var byCat = {};
    rows.forEach(function (r) { var c = r.category || 'OTHER'; if (!byCat[c]) byCat[c] = []; byCat[c].push(r); });
    var poolTotalDays = new Array(days.length).fill(0);
    var poolTotalLbs = 0;
    var poolTotalCases = 0;
    var colSpan = days.length + 4; // Item + Lbs/Case + days + Cases + LBS

    Object.keys(byCat).sort().forEach(function (cat) {
      html += '<tr style="background:#f8fafc"><td colspan="' + colSpan + '" style="padding:6px 10px;font-size:.7rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.05em;position:sticky;left:0;background:#f8fafc">' + esc(cat) + '</td></tr>';
      byCat[cat].forEach(function (r) {
        var casesCell = (r.lbs_per_case == null) ? '—' : esc(String(r.lbs_per_case));
        html += '<tr>'
          + '<td style="padding:5px 10px;color:#0f172a;position:sticky;left:0;background:#fff">' + esc(r.item_name) + '</td>'
          + '<td style="padding:5px 6px;text-align:right;color:#64748b;font-size:.74rem">' + casesCell + '</td>';
        (r.daily || []).forEach(function (v, i) {
          poolTotalDays[i] += Number(v || 0);
          html += '<td style="padding:5px 6px;text-align:right;color:' + (v > 0 ? '#0f172a' : '#cbd5e1') + '">' + (v > 0 ? fmtLbs(v) : '—') + '</td>';
        });
        poolTotalLbs += Number(r.total_lbs || 0);
        if (r.total_cases != null) poolTotalCases += Number(r.total_cases);
        html += '<td style="padding:5px 10px;text-align:right;color:#334155">' + (r.total_cases != null && r.total_cases > 0 ? Number(r.total_cases).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—') + '</td>';
        html += '<td style="padding:5px 10px;text-align:right;color:#0f766e;font-weight:700">' + (r.total_lbs > 0 ? fmtLbs(r.total_lbs) : '—') + '</td></tr>';
      });
    });

    html += '<tr style="background:#f1f5f9;font-weight:700">'
      + '<td style="padding:10px;position:sticky;left:0;background:#f1f5f9">TOTAL ' + _ps.activePool + '</td>'
      + '<td></td>';
    poolTotalDays.forEach(function (v) {
      html += '<td style="padding:10px 6px;text-align:right">' + (v > 0 ? fmtLbs(v) : '—') + '</td>';
    });
    html += '<td style="padding:10px;text-align:right">' + (poolTotalCases > 0 ? Number(poolTotalCases).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—') + '</td>';
    html += '<td style="padding:10px;text-align:right;color:#0f766e">' + (poolTotalLbs > 0 ? fmtLbs(poolTotalLbs) : '—') + '</td></tr>';

    html += '</tbody></table></div></div>';
    panel.innerHTML = html;
  }

  function prWeekStep(delta) { _ps.weekStart = addDays(_ps.weekStart, delta * 7); loadWeekly(); }
  function prThisWeek() { _ps.weekStart = mondayOf(); loadWeekly(); }
  function prSelectPoolWeek(p) { _ps.activePool = p; renderWeekly(); }

  // ═══ SKU TAB ═══════════════════════════════════════════════════════════
  function loadSkus() {
    var panel = document.getElementById('widget-content');
    panel.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner-wrap"><div class="spinner"></div></div>Loading SKUs…</div>';
    apiCall('GET', '/api/production?action=get_skus')
      .then(function (r) { _ps.skus = r.skus || []; renderSkus(); })
      .catch(function (err) {
        panel.innerHTML = '<div style="padding:20px;color:#ef4444">Failed: ' + esc(err.message) + '</div>';
      });
  }

  function renderSkus() {
    var panel = document.getElementById('widget-content');
    var isAdmin = (typeof userCan === 'function') && userCan('settings', 'view');
    var canCreate = (typeof userCan === 'function') && userCan('production', 'create');
    var canEdit = (typeof userCan === 'function') && userCan('production', 'edit');
    var canDelete = (typeof userCan === 'function') && userCan('production', 'delete');

    var html = '<div style="padding:14px;max-width:980px;margin:0 auto">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">'
      + '<div style="font-weight:700;color:#1a3a6b;font-size:1rem">🗂️ SKU Catalog <span style="font-weight:400;color:#64748b;font-size:.82rem">(' + _ps.skus.length + ' active)</span></div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
      + (isAdmin ? '<button style="' + BTN_SUB + '" onclick="prSeedSkus()">📥 Seed from Excel</button>' : '')
      + (canCreate ? '<button style="' + BTN_P + '" onclick="prEditSku(null)">+ Add SKU</button>' : '')
      + '</div></div>';

    if (_ps.skus.length === 0) {
      html += '<div style="background:#fef3c7;border:1px solid #fde68a;padding:16px;border-radius:8px;color:#92400e;font-size:.86rem">'
        + 'No SKUs yet. ' + (isAdmin ? 'Click <strong>📥 Seed from Excel</strong> above to install the ~100 SKUs from yield master-2026.xlsx.' : 'Ask an admin to seed the catalog.')
        + '</div></div>';
      panel.innerHTML = html;
      return;
    }

    // Group by pool
    POOLS.forEach(function (p) {
      var poolSkus = _ps.skus.filter(function (s) { return s.pool === p; });
      if (!poolSkus.length) return;
      html += '<div style="margin-bottom:14px;background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden">'
        + '<div style="background:#1a3a6b;color:#fff;padding:8px 14px;font-weight:700;font-size:.86rem">' + p + ' <span style="opacity:.8;font-weight:400">(' + poolSkus.length + ')</span></div>'
        + '<table style="width:100%;border-collapse:collapse;font-size:.78rem"><thead><tr style="background:#f1f5f9">'
        + '<th style="padding:6px 10px;text-align:left;color:#475569">Item</th>'
        + '<th style="padding:6px 10px;text-align:left;color:#475569;width:100px">SKU</th>'
        + '<th style="padding:6px 10px;text-align:left;color:#475569;width:100px">Category</th>'
        + '<th style="padding:6px 10px;text-align:right;color:#475569;width:80px">Lbs/Case</th>'
        + '<th style="padding:6px 10px;text-align:right;color:#475569;width:140px"></th>'
        + '</tr></thead><tbody>';
      poolSkus.forEach(function (s) {
        html += '<tr><td style="padding:5px 10px;color:#0f172a;font-weight:500">' + esc(s.item_name) + '</td>'
          + '<td style="padding:5px 10px;color:#64748b;font-family:ui-monospace,monospace;font-size:.72rem">' + esc(s.sku || '—') + '</td>'
          + '<td style="padding:5px 10px;color:#64748b">' + esc(s.category || '—') + '</td>'
          + '<td style="padding:5px 10px;text-align:right;color:#64748b">' + (s.lbs_per_case || '—') + '</td>'
          + '<td style="padding:5px 10px;text-align:right">'
          + (canEdit ? '<button style="' + BTN_SUB + ';padding:3px 9px;font-size:.72rem" onclick="prEditSku(' + s.id + ')">Edit</button> ' : '')
          + (canDelete ? '<button style="' + BTN_D + '" onclick="prArchiveSku(' + s.id + ',\'' + esc(s.item_name).replace(/'/g, '') + '\')">Remove</button>' : '')
          + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });

    html += '</div>';
    panel.innerHTML = html;
  }

  function prEditSku(id) {
    var s = id ? _ps.skus.find(function (x) { return x.id === id; }) : null;
    var overlay = document.createElement('div');
    overlay.id = 'pr-sku-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    var poolOpts = POOLS.map(function (p) { return '<option value="' + p + '"' + (s && s.pool === p ? ' selected' : '') + '>' + p + '</option>'; }).join('');
    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:20px;max-width:440px;width:100%">'
      + '<div style="font-weight:700;color:#1a3a6b;font-size:1.05rem;margin-bottom:12px">' + (s ? '✎ Edit SKU' : '+ New SKU') + '</div>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Item Name</label>'
      + '<input id="pr-s-name" placeholder="e.g., FILET 3-5" value="' + esc(s ? s.item_name : '') + '" style="' + INP + '">'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">SKU <span style="color:#94a3b8;font-weight:400">(optional)</span></label>'
      + '<input id="pr-s-sku" placeholder="e.g., 1032011" value="' + esc(s ? s.sku : '') + '" style="' + INP + '">'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Pool</label>'
      + '<select id="pr-s-pool" style="' + INP + '">' + poolOpts + '</select>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Category <span style="color:#94a3b8;font-weight:400">(WHOLE, FILET, SPLITS, etc.)</span></label>'
      + '<input id="pr-s-cat" placeholder="e.g., FILET" value="' + esc(s ? s.category : '') + '" style="' + INP + '">'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Lbs per case <span style="color:#94a3b8;font-weight:400">(optional)</span></label>'
      + '<input id="pr-s-lbs" type="number" step="0.01" placeholder="e.g., 15" value="' + (s && s.lbs_per_case != null ? s.lbs_per_case : '') + '" style="' + INP + '">'
      + '<div id="pr-s-err" style="color:#ef4444;font-size:.76rem;margin-top:6px;display:none"></div>'
      + '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">'
      + '<button style="' + BTN_SUB + ';padding:8px 14px" onclick="document.getElementById(\'pr-sku-modal\').remove()">Cancel</button>'
      + '<button style="' + BTN_P + ';padding:8px 14px" onclick="prSaveSku(' + (id || 'null') + ')">Save</button>'
      + '</div></div>';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    setTimeout(function () { var el = document.getElementById('pr-s-name'); if (el) el.focus(); }, 80);
  }

  function prSaveSku(id) {
    var body = {
      item_name: document.getElementById('pr-s-name').value.trim(),
      sku: document.getElementById('pr-s-sku').value.trim(),
      pool: document.getElementById('pr-s-pool').value,
      category: document.getElementById('pr-s-cat').value.trim() || null,
      lbs_per_case: document.getElementById('pr-s-lbs').value === '' ? null : Number(document.getElementById('pr-s-lbs').value)
    };
    var err = document.getElementById('pr-s-err');
    err.style.display = 'none';
    if (!body.item_name) { err.textContent = 'Item name is required.'; err.style.display = 'block'; return; }
    if (id) body.id = id;
    apiCall('POST', '/api/production?action=save_sku', body)
      .then(function () {
        document.getElementById('pr-sku-modal').remove();
        toast(id ? 'Saved' : 'SKU added');
        loadSkus();
      })
      .catch(function (e) { err.textContent = e.message; err.style.display = 'block'; });
  }

  function prArchiveSku(id, name) {
    if (!confirm('Archive "' + name + '"? Historical daily entries remain intact but it won\'t appear in the daily grid for new entries.')) return;
    apiCall('POST', '/api/production?action=archive_sku', { id: id })
      .then(function () { toast('Archived'); loadSkus(); })
      .catch(function (err) { toast('⚠️ ' + err.message); });
  }

  function prSeedSkus() {
    if (!confirm('Seed / refresh SKUs from yield master-2026.xlsx?\n\nThis will also clean up existing SKU names (strip "15#" / "24# CARTON" suffixes) and fill in Lbs/Case values where missing. Safe to run multiple times — your daily entries and adjustments are never touched.')) return;
    apiCall('POST', '/api/production?action=seed_skus', {})
      .then(function (r) {
        var parts = [];
        if (r.created) parts.push(r.created + ' new SKU' + (r.created === 1 ? '' : 's'));
        if (r.renamed) parts.push(r.renamed + ' renamed');
        if (r.case_filled) parts.push(r.case_filled + ' Lbs/Case filled');
        if (r.skipped) parts.push(r.skipped + ' already up-to-date');
        var msg = parts.length ? 'Seed complete: ' + parts.join(' · ') + '.' : 'Everything already up-to-date.';
        toast(msg);
        if (_ps.tab === 'skus') loadSkus(); else prShowTab('daily');
      })
      .catch(function (err) { toast('⚠️ Seed failed: ' + err.message); });
  }

  // ═══ EXPORTS ══════════════════════════════════════════════════════════
  window.buildProductionWidget = buildProductionWidget;
  window.prShowTab = prShowTab;
  window.prSetDate = prSetDate;
  window.prDateStep = prDateStep;
  window.prToday = prToday;
  window.prSelectPool = prSelectPool;
  window.prSaveCell = prSaveCell;
  window.prOpenAdjust = prOpenAdjust;
  window.prAdjTab = prAdjTab;
  window.prSaveAdjustment = prSaveAdjustment;
  window.prDeleteAdjustment = prDeleteAdjustment;
  window.prWeekStep = prWeekStep;
  window.prThisWeek = prThisWeek;
  window.prSelectPoolWeek = prSelectPoolWeek;
  window.prEditSku = prEditSku;
  window.prSaveSku = prSaveSku;
  window.prArchiveSku = prArchiveSku;
  window.prSeedSkus = prSeedSkus;
})();
