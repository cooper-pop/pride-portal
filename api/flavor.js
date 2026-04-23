const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

// ═══════════════════════════════════════════════════════════════════════════
// Flavor Sample API
// Tracks per-pond flavor grades over time so the processing plant knows which
// ponds are On Flavor (Good) and within the 14-day harvest window.
//
// Grades (stored as strings):
//   off_5, off_4, off_3, off_2, off_1  — bad → barely off; cannot harvest
//   good_resample_1     — first Good sample; 14-day window OPENS here
//   good_resample_2     — second Good sample
//   good_ready          — Good - Ready to Harvest
//   truck_sample        — last check on delivery (effectively harvested)
//
// Tables (named flv_* so they never collide with any abandoned flavor_* tables
// from earlier experiments):
//   flv_farmers        — producers (e.g., Battle Fish North, Adams Lane)
//   flv_pond_groups    — farms/areas under a farmer (New Ponds, Denton, ...)
//   flv_ponds          — individual ponds under a pond group (1 North, 2 East)
//   flv_samples        — one row per sample event (a pond can have many)
// ═══════════════════════════════════════════════════════════════════════════

const VALID_GRADES = new Set([
  'off_5','off_4','off_3','off_2','off_1',
  'good_resample_1','good_resample_2','good_ready','truck_sample'
]);

async function ensureTables(sql) {
  await sql`CREATE TABLE IF NOT EXISTS flv_farmers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id INT NOT NULL,
    name TEXT NOT NULL,
    notes TEXT DEFAULT '',
    archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_flv_farmers_co ON flv_farmers(company_id) WHERE archived = false`;

  await sql`CREATE TABLE IF NOT EXISTS flv_pond_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id INT NOT NULL,
    farmer_id UUID NOT NULL,
    name TEXT NOT NULL,
    notes TEXT DEFAULT '',
    archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_flv_groups_co ON flv_pond_groups(company_id, farmer_id) WHERE archived = false`;

  await sql`CREATE TABLE IF NOT EXISTS flv_ponds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id INT NOT NULL,
    pond_group_id UUID NOT NULL,
    number TEXT NOT NULL,
    acres NUMERIC(6,2),
    notes TEXT DEFAULT '',
    archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_flv_ponds_co ON flv_ponds(company_id, pond_group_id) WHERE archived = false`;

  await sql`CREATE TABLE IF NOT EXISTS flv_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id INT NOT NULL,
    pond_id UUID NOT NULL,
    sample_date DATE NOT NULL,
    grade TEXT NOT NULL,
    sampled_by TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_flv_samples_pond ON flv_samples(pond_id, sample_date DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_flv_samples_co_date ON flv_samples(company_id, sample_date DESC)`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  let user_id, company_id;
  try {
    const p = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET);
    user_id = p.user_id;
    company_id = p.company_id;
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const action = req.query.action;
  const body = req.body || {};

  try {
    await ensureTables(sql);

    // ─── READ ────────────────────────────────────────────────────────────────
    if (action === 'get_state') {
      // Everything the dashboard needs in one shot. Samples capped at 120 days
      // back — plenty to derive current status + window for any active pond.
      const sinceDays = parseInt(req.query.since_days) || 120;
      const since = new Date();
      since.setDate(since.getDate() - sinceDays);
      const sinceStr = since.toISOString().split('T')[0];
      const [farmers, pondGroups, ponds, samples] = await Promise.all([
        sql`SELECT id, name, notes FROM flv_farmers
            WHERE company_id = ${company_id} AND archived = false
            ORDER BY name`,
        sql`SELECT id, farmer_id, name, notes FROM flv_pond_groups
            WHERE company_id = ${company_id} AND archived = false
            ORDER BY name`,
        sql`SELECT id, pond_group_id, number, acres, notes FROM flv_ponds
            WHERE company_id = ${company_id} AND archived = false
            ORDER BY number`,
        sql`SELECT id, pond_id, sample_date, grade, sampled_by, notes, created_at
            FROM flv_samples
            WHERE company_id = ${company_id} AND sample_date >= ${sinceStr}
            ORDER BY sample_date DESC, created_at DESC`
      ]);
      return res.json({ farmers, pond_groups: pondGroups, ponds, samples });
    }

    if (action === 'get_pond_history') {
      const pondId = String(body.pond_id || req.query.pond_id || '').trim();
      if (!pondId) return res.status(400).json({ error: 'pond_id required' });
      const rows = await sql`SELECT id, sample_date, grade, sampled_by, notes, created_by, created_at
        FROM flv_samples
        WHERE company_id = ${company_id} AND pond_id = ${pondId}
        ORDER BY sample_date DESC, created_at DESC
        LIMIT 500`;
      return res.json({ samples: rows });
    }

    // ─── FARMERS CRUD ────────────────────────────────────────────────────────
    if (action === 'save_farmer') {
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Name required' });
      if (body.id) {
        const [f] = await sql`UPDATE flv_farmers
          SET name = ${name}, notes = ${body.notes || ''}, updated_at = NOW()
          WHERE id = ${body.id} AND company_id = ${company_id} RETURNING *`;
        return res.json({ ok: true, farmer: f });
      }
      const [f] = await sql`INSERT INTO flv_farmers (company_id, name, notes)
        VALUES (${company_id}, ${name}, ${body.notes || ''}) RETURNING *`;
      return res.json({ ok: true, farmer: f });
    }
    if (action === 'delete_farmer') {
      if (!body.id) return res.status(400).json({ error: 'id required' });
      // Soft-delete the farmer AND all of its pond groups + ponds so samples
      // stay in the DB for history but the records disappear from active lists.
      await sql`UPDATE flv_farmers SET archived = true, updated_at = NOW()
        WHERE id = ${body.id} AND company_id = ${company_id}`;
      await sql`UPDATE flv_pond_groups SET archived = true, updated_at = NOW()
        WHERE farmer_id = ${body.id} AND company_id = ${company_id}`;
      await sql`UPDATE flv_ponds SET archived = true, updated_at = NOW()
        WHERE company_id = ${company_id} AND pond_group_id IN (
          SELECT id FROM flv_pond_groups WHERE farmer_id = ${body.id} AND company_id = ${company_id}
        )`;
      return res.json({ ok: true });
    }

    // ─── POND GROUPS CRUD ────────────────────────────────────────────────────
    if (action === 'save_pond_group') {
      const name = String(body.name || '').trim();
      const farmerId = String(body.farmer_id || '').trim();
      if (!name) return res.status(400).json({ error: 'Name required' });
      if (!farmerId) return res.status(400).json({ error: 'farmer_id required' });
      if (body.id) {
        const [g] = await sql`UPDATE flv_pond_groups
          SET name = ${name}, notes = ${body.notes || ''}, farmer_id = ${farmerId}, updated_at = NOW()
          WHERE id = ${body.id} AND company_id = ${company_id} RETURNING *`;
        return res.json({ ok: true, pond_group: g });
      }
      const [g] = await sql`INSERT INTO flv_pond_groups (company_id, farmer_id, name, notes)
        VALUES (${company_id}, ${farmerId}, ${name}, ${body.notes || ''}) RETURNING *`;
      return res.json({ ok: true, pond_group: g });
    }
    if (action === 'delete_pond_group') {
      if (!body.id) return res.status(400).json({ error: 'id required' });
      await sql`UPDATE flv_pond_groups SET archived = true, updated_at = NOW()
        WHERE id = ${body.id} AND company_id = ${company_id}`;
      await sql`UPDATE flv_ponds SET archived = true, updated_at = NOW()
        WHERE pond_group_id = ${body.id} AND company_id = ${company_id}`;
      return res.json({ ok: true });
    }

    // ─── PONDS CRUD ──────────────────────────────────────────────────────────
    if (action === 'save_pond') {
      const number = String(body.number || '').trim();
      const groupId = String(body.pond_group_id || '').trim();
      if (!number) return res.status(400).json({ error: 'Pond number/name required' });
      if (!groupId) return res.status(400).json({ error: 'pond_group_id required' });
      const acres = body.acres !== undefined && body.acres !== null && body.acres !== ''
        ? parseFloat(body.acres) : null;
      if (body.id) {
        const [p] = await sql`UPDATE flv_ponds
          SET number = ${number}, pond_group_id = ${groupId},
              acres = ${acres}, notes = ${body.notes || ''}, updated_at = NOW()
          WHERE id = ${body.id} AND company_id = ${company_id} RETURNING *`;
        return res.json({ ok: true, pond: p });
      }
      const [p] = await sql`INSERT INTO flv_ponds (company_id, pond_group_id, number, acres, notes)
        VALUES (${company_id}, ${groupId}, ${number}, ${acres}, ${body.notes || ''}) RETURNING *`;
      return res.json({ ok: true, pond: p });
    }
    if (action === 'delete_pond') {
      if (!body.id) return res.status(400).json({ error: 'id required' });
      await sql`UPDATE flv_ponds SET archived = true, updated_at = NOW()
        WHERE id = ${body.id} AND company_id = ${company_id}`;
      return res.json({ ok: true });
    }

    // Bulk-add ponds — user can paste a comma- or newline-separated list like
    // "1 North, 1 South, 2 East, 2 Middle, 2 West" and get individual pond rows.
    // Scales to hundreds of ponds: one SELECT for existing names, then chunked
    // parallel INSERTs. The old version's sequential SELECT+INSERT per pond hit
    // the function budget above ~200 entries and silently dropped the tail.
    if (action === 'bulk_add_ponds') {
      const groupId = String(body.pond_group_id || '').trim();
      if (!groupId) return res.status(400).json({ error: 'pond_group_id required' });
      const rawList = Array.isArray(body.numbers) ? body.numbers : [];
      // Normalize + dedupe in-memory (keep first-seen casing of each unique number)
      const seen = new Set();
      const numbers = [];
      for (const raw of rawList) {
        const n = String(raw || '').trim();
        if (!n) continue;
        const key = n.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        numbers.push(n);
      }
      if (numbers.length === 0) return res.json({ ok: true, created: 0, skipped: 0 });

      // One query fetches every existing (active) pond number in this group
      const existing = await sql`SELECT LOWER(number) AS key FROM flv_ponds
        WHERE company_id = ${company_id} AND pond_group_id = ${groupId} AND archived = false`;
      const existingKeys = new Set(existing.map(r => r.key));
      const toInsert = numbers.filter(n => !existingKeys.has(n.toLowerCase()));
      const skipped = numbers.length - toInsert.length;
      if (toInsert.length === 0) return res.json({ ok: true, created: 0, skipped });

      // Insert in parallel chunks of 50 so we never exhaust connection slots.
      const CHUNK = 50;
      let created = 0;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const chunk = toInsert.slice(i, i + CHUNK);
        const results = await Promise.all(chunk.map(n =>
          sql`INSERT INTO flv_ponds (company_id, pond_group_id, number)
              VALUES (${company_id}, ${groupId}, ${n})`
            .then(() => 1)
            .catch(err => { console.error('bulk pond insert failed:', n, err.message); return 0; })
        ));
        created += results.reduce((a, b) => a + b, 0);
      }
      return res.json({ ok: true, created, skipped });
    }

    // ─── SAMPLES CRUD ────────────────────────────────────────────────────────
    if (action === 'save_sample') {
      const pondId = String(body.pond_id || '').trim();
      const grade = String(body.grade || '').trim();
      const sampleDate = String(body.sample_date || '').trim() || new Date().toISOString().split('T')[0];
      if (!pondId) return res.status(400).json({ error: 'pond_id required' });
      if (!VALID_GRADES.has(grade)) return res.status(400).json({ error: 'Invalid grade: ' + grade });
      if (body.id) {
        const [s] = await sql`UPDATE flv_samples SET
          pond_id = ${pondId}, sample_date = ${sampleDate}, grade = ${grade},
          sampled_by = ${body.sampled_by || ''}, notes = ${body.notes || ''},
          updated_at = NOW()
          WHERE id = ${body.id} AND company_id = ${company_id} RETURNING *`;
        return res.json({ ok: true, sample: s });
      }
      const [s] = await sql`INSERT INTO flv_samples
        (company_id, pond_id, sample_date, grade, sampled_by, notes, created_by)
        VALUES (${company_id}, ${pondId}, ${sampleDate}, ${grade},
                ${body.sampled_by || ''}, ${body.notes || ''}, ${user_id})
        RETURNING *`;
      return res.json({ ok: true, sample: s });
    }
    if (action === 'delete_sample') {
      if (!body.id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM flv_samples WHERE id = ${body.id} AND company_id = ${company_id}`;
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('Flavor API error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
