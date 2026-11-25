'use strict';
const crypto = require('node:crypto');
const pool = require('./db');
function problem(status, message) { const e = new Error(message); e.status = status; return e; }
function validId(x) { const n = Number(x); return Number.isSafeInteger(n) && n > 0 ? n : null; }
function isoOf(value) { if(typeof value!=='string'||value.length>100)return null;const v=value.trim();return Number.isFinite(Date.parse(v))?v:null; }
const MAX_LINES = 30, MAX_QTY = 20;
function parseBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw problem(400,'Invalid checkout request.');
  const stallId = validId(body.stallId), pickupAt = isoOf(body.pickupAt);
  if (!stallId || !pickupAt) throw problem(400,'Select a valid stall and pickup time.');
  if (Date.parse(pickupAt) <= Date.now()) throw problem(409,'That pickup time has passed.');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > MAX_LINES) throw problem(400,'Choose 1 to 30 menu items.');
  if (body.loyaltyRewardId != null || body.promoVoucherId != null) throw problem(409,'Vouchers and rewards cannot be applied until server-side verification is ready.');
  const quantities = new Map();
  for (const line of body.items) {
    const itemId = validId(line?.menuItemId);
    if (!itemId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QTY) throw problem(400,'Invalid menu item or quantity.');
    quantities.set(itemId, (quantities.get(itemId)||0)+line.quantity);
    if (quantities.get(itemId)>MAX_QTY) throw problem(400,'Maximum 20 per menu item.');
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes.length>250) throw problem(400,'Order notes must be at most 250 characters.');
  return {stallId,pickupAt,items:[...quantities].map(([menuItemId,quantity])=>({menuItemId,quantity})),notes};
}
async function stalls(stallId) {
  const args=[], where=stallId?'WHERE s.id=$1':'';
  if (stallId) args.push(stallId);
  const {rows}=await pool.query(`SELECT s.id,s.name,s.cuisine,s.description,s.is_open,s.accent,s.image_path,
    f.name AS food_court_name FROM stalls s LEFT JOIN food_courts f ON f.id=s.food_court_id
    ${where} ORDER BY s.name`,args);
  return rows.map(r=>({id:Number(r.id),name:r.name,cuisine:r.cuisine,description:r.description,
    isOpen:Number(r.is_open)===1,foodCourtName:r.food_court_name,accent:r.accent,image_path:r.image_path}));
}
async function menu(stallId) {
  const {rows}=await pool.query(`SELECT id,stall_id,name,description,category,price_cents,is_available,image_path,is_featured
    FROM menu_items WHERE stall_id=$1 ORDER BY name`,[stallId]);
  return rows.map(r=>({id:Number(r.id),stallId:Number(r.stall_id),name:r.name,description:r.description,
    category:r.category,priceCents:r.price_cents,isAvailable:Number(r.is_available)===1,image_path:r.image_path,isFeatured:Number(r.is_featured)===1}));
}
async function windows(stallId) {
  const {rows}=await pool.query(`SELECT p.pickup_at,s.capacity_per_slot,
    (SELECT count(*)::integer FROM orders o WHERE o.stall_id=p.stall_id AND o.pickup_at=p.pickup_at AND o.status<>'CANCELLED') AS booked
    FROM pickup_windows p JOIN stalls s ON s.id=p.stall_id
    WHERE p.stall_id=$1 AND s.is_open=1 AND p.pickup_at::timestamptz>NOW()
    ORDER BY p.pickup_at::timestamptz LIMIT 100`,[stallId]);
  return rows.map(r=>({startTime:r.pickup_at,spacesLeft:Math.max(0,r.capacity_per_slot-r.booked),isFull:r.booked>=r.capacity_per_slot}));
}
async function orderRows(customerId, orderId) {
  const args=[customerId], extra=orderId?' AND o.id=$2':'';
  if (orderId) args.push(orderId);
  const {rows}=await pool.query(`SELECT o.id,o.order_number,o.status,o.total_cents,o.pickup_at,o.created_at,o.notes,
    o.stall_id,s.name AS stall_name,f.name AS food_court_name,
    COALESCE(json_agg(json_build_object('name',i.name_snapshot,'quantity',i.quantity,'priceCents',i.price_cents,
    'menuItemId',i.menu_item_id) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL),'[]'::json) AS items
    FROM orders o JOIN stalls s ON s.id=o.stall_id
    LEFT JOIN food_courts f ON f.id=s.food_court_id
    LEFT JOIN order_items i ON i.order_id=o.id
    WHERE o.customer_id=$1 ${extra} GROUP BY o.id,s.id,f.id ORDER BY o.id DESC LIMIT 100`,args);
  return rows.map(r=>({id:Number(r.id),orderNumber:r.order_number,status:r.status,totalCents:r.total_cents,
    pickupAt:r.pickup_at,createdAt:r.created_at,notes:r.notes,stallId:Number(r.stall_id),stallName:r.stall_name,
    foodCourtName:r.food_court_name,items:r.items}));
}
async function createOrder(userId, body) {
  const customerId=validId(userId);
  if (!customerId) throw problem(401,'Sign in to place an order.');
  const {stallId,pickupAt,items,notes}=parseBody(body);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows:users}=await client.query(`SELECT id FROM users WHERE id=$1 AND role='customer' AND is_active=1`,[customerId]);
    if (!users.length) throw problem(403,'Active customer account required.');
    const {rows:ss}=await client.query(`SELECT id,name,capacity_per_slot,is_open FROM stalls WHERE id=$1 FOR UPDATE`,[stallId]);
    if (!ss.length || Number(ss[0].is_open)!==1) throw problem(409,'The selected stall is not open.');
    const {rows:ww}=await client.query(`SELECT pickup_at FROM pickup_windows WHERE stall_id=$1 AND pickup_at=$2 FOR UPDATE`,[stallId,pickupAt]);
    if (!ww.length) throw problem(409,'This pickup time is not available. Choose another.');
    if (Date.parse(ww[0].pickup_at)<=Date.now()) throw problem(409,'Pickup time is no longer available.');
    const {rows:used}=await client.query(`SELECT COUNT(*)::integer AS n FROM orders WHERE stall_id=$1 AND pickup_at=$2 AND status<>'CANCELLED'`,[stallId,pickupAt]);
    if (used[0].n>=ss[0].capacity_per_slot) throw problem(409,'This pickup time is fully booked.');
    const itemIds=items.map(i=>i.menuItemId);
    const {rows:mm}=await client.query(`SELECT id,name,price_cents,is_available FROM menu_items
      WHERE stall_id=$1 AND id=ANY($2::bigint[]) FOR SHARE`,[stallId,itemIds]);
    const byId=new Map(mm.map(row=>[Number(row.id),row]));
    if (items.some(i=>!byId.has(i.menuItemId)||Number(byId.get(i.menuItemId).is_available)!==1)) throw problem(409,'One or more menu items are unavailable.');
    const total=items.reduce((n,i)=>n+i.quantity*Number(byId.get(i.menuItemId).price_cents),0);
    if (!Number.isSafeInteger(total)||total<=0) throw problem(400,'Invalid order total.');
    const timestamp=new Date().toISOString();
    const orderNumber='ML-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(6).toString('hex').toUpperCase();
    // No false payment success: at-stall payment must be verified separately.
    const {rows:[order]}=await client.query(`INSERT INTO orders
      (order_number,customer_id,stall_id,pickup_at,status,total_cents,notes,created_at,updated_at)
      VALUES ($1,$2,$3,$4,'PLACED',$5,$6,$7,$7) RETURNING id`,
    [orderNumber,customerId,stallId,ww[0].pickup_at,total,notes,timestamp]);
    for (const line of items) {
      const item=byId.get(line.menuItemId);
      await client.query(`INSERT INTO order_items
        (order_id,menu_item_id,name_snapshot,price_cents,quantity,selections_json)
        VALUES ($1,$2,$3,$4,$5,'{}')`,[order.id,line.menuItemId,item.name,item.price_cents,line.quantity]);
    }
    const confirmed={id:Number(order.id),orderNumber,status:'PLACED',pickupAt:ww[0].pickup_at,
      createdAt:timestamp,notes,totalCents:total,stallId,stallName:ss[0].name||'Participating stall',
      items:items.map(line=>({menuItemId:line.menuItemId,name:byId.get(line.menuItemId).name,
        priceCents:byId.get(line.menuItemId).price_cents,quantity:line.quantity}))};
    await client.query('COMMIT');
    return confirmed;
  } catch(error) {
    try {await client.query('ROLLBACK');} catch(e) {console.error('Order rollback:',e.message);}
    throw error;
  } finally {client.release();}
}
async function cancelOrder(customerId, orderId) {
  const {rows}=await pool.query(`UPDATE orders SET status='CANCELLED',updated_at=$3
    WHERE id=$1 AND customer_id=$2 AND status='PLACED' RETURNING id`,[orderId,customerId,new Date().toISOString()]);
  if(!rows.length)throw problem(409,'Order cannot be cancelled after preparation begins.');
  return {ok:true};
}
module.exports={problem,validId,parseBody,stalls,menu,windows,orderRows,createOrder,cancelOrder};
