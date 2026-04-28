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
  // COOLER pool was retired — archived at the backend so existing SKUs stop
  // appearing in the daily grid. Leaving it out of POOLS removes the tab
  // and filters from the UI.
  var POOLS = ['FREEZER-IQF', 'ICE PACK'];

  var _ps = {
    tab: 'daily',
    entryDate: '',         // ISO YYYY-MM-DD for daily tab
    activePool: 'FREEZER-IQF',
    weekStart: '',         // Monday of selected week (weekly tab)
    day: null,             // cached daily response
    week: null,            // cached weekly response
    skus: [],
    showArchived: false    // SKUs tab + Daily Entry: hide archived by default
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
  // Monday-of-week: operational work week starts Mon, ends Sun. Given
  // any ISO date, returns that week's Monday.
  function mondayOf(iso) {
    var d = new Date((iso || todayIso()) + 'T00:00:00');
    var dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    var back = dow === 0 ? 6 : dow - 1; // Sun→6 back, Mon→0, Sat→5
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
    var url = '/api/production?action=get_day&entry_date=' + _ps.entryDate
      + (_ps.showArchived ? '&showArchived=1' : '');
    apiCall('GET', url)
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
      + '<label style="font-size:.74rem;color:#64748b;display:flex;align-items:center;gap:5px;cursor:pointer" title="Toggle inactive/archived items">'
      + '<input type="checkbox"' + (_ps.showArchived ? ' checked' : '') + ' onchange="prToggleArchived(this.checked)"> Show inactive</label>'
      + '<div style="font-size:.72rem;color:#64748b">Last Week column = freezer attributed to prior week\'s yield (still adds to today\'s inventory)</div>'
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

    // Filter to active pool. Items render in display_order (set by the seed /
    // SKUs tab) — no category re-sort, so Daily Entry reads top-to-bottom
    // like the paper inventory sheet.
    var poolRows = rows.filter(function (r) { return r.pool === _ps.activePool; });

    // Pool totals — split catfish (raw/primary product) from hushpuppies
    // (the JALAPENO / REGULAR 1# and 10# packs). They don't combine
    // meaningfully: one is by the case of catfish, the other is a
    // separate hushpuppy product line in its own packaging.
    var catfishTotals = { produced: 0, lw: 0, shipped: 0, balance: 0 };
    var hushTotals    = { produced: 0, lw: 0, shipped: 0, balance: 0 };
    var hasHush = false;
    poolRows.forEach(function (r) {
      var t = (r.category === 'HUSHPUPPIES') ? hushTotals : catfishTotals;
      t.produced += Number(r.produced_lbs || 0);
      t.lw       += Number(r.produced_last_week_lbs || 0);
      t.shipped  += Number(r.shipped_lbs || 0);
      t.balance  += Number(r.balance_lbs || 0);
      if (r.category === 'HUSHPUPPIES') hasHush = true;
    });
    var poolTotals = {
      produced: catfishTotals.produced + hushTotals.produced,
      lw:       catfishTotals.lw       + hushTotals.lw,
      shipped:  catfishTotals.shipped  + hushTotals.shipped,
      balance:  catfishTotals.balance  + hushTotals.balance
    };

    html += '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden">';

    // Table header. Lbs/Case sits right after Item so operators see case
    // context as they scan the row. Grid-style cell borders applied via
    // .pr-grid-table rule in public/css/style.css.
    html += '<table class="pr-grid-table" style="width:100%;border-collapse:collapse;font-size:.78rem">'
      + '<thead style="position:sticky;top:0;background:#1a3a6b;color:#fff;z-index:1"><tr>'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600;min-width:140px">Item</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:60px;font-size:.68rem;opacity:.85">Lbs/Case</th>'
      + '<th style="padding:8px 6px;text-align:left;font-weight:600;width:80px;font-size:.68rem;opacity:.85">SKU</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:70px">Begin</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:90px;background:#1e40af">Freezer</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:90px;background:#7c3aed" title="Freezer counted toward LAST week\'s yield (still adds to today\'s inventory)">Last Week</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:80px">Adjust</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:80px">Shipped</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:80px;background:#0f766e">Balance</th>'
      + '</tr></thead><tbody>';

    // Render rows in display_order — flat list mirrors the PDF sequence.
    poolRows.forEach(function (r) {
      html += renderDailyRow(r, canEdit || canCreate);
    });

    // Totals footer. If hushpuppy items are present, break totals into
    // Catfish / Hushpuppies / Grand rows so the two product lines are
    // reported separately. Grand total row gets a heavy top border + a
    // light indigo background so the dark color-coded numbers stay
    // readable (the old navy/white treatment washed the numbers out).
    function totalsRow(opts) {
      var bg = opts.bg;
      var labelColor = opts.labelColor || '#0f172a';
      var numColor = opts.numColor || '#0f172a';
      var balColor = opts.balColor || '#065f46';
      var prodColor = opts.prodColor || '#1e40af';
      var lwColor = '#7c3aed'; // matches the LW Freezer header background
      var topBorder = opts.grand ? 'border-top:3px double #1a3a6b;' : '';
      var fontSize = opts.grand ? 'font-size:.86rem;' : '';
      // Columns: Item | Lbs/Case | SKU | Begin | Freezer | Last Week | Adjust | Shipped | Balance
      return '<tr style="background:' + bg + ';font-weight:700;color:' + labelColor + ';' + topBorder + fontSize + '">'
        + '<td style="padding:9px 10px;' + topBorder + '" colspan="4">' + opts.label + '</td>'
        + '<td style="padding:9px 6px;text-align:right;color:' + prodColor + ';' + topBorder + '">' + fmtLbs(opts.t.produced) + '</td>'
        + '<td style="padding:9px 6px;text-align:right;color:' + lwColor + ';' + topBorder + '">' + (opts.t.lw ? fmtLbs(opts.t.lw) : '—') + '</td>'
        + '<td style="' + topBorder + '"></td>'
        + '<td style="padding:9px 6px;text-align:right;color:' + numColor + ';' + topBorder + '">' + fmtLbs(opts.t.shipped) + '</td>'
        + '<td style="padding:9px 6px;text-align:right;color:' + balColor + ';' + topBorder + '">' + fmtLbs(opts.t.balance) + '</td>'
        + '</tr>';
    }
    if (hasHush) {
      html += totalsRow({ label: 'Catfish Subtotal',     t: catfishTotals, bg: '#f1f5f9' });
      html += totalsRow({ label: 'Hushpuppies Subtotal', t: hushTotals,    bg: '#fef3c7', labelColor: '#9a3412' });
      html += totalsRow({ label: 'TOTAL ' + _ps.activePool, t: poolTotals, bg: '#e0e7ff', labelColor: '#1a3a6b', grand: true });
    } else {
      html += totalsRow({ label: 'TOTAL ' + _ps.activePool, t: poolTotals, bg: '#e0e7ff', labelColor: '#1a3a6b', grand: true });
    }

    html += '</tbody></table></div>';
    html += '</div>';
    panel.innerHTML = html;
  }

  function renderDailyRow(r, writable) {
    var readonlyAttr = writable ? '' : ' readonly';
    // Each input fires prRecalcBalance() on every keystroke for instant
    // visual feedback (Balance cell + per-pool totals), and prSaveCell()
    // on blur to actually persist. Save is deferred to blur so we don't
    // hammer the API on every digit typed.
    // step=1 — production is tracked in whole cases. The browser's spinner
    // controls + keyboard arrow keys all advance by 1 now (was 0.1, which
    // produced fractional cases on a single click).
    var producedInput = '<input type="number" step="1" min="0" value="' + (Number(r.produced_lbs) || '') + '" '
      + 'data-sku="' + r.sku_id + '" data-field="produced_lbs" oninput="prRecalcBalance(this)" onblur="prSaveCell(this)" '
      + 'style="' + CELL_INP + ';background:' + (writable ? '#eff6ff' : 'transparent') + '"' + readonlyAttr + ' placeholder="0">';
    // Last Week freezer: poundage frozen TODAY but counted toward LAST
    // week's yield. Same arithmetic as produced_lbs for inventory; the
    // distinction is yield-attribution only.
    var lwInput = '<input type="number" step="1" min="0" value="' + (Number(r.produced_last_week_lbs) || '') + '" '
      + 'data-sku="' + r.sku_id + '" data-field="produced_last_week_lbs" oninput="prRecalcBalance(this)" onblur="prSaveCell(this)" '
      + 'style="' + CELL_INP + ';background:' + (writable ? '#f5f3ff' : 'transparent') + '"' + readonlyAttr + ' placeholder="0">';
    var shippedInput = '<input type="number" step="1" min="0" value="' + (Number(r.shipped_lbs) || '') + '" '
      + 'data-sku="' + r.sku_id + '" data-field="shipped_lbs" oninput="prRecalcBalance(this)" onblur="prSaveCell(this)" '
      + 'style="' + CELL_INP + ';background:' + (writable ? '#fef2f2' : 'transparent') + '"' + readonlyAttr + ' placeholder="0">';
    var adjCell;
    // Adjust column: values are already in cases end-to-end. Just format.
    function fmtAdjLabel() {
      if (!r.adjust_lbs) return '+ Adj';
      return (r.adjust_lbs > 0 ? '+' : '') + Number(r.adjust_lbs).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' cs';
    }
    if (writable) {
      var hasAdj = r.adjust_count > 0;
      var adjColor = r.adjust_lbs > 0 ? '#065f46' : (r.adjust_lbs < 0 ? '#991b1b' : '#64748b');
      adjCell = '<button onclick="prOpenAdjust(' + r.sku_id + ')" style="background:' + (hasAdj ? '#fef3c7' : 'transparent') + ';border:1px dashed #cbd5e1;border-radius:4px;padding:3px 8px;font-size:.72rem;color:' + adjColor + ';cursor:pointer;width:100%;font-weight:' + (hasAdj ? '700' : '500') + '">'
        + fmtAdjLabel() + (hasAdj ? ' ·' + r.adjust_count : '') + '</button>';
    } else {
      adjCell = '<span style="font-size:.72rem;color:#64748b">' + (r.adjust_lbs === 0 ? '—' : fmtAdjLabel()) + '</span>';
    }
    // Lbs/Case cell — COOLER items have null (tubs not cases) → em-dash.
    var casesCell = (r.lbs_per_case == null || r.lbs_per_case === '')
      ? '<span style="color:#cbd5e1">—</span>'
      : esc(String(r.lbs_per_case));
    return '<tr>'
      + '<td style="padding:5px 10px;color:#0f172a;font-weight:500">' + esc(r.item_name) + '</td>'
      + '<td style="padding:5px 6px;text-align:right;color:#64748b;font-size:.74rem">' + casesCell + '</td>'
      + '<td style="padding:5px 6px;color:#64748b;font-family:ui-monospace,monospace;font-size:.68rem">' + esc(r.sku || '') + '</td>'
      + '<td style="padding:5px 6px;text-align:right;color:#64748b">' + (r.begin_lbs === 0 ? '—' : fmtLbs(r.begin_lbs)) + '</td>'
      + '<td style="padding:3px 4px">' + producedInput + '</td>'
      + '<td style="padding:3px 4px">' + lwInput + '</td>'
      + '<td style="padding:3px 4px">' + adjCell + '</td>'
      + '<td style="padding:3px 4px">' + shippedInput + '</td>'
      + '<td style="padding:5px 6px;text-align:right;color:' + (r.balance_lbs === 0 ? '#cbd5e1' : '#0f766e') + ';font-weight:700">' + fmtLbs(r.balance_lbs) + '</td>'
      + '</tr>';
  }

  // Live balance recompute. Called on every keystroke (oninput) for any of
  // the three editable cells (Freezer / Last Week / Shipped). Reads current
  // values straight from the DOM so it reflects unsaved typing too. Updates:
  //   - this row's Balance cell
  //   - the pool's subtotal/grand-total rows at the bottom of the table
  // Pure DOM update — no save fires from here. Save happens on blur via
  // prSaveCell.
  function prRecalcBalance(input) {
    var skuId = parseInt(input.getAttribute('data-sku'), 10);
    var row = (_ps.day.rows || []).find(function (r) { return r.sku_id === skuId; });
    if (!row) return;
    var tr = input.closest('tr');
    if (!tr) return;
    var v = function (sel) {
      var el = tr.querySelector(sel);
      if (!el || el.value === '') return 0;
      var n = Number(el.value);
      return isNaN(n) ? 0 : n;
    };
    var produced = v('input[data-field="produced_lbs"]');
    var producedLW = v('input[data-field="produced_last_week_lbs"]');
    var shipped = v('input[data-field="shipped_lbs"]');
    // Mutate local state so prSaveCell + totals see the live values.
    row.produced_lbs = produced;
    row.produced_last_week_lbs = producedLW;
    row.shipped_lbs = shipped;
    row.balance_lbs = Number(row.begin_lbs || 0)
      + produced + producedLW + Number(row.adjust_lbs || 0) - shipped;

    // Balance cell — column index 8 in the new layout
    // (Item | Lbs/Case | SKU | Begin | Freezer | Last Week | Adjust | Shipped | Balance)
    var cells = tr.querySelectorAll('td');
    if (cells && cells.length >= 9) {
      cells[8].textContent = fmtLbs(row.balance_lbs);
      cells[8].style.color = row.balance_lbs === 0 ? '#cbd5e1' : '#0f766e';
    }

    // Refresh the totals rows at the bottom of the table so subtotals +
    // grand total reflect the current edits without a full re-render.
    prRecalcPoolTotals();
  }

  // Recompute pool subtotals + grand total and update the matching <tr>s
  // at the bottom of the active pool table. Mirrors the math in renderDaily.
  function prRecalcPoolTotals() {
    if (!_ps.day || !_ps.day.rows) return;
    var poolRows = _ps.day.rows.filter(function (r) { return r.pool === _ps.activePool; });
    var cat = { produced: 0, lw: 0, shipped: 0, balance: 0 };
    var hush = { produced: 0, lw: 0, shipped: 0, balance: 0 };
    var hasHush = false;
    poolRows.forEach(function (r) {
      var t = (r.category === 'HUSHPUPPIES') ? hush : cat;
      t.produced += Number(r.produced_lbs || 0);
      t.lw       += Number(r.produced_last_week_lbs || 0);
      t.shipped  += Number(r.shipped_lbs || 0);
      t.balance  += Number(r.balance_lbs || 0);
      if (r.category === 'HUSHPUPPIES') hasHush = true;
    });
    var total = {
      produced: cat.produced + hush.produced,
      lw:       cat.lw       + hush.lw,
      shipped:  cat.shipped  + hush.shipped,
      balance:  cat.balance  + hush.balance
    };
    // Walk each totals row by its background color (set in totalsRow()).
    // colspan=4 label cell + 5 numeric cells = produced/lw/(blank)/shipped/balance.
    var trs = document.querySelectorAll('table.pr-grid-table tr[style*="font-weight:700"]');
    trs.forEach(function (tr) {
      var tds = tr.querySelectorAll('td');
      if (tds.length < 6) return;
      // label, produced, lw, blank, shipped, balance
      var label = (tds[0].textContent || '').trim();
      var t = null;
      if (label.indexOf('Catfish Subtotal') === 0) t = cat;
      else if (label.indexOf('Hushpuppies') === 0) t = hush;
      else if (label.indexOf('TOTAL ') === 0) t = total;
      if (!t) return;
      tds[1].textContent = fmtLbs(t.produced);
      tds[2].textContent = t.lw ? fmtLbs(t.lw) : '—';
      tds[4].textContent = fmtLbs(t.shipped);
      tds[5].textContent = fmtLbs(t.balance);
    });
  }

  function prSaveCell(input) {
    var skuId = parseInt(input.getAttribute('data-sku'), 10);
    var value = input.value === '' ? 0 : Number(input.value);
    if (isNaN(value) || value < 0) { toast('⚠️ Enter a non-negative number'); input.focus(); return; }

    // Make sure local state + DOM are in sync (live recalc may have already
    // run via oninput, but blur without typing wouldn't have fired it).
    prRecalcBalance(input);

    var row = (_ps.day.rows || []).find(function (r) { return r.sku_id === skuId; });
    if (!row) return;

    apiCall('POST', '/api/production?action=save_entry', {
      sku_id: skuId, entry_date: _ps.entryDate,
      produced_lbs: Number(row.produced_lbs || 0),
      produced_last_week_lbs: Number(row.produced_last_week_lbs || 0),
      shipped_lbs: Number(row.shipped_lbs || 0)
    }).catch(function (err) {
      toast('⚠️ Save failed: ' + err.message);
      loadDaily(); // full reload reverts the optimistic in-memory state
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

    var rowLbsPerCase = row.lbs_per_case && row.lbs_per_case > 0 ? Number(row.lbs_per_case) : null;

    // Existing adjustments — already in cases end-to-end. Show the lbs
    // equivalent in muted text for sanity-checking.
    var existingHtml = '';
    if (row.adjustments && row.adjustments.length) {
      existingHtml = '<div style="margin-top:10px;border-top:1px solid #e2e8f0;padding-top:10px"><div style="font-size:.72rem;color:#475569;font-weight:700;margin-bottom:6px">EXISTING ADJUSTMENTS TODAY</div>';
      row.adjustments.forEach(function (a) {
        var color = a.delta > 0 ? '#065f46' : '#991b1b';
        var sign = a.delta > 0 ? '+' : '';
        var display;
        if (rowLbsPerCase) {
          var lbs = Number(a.delta) * rowLbsPerCase;
          display = sign + Number(a.delta).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' cs <span style="font-weight:400;color:#64748b;font-size:.7rem">(' + sign + fmtLbs(lbs) + ' lbs)</span>';
        } else {
          display = sign + Number(a.delta) + ' cs';
        }
        existingHtml += '<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #f1f5f9">'
          + '<span style="font-weight:700;color:' + color + ';min-width:160px">' + display + '</span>'
          + '<span style="flex:1;font-size:.76rem;color:#334155">' + esc(a.note || '') + (a.transfer_pair_id ? ' <span style="background:#dbeafe;color:#1e40af;padding:1px 5px;border-radius:4px;font-size:.62rem;font-weight:600;margin-left:4px">SWAP</span>' : '') + '</span>'
          + '<button onclick="prDeleteAdjustment(' + a.id + ')" style="' + BTN_D + '">Del</button>'
          + '</div>';
      });
      existingHtml += '</div>';
    }

    // SKU dropdown for swap target. Carries each candidate's lbs_per_case
    // in data-lbs so the live-hint math can pull it without another fetch.
    var transferOpts = (_ps.day.rows || [])
      .filter(function (s) { return s.sku_id !== skuId; })
      .map(function (s) {
        var lbs = s.lbs_per_case && s.lbs_per_case > 0 ? Number(s.lbs_per_case) : '';
        return '<option value="' + s.sku_id + '" data-lbs="' + lbs + '">['
          + s.pool + '] ' + esc(s.item_name)
          + (lbs ? ' (' + lbs + '#)' : '')
          + (s.sku ? ' — ' + esc(s.sku) : '')
          + '</option>';
      })
      .join('');

    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:20px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto">'
      + '<div style="font-weight:700;color:#1a3a6b;font-size:1.05rem;margin-bottom:4px">Adjust: ' + esc(row.item_name) + '</div>'
      + '<div style="font-size:.74rem;color:#64748b;margin-bottom:12px">[' + row.pool + ']'
      + (rowLbsPerCase ? ' · ' + rowLbsPerCase + '# case' : '')
      + (row.sku ? ' · SKU ' + esc(row.sku) : '')
      + ' · Entry date ' + _ps.entryDate + '</div>'

      // Tabs: Correction vs Product Swap
      + '<div style="display:flex;gap:0;border-bottom:1px solid #e2e8f0;margin-bottom:12px">'
      + '<button id="pr-adj-t-simple" onclick="prAdjTab(\'simple\')" style="flex:1;padding:8px;border:none;background:transparent;cursor:pointer;font-size:.78rem;font-weight:600;color:#1a3a6b;border-bottom:2px solid #1a3a6b">Correction</button>'
      + '<button id="pr-adj-t-transfer" onclick="prAdjTab(\'transfer\')" style="flex:1;padding:8px;border:none;background:transparent;cursor:pointer;font-size:.78rem;font-weight:600;color:#94a3b8;border-bottom:2px solid transparent">Product Swap</button>'
      + '</div>'

      // Correction: cases in, cases out
      + '<div id="pr-adj-pane-simple">'
      + '<div style="font-size:.72rem;color:#64748b;margin-bottom:8px">Add or subtract <strong>cases</strong> for this SKU. E.g. <code>-1</code> for a miscount, <code>+2</code> for a late-found pallet.</div>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:6px 0 4px">Cases (±)</label>'
      + '<input id="pr-adj-cases" type="number" step="1" placeholder="e.g., -1 or +2" oninput="prAdjUpdateCasesHint()" style="' + INP + '">'
      + '<div id="pr-adj-cases-hint" style="font-size:.72rem;color:#64748b;margin-top:4px;min-height:1.1em">&nbsp;</div>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Note <span style="font-weight:400;color:#94a3b8">(why)</span></label>'
      + '<input id="pr-adj-note" type="text" placeholder="e.g., recounted, miscount" style="' + INP + '">'
      + '<div id="pr-adj-err" style="color:#ef4444;font-size:.76rem;margin-top:6px;display:none"></div>'
      + '</div>'

      // Product Swap: e.g. 100 cs 3-5 FILET (15#) → 150 cs FILETS POLY BAG (10#)
      + '<div id="pr-adj-pane-transfer" style="display:none">'
      + '<div style="font-size:.72rem;color:#64748b;margin-bottom:10px">Swap this SKU into another SKU (e.g. <em>100 cs 3-5 FILET 15# → 150 cs FILETS POLY BAG 10#</em>). Total lbs on each side are computed — a mismatch means pack yield loss or gain.</div>'

      + '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 12px;margin-bottom:10px">'
      + '<div style="font-size:.7rem;color:#991b1b;font-weight:700;margin-bottom:6px">FROM (this SKU) — removed</div>'
      + '<div style="font-size:.86rem;color:#0f172a;margin-bottom:6px">' + esc(row.item_name) + (rowLbsPerCase ? ' · ' + rowLbsPerCase + '# case' : '') + '</div>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:4px 0 4px">Cases to remove</label>'
      + '<input id="pr-adj-from-cases" type="number" step="1" min="0" placeholder="e.g., 100" oninput="prAdjUpdateTransferHint()" style="' + INP + '">'
      + '<div id="pr-adj-from-hint" style="font-size:.72rem;color:#991b1b;margin-top:4px;min-height:1.1em">&nbsp;</div>'
      + '</div>'

      + '<div style="background:#ecfdf5;border:1px solid #bbf7d0;border-radius:6px;padding:10px 12px;margin-bottom:10px">'
      + '<div style="font-size:.7rem;color:#065f46;font-weight:700;margin-bottom:6px">TO (destination SKU) — added</div>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:0 0 4px">Move to SKU</label>'
      + '<select id="pr-adj-to-sku" onchange="prAdjUpdateTransferHint()" style="' + INP + '">' + transferOpts + '</select>'
      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:8px 0 4px">Cases to add</label>'
      + '<input id="pr-adj-to-cases" type="number" step="1" min="0" placeholder="e.g., 150" oninput="prAdjUpdateTransferHint()" style="' + INP + '">'
      + '<div id="pr-adj-to-hint" style="font-size:.72rem;color:#065f46;margin-top:4px;min-height:1.1em">&nbsp;</div>'
      + '</div>'

      + '<div id="pr-adj-balance-hint" style="font-size:.76rem;color:#64748b;padding:6px 10px;background:#f8fafc;border-radius:6px;margin-bottom:10px;min-height:1.3em">&nbsp;</div>'

      + '<label style="display:block;font-size:.72rem;color:#475569;font-weight:600;margin:4px 0 4px">Note</label>'
      + '<input id="pr-adj-tnote" type="text" placeholder="e.g., repack 3-5 filet into poly bag" style="' + INP + '">'
      + '<div id="pr-adj-terr" style="color:#ef4444;font-size:.76rem;margin-top:6px;display:none"></div>'
      + '</div>'

      + existingHtml

      + '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">'
      + '<button style="' + BTN_SUB + ';padding:8px 14px" onclick="document.getElementById(\'pr-adj-modal\').remove()">Close</button>'
      + '<button id="pr-adj-save" style="' + BTN_P + ';padding:8px 14px" onclick="prSaveAdjustment(' + skuId + ')">Add Correction</button>'
      + '</div>'
      + '</div>';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    // Stash the row's lbs/case on the modal so the helpers can read it
    overlay.dataset.lbsPerCase = rowLbsPerCase || '';
    document.body.appendChild(overlay);
    setTimeout(function () { var el = document.getElementById('pr-adj-cases'); if (el) el.focus(); }, 80);
  }

  // Live "= X lbs" hint under the Correction cases input
  function prAdjUpdateCasesHint() {
    var overlay = document.getElementById('pr-adj-modal');
    if (!overlay) return;
    var lpc = Number(overlay.dataset.lbsPerCase) || null;
    var hint = document.getElementById('pr-adj-cases-hint');
    var v = document.getElementById('pr-adj-cases').value;
    if (v === '' || isNaN(Number(v)) || Number(v) === 0 || !lpc) {
      hint.textContent = '\u00a0';
      return;
    }
    var lbs = Number(v) * lpc;
    hint.textContent = '= ' + (lbs > 0 ? '+' : '') + fmtLbs(lbs) + ' lbs';
    hint.style.color = lbs > 0 ? '#065f46' : '#991b1b';
  }

  // Live hints for Product Swap: from lbs, to lbs, and a balance check row
  function prAdjUpdateTransferHint() {
    var overlay = document.getElementById('pr-adj-modal');
    if (!overlay) return;
    var fromLpc = Number(overlay.dataset.lbsPerCase) || null;
    var fromCases = Number(document.getElementById('pr-adj-from-cases').value);
    var toSel = document.getElementById('pr-adj-to-sku');
    var toCases = Number(document.getElementById('pr-adj-to-cases').value);
    var toLpc = (toSel && toSel.selectedOptions[0])
      ? Number(toSel.selectedOptions[0].getAttribute('data-lbs')) : null;

    var fromHint = document.getElementById('pr-adj-from-hint');
    var toHint = document.getElementById('pr-adj-to-hint');
    var balHint = document.getElementById('pr-adj-balance-hint');

    var fromLbs = (fromCases > 0 && fromLpc) ? fromCases * fromLpc : null;
    var toLbs = (toCases > 0 && toLpc) ? toCases * toLpc : null;

    fromHint.textContent = fromLbs != null ? '= ' + fmtLbs(fromLbs) + ' lbs out' : '\u00a0';
    toHint.textContent = toLbs != null ? '= ' + fmtLbs(toLbs) + ' lbs in' : '\u00a0';

    if (fromLbs != null && toLbs != null) {
      var delta = toLbs - fromLbs;
      if (Math.abs(delta) < 0.05) {
        balHint.innerHTML = '✓ Balanced — ' + fmtLbs(fromLbs) + ' lbs both sides.';
        balHint.style.color = '#065f46';
        balHint.style.background = '#ecfdf5';
      } else {
        var sign = delta > 0 ? '+' : '';
        balHint.innerHTML = '⚠ Off by ' + sign + fmtLbs(delta) + ' lbs (' + (delta > 0 ? 'gain' : 'yield loss') + '). You can still save — the mismatch shows up in the audit trail.';
        balHint.style.color = '#92400e';
        balHint.style.background = '#fef3c7';
      }
    } else {
      balHint.innerHTML = '&nbsp;';
      balHint.style.background = '#f8fafc';
      balHint.style.color = '#64748b';
    }
  }

  function prAdjTab(which) {
    document.getElementById('pr-adj-pane-simple').style.display = (which === 'simple' ? 'block' : 'none');
    document.getElementById('pr-adj-pane-transfer').style.display = (which === 'transfer' ? 'block' : 'none');
    document.getElementById('pr-adj-t-simple').style.color = which === 'simple' ? '#1a3a6b' : '#94a3b8';
    document.getElementById('pr-adj-t-simple').style.borderBottomColor = which === 'simple' ? '#1a3a6b' : 'transparent';
    document.getElementById('pr-adj-t-transfer').style.color = which === 'transfer' ? '#1a3a6b' : '#94a3b8';
    document.getElementById('pr-adj-t-transfer').style.borderBottomColor = which === 'transfer' ? '#1a3a6b' : 'transparent';
    var btn = document.getElementById('pr-adj-save');
    btn.textContent = which === 'simple' ? 'Add Correction' : 'Save Swap';
    btn.setAttribute('data-which', which);
  }

  function prSaveAdjustment(skuId) {
    var btn = document.getElementById('pr-adj-save');
    var which = btn.getAttribute('data-which') || 'simple';
    var overlay = document.getElementById('pr-adj-modal');
    var fromLpc = overlay && overlay.dataset.lbsPerCase ? Number(overlay.dataset.lbsPerCase) : null;

    if (which === 'simple') {
      // Correction: the widget operates in CASES end-to-end, so the number
      // the user types goes straight through — no lbs_per_case multiplication
      // (the misnamed "delta_lbs" column stores cases; see api/production.js
      // ensureTables comment).
      var cases = document.getElementById('pr-adj-cases').value;
      var note = document.getElementById('pr-adj-note').value.trim();
      var err = document.getElementById('pr-adj-err');
      err.style.display = 'none';
      if (cases === '' || isNaN(Number(cases)) || Number(cases) === 0) {
        err.textContent = 'Enter a non-zero number of cases (use negative for subtract).';
        err.style.display = 'block'; return;
      }
      apiCall('POST', '/api/production?action=save_adjustment', {
        sku_id: skuId, entry_date: _ps.entryDate, delta_lbs: Number(cases), note: note || null
      }).then(function () {
        document.getElementById('pr-adj-modal').remove();
        toast('Adjustment saved');
        loadDaily();
      }).catch(function (e) { err.textContent = e.message; err.style.display = 'block'; });
      return;
    }

    // Product Swap — independent cases on each side → independent lbs.
    var toSel = document.getElementById('pr-adj-to-sku');
    var toSku = toSel.value;
    var toLpc = toSel.selectedOptions[0] ? Number(toSel.selectedOptions[0].getAttribute('data-lbs')) : null;
    var fromCases = Number(document.getElementById('pr-adj-from-cases').value);
    var toCases = Number(document.getElementById('pr-adj-to-cases').value);
    var note = document.getElementById('pr-adj-tnote').value.trim();
    var err = document.getElementById('pr-adj-terr');
    err.style.display = 'none';
    if (!toSku) {
      err.textContent = 'Pick a destination SKU.'; err.style.display = 'block'; return;
    }
    if (!(fromCases > 0) || !(toCases > 0)) {
      err.textContent = 'Enter positive case counts on both sides.';
      err.style.display = 'block'; return;
    }
    // Swap: cases passed through as-is. Backend stores them in the
    // (misnamed) delta_lbs columns without multiplication; see the
    // comment on ensureTables in api/production.js. lbs_per_case is
    // still used on the modal's balance-check hint for yield context.
    apiCall('POST', '/api/production?action=save_transfer', {
      from_sku_id: skuId, to_sku_id: parseInt(toSku, 10), entry_date: _ps.entryDate,
      from_lbs: fromCases, to_lbs: toCases, note: note || null
    }).then(function () {
      document.getElementById('pr-adj-modal').remove();
      toast('Swap saved');
      loadDaily();
    }).catch(function (e) { err.textContent = e.message; err.style.display = 'block'; });
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

    // Table. Column order: Item | Lbs/Case | MON..SUN | CASES | LBS
    // Friday's cell auto-includes "Last Week" entries from the following
    // week (Cooper's rule: late freezes attribute to the prior Friday).
    html += '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:auto">';
    html += '<table class="pr-grid-table" style="width:100%;border-collapse:collapse;font-size:.76rem"><thead><tr style="background:#1a3a6b;color:#fff">'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600;min-width:160px;position:sticky;left:0;background:#1a3a6b;z-index:2">Item</th>'
      + '<th style="padding:8px 6px;text-align:right;font-weight:600;width:66px;font-size:.68rem;opacity:.85">Lbs/Case</th>';
    days.forEach(function (d) {
      html += '<th style="padding:8px 6px;text-align:right;font-weight:600;min-width:70px">' + dayAbbr(d) + '<br><span style="font-size:.62rem;opacity:.75;font-weight:400">' + d.slice(5) + '</span></th>';
    });
    html += '<th style="padding:8px 10px;text-align:right;font-weight:600">Cases</th>'
      + '<th style="padding:8px 10px;text-align:right;font-weight:600;background:#0f766e">LBS</th>';
    html += '</tr></thead><tbody>';

    // Flat list in display_order — matches Daily Entry / PDF sequence.
    // Totals split into catfish + hushpuppies (if present) for reporting.
    var poolTotalDays = new Array(days.length).fill(0);
    var poolTotalLbs = 0;
    var poolTotalCases = 0;
    var catfishDays = new Array(days.length).fill(0);
    var catfishLbs = 0, catfishCases = 0;
    var hushDays = new Array(days.length).fill(0);
    var hushLbs = 0, hushCases = 0;
    var hasHushW = false;

    rows.forEach(function (r) {
      var isHush = (r.category === 'HUSHPUPPIES');
      if (isHush) hasHushW = true;
      var casesCell = (r.lbs_per_case == null) ? '—' : esc(String(r.lbs_per_case));
      html += '<tr>'
        + '<td style="padding:5px 10px;color:#0f172a;position:sticky;left:0;background:#fff">' + esc(r.item_name) + '</td>'
        + '<td style="padding:5px 6px;text-align:right;color:#64748b;font-size:.74rem">' + casesCell + '</td>';
      (r.daily || []).forEach(function (v, i) {
        var n = Number(v || 0);
        poolTotalDays[i] += n;
        if (isHush) hushDays[i] += n; else catfishDays[i] += n;
        html += '<td style="padding:5px 6px;text-align:right;color:' + (v > 0 ? '#0f172a' : '#cbd5e1') + '">' + (v > 0 ? fmtLbs(v) : '—') + '</td>';
      });
      var rowLbs = Number(r.total_lbs || 0);
      var rowCases = r.total_cases != null ? Number(r.total_cases) : 0;
      poolTotalLbs += rowLbs;
      poolTotalCases += rowCases;
      if (isHush) { hushLbs += rowLbs; hushCases += rowCases; }
      else        { catfishLbs += rowLbs; catfishCases += rowCases; }
      html += '<td style="padding:5px 10px;text-align:right;color:#334155">' + (rowCases > 0 ? rowCases.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—') + '</td>';
      html += '<td style="padding:5px 10px;text-align:right;color:#0f766e;font-weight:700">' + (rowLbs > 0 ? fmtLbs(rowLbs) : '—') + '</td></tr>';
    });

    // Totals footer — Catfish / Hushpuppies / Grand if hushpuppy items are
    // present, single row otherwise. Grand total gets the double-line top
    // border + light-indigo background; the numbers stay in their normal
    // dark color-coded shades.
    function wkTotalsRow(opts) {
      var bg = opts.bg;
      var labelColor = opts.labelColor || '#0f172a';
      var balColor = opts.balColor || '#0f766e';
      var topBorder = opts.grand ? 'border-top:3px double #1a3a6b;' : '';
      var fontSize = opts.grand ? 'font-size:.82rem;' : '';
      var tr = '<tr style="background:' + bg + ';font-weight:700;color:' + labelColor + ';' + topBorder + fontSize + '">'
        + '<td style="padding:10px;position:sticky;left:0;background:' + bg + ';color:' + labelColor + ';' + topBorder + '">' + opts.label + '</td>'
        + '<td style="' + topBorder + '"></td>';
      opts.days.forEach(function (v) {
        tr += '<td style="padding:10px 6px;text-align:right;color:#0f172a;' + topBorder + '">' + (v > 0 ? fmtLbs(v) : '—') + '</td>';
      });
      tr += '<td style="padding:10px;text-align:right;color:#0f172a;' + topBorder + '">' + (opts.cases > 0 ? Number(opts.cases).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—') + '</td>';
      tr += '<td style="padding:10px;text-align:right;color:' + balColor + ';' + topBorder + '">' + (opts.lbs > 0 ? fmtLbs(opts.lbs) : '—') + '</td></tr>';
      return tr;
    }
    if (hasHushW) {
      html += wkTotalsRow({ label: 'Catfish Subtotal',     days: catfishDays, cases: catfishCases, lbs: catfishLbs, bg: '#f1f5f9' });
      html += wkTotalsRow({ label: 'Hushpuppies Subtotal', days: hushDays,    cases: hushCases,    lbs: hushLbs,    bg: '#fef3c7', labelColor: '#9a3412' });
      html += wkTotalsRow({ label: 'TOTAL ' + _ps.activePool, days: poolTotalDays, cases: poolTotalCases, lbs: poolTotalLbs, bg: '#e0e7ff', labelColor: '#1a3a6b', grand: true });
    } else {
      html += wkTotalsRow({ label: 'TOTAL ' + _ps.activePool, days: poolTotalDays, cases: poolTotalCases, lbs: poolTotalLbs, bg: '#e0e7ff', labelColor: '#1a3a6b', grand: true });
    }

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
    var url = '/api/production?action=get_skus' + (_ps.showArchived ? '&showArchived=1' : '');
    apiCall('GET', url)
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

    var activeCount = _ps.skus.filter(function (s) { return s.active !== false; }).length;
    var archivedCount = _ps.skus.length - activeCount;
    var html = '<div style="padding:14px;max-width:980px;margin:0 auto">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">'
      + '<div style="font-weight:700;color:#1a3a6b;font-size:1rem">🗂️ SKU Catalog <span style="font-weight:400;color:#64748b;font-size:.82rem">(' + activeCount + ' active'
      + (archivedCount ? ' · ' + archivedCount + ' inactive' : '') + ')</span></div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">'
      + '<label style="font-size:.74rem;color:#64748b;display:flex;align-items:center;gap:5px;cursor:pointer">'
      + '<input type="checkbox"' + (_ps.showArchived ? ' checked' : '') + ' onchange="prToggleArchived(this.checked)"> Show inactive</label>'
      + (isAdmin ? '<button style="' + BTN_SUB + '" onclick="prResetCatalog()" title="Wipe catalog and reinstall from the 4/23/2026 inventory PDF">📥 Reset from PDF</button>' : '')
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
        + '<th style="padding:6px 10px;text-align:right;color:#475569;width:80px">Lbs/Case</th>'
        + '<th style="padding:6px 10px;text-align:left;color:#475569;width:100px">SKU</th>'
        + '<th style="padding:6px 10px;text-align:left;color:#475569;width:100px">Category</th>'
        + '<th style="padding:6px 10px;text-align:right;color:#475569;width:140px"></th>'
        + '</tr></thead><tbody>';
      poolSkus.forEach(function (s) {
        var isArchived = s.active === false;
        var rowStyle = isArchived ? 'opacity:0.55;background:#fafbfc' : '';
        html += '<tr style="' + rowStyle + '"><td style="padding:5px 10px;color:' + (isArchived ? '#94a3b8' : '#0f172a') + ';font-weight:500">'
          + esc(s.item_name)
          + (isArchived ? ' <span style="background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:4px;font-size:.64rem;font-weight:700;margin-left:4px">INACTIVE</span>' : '')
          + '</td>'
          + '<td style="padding:5px 10px;text-align:right;color:#64748b">' + (s.lbs_per_case || '—') + '</td>'
          + '<td style="padding:5px 10px;color:#64748b;font-family:ui-monospace,monospace;font-size:.72rem">' + esc(s.sku || '—') + '</td>'
          + '<td style="padding:5px 10px;color:#64748b">' + esc(s.category || '—') + '</td>'
          + '<td style="padding:5px 10px;text-align:right">'
          + (canEdit ? '<button style="' + BTN_SUB + ';padding:3px 9px;font-size:.72rem" onclick="prEditSku(' + s.id + ')">Edit</button> ' : '')
          + (canDelete && !isArchived ? '<button style="' + BTN_D + '" onclick="prArchiveSku(' + s.id + ',\'' + esc(s.item_name).replace(/'/g, '') + '\')">Deactivate</button>' : '')
          + (canDelete && isArchived ? '<button style="background:#dbeafe;color:#1e40af;padding:3px 9px;border:none;border-radius:5px;font-size:.72rem;font-weight:600;cursor:pointer" onclick="prRestoreSku(' + s.id + ')">Restore</button>' : '')
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

  // Toggle "Show inactive" — reloads whatever tab is active with the flag.
  function prToggleArchived(show) {
    _ps.showArchived = !!show;
    if (_ps.tab === 'daily') loadDaily();
    else if (_ps.tab === 'skus') loadSkus();
  }

  // Admin-only: wipes the catalog + reinstalls SEED_SKUS from the 4/23/2026
  // PDF with initial balances. Confirm twice because it archives everything.
  function prResetCatalog() {
    if (!confirm('Reset the SKU catalog from your 4/23/2026 inventory PDF?\n\nThis will DEACTIVATE every current SKU and install the PDF list with its starting balances (total 14,019 cases). Daily entries you\'ve already recorded stay intact.\n\nSafe to run; existing data is not deleted.')) return;
    apiCall('POST', '/api/production?action=reset_catalog', {})
      .then(function (r) {
        toast('Catalog reset: ' + r.created + ' SKUs installed · ' + r.archived + ' archived.');
        if (_ps.tab === 'daily') loadDaily();
        else if (_ps.tab === 'skus') loadSkus();
      })
      .catch(function (err) { toast('⚠️ Reset failed: ' + err.message); });
  }

  function prRestoreSku(id) {
    apiCall('POST', '/api/production?action=restore_sku', { id: id })
      .then(function () { toast('Restored'); loadSkus(); })
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
  window.prRecalcBalance = prRecalcBalance;
  window.prOpenAdjust = prOpenAdjust;
  window.prAdjTab = prAdjTab;
  window.prAdjUpdateCasesHint = prAdjUpdateCasesHint;
  window.prAdjUpdateTransferHint = prAdjUpdateTransferHint;
  window.prSaveAdjustment = prSaveAdjustment;
  window.prDeleteAdjustment = prDeleteAdjustment;
  window.prWeekStep = prWeekStep;
  window.prThisWeek = prThisWeek;
  window.prSelectPoolWeek = prSelectPoolWeek;
  window.prEditSku = prEditSku;
  window.prSaveSku = prSaveSku;
  window.prArchiveSku = prArchiveSku;
  window.prSeedSkus = prSeedSkus;
  window.prToggleArchived = prToggleArchived;
  window.prResetCatalog = prResetCatalog;
  window.prRestoreSku = prRestoreSku;
})();
