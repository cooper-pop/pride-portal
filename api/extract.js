module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const Anthropic = require('@anthropic-ai/sdk');
const jwt = require('jsonwebtoken');

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('No token');
  return jwt.verify(auth.slice(7), process.env.JWT_SECRET);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let user;
  try { user = verifyToken(req); } catch { return res.status(401).json({ error: 'Unauthorized' }); }

  const { image_base64, media_type } = req.body;
  if (!image_base64) return res.status(400).json({ error: 'Missing image data' });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const isPDF = media_type === 'application/pdf';
    const contentBlock = isPDF
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image_base64 } }
      : { type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image_base64 } };

    const prompt = 'This is a C.A.T.2 Employee Production Report for a catfish processing facility. Extract ALL employee rows and return ONLY a JSON object with no markdown. Use this structure: {"report_date":"YYYY-MM-DD","report_time":"HH:MM","entries":[{"emp_number":"","full_name":"","trim_number":"","total_minutes":0,"incoming_lbs":0,"fillet_lbs":0,"fillet_yield_pct":0,"nugget_lbs":0,"nugget_yield_pct":0,"misccut_lbs":0,"misccut_yield_pct":0,"total_lbs":0,"total_yield_pct":0,"realtime_lbs_per_hour":0,"eighthour_lbs_per_hour":0,"hours_worked":0}],"grand_total":{}}. Extract every employee row. Do NOT include the Grand Total row in entries. Return ONLY compact minified JSON with zero whitespace.';

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }]
    });

    let raw = message.content[0].text.trim();

    // Strip markdown fences if present
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
    }

    // Extract JSON object
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < 0) {
      return res.status(422).json({ error: 'No JSON found in response', preview: raw.substring(0, 200) });
    }
    const jsonStr = raw.substring(start, end + 1);

    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('Parse failed:', jsonStr.substring(0, 300));
      return res.status(422).json({ error: 'Could not parse extracted data: ' + parseErr.message, preview: jsonStr.substring(0, 200) });
    }

    const entries = data.entries || [];
    const avgLph = entries.reduce((s, e) => s + (parseFloat(e.realtime_lbs_per_hour) || 0), 0) / (entries.length || 1);
    const avgMin = entries.reduce((s, e) => s + (parseFloat(e.total_minutes) || 0), 0) / (entries.length || 1);

    const flagged = entries.map(function(entry) {
      const flags = [];
      if ((entry.total_yield_pct || 0) > 95) flags.push({ field: 'total_yield_pct', value: entry.total_yield_pct, message: 'Total yield ' + entry.total_yield_pct + '% exceeds 95% - verify' });
      if ((entry.total_minutes || 0) > avgMin * 1.5) flags.push({ field: 'total_minutes', value: entry.total_minutes, message: 'Minutes ' + entry.total_minutes + ' is 1.5x the shift average - verify' });
      if ((entry.realtime_lbs_per_hour || 0) > 200) flags.push({ field: 'realtime_lbs_per_hour', value: entry.realtime_lbs_per_hour, message: 'Lbs/hr ' + entry.realtime_lbs_per_hour + ' is abnormally high - verify' });
      if ((entry.incoming_lbs || 0) < 200 && (entry.incoming_lbs || 0) > 0) flags.push({ field: 'incoming_lbs', value: entry.incoming_lbs, message: 'Incoming lbs ' + entry.incoming_lbs + ' is very low - verify' });
      if ((entry.realtime_lbs_per_hour || 0) < avgLph * 0.6 && (entry.realtime_lbs_per_hour || 0) > 0) flags.push({ field: 'realtime_lbs_per_hour', value: entry.realtime_lbs_per_hour, message: 'Lbs/hr ' + entry.realtime_lbs_per_hour + ' is below 60% of shift average - potential underperformer' });
      return Object.assign({}, entry, { validation_flags: flags, flagged: flags.length > 0 });
    });

    return res.json({
      report_date: data.report_date,
      report_time: data.report_time,
      grand_total: data.grand_total,
      entries: flagged,
      flag_count: flagged.filter(function(e) { return e.flagged; }).length,
      entry_count: flagged.length
    });

  } catch (err) {
    console.error('Extract error:', err);
    return res.status(500).json({ error: 'Extraction failed: ' + err.message });
  }
};
