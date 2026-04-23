const { neon } = require('@neondatabase/serverless');
const perms = require('./_permissions');
const { logAudit } = require('./_audit');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Parts is a Maintenance widget: supervisors can view + create (data entry /
  // log received parts / adjust qty), managers+ can edit/delete records. DB
  // migrations are admin-only regardless.
  const user = perms.requireAccess(req, res, 'parts', 'view');
  if (!user) return;
  const { user_id, company_id } = user;

  const sql = neon(process.env.DATABASE_URL);
  let action = req.query.action;
  const body = req.body || {};

  try {
    // Admin-only destructive / structural actions
    if (action === 'init_parts_db' || action === 'migrate_parts_db') {
      if (!perms.canPerform(user, 'settings', 'edit')) return perms.deny(res, user, 'settings', 'edit');
    }
    // Delete actions → parts.delete
    else if (action && action.indexOf('delete_') === 0) {
      if (!perms.canPerform(user, 'parts', 'delete')) return perms.deny(res, user, 'parts', 'delete');
    }
    // Write actions → parts.edit (existing) or parts.create (new)
    else if (action === 'save_part' || action === 'save_invoice' || action === 'save_cross_ref'
          || action === 'save_parts_order' || action === 'save_machines' || action === 'save_machine'
          || action === 'add_part' || action === 'update_part' || action === 'add_invoice'
          || action === 'update_invoice' || action === 'add_cross_ref' || action === 'update_cross_ref'
          || action === 'add_parts_order' || action === 'update_parts_order') {
      const act = perms.actionForSave(body);
      if (!perms.canPerform(user, 'parts', act)) return perms.deny(res, user, 'parts', act);
    }
    // Adjustment / sync / receive actions → edit
    else if (action === 'adjust_part' || action === 'sync_machine_parts' || action === 'receive_part') {
      if (!perms.canPerform(user, 'parts', 'edit')) return perms.deny(res, user, 'parts', 'edit');
    }
    // Scan / extract an invoice → create (it generates a new record)
    else if (action === 'extract_invoice') {
      if (!perms.canPerform(user, 'parts', 'create')) return perms.deny(res, user, 'parts', 'create');
    }
    // search_vendor_prices, lookup_barcode, get_* → view (already gated at top)
    // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ INIT / MIGRATE ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
    // Aliases used by parts.js frontend
    if (action === 'add_invoice') action = 'save_invoice';
    if (action === 'update_invoice') action = 'save_invoice';
    if (action === 'add_part') action = 'save_part';
    if (action === 'update_part') action = 'save_part';
    if (action === 'add_cross_ref') action = 'save_cross_ref';
    if (action === 'update_cross_ref') action = 'save_cross_ref';
    if (action === 'add_manual') action = 'save_manual';
    if (action === 'update_manual') action = 'save_manual';
    if (action === 'add_parts_order') action = 'save_parts_order';
    if (action === 'update_parts_order') action = 'save_parts_order';
    if (action === 'delete_cross_ref') {}
  
    if (action === 'init_parts_db') {
    // Add new columns if they don't exist
    await sql`ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS machine_tag TEXT DEFAULT ''`;
    await sql`ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS supplier TEXT DEFAULT ''`;
    await sql`ALTER TABLE parts_invoices ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT ''`;
    await sql`ALTER TABLE parts_invoices ADD COLUMN IF NOT EXISTS machine_tag TEXT DEFAULT ''`;
    await sql`ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS avg_cost NUMERIC(10,4) DEFAULT 0`;
    await sql`ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS total_value NUMERIC(10,2) DEFAULT 0`;
    await sql`ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS barcode TEXT DEFAULT ''`;
    await sql`ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT false`;
    await sql`ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS custom_vendors JSONB DEFAULT '[]'::jsonb`;
    await sql`CREATE INDEX IF NOT EXISTS idx_parts_barcode ON parts_inventory(company_id, barcode) WHERE barcode <> ''`;
    await sql`CREATE TABLE IF NOT EXISTS parts_adjustments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      part_id UUID, company_id INT,
      delta INT DEFAULT 0, new_quantity INT DEFAULT 0,
      reason TEXT DEFAULT '', notes TEXT DEFAULT '',
      user_id UUID, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_adjustments_part ON parts_adjustments(part_id, created_at DESC)`;
    await sql`ALTER TABLE parts_manuals ADD COLUMN IF NOT EXISTS machine_tag TEXT DEFAULT ''`;
    await sql`ALTER TABLE parts_manuals ADD COLUMN IF NOT EXISTS part_count INT DEFAULT 0`;
    await sql`ALTER TABLE parts_manuals ADD COLUMN IF NOT EXISTS cloudinary_public_id TEXT DEFAULT ''`;
    await sql`ALTER TABLE parts_manuals ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT DEFAULT 0`;
    await sql`ALTER TABLE parts_manuals ADD COLUMN IF NOT EXISTS filename TEXT DEFAULT ''`;
    await sql`ALTER TABLE parts_manuals ADD COLUMN IF NOT EXISTS extraction_status TEXT DEFAULT 'pending'`;
    await sql`ALTER TABLE parts_manuals ADD COLUMN IF NOT EXISTS extraction_log TEXT DEFAULT ''`;
    await sql`CREATE TABLE IF NOT EXISTS manual_part_index (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      manual_id UUID, company_id INT,
      part_number TEXT NOT NULL, description TEXT DEFAULT '',
      machine_tag TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
    await sql`ALTER TABLE manual_part_index ADD COLUMN IF NOT EXISTS page_number INT`;
    await sql`CREATE INDEX IF NOT EXISTS idx_manual_part_num ON manual_part_index(company_id, LOWER(part_number))`;
    await sql`CREATE INDEX IF NOT EXISTS idx_manual_part_manual ON manual_part_index(manual_id)`;
    await sql`CREATE TABLE IF NOT EXISTS parts_machines (
      id TEXT NOT NULL,
      company_id INT NOT NULL,
      name TEXT DEFAULT '',
      make TEXT DEFAULT '',
      model TEXT DEFAULT '',
      year TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (company_id, id)
    )`;
      await sql`CREATE TABLE IF NOT EXISTS parts_inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id INT, part_number TEXT DEFAULT '', description TEXT DEFAULT '',
        manufacturer TEXT DEFAULT '', category TEXT DEFAULT '',
        quantity INT DEFAULT 0, min_quantity INT DEFAULT 1,
        unit_cost NUMERIC(10,2) DEFAULT 0, avg_cost NUMERIC(10,4) DEFAULT 0,
        total_value NUMERIC(10,2) DEFAULT 0, location TEXT DEFAULT '',
        machine_tag TEXT DEFAULT '', supplier TEXT DEFAULT '',
        notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS parts_invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id INT, vendor TEXT DEFAULT '', invoice_number TEXT DEFAULT '',
        invoice_date DATE, total_amount NUMERIC(10,2) DEFAULT 0,
        notes TEXT DEFAULT '', items JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS parts_cross_ref (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id INT, part_number_a TEXT DEFAULT '', manufacturer_a TEXT DEFAULT '',
        part_number_b TEXT DEFAULT '', manufacturer_b TEXT DEFAULT '',
        description TEXT DEFAULT '', price_a NUMERIC(10,2) DEFAULT 0,
        price_b NUMERIC(10,2) DEFAULT 0, notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS parts_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id INT, vendor TEXT DEFAULT '', part_number TEXT DEFAULT '',
        description TEXT DEFAULT '', quantity INT DEFAULT 1,
        unit_cost NUMERIC(10,2) DEFAULT 0, status TEXT DEFAULT 'pending',
        tracking_number TEXT DEFAULT '', carrier TEXT DEFAULT '',
        task_id UUID, notes TEXT DEFAULT '', ordered_by UUID,
        received_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS parts_manuals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id INT, title TEXT DEFAULT '', manufacturer TEXT DEFAULT '',
        model TEXT DEFAULT '', file_url TEXT DEFAULT '', notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      return res.json({ ok: true, message: 'Parts DB initialized' });
    }

    if (action === 'migrate_parts_db') {
      // Drop old tables that have wrong schema and recreate
      await sql`DROP TABLE IF EXISTS parts_inventory`;
      await sql`DROP TABLE IF EXISTS parts_invoices`;
      await sql`DROP TABLE IF EXISTS parts_cross_ref`;
      await sql`DROP TABLE IF EXISTS parts_orders`;
      await sql`DROP TABLE IF EXISTS parts_manuals`;
      await sql`CREATE TABLE parts_inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id INT, part_number TEXT DEFAULT '', description TEXT DEFAULT '',
        manufacturer TEXT DEFAULT '', category TEXT DEFAULT '',
        quantity INT DEFAULT 0, min_quantity INT DEFAULT 1,
        unit_cost NUMERIC(10,2) DEFAULT 0, avg_cost NUMERIC(10,4) DEFAULT 0,
        total_value NUMERIC(10,2) DEFAULT 0, location TEXT DEFAULT '',
        machine_tag TEXT DEFAULT '', supplier TEXT DEFAULT '',
        notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql`CREATE TABLE parts_invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id INT, vendor TEXT DEFAULT '', invoice_number TEXT DEFAULT '',
        invoice_date DATE, total_amount NUMERIC(10,2) DEFAULT 0,
        notes TEXT DEFAULT '', items JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql`CREATE TABLE parts_cross_ref (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id INT, part_number_a TEXT DEFAULT '', manufacturer_a TEXT DEFAULT '',
        part_number_b TEXT DEFAULT '', manufacturer_b TEXT DEFAULT '',
        description TEXT DEFAULT '', price_a NUMERIC(10,2) DEFAULT 0,
        price_b NUMERIC(10,2) DEFAULT 0, notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql`CREATE TABLE parts_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id INT, vendor TEXT DEFAULT '', part_number TEXT DEFAULT '',
        description TEXT DEFAULT '', quantity INT DEFAULT 1,
        unit_cost NUMERIC(10,2) DEFAULT 0, status TEXT DEFAULT 'pending',
        tracking_number TEXT DEFAULT '', carrier TEXT DEFAULT '',
        task_id UUID, notes TEXT DEFAULT '', ordered_by UUID,
        received_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql`CREATE TABLE parts_manuals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id INT, title TEXT DEFAULT '', manufacturer TEXT DEFAULT '',
        model TEXT DEFAULT '', file_url TEXT DEFAULT '', notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      return res.json({ ok: true, message: 'Tables recreated with full schema' });
    }

    // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ GET actions ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
    if (action === 'get_parts') {
      const rows = await sql`SELECT *, quantity AS qty_on_hand, min_quantity AS qty_minimum FROM parts_inventory WHERE company_id = ${company_id} ORDER BY part_number`;
      return res.json(rows);
    }
    if (action === 'get_invoices') {
      const rows = await sql`SELECT * FROM parts_invoices WHERE company_id = ${company_id} ORDER BY created_at DESC`;
      return res.json(rows);
    }
    if (action === 'get_cross_ref') {
      const rows = await sql`SELECT * FROM parts_cross_ref WHERE company_id = ${company_id} ORDER BY part_number_a`;
      return res.json(rows);
    }
    if (action === 'get_parts_orders') {
      const rows = await sql`SELECT * FROM parts_orders WHERE company_id = ${company_id} ORDER BY created_at DESC`;
      return res.json(rows);
    }
    if (action === 'get_manuals') {
      const rows = await sql`SELECT * FROM parts_manuals WHERE company_id = ${company_id} ORDER BY title`;
      return res.json(rows);
    }
    if (action === 'get_machines') {
      // Bootstrap the table the first time any user hits this endpoint, so we never depend on init ordering.
      await sql`CREATE TABLE IF NOT EXISTS parts_machines (
        id TEXT NOT NULL, company_id INT NOT NULL,
        name TEXT DEFAULT '', make TEXT DEFAULT '', model TEXT DEFAULT '',
        year TEXT DEFAULT '', notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (company_id, id)
      )`;
      const rows = await sql`SELECT id, name, make, model, year, notes
        FROM parts_machines WHERE company_id = ${company_id} ORDER BY name`;
      return res.json(rows);
    }
    if (action === 'save_machines') {
      // Replaces the entire machine list for this company. Match on (company_id, id) upsert-style
      // so we preserve unknown extra columns and the frontend only sends what it knows.
      await sql`CREATE TABLE IF NOT EXISTS parts_machines (
        id TEXT NOT NULL, company_id INT NOT NULL,
        name TEXT DEFAULT '', make TEXT DEFAULT '', model TEXT DEFAULT '',
        year TEXT DEFAULT '', notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (company_id, id)
      )`;
      const machines = Array.isArray(body.machines) ? body.machines : [];
      // Wipe the company's list and re-insert. Simplest correct semantics — matches the localStorage
      // replace behavior callers are expecting. Inventory rows reference machines by their TEXT id,
      // so re-inserting with the same id keeps those references valid.
      await sql`DELETE FROM parts_machines WHERE company_id = ${company_id}`;
      let insertedCount = 0;
      for (const m of machines) {
        const id = String(m.id || '').trim();
        if (!id) continue;
        await sql`INSERT INTO parts_machines (id, company_id, name, make, model, year, notes)
          VALUES (${id}, ${company_id}, ${m.name || ''}, ${m.make || ''}, ${m.model || ''}, ${m.year || ''}, ${m.notes || ''})`;
        insertedCount++;
      }
      await logAudit(sql, req, user, {
        action: 'parts.save_machines',
        resource_type: 'machine',
        resource_id: null,
        details: { count: insertedCount }
      });
      return res.json({ ok: true, count: machines.length });
    }
    if (action === 'get_machine_part_counts') {
      // Unique part numbers per machine_tag, unioned across parts_inventory (direct assignments)
      // and manual_part_index (parts extracted from manuals tagged to the machine). This covers
      // the case where a part was already in inventory from an earlier invoice when the manual
      // was uploaded — inventory.machine_tag never updated, but manual_part_index still records
      // the relationship.
      const rows = await sql`
        SELECT machine_tag, COUNT(DISTINCT LOWER(part_number)) AS cnt FROM (
          SELECT machine_tag, part_number FROM parts_inventory
            WHERE company_id = ${company_id} AND part_number <> ''
          UNION
          SELECT machine_tag, part_number FROM manual_part_index
            WHERE company_id = ${company_id} AND part_number <> ''
        ) t
        WHERE machine_tag IS NOT NULL AND machine_tag <> ''
        GROUP BY machine_tag`;
      return res.json(rows);
    }
    if (action === 'sync_machine_parts') {
      // For a given machine_tag, look at every part number extracted from manuals tagged to this
      // machine, and set parts_inventory.machine_tag = <that machine> for matching rows whose
      // current tag is empty/'shop_stock' (we never stomp a user-assigned tag on a different machine).
      const machine_tag = String(body.machine_tag || '').trim();
      if (!machine_tag) return res.status(400).json({ error: 'machine_tag required' });
      const updated = await sql`
        UPDATE parts_inventory inv
        SET machine_tag = ${machine_tag}, updated_at = NOW()
        WHERE inv.company_id = ${company_id}
          AND (inv.machine_tag IS NULL OR inv.machine_tag = '' OR inv.machine_tag = 'shop_stock')
          AND LOWER(inv.part_number) IN (
            SELECT DISTINCT LOWER(mpi.part_number)
            FROM manual_part_index mpi
            WHERE mpi.company_id = ${company_id}
              AND mpi.machine_tag = ${machine_tag}
              AND mpi.part_number <> ''
          )
        RETURNING id`;
      return res.json({ ok: true, updated: updated.length });
    }
    if (action === 'get_low_stock') {
      const rows = await sql`SELECT *, quantity AS qty_on_hand, min_quantity AS qty_minimum FROM parts_inventory WHERE company_id = ${company_id} AND quantity <= min_quantity ORDER BY quantity ASC`;
      return res.json(rows);
    }
    if (action === 'get_parts_todo_alerts') {
      const waiting = await sql`SELECT ti.id, t.title, ti.parts_note, ti.parts_number FROM task_instances ti JOIN tasks t ON ti.task_id=t.id WHERE ti.status='waiting_parts' AND t.company_id=${company_id} ORDER BY ti.created_at DESC`;
      const low = await sql`SELECT id, part_number, description, quantity, min_quantity FROM parts_inventory WHERE quantity <= min_quantity AND company_id = ${company_id} ORDER BY quantity ASC`;
      return res.json({ waiting_parts: waiting, low_stock: low });
    }

    // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ INVENTORY CRUD ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
    if (action === 'save_part') {
      const p = body;
      const vendorsJson = JSON.stringify(Array.isArray(p.custom_vendors) ? p.custom_vendors : []);
      const isCustom = !!p.is_custom;
      let rows;
      if (p.id) {
        rows = await sql`UPDATE parts_inventory SET
          part_number = ${p.part_number || ''},
          description = ${p.description || ''},
          manufacturer = ${p.manufacturer || ''},
          category = ${p.category || ''},
          quantity = ${p.quantity || 0},
          min_quantity = ${p.min_quantity || 1},
          unit_cost = ${p.unit_cost || 0},
          location = ${p.location || ''},
          machine_tag = ${p.machine_tag || ''},
          supplier = ${p.supplier || ''},
          barcode = ${p.barcode || ''},
          is_custom = ${isCustom},
          custom_vendors = ${vendorsJson}::jsonb,
          notes = ${p.notes || ''},
          updated_at = NOW()
          WHERE id = ${p.id} AND company_id = ${company_id} RETURNING *`;
      } else {
        rows = await sql`INSERT INTO parts_inventory
          (part_number, description, manufacturer, category, quantity, min_quantity, unit_cost, location, machine_tag, supplier, barcode, is_custom, custom_vendors, notes, company_id)
          VALUES (${p.part_number || ''}, ${p.description || ''}, ${p.manufacturer || ''}, ${p.category || ''},
          ${p.quantity || 0}, ${p.min_quantity || 1}, ${p.unit_cost || 0}, ${p.location || ''},
          ${p.machine_tag || ''}, ${p.supplier || ''}, ${p.barcode || ''}, ${isCustom}, ${vendorsJson}::jsonb, ${p.notes || ''}, ${company_id})
          RETURNING *`;
      }
      await logAudit(sql, req, user, {
        action: 'parts.save_part',
        resource_type: 'part',
        resource_id: (p.id || (rows[0] && rows[0].id)) || null,
        details: { name: body.name, part_number: body.part_number, quantity: body.quantity, updated: !!body.id }
      });
      return res.json({ ok: true, part: rows[0] });
    }

    if (action === 'delete_part') {
      await sql`DELETE FROM parts_inventory WHERE id = ${body.id} AND company_id = ${company_id}`;
      await logAudit(sql, req, user, {
        action: 'parts.delete_part',
        resource_type: 'part',
        resource_id: body.id,
        details: {}
      });
      return res.json({ ok: true });
    }

    if (action === 'update_part') {
      const { id, quantity, field, value } = body;
      let updatedField = null;
      if (!field || field === 'quantity') {
        await sql`UPDATE parts_inventory SET quantity = ${value !== undefined ? value : quantity}, updated_at = NOW() WHERE id = ${id}`;
        updatedField = 'quantity';
      } else if (field === 'location') {
        await sql`UPDATE parts_inventory SET location = ${value}, updated_at = NOW() WHERE id = ${id}`;
        updatedField = 'location';
      }
      await logAudit(sql, req, user, {
        action: 'parts.update_part',
        resource_type: 'part',
        resource_id: id,
        details: { updated_fields: updatedField ? [updatedField] : [] }
      });
      return res.json({ ok: true });
    }

    if (action === 'adjust_part') {
      const { id, new_quantity, delta, reason, notes } = body;
      if (!id) return res.status(400).json({ error: 'Missing part id' });
      const current = await sql`SELECT id, quantity, avg_cost FROM parts_inventory WHERE id = ${id} AND company_id = ${company_id}`;
      if (!current.length) return res.status(404).json({ error: 'Part not found' });
      const oldQty = parseInt(current[0].quantity) || 0;
      let newQty;
      if (new_quantity !== undefined && new_quantity !== null && String(new_quantity).trim() !== '') {
        newQty = parseInt(new_quantity);
      } else {
        newQty = oldQty + parseInt(delta || 0);
      }
      if (isNaN(newQty)) return res.status(400).json({ error: 'Invalid quantity' });
      if (newQty < 0) newQty = 0;
      const actualDelta = newQty - oldQty;
      const avgCost = parseFloat(current[0].avg_cost) || 0;
      const totalVal = newQty * avgCost;
      await sql`UPDATE parts_inventory SET quantity = ${newQty}, total_value = ${totalVal}, updated_at = NOW() WHERE id = ${id}`;
      await sql`INSERT INTO parts_adjustments (part_id, company_id, delta, new_quantity, reason, notes, user_id)
        VALUES (${id}, ${company_id}, ${actualDelta}, ${newQty}, ${reason || ''}, ${notes || ''}, ${user_id})`;
      await logAudit(sql, req, user, {
        action: 'parts.adjust_part',
        resource_type: 'part',
        resource_id: id,
        details: { delta: body.delta, reason: body.reason }
      });
      return res.json({ ok: true, delta: actualDelta, new_quantity: newQty });
    }

    if (action === 'lookup_barcode') {
      const { barcode } = body;
      if (!barcode) return res.status(400).json({ error: 'Missing barcode' });
      const rows = await sql`SELECT * FROM parts_inventory WHERE company_id = ${company_id} AND barcode = ${barcode} LIMIT 1`;
      return res.json({ ok: true, part: rows[0] || null });
    }

    // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ INVOICES CRUD ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
    if (action === 'save_invoice') {
      const inv = body;
      const isNew = !inv.id;
      let rows;
      if (inv.id) {
        rows = await sql`UPDATE parts_invoices SET
          vendor = ${inv.vendor || ''},
          invoice_number = ${inv.invoice_number || ''},
          invoice_date = ${inv.invoice_date || null},
          total_amount = ${inv.total_amount || 0}, tags = ${inv.tags || ''}, machine_tag = ${inv.machine_tag || ''},
          notes = ${inv.notes || ''},
          items = ${JSON.stringify(inv.items || [])},
          updated_at = NOW()
          WHERE id = ${inv.id} RETURNING *`;
      } else {
        rows = await sql`INSERT INTO parts_invoices
          (vendor, invoice_number, invoice_date, total_amount, notes, items, tags, machine_tag, company_id)
          VALUES (${inv.vendor || ''}, ${inv.invoice_number || ''}, ${inv.invoice_date || null},
          ${inv.total_amount || 0}, ${inv.notes || ''}, ${JSON.stringify(inv.items || [])}, ${inv.tags || ''}, ${inv.machine_tag || ''}, ${company_id})
          RETURNING *`;
      }
      // Auto-stock parts from invoice line items — only on create, and only for lines marked 'stock'.
      // Lines marked 'used' are recorded on the invoice for cost/tracking but not added to inventory.
      if (isNew) {
        const lineItems = inv.items || [];
        for (const li of lineItems) {
          const desc = String(li.description || li.item || '').trim();
          const pn = String(li.part_number || '').trim();
          if (!desc && !pn) continue;
          if ((li.use_type || 'stock') !== 'stock') continue;
          const itemQty = parseFloat(li.qty) || 1;
          const itemCost = parseFloat(li.cost) || 0;
          const machTag = inv.machine_tag || li.machine_tag || '';
          // Match on part_number when available (more reliable), fall back to description
          const existing = pn
            ? await sql`SELECT id, quantity, avg_cost FROM parts_inventory WHERE company_id = ${company_id} AND part_number = ${pn} LIMIT 1`
            : await sql`SELECT id, quantity, avg_cost FROM parts_inventory WHERE company_id = ${company_id} AND LOWER(TRIM(description)) = LOWER(TRIM(${desc})) LIMIT 1`;
          if (existing.length > 0) {
            const old = existing[0];
            const oldQty = parseFloat(old.quantity) || 0;
            const oldAvg = parseFloat(old.avg_cost) || 0;
            const newQty = oldQty + itemQty;
            const newAvg = newQty > 0 ? ((oldQty * oldAvg) + (itemQty * itemCost)) / newQty : itemCost;
            const totalVal = newQty * newAvg;
            await sql`UPDATE parts_inventory SET
              quantity = ${newQty}, avg_cost = ${newAvg}, unit_cost = ${itemCost}, total_value = ${totalVal},
              updated_at = NOW() WHERE id = ${old.id}`;
          } else {
            const totalVal = itemQty * itemCost;
            await sql`INSERT INTO parts_inventory
              (company_id, description, part_number, quantity, unit_cost, avg_cost, total_value, machine_tag, supplier)
              VALUES (${company_id}, ${desc || pn}, ${pn || desc}, ${itemQty}, ${itemCost}, ${itemCost}, ${totalVal}, ${machTag}, ${inv.vendor || ''})`;
          }
        }
      }
      await logAudit(sql, req, user, {
        action: 'parts.save_invoice',
        resource_type: 'invoice',
        resource_id: (inv.id || (rows[0] && rows[0].id)) || null,
        details: { vendor: body.vendor, invoice_number: body.invoice_number, total: body.total, updated: !!body.id }
      });
      return res.json({ ok: true, invoice: rows[0] });
    }

    if (action === 'delete_invoice') {
      await sql`DELETE FROM parts_invoices WHERE id = ${body.id} AND company_id = ${company_id}`;
      await logAudit(sql, req, user, {
        action: 'parts.delete_invoice',
        resource_type: 'invoice',
        resource_id: body.id,
        details: {}
      });
      return res.json({ ok: true });
    }

    // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ CROSS-REFERENCE CRUD ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
    if (action === 'save_cross_ref') {
      const cr = body;
      let rows;
      if (cr.id) {
        rows = await sql`UPDATE parts_cross_ref SET
          part_number_a = ${cr.part_number_a || ''},
          manufacturer_a = ${cr.manufacturer_a || ''},
          part_number_b = ${cr.part_number_b || ''},
          manufacturer_b = ${cr.manufacturer_b || ''},
          description = ${cr.description || ''},
          price_a = ${cr.price_a || 0},
          price_b = ${cr.price_b || 0},
          notes = ${cr.notes || ''},
          updated_at = NOW()
          WHERE id = ${cr.id} RETURNING *`;
      } else {
        rows = await sql`INSERT INTO parts_cross_ref
          (part_number_a, manufacturer_a, part_number_b, manufacturer_b, description, price_a, price_b, notes, company_id)
          VALUES (${cr.part_number_a || ''}, ${cr.manufacturer_a || ''}, ${cr.part_number_b || ''},
          ${cr.manufacturer_b || ''}, ${cr.description || ''}, ${cr.price_a || 0}, ${cr.price_b || 0},
          ${cr.notes || ''}, ${company_id})
          RETURNING *`;
      }
      await logAudit(sql, req, user, {
        action: 'parts.save_cross_ref',
        resource_type: 'cross_ref',
        resource_id: (cr.id || (rows[0] && rows[0].id)) || null,
        details: { part_number: body.part_number, alias: body.alias, updated: !!body.id }
      });
      return res.json({ ok: true, ref: rows[0] });
    }

    if (action === 'delete_cross_ref') {
      await sql`DELETE FROM parts_cross_ref WHERE id = ${body.id} AND company_id = ${company_id}`;
      await logAudit(sql, req, user, {
        action: 'parts.delete_cross_ref',
        resource_type: 'cross_ref',
        resource_id: body.id,
        details: {}
      });
      return res.json({ ok: true });
    }

    // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ ORDERS CRUD ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
    if (action === 'save_parts_order') {
      const o = body;
      let rows;
      if (o.id) {
        rows = await sql`UPDATE parts_orders SET
          vendor = ${o.vendor || ''},
          part_number = ${o.part_number || ''},
          description = ${o.description || ''},
          quantity = ${o.quantity || 1},
          unit_cost = ${o.unit_cost || 0},
          status = ${o.status || 'pending'},
          task_id = ${o.task_id || null},
          notes = ${o.notes || ''},
          updated_at = NOW()
          WHERE id = ${o.id} RETURNING *`;
      } else {
        rows = await sql`INSERT INTO parts_orders
          (vendor, part_number, description, quantity, unit_cost, status, task_id, notes, company_id, ordered_by)
          VALUES (${o.vendor || ''}, ${o.part_number || ''}, ${o.description || ''},
          ${o.quantity || 1}, ${o.unit_cost || 0}, ${o.status || 'pending'},
          ${o.task_id || null}, ${o.notes || ''}, ${company_id}, ${user_id})
          RETURNING *`;
      }
      await logAudit(sql, req, user, {
        action: 'parts.save_parts_order',
        resource_type: 'parts_order',
        resource_id: (o.id || (rows[0] && rows[0].id)) || null,
        details: { part_id: body.part_id, quantity: body.quantity, vendor: body.vendor, updated: !!body.id }
      });
      return res.json({ ok: true, order: rows[0] });
    }

    if (action === 'update_tracking' || action === 'add_tracking') {
      const { order_id, tracking_number, carrier, task_id } = body;
      await sql`UPDATE parts_orders SET
        tracking_number = ${tracking_number || ''},
        carrier = ${carrier || ''},
        status = 'ordered',
        updated_at = NOW()
        WHERE id = ${order_id}`;
      if (task_id) {
        await sql`UPDATE tasks SET status = 'parts_ordered', updated_at = NOW() WHERE id = ${task_id}`;
      }
      await logAudit(sql, req, user, {
        action: 'parts.update_tracking',
        resource_type: 'parts_order',
        resource_id: body.order_id,
        details: { tracking_number: body.tracking_number, status: body.status }
      });
      return res.json({ ok: true });
    }

    if (action === 'receive_part') {
      const { order_id, task_id, parts } = body;
      let receivedCount = 0;
      for (const p of (parts || [])) {
        const pn = String(p.part_number || '').trim();
        if (!pn) continue;
        const desc = String(p.description || '').trim();
        const qty = parseInt(p.quantity) || 0;
        if (qty <= 0) continue;
        const cost = parseFloat(p.unit_cost) || 0;
        const existing = await sql`SELECT id, quantity, avg_cost FROM parts_inventory
          WHERE part_number = ${pn} AND company_id = ${company_id} LIMIT 1`;
        if (existing.length > 0) {
          const old = existing[0];
          const oldQty = parseInt(old.quantity) || 0;
          const oldAvg = parseFloat(old.avg_cost) || 0;
          const newQty = oldQty + qty;
          const newAvg = newQty > 0 ? ((oldQty * oldAvg) + (qty * cost)) / newQty : cost;
          const totalVal = newQty * newAvg;
          await sql`UPDATE parts_inventory SET
            quantity = ${newQty}, avg_cost = ${newAvg}, unit_cost = ${cost}, total_value = ${totalVal},
            updated_at = NOW() WHERE id = ${old.id}`;
          await sql`INSERT INTO parts_adjustments (part_id, company_id, delta, new_quantity, reason, notes, user_id)
            VALUES (${old.id}, ${company_id}, ${qty}, ${newQty}, 'received', ${'Order receipt (+' + qty + ')'}, ${user_id})`;
        } else {
          const totalVal = qty * cost;
          const inserted = await sql`INSERT INTO parts_inventory
            (part_number, description, manufacturer, quantity, unit_cost, avg_cost, total_value, company_id)
            VALUES (${pn}, ${desc}, ${p.manufacturer || ''}, ${qty}, ${cost}, ${cost}, ${totalVal}, ${company_id})
            RETURNING id`;
          await sql`INSERT INTO parts_adjustments (part_id, company_id, delta, new_quantity, reason, notes, user_id)
            VALUES (${inserted[0].id}, ${company_id}, ${qty}, ${qty}, 'received', ${'Order receipt (+' + qty + ', new part)'}, ${user_id})`;
        }
        receivedCount += qty;
      }
      if (order_id) {
        await sql`UPDATE parts_orders SET status = 'received', received_at = NOW(), updated_at = NOW()
          WHERE id = ${order_id} AND company_id = ${company_id}`;
      }
      if (task_id) {
        await sql`UPDATE tasks SET status = 'in_progress', updated_at = NOW() WHERE id = ${task_id}`;
      }
      await logAudit(sql, req, user, {
        action: 'parts.receive_part',
        resource_type: 'parts_order',
        resource_id: body.order_id,
        details: { quantity_received: body.quantity_received }
      });
      return res.json({ ok: true, received_count: receivedCount });
    }

    // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ MANUALS CRUD ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
    if (action === 'save_manual') {
      const m = body;
      let rows;
      if (m.id) {
        rows = await sql`UPDATE parts_manuals SET
          title = ${m.title || ''},
          manufacturer = ${m.manufacturer || ''},
          model = ${m.model || ''},
          file_url = ${m.file_url || ''},
          notes = ${m.notes || ''},
          updated_at = NOW()
          WHERE id = ${m.id} RETURNING *`;
      } else {
        rows = await sql`INSERT INTO parts_manuals (title, manufacturer, model, file_url, notes, company_id)
          VALUES (${m.title || ''}, ${m.manufacturer || ''}, ${m.model || ''}, ${m.file_url || ''}, ${m.notes || ''}, ${company_id})
          RETURNING *`;
      }
      await logAudit(sql, req, user, {
        action: 'parts.save_manual',
        resource_type: 'manual',
        resource_id: (m.id || (rows[0] && rows[0].id)) || null,
        details: { filename: body.filename, machine_id: body.machine_id, updated: !!body.id }
      });
      return res.json({ ok: true, manual: rows[0] });
    }

    if (action === 'delete_manual') {
      await sql`DELETE FROM parts_manuals WHERE id = ${body.id} AND company_id = ${company_id}`;
      await logAudit(sql, req, user, {
        action: 'parts.delete_manual',
        resource_type: 'manual',
        resource_id: body.id,
        details: {}
      });
      return res.json({ ok: true });
    }

    if (action === 'search_manual') {
      const q = '%' + (body.query || body.q || '') + '%';
      const rows = await sql`SELECT * FROM parts_manuals
        WHERE company_id = ${company_id}
        AND (title ILIKE ${q} OR manufacturer ILIKE ${q} OR model ILIKE ${q})
        ORDER BY title`;
      return res.json(rows);
    }

    // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ WEB SEARCH ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
    if (action === 'search_parts_web') {
      const pn = body.part_number || '';
      const desc = body.description || '';
      const q = (pn + (desc ? ' ' + desc : '')).trim();
      return res.json({
        ok: true,
        query: q,
        search_url: 'https://www.google.com/search?q=' + encodeURIComponent(q + ' buy price'),
        amazon_url: 'https://www.amazon.com/s?k=' + encodeURIComponent(q),
        ebay_url: 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(q),
        grainger_url: 'https://www.grainger.com/search?searchQuery=' + encodeURIComponent(q),
        motion_url: 'https://www.motionindustries.com/search?term=' + encodeURIComponent(q),
      });
    }

    if (action === 'search_vendor_prices') {
      const pn = String(body.part_number || '').trim();
      const desc = String(body.description || '').trim();
      if (!pn) return res.status(400).json({ error: 'Part number required' });
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const prompt = `You are a parts procurement assistant for Pride of the Pond, a catfish processing facility. Search the web to find vendors selling this exact industrial part, then draft a quote-request email tailored to each vendor.\n\nPart Number: ${pn}\nDescription: ${desc || '(not provided)'}\n\nFor up to 5 vendors you find on the open web, extract or research:\n1. vendor — company name\n2. price — unit price in USD (number, omit field if not shown or not certain)\n3. url — direct product page URL (must match this specific part; do not guess)\n4. available — true if the page shows "in stock" or "add to cart"; false if backordered / out of stock / contact for availability\n5. contact_email — the parts, sales, or customer-support email address for this vendor. Visit their contact / support / about page if needed. It MUST be a real email you read on their site, not a guess.\n6. vendor_note — one short sentence: what kind of vendor, lead time, MOQ, or anything useful\n7. quote_email_subject — RFQ email subject you'd send this vendor, e.g. "RFQ: Part # ${pn} — ${desc || 'Industrial Part'}"\n8. quote_email_body — a professional RFQ email body (4-6 short paragraphs). Ask for: unit price, volume discount tiers, lead time, shipping options and cost, payment terms. Mention you're price-comparing across multiple vendors. Sign off as "Cooper Battle / Pride of the Pond". Plain text, no markdown.\n\nPrefer authorized industrial distributors (Grainger, McMaster-Carr, Motion Industries, Fastenal, MSC Direct, Global Industrial, Amazon Business, the OEM's own site). Skip generic marketplace resellers and any listing that clearly isn't this part.\n\nOmit a vendor entirely if you cannot find a real contact email for them. Don't invent emails.\n\nReturn ONLY JSON (no markdown fences, no preamble). Shape:\n{"vendors":[{"vendor":"","price":0,"url":"","available":true,"contact_email":"","vendor_note":"","quote_email_subject":"","quote_email_body":""}]}`;
      try {
        const msg = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 10000,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }],
          messages: [{ role: 'user', content: prompt }]
        });
        const text = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
        const cleaned = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
        let parsed;
        try { parsed = JSON.parse(cleaned); }
        catch (e) {
          // Try to find a JSON object inside the text
          const firstBrace = cleaned.indexOf('{');
          const lastBrace = cleaned.lastIndexOf('}');
          if (firstBrace >= 0 && lastBrace > firstBrace) {
            try { parsed = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1)); }
            catch (e2) { return res.status(500).json({ error: 'AI response not JSON', raw: cleaned.slice(0, 400) }); }
          } else {
            return res.status(500).json({ error: 'AI response not JSON', raw: cleaned.slice(0, 400) });
          }
        }
        const vendors = Array.isArray(parsed.vendors) ? parsed.vendors : [];
        return res.json({ ok: true, part_number: pn, description: desc, vendors });
      } catch (err) {
        console.error('Vendor search error:', err);
        return res.status(500).json({ error: 'Vendor search failed: ' + err.message });
      }
    }


    // ââ INVOICE SCAN / EXTRACT âââââââââââââââââââââââââââââââââââââââââââââââ
    if (action === 'extract_invoice') {
      const { image_base64, media_type } = body;
      if (!image_base64) return res.status(400).json({ error: 'No image provided' });
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const prompt = `You are analyzing a parts/supply invoice for a catfish processing plant. Extract ALL data and return ONLY valid JSON with no markdown or extra text:
{"vendor":"supplier name","invoice_number":"invoice/PO number","invoice_date":"YYYY-MM-DD or null","total_amount":0.00,"line_items":[{"part_number":"item/part/catalog number","description":"item description","manufacturer":"brand if shown or null","quantity":1,"unit_cost":0.00,"total_cost":0.00}]}
Rules: extract every line item; use null for missing fields; part_number = catalog/SKU/item code; return ONLY the JSON.`;
      const response = await client.messages.create({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 2000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image_base64 } },
          { type: 'text', text: prompt }
        ]}]
      });
      const text = response.content[0].text.trim().replace(/^```json?\n?/,'').replace(/\n?```$/,'');
      try {
        const extracted = JSON.parse(text);
        return res.json({ ok: true, ...extracted });
      } catch(e) {
        return res.status(500).json({ error: 'AI parse error: ' + e.message, raw: text.slice(0,200) });
      }
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (e) {
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
};
