'use strict';
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(__dirname,'../../src/public/prototype-exact');
const app=fs.readFileSync(path.join(base,'app.js'),'utf8');
const styles=fs.readFileSync(path.join(base,'styles.css'),'utf8');
describe('Day 11 auto-announcing shared notifications',()=>{
  test('notifies after a successful real order placement, not before checkout',()=>{
    expect(app).toContain('await refreshOrderNotifications({announceOrderId:response.order.id})');
    expect(app).toContain("state.cartCount=0;toast('Order placed successfully.');");
  });
  test('uses the existing authenticated activity inbox across all three roles',()=>{
    expect(app).toContain("['customer','vendor','admin']");
    expect(app).toContain("await request('/api/activity-notifications')");
  });
  test('avoids announcing historical unread items on initial login',()=>{
    expect(app).toContain('const initialFetch=autoNotificationOwner!==owner');
    expect(app).toContain('(!initialFetch?newUnread.find(n=>popupEvents.has(n.eventType)):null)');
    expect(app).toContain('autoNotificationSeen=new Set(notes.map(n=>Number(n.id)))');
  });
  test('only urgent events interrupt; routine and already-handled READY changes stay quiet',()=>{
    for(const kind of ['ORDER_RECEIVED','ORDER_CANCELLED','VENDOR_ORDER_CANCELLED','STALL_REMOVED','REVIEW_REPORTED']){
      expect(app).toContain("'"+kind+"'");
    }
    expect(app).toContain('newUnread.find(n=>popupEvents.has(n.eventType))');
    expect(app).not.toContain('newUnread[0]');
  });
  test('popup is explicitly dismissible and opens the persistent inbox',()=>{
    expect(app).toContain('data-activity-popup-close');
    expect(app).toContain('data-activity-popup-open');
    expect(app).toContain("bell.classList.add('notification-ring')");
  });
  test('polls and refreshes when browser tab becomes visible',()=>{
    expect(app).toContain('setInterval(refreshOrderNotifications, 4000)');
    expect(app).toContain("document.addEventListener('visibilitychange',refreshOrderNotifications)");
  });
  test('popup beside bell does not replace existing READY pickup alert',()=>{
    expect(app).toContain("if(!popup.hidden&&!popup.classList.contains('activity-popup'))return");
    expect(app).toContain("!$('#pickup-pop')?.classList.contains('activity-popup'))hidePopup()");
    expect(styles).toContain('#pickup-pop.activity-popup');
  });
});
