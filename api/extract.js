module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const Anthropic = require('@anthropic-ai/sdk');
const jwt = require('jsonwebtoken');

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('No token');
  return jwt.verify(auth.slice(7), process.env.JWT_SECRET);
}

function parseCSV(csv) {
  const lines = csv.trim().split('\n').filter(l => l.trim() && !l.toLowerCase().includes('grand total') && !l.toLowerCase().startsWith('emp'));
  const entries = [];
  for (const line of lines) {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g,''));
    if (cols.length < 3 || !cols[0] || !cols[1]) continue;
    while (cols.length < 16) cols.push('0');
    const name = cols[1];
    if (name.toLowerCase().includes('total') || name.toLowerCase().includes('grand')) continue;
    entries.push({
      emp_number: cols[0], full_name: name, trim_number: cols[2]||'',
      total_minutes: parseFloat(cols[3])||0, incoming_lbs: parseFloat(cols[4])||0,
      fillet_lbs: parseFloat(cols[5])||0, fillet_yield_pct: parseFloat(cols[6])||0,
      nugget_lbs: parseFloat(cols[7])||0, nugget_yield_pct: parseFloat(cols[8])||0,
      misccut_lbs: parseFloat(cols[9])||0, misccut_yield_pct: parseFloat(cols[10])||0,
      total_lbs: parseFloat(cols[11])||0, total_yield_pct: parseFloat(cols[12])||0,
      realtime_lbs_per_hour: parseFloat(cols[13])||0, eighthour_lbs_per_hour: parseFloat(cols[14])||0,
      hours_worked: parseFloat(cols[15])||0
    });
  }
  return entries;
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
    if ((entry.realtime_lbs_per_hour||0)<avgLph*0.6&&(entry.realtime_lbs_per_hour||0)>0) flags.push({field:'realtime_lbs_per_hour',value:entry.realtime_lbs_per_hour,message:'Below 60% of shift average'});
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

    const prompt = `EMPLOYEE ROSTER - CRITICAL: When you read an employee number, use EXACTLY this name. Do not guess or vary spelling.\n1242: Josefina Rosales | 1307: Lizeth Zarate | 1313: Griselda Sanchez | 1318: Soledad Garcia | 1457: Teresa Cruz | 1683: Lolita Gober | 1883: Lolita Gober | 1914: Cedric Berry | 1982: Fatima Granades | 2007: Yessica Hernandez | 2008: Maria Alvarado | 2013: Armida Miramontes | 2416: Dolores Hernandez | 2523: Samanta Martinez | 2534: Cielo Gonzalez | 2560: Raquel Monroy | 2632: Dennise Elias | 2903: Elsa Galdamez | 3892: Maximina Rodriguez | 4363: Patrice Williams | 4789: Telma Galdamez | 5246: Adriana Zuniga | 5266: Keesha Williams | 5744: Phyllis Sturdivant | 6973: Erendira Ortega | 7008: Nohemi Sanchez | 7336: Charles Brown | 7387: Lucy Allen | 7434: Reyna Galdamez | 7624: Patrica Starks | 7854: Judith Rico | 8354: Karla Gonzales | 8531: Isabel Garcia | 9067: Roselyn Mateo | 9805: Latasha Craig\nIf an employee number matches one above, use that EXACT name regardless of what is written on the form. Only use a name not on this list if the employee number is not listed above.\n\nThis is a C.A.T.2 Employee Production Report for a catfish processing facility. Extract ALL employee rows (skip Grand Total row only). Return ONLY CSV data with no header row, one employee per line:\nemp_number,full_name,trim_number,minutes,incoming_lbs,fillet_lbs,fillet_yield_pct,nugget_lbs,nugget_yield_pct,misccut_lbs,misccut_yield_pct,total_yield_pct,realtime_lbs_per_hour,eighthour_lbs_per_hour\n\nCRITICAL DIGIT ACCURACY - numbers are the most important part of this form. Pay close attention to handwritten digits that look similar:\n- 6 vs 8: look at whether the top is open (6) or closed (8). A 6 has an open loop at the top. An 8 has two closed loops.\n- 0 vs 8: a 0 is a single oval, an 8 has two stacked loops.\n- 1 vs 7: a 7 has a horizontal crossbar at the top.\n- 3 vs 8: an 8 is fully closed on both loops, a 3 is open on the left.\n- 5 vs 6: a 5 has a flat top, a 6 curves all the way around.\nWhen in doubt between 6 and 8, look at overall context - catfish trimmer incoming lbs typically range 200-1500, fillet 100-900. If a value seems implausible, re-examine the digit.\nReturn ONLY CSV data with no header row, one employee per line:\`;



  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      messages: [{ role:'user', content:[contentBlock,{type:'text',text:prompt}] }]
    });

    const raw = message.content[0].text.trim();
    const entries = parseCSV(raw);

    if (!entries.length) return res.status(422).json({error:'No entries extracted. Verify this is a C.A.T.2 report.', raw: raw.substring(0,200)});

    // Get report date from first line of raw or use a second quick call
    let reportDate = null;
    const dateMatch = raw.match(/20dd-d{2}-d{2}/);
    if (dateMatch) reportDate = dateMatch[0];

    // Quick date extraction if not found in CSV
    if (!reportDate) {
      const dateMsg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 20,
        messages: [{ role:'user', content:[contentBlock,{type:'text',text:'What is the date on this report? Reply with ONLY YYYY-MM-DD format.'}] }]
      });
      const dm = dateMsg.content[0].text.trim().match(/d{4}-d{2}-d{2}/);
      if (dm) reportDate = dm[0];
    }

    const flagged = flagEntries(entries);
    return res.json({report_date:reportDate,entries:flagged,flag_count:flagged.filter(e=>e.flagged).length,entry_count:flagged.length});

  } catch(err) {
    console.error('Extract error:',err);
    return res.status(500).json({error:'Extraction failed: '+err.message});
  }
};
