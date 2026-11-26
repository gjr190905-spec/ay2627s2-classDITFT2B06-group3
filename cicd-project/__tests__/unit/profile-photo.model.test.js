jest.mock('../../src/models/db', () => ({query:jest.fn()}));
const db=require('../../src/models/db');
const {findAvatarById,saveAvatarById,removeAvatarById}=require('../../src/models/Profile.model');
beforeEach(()=>jest.resetAllMocks());
test('photo retrieval is scoped to the signed-in account',async()=>{
  const img=Buffer.from([0xff,0xd8,0xff]);
  db.query.mockResolvedValueOnce({rows:[{imageData:img,contentType:'image/jpeg'}]});
  expect((await findAvatarById(5)).imageData).toEqual(img);
  expect(db.query.mock.calls[0][1]).toEqual([5]);
  expect(db.query.mock.calls[0][0]).toContain('u.id = $1');
});
test('photo write is scoped to existing active account and returns updated URL',async()=>{
  db.query.mockResolvedValueOnce({rows:[{user_id:'5'}]});
  db.query.mockResolvedValueOnce({rows:[{id:'5',email:'p@test.com',displayName:'P',phone:'',role:'staff',avatarUpdatedAt:'2026-11-24T10:00:00.000Z'}]});
  const image=Buffer.from([0xff,0xd8,0xff]);
  const result=await saveAvatarById(5,'image/jpeg',image);
  expect(result.avatarUrl).toContain('/api/profile/avatar?v=');
  expect(db.query.mock.calls[0][1]).toEqual([5,'image/jpeg',image]);
  expect(db.query.mock.calls[0][0]).toContain('u.is_active = 1');
});
test('removal only deletes photo row for own user ID',async()=>{
  db.query.mockResolvedValueOnce({rows:[]});
  db.query.mockResolvedValueOnce({rows:[{id:'5',email:'p@test.com',displayName:'P',phone:'',role:'staff'}]});
  const user=await removeAvatarById(5);
  expect(user.avatarUrl).toBeNull();
  expect(db.query.mock.calls[0]).toEqual(['DELETE FROM user_profile_images WHERE user_id = $1',[5]]);
});
test('invalid account ID cannot reach database',async()=>{
  await expect(findAvatarById('5 OR true')).rejects.toThrow('Invalid account ID.');
  expect(db.query).not.toHaveBeenCalled();
});
