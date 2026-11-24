jest.mock('../../src/models/VendorWeekly.model',()=>({getWeeklyStatsForAssignedStall:jest.fn()}));
jest.mock('../../src/models/Session.model',()=>({createSession:jest.fn(),findActiveSession:jest.fn(),revokeSession:jest.fn()}));
const request=require('supertest');
const app=require('../../src/app');
const {findActiveSession}=require('../../src/models/Session.model');
const {getWeeklyStatsForAssignedStall}=require('../../src/models/VendorWeekly.model');
const cookie=`ml_session=${'a'.repeat(64)}`;
beforeEach(()=>{jest.resetAllMocks();getWeeklyStatsForAssignedStall.mockResolvedValue({days:[],totalCents:0});});
test('guest gets 401',async()=>{
  const r=await request(app).get('/api/vendor/weekly-stats');expect(r.status).toBe(401);
});
test.each(['customer','staff','admin'])('%s role gets 403',async(role)=>{
  findActiveSession.mockResolvedValue({id:9,name:'Person',email:'p@example.com',role,stallId:5,csrfToken:'b'.repeat(64)});
  const r=await request(app).get('/api/vendor/weekly-stats').set('Cookie',cookie);
  expect(r.status).toBe(403);expect(getWeeklyStatsForAssignedStall).not.toHaveBeenCalled();
});
test('vendor can read only their own stall stats',async()=>{
  findActiveSession.mockResolvedValue({id:9,name:'Vendor',email:'v@example.com',role:'vendor',stallId:5,csrfToken:'b'.repeat(64)});
  const r=await request(app).get('/api/vendor/weekly-stats?stallId=999').set('Cookie',cookie);
  expect(r.status).toBe(200);expect(getWeeklyStatsForAssignedStall).toHaveBeenCalledWith(5);
});
test('unassigned vendor gets 403',async()=>{
  findActiveSession.mockResolvedValue({id:9,name:'Vendor',email:'v@example.com',role:'vendor',stallId:null,csrfToken:'b'.repeat(64)});
  const r=await request(app).get('/api/vendor/weekly-stats').set('Cookie',cookie);
  expect(r.status).toBe(403);expect(getWeeklyStatsForAssignedStall).not.toHaveBeenCalled();
});
