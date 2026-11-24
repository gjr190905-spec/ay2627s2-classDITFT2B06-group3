jest.mock('../../src/models/Profile.model',()=>({findProfileById:jest.fn(),updateProfileById:jest.fn(),changePasswordById:jest.fn()}));
jest.mock('../../src/models/Session.model',()=>({createSession:jest.fn(),findActiveSession:jest.fn(),revokeSession:jest.fn()}));
const request=require('supertest');
const app=require('../../src/app');
const {findActiveSession}=require('../../src/models/Session.model');
const {findProfileById,changePasswordById}=require('../../src/models/Profile.model');
const csrf='c'.repeat(64),cookie=`ml_session=${'a'.repeat(64)}`;
beforeEach(()=>{jest.resetAllMocks();findProfileById.mockImplementation(async()=>({id:9,email:'test@example.com',displayName:'Test User',phone:'',role:'customer',active:true}));changePasswordById.mockResolvedValue({changed:true});});
test.each(['customer','staff','vendor','admin'])('%s can read only their own profile',async(role)=>{
  findActiveSession.mockResolvedValue({id:9,name:'Test User',email:'test@example.com',role,stallId:role==='vendor'?7:null,csrfToken:csrf});
  const r=await request(app).get('/api/profile').set('Cookie',cookie);
  expect(r.status).toBe(200);expect(findProfileById).toHaveBeenCalledWith(9);
});
