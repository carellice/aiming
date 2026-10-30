import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWorld,minimapGeometry,worldToMinimap,minimapToWorld,centerCamera,dragCamera } from '../dist/minimap.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} ≠ ${b}`);

test('minimap world coordinates roundtrip at different panel sizes and zoom levels',()=>{
  const cards=[{x:-1800,y:700,width:270,height:220},{x:2300,y:-1400,width:440,height:48}];
  for(const zoom of [.15,.75,1,3])for(const size of [{width:164,height:83},{width:336,height:184},{width:120,height:76}]){
    const g=minimapGeometry(cards,{x:-1287,y:346,zoom},{width:1379,height:817},size);
    for(const p of [{x:-2500,y:-1400},{x:0,y:0},{x:3100,y:2400}]){
      const restored=minimapToWorld(worldToMinimap(p,g),g);close(restored.x,p.x);close(restored.y,p.y);
    }
  }
});
test('off-board camera stays fully visible together with distant objects',()=>{
  const v={x:-16000,y:14000,zoom:.8},canvas={width:1280,height:800},size={width:336,height:184};
  const cards=[{x:-24000,y:15000,width:300,height:200}],g=minimapGeometry(cards,v,canvas,size),r=visibleWorld(v,canvas);
  for(const p of [r,{x:r.x+r.width,y:r.y+r.height},cards[0],{x:-23700,y:15200}]){
    const m=worldToMinimap(p,g);assert.ok(m.x>=0&&m.x<=size.width&&m.y>=0&&m.y<=size.height);
  }
});
test('centering a clicked map point leaves zoom unchanged and targets the canvas center',()=>{
  const v={x:300,y:-200,zoom:1.7},canvas={width:1431,height:903},p={x:-777.5,y:2860.25};
  const next=centerCamera(p,v,canvas);close(p.x*v.zoom+next.x,canvas.width/2);close(p.y*v.zoom+next.y,canvas.height/2);assert.equal(v.zoom,1.7);
});
test('dragging preserves the grabbed viewport offset instead of snapping its center',()=>{
  const v={x:-280,y:440,zoom:.8},canvas={width:1000,height:700},r=visibleWorld(v,canvas),grab={x:120,y:95};
  const start={x:r.x+grab.x,y:r.y+grab.y},same=dragCamera(start,grab,v);close(same.x,v.x);close(same.y,v.y);
  const moved=dragCamera({x:start.x+500,y:start.y-300},grab,v);close(moved.x,v.x-400);close(moved.y,v.y+240);
});
test('empty boards and fractional small viewports have finite usable geometry',()=>{
  const g=minimapGeometry([],{x:0,y:0,zoom:3},{width:390,height:844},{width:108,height:64});
  assert.ok(Number.isFinite(g.scale)&&g.scale>0);assert.ok(Number.isFinite(g.offsetX)&&Number.isFinite(g.offsetY));
});
