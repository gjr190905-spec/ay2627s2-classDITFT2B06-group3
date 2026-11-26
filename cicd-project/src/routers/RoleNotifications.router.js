'use strict';
const express=require('express');
const {requireAuthentication}=require('../middleware/access-control');
const {requireSameOrigin,requireCsrf}=require('../middleware/auth-session');
const roleNotifications=require('../models/RoleNotifications.model');
const router=express.Router();
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.use(requireAuthentication);
function wrap(fn){return async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};}
router.get('/',wrap(async(req,res)=>res.json(await roleNotifications.inbox(req.user.id))));
router.post('/:id/read',requireSameOrigin,requireCsrf,wrap(async(req,res)=>
  res.json(await roleNotifications.change(req.user.id,req.params.id,'read'))));
router.post('/:id/dismiss',requireSameOrigin,requireCsrf,wrap(async(req,res)=>
  res.json(await roleNotifications.change(req.user.id,req.params.id,'dismiss'))));
router.patch('/orders/:id/status',requireSameOrigin,requireCsrf,wrap(async(req,res)=>{
  if(!req.is('application/json')||!req.body||Array.isArray(req.body)||
      Object.keys(req.body).length!==1||typeof req.body.status!=='string'){
    return res.status(400).json({error:'Provide a JSON status only.'});
  }
  return res.json(await roleNotifications.changeOrderStatus(req.user,req.params.id,req.body.status));
}));
module.exports=router;
