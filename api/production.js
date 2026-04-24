// api/production.js
// Production Log widget — Phase A
//
// Replaces the MON/TUE/.../COOLER/FREEZER-IQF/ICE PACK sheets in
// yield master.xlsx. Per-day per-SKU finished-product tracking.
//
// Columns per row (on the frontend):
//   BEGIN    — balance carried in from the previous day (computed)
//   LW       — balance at end of last Saturday (computed, reference only)
//   FREEZER  — pounds produced today for this SKU (entered by operator)
//   ADJUST   — corrections + cross-pool transfers (net; detail in prod_adjustments)
//   SHIPPED  — pounds that left inventory today (entered by operator)
//   BALANCE  — ending balance = BEGIN + FREEZER + ADJUST - SHIPPED (computed)
//
// Three pools: FREEZER-IQF, ICE PACK, COOLER. Each SKU lives in exactly one
// pool. Cross-pool transfers are two paired adjustment rows (negative in
// source, positive in destination) sharing a transfer_pair_id.

const { neon } = require('@neondatabase/serverless');
const perms = require('./_permissions');
const { logAudit } = require('./_audit');

const VALID_POOLS = new Set(['FREEZER-IQF', 'ICE PACK', 'COOLER']);

// Strips a trailing or leading "15#" / "24# CARTON" / "4 #" style token from
// an item name. Returns { name, lbs }. Examples:
//   "CATFISH BITES 15#"   → { name: "CATFISH BITES",  lbs: 15 }
//   "NUGGETS 24# CARTON"  → { name: "NUGGETS",        lbs: 24 }
//   "40# 4OZ PORTION"     → { name: "4OZ PORTION",    lbs: 40 }
//   "WHOLE 3-5"           → { name: "WHOLE 3-5",      lbs: null }
// Used both to clean seed data on insert and to migrate dirty names on an
// existing DB when seed_skus is re-run.
function stripCaseWeight(name) {
  if (!name) return { name: name || '', lbs: null };
  var s = String(name).trim();
  // Leading "N# rest"
  var leading = s.match(/^(\d+(?:\.\d+)?)\s*#\s+(.+)$/);
  if (leading) return { name: leading[2].trim(), lbs: parseFloat(leading[1]) };
  // Trailing "rest N#" or "rest N# CARTON"
  var trailing = s.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*#(?:\s*CARTON)?\s*$/i);
  if (trailing) return { name: trailing[1].trim(), lbs: parseFloat(trailing[2]) };
  return { name: s, lbs: null };
}

// Enforces "{size} {type}" naming order across the catalog. Handles:
//   "FILET 2-3"          → "2-3 FILET"
//   "FILLET 4-6"         → "4-6 FILET"       (plural/extra L normalized)
//   "WHOLE 3-5"          → "3-5 WHOLE"
//   "FILET 3-5 SPLITS"   → "3-5 SPLIT"       (SPLITS collapses to SPLIT)
//   "FILET 11+"          → "11+ FILET"
//   "FILET 2-3C"         → "2-3C FILET"
// Leaves alone: already in {size} {type} order, items with prefixes like
// "IQF 4.5-5.5 SPLIT", "MISCUT FILET (bulk)", "DEEP SKIN", parenthetical
// suffixes, anything without a size range.
function standardizeNaming(name) {
  if (!name) return name;
  var s = String(name).trim();
  // Size token: digits, optional decimal, optional range, optional '+' or single trailing letter.
  // E.g., "2-3", "4.5-5.5", "11+", "2-3C".
  var SIZE = '(\\d+(?:\\.\\d+)?(?:[-\\u2013]\\d+(?:\\.\\d+)?)?[+A-Z]?)';

  // "FILET 3-5 SPLITS" → "3-5 SPLIT"
  var m = s.match(new RegExp('^FILL?ETS?\\s+' + SIZE + '\\s+SPLITS?\\s*$', 'i'));
  if (m) return m[1] + ' SPLIT';

  // "FILET 2-3", "FILLET 4-6", "WHOLE 3-5" → "{SIZE} {TYPE}"
  m = s.match(new RegExp('^(WHOLE|FILL?ETS?|SPLITS?)\\s+' + SIZE + '\\s*$', 'i'));
  if (m) {
    var type = m[1].toUpperCase();
    if (/^FILL?ETS?$/i.test(type)) type = 'FILET';
    if (/^SPLITS?$/i.test(type)) type = 'SPLIT';
    return m[2] + ' ' + type;
  }

  return s;
}

// Seed data — extracted from yield master-2026.xlsx, filtered to real SKUs.
// Item names are pre-cleaned (no "15#" / "CARTON" suffixes); case weight is
// carried on lbs_per_case. Freezer/Ice Pack default to 15# cases per the
// spreadsheet's stated defaults; explicit values shown for specialty packs.
const SEED_SKUS = [
  // FREEZER-IQF ────────────────────────────────────────────────────────
  { pool: 'FREEZER-IQF', sku: '1031011',        item: '3-5 WHOLE',                category: 'WHOLE',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1051011',        item: '5-7 WHOLE',                category: 'WHOLE',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1071011',        item: '7-9 WHOLE',                category: 'WHOLE',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1091011',        item: '9-11 WHOLE',               category: 'WHOLE',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1131011',        item: '13-15 WHOLE',              category: 'WHOLE',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1151011',        item: '15-17 WHOLE',              category: 'WHOLE',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1005041W',       item: 'WHOLE (small pack)',       category: 'WHOLE',     lbs_per_case: 4 },
  { pool: 'FREEZER-IQF', sku: '',               item: 'WHOLE (bulk carton)',      category: 'WHOLE',     lbs_per_case: 24 },
  { pool: 'FREEZER-IQF', sku: '1022011',        item: '2-3 FILET',                category: 'FILET',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1022011C',       item: '2-3C FILET',               category: 'FILET',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1032011',        item: '3-5 FILET',                category: 'FILET',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1032011S',       item: '3-5 SPLIT',                category: 'SPLITS',    lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1019011',        item: 'IQF 4.5-5.5 SPLIT',        category: 'SPLITS',    lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1024011',        item: 'IQF 4 OZ CATFISH PORTION', category: 'PORTIONS',  lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '',               item: '5-6 / 6-7 DEEP SKIN',      category: 'DEEP SKIN', lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1044011',        item: 'DEEP SKIN',                category: 'DEEP SKIN', lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '',               item: '4 OZ POLYBAG',             category: 'PORTIONS',  lbs_per_case: 10 },
  { pool: 'FREEZER-IQF', sku: '',               item: '4OZ PORTION (bulk)',       category: 'PORTIONS',  lbs_per_case: 40 },
  { pool: 'FREEZER-IQF', sku: '1046011',        item: '4-6 FILET',                category: 'FILET',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1032031PB2',     item: 'FILETS POLY BAG',          category: 'FILET',     lbs_per_case: 10 },
  { pool: 'FREEZER-IQF', sku: '',               item: 'FILETS POLY BAG BC',       category: 'FILET',     lbs_per_case: 10 },
  { pool: 'FREEZER-IQF', sku: '1042011',        item: '4-5 FILET',                category: 'FILET',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1042011S',       item: '4-5 SPLIT',                category: 'SPLITS',    lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1052011',        item: '5-7 FILET',                category: 'FILET',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1052011S',       item: '5-6 SPLIT',                category: 'SPLITS',    lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1057211S',       item: '5-7 SPLIT',                category: 'SPLITS',    lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1062011',        item: '6-7 FILET',                category: 'FILET',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1062011S',       item: '6-7 SPLIT',                category: 'SPLITS',    lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1072011',        item: '7-9 FILET',                category: 'FILET',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1072011S',       item: '7-9 SPLIT',                category: 'SPLITS',    lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1092011',        item: '9-11 FILET',               category: 'FILET',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1112011',        item: '11+ FILET',                category: 'FILET',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '',               item: '13+ FILET',                category: 'FILET',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1032041/6CTN',   item: 'FILET (bulk carton)',      category: 'FILET',     lbs_per_case: 24 },
  { pool: 'FREEZER-IQF', sku: '1032041',        item: 'IQF 3-5 FILET (small)',    category: 'FILET',     lbs_per_case: 4 },
  { pool: 'FREEZER-IQF', sku: '1005111',        item: 'CATFISH BITES',            category: 'BITES',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1005011',        item: 'GOR STEAKS',               category: 'STEAKS',    lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1005041',        item: 'STEAKS (small)',           category: 'STEAKS',    lbs_per_case: 4 },
  { pool: 'FREEZER-IQF', sku: '1005011S/6CTN',  item: 'GOR STEAKS (bulk carton)', category: 'STEAKS',    lbs_per_case: 24 },
  { pool: 'FREEZER-IQF', sku: '1003031PB2',     item: 'NUGGETS POLY BAG',         category: 'NUGGETS',   lbs_per_case: 10 },
  { pool: 'FREEZER-IQF', sku: '1003011',        item: 'NUGGETS',                  category: 'NUGGETS',   lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1003041/6CTN',   item: 'NUGGETS (bulk carton)',    category: 'NUGGETS',   lbs_per_case: 24 },
  { pool: 'FREEZER-IQF', sku: '',               item: 'NUGGETS (small)',          category: 'NUGGETS',   lbs_per_case: 4 },
  { pool: 'FREEZER-IQF', sku: '1005211',        item: 'MISCUTS',                  category: 'MISCUTS',   lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1005041/6CTN',   item: 'MISCUT FILET (bulk)',      category: 'MISCUTS',   lbs_per_case: 24 },
  { pool: 'FREEZER-IQF', sku: '1005241',        item: 'MISCUTS (small)',          category: 'MISCUTS',   lbs_per_case: 4 },
  { pool: 'FREEZER-IQF', sku: '1005231PBT',     item: 'POLY NUGGETS AS',          category: 'NUGGETS',   lbs_per_case: 10 },
  { pool: 'FREEZER-IQF', sku: '1005241T/6CTN',  item: 'TENDERS (bulk carton)',    category: 'TENDERS',   lbs_per_case: 24 },
  { pool: 'FREEZER-IQF', sku: '1005211T',       item: 'BUFFETS / TENDERS',        category: 'TENDERS',   lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1005241T',       item: 'TENDERS (small)',          category: 'TENDERS',   lbs_per_case: 4 },
  { pool: 'FREEZER-IQF', sku: '1072011DS',      item: '7-9 DEEP SKINNED',         category: 'DEEP SKIN', lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1005251',        item: 'IRREGULAR FILET',          category: 'FILET',     lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1112011DSS',     item: '11+ DS PREMIUM SPLITS',    category: 'DEEP SKIN', lbs_per_case: 15 },
  { pool: 'FREEZER-IQF', sku: '1112031CC',      item: 'CATFISH CHIPS',            category: 'CHIPS',     lbs_per_case: 10 },
  { pool: 'FREEZER-IQF', sku: '1112031MDS',     item: 'THIN SLICED',              category: 'CHIPS',     lbs_per_case: 10 },

  // ICE PACK (all 15-lb cases per the "ALL 15LB." sheet header) ───────
  { pool: 'ICE PACK', sku: '2051011',     item: '5-7 WHOLE',            category: 'WHOLE',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2071011',     item: '7-9 WHOLE',            category: 'WHOLE',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2091011',     item: '9-11 WHOLE',           category: 'WHOLE',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2111011',     item: '11-13 WHOLE',          category: 'WHOLE',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2131011',     item: '13-15 WHOLE',          category: 'WHOLE',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2151011',     item: '15-17 WHOLE',          category: 'WHOLE',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2181011',     item: '18-24 WHOLE',          category: 'WHOLE',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '',            item: '30-34 WHOLE',          category: 'WHOLE',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2022011',     item: '2-3 FILET',            category: 'FILET',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2032011',     item: '3-5 FILET',            category: 'FILET',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2032011S',    item: '3-5 SPLIT',            category: 'SPLITS',   lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2042011',     item: '4-5 FILET',            category: 'FILET',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2042011S',    item: '4-5 SPLIT',            category: 'SPLITS',   lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2052011',     item: '5-7 FILET',            category: 'FILET',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2052011S',    item: '5-6 SPLIT',            category: 'SPLITS',   lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2052711S',    item: '5-7 SPLIT',            category: 'SPLITS',   lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2062011',     item: '6-7 FILET',            category: 'FILET',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2062011S',    item: '6-7 SPLIT',            category: 'SPLITS',   lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2072011',     item: '7-9 FILET',            category: 'FILET',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2072011S',    item: '7-9 SPLIT',            category: 'SPLITS',   lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2092011',     item: '9-11 FILET',           category: 'FILET',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2092011S',    item: '9-11 SPLIT',           category: 'SPLITS',   lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2112011',     item: '11+ FILET',            category: 'FILET',    lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2005211',     item: 'MISCUTS',              category: 'MISCUTS',  lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2005011',     item: 'GOR STEAK',            category: 'STEAKS',   lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2024011',     item: '2 OZ CATFISH PORTION', category: 'PORTIONS', lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2005211T',    item: 'BUFFETS / TENDERS',    category: 'TENDERS',  lbs_per_case: 15 },
  { pool: 'ICE PACK', sku: '2003011',     item: 'NUGGET',               category: 'NUGGETS',  lbs_per_case: 15 },

  // COOLER (tubs, not cases — lbs_per_case stays null) ────────────────
  { pool: 'COOLER', sku: '', item: '3-5 WHOLE',        category: 'WHOLE',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: '5-7 WHOLE',        category: 'WHOLE',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: '7-9 WHOLE',        category: 'WHOLE',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: '9-11 WHOLE',       category: 'WHOLE',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'MIXED WHOLE',      category: 'WHOLE',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'UN SKINNED WHOLE', category: 'WHOLE',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: '2-3 FILET',        category: 'FILET',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: '3-5 FILET',        category: 'FILET',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: '5-7 FILET',        category: 'FILET',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'SPLITS',           category: 'SPLITS',    lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: '7-8 FILET',        category: 'FILET',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: '9-11 FILET',       category: 'FILET',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'MIXED FILETS',     category: 'FILET',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'GOR STEAK',        category: 'STEAKS',    lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: '4 OZ PORTION',     category: 'PORTIONS',  lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'SKIN',             category: 'DEEP SKIN', lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'DEEP SKIN 11+',    category: 'DEEP SKIN', lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'CHUNKS',           category: 'MISCUTS',   lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'BUFFET SPLITS',    category: 'SPLITS',    lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'UN TRIM FILETS',   category: 'FILET',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: '11+ FILET',        category: 'FILET',     lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'NUGGETS',          category: 'NUGGETS',   lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'UN NUGGETS',       category: 'NUGGETS',   lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'MISCUTS',          category: 'MISCUTS',   lbs_per_case: null },
  { pool: 'COOLER', sku: '', item: 'WHOLE STEAK',      category: 'STEAKS',    lbs_per_case: null }
];

// Tracks which company_ids have had their SKU name migration applied
// in this serverless container's lifetime. Since Vercel instances are
// short-lived, this effectively runs "once per cold start per company".
const _namesMigratedFor = new Set();

// Walks every SKU for a company, strips weight suffixes from item_name,
// and backfills lbs_per_case. Idempotent — second run finds nothing to
// update. Called lazily from get_day / get_skus / seed_skus so Cooper
// doesn't have to click any "migrate" button.
async function migrateNamesOnce(sql, companyId) {
  if (_namesMigratedFor.has(companyId)) return;
  _namesMigratedFor.add(companyId); // mark up front so concurrent requests skip
  try {
    const rows = await sql`
      SELECT id, pool, item_name, lbs_per_case
      FROM prod_skus
      WHERE company_id = ${companyId}
    `;
    for (const e of rows) {
      // Step 1: strip "15#" / "24# CARTON" suffixes
      const parsed = stripCaseWeight(e.item_name);
      // Step 2: enforce "{size} {type}" order (e.g. "FILET 2-3" → "2-3 FILET")
      const finalName = standardizeNaming(parsed.name);

      const poolDefault = (e.pool === 'FREEZER-IQF' || e.pool === 'ICE PACK') ? 15 : null;
      const newLbs = e.lbs_per_case != null
        ? Number(e.lbs_per_case)
        : (parsed.lbs != null ? parsed.lbs : poolDefault);
      const nameChanged = finalName !== e.item_name;
      const lbsChanged = (newLbs != null && Number(e.lbs_per_case || 0) !== Number(newLbs));
      if (nameChanged || lbsChanged) {
        await sql`UPDATE prod_skus SET
          item_name = ${finalName},
          lbs_per_case = ${newLbs},
          updated_at = NOW()
          WHERE id = ${e.id}`;
      }
    }
  } catch (e) {
    console.error('[production] auto-migrate names failed:', e.message);
    _namesMigratedFor.delete(companyId); // allow retry next request
  }
}

async function ensureTables(sql) {
  // SKU catalog. Soft-deleted via active=false so history survives.
  await sql`CREATE TABLE IF NOT EXISTS prod_skus (
    id SERIAL PRIMARY KEY,
    company_id TEXT NOT NULL,
    sku TEXT,
    item_name TEXT NOT NULL,
    category TEXT,
    pool TEXT NOT NULL,
    lbs_per_case NUMERIC,
    display_order INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS prod_skus_company_idx
    ON prod_skus(company_id, pool, active)`;

  // Core daily production entries — one row per (company, date, sku) max.
  await sql`CREATE TABLE IF NOT EXISTS prod_daily_entries (
    id SERIAL PRIMARY KEY,
    company_id TEXT NOT NULL,
    entry_date DATE NOT NULL,
    sku_id INTEGER NOT NULL REFERENCES prod_skus(id) ON DELETE CASCADE,
    produced_lbs NUMERIC DEFAULT 0,
    shipped_lbs NUMERIC DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id, entry_date, sku_id)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS prod_daily_entries_date_idx
    ON prod_daily_entries(company_id, entry_date)`;

  // Adjustments — can be positive or negative. transfer_pair_id groups two
  // rows that form a cross-pool transfer (one negative in source SKU,
  // one positive in destination SKU).
  await sql`CREATE TABLE IF NOT EXISTS prod_adjustments (
    id SERIAL PRIMARY KEY,
    company_id TEXT NOT NULL,
    entry_date DATE NOT NULL,
    sku_id INTEGER NOT NULL REFERENCES prod_skus(id) ON DELETE CASCADE,
    delta_lbs NUMERIC NOT NULL,
    note TEXT,
    transfer_pair_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS prod_adjustments_company_date_idx
    ON prod_adjustments(company_id, entry_date)`;
  await sql`CREATE INDEX IF NOT EXISTS prod_adjustments_sku_idx
    ON prod_adjustments(sku_id)`;
}

// Compute opening balance for each SKU as of the START of a given date.
// Returns Map<sku_id, balance>. Used for BEGIN column.
async function computeBalancesAt(sql, companyId, asOfDate) {
  // Sum produced - shipped for every prior day, plus sum of prior adjustments.
  const entrySum = await sql`
    SELECT sku_id, COALESCE(SUM(produced_lbs - shipped_lbs), 0)::float AS bal
    FROM prod_daily_entries
    WHERE company_id = ${companyId} AND entry_date < ${asOfDate}::date
    GROUP BY sku_id
  `;
  const adjSum = await sql`
    SELECT sku_id, COALESCE(SUM(delta_lbs), 0)::float AS bal
    FROM prod_adjustments
    WHERE company_id = ${companyId} AND entry_date < ${asOfDate}::date
    GROUP BY sku_id
  `;
  const bal = new Map();
  entrySum.forEach(r => bal.set(r.sku_id, (bal.get(r.sku_id) || 0) + Number(r.bal)));
  adjSum.forEach(r => bal.set(r.sku_id, (bal.get(r.sku_id) || 0) + Number(r.bal)));
  return bal;
}

// Returns "last Saturday strictly before asOfDate" as YYYY-MM-DD. Used for
// the LW (last week's ending balance) column.
function lastSaturdayBefore(asOfIso) {
  const d = new Date(asOfIso + 'T00:00:00');
  // getDay: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
  // Number of days to go back to reach the Saturday on or before today:
  //   Sat(6) -> 0   but we want *strictly before*, so bump to 7
  //   Sun(0) -> 1,  Mon -> 2, ..., Fri -> 6
  const dow = d.getDay();
  const back = dow === 6 ? 7 : dow + 1;
  d.setDate(d.getDate() - back);
  return d.toISOString().split('T')[0];
}

// Week = Monday through Saturday (the production week in the spreadsheet).
// Given any ISO date, returns that week's Monday.
function mondayOf(iso) {
  const d = new Date(iso + 'T00:00:00');
  const dow = d.getDay(); // 0=Sun, 1=Mon
  const back = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - back);
  return d.toISOString().split('T')[0];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);
  const url = new URL(req.url, 'http://x');
  const action = (req.query && req.query.action) || url.searchParams.get('action') || '';

  try { await ensureTables(sql); } catch (e) { console.error('[production] ensureTables:', e.message); }

  const user = perms.requireAuth(req, res);
  if (!user) return;
  const companyId = String(user.company_id);

  try {
    // ── GET get_skus ───────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'get_skus') {
      if (!perms.canPerform(user, 'production', 'view')) return perms.deny(res, user, 'production', 'view');
      // Auto-migrate dirty names / missing case sizes on first hit per container
      await migrateNamesOnce(sql, companyId);
      const rows = await sql`
        SELECT id, sku, item_name, category, pool, lbs_per_case, display_order, notes
        FROM prod_skus
        WHERE company_id = ${companyId} AND active = true
        ORDER BY pool, display_order, item_name
      `;
      return res.json({ ok: true, skus: rows });
    }

    // ── GET get_day ────────────────────────────────────────────────────
    // Returns every active SKU with its today row + BEGIN + LW + BALANCE
    // computed. Grouped on the frontend by pool + category.
    if (req.method === 'GET' && action === 'get_day') {
      if (!perms.canPerform(user, 'production', 'view')) return perms.deny(res, user, 'production', 'view');
      const entryDate = (url.searchParams.get('entry_date') || '').trim();
      if (!entryDate) return res.status(400).json({ error: 'entry_date required (YYYY-MM-DD)' });
      // Auto-migrate dirty names / missing case sizes on first hit per container
      await migrateNamesOnce(sql, companyId);

      const skus = await sql`
        SELECT id, sku, item_name, category, pool, lbs_per_case, display_order
        FROM prod_skus
        WHERE company_id = ${companyId} AND active = true
        ORDER BY pool, display_order, item_name
      `;

      const entries = await sql`
        SELECT sku_id, produced_lbs::float, shipped_lbs::float, notes
        FROM prod_daily_entries
        WHERE company_id = ${companyId} AND entry_date = ${entryDate}::date
      `;
      const entryMap = new Map(entries.map(e => [e.sku_id, e]));

      const todayAdj = await sql`
        SELECT id, sku_id, delta_lbs::float AS delta, note, transfer_pair_id
        FROM prod_adjustments
        WHERE company_id = ${companyId} AND entry_date = ${entryDate}::date
        ORDER BY id
      `;
      const adjMap = new Map();
      todayAdj.forEach(a => {
        if (!adjMap.has(a.sku_id)) adjMap.set(a.sku_id, []);
        adjMap.get(a.sku_id).push(a);
      });

      const beginBalances = await computeBalancesAt(sql, companyId, entryDate);
      const lwDate = lastSaturdayBefore(entryDate);
      // LW = balance at end of lastSaturdayBefore = balance at start of the
      // day after lastSaturdayBefore.
      const lwPlusOne = new Date(lwDate + 'T00:00:00');
      lwPlusOne.setDate(lwPlusOne.getDate() + 1);
      const lwBalances = await computeBalancesAt(sql, companyId, lwPlusOne.toISOString().split('T')[0]);

      const rows = skus.map(s => {
        const e = entryMap.get(s.id) || { produced_lbs: 0, shipped_lbs: 0, notes: '' };
        const adjs = adjMap.get(s.id) || [];
        const adjTotal = adjs.reduce((sum, a) => sum + Number(a.delta || 0), 0);
        const begin = beginBalances.get(s.id) || 0;
        const lw = lwBalances.get(s.id) || 0;
        const balance = begin + Number(e.produced_lbs || 0) + adjTotal - Number(e.shipped_lbs || 0);
        return {
          sku_id: s.id,
          sku: s.sku,
          item_name: s.item_name,
          category: s.category,
          pool: s.pool,
          lbs_per_case: s.lbs_per_case != null ? Number(s.lbs_per_case) : null,
          display_order: s.display_order,
          begin_lbs: Number(begin.toFixed(2)),
          lw_lbs: Number(lw.toFixed(2)),
          produced_lbs: Number(e.produced_lbs || 0),
          shipped_lbs: Number(e.shipped_lbs || 0),
          adjust_lbs: Number(adjTotal.toFixed(2)),
          adjust_count: adjs.length,
          balance_lbs: Number(balance.toFixed(2)),
          notes: e.notes || '',
          adjustments: adjs
        };
      });

      return res.json({ ok: true, entry_date: entryDate, lw_date: lwDate, rows });
    }

    // ── GET get_week ───────────────────────────────────────────────────
    // Weekly roll: Mon-Sat + Mon2 + Tue2 as columns, one row per SKU.
    // Used by the "Weekly Roll" tab.
    if (req.method === 'GET' && action === 'get_week') {
      if (!perms.canPerform(user, 'production', 'view')) return perms.deny(res, user, 'production', 'view');
      const weekStart = (url.searchParams.get('week_start') || '').trim();
      if (!weekStart) return res.status(400).json({ error: 'week_start required (Monday YYYY-MM-DD)' });
      await migrateNamesOnce(sql, companyId);

      // 8-day range: Mon of this week through Tue of next week (Mon2 + Tue2)
      const days = [];
      for (let i = 0; i < 8; i++) {
        const d = new Date(weekStart + 'T00:00:00');
        d.setDate(d.getDate() + i);
        days.push(d.toISOString().split('T')[0]);
      }

      const skus = await sql`
        SELECT id, sku, item_name, category, pool, lbs_per_case, display_order
        FROM prod_skus
        WHERE company_id = ${companyId} AND active = true
        ORDER BY pool, display_order, item_name
      `;

      const entries = await sql`
        SELECT sku_id, entry_date, produced_lbs::float
        FROM prod_daily_entries
        WHERE company_id = ${companyId}
          AND entry_date >= ${days[0]}::date
          AND entry_date <= ${days[7]}::date
      `;

      // Build sku_id -> { date -> produced_lbs } map
      const byDate = new Map();
      entries.forEach(e => {
        const key = (e.entry_date instanceof Date)
          ? e.entry_date.toISOString().split('T')[0]
          : String(e.entry_date).slice(0, 10);
        if (!byDate.has(e.sku_id)) byDate.set(e.sku_id, {});
        byDate.get(e.sku_id)[key] = Number(e.produced_lbs || 0);
      });

      const rows = skus.map(s => {
        const daily = days.map(d => byDate.get(s.id) ? (byDate.get(s.id)[d] || 0) : 0);
        const totalLbs = daily.reduce((a, b) => a + b, 0);
        return {
          sku_id: s.id,
          sku: s.sku,
          item_name: s.item_name,
          category: s.category,
          pool: s.pool,
          daily,
          total_lbs: Number(totalLbs.toFixed(2)),
          total_cases: s.lbs_per_case ? Number((totalLbs / Number(s.lbs_per_case)).toFixed(2)) : null
        };
      });

      return res.json({ ok: true, week_start: weekStart, days, rows });
    }

    // ── POST save_entry ────────────────────────────────────────────────
    // Upsert the produced/shipped cells for one SKU on one date.
    if (req.method === 'POST' && action === 'save_entry') {
      const b = req.body || {};
      const skuId = parseInt(b.sku_id, 10);
      const entryDate = String(b.entry_date || '').trim();
      const produced = b.produced_lbs === '' || b.produced_lbs == null ? 0 : Number(b.produced_lbs);
      const shipped = b.shipped_lbs === '' || b.shipped_lbs == null ? 0 : Number(b.shipped_lbs);
      const notes = b.notes || null;

      if (!skuId || isNaN(skuId)) return res.status(400).json({ error: 'sku_id required' });
      if (!entryDate) return res.status(400).json({ error: 'entry_date required' });
      if (isNaN(produced) || produced < 0) return res.status(400).json({ error: 'produced_lbs must be non-negative' });
      if (isNaN(shipped) || shipped < 0) return res.status(400).json({ error: 'shipped_lbs must be non-negative' });

      // Determine if this is create vs edit (existing row present?)
      const existing = await sql`
        SELECT id FROM prod_daily_entries
        WHERE company_id = ${companyId} AND entry_date = ${entryDate}::date AND sku_id = ${skuId}
      `;
      const isEdit = existing.length > 0;
      if (!perms.canPerform(user, 'production', isEdit ? 'edit' : 'create')) {
        return perms.deny(res, user, 'production', isEdit ? 'edit' : 'create');
      }

      await sql`
        INSERT INTO prod_daily_entries (company_id, entry_date, sku_id, produced_lbs, shipped_lbs, notes, updated_at)
        VALUES (${companyId}, ${entryDate}::date, ${skuId}, ${produced}, ${shipped}, ${notes}, NOW())
        ON CONFLICT (company_id, entry_date, sku_id)
        DO UPDATE SET produced_lbs = ${produced}, shipped_lbs = ${shipped}, notes = ${notes}, updated_at = NOW()
      `;

      await logAudit(sql, req, user, {
        action: 'production.save_entry',
        resource_type: 'entry',
        resource_id: String(skuId) + '@' + entryDate,
        details: { sku_id: skuId, entry_date: entryDate, produced_lbs: produced, shipped_lbs: shipped, updated: isEdit }
      });
      return res.json({ ok: true });
    }

    // ── POST save_adjustment ───────────────────────────────────────────
    if (req.method === 'POST' && action === 'save_adjustment') {
      if (!perms.canPerform(user, 'production', 'edit')) return perms.deny(res, user, 'production', 'edit');
      const b = req.body || {};
      const skuId = parseInt(b.sku_id, 10);
      const entryDate = String(b.entry_date || '').trim();
      const delta = Number(b.delta_lbs);
      const note = b.note || null;
      if (!skuId || isNaN(skuId)) return res.status(400).json({ error: 'sku_id required' });
      if (!entryDate) return res.status(400).json({ error: 'entry_date required' });
      if (isNaN(delta) || delta === 0) return res.status(400).json({ error: 'delta_lbs must be non-zero number' });

      const [row] = await sql`
        INSERT INTO prod_adjustments (company_id, entry_date, sku_id, delta_lbs, note)
        VALUES (${companyId}, ${entryDate}::date, ${skuId}, ${delta}, ${note})
        RETURNING id
      `;
      await logAudit(sql, req, user, {
        action: 'production.save_adjustment',
        resource_type: 'adjustment', resource_id: row.id,
        details: { sku_id: skuId, entry_date: entryDate, delta_lbs: delta, note }
      });
      return res.json({ ok: true, adjustment_id: row.id });
    }

    // ── POST delete_adjustment ─────────────────────────────────────────
    if (req.method === 'POST' && action === 'delete_adjustment') {
      if (!perms.canPerform(user, 'production', 'delete')) return perms.deny(res, user, 'production', 'delete');
      const id = (req.body && req.body.id) || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      // If this adjustment is part of a transfer pair, delete both sides.
      const [existing] = await sql`
        SELECT transfer_pair_id FROM prod_adjustments
        WHERE id = ${id} AND company_id = ${companyId}
      `;
      if (existing && existing.transfer_pair_id) {
        await sql`DELETE FROM prod_adjustments WHERE transfer_pair_id = ${existing.transfer_pair_id} AND company_id = ${companyId}`;
      } else {
        await sql`DELETE FROM prod_adjustments WHERE id = ${id} AND company_id = ${companyId}`;
      }
      await logAudit(sql, req, user, {
        action: 'production.delete_adjustment',
        resource_type: 'adjustment', resource_id: id,
        details: { was_transfer: !!(existing && existing.transfer_pair_id) }
      });
      return res.json({ ok: true });
    }

    // ── POST save_transfer ─────────────────────────────────────────────
    // Cross-pool (or same-pool) transfer between two SKUs. Creates two
    // paired adjustment rows: -lbs on source SKU, +lbs on destination SKU,
    // both carrying the same transfer_pair_id for easy undo.
    if (req.method === 'POST' && action === 'save_transfer') {
      if (!perms.canPerform(user, 'production', 'edit')) return perms.deny(res, user, 'production', 'edit');
      const b = req.body || {};
      const fromSkuId = parseInt(b.from_sku_id, 10);
      const toSkuId = parseInt(b.to_sku_id, 10);
      const entryDate = String(b.entry_date || '').trim();
      const lbs = Number(b.lbs);
      const note = b.note || null;
      if (!fromSkuId || !toSkuId || fromSkuId === toSkuId) return res.status(400).json({ error: 'from_sku_id and to_sku_id required and must differ' });
      if (!entryDate) return res.status(400).json({ error: 'entry_date required' });
      if (isNaN(lbs) || lbs <= 0) return res.status(400).json({ error: 'lbs must be a positive number' });

      const [{ pair_id }] = await sql`SELECT gen_random_uuid() AS pair_id`;
      await sql`
        INSERT INTO prod_adjustments (company_id, entry_date, sku_id, delta_lbs, note, transfer_pair_id)
        VALUES
          (${companyId}, ${entryDate}::date, ${fromSkuId}, ${-lbs}, ${note}, ${pair_id}),
          (${companyId}, ${entryDate}::date, ${toSkuId},   ${lbs},  ${note}, ${pair_id})
      `;
      await logAudit(sql, req, user, {
        action: 'production.save_transfer',
        resource_type: 'transfer', resource_id: pair_id,
        details: { from_sku_id: fromSkuId, to_sku_id: toSkuId, entry_date: entryDate, lbs, note }
      });
      return res.json({ ok: true, pair_id });
    }

    // ── POST save_sku ──────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'save_sku') {
      const b = req.body || {};
      const isEdit = !!b.id;
      if (!perms.canPerform(user, 'production', isEdit ? 'edit' : 'create')) {
        return perms.deny(res, user, 'production', isEdit ? 'edit' : 'create');
      }
      const name = String(b.item_name || '').trim();
      const pool = String(b.pool || '').trim();
      if (!name) return res.status(400).json({ error: 'item_name required' });
      if (!VALID_POOLS.has(pool)) return res.status(400).json({ error: 'invalid pool — must be FREEZER-IQF, ICE PACK, or COOLER' });
      const sku = String(b.sku || '').trim();
      const category = b.category ? String(b.category).trim() : null;
      const lbsPerCase = b.lbs_per_case === '' || b.lbs_per_case == null ? null : Number(b.lbs_per_case);
      const displayOrder = b.display_order == null ? 0 : parseInt(b.display_order, 10);
      const notes = b.notes || null;

      if (isEdit) {
        await sql`UPDATE prod_skus SET
          sku = ${sku}, item_name = ${name}, category = ${category}, pool = ${pool},
          lbs_per_case = ${lbsPerCase}, display_order = ${displayOrder}, notes = ${notes}, updated_at = NOW()
          WHERE id = ${b.id} AND company_id = ${companyId}`;
        await logAudit(sql, req, user, {
          action: 'production.save_sku',
          resource_type: 'sku', resource_id: b.id,
          details: { item_name: name, pool, updated: true }
        });
        return res.json({ ok: true });
      }

      const [created] = await sql`
        INSERT INTO prod_skus (company_id, sku, item_name, category, pool, lbs_per_case, display_order, notes)
        VALUES (${companyId}, ${sku}, ${name}, ${category}, ${pool}, ${lbsPerCase}, ${displayOrder}, ${notes})
        RETURNING id
      `;
      await logAudit(sql, req, user, {
        action: 'production.save_sku',
        resource_type: 'sku', resource_id: created.id,
        details: { item_name: name, pool, updated: false }
      });
      return res.json({ ok: true, id: created.id });
    }

    // ── POST archive_sku ───────────────────────────────────────────────
    if (req.method === 'POST' && action === 'archive_sku') {
      if (!perms.canPerform(user, 'production', 'delete')) return perms.deny(res, user, 'production', 'delete');
      const id = (req.body && req.body.id) || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`UPDATE prod_skus SET active = false, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`;
      await logAudit(sql, req, user, {
        action: 'production.archive_sku',
        resource_type: 'sku', resource_id: id
      });
      return res.json({ ok: true });
    }

    // ── POST seed_skus ─────────────────────────────────────────────────
    // Admin-only. Two jobs in one button press:
    //   1. MIGRATE existing SKUs: strip "15#" / "24# CARTON" / "4 #"
    //      suffixes from item_name and populate lbs_per_case where null.
    //   2. INSERT any SEED_SKUS rows missing from the catalog.
    // Safe to re-run — both steps are idempotent. Existing adjustments +
    // daily entries are never touched (we only UPDATE prod_skus metadata).
    if (req.method === 'POST' && action === 'seed_skus') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

      // ── Step 1: normalize existing SKUs ────────────────────────────
      const existing = await sql`
        SELECT id, pool, item_name, lbs_per_case
        FROM prod_skus
        WHERE company_id = ${companyId}
      `;
      let renamed = 0, caseFilled = 0;
      for (const e of existing) {
        // Strip case-weight suffixes, then enforce "{size} {type}" order
        const parsed = stripCaseWeight(e.item_name);
        const finalName = standardizeNaming(parsed.name);
        const nameChanged = finalName !== e.item_name;
        // Priority for case size: existing (if already set) > parsed from
        // name > pool default (15 for FREEZER-IQF/ICE PACK, null for COOLER).
        const poolDefault = (e.pool === 'FREEZER-IQF' || e.pool === 'ICE PACK') ? 15 : null;
        const newLbs = e.lbs_per_case != null
          ? Number(e.lbs_per_case)
          : (parsed.lbs != null ? parsed.lbs : poolDefault);
        const lbsChanged = (newLbs != null && Number(e.lbs_per_case || 0) !== Number(newLbs));
        if (nameChanged || lbsChanged) {
          await sql`UPDATE prod_skus SET
            item_name = ${finalName},
            lbs_per_case = ${newLbs},
            updated_at = NOW()
            WHERE id = ${e.id}`;
          if (nameChanged) renamed++;
          if (lbsChanged) caseFilled++;
        }
      }

      // Rebuild the existing-name lookup set after renames so step 2's
      // dedupe check is accurate.
      const afterExisting = await sql`
        SELECT pool, LOWER(TRIM(item_name)) AS key FROM prod_skus
        WHERE company_id = ${companyId}
      `;
      const existingSet = new Set(afterExisting.map(e => e.pool + '::' + e.key));

      // ── Step 2: insert missing seed items ──────────────────────────
      let created = 0, skipped = 0;
      let order = 0;
      for (const s of SEED_SKUS) {
        order++;
        const key = s.pool + '::' + s.item.toLowerCase().trim();
        if (existingSet.has(key)) { skipped++; continue; }
        await sql`
          INSERT INTO prod_skus (company_id, sku, item_name, category, pool, lbs_per_case, display_order)
          VALUES (${companyId}, ${s.sku}, ${s.item}, ${s.category}, ${s.pool}, ${s.lbs_per_case}, ${order})
        `;
        existingSet.add(key);
        created++;
      }

      await logAudit(sql, req, user, {
        action: 'production.seed_skus',
        resource_type: 'sku',
        details: { total_seed: SEED_SKUS.length, created, skipped, renamed, case_filled: caseFilled }
      });
      return res.json({
        ok: true,
        created, skipped,
        total_seed: SEED_SKUS.length,
        renamed, case_filled: caseFilled
      });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('[production] error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};

// Exported for testing / weekly-roll-aligned Monday lookup
module.exports.mondayOf = mondayOf;
module.exports.lastSaturdayBefore = lastSaturdayBefore;
