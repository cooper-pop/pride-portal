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
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          (media_type === 'application/pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image_base64 } }
            : { type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image_base64 } }
          ),
          {
            type: 'text',
            text: `This is a C.A.T.2 Employee Production Report Summary for a catfish processing facility. Extract ALL data and return ONLY valid JSON with no markdown or explanation.\n\nReturn this exact structure:\n{\n  "report_date": "YYYY-MM-DD",\n  "report_time": "HH:MM",\n  "entries": [\n    {\n      "emp_number": "string",\n      "full_name": "string",\n      "trim_number": "string",\n      "total_minutes": number,\n      "incoming_lbs": number,\n      "fillet_lbs": number,\n      "fillet_yield_pct": number,\n      "nugget_lbs": number,\n      "nugget_yield_pct": number,\n      "misccut_lbs": number,\n      "misccut_yield_pct": number,\n      "total_lbs": number,\n      "total_yield_pct": number,\n      "realtime_lbs_per_hour": number,\n      "eighthour_lbs_per_hour": number,\n      "hours_worked": number\n    }\n  ],\n  "grand_total": {\n    "total_minutes": number,\n    "incoming_lbs": number,\n    "fillet_lbs": number,\n    "fillet_yield_pct": number,\n    "nugget_lbs": number,\n    "nugget_yield_pct": number,\n    "misccut_lbs": number,\n    "misccut_yield_pct": number,\n    "total_lbs": number,\n    "total_yield_pct": number,\n    "realtime_lbs_per_hour": number,\n    "eighthour_lbs_per_hour": number,\n    "total_hours": number\n  }\n}\n\nRules: Extract every employee row. Use null for blank fields. All numbers as numbers. Do NOT include Grand Total in entries array. Return ONLY the JSON.`
          }
        ]
      }]
    });

    const raw = message.content[0].text;
    // Strip markdown fences robustly
    let jsonStr = raw.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/,'').trim();
    }
    // Find the outermost JSON object
    const s = jsonStr.indexOf('{'), e = jsonStr.lastIndexOf('}');
    if (s >= 0 && e > s) jsonStr = jsonStr.substring(s, e + 1);
    let data;
    try { data = JSON.parse(jsonStr); }
    catch(parseErr) {
      console.error('Parse failed:', jsonStr.substring(0, 200));
      return res.status(422).json({ error: 'Could not parse extracted data: ' + parseErr.message, preview: jsonStr.substring(0, 200) });
    });
    }

    const entries = data.entries || [];
    const shiftAvgLbsHr = entries.reduce((s, e) => s + (e.realtime_lbs_per_hour || 0), 0) / (entries.length || 1);
    const shiftAvgMinutes = entries.reduce((s, e) => s + (e.total_minutes || 0), 0) / (entries.length || 1);

    const flagged = entries.map(entry => {
      const flags = [];
      if ((entry.total_yield_pct || 0) > 95) flags.push({ field: 'total_yield_pct', value: entry.total_yield_pct, message: `Total yield ${entry.total_yield_pct}% exceeds 95% â verify` });
      if ((entry.total_minutes || 0) > shiftAvgMinutes * 1.5) flags.push({ field: 'total_minutes', value: entry.total_minutes, message: `Minutes ${entry.total_minutes} is 1.5x the shift average (${Math.round(shiftAvgMinutes)}) â verify` });
      if ((entry.realtime_lbs_per_hour || 0) > 200) flags.push({ field: 'realtime_lbs_per_hour', value: entry.realtime_lbs_per_hour, message: `Lbs/hr ${entry.realtime_lbs_per_hour} is abnormally high â verify` });
      if ((entry.incoming_lbs || 0) < 200 && (entry.incoming_lbs || 0) > 0) flags.push({ field: 'incoming_lbs', value: entry.incoming_lbs, message: `Incoming lbs ${entry.incoming_lbs} is very low â verify` });
      if ((entry.realtime_lbs_per_hour || 0) < shiftAvgLbsHr * 0.6 && (entry.realtime_lbs_per_hour || 0) > 0) flags.push({ field: 'realtime_lbs_per_hour', value: entry.realtime_lbs_per_hour, message: `Lbs/hr ${entry.realtime_lbs_per_hour} is below 60% of shift average (${Math.round(shiftAvgLbsHr)}) â potential underperformer` });
      return { ...entry, validation_flags: flags, flagged: flags.length > 0 };
    });

    return res.json({ report_date: data.report_date, report_time: data.report_time, grand_total: data.grand_total, entries: flagged, flag_count: flagged.filter(e => e.flagged).length, entry_count: flagged.length });
  } catch (err) {
    console.error('Extract error:', err);
    return res.status(500).json({ error: 'Extraction failed: ' + err.message });
  }
};
