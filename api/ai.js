const { neon } = require('@neondatabase/serverless');
const Anthropic = require('@anthropic-ai/sdk');
const perms = require('./_permissions');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // This endpoint serves two distinct use cases:
  //   1. AI Analysis widget (text-only queries) — manager+ only
  //   2. Parts invoice OCR (image present) — supervisors can use it (parts.create)
  // Gate on the right widget based on whether an image is attached.
  const user = perms.requireAuth(req, res);
  if (!user) return;
  const hasImage = !!(req.body && req.body.image);
  if (hasImage) {
    if (!perms.canPerform(user, 'parts', 'create')) return perms.deny(res, user, 'parts', 'create');
  } else {
    if (!perms.canPerform(user, 'ai', 'view')) return perms.deny(res, user, 'ai', 'view');
  }

  const { query, image, image_mime } = req.body;
  if (!query && !image) return res.status(400).json({ error: 'Missing query or image' });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Image scan path — skip DB queries and analyst prompt. This endpoint is also
  // used for invoice OCR; loading 300 yield + 300 injection + 200 trimmer rows
  // for a scan both wastes tokens and can push the request past Anthropic's
  // context limits on large images.
  if (image) {
    const isPdf = image_mime === 'application/pdf';
    const scanPrompt = query || 'Extract invoice data as JSON only (no markdown, no commentary): {"vendor":"","invoice_number":"","date":"YYYY-MM-DD","line_items":[{"part_number":"","description":"","qty":0,"cost":0.00}]}. part_number is the catalog/SKU/item code if visible (empty string if not shown). description is the item name. qty is quantity. cost is PRICE PER UNIT, not the line total. Skip shipping, tax, and subtotal rows.';
    const content = isPdf
      ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image } }, { type: 'text', text: scanPrompt }]
      : [{ type: 'image', source: { type: 'base64', media_type: image_mime || 'image/jpeg', data: image } }, { type: 'text', text: scanPrompt }];
    try {
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content }]
      });
      return res.json({ response: msg.content[0].text });
    } catch (err) {
      console.error('AI scan error:', err);
      return res.status(500).json({ error: 'Scan failed: ' + err.message });
    }
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    const [yieldRecords, injectionRecords, trimmerData] = await Promise.all([
      sql`
        SELECT yr.record_date, yr.line, yr.live_weight_lbs, yr.dressed_weight_lbs,
               yr.fillet_weight_lbs, yr.trim_weight_lbs, yr.yield_pct, yr.notes,
               u.full_name as recorded_by
        FROM yield_records yr JOIN users u ON u.id = yr.user_id
        WHERE yr.company_id = ${user.company_id}
        ORDER BY yr.record_date DESC LIMIT 300
      `,
      sql`
        SELECT ir.record_date, ir.shift, ir.category, ir.item, ir.batch_num,
               ir.pre_injection_lbs, ir.post_injection_lbs, ir.brine_pct,
               ir.total_pct, ir.total_lbs, ir.batch_data, ir.notes,
               u.full_name as recorded_by
        FROM injection_records ir JOIN users u ON u.id = ir.user_id
        WHERE ir.company_id = ${user.company_id}
        ORDER BY ir.record_date DESC LIMIT 300
      `,
      sql`
        SELECT tr.report_date, tr.shift,
               u.full_name as recorded_by,
               json_agg(
                 json_build_object(
                   'emp_number', te.emp_number,
                   'full_name', te.full_name,
                   'trim_number', te.trim_number,
                   'minutes_worked', te.minutes_worked,
                   'incoming_lbs', te.incoming_lbs,
                   'fillet_lbs', te.fillet_lbs,
                   'nugget_lbs', te.nugget_lbs,
                   'misccut_lbs', te.misccut_lbs,
                   'lbs_per_hour', te.realtime_lbs_per_hour
                 ) ORDER BY te.realtime_lbs_per_hour DESC NULLS LAST
               ) FILTER (WHERE te.id IS NOT NULL) as entries
        FROM trimmer_reports tr
        JOIN users u ON u.id = tr.user_id
        LEFT JOIN trimmer_entries te ON te.report_id = tr.id
        WHERE tr.company_id = ${user.company_id}
        GROUP BY tr.id, tr.report_date, tr.shift, u.full_name
        ORDER BY tr.report_date DESC LIMIT 200
      `
    ]);

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const systemPrompt = `You are an AI performance analyst for ${user.company_name}, a catfish processing facility.
Today's date: ${today}.
Your role: analyze processing data, identify trends, flag underperformers, rank employees, and provide clear actionable insights.

When answering:
- Use specific numbers, names, and dates from the data
- For employee rankings: rank best to worst with stats (lbs/hr, yield %, etc.)
- For trends: reference specific date ranges and direction of change
- For underperformers: define what threshold you're using and back it up with data
- Format responses clearly with bullet points or tables where helpful
- Be direct and data-driven, not generic

=== YIELD DATA (${yieldRecords.length} records) ===
${JSON.stringify(yieldRecords)}

=== INJECTION/BRINE DATA (${injectionRecords.length} records) ===
${JSON.stringify(injectionRecords)}

=== TRIMMER DATA (${trimmerData.length} shift reports) ===
${JSON.stringify(trimmerData)}`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: query }]
    });

    return res.json({ response: message.content[0].text });
  } catch (err) {
    console.error('AI error:', err);
    return res.status(500).json({ error: 'AI error: ' + err.message });
  }
};
