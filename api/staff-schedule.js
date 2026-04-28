// api/staff-schedule.js
// Employee Scheduling widget — Phase 1A
//
// Cooper's plant runs by Teams (A, B, C, D, ...) rather than per-employee.
// On any given day there are 0+ production "shifts" (variable start/end
// times — sometimes one all-day, sometimes 1st 6a-1p + 2nd 1p-10p), and
// each shift has 0+ teams assigned to it.
//
// Tables:
//   sched_teams        — the rotating team roster (name + color + members)
//   sched_shifts       — one row per shift on each day (label + times)
//   sched_shift_teams  — which teams are working a given shift
//
// Production workers don't have portal logins; they read from the TV
// kiosk display (Phase 1B) which queries this same data via a token-
// scoped read-only API.

const { neon } = require('@neondatabase/serverless');
const perms = require('./_permissions');
const { logAudit } = require('./_audit');

async function ensureTables(sql) {
  // Teams: roster of named groups. Members is a free-text list for now —
  // operators paste comma-separated names. Phase D may upgrade to a real
  // employees table when payroll/HR features land.
  await sql`CREATE TABLE IF NOT EXISTS sched_teams (
    id SERIAL PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#1a3a6b',
    active BOOLEAN DEFAULT true,
    members TEXT,
    notes TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS sched_teams_company_idx
    ON sched_teams(company_id, active)`;

  // Shifts: each row is one production block on one day. Times stored as
  // TIME (no timezone — these are "wall clock" plant times).
  await sql`CREATE TABLE IF NOT EXISTS sched_shifts (
    id SERIAL PRIMARY KEY,
    company_id TEXT NOT NULL,
    day_date DATE NOT NULL,
    label TEXT,
    start_time TIME,
    end_time TIME,
    notes TEXT,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS sched_shifts_company_day_idx
    ON sched_shifts(company_id, day_date)`;

  // Per-shift team assignments. Cascades on shift delete so cleanup is free.
  // UNIQUE prevents the same team being assigned twice to the same shift.
  await sql`CREATE TABLE IF NOT EXISTS sched_shift_teams (
    id SERIAL PRIMARY KEY,
    shift_id INTEGER NOT NULL REFERENCES sched_shifts(id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES sched_teams(id) ON DELETE CASCADE,
    team_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (shift_id, team_id)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS sched_shift_teams_shift_idx
    ON sched_shift_teams(shift_id)`;

  // Vacations / time-off — one row per absence span. employee_name is a
  // free-text field since production workers don't have portal logins.
  // team_id is optional (helps filter + color-code on the calendar).
  // reason is also free-text but the UI suggests common values
  // (vacation / sick / PTO / FMLA / jury / personal).
  await sql`CREATE TABLE IF NOT EXISTS sched_vacations (
    id SERIAL PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    team_id INTEGER REFERENCES sched_teams(id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    notes TEXT,
    status TEXT DEFAULT 'approved',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS sched_vacations_company_range_idx
    ON sched_vacations(company_id, start_date, end_date)`;
}

// Format a Postgres TIME ("06:00:00") → "06:00" for the frontend's <input type="time">
function timeStr(t) {
  if (!t) return null;
  const s = String(t);
  // Strip seconds if present
  return s.length >= 5 ? s.slice(0, 5) : s;
}

// Parse "06:00" or "06:00:00" → null-safe TIME-compatible string
function cleanTime(v) {
  if (v === '' || v == null || v === undefined) return null;
  const s = String(v).trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  return s.length === 5 ? s + ':00' : s;
}

function cleanDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = perms.requireAuth(req, res);
  if (!user) return;
  if (!perms.canPerform(user, 'staffschedule', 'view')) {
    return perms.deny(res, user, 'staffschedule', 'view');
  }
  const companyId = String(user.company_id);

  const sql = neon(process.env.DATABASE_URL);
  const url = new URL(req.url, 'http://x');
  const action = (req.query && req.query.action) || url.searchParams.get('action') || '';

  try {
    await ensureTables(sql);

    // ── GET get_state ─────────────────────────────────────────────────────
    // Returns everything the manager UI needs in one shot — teams plus
    // shifts + assignments + vacations for the requested date range.
    //
    // Range params (preferred):
    //   range_start=YYYY-MM-DD  range_end=YYYY-MM-DD
    // Backward-compat: week_start=YYYY-MM-DD (auto-extends 6 days)
    if (req.method === 'GET' && action === 'get_state') {
      let rangeStart = cleanDate(url.searchParams.get('range_start'));
      let rangeEnd = cleanDate(url.searchParams.get('range_end'));
      if (!rangeStart) {
        const ws = cleanDate(url.searchParams.get('week_start'));
        if (!ws) return res.status(400).json({ error: 'range_start+range_end (or week_start) required' });
        rangeStart = ws;
        const we = new Date(ws + 'T00:00:00');
        we.setDate(we.getDate() + 6);
        rangeEnd = we.toISOString().split('T')[0];
      }
      if (!rangeEnd) {
        // If only start given, default to +6 days (single week)
        const we = new Date(rangeStart + 'T00:00:00');
        we.setDate(we.getDate() + 6);
        rangeEnd = we.toISOString().split('T')[0];
      }
      const weekStart = rangeStart;
      const weekEnd = rangeEnd;
      const showArchived = url.searchParams.get('show_archived') === '1';

      const teams = showArchived
        ? await sql`
            SELECT id, name, color, active, members, notes, display_order
            FROM sched_teams
            WHERE company_id = ${companyId}
            ORDER BY active DESC, display_order, name
          `
        : await sql`
            SELECT id, name, color, active, members, notes, display_order
            FROM sched_teams
            WHERE company_id = ${companyId} AND active = true
            ORDER BY display_order, name
          `;

      // Pull shifts + their team assignments in one query so the frontend
      // doesn't have to fan out per-shift.
      const shifts = await sql`
        SELECT s.id, s.day_date::text AS day_date,
               s.label, s.start_time::text AS start_time,
               s.end_time::text AS end_time,
               s.notes, s.position
        FROM sched_shifts s
        WHERE s.company_id = ${companyId}
          AND s.day_date >= ${weekStart}::date
          AND s.day_date <= ${weekEnd}::date
        ORDER BY s.day_date, s.position, s.id
      `;
      const shiftIds = shifts.map(s => s.id);
      let assignments = [];
      if (shiftIds.length > 0) {
        // Use ANY(${array}) for a clean IN-list with neon.
        assignments = await sql`
          SELECT shift_id, team_id, team_notes
          FROM sched_shift_teams
          WHERE shift_id = ANY(${shiftIds})
        `;
      }
      // Group team_ids onto each shift before returning
      const byShift = {};
      assignments.forEach(a => {
        (byShift[a.shift_id] = byShift[a.shift_id] || []).push({
          team_id: a.team_id,
          team_notes: a.team_notes
        });
      });
      shifts.forEach(s => {
        s.start_time = timeStr(s.start_time);
        s.end_time = timeStr(s.end_time);
        s.teams = byShift[s.id] || [];
      });

      // Pull any vacations that overlap the queried range. A vacation
      // overlaps when start_date <= rangeEnd AND end_date >= rangeStart.
      const vacations = await sql`
        SELECT id, employee_name, team_id,
               start_date::text AS start_date,
               end_date::text   AS end_date,
               reason, notes, status
        FROM sched_vacations
        WHERE company_id = ${companyId}
          AND start_date <= ${weekEnd}::date
          AND end_date   >= ${weekStart}::date
        ORDER BY start_date, employee_name
      `;

      return res.json({
        ok: true,
        range_start: weekStart,
        range_end: weekEnd,
        // Back-compat aliases — older frontend keys.
        week_start: weekStart,
        week_end: weekEnd,
        teams,
        shifts,
        vacations
      });
    }

    // ── POST save_vacation ────────────────────────────────────────────────
    // Create or update a vacation row. Manager+ only.
    if (req.method === 'POST' && action === 'save_vacation') {
      if (!perms.canPerform(user, 'staffschedule', 'edit')) {
        return perms.deny(res, user, 'staffschedule', 'edit');
      }
      const b = req.body || {};
      const employeeName = String(b.employee_name || '').trim();
      const startDate = cleanDate(b.start_date);
      const endDate = cleanDate(b.end_date);
      if (!employeeName) return res.status(400).json({ error: 'employee_name required' });
      if (!startDate) return res.status(400).json({ error: 'start_date required (YYYY-MM-DD)' });
      if (!endDate) return res.status(400).json({ error: 'end_date required (YYYY-MM-DD)' });
      if (endDate < startDate) return res.status(400).json({ error: 'end_date must be on or after start_date' });
      const teamId = b.team_id ? parseInt(b.team_id, 10) : null;
      const reason = String(b.reason || '').trim() || null;
      const notes = String(b.notes || '').trim() || null;
      const status = String(b.status || 'approved').trim() || 'approved';

      if (b.id) {
        const [updated] = await sql`
          UPDATE sched_vacations
          SET employee_name = ${employeeName}, team_id = ${teamId},
              start_date = ${startDate}::date, end_date = ${endDate}::date,
              reason = ${reason}, notes = ${notes}, status = ${status},
              updated_at = NOW()
          WHERE id = ${b.id} AND company_id = ${companyId}
          RETURNING id, employee_name, team_id,
                    start_date::text AS start_date,
                    end_date::text   AS end_date,
                    reason, notes, status
        `;
        if (!updated) return res.status(404).json({ error: 'Vacation not found' });
        await logAudit(sql, req, user, {
          action: 'staffschedule.save_vacation',
          resource_type: 'sched_vacation', resource_id: String(b.id),
          details: { employee_name: employeeName, start_date: startDate, end_date: endDate }
        });
        return res.json({ ok: true, vacation: updated });
      }

      const [created] = await sql`
        INSERT INTO sched_vacations
          (company_id, employee_name, team_id, start_date, end_date, reason, notes, status)
        VALUES
          (${companyId}, ${employeeName}, ${teamId}, ${startDate}::date, ${endDate}::date,
           ${reason}, ${notes}, ${status})
        RETURNING id, employee_name, team_id,
                  start_date::text AS start_date,
                  end_date::text   AS end_date,
                  reason, notes, status
      `;
      await logAudit(sql, req, user, {
        action: 'staffschedule.save_vacation',
        resource_type: 'sched_vacation', resource_id: String(created.id),
        details: { employee_name: employeeName, start_date: startDate, end_date: endDate, created: true }
      });
      return res.json({ ok: true, vacation: created });
    }

    // ── POST delete_vacation ──────────────────────────────────────────────
    if (req.method === 'POST' && action === 'delete_vacation') {
      if (!perms.canPerform(user, 'staffschedule', 'delete')) {
        return perms.deny(res, user, 'staffschedule', 'delete');
      }
      const id = parseInt(req.body && req.body.id, 10);
      if (!id) return res.status(400).json({ error: 'id required' });
      const [deleted] = await sql`
        DELETE FROM sched_vacations
        WHERE id = ${id} AND company_id = ${companyId}
        RETURNING id, employee_name
      `;
      if (!deleted) return res.status(404).json({ error: 'Vacation not found' });
      await logAudit(sql, req, user, {
        action: 'staffschedule.delete_vacation',
        resource_type: 'sched_vacation', resource_id: String(id),
        details: deleted
      });
      return res.json({ ok: true });
    }

    // ── GET get_vacations_full ────────────────────────────────────────────
    // Vacations across all dates (used for the Vacations tab list view).
    // No range filter — returns everything sorted by start_date desc.
    if (req.method === 'GET' && action === 'get_vacations_full') {
      const vacations = await sql`
        SELECT id, employee_name, team_id,
               start_date::text AS start_date,
               end_date::text   AS end_date,
               reason, notes, status,
               created_at, updated_at
        FROM sched_vacations
        WHERE company_id = ${companyId}
        ORDER BY start_date DESC, employee_name
      `;
      return res.json({ ok: true, vacations });
    }

    // ── POST save_team ────────────────────────────────────────────────────
    // Create or update a team. Manager+ only. members is free-text.
    if (req.method === 'POST' && action === 'save_team') {
      if (!perms.canPerform(user, 'staffschedule', 'edit')) {
        return perms.deny(res, user, 'staffschedule', 'edit');
      }
      const b = req.body || {};
      const name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name required' });
      const color = (String(b.color || '').trim()) || '#1a3a6b';
      const members = String(b.members || '').trim() || null;
      const notes = String(b.notes || '').trim() || null;
      const active = b.active !== false;
      const displayOrder = parseInt(b.display_order, 10) || 0;

      if (b.id) {
        const [updated] = await sql`
          UPDATE sched_teams
          SET name = ${name}, color = ${color}, active = ${active},
              members = ${members}, notes = ${notes},
              display_order = ${displayOrder}, updated_at = NOW()
          WHERE id = ${b.id} AND company_id = ${companyId}
          RETURNING id, name, color, active, members, notes, display_order
        `;
        if (!updated) return res.status(404).json({ error: 'Team not found' });
        await logAudit(sql, req, user, {
          action: 'staffschedule.save_team',
          resource_type: 'sched_team', resource_id: String(b.id),
          details: { name }
        });
        return res.json({ ok: true, team: updated });
      }

      const [created] = await sql`
        INSERT INTO sched_teams (company_id, name, color, active, members, notes, display_order)
        VALUES (${companyId}, ${name}, ${color}, ${active}, ${members}, ${notes}, ${displayOrder})
        RETURNING id, name, color, active, members, notes, display_order
      `;
      await logAudit(sql, req, user, {
        action: 'staffschedule.save_team',
        resource_type: 'sched_team', resource_id: String(created.id),
        details: { name, created: true }
      });
      return res.json({ ok: true, team: created });
    }

    // ── POST delete_team ──────────────────────────────────────────────────
    // Soft-delete: set active=false. Existing shift assignments stay so
    // historical schedules don't lose data.
    if (req.method === 'POST' && action === 'delete_team') {
      if (!perms.canPerform(user, 'staffschedule', 'delete')) {
        return perms.deny(res, user, 'staffschedule', 'delete');
      }
      const id = parseInt(req.body && req.body.id, 10);
      if (!id) return res.status(400).json({ error: 'id required' });
      const [updated] = await sql`
        UPDATE sched_teams SET active = false, updated_at = NOW()
        WHERE id = ${id} AND company_id = ${companyId}
        RETURNING id, name
      `;
      if (!updated) return res.status(404).json({ error: 'Team not found' });
      await logAudit(sql, req, user, {
        action: 'staffschedule.delete_team',
        resource_type: 'sched_team', resource_id: String(id),
        details: {}
      });
      return res.json({ ok: true });
    }

    // ── POST save_shift ───────────────────────────────────────────────────
    // Create or update a shift on a given day. Replaces the entire team
    // assignment list with whatever's passed in body.team_ids — simpler
    // than a separate add/remove endpoint, and the team count per shift
    // is small enough that a full replace is fine.
    if (req.method === 'POST' && action === 'save_shift') {
      if (!perms.canPerform(user, 'staffschedule', 'edit')) {
        return perms.deny(res, user, 'staffschedule', 'edit');
      }
      const b = req.body || {};
      const dayDate = cleanDate(b.day_date);
      if (!dayDate) return res.status(400).json({ error: 'day_date required (YYYY-MM-DD)' });
      const label = String(b.label || '').trim() || null;
      const startTime = cleanTime(b.start_time);
      const endTime = cleanTime(b.end_time);
      const notes = String(b.notes || '').trim() || null;
      const position = parseInt(b.position, 10) || 0;
      const teamIds = Array.isArray(b.team_ids)
        ? b.team_ids.map(x => parseInt(x, 10)).filter(x => !isNaN(x))
        : [];

      let shiftId;
      if (b.id) {
        const [updated] = await sql`
          UPDATE sched_shifts
          SET day_date = ${dayDate}::date, label = ${label},
              start_time = ${startTime}::time, end_time = ${endTime}::time,
              notes = ${notes}, position = ${position}, updated_at = NOW()
          WHERE id = ${b.id} AND company_id = ${companyId}
          RETURNING id
        `;
        if (!updated) return res.status(404).json({ error: 'Shift not found' });
        shiftId = updated.id;
      } else {
        const [created] = await sql`
          INSERT INTO sched_shifts (company_id, day_date, label, start_time, end_time, notes, position)
          VALUES (${companyId}, ${dayDate}::date, ${label}, ${startTime}::time, ${endTime}::time, ${notes}, ${position})
          RETURNING id
        `;
        shiftId = created.id;
      }

      // Replace the team assignments wholesale. Delete-then-insert is fine
      // for small N (typically 1-4 teams per shift).
      await sql`DELETE FROM sched_shift_teams WHERE shift_id = ${shiftId}`;
      for (const teamId of teamIds) {
        // Skip silently if a passed team_id doesn't belong to this company —
        // catch with a join check.
        const [valid] = await sql`
          SELECT id FROM sched_teams WHERE id = ${teamId} AND company_id = ${companyId}
        `;
        if (!valid) continue;
        await sql`
          INSERT INTO sched_shift_teams (shift_id, team_id)
          VALUES (${shiftId}, ${teamId})
          ON CONFLICT (shift_id, team_id) DO NOTHING
        `;
      }

      // Return the freshly-shaped shift with teams attached
      const [full] = await sql`
        SELECT id, day_date::text AS day_date, label,
               start_time::text AS start_time, end_time::text AS end_time,
               notes, position
        FROM sched_shifts WHERE id = ${shiftId}
      `;
      const teams = await sql`
        SELECT team_id, team_notes FROM sched_shift_teams WHERE shift_id = ${shiftId}
      `;
      full.start_time = timeStr(full.start_time);
      full.end_time = timeStr(full.end_time);
      full.teams = teams;

      await logAudit(sql, req, user, {
        action: 'staffschedule.save_shift',
        resource_type: 'sched_shift', resource_id: String(shiftId),
        details: { day_date: dayDate, label, team_count: teamIds.length }
      });
      return res.json({ ok: true, shift: full });
    }

    // ── POST delete_shift ─────────────────────────────────────────────────
    // Hard-delete. Cascades to sched_shift_teams via FK. No soft-delete
    // here because shifts are inherently date-scoped — old shifts get
    // pruned in normal calendar nav anyway.
    if (req.method === 'POST' && action === 'delete_shift') {
      if (!perms.canPerform(user, 'staffschedule', 'delete')) {
        return perms.deny(res, user, 'staffschedule', 'delete');
      }
      const id = parseInt(req.body && req.body.id, 10);
      if (!id) return res.status(400).json({ error: 'id required' });
      const [deleted] = await sql`
        DELETE FROM sched_shifts
        WHERE id = ${id} AND company_id = ${companyId}
        RETURNING id, day_date::text AS day_date, label
      `;
      if (!deleted) return res.status(404).json({ error: 'Shift not found' });
      await logAudit(sql, req, user, {
        action: 'staffschedule.delete_shift',
        resource_type: 'sched_shift', resource_id: String(id),
        details: deleted
      });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('[staff-schedule] error', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
