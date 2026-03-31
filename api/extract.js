module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const Anthropic = require('@anthropic-ai/sdk');
const jwt = require('jsonwebtoken');

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('No token');
  return jwt.verify(auth.slice(7), process.env.JWT_SECRET);
}

function parseCSV(csv, startRow) {
  const lines = csv.trim().split('\n').filter(l => l.trim() && !l.toLowerCase().includes('grand total') && !l.toLowerCase().startsWith('emp'));
  const entries = [];
  for (const line of lines) {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g,''));
    if (cols.length < 3 || !cols[0]) continue;
    while (cols.length < 16) cols.push('0');
    const emp = cols[0], name = cols[1], code = cols[2] || '';
    if (!name || name.toLowerCase().includes('total') || name.toLowerCase().includes('grand')) continue;
    entries.push({
      emp_number: emp, full_name: name, trim_number: code,
      total_minutes: parseFloat(cols[3])||0,
      incoming_lbs: parseFloat(cols[4])||0,
      fillet_lbs: parseFloat(cols[5])||0,
      fillet_yield_pct: parseFloat(cols[6])||0,
      nugget_lbs: parseFloat(cols[7])||0,
      nugget_yield_pct: parseFloat(cols[8])||0,
      misccut_lbs: parseFloat(cols[9])||0,
      misccut_yield_pct: parseFloat(cols[10])||0,
      total_lbs: parseFloat(cols[11])||0,
      total_yield_pct: parseFloat(cols[12])||0,
      realtime_lbs_per_hour: parseFloat(cols[13])||0,
      eighthour_lbs_per_hour: parseFloat(cols[14])||0,
      hours_worked: parseFloat(cols[15])||0
    });
  }
  return entries;
}

async function extractPass(client, contentBlock, startRow, endRow) {
  const prompt = 'C.A.T.2 catfish trimmer report. Extract employee rows ' + startRow + ' to ' + endRow + ' only. Skip the Grand Total row. Return ONLY CSV with no header, one employee per line: emp_number,full_name,trim_number,minutes,incoming_lbs,fillet_lbs,fillet_pct,nugget_lbs,nugget_pct,misccut_lbs,misccut_pct,total_lbs,total_pct,realtime_lph,eighthour_lph,hours. Numbers only, no units. Return ONLY the CSV data.';
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }]
  });
  const raw = message.content[0].text.trim();
  return { csv: raw, entries: parseCSV(raw, startRow) };
}

function flagEntries(entries) {
  const avgLph = entries.reduce((s,e)=>s+(e.realtime_lbs_per_hour||0),0)/(entries.length||1);
  const avgMin = entries.reduce((s,e)=>s+(e.total_minutes||0),0)/(entries.length||1);
  return entries.map(function(entry) {
    const flags = [];
    if ((entry.total_yield_pct||0)>95) flags.push({field:'total_yield_pct',value:entry.total_yield_pct,message:'Total yield '+entry.total_yield_pct+'% exceeds 95%'});
    if ((entry.total_minutes||0)>avgMin*1.5) flags.push({field:'total_minutes',value:entry.total_minutes,message:'Minutes '+entry.total_minutes+' is 1.5x shift average'});
    if ((entry.realtime_lbs_per_hour||0)>200) flags.push({field:'realtime_lbs_per_hour',value:entry.realtime_lbs_per_hour,message:'Lbs/hr '+entry.realtime_lbs_per_hour+' abnormally high'});
    if ((entry.incoming_lbs||0)<200&&(entry.incoming_lbs||0)>0) flags.push({field:'incoming_lbs',value:entry.incoming_lbs,message:'Incoming lbs '+entry.incoming_lbs+' very low'});
    if ((entry.realtime_lbs_per_hour||0)<avgLph*0.6&&(entry.realtime_lbs_per_hour||0)>0) flags.push({field:'realtime_lbs_per_hour',value:entry.realtime_lbs_per_hour,message:'Below 60% of shift average - potential underperformer'});
    return Object.assign({},entry,{validation_flags:flags,flagged:flags.length>0});
  });
}

async function getReportDate(client, contentBlock) {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 20,
    messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: 'What is the date on this report? Reply with ONLY the date in YYYY-MM-DD format. Nothing else.' }] }]
  });
  const raw = message.content[0].text.trim();
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  let user;
  try { user=verifyToken(req); } catch { return res.status(401).json({error:'Unauthorized'}); }
  const {image_base64,media_type}=req.body;
  if (!image_base64) return res.status(400).json({error:'Missing image data'});
  const client=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY});
  const isPDF=media_type==='application/pdf';
  const contentBlock=isPDF
    ?{type:'document',source:{type:'base64',media_type:'application/pdf',data:image_base64}}
    :{type:'image',source:{type:'base64',media_type:media_type||'image/jpeg',data:image_base64}};
  try {
    // Get date first, then 3 sequential passes of 10 rows each
    const reportDate = await getReportDate(client, contentBlock);
    const pass1 = await extractPass(client, contentBlock, 1, 10);
    const pass2 = await extractPass(client, contentBlock, 11, 20);
    const pass3 = await extractPass(client, contentBlock, 21, 35);
    const seen = new Set();
    const allEntries = [];
    for (const e of [...pass1.entries, ...pass2.entries, ...pass3.entries]) {
      const key = String(e.emp_number||'')+'|'+String(e.full_name||'');
      if (key!=='|' && !seen.has(key)) { seen.add(key); allEntries.push(e); }
    }
    if (!allEntries.length) return res.status(422).json({error:'No entries could be extracted. Check that this is a C.A.T.2 report.'});
    const flagged = flagEntries(allEntries);
    return res.json({report_date:reportDate,entries:flagged,flag_count:flagged.filter(e=>e.flagged).length,entry_count:flagged.length});
  } catch(err) {
    console.error('Extract error:',err);
    return res.status(500).json({error:'Extraction failed: '+err.message});
  }
};
