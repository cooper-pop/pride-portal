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
const cloudinary = require('cloudinary').v2;
const perms = require('./_permissions');
const { logAudit } = require('./_audit');

// Lazy Cloudinary config — sets up the global SDK once per cold start.
// Used for producer-agreement uploads (signed direct-from-browser POSTs).
let _cloudinaryConfigured = false;
function configureCloudinary() {
  if (_cloudinaryConfigured) return;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
  _cloudinaryConfigured = true;
}

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
  // Producer agreement attachment — one PDF per farmer, stored in Cloudinary.
  // Same column conventions as bid_documents / parts_manuals: file_url for
  // display/download, cloudinary_public_id for future deletion + signed
  // operations. Filename + uploader/timestamp captured for audit.
  try {
    await sql`ALTER TABLE live_haul_farmers ADD COLUMN IF NOT EXISTS agreement_file_url TEXT`;
    await sql`ALTER TABLE live_haul_farmers ADD COLUMN IF NOT EXISTS agreement_cloudinary_id TEXT`;
    await sql`ALTER TABLE live_haul_farmers ADD COLUMN IF NOT EXISTS agreement_filename TEXT`;
    await sql`ALTER TABLE live_haul_farmers ADD COLUMN IF NOT EXISTS agreement_uploaded_at TIMESTAMPTZ`;
    await sql`ALTER TABLE live_haul_farmers ADD COLUMN IF NOT EXISTS agreement_uploaded_by TEXT`;
    // Effective date — when the agreement was actually signed by both
    // parties. Distinct from uploaded_at, since operators sometimes scan
    // months-old documents. Expiration = effective_date + 1 year.
    await sql`ALTER TABLE live_haul_farmers ADD COLUMN IF NOT EXISTS agreement_effective_date DATE`;
  } catch (e) { /* already present */ }

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

  // ── Fish Payable (invoice) — per-band prices + invoice number ─────────
  // Matches the yield-master FISH PAYABLE TOTAL sheet exactly:
  //   4–5.99 / 6–7.99 / 8+ are directly entered in pounds.
  //   "Net" band on the invoice = 0–4 remainder = net - (4-5.99 + 6-7.99 + 8+).
  //   Each band has its own $/lb price; Amount = Σ(band_lbs × band_price).
  //
  // Invoice numbers follow Cooper's convention: M(no leading zero) + DD +
  // YY + NN (seq per day, counts across all farmers in arrival order).
  // Example: first load on 4/24/2026 → "4242601".
  try {
    await sql`ALTER TABLE live_haul_loads ADD COLUMN IF NOT EXISTS invoice_number TEXT`;
    await sql`ALTER TABLE live_haul_loads ADD COLUMN IF NOT EXISTS price_4_6_per_lb NUMERIC`;
    await sql`ALTER TABLE live_haul_loads ADD COLUMN IF NOT EXISTS price_6_8_per_lb NUMERIC`;
    await sql`ALTER TABLE live_haul_loads ADD COLUMN IF NOT EXISTS price_8_plus_per_lb NUMERIC`;
    await sql`ALTER TABLE live_haul_loads ADD COLUMN IF NOT EXISTS price_0_4_per_lb NUMERIC`;
    // Deduction breakdown columns (Cooper's 5 categories). The old single
    // deduction_lbs field is kept as the TOTAL (auto-summed on save); old
    // deduction_reason is kept for back-compat but new entry replaces it
    // with category-specific columns.
    await sql`ALTER TABLE live_haul_loads ADD COLUMN IF NOT EXISTS deduction_doa_lbs NUMERIC DEFAULT 0`;
    await sql`ALTER TABLE live_haul_loads ADD COLUMN IF NOT EXISTS deduction_shad_lbs NUMERIC DEFAULT 0`;
    await sql`ALTER TABLE live_haul_loads ADD COLUMN IF NOT EXISTS deduction_turtles_lbs NUMERIC DEFAULT 0`;
    await sql`ALTER TABLE live_haul_loads ADD COLUMN IF NOT EXISTS deduction_other_species_lbs NUMERIC DEFAULT 0`;
    await sql`ALTER TABLE live_haul_loads ADD COLUMN IF NOT EXISTS deduction_fingerlings_lbs NUMERIC DEFAULT 0`;
    // Movement ticket number — the ticket from the farmer's farm-side scale
    // when fish were loaded onto the truck. Not the same as our invoice_number;
    // this is the farmer's reference number for reconciliation.
    await sql`ALTER TABLE live_haul_loads ADD COLUMN IF NOT EXISTS movement_ticket_number TEXT`;
  } catch (e) { /* already present */ }
  await sql`CREATE INDEX IF NOT EXISTS live_haul_loads_invoice_idx
    ON live_haul_loads(invoice_number)`;

  // ── Dock Price config (per company) ───────────────────────────────────
  // Each company has a single row holding the active dock-price profile:
  //   - dock_active: true while we're buying, false during a "no-buy" stretch
  //   - 4 tier slots, each with editable label + min/max range + default $/lb
  //
  // The size_*_lbs / price_*_per_lb columns on live_haul_loads still map to
  // these slots positionally (tier1 = 0-4, tier2 = 4-5.99, tier3 = 6-7.99,
  // tier4 = 8+). The tier *labels* are display-only — operators can rename
  // them and adjust ranges without us migrating any historical data. The
  // labels propagate to the Intake modal, Fish Payable invoice, and card.
  await sql`CREATE TABLE IF NOT EXISTS live_haul_dock_config (
    company_id TEXT PRIMARY KEY,
    dock_active BOOLEAN DEFAULT true,
    tier1_label TEXT DEFAULT '0–4 lb',
    tier1_min_lbs NUMERIC DEFAULT 0,
    tier1_max_lbs NUMERIC DEFAULT 4,
    tier1_default_price NUMERIC,
    tier2_label TEXT DEFAULT '4–5.99 lb',
    tier2_min_lbs NUMERIC DEFAULT 4,
    tier2_max_lbs NUMERIC DEFAULT 5.99,
    tier2_default_price NUMERIC,
    tier3_label TEXT DEFAULT '6–7.99 lb',
    tier3_min_lbs NUMERIC DEFAULT 6,
    tier3_max_lbs NUMERIC DEFAULT 7.99,
    tier3_default_price NUMERIC,
    tier4_label TEXT DEFAULT '8+ lb',
    tier4_min_lbs NUMERIC DEFAULT 8,
    tier4_max_lbs NUMERIC,
    tier4_default_price NUMERIC,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT
  )`;
}

// Fetch (or lazily create) the dock config for a company. Always returns a
// fully-populated config object so callers don't have to deal with missing
// rows.
async function getOrCreateDockConfig(sql, companyId) {
  let rows = await sql`SELECT * FROM live_haul_dock_config WHERE company_id = ${companyId}`;
  if (rows.length === 0) {
    await sql`INSERT INTO live_haul_dock_config (company_id) VALUES (${companyId})
              ON CONFLICT (company_id) DO NOTHING`;
    rows = await sql`SELECT * FROM live_haul_dock_config WHERE company_id = ${companyId}`;
  }
  return rows[0];
}

// Generate invoice number from an ISO date string (YYYY-MM-DD) + sequence.
// Month has no leading zero; day + year are 2 digits; NN is zero-padded 2
// digits (supports 3+ for the unlikely 100+ loads in a day).
//   2026-04-24 seq=1  → "4242601"
//   2026-11-24 seq=1  → "11242601"
function formatInvoiceNumber(isoDate, seq) {
  const [y, m, d] = isoDate.split('-');
  const month = String(parseInt(m, 10));
  const dd = d;
  const yy = y.slice(-2);
  const nn = String(seq).padStart(2, '0');
  return month + dd + yy + nn;
}

// Given a list of existing invoice numbers for a day, return the next seq
// to use. Stable across deletes: if invoice 04 is deleted, 05/06 keep their
// numbers and the next new load gets max+1 (not the gap).
function nextSeqFromInvoices(invoiceNumbers) {
  let maxSeq = 0;
  invoiceNumbers.forEach(inv => {
    if (!inv) return;
    // Last 2+ digits = seq. Everything before is MDDYY.
    // Since MDDYY is fixed 5-7 chars, we parse seq as whatever trails them.
    // Simplest: look for trailing digits (at least 2).
    const m = String(inv).match(/(\d{2,})$/);
    if (!m) return;
    // But "42426" is MDDYY and we'd match "26" — use length-based split:
    // Month 1-digit: MDDYY = 5 chars, seq starts at char 5.
    // Month 2-digit: MDDYY = 6 chars, seq starts at char 6.
    // We can't tell month length from the string alone, so walk: try last
    // 2 digits, then 3, 4... and see which produces a plausible date prefix.
    // Simpler heuristic: take all trailing digits, assume seq is the last 2
    // (or 3+ if total is >8 chars). Since max length for seq=99 is 8 chars
    // (MM + DD + YY + NN), if the string is 7 or 8 chars, last 2 = seq.
    const total = String(inv).length;
    let seqStr;
    if (total >= 9) seqStr = String(inv).slice(-3);   // allows 100+ seq
    else seqStr = String(inv).slice(-2);
    const seq = parseInt(seqStr, 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  });
  return maxSeq + 1;
}

// Assign invoice_number to any loads in the given day that don't have one.
// Walks arrival order so the oldest load gets the lowest seq. Idempotent —
// loads with an existing invoice_number are left alone.
async function ensureInvoiceNumbersForDay(sql, companyId, isoDate) {
  const loads = await sql`
    SELECT id, invoice_number
    FROM live_haul_loads
    WHERE company_id = ${companyId} AND day_date = ${isoDate}::date
    ORDER BY arrived_at NULLS LAST, id
  `;
  const existing = loads.filter(l => l.invoice_number).map(l => l.invoice_number);
  let nextSeq = nextSeqFromInvoices(existing);
  for (const l of loads) {
    if (l.invoice_number) continue;
    const num = formatInvoiceNumber(isoDate, nextSeq);
    await sql`UPDATE live_haul_loads SET invoice_number = ${num} WHERE id = ${l.id}`;
    nextSeq++;
  }
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
        SELECT id, name, color, active, notes,
               agreement_file_url, agreement_cloudinary_id,
               agreement_filename, agreement_uploaded_at, agreement_uploaded_by,
               agreement_effective_date::text AS agreement_effective_date
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
        SELECT id, name, color, active, notes,
               agreement_file_url, agreement_cloudinary_id,
               agreement_filename, agreement_uploaded_at, agreement_uploaded_by,
               agreement_effective_date::text AS agreement_effective_date
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
               deduction_doa_lbs, deduction_shad_lbs, deduction_turtles_lbs,
               deduction_other_species_lbs, deduction_fingerlings_lbs,
               dock_price_per_lb,
               price_4_6_per_lb, price_6_8_per_lb, price_8_plus_per_lb, price_0_4_per_lb,
               payable_lbs, payable_total, invoice_number, movement_ticket_number,
               notes, updated_at
        FROM live_haul_loads
        WHERE company_id = ${companyId}
          AND day_date >= ${weekStart}::date
          AND day_date <= ${weekEnd}::date
        ORDER BY day_date, arrived_at NULLS LAST, id
      `;

      // Pull the company's flavor-sample ponds so the Intake form can offer
      // a per-farmer pond dropdown. Cooper's two systems (live-haul +
      // flavor) have separate `farmers` tables but the rows usually share
      // names, so we match case-insensitively on the trimmed name. If a
      // live-haul farmer doesn't have a corresponding flavor farmer, that
      // farmer just gets an empty pond list (the dropdown shows a hint to
      // add ponds in the Flavor widget).
      //
      // The flv_* tables use INTEGER company_id while live_haul_* uses TEXT
      // — cast to int to be unambiguous.
      const flvPondData = await sql`
        SELECT
          LOWER(TRIM(f.name)) AS farmer_key,
          g.name              AS group_name,
          p.number            AS pond_number
        FROM flv_ponds p
        JOIN flv_pond_groups g ON g.id = p.pond_group_id
        JOIN flv_farmers     f ON f.id = g.farmer_id
        WHERE f.company_id = ${companyId}::int
          AND f.archived = false
          AND g.archived = false
          AND p.archived = false
        ORDER BY f.name, g.name, p.number
      `;
      const flvByFarmerKey = {};
      flvPondData.forEach(r => {
        const key = r.farmer_key;
        if (!flvByFarmerKey[key]) flvByFarmerKey[key] = [];
        flvByFarmerKey[key].push({
          group: r.group_name,
          number: r.pond_number,
          label: r.group_name + ' › ' + r.pond_number
        });
      });
      const farmer_ponds = {};
      farmers.forEach(f => {
        const key = String(f.name || '').trim().toLowerCase();
        farmer_ponds[f.id] = flvByFarmerKey[key] || [];
      });

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
        loads: loads.map(norm),
        farmer_ponds
      });
    }

    // ── GET get_agreement_upload_signature ───────────────────────────────
    // Returns a signed payload the browser uses to POST a producer-agreement
    // PDF directly to Cloudinary. Manager+ only — supervisors don't sign
    // agreements. Mirrors the bids / manuals widget upload flow.
    if (req.method === 'GET' && action === 'get_agreement_upload_signature') {
      if (!perms.canPerform(user, 'fishschedule', 'edit')) {
        return perms.deny(res, user, 'fishschedule', 'edit');
      }
      configureCloudinary();
      const folder = 'producer-agreements';
      const timestamp = Math.round(Date.now() / 1000);
      const paramsToSign = { timestamp, folder };
      const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);
      return res.json({
        signature, timestamp, folder,
        api_key: process.env.CLOUDINARY_API_KEY,
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME
      });
    }

    // ── POST save_agreement ──────────────────────────────────────────────
    // Persists the Cloudinary URL + metadata onto the farmer record after
    // the browser finishes uploading. Manager+ only. effective_date is the
    // signing date (drives the +1 year expiration); upload time is captured
    // separately as audit metadata.
    if (req.method === 'POST' && action === 'save_agreement') {
      if (!perms.canPerform(user, 'fishschedule', 'edit')) {
        return perms.deny(res, user, 'fishschedule', 'edit');
      }
      const b = req.body || {};
      const farmerId = parseInt(b.farmer_id, 10);
      const fileUrl = String(b.file_url || '').trim();
      const cloudId = String(b.cloudinary_public_id || '').trim() || null;
      const filename = String(b.filename || '').trim() || null;
      const effDate = String(b.effective_date || '').trim();
      if (!farmerId) return res.status(400).json({ error: 'farmer_id required' });
      if (!fileUrl) return res.status(400).json({ error: 'file_url required' });
      // YYYY-MM-DD validation; null permitted (legacy or skip-date case).
      const effDateOrNull = (effDate && /^\d{4}-\d{2}-\d{2}$/.test(effDate)) ? effDate : null;
      const who = user.full_name || user.username || ('user#' + user.user_id);
      const [updated] = await sql`
        UPDATE live_haul_farmers
        SET agreement_file_url = ${fileUrl},
            agreement_cloudinary_id = ${cloudId},
            agreement_filename = ${filename},
            agreement_uploaded_at = NOW(),
            agreement_uploaded_by = ${who},
            agreement_effective_date = ${effDateOrNull}::date,
            updated_at = NOW()
        WHERE id = ${farmerId} AND company_id = ${companyId}
        RETURNING id, name, agreement_file_url, agreement_cloudinary_id,
                  agreement_filename, agreement_uploaded_at, agreement_uploaded_by,
                  agreement_effective_date
      `;
      if (!updated) return res.status(404).json({ error: 'Farmer not found' });
      await logAudit(sql, req, user, {
        action: 'fishschedule.save_agreement',
        resource_type: 'live_haul_farmer', resource_id: String(farmerId),
        details: { filename: filename, effective_date: effDateOrNull, by: who }
      });
      return res.json({ ok: true, farmer: updated });
    }

    // ── POST update_agreement_date ───────────────────────────────────────
    // Lets a manager fix the effective date without re-uploading the PDF.
    // Useful for backfilling old agreements that were uploaded before this
    // field existed, or correcting a typo. Manager+ only.
    if (req.method === 'POST' && action === 'update_agreement_date') {
      if (!perms.canPerform(user, 'fishschedule', 'edit')) {
        return perms.deny(res, user, 'fishschedule', 'edit');
      }
      const b = req.body || {};
      const farmerId = parseInt(b.farmer_id, 10);
      const effDate = String(b.effective_date || '').trim();
      if (!farmerId) return res.status(400).json({ error: 'farmer_id required' });
      const effDateOrNull = (effDate && /^\d{4}-\d{2}-\d{2}$/.test(effDate)) ? effDate : null;
      const [updated] = await sql`
        UPDATE live_haul_farmers
        SET agreement_effective_date = ${effDateOrNull}::date,
            updated_at = NOW()
        WHERE id = ${farmerId}
          AND company_id = ${companyId}
          AND agreement_file_url IS NOT NULL
        RETURNING id, name, agreement_effective_date
      `;
      if (!updated) return res.status(404).json({ error: 'Farmer not found or no agreement on file' });
      await logAudit(sql, req, user, {
        action: 'fishschedule.update_agreement_date',
        resource_type: 'live_haul_farmer', resource_id: String(farmerId),
        details: { effective_date: effDateOrNull }
      });
      return res.json({ ok: true, farmer: updated });
    }

    // ── POST delete_agreement ────────────────────────────────────────────
    // Removes the agreement reference on the farmer. We don't delete the
    // Cloudinary asset itself (audit trail) — just clear the columns.
    if (req.method === 'POST' && action === 'delete_agreement') {
      if (!perms.canPerform(user, 'fishschedule', 'edit')) {
        return perms.deny(res, user, 'fishschedule', 'edit');
      }
      const farmerId = parseInt(req.body && req.body.farmer_id, 10);
      if (!farmerId) return res.status(400).json({ error: 'farmer_id required' });
      const [prior] = await sql`
        SELECT agreement_cloudinary_id, agreement_filename
        FROM live_haul_farmers
        WHERE id = ${farmerId} AND company_id = ${companyId}
      `;
      const [updated] = await sql`
        UPDATE live_haul_farmers
        SET agreement_file_url = NULL,
            agreement_cloudinary_id = NULL,
            agreement_filename = NULL,
            agreement_uploaded_at = NULL,
            agreement_uploaded_by = NULL,
            updated_at = NOW()
        WHERE id = ${farmerId} AND company_id = ${companyId}
        RETURNING id, name
      `;
      if (!updated) return res.status(404).json({ error: 'Farmer not found' });
      await logAudit(sql, req, user, {
        action: 'fishschedule.delete_agreement',
        resource_type: 'live_haul_farmer', resource_id: String(farmerId),
        details: prior || {}
      });
      return res.json({ ok: true, farmer: updated });
    }

    // ── GET get_dock_config ──────────────────────────────────────────────
    // Active dock price profile for this company. Always returns a config
    // (creates a default row on first call). Anyone with fishschedule.view
    // can read it — needed to render the Intake modal labels.
    if (req.method === 'GET' && action === 'get_dock_config') {
      if (!perms.canPerform(user, 'fishschedule', 'view')) {
        return perms.deny(res, user, 'fishschedule', 'view');
      }
      const config = await getOrCreateDockConfig(sql, companyId);
      return res.json({ ok: true, config });
    }

    // ── POST save_dock_config ────────────────────────────────────────────
    // Updates the dock price profile. Manager+ only — supervisors enter
    // loads but don't set pricing. The four tier slots are positional, so
    // we always write all of them; the client sends a complete config.
    if (req.method === 'POST' && action === 'save_dock_config') {
      if (!perms.canPerform(user, 'fishschedule', 'edit')) {
        return perms.deny(res, user, 'fishschedule', 'edit');
      }
      const b = req.body || {};
      const num = (v) => {
        if (v === '' || v === null || v === undefined) return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
      };
      const dockActive = b.dock_active !== false; // default true
      const who = user.full_name || user.username || ('user#' + user.user_id);
      // Ensure the row exists first.
      await getOrCreateDockConfig(sql, companyId);
      await sql`
        UPDATE live_haul_dock_config
        SET dock_active = ${dockActive},
            tier1_label = ${(b.tier1_label || '').trim() || '0–4 lb'},
            tier1_min_lbs = ${num(b.tier1_min_lbs)},
            tier1_max_lbs = ${num(b.tier1_max_lbs)},
            tier1_default_price = ${num(b.tier1_default_price)},
            tier2_label = ${(b.tier2_label || '').trim() || '4–5.99 lb'},
            tier2_min_lbs = ${num(b.tier2_min_lbs)},
            tier2_max_lbs = ${num(b.tier2_max_lbs)},
            tier2_default_price = ${num(b.tier2_default_price)},
            tier3_label = ${(b.tier3_label || '').trim() || '6–7.99 lb'},
            tier3_min_lbs = ${num(b.tier3_min_lbs)},
            tier3_max_lbs = ${num(b.tier3_max_lbs)},
            tier3_default_price = ${num(b.tier3_default_price)},
            tier4_label = ${(b.tier4_label || '').trim() || '8+ lb'},
            tier4_min_lbs = ${num(b.tier4_min_lbs)},
            tier4_max_lbs = ${num(b.tier4_max_lbs)},
            tier4_default_price = ${num(b.tier4_default_price)},
            updated_at = NOW(),
            updated_by = ${who}
        WHERE company_id = ${companyId}
      `;
      const config = await getOrCreateDockConfig(sql, companyId);
      await logAudit(sql, req, user, {
        action: 'fishschedule.save_dock_config',
        resource_type: 'dock_config', resource_id: companyId,
        details: { dock_active: dockActive, by: who }
      });
      return res.json({ ok: true, config });
    }

    // ── GET get_payable ─────────────────────────────────────────────────
    // Returns invoice-ready rows for a date range (Fish Payable report).
    // Mirrors the yield master FISH PAYABLE TOTAL sheet column-for-column:
    //   Farmer · Invoice # · Date · Gross Lbs · Deduct ·
    //   4–5.99 Lbs + Price · 6–7.99 Lbs + Price · 8+ Lbs + Price ·
    //   Net (0–4 remainder) Lbs + Price · Amount
    //
    // Default range: most recent invoice week (Sun–Sat) unless start/end
    // passed. Any loads in the range that don't yet have an invoice_number
    // are backfilled on the way out (idempotent).
    if (req.method === 'GET' && action === 'get_payable') {
      if (!perms.canPerform(user, 'fishschedule', 'view')) {
        return perms.deny(res, user, 'fishschedule', 'view');
      }
      const weekStart = (url.searchParams.get('week_start') || '').trim();
      const customStart = (url.searchParams.get('start') || '').trim();
      const customEnd = (url.searchParams.get('end') || '').trim();

      let startDate, endDate;
      if (customStart && customEnd) {
        startDate = customStart;
        endDate = customEnd;
      } else if (weekStart) {
        startDate = weekStart;
        const e = new Date(weekStart + 'T00:00:00');
        e.setDate(e.getDate() + 6);
        endDate = e.toISOString().split('T')[0];
      } else {
        return res.status(400).json({ error: 'week_start or start+end required (YYYY-MM-DD)' });
      }

      // Backfill invoice numbers for any days in range that have un-numbered
      // loads. Cheap — one pass per day, skips days with nothing to assign.
      const daysInRange = [];
      {
        const s = new Date(startDate + 'T00:00:00');
        const e = new Date(endDate + 'T00:00:00');
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          daysInRange.push(d.toISOString().split('T')[0]);
        }
      }
      for (const d of daysInRange) {
        try { await ensureInvoiceNumbersForDay(sql, companyId, d); }
        catch (e) { console.error('[fish-schedule] backfill failed for', d, e.message); }
      }

      const rows = await sql`
        SELECT l.id, l.invoice_number,
               l.day_date::text AS day_date, l.arrived_at,
               l.farmer_id, f.name AS farmer_name, f.color AS farmer_color,
               l.pond_ref, l.truck_ref,
               l.gross_lbs, l.deduction_lbs, l.net_lbs,
               l.size_0_4_lbs, l.size_4_6_lbs, l.size_6_8_lbs, l.size_8_plus_lbs,
               l.price_0_4_per_lb, l.price_4_6_per_lb,
               l.price_6_8_per_lb, l.price_8_plus_per_lb,
               l.dock_price_per_lb,
               l.payable_lbs, l.payable_total, l.notes
        FROM live_haul_loads l
        LEFT JOIN live_haul_farmers f ON f.id = l.farmer_id
        WHERE l.company_id = ${companyId}
          AND l.day_date >= ${startDate}::date
          AND l.day_date <= ${endDate}::date
        ORDER BY l.day_date, l.arrived_at NULLS LAST, l.id
      `;

      return res.json({
        ok: true,
        period: { start: startDate, end: endDate },
        rows
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
      // Movement ticket # — the farmer's reference from their farm-side scale
      // weighing. Stored as text since farmers use varied formats.
      const movementTicket = (body.movement_ticket_number || '').trim() || null;

      const gross = num(body.gross_lbs);
      const tare = num(body.tare_lbs);
      const sz46 = num(body.size_4_6_lbs) || 0;
      const sz68 = num(body.size_6_8_lbs) || 0;
      const sz8p = num(body.size_8_plus_lbs) || 0;
      // Categorized deductions. If the client sends individual categories
      // we sum them for the total; if it only sends deduction_lbs (old
      // clients / programmatic callers), we honor that as a back-compat
      // "other" bucket so the payable math still works.
      const dedDoa = num(body.deduction_doa_lbs) || 0;
      const dedShad = num(body.deduction_shad_lbs) || 0;
      const dedTurtles = num(body.deduction_turtles_lbs) || 0;
      const dedOtherSpecies = num(body.deduction_other_species_lbs) || 0;
      const dedFingerlings = num(body.deduction_fingerlings_lbs) || 0;
      const categorizedSum = dedDoa + dedShad + dedTurtles + dedOtherSpecies + dedFingerlings;
      const deductionLegacy = num(body.deduction_lbs);
      // Prefer the sum of categories when any category is provided; fall
      // back to the legacy field otherwise (zero is fine).
      const deduction = categorizedSum > 0 ? categorizedSum : (deductionLegacy || 0);
      const deductionReason = (body.deduction_reason || '').trim() || null;
      const dockPrice = num(body.dock_price_per_lb);
      // Per-band prices. Match Excel FISH PAYABLE TOTAL exactly — each band
      // has its own $/lb. When only dockPrice is provided, every band inherits
      // it (simple one-price-for-the-load case).
      const price46 = num(body.price_4_6_per_lb) ?? dockPrice;
      const price68 = num(body.price_6_8_per_lb) ?? dockPrice;
      const price8p = num(body.price_8_plus_per_lb) ?? dockPrice;
      const price04 = num(body.price_0_4_per_lb) ?? dockPrice;
      const notes = (body.notes || '').trim() || null;

      // Net = Plant Weight (the fish weight at the plant scale). The form
      // sends it directly. The legacy "net = gross - tare" fallback is kept
      // only for old programmatic callers that still send tare instead of
      // net — modern saves always send body.net_lbs explicitly.
      let net = num(body.net_lbs);
      if (net == null && gross != null && tare != null) net = gross - tare;
      // Payable Lbs = Plant Weight - Deductions. Cooper's correction:
      // payable runs off Plant Weight, not Difference (truck − plant).
      // Since net IS Plant Weight in the new model, the formula here is
      // unchanged but the semantics are clearer now.

      // Payable Lbs = Plant Weight − Deductions. Compute first because the
      // 0-4 size band falls back to a remainder of payable, not raw net.
      const payableLbs = (net == null) ? null : Math.max(0, net - deduction);

      // 0–4 ("Net") size band: prefer whatever the form sent (the user can
      // override). Otherwise fall back to the remainder of Payable minus the
      // three graded bands. Matches Cooper's clarification: bands represent
      // PROCESSED fish, so the remainder is what's left of payable after
      // grading the 4-5.99 / 6-7.99 / 8+ buckets.
      let sz04 = num(body.size_0_4_lbs);
      if (sz04 == null && payableLbs != null) {
        sz04 = Math.max(0, payableLbs - sz46 - sz68 - sz8p);
      }

      // Amount = Σ(band_lbs × band_price). Each band contributes only if
      // both lbs > 0 and a price is set. Matches FISH PAYABLE TOTAL D27 = E26.
      let payableTotal = null;
      const parts = [];
      if (price46 != null && sz46 > 0) parts.push(sz46 * price46);
      if (price68 != null && sz68 > 0) parts.push(sz68 * price68);
      if (price8p != null && sz8p > 0) parts.push(sz8p * price8p);
      if (price04 != null && sz04 != null && sz04 > 0) parts.push(sz04 * price04);
      if (parts.length > 0) {
        payableTotal = Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
      }

      if (farmerId === null) return res.status(400).json({ error: 'farmer_id required' });

      if (body.id) {
        // Preserve existing invoice_number unless the day changes. If the
        // load moves to a different day, clear invoice_number so it gets a
        // fresh one for the new day's sequence.
        const [prior] = await sql`
          SELECT invoice_number, day_date::text AS day_date
          FROM live_haul_loads
          WHERE id = ${body.id} AND company_id = ${companyId}
        `;
        let invoiceNumber = prior && prior.invoice_number;
        const dayChanged = prior && prior.day_date && prior.day_date !== dayDate;
        if (dayChanged) invoiceNumber = null;

        const [updated] = await sql`
          UPDATE live_haul_loads
          SET day_date = ${dayDate}::date, arrived_at = ${arrivedAt},
              farmer_id = ${farmerId}, pond_ref = ${pondRef}, truck_ref = ${truckRef},
              delivery_id = ${deliveryId},
              gross_lbs = ${gross}, tare_lbs = ${tare}, net_lbs = ${net},
              size_0_4_lbs = ${sz04 == null ? 0 : sz04},
              size_4_6_lbs = ${sz46},
              size_6_8_lbs = ${sz68},
              size_8_plus_lbs = ${sz8p},
              deduction_lbs = ${deduction}, deduction_reason = ${deductionReason},
              deduction_doa_lbs = ${dedDoa},
              deduction_shad_lbs = ${dedShad},
              deduction_turtles_lbs = ${dedTurtles},
              deduction_other_species_lbs = ${dedOtherSpecies},
              deduction_fingerlings_lbs = ${dedFingerlings},
              dock_price_per_lb = ${dockPrice},
              price_4_6_per_lb = ${price46},
              price_6_8_per_lb = ${price68},
              price_8_plus_per_lb = ${price8p},
              price_0_4_per_lb = ${price04},
              payable_lbs = ${payableLbs},
              payable_total = ${payableTotal},
              invoice_number = ${invoiceNumber},
              movement_ticket_number = ${movementTicket},
              notes = ${notes}, updated_at = NOW()
          WHERE id = ${body.id} AND company_id = ${companyId}
          RETURNING id
        `;
        // If we cleared invoice_number due to date move, re-assign both days
        if (dayChanged) {
          if (prior && prior.day_date) {
            await ensureInvoiceNumbersForDay(sql, companyId, prior.day_date);
          }
          await ensureInvoiceNumbersForDay(sql, companyId, dayDate);
        }
        const [full] = await sql`
          SELECT id, day_date::text AS day_date, arrived_at, farmer_id, pond_ref, truck_ref, delivery_id,
                 gross_lbs, tare_lbs, net_lbs,
                 size_0_4_lbs, size_4_6_lbs, size_6_8_lbs, size_8_plus_lbs,
                 deduction_lbs, deduction_reason,
                 deduction_doa_lbs, deduction_shad_lbs, deduction_turtles_lbs,
                 deduction_other_species_lbs, deduction_fingerlings_lbs,
                 dock_price_per_lb, price_4_6_per_lb, price_6_8_per_lb,
                 price_8_plus_per_lb, price_0_4_per_lb,
                 payable_lbs, payable_total, invoice_number, movement_ticket_number, notes
          FROM live_haul_loads WHERE id = ${body.id}
        `;
        await logAudit(sql, req, user, {
          action: 'fishschedule.save_load',
          resource_type: 'load', resource_id: body.id,
          details: { day_date: dayDate, farmer_id: farmerId, net_lbs: net, updated: true }
        });
        return res.json({ ok: true, load: full });
      }

      const [created] = await sql`
        INSERT INTO live_haul_loads
          (company_id, day_date, arrived_at, farmer_id, pond_ref, truck_ref, delivery_id,
           movement_ticket_number,
           gross_lbs, tare_lbs, net_lbs,
           size_0_4_lbs, size_4_6_lbs, size_6_8_lbs, size_8_plus_lbs,
           deduction_lbs, deduction_reason,
           deduction_doa_lbs, deduction_shad_lbs, deduction_turtles_lbs,
           deduction_other_species_lbs, deduction_fingerlings_lbs,
           dock_price_per_lb, price_4_6_per_lb, price_6_8_per_lb,
           price_8_plus_per_lb, price_0_4_per_lb,
           payable_lbs, payable_total, notes)
        VALUES
          (${companyId}, ${dayDate}::date, ${arrivedAt}, ${farmerId}, ${pondRef}, ${truckRef}, ${deliveryId},
           ${movementTicket},
           ${gross}, ${tare}, ${net},
           ${sz04 == null ? 0 : sz04}, ${sz46}, ${sz68}, ${sz8p},
           ${deduction}, ${deductionReason},
           ${dedDoa}, ${dedShad}, ${dedTurtles}, ${dedOtherSpecies}, ${dedFingerlings},
           ${dockPrice}, ${price46}, ${price68}, ${price8p}, ${price04},
           ${payableLbs}, ${payableTotal}, ${notes})
        RETURNING id, day_date::text AS day_date, arrived_at, farmer_id, pond_ref, truck_ref, delivery_id,
                  gross_lbs, tare_lbs, net_lbs,
                  size_0_4_lbs, size_4_6_lbs, size_6_8_lbs, size_8_plus_lbs,
                  deduction_lbs, deduction_reason,
                  deduction_doa_lbs, deduction_shad_lbs, deduction_turtles_lbs,
                  deduction_other_species_lbs, deduction_fingerlings_lbs,
                  dock_price_per_lb, price_4_6_per_lb, price_6_8_per_lb,
                  price_8_plus_per_lb, price_0_4_per_lb,
                  payable_lbs, payable_total, movement_ticket_number, notes
      `;
      // Assign invoice number for the new load (seq = max in day + 1).
      await ensureInvoiceNumbersForDay(sql, companyId, dayDate);
      const [withInvoice] = await sql`
        SELECT invoice_number FROM live_haul_loads WHERE id = ${created.id}
      `;
      created.invoice_number = withInvoice && withInvoice.invoice_number;
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
