import { neon } from '@neondatabase/serverless';
export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);
  const result = await sql`
    UPDATE trimmer_entries 
    SET emp_number = '1883'
    WHERE id = 'd8f0d856-b614-4e46-b600-e1f0b7215b00'
    AND full_name ILIKE '%gober%'
    AND emp_number = '1683'
    RETURNING id, full_name, emp_number
  `;
  return res.json({ fixed: result });
}