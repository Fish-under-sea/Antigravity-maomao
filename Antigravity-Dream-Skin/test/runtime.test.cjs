const{test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const{DreamSkinSettings}=require("../src/domain/settings.cjs"),{DreamSkinThemeLoader}=require("../src/domain/theme-loader.cjs");
test("output glass mode persists, validates and reaches host payload",()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"dream-output-")),"settings.json"),s=new DreamSkinSettings(file);
 assert.equal(s.get("outputMode"),"transparent");s.update({outputMode:"glass"});assert.equal(new DreamSkinSettings(file).get("outputMode"),"glass");
 assert.equal(new DreamSkinThemeLoader().payload(s.getAll()).outputMode,"glass");s.update({outputMode:"invalid"});assert.equal(s.get("outputMode"),"transparent");
});
test("missing or corrupt wallpaper resources leave the loader available for recovery",()=>{
 const rootDir=fs.mkdtempSync(path.join(os.tmpdir(),"dream-missing-"));
 const loader=new DreamSkinThemeLoader({rootDir});
 assert.throws(()=>loader.verifyIntegrity(),/清单缺失或损坏/);
 fs.mkdirSync(loader.wallpaperPackDir,{recursive:true});
 fs.writeFileSync(path.join(loader.wallpaperPackDir,"manifest.json"),JSON.stringify({file:"wallpaper.png",sha256:"invalid"}));
 assert.throws(()=>loader.verifyIntegrity(),/图片无法读取/);
 fs.writeFileSync(path.join(loader.wallpaperPackDir,"wallpaper.png"),"damaged");
 assert.throws(()=>loader.verifyIntegrity(),/校验失败/);
});
test("disabled by default, zero scrim survives reload, protection cannot be disabled",()=>{const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"dream-test-")),"settings.json"),s=new DreamSkinSettings(file);assert.equal(s.get("enabled"),false);s.update({scrim:0,fit:"cover",protectEditor:false});assert.equal(new DreamSkinSettings(file).get("scrim"),0);assert.equal(s.get("protectEditor"),true);});
test("wallpaper hash and safe path verified, payload contains original image",()=>{const l=new DreamSkinThemeLoader(),v=l.verifyIntegrity();assert.equal(v.width,1672);assert.equal(v.height,941);assert(l.payload({scrim:0,fit:"contain"}).image.startsWith("data:image/png;base64,"));assert.equal(l.payload({scrim:0}).scrim,0);l.manifest.file="../escape.png";assert.throws(()=>l.verifyIntegrity(),/无效壁纸路径/);});

const {HostController}=require("../src/domain/host-controller.cjs");
function fixture(){
 let state={themed:false},blockSnapshot=null,blockApply=null;
 const applied=[],writes=[];
 const client={
  closed:false,
  async evaluate(expression){
   if(expression.startsWith("({ready:")){
    if(blockSnapshot){const gate=blockSnapshot;blockSnapshot=null;await gate;}
    return {...state};
   }
   if(expression.startsWith("(async function installTheme")){
    const payload=JSON.parse(expression.slice(expression.lastIndexOf(")({")+2,-1));
    applied.push(payload);
    if(blockApply){const gate=blockApply;blockApply=null;await gate;}
    state={themed:true,owner:payload.owner,rev:27};
    return {applied:true};
   }
   if(expression.includes("touch?.()")){
    return true;
   }
   if(expression.includes("destroy()")){
    if(!expression.includes("===")||state.owner===controller.owner){writes.push("destroy");state={themed:false};}
    return null;
   }
   throw new Error("Unexpected operation");
  },
  close(){this.closed=true;}
 };
 const controller=new HostController(
  {payload:settings=>({...settings,image:"data:image/png;base64,fixture"})},
  ()=>{},
  {discover:async()=>({target:{webSocketDebuggerUrl:"ws://127.0.0.1:1/test"}}),createClient:()=>client}
 );
 return {controller,applied,writes,setState:v=>state=v,holdSnapshot:p=>blockSnapshot=p,holdApply:p=>blockApply=p};
}
const nextTask=()=>new Promise(resolve=>setImmediate(resolve));

test("latest disabled setting drains an in-flight connection before update resolves",async()=>{
 const f=fixture();let release;f.holdSnapshot(new Promise(resolve=>release=resolve));
 const first=f.controller.update({enabled:true,fit:"contain",scrim:12});
 await nextTask();
 const last=f.controller.update({enabled:false,fit:"cover",scrim:0});
 release();await Promise.all([first,last]);
 assert.equal(f.applied.length,0);
 assert.equal(f.controller.status.applied,false);
 assert.equal(f.controller.settings.scrim,0);
 await f.controller.stop();
});

test("an update during apply is flushed and caller mutations cannot change a queued setting",async()=>{
 const f=fixture();let release;f.holdApply(new Promise(resolve=>release=resolve));
 const settings={enabled:true,fit:"contain",scrim:12};
 const first=f.controller.update(settings);settings.fit="invalid-caller-mutation";
 await nextTask();
 const final=f.controller.update({enabled:true,fit:"cover",scrim:0});
 release();await Promise.all([first,final]);
 assert.equal(f.applied[0].fit,"contain");
 assert.equal(f.applied.at(-1).fit,"cover");
 assert.equal(f.applied.at(-1).scrim,0);
 await f.controller.stop();assert.equal(f.writes.length,1);
});

test("another owner's skin remains untouched and status never falsely claims it was restored",async()=>{
 const f=fixture();f.setState({themed:true,owner:"other-owner"});
 await f.controller.update({enabled:false});
 assert.match(f.controller.status.message,/另一个/);
 await f.controller.update({enabled:true,fit:"contain",scrim:12});
 assert.equal(f.controller.status.connected,true);
 assert.equal(f.controller.status.applied,false);
 assert.equal(f.applied.length,0);
 await f.controller.stop();assert.equal(f.writes.length,0);
});

test("a local peer that never upgrades to WebSocket has a bounded handshake",async t=>{
 const net=require("node:net"),{Cdp}=require("../../shared/host.cjs"),sockets=new Set();
 const server=net.createServer(socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 const client=new Cdp("ws://127.0.0.1:"+server.address().port+"/",{handshakeTimeout:40});
 const start=Date.now();
 await assert.rejects(client.send("Runtime.evaluate"),/handshake.*timed out/i);
 client.close();assert(Date.now()-start<3000);
});

test('wallpaper positioning and zoom survive restart and clamp invalid ranges',()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'dream-pan-')),'settings.json'),s=new DreamSkinSettings(file);
 s.update({positionX:12,positionY:73,zoom:1.4});const restored=new DreamSkinSettings(file);assert.equal(restored.get('positionX'),12);assert.equal(restored.get('positionY'),73);assert.equal(restored.get('zoom'),1.4);
 s.update({positionX:-1,positionY:999,zoom:99});assert.equal(s.get('positionX'),0);assert.equal(s.get('positionY'),100);assert.equal(s.get('zoom'),2);
 const payload=new DreamSkinThemeLoader().payload(restored.getAll());assert.equal(payload.positionX,12);assert.equal(payload.positionY,73);assert.equal(payload.zoom,1.4);
});

test('custom mp4 and image media settings persist, clamp rate, and deduplicate recentMedia',()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'dream-media-set-')),'settings.json'),s=new DreamSkinSettings(file);
 assert.equal(s.get('mediaType'),'preset');
 s.update({
  mediaType:'video',
  customMediaPath:'C:\\wallpapers\\loop.mp4',
  recentMedia:['C:\\wallpapers\\a.png','C:\\wallpapers\\loop.mp4','C:\\wallpapers\\a.png'],
  videoMuted:false,
  videoPlaybackRate:3.5,
  videoPaused:true
 });
 const reloaded=new DreamSkinSettings(file);
 assert.equal(reloaded.get('mediaType'),'video');
 assert.equal(reloaded.get('customMediaPath'),'C:\\wallpapers\\loop.mp4');
 assert.deepEqual(reloaded.get('recentMedia'),['C:\\wallpapers\\a.png','C:\\wallpapers\\loop.mp4']);
 assert.equal(reloaded.get('videoMuted'),false);
 assert.equal(reloaded.get('videoPlaybackRate'),2);
 assert.equal(reloaded.get('videoPaused'),true);
 reloaded.update({mediaType:'invalid-kind',videoPlaybackRate:0.01});
 assert.equal(reloaded.get('mediaType'),'preset');
 assert.equal(reloaded.get('videoPlaybackRate'),0.25);
});

test('LocalMediaServer streams byte ranges with token auth and blocks unapproved paths',async t=>{
 const http=require('node:http');
 const {LocalMediaServer,detectMediaKind}=require('../src/domain/media-server.cjs');
 assert.equal(detectMediaKind('clip.MP4'),'video');
 assert.equal(detectMediaKind('art.webp'),'image');
 assert.equal(detectMediaKind('evil.exe'),null);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dream-srv-'));
 const mp4=path.join(dir,'sample.mp4'),secret=path.join(dir,'secret.txt');
 fs.writeFileSync(mp4,Buffer.from('0123456789ABCDEF'));
 fs.writeFileSync(secret,'topsecret');
 const srv=new LocalMediaServer();
 await srv.start();
 t.after(()=>srv.stop());
 const url=srv.register(mp4);
 const unauth=await fetch(url.replace(/token=[^&]+/,'token=wrong'));
 assert.equal(unauth.status,401);
 const blocked=await fetch(`${srv.baseUrl}/media?token=${srv.token}&path=${encodeURIComponent(secret)}`);
 assert.equal(blocked.status,403);
 const partial=await fetch(url,{headers:{Range:'bytes=2-7'}});
 assert.equal(partial.status,206);
 assert.equal(partial.headers.get('content-type'),'video/mp4');
 assert.equal(partial.headers.get('content-range'),'bytes 2-7/16');
 assert.equal(await partial.text(),'234567');
});

test('DreamSkinThemeLoader resolves custom video and image via LocalMediaServer',async t=>{
 const {LocalMediaServer}=require('../src/domain/media-server.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dream-ldr-'));
 const mp4=path.join(dir,'bg.mp4'),jpg=path.join(dir,'bg.jpg');
 fs.writeFileSync(mp4,Buffer.from('fake-mp4-bytes'));
 fs.writeFileSync(jpg,Buffer.from('fake-jpg-bytes'));
 const srv=new LocalMediaServer();
 await srv.start();
 t.after(()=>srv.stop());
 const loader=new DreamSkinThemeLoader({mediaServer:srv});
 const vPayload=loader.payload({mediaType:'video',customMediaPath:mp4,videoMuted:true,videoPlaybackRate:1.25,scrim:10,opacity:60,fit:'cover',positionX:50,positionY:50,zoom:1});
 assert.equal(vPayload.mediaKind,'video');
 assert(vPayload.mediaUrl.startsWith(srv.baseUrl));
 assert.equal(vPayload.videoPlaybackRate,1.25);
 const iPayload=loader.payload({mediaType:'image',customMediaPath:jpg,scrim:0,fit:'contain'});
 assert.equal(iPayload.mediaKind,'image');
 assert(iPayload.mediaUrl.startsWith(srv.baseUrl));
 assert.throws(()=>loader.payload({mediaType:'video',customMediaPath:path.join(dir,'missing.mp4')}),/无法读取|不存在/);
});

test('installTheme mounts looping video element, preserves element across style updates, and cleans up on destroy',async()=>{
 const {installTheme}=require('../src/host/theme.cjs');
 function makeEl(tag){
  const attrs=new Map(),listeners=new Map(),children=[];
  const el={
   tagName:tag.toUpperCase(),
   id:'',
   children,
   isConnected:true,
   parentElement:null,
   style:{
    _props:{},
    setProperty(k,v){this._props[k]=v;},
    getPropertyValue(k){return this._props[k]||'';},
    getPropertyPriority(){return '';},
    removeProperty(k){delete this._props[k];}
   },
   playCalls:0,
   pauseCalls:0,
   loadCalls:0,
   videoWidth:1920,
   videoHeight:1080,
   naturalWidth:1672,
   naturalHeight:941,
   setAttribute(k,v){if(k==='id')el.id=v;attrs.set(k,String(v));},
   getAttribute(k){return attrs.get(k)??null;},
   hasAttribute(k){return attrs.has(k);},
   removeAttribute(k){attrs.delete(k);if(k==='src')el.src='';},
   addEventListener(evt,fn){listeners.set(evt,fn);},
   append(...nodes){for(const n of nodes){n.parentElement=el;children.push(n);}},
   prepend(...nodes){for(const n of nodes){n.parentElement=el;children.unshift(n);}},
   remove(){el.isConnected=false;if(el.parentElement){const i=el.parentElement.children.indexOf(el);if(i>=0)el.parentElement.children.splice(i,1);}},
   matches(){return false;},
   closest(){return null;},
   contains(target){return target===el||children.some(c=>c.contains?.(target));},
   querySelector(sel){if(sel==='#root')return rootEl;return null;},
   querySelectorAll(){return [];},
   getBoundingClientRect(){return {left:0,top:0,width:1280,height:720,right:1280,bottom:720};},
   play(){el.playCalls++;return Promise.resolve();},
   pause(){el.pauseCalls++;},
   load(){el.loadCalls++;},
   classList:{add(){},remove(){}}
  };
  return el;
 }
 const rootEl=makeEl('div');rootEl.id='root';
 const bodyEl=makeEl('body');bodyEl.append(rootEl);
 const headEl=makeEl('head');
 const docEl=makeEl('html');
 const origGlobals={window:global.window,document:global.document,getComputedStyle:global.getComputedStyle,MutationObserver:global.MutationObserver,ResizeObserver:global.ResizeObserver,innerWidth:global.innerWidth,innerHeight:global.innerHeight};
 try{
  global.window={};
  global.document={
   documentElement:docEl,
   head:headEl,
   body:bodyEl,
   createElement:tag=>makeEl(tag),
   querySelector:sel=>sel==='#root'?rootEl:null,
   querySelectorAll:()=>[]
  };
  global.getComputedStyle=()=>({backgroundColor:'rgb(24, 24, 34)',backgroundImage:'none'});
  global.MutationObserver=class{observe(){}disconnect(){}};
  global.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  global.innerWidth=1280;
  global.innerHeight=720;

  const videoUrl='http://127.0.0.1:45555/media?token=abc&path=demo.mp4';
  const status=await installTheme({
   owner:'test-owner',
   outputMode:'transparent',
   mediaKind:'video',
   mediaUrl:videoUrl,
   videoMuted:true,
   videoPlaybackRate:1.25,
   videoPaused:false,
   opacity:0.65,
   scrim:0.15,
   fit:'cover',
   positionX:50,
   positionY:50,
   zoom:1
  });
  assert.equal(status.applied,true);
  assert.equal(status.mediaKind,'video');
  const layer=bodyEl.children.find(c=>c.id==='agy-dream-wallpaper-v2');
  const videoEl=layer.children.find(c=>c.id==='agy-dream-media-v2');
  assert.equal(videoEl.tagName,'VIDEO');
  assert.equal(videoEl.src,videoUrl);
  assert.equal(videoEl.loop,true);
  assert.equal(videoEl.muted,true);
  assert.equal(videoEl.playbackRate,1.25);

  await installTheme({
   owner:'test-owner',
   outputMode:'glass',
   mediaKind:'video',
   mediaUrl:videoUrl,
   videoMuted:true,
   videoPlaybackRate:1.5,
   videoPaused:true,
   opacity:0.8,
   scrim:0.2,
   fit:'contain',
   positionX:40,
   positionY:60,
   zoom:1.1
  });
  const sameVideoEl=layer.children.find(c=>c.id==='agy-dream-media-v2');
  assert.equal(sameVideoEl,videoEl);
  assert.equal(sameVideoEl.playbackRate,1.5);
  assert.ok(sameVideoEl.pauseCalls>=1);

  global.window.__agyDreamSkinV2.destroy();
  assert.equal(global.window.__agyDreamSkinV2,undefined);
  assert.equal(videoEl.isConnected,false);
  assert.ok(videoEl.loadCalls>=1);
 }finally{
  Object.assign(global,origGlobals);
 }
});

test('DreamSkinSettings sanitizes glass regions, themeStyle, radius, veil, font colors, and merges partial updates cleanly',()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'dream-glass-set-')),'settings.json');
 const s=new DreamSkinSettings(file);
 assert.equal(s.getAll().glass.themeStyle,'star-neko');
 assert.equal(s.getAll().glass.radius,16);
 s.update({
  widgetHideTray:true,
  glass:{
   themeStyle:'official',
   tint:'#38BDF8',
   veil:120,
   radius:99,
   regions:{sidebar:{fill:88,blur:10},overlay:{fill:-5,blur:99}}
  },
  font:{
   accent:'#6366F1',
   darkSeparate:true,
   colors:{main:'#FBF9F9',secondary:'invalid',muted:'#FDFDFD',faint:'#FFFFFF'},
   colorsDark:{main:'#EAEBF1',secondary:'#A8A9B2'}
  }
 });
 s.update({glass:{veil:35,radius:12},font:{colors:{secondary:'#E2E8F0'}}});
 const reloaded=new DreamSkinSettings(file).getAll();
 assert.equal(reloaded.widgetHideTray,true);
 assert.equal(reloaded.glass.themeStyle,'official');
 assert.equal(reloaded.glass.tint,'#38bdf8');
 assert.equal(reloaded.glass.veil,35);
 assert.equal(reloaded.glass.radius,12);
 assert.equal(reloaded.glass.regions.sidebar.fill,88);
 assert.equal(reloaded.glass.regions.sidebar.blur,10);
 assert.equal(reloaded.glass.regions.overlay.fill,0);
 assert.equal(reloaded.glass.regions.overlay.blur,40);
 s.update({glass:{radius:2}});
 assert.equal(s.getAll().glass.radius,8);
 assert.equal(reloaded.font.accent,'#6366f1');
 assert.equal(reloaded.font.darkSeparate,true);
 assert.equal(reloaded.font.colors.main,'#fbf9f9');
 assert.equal(reloaded.font.colors.secondary,'#e2e8f0');
 assert.equal(reloaded.font.colorsDark.main,'#eaebf1');
});

test('installTheme takes over official Antigravity glass/font vars and styles slash menu cleanly without transparence leak',async()=>{
 const {installTheme}=require('../src/host/theme.cjs');
 function makeEl(tag){
  const attrs=new Map(),children=[];
  const el={
   tagName:tag.toUpperCase(),
   id:'',
   textContent:'',
   children,
   isConnected:true,
   parentElement:null,
   style:{
    _props:{},
    setProperty(k,v){this._props[k]=v;},
    getPropertyValue(k){return this._props[k]||'';},
    getPropertyPriority(){return '';},
    removeProperty(k){delete this._props[k];}
   },
   setAttribute(k,v){if(k==='id')el.id=v;attrs.set(k,String(v));},
   getAttribute(k){return attrs.get(k)??null;},
   hasAttribute(k){return attrs.has(k);},
   removeAttribute(k){attrs.delete(k);},
   addEventListener(){},
   append(...nodes){for(const n of nodes){n.parentElement=el;children.push(n);}},
   prepend(...nodes){for(const n of nodes){n.parentElement=el;children.unshift(n);}},
   remove(){el.isConnected=false;if(el.parentElement){const i=el.parentElement.children.indexOf(el);if(i>=0)el.parentElement.children.splice(i,1);}},
   matches(){return false;},
   closest(){return null;},
   contains(target){return target===el||children.some(c=>c.contains?.(target));},
   querySelector(){return null;},
   querySelectorAll(){return [];},
   getBoundingClientRect(){return {left:0,top:0,width:1280,height:720,right:1280,bottom:720};},
   classList:{add(){},remove(){},contains(){return false;}}
  };
  return el;
 }
 const rootEl=makeEl('div');rootEl.id='root';
 const bodyEl=makeEl('body');bodyEl.append(rootEl);
 const headEl=makeEl('head');
 const docEl=makeEl('html');
 const origGlobals={window:global.window,document:global.document,getComputedStyle:global.getComputedStyle,MutationObserver:global.MutationObserver,ResizeObserver:global.ResizeObserver,innerWidth:global.innerWidth,innerHeight:global.innerHeight};
 try{
  global.window={};
  global.document={documentElement:docEl,head:headEl,body:bodyEl,createElement:tag=>makeEl(tag),querySelector:sel=>sel==='#root'?rootEl:null,querySelectorAll:()=>[]};
  global.getComputedStyle=()=>({backgroundColor:'rgb(0, 0, 0)',backgroundImage:'none'});
  global.MutationObserver=class{observe(){}disconnect(){}};
  global.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  global.innerWidth=1280;
  global.innerHeight=720;

  await installTheme({
   owner:'glass-owner',
   outputMode:'glass',
   image:'data:image/png;base64,AA==',
   glass:{themeStyle:'star-neko',tint:'#ffffff',veil:50,radius:20,regions:{sidebar:{fill:0,blur:0},content:{fill:0,blur:6},overlay:{fill:0,blur:12},control:{fill:0,blur:12},header:{fill:0,blur:0},bar:{fill:0,blur:12}}},
   font:{accent:'#ea00ff',darkSeparate:false,colors:{main:'#fbf9f9',secondary:'#ffffff',muted:'#fdfdfd',faint:'#ffffff'},colorsDark:{}}
  });
  const baseCss=headEl.children.find(c=>c.id==='agy-dream-style-v2')?.textContent||'';
  const tokenCss=headEl.children.find(c=>c.id==='agy-dream-tokens-v2')?.textContent||'';
  assert.equal(rootEl.getAttribute('data-agy-theme-style'),'star-neko');
  assert.match(baseCss,/\[data-mention-menu\]/);
  assert.match(baseCss,/\[data-agy-theme-style="star-neko"\]/);
  assert.doesNotMatch(baseCss,/\.surface-composer[^\n]*\*:not\([^)]*\) \{background-color:transparent!important/);
  assert.match(baseCss,/\[data-mention-menu\][\s\S]*backdrop-filter/);
  assert.match(baseCss,/\[data-testid="sidecar-iframe-slot"\][\s\S]*backdrop-filter:\s*none\s*!important/);
  assert.match(baseCss,/\.surface-composer\s*\{[\s\S]*overflow:\s*visible\s*!important/);
  assert.match(baseCss,/\.surface-composer\s*>\s*\.surface-composer-card[\s\S]*overflow:\s*hidden\s*!important/);
  assert.match(baseCss,/\.surface-composer[\s\S]*\[data-lexical-editor="true"\][\s\S]*background-color:\s*transparent\s*!important/);
  assert.match(baseCss,/\.bg-sidebar[\s\S]*backdrop-filter:\s*none\s*!important/);
  assert.match(baseCss,/\[data-selected="true"\]/);
  assert.match(baseCss,/pre\[data-agy-dream-protect\]:has\(> \[class\*="rounded-"\]\)[\s\S]*background-color:\s*transparent\s*!important/);
  assert.match(baseCss,/\[data-split-fill-edge="left"\]:has\(> \.agy-sheet\)[\s\S]*overflow:\s*hidden\s*!important/);
  assert.match(baseCss,/\[data-main-content-body="true"\]::before/);
  assert.match(tokenCss,/--lg-filter-sidebar:\s*none/);
  assert.match(tokenCss,/--agy-glass-radius:\s*20px/);
  assert.match(tokenCss,/--agy-radius-outer:/);
  assert.match(tokenCss,/--foreground:\s*#fbf9f9/);
  assert.match(tokenCss,/--secondary-foreground:\s*#ffffff/);
  assert.match(tokenCss,/--muted-foreground:\s*#fdfdfd/);
  assert.match(tokenCss,/--placeholder:\s*#ffffff/);
  assert.match(tokenCss,/--primary:\s*#ea00ff/);
  assert.match(tokenCss,/--glass:/);
  global.window.__agyDreamSkinV2.update({
   owner:'glass-owner',
   outputMode:'glass',
   image:'data:image/png;base64,AA==',
   glass:{themeStyle:'official',tint:'#ffffff',veil:50,radius:12,regions:{sidebar:{fill:0,blur:0},content:{fill:0,blur:6},overlay:{fill:0,blur:12},control:{fill:0,blur:12},header:{fill:0,blur:0},bar:{fill:0,blur:12}}},
   font:{accent:'#ea00ff',darkSeparate:false,colors:{main:'#fbf9f9',secondary:'#ffffff',muted:'#fdfdfd',faint:'#ffffff'},colorsDark:{}}
  });
  assert.equal(rootEl.getAttribute('data-agy-theme-style'),'official');
  assert.match(headEl.children.find(c=>c.id==='agy-dream-tokens-v2')?.textContent||'',/--agy-glass-radius:\s*12px/);
  global.window.__agyDreamSkinV2.destroy();
  assert.equal(headEl.children.some(c=>c.id==='agy-dream-tokens-v2'),false);
 }finally{
  Object.assign(global,origGlobals);
 }
});

test('stale orphaned skin from crashed sidecar is reclaimed while live other owner stays untouched',async()=>{
 const f=fixture();
 f.setState({themed:true,owner:'dead-pid-owner',rev:2,stale:true});
 await f.controller.update({enabled:true,fit:'contain',scrim:12});
 assert.equal(f.writes.length,1);
 assert.equal(f.applied.length,1);
 assert.equal(f.controller.status.applied,true);
 await f.controller.stop();
});

test('LocalMediaServer supports cache ETag 304 and HEAD for smooth 4K loopback streaming',async t=>{
 const {LocalMediaServer}=require('../src/domain/media-server.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dream-cache-'));
 const mp4=path.join(dir,'冬_循环_4K60.mp4');
 fs.writeFileSync(mp4,Buffer.from('ABCDEFGHIJKLMNOP'));
 const srv=new LocalMediaServer();
 await srv.start();
 t.after(()=>srv.stop());
 const url=srv.register(mp4);
 const first=await fetch(url);
 assert.equal(first.status,200);
 assert.match(first.headers.get('cache-control')||'',/private,\s*max-age=/);
 const etag=first.headers.get('etag');
 assert.ok(etag);
 const notModified=await fetch(url,{headers:{'If-None-Match':etag}});
 assert.equal(notModified.status,304);
 const headRes=await fetch(url,{method:'HEAD'});
 assert.equal(headRes.status,200);
 assert.equal(await headRes.text(),'');
});

test('DreamSkinSettings sanitizes videoSmoothMode and chatWidth, and HostController consumes dragged chatWidth via onHostPatch',async()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'dream-chatw-')),'settings.json');
 const s=new DreamSkinSettings(file);
 assert.equal(s.get('videoSmoothMode'),true);
 assert.equal(s.get('chatWidth'),0);
 s.update({videoSmoothMode:false,chatWidth:12});
 assert.equal(s.get('videoSmoothMode'),false);
 assert.equal(s.get('chatWidth'),45);
 s.update({chatWidth:180});
 assert.equal(s.get('chatWidth'),100);
 s.update({chatWidth:0});
 assert.equal(s.get('chatWidth'),0);

 const loaderPayload=new DreamSkinThemeLoader().payload({...s.getAll(),chatWidth:88});
 assert.equal(loaderPayload.chatWidth,88);
 assert.equal(loaderPayload.videoSmoothMode,false);

 let patched=null;
 let applyCount=0;
 let state={ready:'complete',themed:true,owner:'drag-owner',rev:27,stale:false,chatWidth:91};
 const client={
  closed:false,
  async evaluate(expression){
   if(expression.startsWith('({ready:'))return {...state};
   if(expression.startsWith('(async function installTheme')){applyCount++;return {applied:true};}
   if(expression.includes('touch?.()'))return true;
   if(expression.includes('destroy()'))return null;
   throw new Error('Unexpected: '+expression);
  },
  close(){this.closed=true;}
 };
 const hc=new HostController(
  {payload:cfg=>({...cfg,image:'data:image/png;base64,AA=='})},
  ()=>{},
  {
   owner:'drag-owner',
   discover:async()=>({target:{webSocketDebuggerUrl:'ws://127.0.0.1:1/test'}}),
   createClient:()=>client,
   onHostPatch:patch=>{patched=patch;}
  }
 );
 hc.settings={enabled:true,chatWidth:0};
 hc.signature=JSON.stringify(hc.settings);
 await hc.tick();
 assert.deepEqual(patched,{chatWidth:91});
 assert.equal(applyCount,0);
 assert.equal(hc.settings.chatWidth,91);
 await hc.stop();
});

test('installTheme REV 10 eliminates black fades, slims scrollbars, optimizes 4K video blur, and applies custom chatWidth without chrome scrollbar bugs',async()=>{
 const {installTheme}=require('../src/host/theme.cjs');
 function makeEl(tag,extra={}){
  const attrs=new Map(),children=[];
  const el={
   tagName:tag.toUpperCase(),
   id:'',
   children,
   isConnected:true,
   parentElement:null,
   style:{_props:{},setProperty(k,v){this._props[k]=v;},getPropertyValue(k){return this._props[k]||'';},getPropertyPriority(){return '';},removeProperty(k){delete this._props[k];}},
   setAttribute(k,v){if(k==='id')el.id=v;attrs.set(k,String(v));},
   getAttribute(k){return attrs.get(k)??null;},
   hasAttribute(k){return attrs.has(k);},
   removeAttribute(k){attrs.delete(k);},
   addEventListener(){},
   removeEventListener(){},
   append(...nodes){for(const n of nodes){n.parentElement=el;children.push(n);}},
   prepend(...nodes){for(const n of nodes){n.parentElement=el;children.unshift(n);}},
   remove(){el.isConnected=false;if(el.parentElement){const i=el.parentElement.children.indexOf(el);if(i>=0)el.parentElement.children.splice(i,1);}},
   matches(){return false;},
   closest(sel){return extra.closestMatch&&sel.includes(extra.closestMatch)?el:null;},
   contains(target){return target===el||children.some(c=>c.contains?.(target));},
   querySelector(){return null;},
   querySelectorAll(sel){return extra.queryAll&&!String(sel).includes('.surface-composer')?extra.queryAll:[];},
   getBoundingClientRect(){return extra.rect||{left:0,top:0,width:1280,height:720,right:1280,bottom:720};},
   play(){return Promise.resolve();},
   pause(){},
   load(){},
   classList:{add(){},remove(){},contains(){return false;}}
  };
  return el;
 }
 const narrowScrollbar=makeEl('div',{closestMatch:'overlay-scrollbar-thumb',rect:{left:1270,top:10,width:6,height:500,right:1276,bottom:510}});
 const rootEl=makeEl('div',{queryAll:[narrowScrollbar]});rootEl.id='root';
 const bodyEl=makeEl('body');bodyEl.append(rootEl);
 const headEl=makeEl('head');
 const docEl=makeEl('html');
 const origGlobals={window:global.window,document:global.document,getComputedStyle:global.getComputedStyle,MutationObserver:global.MutationObserver,ResizeObserver:global.ResizeObserver,innerWidth:global.innerWidth,innerHeight:global.innerHeight};
 const overlayCalls=[];
 try{
  global.window={electronNative:{setTitleBarOverlay:arg=>overlayCalls.push(arg)}};
  global.document={documentElement:docEl,head:headEl,body:bodyEl,hidden:false,addEventListener(){},removeEventListener(){},createElement:tag=>makeEl(tag),querySelector:sel=>sel==='#root'?rootEl:null,querySelectorAll:()=>[]};
  global.getComputedStyle=()=>({backgroundColor:'rgb(20, 20, 28)',backgroundImage:'none'});
  global.MutationObserver=class{observe(){}disconnect(){}};
  global.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  global.innerWidth=1280;
  global.innerHeight=720;

  await installTheme({
   owner:'rev10-owner',
   outputMode:'transparent',
   mediaKind:'video',
   mediaUrl:'http://127.0.0.1:45555/media?token=abc&path=clip.mp4',
   videoSmoothMode:true,
   chatWidth:88,
   glass:{themeStyle:'star-neko',tint:'#ffffff',veil:0,radius:16,regions:{sidebar:{fill:78,blur:18},content:{fill:60,blur:22},overlay:{fill:68,blur:24},control:{fill:72,blur:14},header:{fill:84,blur:14},bar:{fill:80,blur:14}}},
   font:{accent:'',darkSeparate:false,colors:{},colorsDark:{}}
  });
  const baseCss=headEl.children.find(c=>c.id==='agy-dream-style-v2')?.textContent||'';
  const tokenCss=headEl.children.find(c=>c.id==='agy-dream-tokens-v2')?.textContent||'';
  assert.equal(global.window.__agyDreamSkinV2.rev,27);
  assert.match(baseCss,/\[data-testid="aux-pane-split"\]\s*>\s*div:last-child::before/);
  assert.doesNotMatch(baseCss,/\[data-testid="aux-pane-split"\]\s*>\s*div:last-child::after/);
  assert.match(baseCss,/data-agy-smooth-video="1"[\s\S]*backdrop-filter:\s*blur\(12px\)/);
  assert.doesNotMatch(baseCss,/\[data-testid="sidecar-iframe-slot"\]:has\([^)]*\)::(before|after)/);
  assert.match(baseCss,/\[data-select-popup\]/);
  assert.match(baseCss,/:not\(\.toast-root\):not\(\.toast-viewport \*\)/);
  assert.doesNotMatch(baseCss,/\[role=dialog\][\s\S]{0,120}z-index:\s*9999/);
  assert.equal(docEl.getAttribute('data-agy-smooth-video'),'1');
  assert.match(baseCss,/agy-dream-animating-split/);
  assert.match(tokenCss,/--lg-filter-sidebar:\s*none;/);
  assert.match(baseCss,/\[data-side-panel-body\][\s\S]*background-color:\s*transparent\s*!important/);
  assert.match(baseCss,/\.md-table-bleed\s+\.md-table-host/);
  assert.match(baseCss,/body\[data-has-browser-hole="true"\]/);
  assert.doesNotMatch(baseCss,/div\[style\*="mask-image"\]:has\(\[class\*="terminal-card"\]\)\s*\{[^}]*max-height:/);
  assert.equal(narrowScrollbar.hasAttribute('data-agy-dream-chrome'),false);
  assert.equal(rootEl.getAttribute('data-agy-chat-width'),'custom');
  assert.equal(overlayCalls.length,1);
  assert.equal(overlayCalls[0].color,'#2b2837');
  assert.equal(overlayCalls[0].symbolColor,'#f3edfc');
  assert.match(baseCss,/\[data-testid="overlay-scrollbar-thumb"\][\s\S]*width:\s*3px\s*!important/);
  assert.match(baseCss,/::-webkit-scrollbar\s*\{[\s\S]*width:\s*4px\s*!important/);
  assert.match(baseCss,/\.md-sticky-message-bleed::before/);
  assert.match(baseCss,/from-sidebar/);
  assert.match(baseCss,/\.agy-dream-width-handle\[data-mode="rail"\]/);
  assert.match(baseCss,/--agy-overview-dodge/);
  assert.match(baseCss,/\[data-browser-occluder="true"\]/);
  assert.match(baseCss,/padding:\s*0\s+8px\s+8px\s+0\s*!important/);
  assert.match(baseCss,/z-index:\s*9999\s*!important/);
  assert.match(baseCss,/\[data-testid="title-menu-bar"\][\s\S]*z-index:\s*60\s*!important/);
  assert.doesNotMatch(baseCss,/rgba\(0,\s*0,\s*0,\s*0\.56\)/);
  assert.match(tokenCss,/--agy-chat-width:\s*clamp\(480px,\s*88%/);
  assert.match(tokenCss,/--max-conversation-width:\s*var\(--agy-chat-width\)\s*!important/);
  assert.match(tokenCss,/--lg-filter-content:\s*blur\(10px\);/);
  assert.doesNotMatch(tokenCss,/saturate\(165%\)/);

  global.window.__agyDreamSkinV2.update({
   owner:'rev10-owner',
   outputMode:'transparent',
   mediaKind:'video',
   mediaUrl:'http://127.0.0.1:45555/media?token=abc&path=clip.mp4',
   videoSmoothMode:false,
   chatWidth:0,
   glass:{themeStyle:'star-neko',tint:'#ffffff',veil:0,radius:16,regions:{sidebar:{fill:78,blur:18},content:{fill:60,blur:22},overlay:{fill:68,blur:24},control:{fill:72,blur:14},header:{fill:84,blur:14},bar:{fill:80,blur:14}}},
   font:{accent:'',darkSeparate:false,colors:{},colorsDark:{}}
  });
  const tokenFull=headEl.children.find(c=>c.id==='agy-dream-tokens-v2')?.textContent||'';
  assert.equal(rootEl.getAttribute('data-agy-chat-width'),'default');
  assert.match(tokenFull,/--lg-filter-content:\s*blur\(22px\)\s*saturate\(165%\);/);
  assert.doesNotMatch(tokenFull,/--max-conversation-width:/);
  global.window.__agyDreamSkinV2.destroy();
  assert.deepEqual(overlayCalls[overlayCalls.length-1],{color:'#000000',symbolColor:'#ffffff'});
 }finally{
  Object.assign(global,origGlobals);
 }
});

test('HostController upgrades legacy rev 9 plugin owner while still leaving unrelated live owners untouched',async()=>{
 const applied=[];
 let destroys=0;
 let state={ready:'complete',themed:true,owner:'antigravity-star-suite-plugin',rev:9,stale:false};
 const client={
  closed:false,
  async evaluate(expression){
   if(expression.startsWith('({ready:'))return {...state};
   if(expression.startsWith('(async function installTheme')){
    const payload=JSON.parse(expression.slice(expression.lastIndexOf(')({')+2,-1));
    applied.push(payload);
    state={themed:true,owner:payload.owner,rev:27};
    return {applied:true};
   }
   if(expression.includes('destroy()')){destroys++;state={themed:false};return null;}
   return true;
  },
  close(){this.closed=true;}
 };
 const hc=new HostController(
  {payload:cfg=>({...cfg,image:'data:image/png;base64,AA=='})},
  ()=>{},
  {owner:'antigravity-star-suite-999-abc',discover:async()=>({target:{webSocketDebuggerUrl:'ws://127.0.0.1:1/test'}}),createClient:()=>client}
 );
 await hc.update({enabled:true,fit:'contain',scrim:12});
 assert.equal(destroys,1);
 assert.equal(applied.length,1);
 assert.equal(applied[0].owner,'antigravity-star-suite-999-abc');
 await hc.stop();
});

test('HostController styles third-party plugin iframes (e.g. Swarm) with short-lived connections, blurred sticky header, and heals dropped wallpaper media',async()=>{
 const {installPluginFrameTheme}=require('../src/host/theme.cjs');
 const frameOps=[];
 let frameCloseCount=0;
 let mainApplyCount=0;
 let mainState={ready:'complete',themed:true,mediaHealthy:true,mediaSrc:'http://127.0.0.1:1/media?v=1',owner:'swarm-test',rev:27,stale:false};
 const mainClient={
  closed:false,
  async evaluate(expression){
   if(expression.startsWith('({ready:'))return {...mainState};
   if(expression.startsWith('(async function installTheme')){
    mainApplyCount++;
    mainState={...mainState,mediaHealthy:true,mediaSrc:'http://127.0.0.1:1/media?v=1'};
    return {applied:true,mediaHealthy:true};
   }
   if(expression.includes('touch?.()'))return true;
   if(expression.includes('destroy()'))return {removed:true};
   return {applied:true};
  },
  close(){this.closed=true;}
 };
 const makeFrameClient=()=>({
  closed:false,
  async evaluate(expression){
   frameOps.push(expression);
   if(expression.startsWith('Boolean(window.__agyDreamPluginFrameV2'))return false;
   return {applied:true};
  },
  close(){this.closed=true;frameCloseCount++;}
 });
 const hc=new HostController(
  {payload:cfg=>({...cfg,mediaUrl:'http://127.0.0.1:1/media?v=1',image:'data:image/png;base64,AA=='})},
  ()=>{},
  {
   owner:'swarm-test',
   discover:async()=>({port:55555,target:{webSocketDebuggerUrl:'ws://127.0.0.1:55555/page/1'}}),
   listTargets:async()=>[
    {id:'f-swarm',type:'iframe',url:'plugin://swarm--swarm_board-1/?token=1',webSocketDebuggerUrl:'ws://127.0.0.1:55555/frame/swarm'},
    {id:'f-self',type:'iframe',url:'plugin://antigravity-star-suite--star-suite-1/?token=2',webSocketDebuggerUrl:'ws://127.0.0.1:55555/frame/self'}
   ],
   createClient:url=>url.includes('/frame/swarm')?makeFrameClient():mainClient
  }
 );
 await hc.update({enabled:true,fit:'contain',scrim:12,glass:{themeStyle:'star-neko',radius:16,regions:{content:{fill:60},header:{fill:84}}}});
 assert.equal(frameOps.length,1);
 assert.match(frameOps[0],/installPluginFrameTheme/);
 assert.equal(frameCloseCount,1);
 // Wallpaper media dropped (readyState=0 or error) -> HostController automatically heals on next tick
 mainState={...mainState,mediaHealthy:false};
 await hc.tick();
 assert.equal(mainApplyCount,2);
 // In-place Swarm iframe reload after check interval -> self-heals by re-injecting theme
 hc.frameStates.get('f-swarm').checkedAt=0;
 await hc.tick();
 assert.equal(frameOps.length,3);
 assert.match(frameOps[1],/Boolean\(window\.__agyDreamPluginFrameV2/);
 assert.match(frameOps[2],/installPluginFrameTheme/);
 assert.equal(frameCloseCount,2);
 await hc.update({enabled:false});
 assert.equal(frameOps.length,4);
 assert.match(frameOps[3],/__agyDreamPluginFrameV2\?\.destroy/);
 assert.equal(frameCloseCount,3);
 await hc.stop();

 // Verify installPluginFrameTheme skips loading state and applies seamless unified .header + .toolbar + exact --agy-header-h
 const origDoc=global.document,origWin=global.window,origCS=global.getComputedStyle;
 try{
  const head={children:[],appendChild(n){this.children.push(n);}};
  const docEl={classList:{add(){},remove(){}},getAttribute(){return 'dark';}};
  const boardProps={};
  const boardEl={style:{setProperty(k,v){boardProps[k]=v;},removeProperty(k){delete boardProps[k];}}};
  const headerEl={getBoundingClientRect(){return {height:76.66667};}};
  global.window={devicePixelRatio:1.5};
  global.getComputedStyle=()=>({getPropertyValue:()=>'#ffffff'});
  global.document={readyState:'loading',head,documentElement:docEl,getElementById:id=>id==='board'?boardEl:null,querySelector:sel=>sel==='.header'?headerEl:null,createElement:()=>({id:'',textContent:'',remove(){}})};
  assert.deepEqual(installPluginFrameTheme({owner:'o1',glass:{}}),{applied:false,loading:true});
  global.document.readyState='complete';
  const applied=installPluginFrameTheme({owner:'o1',glass:{themeStyle:'star-neko',radius:16,regions:{content:{fill:60},header:{fill:84}}}});
  assert.equal(applied.applied,true);
  const css=head.children[0]?.textContent||'';
  assert.equal(applied.rev,5);
  assert.equal(boardProps['--agy-header-h'],(Math.floor(76.66667*1.5)/1.5)+'px');
  assert.match(css,/\.board:has\(#tab-feed\.active\)\s*\.header\s*\{[\s\S]*border-bottom:\s*0\s*!important/);
  assert.match(css,/#tab-feed\s*>\s*\.toolbar\s*\{[\s\S]*top:\s*var\(--agy-header-h,\s*var\(--header-h,\s*0px\)\)\s*!important[\s\S]*width:\s*100%\s*!important[\s\S]*margin-inline:\s*0\s*!important[\s\S]*padding-inline:\s*var\(--inline\)\s*!important/);
  assert.match(css,/backdrop-filter:\s*blur\(24px\)/);
  global.window.__agyDreamPluginFrameV2.destroy();
  assert.equal(boardProps['--agy-header-h'],undefined);
 }finally{
  global.document=origDoc;global.window=origWin;global.getComputedStyle=origCS;
 }
});

test('DreamSkinSettings v0.4.0 sanitizes nested features, defaults widgetAutoLaunch false, and redacts API key on export',()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'dream-v040-set-')),'settings.json');
 const s=new DreamSkinSettings(file);
 const init=s.getAll();
 assert.equal(init.widgetAutoLaunch,false);
 assert.equal(init.features.telemetry.enabled,true);
 assert.equal(init.features.telemetry.barMode,'auto');
 assert.equal(init.features.telemetry.vialStyle,'vial');
 assert.equal(init.features.effortSlider.crystalOrchestrator,true);
 assert.equal(init.features.composerBeam.enabled,false);
 assert.equal(init.features.composerBeam.palette,'star-neko');
 assert.equal(init.features.embeddedPet.enabled,true);
 assert.equal(init.features.embeddedPet.scale,100);
 assert.equal(init.features.embeddedPet.dock,'right');
 assert.equal(init.features.embeddedPet.snap,true);
 assert.equal(init.features.motionFx.inkStreamFade,true);
 assert.equal(init.features.motionFx.smoothCaret,false);
 assert.equal(init.features.i18n.mode,'auto');
 assert.equal(init.features.i18n.swarmEnabled,true);
 assert.equal('outlineRail' in init.features.workbench,false);
 assert.equal(init.features.workbench.thoughtTranslate,'off');

 s.update({
  features:{
   telemetry:{barMode:'icons',vialStyle:'bar'},
   composerBeam:{enabled:true,palette:'aurora',quotaHalo:true},
   embeddedPet:{scale:240,opacity:10,dock:'left',snap:false,volume:-5,soundPack:'bubble-pop'},
   i18n:{mode:'on',swarmEnabled:false},
   workbench:{outlineRail:true,compactLayout:true,thoughtTranslate:'openai',thoughtEndpoint:'https://api.example.com/v1',thoughtApiKey:'sk-secret-123'}
  }
 });
 s.update({features:{embeddedPet:{showBubbles:false}}});
 const reloaded=new DreamSkinSettings(file);
 const cfg=reloaded.getAll();
 assert.equal('outlineRail' in cfg.features.workbench,false);
 assert.equal(cfg.features.telemetry.barMode,'icons');
 assert.equal(cfg.features.telemetry.vialStyle,'bar');
 assert.equal(cfg.features.composerBeam.palette,'aurora');
 assert.equal(cfg.features.embeddedPet.scale,160);
 assert.equal(cfg.features.embeddedPet.opacity,20);
 assert.equal(cfg.features.embeddedPet.dock,'left');
 assert.equal(cfg.features.embeddedPet.snap,false);
 assert.equal(cfg.features.embeddedPet.volume,0);
 assert.equal(cfg.features.embeddedPet.soundPack,'bubble-pop');
 assert.equal(cfg.features.embeddedPet.showBubbles,false);
 assert.equal(cfg.features.i18n.mode,'on');
 assert.equal(cfg.features.i18n.swarmEnabled,false);
 assert.equal(cfg.features.workbench.thoughtApiKey,'sk-secret-123');
 const exported=reloaded.exportSanitized();
 assert.equal(exported.features.workbench.thoughtApiKey,'');
});

test('LocalMediaServer serves token-protected /asset files and blocks traversal, bad extensions, and non-loopback hosts',async t=>{
 const {LocalMediaServer}=require('../src/domain/media-server.cjs');
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'dream-asset-'));
 const petDir=path.join(base,'frames');
 const audioDir=path.join(base,'audio');
 const dlgDir=path.join(base,'dialogue');
 fs.mkdirSync(petDir,{recursive:true});
 fs.mkdirSync(audioDir,{recursive:true});
 fs.mkdirSync(dlgDir,{recursive:true});
 fs.writeFileSync(path.join(petDir,'idle.png'),Buffer.from([0x89,0x50,0x4e,0x47]));
 fs.writeFileSync(path.join(audioDir,'original-press.wav'),Buffer.from('RIFF'));
 fs.writeFileSync(path.join(dlgDir,'zh-CN.json'),'{"ok":true}');
 fs.writeFileSync(path.join(base,'secret.txt'),'nope');

 const srv=new LocalMediaServer({assetDirs:{pet:petDir,audio:audioDir,dialogue:dlgDir}});
 await srv.start();
 t.after(()=>srv.stop());

 const okPng=await fetch(`${srv.assetBaseUrl}pet&file=idle.png`);
 assert.equal(okPng.status,200);
 assert.equal(okPng.headers.get('content-type'),'image/png');

 const okWav=await fetch(`${srv.assetBaseUrl}audio&file=original-press.wav`);
 assert.equal(okWav.status,200);
 assert.equal(okWav.headers.get('content-type'),'audio/wav');

 const okDlg=await fetch(`${srv.assetBaseUrl}dialogue&file=zh-CN.json`);
 assert.equal(okDlg.status,200);
 assert.deepEqual(await okDlg.json(),{ok:true});

 const traversal=await fetch(`${srv.baseUrl}/asset?token=${srv.token}&kind=pet&file=..%2Fsecret.txt`);
 assert.equal(traversal.status,403);
 const badKind=await fetch(`${srv.baseUrl}/asset?token=${srv.token}&kind=evil&file=idle.png`);
 assert.equal(badKind.status,403);
 const badExt=await fetch(`${srv.baseUrl}/asset?token=${srv.token}&kind=pet&file=zh-CN.json`);
 assert.equal(badExt.status,403);
 const noAuth=await fetch(`${srv.baseUrl}/asset?token=wrong&kind=pet&file=idle.png`);
 assert.equal(noAuth.status,401);
});

test('HostController injects, hot-updates, and cleans up v0.4.0 feature modules + Swarm i18n without leaking thoughtApiKey',async()=>{
 const {HOST_MODULE_SPECS}=require('../src/domain/host-controller.cjs');
 const specRev=(id)=>HOST_MODULE_SPECS.find(s=>s.id===id)?.rev||1;
 const calls=[];
 const frameCalls=[];
 const liveMap={};
 const fakeModules={
  telemetryBar:function installTelemetryBar(cfg){return {applied:true,cfg};},
  effortSlider:function installEffortSlider(cfg){return {applied:true,cfg};},
  composerBeam:function installComposerBeam(cfg){return {applied:true,cfg};},
  embeddedPet:function installEmbeddedPet(cfg){return {applied:true,cfg};},
  motionFx:function installMotionFx(cfg){return {applied:true,cfg};},
  hostI18n:function installHostI18n(cfg){return {applied:true,cfg};},
  swarmI18n:function installSwarmI18n(cfg){return {applied:true,cfg};},
  workbench:function installWorkbenchEnhancer(cfg){return {applied:true,cfg};},
  revs:{telemetryBar:3,embeddedPet:2,workbench:2,effortSlider:1,composerBeam:1,motionFx:1,hostI18n:1,swarmI18n:1},
 };
 const mainClient={
  closed:false,
  async evaluate(expr){
   calls.push(expr);
   if(expr.startsWith('({ready:'))return {ready:'complete',themed:true,owner:'feat-owner',rev:27,stale:false,mediaHealthy:true};
   if(expr.startsWith('({telemetryBar:'))return {...liveMap};
   if(expr.includes('installTelemetryBar')){liveMap.telemetryBar={owner:'feat-owner',rev:3,stale:false};return {applied:true};}
   if(expr.includes('installEmbeddedPet')){liveMap.embeddedPet={owner:'feat-owner',rev:2,stale:false};return {applied:true};}
   if(expr.includes('installWorkbenchEnhancer')){liveMap.workbench={owner:'feat-owner',rev:2,stale:false};return {applied:true};}
   if(expr.includes('triggerQuip'))return {text:'哼，戳到聪明猫猫了。'};
   if(expr.includes('destroy'))return null;
   return {applied:true};
  },
  close(){this.closed=true;}
 };
 assert.ok(specRev('telemetryBar')>=1&&specRev('embeddedPet')>=1&&specRev('workbench')>=1);
 const frameClient={
  closed:false,
  async evaluate(expr){
   frameCalls.push(expr);
   return {applied:true};
  },
  close(){this.closed=true;}
 };
 const hc=new HostController(
  {payload:cfg=>({...cfg,image:'data:image/png;base64,AA=='})},
  ()=>{},
  {
   owner:'feat-owner',
   featureModules:fakeModules,
   sidecar:{baseUrl:'http://127.0.0.1:43210',token:'tok123',assetBaseUrl:'http://127.0.0.1:43210/asset?token=tok123&kind='},
   discover:async()=>({port:55555,target:{webSocketDebuggerUrl:'ws://127.0.0.1:55555/page/1'}}),
   listTargets:async()=>[{id:'f-sw',type:'iframe',url:'plugin://swarm--swarm_board-1/?t=1',webSocketDebuggerUrl:'ws://127.0.0.1:55555/frame/sw'}],
   createClient:u=>u.includes('/frame/sw')?frameClient:mainClient
  }
 );
 await hc.update({
  enabled:false,
  features:{
   telemetry:{enabled:true,barMode:'auto',vialEnabled:true,vialStyle:'vial',quotaEnabled:true},
   effortSlider:{enabled:false},
   composerBeam:{enabled:false,quotaHalo:false},
   embeddedPet:{enabled:true,scale:110,dock:'right',opacity:100,soundEnabled:true,soundPack:'original',volume:60,showBubbles:true,hideWhenZen:true},
   motionFx:{inkStreamFade:false,semanticAura:false,smoothCaret:false,unreadBadge:false},
   i18n:{mode:'auto',swarmEnabled:true},
   workbench:{codeFold:true,thoughtTranslate:'openai',thoughtApiKey:'sk-never-send-to-dom'}
  }
 });
 assert.ok(calls.some(c=>c.includes('installTelemetryBar')&&c.includes('http://127.0.0.1:43210')));
 assert.ok(calls.some(c=>c.includes('installEmbeddedPet')&&c.includes('/asset?token=tok123&kind=')));
 const wbCall=calls.find(c=>c.includes('installWorkbenchEnhancer'));
 assert.ok(wbCall);
 assert.doesNotMatch(wbCall,/sk-never-send-to-dom/);
 assert.ok(frameCalls.some(c=>c.includes('installSwarmI18n')));

 // Subsequent tick with matching rev:2 telemetryBar & workbench must ONLY touch(), never re-inject or destroy
 const beforeTickLen=calls.length;
 await hc.tick();
 const afterTickCalls=calls.slice(beforeTickLen);
 assert.equal(afterTickCalls.some(c=>c.includes('installTelemetryBar')||c.includes('installWorkbenchEnhancer')||(c.includes('__agyMaomao')&&c.includes('destroy'))),false);
 assert.ok(afterTickCalls.some(c=>c.includes('__agyMaomaoTelemetryBar')&&c.includes('touch?.()')));
 assert.ok(afterTickCalls.some(c=>c.includes('__agyMaomaoWorkbench')&&c.includes('touch?.()')));

 const poke=await hc.pokeEmbeddedPet('petting');
 assert.equal(poke.ok,true);
 assert.match(poke.line,/聪明猫猫/);

 await hc.stop();
 assert.ok(calls.some(c=>c.includes('__agyMaomaoPet')&&c.includes('destroy')));
 assert.ok(frameCalls.some(c=>c.includes('__agyMaomaoSwarmI18n')&&c.includes('destroy')));
});

test('HostController passes hostDark/hostTokens/smoothVideo to Swarm iframe, skips about:blank, backs off stuck OOPIFs (5s->15s->30s), and isolates errors from main skin',async()=>{
 let nowMs=100000;
 let mainDestroyed=0;
 let mainConnects=0;
 const frameAttempts=[];
 let failSwarm=true;
 const mainClient={
  closed:false,
  async evaluate(expr){
   if(expr.startsWith('({ready:')){
    return {
     ready:'complete',themed:true,owner:'stab-owner',rev:27,stale:false,mediaHealthy:true,
     hostDark:true,hostTokens:{'--foreground':'#f3edfc','--border':'rgba(255,255,255,0.12)','--ignored':'bad'}
    };
   }
   if(expr.includes('__agyDreamSkinV2?.destroy')||expr.includes('__agyDreamSkinV2.destroy')){mainDestroyed++;return null;}
   return {applied:true};
  },
  close(){this.closed=true;}
 };
 const makeFrameClient=(url)=>({
  closed:false,
  async evaluate(expr){
   frameAttempts.push({t:nowMs,url,expr});
   if(failSwarm)throw new Error('OOPIF stalled timeout');
   return {applied:true};
  },
  close(){this.closed=true;}
 });
 const hc=new HostController(
  {payload:cfg=>({...cfg,image:'data:image/png;base64,AA=='})},
  ()=>{},
  {
   owner:'stab-owner',
   now:()=>nowMs,
   discover:async()=>{mainConnects++;return {port:55555,target:{webSocketDebuggerUrl:'ws://127.0.0.1:55555/page/1'}};},
   listTargets:async()=>[
    {id:'f-blank',type:'iframe',url:'about:blank',webSocketDebuggerUrl:'ws://127.0.0.1:55555/frame/blank'},
    {id:'f-empty',type:'iframe',url:'',webSocketDebuggerUrl:'ws://127.0.0.1:55555/frame/empty'},
    {id:'f-swarm',type:'iframe',url:'plugin://swarm--swarm_board-1/?t=1',webSocketDebuggerUrl:'ws://127.0.0.1:55555/frame/swarm'}
   ],
   createClient:u=>u.includes('/frame/')?makeFrameClient(u):mainClient
  }
 );
 await hc.update({enabled:true,mediaType:'video',videoSmoothMode:true,glass:{themeStyle:'star-neko'}});
 // 1st failure -> 5s backoff; about:blank & empty skipped completely
 assert.equal(frameAttempts.length,1);
 assert.ok(frameAttempts.every(a=>a.url.includes('/frame/swarm')));
 assert.equal(mainDestroyed,0);
 assert.equal(mainConnects,1);
 assert.equal(hc.client,mainClient);
 assert.equal(hc.frameBackoff.get('f-swarm').delay,5000);

 // 2.5s later -> still inside 5s cooldown, must NOT touch stuck OOPIF
 nowMs+=2500;
 await hc.tick();
 assert.equal(frameAttempts.length,1);

 // At +5s -> 2nd failure -> 15s backoff
 nowMs+=2500;
 await hc.tick();
 assert.equal(frameAttempts.length,2);
 assert.equal(hc.frameBackoff.get('f-swarm').delay,15000);

 // At +10s -> still in 15s backoff
 nowMs+=10000;
 await hc.tick();
 assert.equal(frameAttempts.length,2);

 // At +15s -> 3rd failure -> 30s backoff
 nowMs+=5000;
 await hc.tick();
 assert.equal(frameAttempts.length,3);
 assert.equal(hc.frameBackoff.get('f-swarm').delay,30000);

 // At +30s -> Swarm recovers, payload includes hostDark + sanitized hostTokens + smoothVideo, backoff cleared
 failSwarm=false;
 nowMs+=30000;
 await hc.tick();
 assert.equal(frameAttempts.length,4);
 assert.equal(hc.frameBackoff.has('f-swarm'),false);
 const payloadExpr=frameAttempts[3].expr;
 assert.match(payloadExpr,/"hostDark":true/);
 assert.match(payloadExpr,/"--foreground":"#f3edfc"/);
 assert.doesNotMatch(payloadExpr,/--ignored/);
 assert.match(payloadExpr,/"smoothVideo":true/);

 // Main client never disconnected or destroyed during OOPIF storms
 assert.equal(mainConnects,1);
 assert.equal(mainDestroyed,0);

 // Healthy steady-state re-check interval is 15s (not triggered at 10s, triggered at 15s)
 nowMs+=10000;
 await hc.tick();
 assert.equal(frameAttempts.length,4);
 nowMs+=5000;
 await hc.tick();
 assert.equal(frameAttempts.length,5);
 assert.match(frameAttempts[4].expr,/rev===5/);

 await hc.stop();
});

test('HostController detects AGY build/version changes across restarts and reloads host + Swarm i18n with override dict',async()=>{
 const tmpDir=fs.mkdtempSync(path.join(os.tmpdir(),'dream-agy-ver-'));
 const stateFile=path.join(tmpDir,'host-state.json');
 fs.writeFileSync(stateFile,JSON.stringify({lastHostBuild:'2.34.0|Electron/44|orig',agyVersion:'2.34.0'}),'utf8');

 const mainOps=[];
 const swarmOps=[];
 const mainClient={
  closed:false,
  async evaluate(expr){
   mainOps.push(expr);
   if(expr.startsWith('({ready:')){
    return {
     ready:'complete',themed:false,owner:'',rev:0,stale:false,
     hostDark:true,hostTokens:{},
     hostBuild:{agyVersion:'2.35.1',fingerprint:'2.35.1|Electron/45|new-bundle'}
    };
   }
   if(expr.startsWith('({telemetryBar:'))return {hostI18n:{owner:'ver-owner',rev:3,stale:false}};
   if(expr.includes('__agyMaomaoHostI18n.reload'))return {ok:true,dictSize:42,reloadedAt:Date.now()};
   return {applied:true,dictSize:42};
  },
  close(){this.closed=true;}
 };
 const swarmClient={
  closed:false,
  async evaluate(expr){
   swarmOps.push(expr);
   if(expr.includes('__agyMaomaoSwarmI18n')&&expr.includes('.reload'))return {ok:true,active:true};
   return {applied:true};
  },
  close(){this.closed=true;}
 };
 const hc=new HostController(
  {payload:cfg=>({...cfg,image:'data:image/png;base64,AA=='})},
  ()=>{},
  {
   owner:'ver-owner',
   hostStateFile:stateFile,
   getI18nOverrideDict:()=>({'Quick Action':'快捷动作'}),
   featureModules:{
    hostI18n:function installHostI18n(cfg){return {applied:true,cfg};},
    swarmI18n:function installSwarmI18n(cfg){return {applied:true,cfg};},
    revs:{hostI18n:3,swarmI18n:2}
   },
   discover:async()=>({port:55555,target:{webSocketDebuggerUrl:'ws://127.0.0.1:55555/page/1'}}),
   listTargets:async()=>[{id:'f-sw',type:'iframe',url:'plugin://swarm--board/?t=1',webSocketDebuggerUrl:'ws://127.0.0.1:55555/frame/sw'}],
   createClient:u=>u.includes('/frame/sw')?swarmClient:mainClient
  }
 );

 await hc.update({enabled:false,features:{i18n:{mode:'auto',swarmEnabled:true}}});
 assert.equal(hc.agyVersion,'2.35.1');
 assert.ok(hc.lastAgyUpgradeReloadAt>0);
 assert.ok(mainOps.some(e=>e.includes('installHostI18n')&&e.includes('Quick Action')));
 assert.ok(swarmOps.some(e=>e.includes('installSwarmI18n')&&e.includes('Quick Action')));
 const persisted=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 assert.equal(persisted.lastHostBuild,'2.35.1|Electron/45|new-bundle');
 assert.equal(persisted.agyVersion,'2.35.1');

 // Manual reloadI18n uses zero-flicker reload() on both host and Swarm iframe
 const reloadRes=await hc.reloadI18n({extraDict:{'New Feature':'新功能'}});
 assert.equal(reloadRes.ok,true);
 assert.equal(reloadRes.agyVersion,'2.35.1');
 assert.equal(reloadRes.swarmFramesReloaded,1);
 assert.ok(mainOps.some(e=>e.includes('__agyMaomaoHostI18n.reload')&&e.includes('New Feature')));
 assert.ok(swarmOps.some(e=>e.includes('.reload')&&e.includes('New Feature')));
 await hc.stop();
});

test('installUpdateToast serializes via toString(), mounts inside .toast-viewport with .agy-toast, adapts 4 surfaces, dodges cat pet, and handles update/dismiss',async()=>{
 const vm=require('node:vm');
 const {installUpdateToast,UPDATE_TOAST_KEY,UPDATE_TOAST_REV}=require('../src/host/modules/update-toast.cjs');
 assert.equal(UPDATE_TOAST_KEY,'__agyMaomaoUpdateToast');
 assert.equal(UPDATE_TOAST_REV,2);

 function makeEl(tag){
  const attrs=new Map();
  const listeners=new Map();
  const styleProps=new Map();
  const el={
   tagName:String(tag||'div').toUpperCase(),
   id:'',
   className:'',
   textContent:'',
   type:'',
   disabled:false,
   parentNode:null,
   children:[],
   classList:{
    _set:new Set(),
    add(...xs){xs.forEach(x=>this._set.add(x));},
    remove(...xs){xs.forEach(x=>this._set.delete(x));},
    contains(x){return this._set.has(x);},
   },
   style:{
    setProperty(k,v){styleProps.set(k,v);},
    getPropertyValue(k){return styleProps.get(k)||'';},
   },
   setAttribute(k,v){attrs.set(k,String(v));},
   getAttribute(k){return attrs.has(k)?attrs.get(k):null;},
   appendChild(c){c.parentNode=el;el.children.push(c);return c;},
   append(...cs){cs.forEach(c=>el.appendChild(c));},
   remove(){if(el.parentNode){const i=el.parentNode.children.indexOf(el);if(i>=0)el.parentNode.children.splice(i,1);el.parentNode=null;}},
   addEventListener(ev,fn){if(!listeners.has(ev))listeners.set(ev,[]);listeners.get(ev).push(fn);},
   click(){return Promise.all((listeners.get('click')||[]).map(fn=>fn()));},
   find(pred){
    if(pred(el))return el;
    for(const c of el.children){const r=c.find(pred);if(r)return r;}
    return null;
   },
  };
  return el;
 }

 const head=makeEl('head');
 const body=makeEl('body');
 const html=makeEl('html');
 html.classList.add('dark','agy-dream-active-v2');
 const viewport=makeEl('div');
 viewport.className='toast-viewport';
 body.appendChild(viewport);

 const petStage={getBoundingClientRect:()=>({left:1080,top:560,right:1260,bottom:705,width:180,height:145})};
 let bubbleOpen=false;
 const petBubble={
  getBoundingClientRect:()=>bubbleOpen
   ? {left:1005,top:352,right:1254,bottom:526,width:249,height:174}
   : {left:1005,top:352,right:1254,bottom:526,width:0,height:0},
 };
 const petRoot={
  id:'agy-maomao-pet-root',
  shadowRoot:{
   querySelector:(s)=>{
    if(s==='.pet-stage')return petStage;
    if(s==='.pet-bubble')return petBubble;
    if(s==='.pet-bubble[data-open="true"]')return bubbleOpen?petBubble:null;
    return null;
   },
  },
 };

 const observers=[];
 class FakeMutationObserver{
  constructor(cb){this.cb=cb;this.targets=[];this.disconnected=false;observers.push(this);}
  observe(target,opts){this.targets.push({target,opts});}
  disconnect(){this.disconnected=true;}
 }

 const fetchCalls=[];
 const sandbox={
  MutationObserver:FakeMutationObserver,
  window:{
   innerWidth:1280,
   innerHeight:720,
   addEventListener(){},
   removeEventListener(){},
  },
  document:{
   documentElement:html,
   head,
   body,
   createElement:makeEl,
   getElementById(id){
    if(id==='agy-maomao-pet-root')return petRoot;
    return head.find(e=>e.id===id)||body.find(e=>e.id===id);
   },
   querySelector(sel){return sel==='.toast-viewport'?viewport:null;},
  },
  fetch:async(url,init)=>{
   fetchCalls.push({url,init});
   return {ok:true,status:200,json:async()=>({ok:true,toVersion:'0.4.2'})};
  },
  setTimeout:(fn)=>({fn}),
  clearTimeout:()=>{},
  requestAnimationFrame:(fn)=>fn(),
 };

 const runInVm=(payload)=>vm.runInNewContext(`(${installUpdateToast.toString()})(${JSON.stringify(payload)})`,sandbox);

 // 1. Mount inside .toast-viewport with glass-dark surface and cat-pet dodge (closed bubble -> dodges stage only)
 const res1=runInVm({
  owner:'o1',
  currentVersion:'0.4.0',
  latestVersion:'0.4.2',
  releaseNotes:'新增底部更新提示\n修复气泡交互',
  downloadUrl:'https://github.com/Fish-under-sea/Antigravity-maomao/releases/download/v0.4.2/pkg.zip',
  sidecarBaseUrl:'http://127.0.0.1:45678',
  sidecarToken:'tok-xyz',
 });
 assert.equal(res1.shown,true);
 assert.equal(res1.rev,2);
 assert.equal(res1.target,'toast-viewport');
 assert.equal(res1.surface,'glass-dark');
 assert.equal(res1.dodgePx,172);
 const toastNode=viewport.children.find(c=>c.id==='agy-maomao-update-toast');
 assert.ok(toastNode);
 assert.equal(toastNode.className,'agy-toast');
 assert.equal(toastNode.style.getPropertyValue('--agy-mm-upd-offset'),'172px');

 // 1b. Pet speech/quota bubble opens dynamically AFTER toast mounted -> MutationObserver lifts toast above bubble top!
 const bubbleObs=observers.find(o=>o.targets.some(t=>t.target===petBubble&&t.opts?.subtree===false));
 assert.ok(bubbleObs,'must observe .pet-bubble with subtree:false');
 bubbleOpen=true;
 bubbleObs.cb();
 assert.equal(toastNode.style.getPropertyValue('--agy-mm-upd-offset'),'380px');
 assert.equal(sandbox.window.__agyMaomaoUpdateToast.status().dodgePx,380);
 // Bubble closes -> toast returns cleanly above .pet-stage
 bubbleOpen=false;
 bubbleObs.cb();
 assert.equal(toastNode.style.getPropertyValue('--agy-mm-upd-offset'),'172px');

 // 2. Clicking "稍后" records dismissed version -> repeat call is deduplicated
 const laterBtn=toastNode.find(e=>e.getAttribute('data-action')==='later');
 assert.ok(laterBtn);
 await laterBtn.click();
 assert.equal(sandbox.window.__agyMaomaoUpdateToastDismissedVer,'0.4.2');
 sandbox.window.__agyMaomaoUpdateToast.destroy();
 assert.equal(bubbleObs.disconnected,true,'destroy() must disconnect petBubbleObs');
 const dedupRes=runInVm({owner:'o1',latestVersion:'0.4.2'});
 assert.equal(dedupRes.shown,false);
 assert.equal(dedupRes.deduplicated,true);

 // 3. Force show in light mode (no glass) and click "立即更新" -> calls POST /api/maomao/update/apply
 html.classList.remove('dark','agy-dream-active-v2');
 html.classList.add('light');
 const res2=runInVm({
  owner:'o1',
  currentVersion:'0.4.0',
  latestVersion:'0.4.2',
  downloadUrl:'https://github.com/Fish-under-sea/Antigravity-maomao/releases/download/v0.4.2/pkg.zip',
  sidecarBaseUrl:'http://127.0.0.1:45678',
  sidecarToken:'tok-xyz',
  forceShow:true,
 });
 assert.equal(res2.shown,true);
 assert.equal(res2.surface,'light');
 const toastNode2=viewport.children.find(c=>c.id==='agy-maomao-update-toast');
 const updateBtn=toastNode2.find(e=>e.getAttribute('data-action')==='update');
 await updateBtn.click();
 assert.equal(fetchCalls.length,1);
 assert.equal(fetchCalls[0].url,'http://127.0.0.1:45678/api/maomao/update/apply?token=tok-xyz');
 assert.equal(fetchCalls[0].init.method,'POST');
 assert.equal(updateBtn.textContent,'已安装，重载中…');

 // 4. Prefers host-native toast callback when exposed
 let nativeArgs=null;
 sandbox.window.__agyNativeToast=(args)=>{nativeArgs=args;return true;};
 const resNative=runInVm({owner:'o1',latestVersion:'0.4.3',releaseNotes:'Native check'});
 assert.equal(resNative.shown,true);
 assert.equal(resNative.target,'native-api');
 assert.equal(nativeArgs.version,'0.4.3');
});

test('HostController.showHostUpdateToast degrades gracefully when disconnected, deduplicates per version, and destroys toast on stop',async()=>{
 const ops=[];
 const mainClient={
  closed:false,
  async evaluate(expr){
   ops.push(expr);
   if(expr.startsWith('({ready:'))return {ready:'complete',themed:false,owner:'',rev:0,stale:false};
   if(expr.includes('installUpdateToast'))return {shown:true,target:'toast-viewport',surface:'dark',dodgePx:120};
   return null;
  },
  close(){this.closed=true;}
 };
 const hc=new HostController(
  {payload:cfg=>({...cfg,image:'data:image/png;base64,AA=='})},
  ()=>{},
  {
   owner:'toast-owner',
   sidecar:{baseUrl:'http://127.0.0.1:49999',token:'tok-9'},
   discover:async()=>({port:55555,target:{webSocketDebuggerUrl:'ws://127.0.0.1:55555/page/1'}}),
   listTargets:async()=>[],
   createClient:()=>mainClient,
  }
 );

 // Disconnected -> graceful degradation
 const offRes=await hc.showHostUpdateToast({hasUpdate:true,latestVersion:'0.4.2'});
 assert.equal(offRes.ok,false);
 assert.equal(offRes.reason,'host_disconnected');

 // Connect then trigger toast
 await hc.update({enabled:false});
 const show1=await hc.showHostUpdateToast({
  hasUpdate:true,
  currentVersion:'0.4.0',
  latestVersion:'v0.4.2',
  releaseNotes:'新功能发布',
  downloadUrl:'https://github.com/Fish-under-sea/Antigravity-maomao/releases/download/v0.4.2/pkg.zip',
 });
 assert.equal(show1.ok,true);
 assert.equal(show1.shown,true);
 assert.equal(show1.version,'0.4.2');
 assert.equal(show1.dodgePx,120);
 assert.ok(ops.some(e=>e.includes('installUpdateToast')&&e.includes('http://127.0.0.1:49999')));

 // Same version deduplicated without force
 const opsCountBeforeDedup=ops.length;
 const show2=await hc.showHostUpdateToast({hasUpdate:true,latestVersion:'0.4.2'});
 assert.equal(show2.ok,true);
 assert.equal(show2.shown,false);
 assert.equal(show2.deduplicated,true);
 assert.equal(ops.length,opsCountBeforeDedup);

 // Force bypasses dedup
 const show3=await hc.showHostUpdateToast({hasUpdate:true,latestVersion:'0.4.2',force:true});
 assert.equal(show3.shown,true);
 assert.ok(ops.length>opsCountBeforeDedup);

 // stop() cleans up the mounted update toast
 await hc.stop();
 assert.ok(ops.some(e=>e.includes('__agyMaomaoUpdateToast?.destroy?.()')));
});
