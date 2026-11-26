'use strict';
const express=require('express');
const {authenticate,requireRole}=require('../middleware/auth');
const {requireSameOrigin,requireCsrf}=require('../middleware/auth-session');
const model=require('../models/LiveCheckout.model');
const router=express.Router();
function wrap(fn){return async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};}
function positive(value){const id=model.validId(value);if(!id)throw model.problem(400,'Invalid ID.');return id;}
router.get('/stalls',wrap(async(req,res)=>res.json(await model.stalls())));
router.get('/stalls/:id',wrap(async(req,res)=>{const rows=await model.stalls(positive(req.params.id));if(!rows.length)throw model.problem(404,'Stall not found.');res.json(rows[0]);}));
router.get('/stalls/:id/menu',wrap(async(req,res)=>res.json(await model.menu(positive(req.params.id)))));
router.get('/stalls/:id/windows',authenticate,requireRole('customer'),wrap(async(req,res)=>res.json(await model.windows(positive(req.params.id)))));
router.get('/orders',authenticate,requireRole('customer'),wrap(async(req,res)=>res.json(await model.orderRows(req.user.id))));
router.get('/orders/:id',authenticate,requireRole('customer'),wrap(async(req,res)=>{const order=(await model.orderRows(req.user.id,positive(req.params.id)))[0];if(!order)throw model.problem(404,'Order not found.');res.json(order);}));
router.post('/orders',authenticate,requireRole('customer'),requireSameOrigin,requireCsrf,wrap(async(req,res)=>res.status(201).json(await model.createOrder(req.user.id,req.body))));
router.post('/orders/:id/cancel',authenticate,requireRole('customer'),requireSameOrigin,requireCsrf,wrap(async(req,res)=>res.json(await model.cancelOrder(req.user.id,positive(req.params.id)))));
module.exports=router;
