'use strict';
const pool = require('./db');
function positiveId(v) { const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null; }
function problem(status,message){const e=new Error(message);e.status=status;return e;}
function output(row){return {
  id:Number(row.id),eventType:row.event_type,title:row.title,message:row.message,
  entityType:row.entity_type,entityId:row.entity_id==null?null:Number(row.entity_id),
  createdAt:row.created_at,readAt:row.read_at,
};}
async function inbox(userId){
  const owner=positiveId(userId);if(!owner)throw problem(401,'Sign in to view notifications.');
  const [list,count]=await Promise.all([
    pool.query(`SELECT id,event_type,title,message,entity_type,entity_id,created_at,read_at
      FROM ml_activity_notifications WHERE recipient_user_id=$1 AND dismissed_at IS NULL
      ORDER BY created_at DESC,id DESC LIMIT 70`,[owner]),
    pool.query(`SELECT COUNT(*)::integer AS unread FROM ml_activity_notifications
      WHERE recipient_user_id=$1 AND dismissed_at IS NULL AND read_at IS NULL`,[owner]),
  ]);
  return {notifications:list.rows.map(output),unreadCount:Number(count.rows[0]?.unread||0)};
}
async function change(userId,id,action){
  const owner=positiveId(userId),note=positiveId(id);
  if(!owner)throw problem(401,'Sign in to manage notifications.');
  if(!note)throw problem(400,'Invalid notification ID.');
  if(!['read','dismiss'].includes(action))throw problem(400,'Invalid action.');
  const column=action==='read'?'read_at':'dismissed_at';
  const result=await pool.query(`UPDATE ml_activity_notifications
    SET ${column}=COALESCE(${column},NOW())
    WHERE id=$1 AND recipient_user_id=$2 AND dismissed_at IS NULL
    RETURNING id`,[note,owner]);
  if(!result.rows.length)throw problem(404,'Notification not found.');
  return {ok:true,id:note,action};
}
// Dedicated live-order transition: only vendor assigned to this stall may update.
async function changeOrderStatus(vendor,orderId,newStatus){
  if(vendor?.role!=='vendor'||!positiveId(vendor.id)||!positiveId(vendor.stallId))
    throw problem(403,'Assigned vendor account required.');
  const order=positiveId(orderId);
  if(!order||!['PREPARING','READY'].includes(newStatus))throw problem(400,'Invalid order or status.');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const result=await client.query(`SELECT id,status,stall_id FROM orders WHERE id=$1 FOR UPDATE`,[order]);
    const row=result.rows[0];
    if(!row||Number(row.stall_id)!==vendor.stallId)throw problem(404,'Order not found for your stall.');
    const allowed=newStatus==='PREPARING'?['PLACED','ACCEPTED']:['PREPARING'];
    if(!allowed.includes(row.status))throw problem(409,`Cannot change ${row.status} to ${newStatus}.`);
    const updated=await client.query(`UPDATE orders SET status=$1,updated_at=NOW()
      WHERE id=$2 AND stall_id=$3 RETURNING id,status,stall_id`,[newStatus,order,vendor.stallId]);
    await client.query('COMMIT'); // PostgreSQL order trigger atomically emits role notifications.
    return {order:{id:Number(updated.rows[0].id),status:updated.rows[0].status}};
  } catch(error) {try{await client.query('ROLLBACK');}catch(e){console.error('Order status rollback:',e.message);}throw error;}
  finally{client.release();}
}
module.exports={positiveId,problem,output,inbox,change,changeOrderStatus};
