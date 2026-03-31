module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const Anthropic = require('@anthropic-ai/sdk');
const jwt = require('jsonwebtoken');

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('No token');
  return jwt.verify(auth.slice(7), process.env.JWT_SECRET);
}

async function extractPass(client, contentBlock, startRow, endRow) {
  const prompt = 'C.A.T.2 catfish trimmer report. Extract ONLY rows ' + startRow + ' to ' + endRow + ' (skip Grand Total row). Return ONLY minified JSON no spaces: {"report_date":"YYYY-MM-DD","entries":[{"emp_number":"","full_name":"","trim_number":"","total_minutes":0,"incoming_lbs":0,"fillet_lbs":0,"fillet_yield_pct":0,"nugget_lbs":0,"nugget_yield_pct":0,"misccut_lbs":0,"misccut_yield_pct":0,"total_lbs":0,"total_yield_pct":0,"realtime_lbs_per_hour":0,"eighthour_lbs_per_hour":0,"hours_worked":0}]}';
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }]
  });
  let raw = message.content[0].text.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```[a-z]*\n?/i,'').replace(/\n?```$/,'').trim();
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  if (s < 0 || e < 0) return { report_date: null, entries: [] };
  try { return JSON.parse(raw.substring(s, e + 1)); }
  catch(err) { console.error('Pass ' + startRow + '-' + endRow + ' parse error:', raw.substring(0,100)); return { report_date: null, entries: [] }; }
}

function flagEntries(entries) {
  const avgLph = entries.reduce((s,e) => s+(parseFloat(e.realtime_lbs_per_hour)||0),0)/(entries.length||1);
  const avgMin = entries.reduce((s,e) => s+(parseFloat(e.total_minutes)||0),0)/(entries.length||1);
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
    // 6 passes of 5 rows each, all parallel
    const passes = await Promise.all([
      extractPass(client,contentBlock,1,5),
      extractPass(client,contentBlock,6,10),
      extractPass(client,contentBlock,11,15),
      extractPass(client,contentBlock,16,20),
      extractPass(client,contentBlock,21,25),
      extractPass(client,contentBlock,26,35)
    ]);
    const reportDate=passes.map(p=>p.report_date).find(d=>d);
    const seen=new Set();
    const allEntries=[];
    for (const pass of passes) {
      for (const e of (pass.entries||[])) {
        const key=String(e.emp_number||'')+'|'+String(e.full_name||'');
        if (key!=='|'&&!seen.has(key)) { seen.add(key); allEntries.push(e); }
      }
    }
    if (!allEntries.length) return res.status(422).json({error:'No entries extracted from document'});
    const flagged=flagEntries(allEntries);
    return res.json({report_date:reportDate,entries:flagged,flag_count:flagged.filter(function(e){return e.flagged;}).length,entry_count:flagged.length});
  } catch(err) {
    console.error('Extract error:',err);
    return res.status(500).json({error:'Extraction failed: '+err.message});
  }
};
