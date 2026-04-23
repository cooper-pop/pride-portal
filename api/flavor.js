const { neon } = require('@neondatabase/serverless');
const perms = require('./_permissions');

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

// Resolves whose flavor data a given company reads.
// If the company row has flavor_parent_slug set, the caller reads from that
// company instead, optionally restricted to a single farmer. Returns
//   { effectiveCompanyId, farmerFilter, readonly }
// readonly=true whenever the caller is viewing a parent company's data.
async function resolveFlavorScope(sql, myCompanyId) {
  // Pull the linking config for this company. The columns are created by the
  // init ALTERs in the handler, so they always exist by the time we get here.
  let rows;
  try {
    rows = await sql`SELECT flavor_parent_slug, flavor_parent_farmer_name
      FROM companies WHERE id=${myCompanyId}`;
  } catch (e) {
    // companies table might not have the columns on a very cold DB — fall through
    rows = [];
  }
  const cfg = rows.length ? rows[0] : {};
  if (!cfg || !cfg.flavor_parent_slug) {
    return { effectiveCompanyId: myCompanyId, farmerFilter: null, readonly: false };
  }
  const [parent] = await sql`SELECT id FROM companies WHERE slug=${cfg.flavor_parent_slug}`;
  if (!parent) {
    // Misconfigured link — fail safe, let them see their own (empty) data
    return { effectiveCompanyId: myCompanyId, farmerFilter: null, readonly: false };
  }
  let farmerFilter = null;
  if (cfg.flavor_parent_farmer_name) {
    const [farmer] = await sql`SELECT id FROM flv_farmers
      WHERE company_id=${parent.id} AND archived=false
        AND LOWER(TRIM(name))=LOWER(TRIM(${cfg.flavor_parent_farmer_name}))
      LIMIT 1`;
    if (farmer) farmerFilter = farmer.id;
    // If the farmer name is set but doesn't resolve, return empty lists rather
    // than leaking all data — use a sentinel that no real farmer row will match.
    else farmerFilter = '00000000-0000-0000-0000-000000000000';
  }
  return { effectiveCompanyId: parent.id, farmerFilter, readonly: true };
}

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

  // Flavor is a Production widget: supervisors can view + create (data entry),
  // managers+ can edit / delete.
  const user = perms.requireAccess(req, res, 'flavor', 'view');
  if (!user) return;
  const { user_id, company_id } = user;

  const sql = neon(process.env.DATABASE_URL);
  const action = req.query.action;
  const body = req.body || {};

  try {
    await ensureTables(sql);
    // ── Data-linking: a company (like BFN) can be configured to READ flavor
    // data from another company (like POTP), optionally filtered to a single
    // farmer. Set via POST /api/flavor?action=configure_link (admin only).
    await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS flavor_parent_slug TEXT`;
    await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS flavor_parent_farmer_name TEXT`;
    const scope = await resolveFlavorScope(sql, company_id);
    const effectiveCompanyId = scope.effectiveCompanyId;
    const farmerFilter = scope.farmerFilter;  // null OR a farmer id within effectiveCompanyId
    const readonly = scope.readonly;

    // configure_link: ADMIN ONLY. Lets Cooper (as a POTP admin) tell BFN's
    // company row to read flavor data from POTP and restrict to a specific
    // farmer. Body: { company_slug, parent_company_slug, parent_farmer_name }
    if (action === 'configure_link') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const viewerSlug = String(body.company_slug || '').trim();
      const parentSlug = body.parent_company_slug === null ? null : String(body.parent_company_slug || '').trim();
      const farmerName = body.parent_farmer_name === null ? null : String(body.parent_farmer_name || '').trim();
      if (!viewerSlug) return res.status(400).json({ error: 'company_slug required' });
      const [viewer] = await sql`SELECT id FROM companies WHERE slug=${viewerSlug}`;
      if (!viewer) return res.status(404).json({ error: 'Viewer company not found: ' + viewerSlug });
      if (parentSlug) {
        const [parent] = await sql`SELECT id FROM companies WHERE slug=${parentSlug}`;
        if (!parent) return res.status(404).json({ error: 'Parent company not found: ' + parentSlug });
      }
      await sql`UPDATE companies SET
        flavor_parent_slug=${parentSlug || null},
        flavor_parent_farmer_name=${farmerName || null}
        WHERE id=${viewer.id}`;
      return res.json({ ok: true, message: parentSlug ? 'Linked ' + viewerSlug + ' as read-only viewer of ' + parentSlug + (farmerName ? ' (farmer: ' + farmerName + ')' : '') : 'Cleared link on ' + viewerSlug });
    }

    // If linked to another company, block ALL mutations regardless of role
    if (readonly && action && action !== 'get_state' && action !== 'get_pond_history') {
      return res.status(403).json({
        error: 'Read-only',
        detail: 'This company reads flavor data from a parent company and cannot mutate it. Log into the owning company to make changes.'
      });
    }

    // Per-action role gate (only when NOT linked — linked companies are read-only above)
    if (action && action.indexOf('delete_') === 0) {
      if (!perms.canPerform(user, 'flavor', 'delete')) return perms.deny(res, user, 'flavor', 'delete');
    } else if (action === 'bulk_add_ponds') {
      if (!perms.canPerform(user, 'flavor', 'create')) return perms.deny(res, user, 'flavor', 'create');
    } else if (action && action.indexOf('save_') === 0) {
      const act = perms.actionForSave(body);
      if (!perms.canPerform(user, 'flavor', act)) return perms.deny(res, user, 'flavor', act);
    }

    // ─── READ ────────────────────────────────────────────────────────────────
    if (action === 'get_state') {
      // Everything the dashboard needs in one shot. Samples capped at 120 days
      // back — plenty to derive current status + window for any active pond.
      // When the caller is a linked viewer (e.g., BFN reading POTP's
      // "Battle Fish North" farmer), queries pull from the parent's company_id
      // and filter to ponds under the specified farmer.
      const sinceDays = parseInt(req.query.since_days) || 120;
      const since = new Date();
      since.setDate(since.getDate() - sinceDays);
      const sinceStr = since.toISOString().split('T')[0];

      let farmers, pondGroups, ponds, samples;
      if (farmerFilter) {
        // Scoped to a single farmer inside the parent company.
        [farmers, pondGroups, ponds, samples] = await Promise.all([
          sql`SELECT id, name, notes FROM flv_farmers
              WHERE company_id=${effectiveCompanyId} AND archived=false AND id=${farmerFilter}`,
          sql`SELECT id, farmer_id, name, notes FROM flv_pond_groups
              WHERE company_id=${effectiveCompanyId} AND archived=false AND farmer_id=${farmerFilter}
              ORDER BY name`,
          sql`SELECT p.id, p.pond_group_id, p.number, p.acres, p.notes
              FROM flv_ponds p
              JOIN flv_pond_groups g ON g.id = p.pond_group_id
              WHERE p.company_id=${effectiveCompanyId} AND p.archived=false
                AND g.archived=false AND g.farmer_id=${farmerFilter}
              ORDER BY p.number`,
          sql`SELECT s.id, s.pond_id, s.sample_date, s.grade, s.sampled_by, s.notes, s.created_at
              FROM flv_samples s
              JOIN flv_ponds p ON p.id = s.pond_id
              JOIN flv_pond_groups g ON g.id = p.pond_group_id
              WHERE s.company_id=${effectiveCompanyId} AND s.sample_date >= ${sinceStr}
                AND g.farmer_id=${farmerFilter}
              ORDER BY s.sample_date DESC, s.created_at DESC`
        ]);
      } else {
        // Either own company or full parent — no farmer filter.
        [farmers, pondGroups, ponds, samples] = await Promise.all([
          sql`SELECT id, name, notes FROM flv_farmers
              WHERE company_id=${effectiveCompanyId} AND archived=false
              ORDER BY name`,
          sql`SELECT id, farmer_id, name, notes FROM flv_pond_groups
              WHERE company_id=${effectiveCompanyId} AND archived=false
              ORDER BY name`,
          sql`SELECT id, pond_group_id, number, acres, notes FROM flv_ponds
              WHERE company_id=${effectiveCompanyId} AND archived=false
              ORDER BY number`,
          sql`SELECT id, pond_id, sample_date, grade, sampled_by, notes, created_at
              FROM flv_samples
              WHERE company_id=${effectiveCompanyId} AND sample_date >= ${sinceStr}
              ORDER BY sample_date DESC, created_at DESC`
        ]);
      }
      return res.json({
        farmers, pond_groups: pondGroups, ponds, samples,
        readonly: readonly,
        // Useful debug/UX info about where the data came from
        scope_info: readonly ? {
          reading_from_company_id: effectiveCompanyId,
          restricted_to_farmer_id: farmerFilter || null
        } : null
      });
    }

    if (action === 'get_pond_history') {
      const pondId = String(body.pond_id || req.query.pond_id || '').trim();
      if (!pondId) return res.status(400).json({ error: 'pond_id required' });
      // For linked viewers, verify the pond is actually under the allowed farmer
      // before returning its history. Defense-in-depth: prevents someone with a
      // BFN session from guessing pond IDs from other POTP farmers.
      if (farmerFilter) {
        const allowed = await sql`SELECT p.id FROM flv_ponds p
          JOIN flv_pond_groups g ON g.id = p.pond_group_id
          WHERE p.id=${pondId} AND p.company_id=${effectiveCompanyId}
            AND g.farmer_id=${farmerFilter} LIMIT 1`;
        if (!allowed.length) return res.status(404).json({ error: 'Pond not found in your view' });
      }
      const rows = await sql`SELECT id, sample_date, grade, sampled_by, notes, created_by, created_at
        FROM flv_samples
        WHERE company_id=${effectiveCompanyId} AND pond_id=${pondId}
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

    // Archive every active pond in a group without deleting the group itself —
    // used by the Manage Ponds modal's "Delete all ponds" option so the user
    // can clear a group and rebuild it without losing the group's place in the UI.
    if (action === 'delete_all_ponds_in_group') {
      const groupId = String(body.pond_group_id || '').trim();
      if (!groupId) return res.status(400).json({ error: 'pond_group_id required' });
      const result = await sql`UPDATE flv_ponds SET archived = true, updated_at = NOW()
        WHERE company_id = ${company_id} AND pond_group_id = ${groupId} AND archived = false
        RETURNING id`;
      return res.json({ ok: true, deleted: result.length });
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
