jest.mock('../../src/models/Profile.model',()=>({findProfileById:jest.fn(),updateProfileById:jest.fn(),findAvatarById:jest.fn(),saveAvatarById:jest.fn(),removeAvatarById:jest.fn()}));
jest.mock('../../src/models/Session.model',()=>({createSession:jest.fn(),findActiveSession:jest.fn(),revokeSession:jest.fn()}));
const request=require('supertest');
const app=require('../../src/app');
const {findActiveSession}=require('../../src/models/Session.model');
const photo=require('../../src/models/Profile.model');
const cookie=`ml_session=${'a'.repeat(64)}`;const csrf='c'.repeat(64);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnN0GkAAAAASUVORK5CYII=','base64');
const body={imageDataUrl:'data:image/png;base64,'+png.toString('base64')};
const user={id:5,email:'p@test.com',displayName:'P',role:'customer',avatarUrl:'/api/profile/avatar?v=12'};
beforeEach(()=>{
  jest.resetAllMocks();
  photo.findAvatarById.mockResolvedValue({imageData:png,contentType:'image/png'});
  photo.saveAvatarById.mockResolvedValue(user);
  photo.removeAvatarById.mockResolvedValue({...user,avatarUrl:null});
  findActiveSession.mockResolvedValue({id:5,name:'P',email:'p@test.com',role:'customer',csrfToken:csrf});
});
test('guest cannot read or modify avatar',async()=>{
  findActiveSession.mockResolvedValue(null);
  expect((await request(app).get('/api/profile/avatar')).status).toBe(401);
  expect((await request(app).post('/api/profile/avatar').send(body)).status).toBe(401);
});
test('CSRF token required for upload and delete',async()=>{
  expect((await request(app).post('/api/profile/avatar').set('Cookie',cookie).send(body)).status).toBe(403);
  expect((await request(app).delete('/api/profile/avatar').set('Cookie',cookie)).status).toBe(403);
});
test('image upload accepts valid PNG and saves under authenticated account',async()=>{
  const res=await request(app).post('/api/profile/avatar').set('Cookie',cookie).set('X-CSRF-Token',csrf).send(body);
  expect(res.status).toBe(200);expect(photo.saveAvatarById).toHaveBeenCalledWith(5,'image/png',png);
});
test('image upload rejects SVG or mismatched magic bytes',async()=>{
  for(const imageDataUrl of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,SGVsbG8=']){
    const r=await request(app).post('/api/profile/avatar').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({imageDataUrl});
    expect(r.status).toBe(400);
  }
  expect(photo.saveAvatarById).not.toHaveBeenCalled();
});
test('all account roles can use their own avatar endpoint',async()=>{
  for(const role of ['customer','staff','vendor','admin']){
    findActiveSession.mockResolvedValue({id:5,name:'P',email:'p@test.com',role,csrfToken:csrf});
    const r=await request(app).get('/api/profile/avatar').set('Cookie',cookie);
    expect(r.status).toBe(200);expect(r.headers['content-type']).toMatch(/image\/png/);
    expect(photo.findAvatarById).toHaveBeenCalledWith(5);
  }
});
test('signed-in user can delete their own image',async()=>{
  const r=await request(app).delete('/api/profile/avatar').set('Cookie',cookie).set('X-CSRF-Token',csrf);
  expect(r.status).toBe(200);expect(photo.removeAvatarById).toHaveBeenCalledWith(5);
});

test('oversized avatar is rejected before it reaches PostgreSQL',async()=>{
  const big='data:image/png;base64,'+Buffer.alloc(524289,1).toString('base64');
  const res=await request(app).post('/api/profile/avatar').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({imageDataUrl:big});
  expect(res.status).toBe(400);expect(photo.saveAvatarById).not.toHaveBeenCalled();
});
