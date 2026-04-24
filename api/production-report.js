// api/production-report.js
// Production Report / Master Dashboard — Phase C
//
// Read-only widget that stitches together the two data producers:
//
//   Live Fish Intake (live_haul_loads)   → raw fish received, size bands,
//                                          deductions, dock price, payables
//   Production Log   (prod_daily_entries  → finished product per SKU per day
//                      + prod_adjustments
//                      + prod_skus)
//
// Three actions, all GET:
//   get_summary  — hero metrics for a period (intake + production + yield)
//   get_farmers  — per-farmer scorecard for the same period
//   get_trends   — daily time-series for charts (intake lbs, cases, yield)
//
// Notes on units:
//   - prod_daily_entries.produced_lbs / prod_adjustments.delta_lbs are
//     CASE counts (column name is legacy — see production.js comments).
//     To convert to finished pounds: multiply by prod_skus.lbs_per_case.
//   - live_haul_loads.net_lbs / payable_lbs / deduction_lbs are real pounds.
//
// Yield = (finished pounds produced) / (net pounds of live fish received).
// Meaningful at weekly+ grain (fish received Monday may be processed
// Tuesday-Wednesday). The UI warns on daily yield.

const { neon } = require('@neondatabase/serverless');
const perms = require('./_permissions');

// Midpoints for "average fish size" weighted-average calculation on the
// farmer scorecard. The 8+ band is bounded at 9 lbs since nobody brings
// fish north of ~12 lbs to the plant in practice.
const SIZE_MIDPOINTS = {
  size_0_4_lbs: 2,
  size_4_6_lbs: 5,     // 4.01-5.99
  size_6_8_lbs: 7,     // 6-7.99
  size_8_plus_lbs: 9
};

// Parse/validate YYYY-MM-DD. Returns null if invalid.
function cleanDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = perms.requireAuth(req, res);
  if (!user) return;
  if (!perms.canPerform(user, 'productionreport', 'view')) {
    return perms.deny(res, user, 'productionreport', 'view');
  }
  const companyId = String(user.company_id);

  const url = new URL(req.url, 'http://x');
  const action = (req.query && req.query.action) || url.searchParams.get('action') || '';
  const start = cleanDate(url.searchParams.get('start'));
  const end = cleanDate(url.searchParams.get('end'));
  if (!start || !end) {
    return res.status(400).json({ error: 'start and end (YYYY-MM-DD) required' });
  }
  if (start > end) {
    return res.status(400).json({ error: 'start must be on or before end' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // ── GET get_summary ─────────────────────────────────────────────────
    // Hero metrics for the period:
    //   { intake: {...}, production: {...}, yield: {...}, period: {...} }
    if (action === 'get_summary') {
      const intakeRows = await sql`
        SELECT
          COUNT(*)::int                              AS load_count,
          COALESCE(SUM(net_lbs), 0)::float           AS net_lbs,
          COALESCE(SUM(gross_lbs), 0)::float         AS gross_lbs,
          COALESCE(SUM(deduction_lbs), 0)::float     AS deduction_lbs,
          COALESCE(SUM(payable_lbs), 0)::float       AS payable_lbs,
          COALESCE(SUM(payable_total), 0)::float     AS payable_total,
          COALESCE(SUM(size_0_4_lbs), 0)::float      AS size_0_4_lbs,
          COALESCE(SUM(size_4_6_lbs), 0)::float      AS size_4_6_lbs,
          COALESCE(SUM(size_6_8_lbs), 0)::float      AS size_6_8_lbs,
          COALESCE(SUM(size_8_plus_lbs), 0)::float   AS size_8_plus_lbs
        FROM live_haul_loads
        WHERE company_id = ${companyId}
          AND day_date >= ${start}::date
          AND day_date <= ${end}::date
      `;
      const intake = intakeRows[0] || {};

      // Average dock price per lb, weighted by payable lbs (not a flat mean —
      // a $1 load of 1 lb shouldn't drag down a $1.35 load of 20,000 lbs).
      intake.avg_price_per_lb = (intake.payable_lbs > 0 && intake.payable_total > 0)
        ? (intake.payable_total / intake.payable_lbs)
        : null;

      // ── Production — cases + finished lbs per pool ──
      // Cases = produced_lbs (legacy name). Finished lbs = cases * lbs_per_case.
      const prodRows = await sql`
        SELECT
          s.pool                                       AS pool,
          COALESCE(SUM(e.produced_lbs), 0)::float      AS cases_produced,
          COALESCE(SUM(e.shipped_lbs), 0)::float       AS cases_shipped,
          COALESCE(SUM(e.produced_lbs * COALESCE(s.lbs_per_case, 15)), 0)::float
                                                       AS lbs_produced,
          COALESCE(SUM(e.shipped_lbs * COALESCE(s.lbs_per_case, 15)), 0)::float
                                                       AS lbs_shipped
        FROM prod_daily_entries e
        JOIN prod_skus s ON s.id = e.sku_id
        WHERE e.company_id = ${companyId}
          AND e.entry_date >= ${start}::date
          AND e.entry_date <= ${end}::date
        GROUP BY s.pool
        ORDER BY s.pool
      `;
      const productionTotals = {
        cases_produced: 0,
        cases_shipped: 0,
        lbs_produced: 0,
        lbs_shipped: 0,
        by_pool: prodRows
      };
      prodRows.forEach(p => {
        productionTotals.cases_produced += p.cases_produced || 0;
        productionTotals.cases_shipped += p.cases_shipped || 0;
        productionTotals.lbs_produced += p.lbs_produced || 0;
        productionTotals.lbs_shipped += p.lbs_shipped || 0;
      });

      // ── Yield — only computable when both sides have data ──
      // Guard against divide-by-zero, but also report both numerator and
      // denominator so the UI can show "— insufficient data" when either
      // is zero.
      const yield_pct = (intake.net_lbs > 0 && productionTotals.lbs_produced > 0)
        ? (productionTotals.lbs_produced / intake.net_lbs) * 100
        : null;

      return res.json({
        ok: true,
        period: { start, end },
        intake,
        production: productionTotals,
        yield: {
          pct: yield_pct,
          numerator_lbs: productionTotals.lbs_produced,
          denominator_lbs: intake.net_lbs
        }
      });
    }

    // ── GET get_farmers ────────────────────────────────────────────────
    // One row per farmer with at least one load in the period. Includes
    // deleted farmers (active=false) so historical reports stay complete.
    if (action === 'get_farmers') {
      const rows = await sql`
        SELECT
          f.id                                          AS farmer_id,
          f.name                                        AS farmer_name,
          f.color                                       AS color,
          f.active                                      AS active,
          COUNT(l.id)::int                              AS load_count,
          COALESCE(SUM(l.net_lbs), 0)::float            AS net_lbs,
          COALESCE(SUM(l.gross_lbs), 0)::float          AS gross_lbs,
          COALESCE(SUM(l.deduction_lbs), 0)::float      AS deduction_lbs,
          COALESCE(SUM(l.payable_lbs), 0)::float        AS payable_lbs,
          COALESCE(SUM(l.payable_total), 0)::float      AS payable_total,
          COALESCE(SUM(l.size_0_4_lbs), 0)::float       AS size_0_4_lbs,
          COALESCE(SUM(l.size_4_6_lbs), 0)::float       AS size_4_6_lbs,
          COALESCE(SUM(l.size_6_8_lbs), 0)::float       AS size_6_8_lbs,
          COALESCE(SUM(l.size_8_plus_lbs), 0)::float    AS size_8_plus_lbs
        FROM live_haul_farmers f
        JOIN live_haul_loads l ON l.farmer_id = f.id
        WHERE f.company_id = ${companyId}
          AND l.company_id = ${companyId}
          AND l.day_date >= ${start}::date
          AND l.day_date <= ${end}::date
        GROUP BY f.id, f.name, f.color, f.active
        ORDER BY net_lbs DESC, f.name
      `;

      // Compute derived metrics per row in JS (cleaner than nesting in SQL).
      const farmers = rows.map(r => {
        const sizeSum = (r.size_0_4_lbs || 0) + (r.size_4_6_lbs || 0)
          + (r.size_6_8_lbs || 0) + (r.size_8_plus_lbs || 0);
        // Weighted avg fish size — only meaningful when bands are filled in.
        let avgFishSize = null;
        if (sizeSum > 0) {
          avgFishSize = (
            (r.size_0_4_lbs || 0) * SIZE_MIDPOINTS.size_0_4_lbs
            + (r.size_4_6_lbs || 0) * SIZE_MIDPOINTS.size_4_6_lbs
            + (r.size_6_8_lbs || 0) * SIZE_MIDPOINTS.size_6_8_lbs
            + (r.size_8_plus_lbs || 0) * SIZE_MIDPOINTS.size_8_plus_lbs
          ) / sizeSum;
        }
        return {
          ...r,
          avg_lbs_per_load: r.load_count > 0 ? r.net_lbs / r.load_count : null,
          avg_price_per_lb: (r.payable_lbs > 0 && r.payable_total > 0)
            ? r.payable_total / r.payable_lbs : null,
          deduction_pct: r.gross_lbs > 0
            ? (r.deduction_lbs / r.gross_lbs) * 100 : null,
          avg_fish_size_lbs: avgFishSize,
          size_graded_lbs: sizeSum
        };
      });

      return res.json({ ok: true, period: { start, end }, farmers });
    }

    // ── GET get_trends ──────────────────────────────────────────────────
    // Daily time-series, aligned so the frontend can plot intake + production
    // on the same X axis without re-bucketing.
    //
    // Returns one dense array per metric with the same length as the date
    // range (inclusive). Gaps are filled with 0 so charts don't draw
    // phantom lines between non-adjacent days.
    if (action === 'get_trends') {
      // Build day list up front
      const days = [];
      {
        const s = new Date(start + 'T00:00:00');
        const e = new Date(end + 'T00:00:00');
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          days.push(d.toISOString().split('T')[0]);
        }
      }
      // Cap to 370 days — larger ranges should use weekly rollup (future).
      if (days.length > 370) {
        return res.status(400).json({ error: 'Range too large (max 370 days). Narrow the period.' });
      }

      const intakeDaily = await sql`
        SELECT
          day_date::text                              AS d,
          COALESCE(SUM(net_lbs), 0)::float            AS net_lbs,
          COALESCE(SUM(deduction_lbs), 0)::float      AS deduction_lbs,
          COALESCE(SUM(payable_total), 0)::float      AS payable_total,
          COUNT(*)::int                               AS load_count
        FROM live_haul_loads
        WHERE company_id = ${companyId}
          AND day_date >= ${start}::date
          AND day_date <= ${end}::date
        GROUP BY day_date
        ORDER BY day_date
      `;
      const prodDaily = await sql`
        SELECT
          e.entry_date::text                                         AS d,
          COALESCE(SUM(e.produced_lbs), 0)::float                    AS cases_produced,
          COALESCE(SUM(e.shipped_lbs), 0)::float                     AS cases_shipped,
          COALESCE(SUM(e.produced_lbs * COALESCE(s.lbs_per_case, 15)), 0)::float
                                                                     AS lbs_produced,
          COALESCE(SUM(e.shipped_lbs * COALESCE(s.lbs_per_case, 15)), 0)::float
                                                                     AS lbs_shipped
        FROM prod_daily_entries e
        JOIN prod_skus s ON s.id = e.sku_id
        WHERE e.company_id = ${companyId}
          AND e.entry_date >= ${start}::date
          AND e.entry_date <= ${end}::date
        GROUP BY e.entry_date
        ORDER BY e.entry_date
      `;

      // Index by date so we can walk the days array once
      const intakeByDay = {};
      intakeDaily.forEach(r => { intakeByDay[r.d] = r; });
      const prodByDay = {};
      prodDaily.forEach(r => { prodByDay[r.d] = r; });

      const labels = days;
      const intake_net_lbs = [];
      const intake_deductions = [];
      const intake_paid = [];
      const intake_load_count = [];
      const prod_cases = [];
      const prod_lbs = [];
      const prod_shipped_lbs = [];

      days.forEach(d => {
        const ix = intakeByDay[d] || {};
        const px = prodByDay[d] || {};
        intake_net_lbs.push(ix.net_lbs || 0);
        intake_deductions.push(ix.deduction_lbs || 0);
        intake_paid.push(ix.payable_total || 0);
        intake_load_count.push(ix.load_count || 0);
        prod_cases.push(px.cases_produced || 0);
        prod_lbs.push(px.lbs_produced || 0);
        prod_shipped_lbs.push(px.lbs_shipped || 0);
      });

      return res.json({
        ok: true,
        period: { start, end },
        labels,
        series: {
          intake_net_lbs,
          intake_deductions,
          intake_paid,
          intake_load_count,
          prod_cases,
          prod_lbs,
          prod_shipped_lbs
        }
      });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('[production-report] error', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
