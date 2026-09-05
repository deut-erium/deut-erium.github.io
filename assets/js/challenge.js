/* Solved-challenge flair. */
(() => {
'use strict';
const K='deuterium-solves',M='deuterium-challenge-mute',P='flag-check__',F=/^flag\{.+\}$/,T=' ✓',D=document,ce=t=>D.createElement(t),L=localStorage;
const get=(k,d)=>{try{return JSON.parse(L.getItem(k))??d}catch(_){return d}};
const put=(k,v)=>{try{L.setItem(k,JSON.stringify(v))}catch(_){}};
D.head.appendChild(Object.assign(ce('link'),{rel:'stylesheet',href:'/assets/css/features/challenge.css'}));
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
const done=(f,o,at,live)=>{
const n=ce('p');n.className=P+'cleared';f.appendChild(n);
n.textContent='Cleared: '+new Date(at).toLocaleString();
o.textContent='Correct. The flag matches.';o.className=P+'result is-correct';
f.classList.add('is-solved');
live&&(Q.matches?f.classList.add('is-ribbon'):burst(f),chime());
flair();};
const solves=get(K,{});
D.querySelectorAll('[data-flag-check]').forEach((f)=>{
const i=f.querySelector('[data-flag-input]'),b=f.querySelector('button[type="submit"]'),o=f.querySelector('output');
if(!i||!b||!o)return;
const id=i.id?i.id.slice(5):f.dataset.sha256;
const s=ce('button');s.type='button';s.className=P+'sound';
const paint=()=>{s.textContent=mute?'Muted':'Sound';s.ariaPressed=mute;};
s.onclick=()=>{mute=!mute;put(M,mute);paint();};paint();f.appendChild(s);
let n=0;
const say=(m,c='')=>{o.textContent=m;o.className=P+'result '+c;};
f.addEventListener('submit',async(e)=>{
e.preventDefault();
const a=++n,v=i.value.trim();
if(!v){say('Enter a flag first.');i.focus();return;}
b.disabled=true;
try{
const g=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));
if(a!==n)return;
if(hex(g)===f.dataset.sha256){
const at=new Date().toISOString();solves[id]=at;put(K,solves);
done(f,o,at,true);D.dispatchEvent(new CustomEvent('deuterium:solved',{detail:{id,at}}));return;}
if(F.test(v)){say('Right shape, wrong secret.','is-wrong');f.classList.remove('is-shaking');void f.offsetWidth;f.classList.add('is-shaking');}
else say('Hint: flags look like flag{...}.','is-wrong');
}catch(_){a===n&&say('Local check failed.');}
finally{a===n&&(b.disabled=false);}});
solves[id]&&done(f,o,solves[id],false);
b.disabled=false;});
})();
