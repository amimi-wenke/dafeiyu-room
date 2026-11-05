const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict");
const html=fs.readFileSync("index.html","utf8");
const assets=JSON.parse(html.match(/<script id="character-assets" type="application\/json">([\s\S]*?)<\/script>/)[1]);
assert.equal(Object.keys(assets).length,19);
for(const [key,url] of Object.entries(assets))assert.deepEqual(Buffer.from(url.split(",")[1],"base64"),fs.readFileSync("assets/"+key+".png"));
class Element{
 constructor(){this.dataset={};this.attributes={};this.events={};this.style={setProperty(k,v){this[k]=v}};this.hidden=false;this.width=1672;this.height=941;this._classes=new Set();this.classList={toggle:(k,on)=>on?this._classes.add(k):this._classes.delete(k),contains:k=>this._classes.has(k),remove:k=>this._classes.delete(k),add:k=>this._classes.add(k)};this.context={globalAlpha:1,draws:[],clearRect(){},drawImage(image,...args){this.draws.push({src:image.src,alpha:this.globalAlpha,args})}};}
 getContext(){return this.context;}getAttribute(k){return this.attributes[k];}setAttribute(k,v){this.attributes[k]=String(v)}set src(v){this.attributes.src=v}get src(){return this.attributes.src}addEventListener(k,cb){this.events[k]=cb}click(){this.events.click?.({target:this})}getBoundingClientRect(){return {left:0,top:0,width:100,height:100}}
}
let now=0,id=0,hour=12,defer=false,failSource="";
const held=new Map(),frames=new Map(),timers=new Map(),intervals=[];
const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>["#"+m[1],new Element()]));
nodes.get("#character-assets").textContent=JSON.stringify(assets);
const actions=[...new Set([...html.matchAll(/data-action="([^"]+)"/g)].map(m=>m[1]))].map(a=>{const e=new Element();e.dataset.action=a;return e;});
const document={querySelector:s=>nodes.get(s),querySelectorAll:()=>actions,body:new Element(),hidden:false,createElement:()=>new Element(),addEventListener(){}};
const eventHandlers=new Map(), published=[];
const window={addEventListener:(type,fn)=>eventHandlers.set(type,fn),dispatchEvent:event=>{published.push(event);eventHandlers.get(event.type)?.(event)}};
const CustomEvent=class{constructor(type,options={}){this.type=type;this.detail=options.detail}};
const context=vm.createContext({document,window,CustomEvent,Intl,Date:class extends Date{getHours(){return hour}static now(){return now}},Math,Map,JSON,performance:{now:()=>now},matchMedia:()=>({matches:false}),requestAnimationFrame:cb=>{frames.set(++id,cb);return id},cancelAnimationFrame:i=>frames.delete(i),setTimeout:(cb,d)=>{timers.set(++id,{cb,due:now+d});return id},clearTimeout:i=>timers.delete(i),setInterval:(cb,d)=>intervals.push({cb,d}),URL,Image:class{decode(){if(this.src===failSource)return Promise.reject(Error("decode"));if(defer)return new Promise((resolve,reject)=>held.set(this.src,{resolve,reject}));return Promise.resolve();}}});
const run=code=>vm.runInContext(code,context);
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
const flush=()=>{let n=0;while(frames.size){assert.ok(++n<12000,"frames failed to settle");const pending=[...frames.values()];frames.clear();now+=40;pending.forEach(cb=>cb(now));if(run("actor.state")==="walk")assert.ok(run("actor.y<=85"),"walking feet must stay inside floor front");}};
const action=name=>run("perform("+JSON.stringify(name)+")");
const settleRoutine=()=>{let n=0;while(run("routineActive")){assert.ok(++n<150,"routine failed to complete");flush();if(!run("routineActive"))break;const next=[...timers.entries()].sort((a,b)=>a[1].due-b[1].due)[0];assert.ok(next,"routine has no continuation");timers.delete(next[0]);now=Math.max(now,next[1].due);next[1].cb();}flush();};
(async()=>{
 vm.runInContext(fs.readFileSync("room.js","utf8"),context);
 await tick();flush();
 assert.equal(run("lightingKey"),"room-day-off");
 assert.equal(nodes.get("#room-image").hidden,true);assert.equal(nodes.get("#cooker-image").src,assets["rice-cooker"]);
 const drawing=nodes.get("#room-canvas").context;
 nodes.get("#lamp").click();await tick();
 assert.ok(frames.size>0,"lamp must animate");
 const pending=[...frames.values()];frames.clear();now+=900;pending.forEach(cb=>cb(now));
 assert.ok(drawing.draws.some(d=>d.alpha>0&&d.alpha<1),"must draw intermediate blend");
 flush();assert.equal(drawing.draws.at(-1).src,assets.room);
 nodes.get("#lamp").click();await tick();flush();assert.equal(drawing.draws.at(-1).src,assets["room-day-off"]);
 defer=true;
 run("phase='night';lampOverride=false;updateLamp()");
 run("phase='day';updateLamp()");
 await tick();flush();
 held.get(assets["room-night-off"]).resolve();await tick();flush();
 assert.equal(drawing.draws.at(-1).src,assets["room-day-off"],"stale decode must not replace latest request");
 defer=false;
 failSource=assets["room-night-on"];
 run("phase='night';lampOverride=true;updateLamp()");await tick();
 assert.match(nodes.get("#speech").textContent,/灯光没有读取成功/);
 failSource="";run("updateLamp()");await tick();flush();assert.equal(drawing.draws.at(-1).src,assets["room-night-on"]);
 assert.ok(run("[...floorGrid.values()].every(c=>floorRoute({x:50,y:76},c)!==null)"),"walkable floor must be connected");
 assert.ok(run("!isWalkable(20,80)"),"table must block floor");assert.ok(run("!isWalkable(50,91)"),"former escaping click must be outside walkable floor");assert.ok(run("[...floorGrid.values()].every(c=>c.y<=84)"));
 for(const name of ["read","computer","tea","snack","rice","stretch","window","feed","water","dance","sleep"]){action(name);flush();assert.equal(run("actor.state"),name,name);}
 action("tour");settleRoutine();assert.equal(run("actor.state"),"idle");
 action("choosebook");settleRoutine();assert.equal(run("actor.state"),"idle");
 action("roam");settleRoutine();assert.equal(run("actor.state"),"idle");
 action("tour");flush();action("pet");flush();assert.equal(run("routineActive"),false);
 const stale=[...timers.values()];timers.clear();stale.forEach(t=>t.cb());flush();assert.equal(run("actor.state"),"idle");
 action("away");flush();assert.equal(run("actor.state"),"away");nodes.get("#return-home").click();flush();assert.equal(run("actor.state"),"idle");
 for(const p of ["morning","day","dusk","night"]){nodes.get("#time-mode").click();await tick();flush();assert.equal(document.body.dataset.phase,p);}
 nodes.get("#time-mode").click();await tick();flush();assert.equal(nodes.get("#time-mode").textContent,"◷ 跟随时间");
 assert.equal(nodes.get("#pet-zone").style.bottom,(100-run("actor.y"))+"%");assert.equal(nodes.get("#pet-zone").style.top,undefined);run("setState('read')");
 window.dispatchEvent(new CustomEvent("dafeiyu:dsh-reply",{detail:{text:"你好"}}));
 assert.equal(run("actor.state"),"read","chat must preserve activity");
 window.dispatchEvent(new CustomEvent("dafeiyu:room-command",{detail:{id:"fixture-rice",action:"rice"}}));flush();
 assert.equal(run("actor.state"),"rice"); assert.equal(run("lastCommand.status"),"arrived");
 assert.ok(published.some(e=>e.type==="dafeiyu:room-state"&&e.detail.activity==="rice"));
 window.dispatchEvent(new CustomEvent("dafeiyu:room-command",{detail:{id:"fixture-lamp",action:"lamp-off"}}));
 assert.equal(run("lampOverride"),false);assert.equal(run("lastCommand.status"),"arrived");
 assert.ok(!html.includes('id="swap-sprite"')&&!html.includes('class="activity-bar"'));
 console.log("PASS: 19 embedded assets, rice cooker and eating action, foot anchoring, old outside-floor click rejected, connected inset floor, movement limits, lights and routine regressions");
})().catch(e=>{console.error(e);process.exitCode=1});

