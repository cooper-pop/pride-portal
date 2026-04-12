const {neon}=require('@neondatabase/serverless');
module.exports=async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS')return res.status(200).end();
  const sql=neon(process.env.DATABASE_URL);
  // Ensure table exists
  await sql`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`;
  if(req.method==='GET'){
    const rows=await sql`SELECT key,value FROM app_settings`;
    const out={};
    rows.forEach(function(r){try{out[r.key]=JSON.parse(r.value);}catch(e){out[r.key]=r.value;}});
    return res.json(out);
  }
  if(req.method==='POST'){
    const body=req.body;
    for(const key of Object.keys(body)){
      const val=JSON.stringify(body[key]);
      await sql`INSERT INTO app_settings(key,value,updated_at) VALUES(${key},${val},NOW()) ON CONFLICT(key) DO UPDATE SET value=${val},updated_at=NOW()`;
    }
    return res.json({saved:true});
  }
  return res.status(400).json({error:'Unknown method'});
};