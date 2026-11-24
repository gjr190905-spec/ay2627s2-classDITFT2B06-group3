const pool=require('../src/models/db');
(async()=>{
  const required={
    users:['id','email','display_name','phone','role','stall_id','is_active','password_hash'],
    sessions:['user_id','token_hash'],
    stalls:['id','name'],
    vendor_weekly_order_facts:['stall_id','created_at','order_status','total_amount'],
  };
  const {rows}=await pool.query(`SELECT table_name,column_name,data_type
    FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=ANY($1::text[])`,[Object.keys(required)]);
  const by=new Map(); for(const r of rows){if(!by.has(r.table_name))by.set(r.table_name,new Map());by.get(r.table_name).set(r.column_name,r.data_type);}
  let bad=false;
  for(const [table,columns] of Object.entries(required)){
    const missing=columns.filter(name=>!by.get(table)?.has(name));
    console.log(table+': '+(missing.length?'MISSING '+missing.join(', '):'required columns found'));
    if(missing.length)bad=true;
  }
  const {rows:tables}=await pool.query(`SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[])`,[['users','sessions','stalls','orders','vendor_weekly_order_facts']]);
  const kinds=new Map(tables.map(r=>[r.relname,r.relkind]));
  if(!['r','p'].includes(kinds.get('users'))){console.error('users must be an editable physical table (not a read-only view).');bad=true;}
  if(!['r','p'].includes(kinds.get('orders'))){console.error('orders must be an accessible physical table.');bad=true;}
  if(kinds.get('vendor_weekly_order_facts')!=='v'){console.error('vendor_weekly_order_facts must be a view created by the migration.');bad=true;}
  const statusType=by.get('users')?.get('is_active');
  if(statusType && !['integer','smallint','bigint'].includes(statusType)){console.error('users.is_active is not integer; update the profile SQL accordingly.');bad=true;}
  if(bad)process.exitCode=1;
  else console.log('PASS: expected profile and weekly stats tables/columns found; no data was changed.');
})().catch(e=>{console.error('Schema preflight failed:',e.message);process.exitCode=1;}).finally(()=>pool.end());
