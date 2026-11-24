const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../src/public/prototype-exact');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
const bridge=fs.readFileSync(path.join(root,'api-bridge.js'),'utf8');
test('the shared account page includes change, remove and file-picker controls',()=>{
  expect(app).toContain('profile-avatar-input');
  expect(app).toContain('data-action="changeAvatar"');
  expect(app).toContain('data-action="removeAvatar"');
  expect(app).toContain("const u=state.user");
});
test('profile photos are fetched for the navbar, preserved across navigation and safely resized',()=>{
  expect(app).toContain('refreshProfileFromServer');
  expect(app).toContain('user.avatarUrl?');
  expect(app).toContain("canvas.toDataURL('image/jpeg',0.85)");
  expect(css).toContain('.profile-avatar img,.avatar img');
});
test('avatar mutations use the existing session and CSRF-enabled bridge',()=>{
  expect(bridge).toContain("if(path==='/api/profile/avatar'&&['POST','DELETE'].includes(method))");
  expect(bridge).toContain("return http('/api/profile/avatar',{method,body,auth:false})");
  expect(app).toContain("request('/api/profile/avatar',{method:'POST'");
});
