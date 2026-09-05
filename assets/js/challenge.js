/* Challenge engine v2: emphatic verdicts, salted SHA-256 grading, hint ladder. */
(() => {
'use strict';
const K='deuterium-solves',A='deuterium-attempts',H='deuterium-hints',M='deuterium-challenge-mute',P='flag-check__',F=/^flag\{[^{}]+\}$/,T=' ✓',D=document,ce=t=>D.createElement(t),L=localStorage;
const get=(k,d)=>{try{return JSON.parse(L.getItem(k))??d}catch(_){return d}};
const put=(k,v)=>{try{L.setItem(k,JSON.stringify(v))}catch(_){}};
const num=k=>{try{return +sessionStorage.getItem(k)||0}catch(_){return 0}};
const set=(k,v)=>{try{sessionStorage.setItem(k,v)}catch(_){}};
D.head.appendChild(Object.assign(ce('link'),{rel:'stylesheet',href:'/assets/css/features/challenge.css?v='+window.__deuteriumAssetVersion}));
const Q=matchMedia('(prefers-reduced-motion:reduce)');
let mute=!!get(M,0),ac;
const chime=()=>{if(mute)return;try{
ac=ac||new globalThis.AudioContext;
const t0=ac.currentTime+.02;
[660,880].forEach((hz,i)=>{const t=t0+i*.15,o=ac.createOscillator(),g=ac.createGain();
o.frequency.value=hz;g.gain.setValueAtTime(.2,t);g.gain.linearRampToValueAtTime(1e-4,t+.3);
o.connect(g).connect(ac.destination);o.start(t);o.stop(t+.32)});
}catch(_){}};
const burst=box=>{
const s=getComputedStyle(D.documentElement);
const cs=['--shell','--pink','--yellow'].map(n=>s.getPropertyValue(n));
const d=devicePixelRatio||1,w=innerWidth,h=innerHeight,c=ce('canvas');
c.className='confetti';c.width=w*d;c.height=h*d;D.body.appendChild(c);
const x=c.getContext('2d');x.scale(d,d);
const r=box.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/3,p=[];
for(let i=0;i<110;i++){const a=-1.57+(Math.random()-.5)*2.4,v=4+Math.random()*9;
p.push([cx,cy,Math.cos(a)*v,Math.sin(a)*v,5+Math.random()*6,0,.2*(Math.random()-.5),cs[i%cs.length]]);}
let t0;
const tk=t=>{const e=t-(t0??=t);
x.clearRect(0,0,w,h);
for(const q of p){q[0]+=q[2];q[1]+=q[3];q[3]+=.3;q[5]+=q[6];
const z=q[4];x.save();x.translate(q[0],q[1]);x.rotate(q[5]);x.fillStyle=q[7];x.fillRect(-z/2,-z/4,z,z/2);x.restore();}
e<1400?requestAnimationFrame(tk):c.remove();};
requestAnimationFrame(tk);};
const flair=()=>{const h=D.querySelector('.record-head');
if(h&&!h.querySelector('.solved-badge')){const b=ce('p');b.className='solved-badge';b.textContent='challenge cleared';h.appendChild(b);}
D.title.endsWith(T)||(D.title+=T);};
const hex=buf=>[...new Uint8Array(buf)].map(v=>v.toString(16).padStart(2,0)).join('');
const grade=async(f,x)=>{
const want=(f.dataset.sha256||'').toLowerCase();
if(want){const g=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x+(f.dataset.salt||'')));return hex(g)===want;}
return f.dataset.answer===x;};
const done=(f,v,o,at,live)=>{
v.textContent='CLEARED - '+new Date(at).toLocaleString();v.className=P+'verdict is-clear';
o.textContent='Correct. The flag matches.';o.className=P+'result is-correct';
f.classList.add('is-solved');
live&&(Q.matches?f.classList.add('is-ribbon'):burst(f),chime());
flair();};
const solves=get(K,{}),tries=get(A,{}),spent=get(H,{});
D.querySelectorAll('[data-flag-check]').forEach((f)=>{
const i=f.querySelector('[data-flag-input]'),b=f.querySelector('button[type="submit"]'),o=f.querySelector('output');
if(!i||!b||!o)return;
const id=i.id?i.id.slice(5):(f.dataset.sha256||f.dataset.answer||'challenge');
const v=ce('p');v.className=P+'verdict';v.setAttribute('role','status');v.setAttribute('aria-live','polite');
f.insertBefore(v,o);
const s=ce('button');s.type='button';s.className=P+'sound';
const paint=()=>{s.textContent=mute?'Muted':'Sound';s.ariaPressed=mute;};
s.onclick=()=>{mute=!mute;put(M,mute);paint();};paint();f.appendChild(s);
let hs=[...D.querySelectorAll('[data-hint-for="'+id+'"]')];
if(!hs.length&&D.querySelectorAll('[data-flag-check]').length===1)hs=[...D.querySelectorAll('[data-hint]:not([data-hint-for])')];
hs.sort((x,y)=>+x.dataset.hint-+y.dataset.hint);
const strip=ce('div');strip.className=P+'hints';
const tease=()=>{hs.forEach(h=>h.classList.add('is-highlighted'));strip.classList.add('is-highlighted');};
(spent[id]||[]).forEach(k=>{const h=hs[k-1];h&&(h.hidden=false,h.classList.add('is-revealed'));});
hs.forEach((h,n)=>{const k=n+1,t=ce('button');
t.type='button';t.className=P+'hint';t.textContent='hint '+k+' of '+hs.length;
const open=()=>{h.hidden=false;h.classList.add('is-revealed');t.classList.add('is-used');t.disabled=true;t.textContent='hint '+k+' of '+hs.length+' - used';};
(spent[id]||[]).includes(k)?open():t.onclick=()=>{open();spent[id]=[...(spent[id]||[]),k];put(H,spent);};
strip.appendChild(t);});
hs.length&&f.appendChild(strip);
let n=0;
const wrong=(c,m)=>{v.className=P+'verdict '+c;v.textContent=m;i.classList.add('is-bad');
f.classList.remove('is-shaking');void f.offsetWidth;f.classList.add('is-shaking');};
f.addEventListener('submit',async(e)=>{
e.preventDefault();
const x=i.value.trim();
if(!x){v.className=P+'verdict is-format';v.textContent='Enter a flag first.';i.focus();return;}
const a=++n,label=b.textContent;
b.disabled=true;b.textContent='checking...';
try{
const ok=await grade(f,x);
if(a!==n)return;
const att=num('flag-att:'+id)+1;set('flag-att:'+id,att);
tries[id]=Math.max(tries[id]||0,att);put(A,tries);
D.dispatchEvent(new CustomEvent('deuterium:attempt',{detail:{id,attempt:att,correct:ok}}));
if(ok){
const at=new Date().toISOString();solves[id]={at,flag:x};put(K,solves);
i.classList.remove('is-bad');done(f,v,o,at,true);
D.dispatchEvent(new CustomEvent('deuterium:solved',{detail:{id,at}}));return;}
const z=x.length>56?x.slice(0,53)+'...':x;
if(!F.test(x)){wrong('is-format','WRONG FORMAT - flags look like flag{...} (lowercase, one pair of braces). attempt '+att+'.');att>2&&tease();}
else if(att>2){wrong('is-again','WRONG AGAIN - hint available below. attempt '+att+'.');tease();}
else wrong('is-wrong','WRONG FLAG - not '+z+': the format is right, the secret is not. attempt '+att+'.');
}catch(_){a===n&&(v.className=P+'verdict is-format',v.textContent='Local check failed.');}
finally{if(a===n){b.disabled=false;b.textContent=label;}}});
i.addEventListener('input',()=>{i.classList.remove('is-bad');f.classList.remove('is-shaking');
v.className!==P+'verdict is-clear'&&(v.className=P+'verdict',v.textContent='');});
solves[id]&&done(f,v,o,(typeof solves[id]==='object'&&solves[id]?solves[id].at:solves[id]),false);
b.disabled=false;});
})();
