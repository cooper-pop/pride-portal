// api/fish-schedule.js
// Live Fish Scheduling widget — Phase 1
//
// Weekly schedule of fish deliveries from farmers (live haulers) into the
// POTP plant. One row per expected delivery. Each delivery is keyed to a
// day + time slot + farmer, with expected pounds.
//
// Time slots reflect when trucks show up (or are expected to):
//   startup   — previous evening, fish sit overnight for next morning's kill
//   morning   — 5-10 am
//   noon      — 10am-2pm
//   afternoon — 2pm onward
//
// Days can be flagged "No Kill" — a separate per-day row stores that + any
// day-level notes. Scheduling happens on a per-day basis; Phase 2 will layer
// vat-fill tracking on top of these delivery rows.
//
// New tables (live_haul_*) so the old draft tables (fish_vats, fish_producers,
// fish_deliveries) are left alone for reference.

const { neon } = require('@neondatabase/serverless');
const perms = require('./_permissions');
const { logAudit } = require('./_audit');

async function ensureTables(sql) {
  // Farmers / live haulers that send us fish. Soft-deleted via active=false
  // so historical deliveries keep their farmer reference even after a
  // farmer is removed from the active list.
  await sql`CREATE TABLE IF NOT EXISTS live_haul_farmers (
    id SERIAL PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#1a3a6b',
    active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS live_haul_farmers_company_idx
    ON live_haul_farmers(company_id, active)`;

  // Per-day overrides. Every queried day doesn't need a row — only days with
  // No-Kill flagged or notes attached. Missing row = normal workday with no
  // special notes.
  await sql`CREATE TABLE IF NOT EXISTS live_haul_days (
    id SERIAL PRIMARY KEY,
    company_id TEXT NOT NULL,
    day_date DATE NOT NULL,
    is_no_kill BOOLEAN DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id, day_date)
  )`;

  // Deliveries — one row per scheduled truck arrival. Pounds are tracked as
  // expected (planned) and actual (recorded after arrival in Phase 2/3).
  await sql`CREATE TABLE IF NOT EXISTS live_haul_deliveries (
    id SERIAL PRIMARY KEY,
    company_id TEXT NOT NULL,
    day_date DATE NOT NULL,
    farmer_id INTEGER NOT NULL REFERENCES live_haul_farmers(id) ON DELETE CASCADE,
    time_slot TEXT NOT NULL,
    expected_lbs INTEGER,
    actual_lbs INTEGER,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS live_haul_deliveries_company_day_idx
    ON live_haul_deliveries(company_id, day_date)`;
  await sql`CREATE INDEX IF NOT EXISTS live_haul_deliveries_farmer_idx
    ON live_haul_deliveries(farmer_id)`;

  // ── Phase B: per-load intake (actual truck arrival) ──────────────────
  // One row per truck that actually showed up. Optionally linked back to a
  // scheduled delivery via delivery_id, so the Schedule tab can show
  // "actual vs expected" once a load is recorded.
  //
  // Size bands match Cooper's spec: 0-4 / 4.01-5.99 / 6-7.99 / 8+ lbs per
  // fish. Stored as pounds in each band (not fish count) so totals
  // reconcile directly with net_lbs.
  //
  // Deductions are in *pounds*, not count. Dock price is optional — not
  // every load has one (supply-and-demand driven). Computed fields
  // (net_lbs, payable_lbs, payable_total) are denormalized on save so
  // reports don't re-compute on every query.
  await sql`CREATE TABLE IF NOT EXISTS live_haul_loads (
    id SERIAL PRIMARY KEY,
    company_id TEXT NOT NULL,
    day_date DATE NOT NULL,
    arrived_at TIMESTAMPTZ,

    farmer_id INTEGER REFERENCES live_haul_farmers(id),
    pond_ref TEXT,
    truck_ref TEXT,
    delivery_id INTEGER REFERENCES live_haul_deliveries(id) ON DELETE SET NULL,

    gross_lbs NUMERIC,
    tare_lbs NUMERIC,
    net_lbs NUMERIC,

    size_0_4_lbs NUMERIC DEFAULT 0,
    size_4_6_lbs NUMERIC DEFAULT 0,
    size_6_8_lbs NUMERIC DEFAULT 0,
    size_8_plus_lbs NUMERIC DEFAULT 0,

    deduction_lbs NUMERIC DEFAULT 0,
    deduction_reason TEXT,

    dock_price_per_lb NUMERIC,
    payable_lbs NUMERIC,
    payable_total NUMERIC,

    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS live_haul_loads_company_day_idx
    ON live_haul_loads(company_id, day_date)`;
  await sql`CREATE INDEX IF NOT EXISTS live_haul_loads_farmer_idx
    ON live_haul_loads(farmer_id)`;
  await sql`CREATE INDEX IF NOT EXISTS live_haul_loads_delivery_idx
    ON live_haul_loads(delivery_id)`;
}

const VALID_TIME_SLOTS = new Set(['startup', 'morning', 'noon', 'afternoon']);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);
  const url = new URL(req.url, 'http://x');
  const action = (req.query && req.query.action) || url.searchParams.get('action') || '';

  try {
    await ensureTables(sql);
  } catch (e) {
    console.error('[fish-schedule] ensureTables failed:', e.message);
  }

  // Auth. The view action allows supervisor+, write actions require the
  // right perm level per the permissions matrix.
  const user = perms.requireAuth(req, res);
  if (!user) return;
  const companyId = String(user.company_id);

  try {
    // ── GET get_state ────────────────────────────────────────────────────
    // Returns everything the frontend needs to render a week:
    //   { farmers, days: [{ day_date, is_no_kill, notes, deliveries: [...] }] }
    // Includes every day in the requested week (7 days), even ones with no
    // deliveries, so the UI can render empty cards.
    if (req.method === 'GET' && action === 'get_state') {
      if (!perms.canPerform(user, 'fishschedule', 'view')) {
        return perms.deny(res, user, 'fishschedule', 'view');
      }
      const weekStart = (url.searchParams.get('week_start') || '').trim();
      if (!weekStart) return res.status(400).json({ error: 'week_start required (YYYY-MM-DD)' });

      // Compute Sunday (week_start) through Saturday (week_start+6)
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart + 'T00:00:00');
        d.setDate(d.getDate() + i);
        days.push(d.toISOString().split('T')[0]);
      }
      const weekEnd = days[6];

      const farmers = await sql`
        SELECT id, name, color, active, notes
        FROM live_haul_farmers
        WHERE company_id = ${companyId} AND active = true
        ORDER BY name
      `;
      const dayRows = await sql`
        SELECT day_date, is_no_kill, notes
        FROM live_haul_days
        WHERE company_id = ${companyId}
          AND day_date >= ${weekStart}::date
          AND day_date <= ${weekEnd}::date
      `;
      const deliveries = await sql`
        SELECT id, day_date, farmer_id, time_slot, expected_lbs, actual_lbs, notes, updated_at
        FROM live_haul_deliveries
        WHERE company_id = ${companyId}
          AND day_date >= ${weekStart}::date
          AND day_date <= ${weekEnd}::date
        ORDER BY time_slot, id
      `;

      // Sum net_lbs across any intake loads linked to each delivery. This
      // is how the Schedule tab renders "actual vs expected" once a truck
      // has been received — no second round-trip, no Phase-B coupling in
      // the frontend. Missing delivery_id = unlinked load, excluded here.
      const linkedLoads = await sql`
        SELECT delivery_id, SUM(net_lbs) AS net_sum, COUNT(*) AS load_count
        FROM live_haul_loads
        WHERE company_id = ${companyId}
          AND delivery_id IS NOT NULL
          AND day_date >= ${weekStart}::date
          AND day_date <= ${weekEnd}::date
        GROUP BY delivery_id
      `;
      const actualByDelivery = {};
      linkedLoads.forEach(r => {
        actualByDelivery[r.delivery_id] = {
          net_sum: r.net_sum == null ? null : Number(r.net_sum),
          load_count: Number(r.load_count) || 0
        };
      });

      // Index day-level notes by ISO date for O(1) lookup while building the
      // final day objects.
      const dayByDate = {};
      dayRows.forEach(d => {
        // Postgres DATE -> JS Date; convert back to YYYY-MM-DD
        const k = (d.day_date instanceof Date)
          ? d.day_date.toISOString().split('T')[0]
          : String(d.day_date).slice(0, 10);
        dayByDate[k] = { is_no_kill: !!d.is_no_kill, notes: d.notes || '' };
      });

      const delByDate = {};
      deliveries.forEach(x => {
        const k = (x.day_date instanceof Date)
          ? x.day_date.toISOString().split('T')[0]
          : String(x.day_date).slice(0, 10);
        const linked = actualByDelivery[x.id];
        (delByDate[k] = delByDate[k] || []).push({
          id: x.id,
          farmer_id: x.farmer_id,
          time_slot: x.time_slot,
          expected_lbs: x.expected_lbs,
          actual_lbs: x.actual_lbs, // legacy column (kept in sync for now)
          actual_net_lbs: linked ? linked.net_sum : null, // Phase B: summed from loads
          linked_load_count: linked ? linked.load_count : 0,
          notes: x.notes || ''
        });
      });

      const result = days.map(d => ({
        day_date: d,
        is_no_kill: (dayByDate[d] && dayByDate[d].is_no_kill) || false,
        notes: (dayByDate[d] && dayByDate[d].notes) || '',
        deliveries: delByDate[d] || []
      }));

      return res.json({ ok: true, week_start: weekStart, farmers, days: result });
    }

    // ── POST save_farmer ─────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'save_farmer') {
      if (!perms.canPerform(user, 'fishschedule', req.body && req.body.id ? 'edit' : 'create')) {
        return perms.deny(res, user, 'fishschedule', req.body && req.body.id ? 'edit' : 'create');
      }
      const { id, name, color, notes } = req.body || {};
      const cleanName = String(name || '').trim();
      if (!cleanName) return res.status(400).json({ error: 'Farmer name required' });
      const cleanColor = (color && /^#[0-9a-fA-F]{6}$/.test(color)) ? color : '#1a3a6b';

      if (id) {
        const [updated] = await sql`
          UPDATE live_haul_farmers
          SET name = ${cleanName}, color = ${cleanColor}, notes = ${notes || null}, updated_at = NOW()
          WHERE id = ${id} AND company_id = ${companyId}
          RETURNING id, name, color, active, notes
        `;
        await logAudit(sql, req, user, {
          action: 'fishschedule.save_farmer',
          resource_type: 'farmer', resource_id: id,
          details: { name: cleanName, updated: true }
        });
        return res.json({ ok: true, farmer: updated });
      }

      // Create — reject duplicate active names (case-insensitive)
      const existing = await sql`
        SELECT id FROM live_haul_farmers
        WHERE company_id = ${companyId} AND active = true AND LOWER(name) = LOWER(${cleanName})
        LIMIT 1
      `;
      if (existing.length) return res.status(400).json({ error: 'A farmer by that name already exists' });

      const [created] = await sql`
        INSERT INTO live_haul_farmers (company_id, name, color, notes)
        VALUES (${companyId}, ${cleanName}, ${cleanColor}, ${notes || null})
        RETURNING id, name, color, active, notes
      `;
      await logAudit(sql, req, user, {
        action: 'fishschedule.save_farmer',
        resource_type: 'farmer', resource_id: created.id,
        details: { name: cleanName, updated: false }
      });
      return res.json({ ok: true, farmer: created });
    }

    // ── POST delete_farmer ───────────────────────────────────────────────
    // Soft delete — keeps historical deliveries intact.
    if (req.method === 'POST' && action === 'delete_farmer') {
      if (!perms.canPerform(user, 'fishschedule', 'delete')) {
        return perms.deny(res, user, 'fishschedule', 'delete');
      }
      const id = (req.body && req.body.id) || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`UPDATE live_haul_farmers SET active = false, updated_at = NOW()
                WHERE id = ${id} AND company_id = ${companyId}`;
      await logAudit(sql, req, user, {
        action: 'fishschedule.delete_farmer',
        resource_type: 'farmer', resource_id: id
      });
      return res.json({ ok: true });
    }

    // ── POST save_delivery ───────────────────────────────────────────────
    if (req.method === 'POST' && action === 'save_delivery') {
      if (!perms.canPerform(user, 'fishschedule', req.body && req.body.id ? 'edit' : 'create')) {
        return perms.deny(res, user, 'fishschedule', req.body && req.body.id ? 'edit' : 'create');
      }
      const b = req.body || {};
      const dayDate = String(b.day_date || '').trim();
      const timeSlot = String(b.time_slot || '').trim();
      const farmerId = parseInt(b.farmer_id, 10);
      const expectedLbs = b.expected_lbs === '' || b.expected_lbs == null ? null : parseInt(b.expected_lbs, 10);
      const actualLbs = b.actual_lbs === '' || b.actual_lbs == null ? null : parseInt(b.actual_lbs, 10);
      const notes = b.notes || null;

      if (!dayDate) return res.status(400).json({ error: 'day_date required' });
      if (!VALID_TIME_SLOTS.has(timeSlot)) return res.status(400).json({ error: 'invalid time_slot' });
      if (!farmerId || isNaN(farmerId)) return res.status(400).json({ error: 'farmer_id required' });
      if (expectedLbs !== null && (isNaN(expectedLbs) || expectedLbs < 0)) {
        return res.status(400).json({ error: 'expected_lbs must be a non-negative number' });
      }

      if (b.id) {
        const [updated] = await sql`
          UPDATE live_haul_deliveries
          SET farmer_id = ${farmerId}, time_slot = ${timeSlot},
              expected_lbs = ${expectedLbs}, actual_lbs = ${actualLbs}, notes = ${notes},
              day_date = ${dayDate}::date, updated_at = NOW()
          WHERE id = ${b.id} AND company_id = ${companyId}
          RETURNING id, day_date, farmer_id, time_slot, expected_lbs, actual_lbs, notes
        `;
        await logAudit(sql, req, user, {
          action: 'fishschedule.save_delivery',
          resource_type: 'delivery', resource_id: b.id,
          details: { day_date: dayDate, farmer_id: farmerId, time_slot: timeSlot, expected_lbs: expectedLbs, updated: true }
        });
        return res.json({ ok: true, delivery: updated });
      }

      const [created] = await sql`
        INSERT INTO live_haul_deliveries
          (company_id, day_date, farmer_id, time_slot, expected_lbs, actual_lbs, notes)
        VALUES
          (${companyId}, ${dayDate}::date, ${farmerId}, ${timeSlot}, ${expectedLbs}, ${actualLbs}, ${notes})
        RETURNING id, day_date, farmer_id, time_slot, expected_lbs, actual_lbs, notes
      `;
      await logAudit(sql, req, user, {
        action: 'fishschedule.save_delivery',
        resource_type: 'delivery', resource_id: created.id,
        details: { day_date: dayDate, farmer_id: farmerId, time_slot: timeSlot, expected_lbs: expectedLbs, updated: false }
      });
      return res.json({ ok: true, delivery: created });
    }

    // ── POST delete_delivery ────────────────────────────────────────────
    if (req.method === 'POST' && action === 'delete_delivery') {
      if (!perms.canPerform(user, 'fishschedule', 'delete')) {
        return perms.deny(res, user, 'fishschedule', 'delete');
      }
      const id = (req.body && req.body.id) || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM live_haul_deliveries WHERE id = ${id} AND company_id = ${companyId}`;
      await logAudit(sql, req, user, {
        action: 'fishschedule.delete_delivery',
        resource_type: 'delivery', resource_id: id
      });
      return res.json({ ok: true });
    }

    // ── POST import_flv_farmers ─────────────────────────────────────────
    // One-click import of the non-archived farmer list from the Flavor Sample
    // widget (flv_farmers table). Deduped by case-insensitive name against
    // live_haul_farmers. Notes field is carried over; color defaults to the
    // portal blue (can be changed after import via save_farmer).
    //
    // flv_farmers.company_id is INT, so we cast user.company_id for the
    // lookup. Skips any flv farmers whose name already exists here.
    if (req.method === 'POST' && action === 'import_flv_farmers') {
      if (!perms.canPerform(user, 'fishschedule', 'create')) {
        return perms.deny(res, user, 'fishschedule', 'create');
      }
      const companyIdInt = parseInt(companyId, 10);
      let source;
      try {
        source = await sql`
          SELECT name, notes FROM flv_farmers
          WHERE company_id = ${companyIdInt} AND archived = false
          ORDER BY name
        `;
      } catch (e) {
        // If the flavor table doesn't exist yet (shouldn't happen in prod
        // but can happen on a fresh DB), return a clean error instead of
        // letting it bubble up.
        return res.status(400).json({ error: 'Flavor Sample farmers not available on this company yet.' });
      }
      if (!source.length) {
        return res.json({ ok: true, imported: 0, skipped: 0, total_flv: 0, created_names: [] });
      }

      // Existing names in the schedule table, for dedupe
      const existing = await sql`
        SELECT LOWER(TRIM(name)) AS key FROM live_haul_farmers WHERE company_id = ${companyId}
      `;
      const existingSet = new Set(existing.map(r => r.key));

      const createdNames = [];
      let skipped = 0;
      for (const f of source) {
        const key = String(f.name || '').trim().toLowerCase();
        if (!key) { skipped++; continue; }
        if (existingSet.has(key)) { skipped++; continue; }
        await sql`
          INSERT INTO live_haul_farmers (company_id, name, color, notes)
          VALUES (${companyId}, ${f.name.trim()}, '#1a3a6b', ${f.notes || null})
        `;
        existingSet.add(key);
        createdNames.push(f.name.trim());
      }

      await logAudit(sql, req, user, {
        action: 'fishschedule.import_flv_farmers',
        resource_type: 'farmer',
        details: {
          total_flv: source.length,
          imported: createdNames.length,
          skipped,
          imported_names: createdNames
        }
      });

      return res.json({
        ok: true,
        imported: createdNames.length,
        skipped,
        total_flv: source.length,
        created_names: createdNames
      });
    }

    // ── POST save_day ───────────────────────────────────────────────────
    // Upsert day-level data (No Kill flag + daily notes).
    if (req.method === 'POST' && action === 'save_day') {
      if (!perms.canPerform(user, 'fishschedule', 'edit')) {
        return perms.deny(res, user, 'fishschedule', 'edit');
      }
      const b = req.body || {};
      const dayDate = String(b.day_date || '').trim();
      if (!dayDate) return res.status(400).json({ error: 'day_date required' });
      const isNoKill = !!b.is_no_kill;
      const notes = (b.notes === undefined || b.notes === null) ? null : String(b.notes);

      await sql`
        INSERT INTO live_haul_days (company_id, day_date, is_no_kill, notes, updated_at)
        VALUES (${companyId}, ${dayDate}::date, ${isNoKill}, ${notes}, NOW())
        ON CONFLICT (company_id, day_date)
        DO UPDATE SET is_no_kill = ${isNoKill}, notes = ${notes}, updated_at = NOW()
      `;
      await logAudit(sql, req, user, {
        action: 'fishschedule.save_day',
        resource_type: 'day', resource_id: dayDate,
        details: { is_no_kill: isNoKill }
      });
      return res.json({ ok: true });
    }

    // ── GET get_intake ──────────────────────────────────────────────────
    // Returns every intake load for a week, plus the same farmer + delivery
    // metadata the Schedule tab uses so the Intake UI can render farmer
    // names / scheduled-delivery pickers without a second round-trip.
    //
    // Shape:
    //   { farmers, deliveries: [...], loads: [{...}] }
    // Deliveries are filtered to the same week so the "Fulfill scheduled
    // delivery" dropdown stays manageable.
    if (req.method === 'GET' && action === 'get_intake') {
      if (!perms.canPerform(user, 'fishschedule', 'view')) {
        return perms.deny(res, user, 'fishschedule', 'view');
      }
      const weekStart = (url.searchParams.get('week_start') || '').trim();
      if (!weekStart) return res.status(400).json({ error: 'week_start required (YYYY-MM-DD)' });
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart + 'T00:00:00');
        d.setDate(d.getDate() + i);
        days.push(d.toISOString().split('T')[0]);
      }
      const weekEnd = days[6];

      const farmers = await sql`
        SELECT id, name, color, active, notes
        FROM live_haul_farmers
        WHERE company_id = ${companyId} AND active = true
        ORDER BY name
      `;
      const deliveries = await sql`
        SELECT id, day_date, farmer_id, time_slot, expected_lbs
        FROM live_haul_deliveries
        WHERE company_id = ${companyId}
          AND day_date >= ${weekStart}::date
          AND day_date <= ${weekEnd}::date
        ORDER BY day_date, time_slot, id
      `;
      const loads = await sql`
        SELECT id, day_date, arrived_at, farmer_id, pond_ref, truck_ref, delivery_id,
               gross_lbs, tare_lbs, net_lbs,
               size_0_4_lbs, size_4_6_lbs, size_6_8_lbs, size_8_plus_lbs,
               deduction_lbs, deduction_reason,
               dock_price_per_lb, payable_lbs, payable_total,
               notes, updated_at
        FROM live_haul_loads
        WHERE company_id = ${companyId}
          AND day_date >= ${weekStart}::date
          AND day_date <= ${weekEnd}::date
        ORDER BY day_date, arrived_at NULLS LAST, id
      `;

      // Normalize Postgres DATE → YYYY-MM-DD so the frontend can key by
      // string without worrying about timezone math.
      const norm = (x) => (x && x.day_date instanceof Date)
        ? Object.assign({}, x, { day_date: x.day_date.toISOString().split('T')[0] })
        : x;

      return res.json({
        ok: true,
        week_start: weekStart,
        farmers,
        deliveries: deliveries.map(norm),
        loads: loads.map(norm)
      });
    }

    // ── POST save_load ──────────────────────────────────────────────────
    // Upsert a per-load intake record. Computes net_lbs / payable_lbs /
    // payable_total from the submitted numbers so reports never have to.
    //
    // Size bands are optional individually, but if any are provided the
    // sum is not enforced to equal net_lbs — operators often leave bands
    // empty when they haven't graded a load yet, or the net comes from a
    // truck scale while size bands come later off the grader. Mismatch is
    // reported in the UI, not blocked on save.
    if (req.method === 'POST' && action === 'save_load') {
      const body = req.body || {};
      if (!perms.canPerform(user, 'fishschedule', body.id ? 'edit' : 'create')) {
        return perms.deny(res, user, 'fishschedule', body.id ? 'edit' : 'create');
      }
      const dayDate = String(body.day_date || '').trim();
      if (!dayDate) return res.status(400).json({ error: 'day_date required' });

      // Pull + coerce numerics. Empty string / null / undefined → null so
      // Postgres stores NULL instead of 0 (important for "not entered yet"
      // vs "entered as 0").
      const num = (v) => {
        if (v === '' || v === null || v === undefined) return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
      };
      const farmerId = body.farmer_id ? parseInt(body.farmer_id, 10) : null;
      const deliveryId = body.delivery_id ? parseInt(body.delivery_id, 10) : null;
      const arrivedAt = body.arrived_at || null;
      const pondRef = (body.pond_ref || '').trim() || null;
      const truckRef = (body.truck_ref || '').trim() || null;

      const gross = num(body.gross_lbs);
      const tare = num(body.tare_lbs);
      const sz04 = num(body.size_0_4_lbs) || 0;
      const sz46 = num(body.size_4_6_lbs) || 0;
      const sz68 = num(body.size_6_8_lbs) || 0;
      const sz8p = num(body.size_8_plus_lbs) || 0;
      const deduction = num(body.deduction_lbs) || 0;
      const deductionReason = (body.deduction_reason || '').trim() || null;
      const dockPrice = num(body.dock_price_per_lb);
      const notes = (body.notes || '').trim() || null;

      // Derived. If gross & tare provided, net = gross - tare; otherwise
      // net can be entered directly (body.net_lbs override).
      let net = num(body.net_lbs);
      if (net == null && gross != null && tare != null) net = gross - tare;
      const payableLbs = (net == null) ? null : (net - deduction);
      const payableTotal = (payableLbs != null && dockPrice != null)
        ? Math.round(payableLbs * dockPrice * 100) / 100
        : null;

      if (farmerId === null) return res.status(400).json({ error: 'farmer_id required' });

      if (body.id) {
        const [updated] = await sql`
          UPDATE live_haul_loads
          SET day_date = ${dayDate}::date, arrived_at = ${arrivedAt},
              farmer_id = ${farmerId}, pond_ref = ${pondRef}, truck_ref = ${truckRef},
              delivery_id = ${deliveryId},
              gross_lbs = ${gross}, tare_lbs = ${tare}, net_lbs = ${net},
              size_0_4_lbs = ${sz04}, size_4_6_lbs = ${sz46},
              size_6_8_lbs = ${sz68}, size_8_plus_lbs = ${sz8p},
              deduction_lbs = ${deduction}, deduction_reason = ${deductionReason},
              dock_price_per_lb = ${dockPrice}, payable_lbs = ${payableLbs},
              payable_total = ${payableTotal},
              notes = ${notes}, updated_at = NOW()
          WHERE id = ${body.id} AND company_id = ${companyId}
          RETURNING id, day_date, arrived_at, farmer_id, pond_ref, truck_ref, delivery_id,
                    gross_lbs, tare_lbs, net_lbs,
                    size_0_4_lbs, size_4_6_lbs, size_6_8_lbs, size_8_plus_lbs,
                    deduction_lbs, deduction_reason,
                    dock_price_per_lb, payable_lbs, payable_total, notes
        `;
        await logAudit(sql, req, user, {
          action: 'fishschedule.save_load',
          resource_type: 'load', resource_id: body.id,
          details: { day_date: dayDate, farmer_id: farmerId, net_lbs: net, updated: true }
        });
        return res.json({ ok: true, load: updated });
      }

      const [created] = await sql`
        INSERT INTO live_haul_loads
          (company_id, day_date, arrived_at, farmer_id, pond_ref, truck_ref, delivery_id,
           gross_lbs, tare_lbs, net_lbs,
           size_0_4_lbs, size_4_6_lbs, size_6_8_lbs, size_8_plus_lbs,
           deduction_lbs, deduction_reason,
           dock_price_per_lb, payable_lbs, payable_total, notes)
        VALUES
          (${companyId}, ${dayDate}::date, ${arrivedAt}, ${farmerId}, ${pondRef}, ${truckRef}, ${deliveryId},
           ${gross}, ${tare}, ${net},
           ${sz04}, ${sz46}, ${sz68}, ${sz8p},
           ${deduction}, ${deductionReason},
           ${dockPrice}, ${payableLbs}, ${payableTotal}, ${notes})
        RETURNING id, day_date, arrived_at, farmer_id, pond_ref, truck_ref, delivery_id,
                  gross_lbs, tare_lbs, net_lbs,
                  size_0_4_lbs, size_4_6_lbs, size_6_8_lbs, size_8_plus_lbs,
                  deduction_lbs, deduction_reason,
                  dock_price_per_lb, payable_lbs, payable_total, notes
      `;
      await logAudit(sql, req, user, {
        action: 'fishschedule.save_load',
        resource_type: 'load', resource_id: created.id,
        details: { day_date: dayDate, farmer_id: farmerId, net_lbs: net, updated: false }
      });
      return res.json({ ok: true, load: created });
    }

    // ── POST delete_load ────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'delete_load') {
      if (!perms.canPerform(user, 'fishschedule', 'delete')) {
        return perms.deny(res, user, 'fishschedule', 'delete');
      }
      const id = (req.body && req.body.id) || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM live_haul_loads WHERE id = ${id} AND company_id = ${companyId}`;
      await logAudit(sql, req, user, {
        action: 'fishschedule.delete_load',
        resource_type: 'load', resource_id: id
      });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('[fish-schedule] error', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
