// staff-schedule.js — Employee Scheduling widget (Phase 1A)
//
// Two tabs:
//   🗓️ Schedule — week calendar; click any day to add/edit shifts and
//                  assign teams. Shifts have flexible label + start/end
//                  times so a day can have 0, 1, 2, or N shifts.
//   👥 Teams    — manage rotating teams (Team A/B/C/D...) with color,
//                  member roster (free-text list), notes, active/archived.
//
// Production workers don't have portal logins; the read-only TV kiosk
// (Phase 1B) surfaces this same data on a public URL with a token.

(function () {
  var _ss = {
    tab: 'schedule',
    viewMode: 'month',     // 'month' | 'week'
    weekStart: '',         // ISO YYYY-MM-DD (Sunday) — used for week view
    monthStart: '',        // ISO YYYY-MM-01 — used for month view
    teams: [],
    shifts: [],            // [{id, day_date, label, start_time, end_time, notes, position, teams:[{team_id}]}]
    vacations: [],         // [{id, employee_name, team_id, start_date, end_date, reason, notes, status}]
    vacationsAll: [],      // full list (used by Vacations tab)
    showArchived: false
  };

  var BTN = 'padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:.78rem;font-weight:600';
  var BTN_P = BTN + ';background:#1a3a6b;color:#fff';
  var BTN_SUB = BTN + ';background:#f1f5f9;color:#334155';
  var BTN_D = 'padding:2px 8px;border-radius:5px;border:none;cursor:pointer;font-size:.68rem;background:#fee2e2;color:#b91c1c';
  var INP = 'width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:.85rem;box-sizing:border-box';

  var DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isoDate(d) { return d.toISOString().split('T')[0]; }
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
  function prettyRange(iso) {
    if (!iso) return '';
    var s = new Date(iso + 'T00:00:00');
    var e = new Date(s); e.setDate(e.getDate() + 6);
    var fmt = function (d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
    return fmt(s) + ' – ' + fmt(e) + ', ' + e.getFullYear();
  }
  function prettyMonth(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  // First day of the month containing the given ISO date (or today)
  function monthStartOf(iso) {
    var d = new Date((iso || isoDate(new Date())) + 'T00:00:00');
    d.setDate(1);
    return isoDate(d);
  }
  // Sunday-to-Saturday grid bounds for the month grid: starts at the
  // Sunday of the week that contains the 1st, ends at the Saturday of
  // the week that contains the last day. Always 5-6 rows of 7 days.
  function monthGridBounds(monthStart) {
    var first = new Date(monthStart + 'T00:00:00');
    // Last day of month
    var last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    var gridStart = new Date(first);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // back to Sunday
    var gridEnd = new Date(last);
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay())); // forward to Saturday
    return { start: isoDate(gridStart), end: isoDate(gridEnd), monthStart: isoDate(first), monthEnd: isoDate(last) };
  }
  // Walk through every day in [start, end] inclusive, calling cb(iso, dayIdx)
  function eachDay(start, end, cb) {
    var s = new Date(start + 'T00:00:00');
    var e = new Date(end + 'T00:00:00');
    var i = 0;
    for (var d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      cb(isoDate(d), i++);
    }
  }
  // Does a vacation (start..end) overlap a given ISO date?
  function vacationCoversDay(v, iso) {
    return iso >= v.start_date && iso <= v.end_date;
  }
  function prettyDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }
  function fmtTime12(t) {
    // "06:00" → "6:00 am". Returns '' for null/empty.
    if (!t) return '';
    var p = t.split(':');
    var h = parseInt(p[0], 10);
    var m = p[1] || '00';
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 || 12;
    return h12 + ':' + m + ' ' + ampm;
  }

  // ═══ ENTRY ════════════════════════════════════════════════════════════
  function buildStaffScheduleWidget() {
    var wt = document.getElementById('widget-tabs');
    var tabs = [
      { id: 'schedule',  label: '🗓️ Schedule' },
      { id: 'teams',     label: '👥 Teams' },
      { id: 'vacations', label: '🏖️ Vacations' }
    ];
    wt.innerHTML = tabs.map(function (t) {
      return '<button class="wtab" id="ss-tab-' + t.id + '" onclick="ssShowTab(\'' + t.id + '\')" '
        + 'style="padding:6px 12px;border:none;background:transparent;cursor:pointer;font-size:.78rem;'
        + 'border-bottom:2px solid transparent;color:#94a3b8">' + t.label + '</button>';
    }).join('');

    if (!_ss.weekStart) _ss.weekStart = weekStartOf();
    if (!_ss.monthStart) _ss.monthStart = monthStartOf();
    ssShowTab(_ss.tab);
  }

  function ssShowTab(tab) {
    _ss.tab = tab;
    ['schedule', 'teams', 'vacations'].forEach(function (t) {
      var btn = document.getElementById('ss-tab-' + t);
      if (!btn) return;
      var active = (t === tab);
      btn.style.color = active ? '#1a3a6b' : '#94a3b8';
      btn.style.borderBottomColor = active ? '#1a3a6b' : 'transparent';
    });
    ssLoadAndRender();
  }

  // ═══ DATA LOADING ═════════════════════════════════════════════════════
  function ssLoadAndRender() {
    var panel = document.getElementById('widget-content');
    if (!panel) return;
    panel.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner-wrap"><div class="spinner"></div></div>Loading schedule…</div>';

    // Vacations tab fetches the full vacation list (all dates) instead of
    // just what overlaps the current calendar window.
    if (_ss.tab === 'vacations') {
      var qs1 = '?action=get_vacations_full';
      apiCall('GET', '/api/staff-schedule' + qs1)
        .then(function (r) {
          _ss.vacationsAll = r.vacations || [];
          // Also need teams to render the team chip on each row
          var qs2 = '?action=get_state&range_start=' + encodeURIComponent(isoDate(new Date()))
            + '&range_end=' + encodeURIComponent(isoDate(new Date()))
            + (_ss.showArchived ? '&show_archived=1' : '');
          return apiCall('GET', '/api/staff-schedule' + qs2);
        })
        .then(function (r) {
          _ss.teams = r.teams || _ss.teams;
          ssRenderVacations();
        })
        .catch(function (err) {
          panel.innerHTML = '<div style="padding:20px;color:#ef4444">Failed to load: ' + esc(err.message) + '</div>';
        });
      return;
    }

    // Schedule + Teams tabs use the calendar window
    var range = ssCurrentRange();
    var qs = '?action=get_state&range_start=' + encodeURIComponent(range.start)
      + '&range_end=' + encodeURIComponent(range.end);
    if (_ss.showArchived) qs += '&show_archived=1';
    apiCall('GET', '/api/staff-schedule' + qs)
      .then(function (r) {
        _ss.teams = r.teams || [];
        _ss.shifts = r.shifts || [];
        _ss.vacations = r.vacations || [];
        if (_ss.tab === 'schedule') ssRenderSchedule();
        else if (_ss.tab === 'teams') ssRenderTeams();
      })
      .catch(function (err) {
        panel.innerHTML = '<div style="padding:20px;color:#ef4444">Failed to load: ' + esc(err.message) + '</div>';
      });
  }

  // Compute the current calendar range based on view mode.
  //   month: full month-grid range (Sun-Sat extended)
  //   week:  Sun-Sat of the chosen week
  function ssCurrentRange() {
    if (_ss.viewMode === 'week') {
      return { start: _ss.weekStart, end: addDaysIso(_ss.weekStart, 6) };
    }
    var b = monthGridBounds(_ss.monthStart);
    return { start: b.start, end: b.end };
  }

  // ═══ SCHEDULE TAB ═════════════════════════════════════════════════════
  // Renders either Month or Week view based on _ss.viewMode. Month is the
  // default — easier to plan a whole month of shifts + vacations at once.
  function ssRenderSchedule() {
    var panel = document.getElementById('widget-content');
    if (!panel) return;
    var canEdit = userCan('staffschedule', 'edit');

    // Bucket shifts by day for fast lookup
    var byDay = {};
    _ss.shifts.forEach(function (s) {
      (byDay[s.day_date] = byDay[s.day_date] || []).push(s);
    });

    var html = '<div style="padding:14px;max-width:100%;margin:0 auto">';

    // Header: nav + range + view-mode toggle
    var navLabel, prevHandler, todayHandler, nextHandler;
    if (_ss.viewMode === 'week') {
      navLabel = prettyRange(_ss.weekStart);
      prevHandler = 'ssWeekNav(-1)';
      todayHandler = 'ssGoThisWeek()';
      nextHandler = 'ssWeekNav(1)';
    } else {
      navLabel = prettyMonth(_ss.monthStart);
      prevHandler = 'ssMonthNav(-1)';
      todayHandler = 'ssGoThisMonth()';
      nextHandler = 'ssMonthNav(1)';
    }

    var modeBtn = function (m, label) {
      var active = (_ss.viewMode === m);
      return '<button onclick="ssSetViewMode(\'' + m + '\')" style="padding:6px 12px;border:none;cursor:pointer;font-size:.78rem;font-weight:600;border-radius:0;'
        + (active ? 'background:#1a3a6b;color:#fff' : 'background:#f1f5f9;color:#475569')
        + '">' + label + '</button>';
    };

    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;background:#fff;border-radius:10px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<button style="' + BTN_SUB + '" onclick="' + prevHandler + '">←</button>'
      + '<button style="' + BTN_SUB + '" onclick="' + todayHandler + '">Today</button>'
      + '<button style="' + BTN_SUB + '" onclick="' + nextHandler + '">→</button>'
      + '<div style="flex:1;font-weight:700;color:#1a3a6b;font-size:1.05rem;margin-left:12px">' + navLabel + '</div>'
      + '<div style="display:inline-flex;border-radius:6px;overflow:hidden;border:1px solid #cbd5e1">'
      + modeBtn('month', 'Month')
      + modeBtn('week', 'Week')
      + '</div>'
      + '</div>';

    if (_ss.teams.length === 0) {
      html += '<div style="background:#fef3c7;border:1px solid #fde68a;color:#92400e;border-radius:8px;padding:14px 16px;margin-bottom:12px">'
        + 'No teams set up yet. Go to the <strong>👥 Teams</strong> tab and add Team A, Team B, etc. before scheduling.'
        + '</div>';
    }

    // Day-of-week header row (Sun-Sat) — shared between week + month
    var dowHeader = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px">';
    for (var i = 0; i < 7; i++) {
      dowHeader += '<div style="font-size:.72rem;font-weight:700;color:#475569;text-align:center;padding:4px 0">' + DAY_ABBR[i] + '</div>';
    }
    dowHeader += '</div>';
    html += dowHeader;

    if (_ss.viewMode === 'week') {
      html += renderWeekGrid(byDay, canEdit);
    } else {
      html += renderMonthGrid(byDay, canEdit);
    }

    html += '<div style="font-size:.74rem;color:#94a3b8;margin-top:10px;font-style:italic">'
      + 'Click any day to add or edit production shifts. Vacations show as italic chips beneath shifts.'
      + '</div>';

    html += '</div>';
    panel.innerHTML = html;
  }

  function renderWeekGrid(byDay, canEdit) {
    var html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;min-width:0">';
    for (var i = 0; i < 7; i++) {
      var d = addDaysIso(_ss.weekStart, i);
      var dayShifts = (byDay[d] || []).slice().sort(function (a, b) {
        return (a.position || 0) - (b.position || 0) || (a.id - b.id);
      });
      var dayVacs = _ss.vacations.filter(function (v) { return vacationCoversDay(v, d); });
      var isToday = (d === isoDate(new Date()));
      html += dayCard(d, i, dayShifts, dayVacs, isToday, canEdit, /*compact=*/ false, /*inMonth=*/ true);
    }
    html += '</div>';
    return html;
  }

  function renderMonthGrid(byDay, canEdit) {
    var b = monthGridBounds(_ss.monthStart);
    var html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;min-width:0">';
    eachDay(b.start, b.end, function (iso) {
      var dayShifts = (byDay[iso] || []).slice().sort(function (a, b2) {
        return (a.position || 0) - (b2.position || 0) || (a.id - b2.id);
      });
      var dayVacs = _ss.vacations.filter(function (v) { return vacationCoversDay(v, iso); });
      var d = new Date(iso + 'T00:00:00');
      var isToday = (iso === isoDate(new Date()));
      var inMonth = (iso >= b.monthStart && iso <= b.monthEnd);
      html += dayCard(iso, d.getDay(), dayShifts, dayVacs, isToday, canEdit, /*compact=*/ true, inMonth);
    });
    html += '</div>';
    return html;
  }

  function dayCard(iso, dayIdx, shifts, vacations, isToday, canEdit, compact, inMonth) {
    var d = new Date(iso + 'T00:00:00');
    var dayNum = d.getDate();
    var headerBg = isToday ? '#1a3a6b' : (inMonth ? '#f1f5f9' : '#f8fafc');
    var headerColor = isToday ? '#fff' : (inMonth ? '#1a3a6b' : '#94a3b8');
    var bodyOpacity = inMonth ? '1' : '.55';
    var clickable = canEdit ? 'cursor:pointer' : 'cursor:default';
    var openHandler = canEdit ? ' onclick="ssOpenDay(\'' + iso + '\')"' : '';
    var minHeight = compact ? '88px' : '140px';

    var html = '<div style="background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden;display:flex;flex-direction:column;min-height:' + minHeight + ';opacity:' + bodyOpacity + ';' + clickable + '"' + openHandler + '>';
    html += '<div style="background:' + headerBg + ';color:' + headerColor + ';padding:4px 8px;font-size:.7rem;font-weight:700;display:flex;justify-content:flex-end;align-items:baseline">'
      + '<span style="font-size:' + (compact ? '.78rem' : '.92rem') + '">' + dayNum + '</span>'
      + '</div>';
    html += '<div style="flex:1;padding:' + (compact ? '4px' : '8px') + ';display:flex;flex-direction:column;gap:4px">';
    if (shifts.length === 0 && vacations.length === 0) {
      if (!compact) {
        html += '<div style="color:#cbd5e1;font-size:.7rem;font-style:italic;text-align:center;padding:8px 0">— no shifts —</div>';
        if (canEdit) {
          html += '<div style="text-align:center"><span style="font-size:.66rem;color:#1a3a6b;font-weight:600">+ click to add</span></div>';
        }
      }
    } else {
      shifts.forEach(function (s) { html += shiftPreview(s, compact); });
      vacations.forEach(function (v) { html += vacationChip(v, compact); });
    }
    html += '</div></div>';
    return html;
  }

  // Small italic chip for a vacation on a single day. Color comes from the
  // linked team if any, else neutral grey. Click opens the vacation editor.
  function vacationChip(v, compact) {
    var team = v.team_id ? _ss.teams.find(function (t) { return t.id === v.team_id; }) : null;
    var color = team ? team.color : '#64748b';
    var bg = compact ? '#f8fafc' : '#fff';
    var label = v.employee_name || '?';
    var reason = v.reason || 'vacation';
    var truncated = compact && label.length > 14 ? label.slice(0, 13) + '…' : label;
    var fontSize = compact ? '.6rem' : '.7rem';
    var inner = compact
      ? truncated
      : '🏖️ ' + label + ' · ' + reason;
    return '<div onclick="event.stopPropagation();ssEditVacation(' + v.id + ')" '
      + 'title="' + esc(v.employee_name) + ' · ' + esc(v.start_date) + ' to ' + esc(v.end_date) + (reason ? ' · ' + esc(reason) : '') + '" '
      + 'style="background:' + bg + ';border-left:3px solid ' + esc(color) + ';border-radius:3px;padding:2px 5px;font-style:italic;font-size:' + fontSize + ';color:#475569;cursor:pointer;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
      + esc(inner)
      + '</div>';
  }

  function shiftPreview(s, compact) {
    var label = s.label || 'Shift';
    var timeStr = '';
    if (s.start_time && s.end_time) timeStr = fmtTime12(s.start_time) + '–' + fmtTime12(s.end_time);
    else if (s.start_time) timeStr = 'from ' + fmtTime12(s.start_time);
    else if (s.end_time) timeStr = 'until ' + fmtTime12(s.end_time);

    // Compact (month view): single line — first letters of teams as colored chips
    if (compact) {
      var chips = '';
      if (s.teams && s.teams.length) {
        chips = '<div style="display:flex;gap:2px;flex-wrap:wrap">';
        s.teams.forEach(function (t) {
          var team = _ss.teams.find(function (x) { return x.id === t.team_id; });
          if (!team) return;
          // Just the team initial / shortest distinguishing token
          var short = (team.name || '?').replace(/^Team\s+/i, '').trim() || '?';
          chips += '<span style="background:' + esc(team.color || '#1a3a6b') + ';color:#fff;font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:6px;line-height:1.2">' + esc(short) + '</span>';
        });
        chips += '</div>';
      }
      return '<div style="background:#f8fafc;border-left:3px solid #1a3a6b;border-radius:3px;padding:2px 5px;font-size:.62rem;line-height:1.15;overflow:hidden">'
        + '<div style="font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(label) + '</div>'
        + (timeStr ? '<div style="color:#64748b;font-size:.58rem">' + esc(timeStr) + '</div>' : '')
        + chips
        + '</div>';
    }

    // Full preview (week view): label + time + full team chips
    var fullChips = '';
    if (s.teams && s.teams.length) {
      fullChips = '<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:4px">';
      s.teams.forEach(function (t) {
        var team = _ss.teams.find(function (x) { return x.id === t.team_id; });
        if (!team) return;
        fullChips += '<span style="background:' + esc(team.color || '#1a3a6b') + ';color:#fff;font-size:.66rem;font-weight:700;padding:2px 6px;border-radius:8px">' + esc(team.name) + '</span>';
      });
      fullChips += '</div>';
    } else {
      fullChips = '<div style="color:#94a3b8;font-size:.64rem;font-style:italic;margin-top:2px">no teams assigned</div>';
    }

    return '<div style="background:#f8fafc;border-left:3px solid #1a3a6b;border-radius:4px;padding:5px 7px">'
      + '<div style="font-weight:700;color:#0f172a;font-size:.76rem;line-height:1.1">' + esc(label) + '</div>'
      + (timeStr ? '<div style="font-size:.66rem;color:#64748b;margin-top:1px">' + esc(timeStr) + '</div>' : '')
      + fullChips
      + '</div>';
  }

  function ssWeekNav(delta) {
    _ss.weekStart = addDaysIso(_ss.weekStart, delta * 7);
    ssLoadAndRender();
  }
  function ssGoThisWeek() {
    _ss.weekStart = weekStartOf();
    ssLoadAndRender();
  }
  function ssMonthNav(delta) {
    var d = new Date(_ss.monthStart + 'T00:00:00');
    d.setMonth(d.getMonth() + delta, 1);
    _ss.monthStart = isoDate(d);
    ssLoadAndRender();
  }
  function ssGoThisMonth() {
    _ss.monthStart = monthStartOf();
    ssLoadAndRender();
  }
  function ssSetViewMode(mode) {
    _ss.viewMode = mode === 'week' ? 'week' : 'month';
    // When switching to week view, default the week to one containing today
    // (or the first week of the currently-viewed month)
    if (mode === 'week' && !_ss.weekStart) _ss.weekStart = weekStartOf();
    ssLoadAndRender();
  }

  // ═══ DAY DETAIL MODAL ═════════════════════════════════════════════════
  // Lists shifts for a single day. + Add Shift button; each shift has its
  // own little inline editor + delete. All saves persist immediately.
  function ssOpenDay(iso) {
    if (!userCan('staffschedule', 'edit')) {
      toast('⚠️ Need manager access to edit the schedule');
      return;
    }
    ssRenderDayModal(iso);
  }

  function ssRenderDayModal(iso) {
    var existing = document.getElementById('ss-day-modal');
    if (existing) existing.remove();
    var dayShifts = _ss.shifts
      .filter(function (s) { return s.day_date === iso; })
      .sort(function (a, b) { return (a.position || 0) - (b.position || 0) || (a.id - b.id); });

    var overlay = document.createElement('div');
    overlay.id = 'ss-day-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto';

    var html = '<div style="background:#fff;border-radius:12px;padding:20px;max-width:760px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);margin-top:20px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:8px;flex-wrap:wrap">'
      + '<div style="font-weight:800;color:#1a3a6b;font-size:1.1rem">🗓️ ' + esc(prettyDate(iso)) + '</div>'
      + '<button onclick="document.getElementById(\'ss-day-modal\').remove()" style="background:#f1f5f9;color:#475569;border:none;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer">✕ Close</button>'
      + '</div>';

    if (dayShifts.length === 0) {
      html += '<div style="background:#f8fafc;border:2px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;margin-bottom:12px">'
        + 'No shifts scheduled for this day.<br><span style="font-size:.78rem">Click "+ Add Shift" to plan production.</span>'
        + '</div>';
    } else {
      dayShifts.forEach(function (s) { html += shiftEditCard(s, iso); });
    }

    html += '<div style="display:flex;justify-content:center;margin-top:14px">'
      + '<button onclick="ssAddShift(\'' + iso + '\')" style="' + BTN_P + ';padding:10px 22px;font-size:.88rem">+ Add Shift</button>'
      + '</div>';
    html += '</div>';

    overlay.innerHTML = html;
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }

  // Render a single shift's editable card. Each card has its own form
  // bound to data-shift-id="" so saves only touch that one shift.
  function shiftEditCard(s, iso) {
    var teamCheckboxes = _ss.teams.map(function (t) {
      var checked = s.teams && s.teams.some(function (st) { return st.team_id === t.id; });
      return '<label style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:14px;background:' + (checked ? esc(t.color || '#1a3a6b') : '#f1f5f9') + ';color:' + (checked ? '#fff' : '#475569') + ';cursor:pointer;font-size:.78rem;font-weight:700;border:1px solid ' + (checked ? esc(t.color || '#1a3a6b') : '#e2e8f0') + ';margin:2px">'
        + '<input type="checkbox" data-shift-team data-team-id="' + t.id + '" ' + (checked ? 'checked' : '') + ' style="width:14px;height:14px;cursor:pointer;accent-color:#fff">'
        + esc(t.name)
        + '</label>';
    }).join('');

    var sid = s.id;
    return '<div data-shift-id="' + sid + '" style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:10px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">'
      + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:3px">Label</label>'
      + '<input data-field="label" type="text" value="' + esc(s.label || '') + '" placeholder="e.g., 1st Shift" style="' + INP + '"></div>'
      + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:3px">Start</label>'
      + '<input data-field="start_time" type="time" value="' + esc(s.start_time || '') + '" style="' + INP + '"></div>'
      + '<div><label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:3px">End</label>'
      + '<input data-field="end_time" type="time" value="' + esc(s.end_time || '') + '" style="' + INP + '"></div>'
      + '</div>'
      + '<div style="margin-bottom:10px">'
      + '<label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:6px">Teams Assigned <span style="color:#94a3b8;font-weight:400">(click to toggle)</span></label>'
      + '<div>' + (teamCheckboxes || '<span style="color:#94a3b8;font-size:.78rem;font-style:italic">No teams set up yet — go to the Teams tab to add them.</span>') + '</div>'
      + '</div>'
      + '<div style="margin-bottom:10px">'
      + '<label style="display:block;font-size:.7rem;color:#475569;font-weight:600;margin-bottom:3px">Notes <span style="color:#94a3b8;font-weight:400">(optional)</span></label>'
      + '<input data-field="notes" type="text" value="' + esc(s.notes || '') + '" placeholder="e.g., Heavy day, both lines" style="' + INP + '"></div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button onclick="ssDeleteShift(' + sid + ',\'' + iso + '\')" style="' + BTN_D + ';padding:6px 12px;font-size:.74rem">🗑 Delete</button>'
      + '<button onclick="ssSaveShift(' + sid + ',\'' + iso + '\')" style="' + BTN_P + ';padding:6px 14px;font-size:.78rem">💾 Save</button>'
      + '</div>'
      + '</div>';
  }

  // "+ Add Shift" pushes a temporary blank shift onto state with id=null
  // and re-renders — first blank card auto-saves on first click of Save.
  function ssAddShift(iso) {
    var temp = {
      id: 'new-' + Date.now(),
      day_date: iso,
      label: 'Production',
      start_time: '06:00',
      end_time: '14:00',
      notes: '',
      position: _ss.shifts.filter(function (s) { return s.day_date === iso; }).length,
      teams: [],
      _isNew: true
    };
    _ss.shifts.push(temp);
    ssRenderDayModal(iso);
  }

  function ssSaveShift(shiftId, iso) {
    var card = document.querySelector('[data-shift-id="' + shiftId + '"]');
    if (!card) return;
    var get = function (field) {
      var el = card.querySelector('[data-field="' + field + '"]');
      return el ? el.value : '';
    };
    var teamIds = [];
    card.querySelectorAll('[data-shift-team]').forEach(function (cb) {
      if (cb.checked) teamIds.push(parseInt(cb.getAttribute('data-team-id'), 10));
    });

    var existingShift = _ss.shifts.find(function (s) { return String(s.id) === String(shiftId); });
    var body = {
      day_date: iso,
      label: get('label'),
      start_time: get('start_time'),
      end_time: get('end_time'),
      notes: get('notes'),
      position: existingShift ? (existingShift.position || 0) : 0,
      team_ids: teamIds
    };
    // For new (temp-id) shifts, omit id so backend creates. For existing,
    // include the integer id.
    if (existingShift && !existingShift._isNew && typeof existingShift.id === 'number') {
      body.id = existingShift.id;
    }

    apiCall('POST', '/api/staff-schedule?action=save_shift', body)
      .then(function (r) {
        toast('✓ Shift saved');
        // Refresh from server (replaces our temp-id with the real one)
        ssLoadAndRender();
        // Re-open the modal for the same day so the user can keep editing
        setTimeout(function () { ssRenderDayModal(iso); }, 250);
      })
      .catch(function (err) {
        toast('⚠️ Save failed: ' + (err && err.message ? err.message : 'unknown'));
      });
  }

  function ssDeleteShift(shiftId, iso) {
    var s = _ss.shifts.find(function (x) { return String(x.id) === String(shiftId); });
    // For brand-new (un-saved) temp shifts, just drop locally
    if (s && s._isNew) {
      _ss.shifts = _ss.shifts.filter(function (x) { return x.id !== s.id; });
      ssRenderDayModal(iso);
      return;
    }
    if (!confirm('Delete this shift and all team assignments on it?')) return;
    apiCall('POST', '/api/staff-schedule?action=delete_shift', { id: shiftId })
      .then(function () {
        toast('Shift deleted');
        ssLoadAndRender();
        setTimeout(function () { ssRenderDayModal(iso); }, 200);
      })
      .catch(function (err) {
        toast('⚠️ ' + (err && err.message ? err.message : 'failed'));
      });
  }

  // ═══ TEAMS TAB ════════════════════════════════════════════════════════
  function ssRenderTeams() {
    var panel = document.getElementById('widget-content');
    if (!panel) return;
    var canEdit = userCan('staffschedule', 'edit');
    var canDelete = userCan('staffschedule', 'delete');

    var html = '<div style="padding:14px;max-width:880px;margin:0 auto">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px">'
      + '<div style="font-weight:700;color:#1a3a6b;font-size:1rem">👥 Teams</div>'
      + '<div style="display:flex;gap:8px">'
      + '<label style="display:inline-flex;align-items:center;gap:6px;font-size:.78rem;color:#475569;cursor:pointer">'
      + '<input type="checkbox" ' + (_ss.showArchived ? 'checked' : '') + ' onchange="ssToggleArchived(this.checked)"> Show archived</label>'
      + (canEdit ? '<button style="' + BTN_P + '" onclick="ssEditTeam(null)">+ Add Team</button>' : '')
      + '</div></div>';

    if (_ss.teams.length === 0) {
      html += '<div style="background:#fef3c7;border:1px solid #fde68a;color:#92400e;border-radius:8px;padding:18px 20px;margin-bottom:12px">'
        + 'No teams yet. Add Team A, Team B, etc. to start scheduling.'
        + '</div>';
    } else {
      html += '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden">';
      _ss.teams.forEach(function (t, i) {
        var memberPreview = '';
        if (t.members) {
          var count = t.members.split(',').filter(function (s) { return s.trim(); }).length;
          memberPreview = count + ' member' + (count === 1 ? '' : 's');
        }
        var archivedTag = t.active === false
          ? ' <span style="font-size:.66rem;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:3px;font-weight:600">archived</span>'
          : '';
        html += '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;' + (i > 0 ? 'border-top:1px solid #f1f5f9' : '') + '">'
          + '<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:' + esc(t.color || '#1a3a6b') + ';flex-shrink:0"></span>'
          + '<div style="flex:0 0 200px;font-weight:700;color:#0f172a">' + esc(t.name) + archivedTag + '</div>'
          + '<div style="flex:1;font-size:.78rem;color:#64748b">' + esc(memberPreview) + (t.notes ? ' · <span style="font-style:italic">' + esc(t.notes) + '</span>' : '') + '</div>'
          + (canEdit ? '<button style="' + BTN_SUB + ';padding:5px 12px;font-size:.74rem" onclick="ssEditTeam(' + t.id + ')">Edit</button>' : '')
          + (canDelete && t.active !== false ? '<button style="' + BTN_D + ';margin-left:4px" onclick="ssDeleteTeam(' + t.id + ',\'' + esc(t.name).replace(/'/g, '') + '\')">Archive</button>' : '')
          + '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    panel.innerHTML = html;
  }

  function ssToggleArchived(checked) {
    _ss.showArchived = !!checked;
    ssLoadAndRender();
  }

  function ssEditTeam(id) {
    if (!userCan('staffschedule', 'edit')) {
      toast('⚠️ Need manager access');
      return;
    }
    var t = id ? _ss.teams.find(function (x) { return x.id === id; }) : null;
    var isEdit = !!t;

    var existing = document.getElementById('ss-team-modal');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'ss-team-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9100;display:flex;align-items:center;justify-content:center;padding:20px';
    var colors = ['#1a3a6b', '#0369a1', '#0891b2', '#059669', '#ca8a04', '#ea580c', '#dc2626', '#7c3aed', '#be185d', '#475569'];
    var swatchHtml = colors.map(function (c) {
      var selStyle = (t && t.color === c) ? 'border:3px solid #0f172a' : 'border:2px solid #fff';
      return '<button type="button" data-color="' + c + '" onclick="document.getElementById(\'ss-tm-color\').value=\'' + c + '\';document.querySelectorAll(\'#ss-team-modal [data-color]\').forEach(function(b){b.style.border=\'2px solid #fff\'});this.style.border=\'3px solid #0f172a\'" style="width:30px;height:30px;border-radius:50%;background:' + c + ';cursor:pointer;' + selStyle + '"></button>';
    }).join('');

    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:22px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:calc(100vh - 40px);overflow-y:auto">'
      + '<div style="font-weight:800;color:#1a3a6b;font-size:1.1rem;margin-bottom:14px">' + (isEdit ? '✎ Edit Team' : '+ New Team') + '</div>'
      + '<label style="display:block;font-size:.74rem;color:#475569;font-weight:700;margin-bottom:4px">Name</label>'
      + '<input id="ss-tm-name" type="text" placeholder="e.g., Team A" value="' + esc(t ? t.name : '') + '" style="' + INP + '">'
      + '<label style="display:block;font-size:.74rem;color:#475569;font-weight:700;margin:12px 0 6px">Color</label>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">' + swatchHtml + '</div>'
      + '<input id="ss-tm-color" type="hidden" value="' + esc(t ? t.color : '#1a3a6b') + '">'
      + '<label style="display:block;font-size:.74rem;color:#475569;font-weight:700;margin:12px 0 4px">Members <span style="color:#94a3b8;font-weight:400">(comma-separated names)</span></label>'
      + '<textarea id="ss-tm-members" rows="3" placeholder="e.g., Mary Gomez, Tonya Murphree, Ana Reyes" style="' + INP + ';resize:vertical;font-family:inherit">' + esc(t ? (t.members || '') : '') + '</textarea>'
      + '<label style="display:block;font-size:.74rem;color:#475569;font-weight:700;margin:12px 0 4px">Notes <span style="color:#94a3b8;font-weight:400">(optional)</span></label>'
      + '<input id="ss-tm-notes" type="text" placeholder="e.g., Trim line specialists" value="' + esc(t ? (t.notes || '') : '') + '" style="' + INP + '">'
      + '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:.82rem;color:#475569;font-weight:600;cursor:pointer">'
      + '<input id="ss-tm-active" type="checkbox" ' + (t == null || t.active !== false ? 'checked' : '') + ' style="width:16px;height:16px;cursor:pointer">'
      + 'Active (uncheck to archive)</label>'
      + '<div id="ss-tm-err" style="color:#ef4444;font-size:.78rem;margin-top:8px;display:none"></div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">'
      + '<button onclick="document.getElementById(\'ss-team-modal\').remove()" style="' + BTN_SUB + ';padding:8px 14px">Cancel</button>'
      + '<button onclick="ssSaveTeam(' + (id || 'null') + ')" style="' + BTN_P + ';padding:8px 14px">Save</button>'
      + '</div></div>';

    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    setTimeout(function () { var el = document.getElementById('ss-tm-name'); if (el) el.focus(); }, 80);
  }

  function ssSaveTeam(id) {
    var name = document.getElementById('ss-tm-name').value.trim();
    var color = document.getElementById('ss-tm-color').value;
    var members = document.getElementById('ss-tm-members').value;
    var notes = document.getElementById('ss-tm-notes').value;
    var active = document.getElementById('ss-tm-active').checked;
    var err = document.getElementById('ss-tm-err');
    if (!name) {
      err.textContent = 'Team name is required.';
      err.style.display = 'block';
      return;
    }
    var body = { name: name, color: color, members: members, notes: notes, active: active };
    if (id) body.id = id;
    apiCall('POST', '/api/staff-schedule?action=save_team', body)
      .then(function () {
        var m = document.getElementById('ss-team-modal'); if (m) m.remove();
        toast('Team saved');
        ssLoadAndRender();
      })
      .catch(function (e) {
        err.textContent = e && e.message ? e.message : 'Save failed';
        err.style.display = 'block';
      });
  }

  function ssDeleteTeam(id, name) {
    if (!confirm('Archive ' + name + '?\n\nExisting shift assignments are kept; the team just stops appearing in pickers.')) return;
    apiCall('POST', '/api/staff-schedule?action=delete_team', { id: id })
      .then(function () {
        toast(name + ' archived');
        ssLoadAndRender();
      })
      .catch(function (err) {
        toast('⚠️ ' + (err && err.message ? err.message : 'failed'));
      });
  }

  // ═══ VACATIONS TAB ════════════════════════════════════════════════════
  function ssRenderVacations() {
    var panel = document.getElementById('widget-content');
    if (!panel) return;
    var canEdit = userCan('staffschedule', 'edit');
    var canDelete = userCan('staffschedule', 'delete');
    var rows = (_ss.vacationsAll || []).slice();
    var todayIso = isoDate(new Date());

    // Default sort: upcoming + active first, then past, both internally
    // sorted by start_date desc.
    var upcomingActive = rows.filter(function (v) { return v.end_date >= todayIso; });
    var past = rows.filter(function (v) { return v.end_date < todayIso; });
    upcomingActive.sort(function (a, b) { return a.start_date < b.start_date ? -1 : 1; });
    past.sort(function (a, b) { return a.start_date > b.start_date ? -1 : 1; });

    var html = '<div style="padding:14px;max-width:980px;margin:0 auto">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px">'
      + '<div style="font-weight:700;color:#1a3a6b;font-size:1rem">🏖️ Vacations & Time Off</div>'
      + (canEdit ? '<button style="' + BTN_P + '" onclick="ssEditVacation(null)">+ Add Vacation</button>' : '')
      + '</div>';

    if (upcomingActive.length === 0 && past.length === 0) {
      html += '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:30px 20px;text-align:center;color:#94a3b8;font-size:.88rem">'
        + 'No vacations on file. Click <strong>+ Add Vacation</strong> to log time off for an employee — it\'ll show on the calendar.'
        + '</div>';
      html += '</div>';
      panel.innerHTML = html;
      return;
    }

    var table = function (title, list, color, hint) {
      if (list.length === 0) return '';
      var inner = '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;margin-bottom:14px">'
        + '<div style="background:' + color + ';color:#fff;padding:8px 14px;font-weight:700;font-size:.84rem">' + title + ' <span style="font-weight:400;opacity:.85;font-size:.76rem">(' + list.length + ')</span></div>'
        + '<table style="width:100%;border-collapse:collapse;font-size:.84rem">'
        + '<thead><tr style="background:#f8fafc">'
        + '<th style="padding:8px 10px;text-align:left;font-size:.7rem;color:#475569;font-weight:700">Employee</th>'
        + '<th style="padding:8px 10px;text-align:left;font-size:.7rem;color:#475569;font-weight:700">Team</th>'
        + '<th style="padding:8px 10px;text-align:left;font-size:.7rem;color:#475569;font-weight:700">Dates</th>'
        + '<th style="padding:8px 10px;text-align:right;font-size:.7rem;color:#475569;font-weight:700">Days</th>'
        + '<th style="padding:8px 10px;text-align:left;font-size:.7rem;color:#475569;font-weight:700">Reason</th>'
        + '<th style="padding:8px 10px;text-align:left;font-size:.7rem;color:#475569;font-weight:700">Notes</th>'
        + (canEdit ? '<th style="width:120px"></th>' : '')
        + '</tr></thead><tbody>';
      list.forEach(function (v, i) {
        var team = v.team_id ? _ss.teams.find(function (t) { return t.id === v.team_id; }) : null;
        var teamCell = team
          ? '<span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(team.color || '#1a3a6b') + '"></span>' + esc(team.name) + '</span>'
          : '<span style="color:#cbd5e1">—</span>';
        var days = daysBetweenInclusive(v.start_date, v.end_date);
        var dateRange = (v.start_date === v.end_date)
          ? prettyShort(v.start_date)
          : prettyShort(v.start_date) + ' – ' + prettyShort(v.end_date);
        inner += '<tr style="border-top:1px solid #f1f5f9">'
          + '<td style="padding:8px 10px;font-weight:600;color:#0f172a">' + esc(v.employee_name) + '</td>'
          + '<td style="padding:8px 10px">' + teamCell + '</td>'
          + '<td style="padding:8px 10px;color:#475569">' + dateRange + '</td>'
          + '<td style="padding:8px 10px;text-align:right;font-weight:600;color:#1a3a6b">' + days + '</td>'
          + '<td style="padding:8px 10px;color:#475569">' + esc(v.reason || '—') + '</td>'
          + '<td style="padding:8px 10px;color:#64748b;font-size:.78rem;font-style:italic">' + esc(v.notes || '') + '</td>'
          + (canEdit
            ? '<td style="padding:6px 10px;text-align:right;white-space:nowrap">'
              + '<button style="' + BTN_SUB + ';padding:3px 9px;font-size:.72rem" onclick="ssEditVacation(' + v.id + ')">Edit</button>'
              + (canDelete ? '<button style="' + BTN_D + ';margin-left:4px" onclick="ssDeleteVacation(' + v.id + ',\'' + esc(v.employee_name).replace(/'/g, '') + '\')">Delete</button>' : '')
              + '</td>'
            : '')
          + '</tr>';
      });
      inner += '</tbody></table></div>';
      return inner;
    };
    html += table('Upcoming & Active', upcomingActive, '#0369a1');
    html += table('Past', past, '#475569');
    html += '</div>';
    panel.innerHTML = html;
  }

  function daysBetweenInclusive(start, end) {
    var s = new Date(start + 'T00:00:00');
    var e = new Date(end + 'T00:00:00');
    return Math.round((e - s) / 86400000) + 1;
  }
  function prettyShort(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Vacation editor modal — used both from the Vacations tab "Edit/Add"
  // buttons and from clicking a vacation chip on the calendar.
  function ssEditVacation(id) {
    if (!userCan('staffschedule', 'edit')) {
      toast('⚠️ Need manager access');
      return;
    }
    // Find by id across both lists (tab list + window list)
    var pool = (_ss.vacationsAll && _ss.vacationsAll.length)
      ? _ss.vacationsAll
      : _ss.vacations;
    var v = id ? pool.find(function (x) { return x.id === id; }) : null;
    var isEdit = !!v;
    var todayIso = isoDate(new Date());
    var defaultStart = v ? v.start_date : todayIso;
    var defaultEnd = v ? v.end_date : todayIso;

    var existing = document.getElementById('ss-vac-modal');
    if (existing) existing.remove();

    var teamOpts = '<option value="">— No team / general —</option>'
      + _ss.teams.map(function (t) {
          var sel = (v && v.team_id === t.id) ? ' selected' : '';
          return '<option value="' + t.id + '"' + sel + '>' + esc(t.name) + '</option>';
        }).join('');

    var reasonOpts = ['vacation', 'sick', 'PTO', 'FMLA', 'jury duty', 'personal', 'bereavement', 'other'];
    var reasonHtml = '<select id="ss-vac-reason" style="' + INP + '">'
      + '<option value="">— Pick reason —</option>'
      + reasonOpts.map(function (r) {
          var sel = (v && v.reason === r) ? ' selected' : '';
          return '<option value="' + r + '"' + sel + '>' + r + '</option>';
        }).join('')
      + '</select>';

    var overlay = document.createElement('div');
    overlay.id = 'ss-vac-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9100;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:22px;max-width:520px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:calc(100vh - 40px);overflow-y:auto">'
      + '<div style="font-weight:800;color:#1a3a6b;font-size:1.1rem;margin-bottom:14px">' + (isEdit ? '✎ Edit Vacation' : '+ New Vacation') + '</div>'
      + '<label style="display:block;font-size:.74rem;color:#475569;font-weight:700;margin-bottom:4px">Employee Name</label>'
      + '<input id="ss-vac-name" type="text" placeholder="e.g., Mary Gomez" value="' + esc(v ? v.employee_name : '') + '" style="' + INP + '">'
      + '<label style="display:block;font-size:.74rem;color:#475569;font-weight:700;margin:12px 0 4px">Team <span style="color:#94a3b8;font-weight:400">(optional)</span></label>'
      + '<select id="ss-vac-team" style="' + INP + '">' + teamOpts + '</select>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">'
      + '<div><label style="display:block;font-size:.74rem;color:#475569;font-weight:700;margin-bottom:4px">Start</label>'
      + '<input id="ss-vac-start" type="date" value="' + esc(defaultStart) + '" style="' + INP + '"></div>'
      + '<div><label style="display:block;font-size:.74rem;color:#475569;font-weight:700;margin-bottom:4px">End</label>'
      + '<input id="ss-vac-end" type="date" value="' + esc(defaultEnd) + '" style="' + INP + '"></div>'
      + '</div>'
      + '<label style="display:block;font-size:.74rem;color:#475569;font-weight:700;margin:12px 0 4px">Reason</label>'
      + reasonHtml
      + '<label style="display:block;font-size:.74rem;color:#475569;font-weight:700;margin:12px 0 4px">Notes <span style="color:#94a3b8;font-weight:400">(optional)</span></label>'
      + '<textarea id="ss-vac-notes" rows="2" placeholder="e.g., out of state — emergency contact +1 555 1234" style="' + INP + ';resize:vertical;font-family:inherit">' + esc(v ? (v.notes || '') : '') + '</textarea>'
      + '<div id="ss-vac-err" style="color:#ef4444;font-size:.78rem;margin-top:8px;display:none"></div>'
      + '<div style="display:flex;gap:8px;justify-content:space-between;margin-top:14px">'
      + (isEdit && userCan('staffschedule', 'delete')
          ? '<button onclick="ssDeleteVacation(' + v.id + ',\'' + esc(v.employee_name).replace(/'/g, '') + '\')" style="' + BTN_D + ';padding:8px 12px">🗑 Delete</button>'
          : '<div></div>')
      + '<div style="display:flex;gap:8px">'
      + '<button onclick="document.getElementById(\'ss-vac-modal\').remove()" style="' + BTN_SUB + ';padding:8px 14px">Cancel</button>'
      + '<button onclick="ssSaveVacation(' + (id || 'null') + ')" style="' + BTN_P + ';padding:8px 14px">Save</button>'
      + '</div></div></div>';

    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    setTimeout(function () { var el = document.getElementById('ss-vac-name'); if (el) el.focus(); }, 80);
  }

  function ssSaveVacation(id) {
    var name = document.getElementById('ss-vac-name').value.trim();
    var teamId = document.getElementById('ss-vac-team').value;
    var startDate = document.getElementById('ss-vac-start').value;
    var endDate = document.getElementById('ss-vac-end').value;
    var reason = document.getElementById('ss-vac-reason').value;
    var notes = document.getElementById('ss-vac-notes').value;
    var err = document.getElementById('ss-vac-err');
    if (!name) { err.textContent = 'Employee name required.'; err.style.display = 'block'; return; }
    if (!startDate || !endDate) { err.textContent = 'Both start and end dates required.'; err.style.display = 'block'; return; }
    if (endDate < startDate) { err.textContent = 'End date must be on or after start date.'; err.style.display = 'block'; return; }

    var body = {
      employee_name: name,
      team_id: teamId ? parseInt(teamId, 10) : null,
      start_date: startDate,
      end_date: endDate,
      reason: reason,
      notes: notes
    };
    if (id) body.id = id;

    apiCall('POST', '/api/staff-schedule?action=save_vacation', body)
      .then(function () {
        var m = document.getElementById('ss-vac-modal'); if (m) m.remove();
        toast('Vacation saved');
        ssLoadAndRender();
      })
      .catch(function (e) {
        err.textContent = e && e.message ? e.message : 'Save failed';
        err.style.display = 'block';
      });
  }

  function ssDeleteVacation(id, name) {
    if (!confirm('Delete vacation entry for ' + name + '?\n\nThis is a hard delete — the entry won\'t appear on the calendar anymore.')) return;
    apiCall('POST', '/api/staff-schedule?action=delete_vacation', { id: id })
      .then(function () {
        // Close any open modals
        ['ss-vac-modal'].forEach(function (mid) {
          var m = document.getElementById(mid); if (m) m.remove();
        });
        toast('Vacation deleted');
        ssLoadAndRender();
      })
      .catch(function (err) {
        toast('⚠️ ' + (err && err.message ? err.message : 'failed'));
      });
  }

  // Expose globals for inline onclicks
  window.buildStaffScheduleWidget = buildStaffScheduleWidget;
  window.ssShowTab = ssShowTab;
  window.ssWeekNav = ssWeekNav;
  window.ssGoThisWeek = ssGoThisWeek;
  window.ssMonthNav = ssMonthNav;
  window.ssGoThisMonth = ssGoThisMonth;
  window.ssSetViewMode = ssSetViewMode;
  window.ssOpenDay = ssOpenDay;
  window.ssAddShift = ssAddShift;
  window.ssSaveShift = ssSaveShift;
  window.ssDeleteShift = ssDeleteShift;
  window.ssToggleArchived = ssToggleArchived;
  window.ssEditTeam = ssEditTeam;
  window.ssSaveTeam = ssSaveTeam;
  window.ssDeleteTeam = ssDeleteTeam;
  window.ssEditVacation = ssEditVacation;
  window.ssSaveVacation = ssSaveVacation;
  window.ssDeleteVacation = ssDeleteVacation;
})();
