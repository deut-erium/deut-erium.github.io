import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {P,N,G,Point,tuple,pyRepr,H,evalPoly,lagrange} from '../assets/js/challenge-practice/ports/law-and-order-helpers.mjs';
import {run} from '../assets/js/challenge-practice/ports/law-and-order.mjs';
import {PythonRandom} from '../assets/js/challenge-practice/lib/python-random.mjs';
import {mod,fromHex} from '../assets/js/challenge-practice/lib/bytes.mjs';
const vectors=JSON.parse(fs.readFileSync(new URL('../agent_out/challenge-runtime/law-and-order/vectors.json',import.meta.url)));
const pt=a=>new Point(...a.map(BigInt)),enc=p=>[String(p.x),String(p.y)];
test('Law reference source hash',()=>assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../assets/challenges/sekaictf-2025-law-and-order/corrected-chall.py',import.meta.url))).digest('hex'),vectors.source_sha256));
test('Law py_ecc normal/off-curve/infinity/scalar-boundary arithmetic',()=>{
 for(const r of vectors.multiplications)assert.deepEqual(enc(pt(r.p).mul(BigInt(r.n))),r.out);
 for(const r of vectors.additions){assert.deepEqual(enc(pt(r.p).add(pt(r.q))),r.out);assert.equal(pt(r.p).eq(pt(r.q)),r.equal);}
});
test('Law exact Python byte/point/tuple hash representations',async()=>{for(const r of vectors.hashes){const args=[fromHex(r.bytes),9,G,G.neg()];assert.equal(pyRepr(tuple(args)),r.repr);assert.equal(String(await H(...args)),r.hash);}});
// Known-entropy controls: choose valid contributions canceling the six higher
// aggregate polynomial coefficients. This is not an independent puzzle solve.
async function protocol(variant,mutate=''){
 const bytes=n=>new Uint8Array(n),rng=PythonRandom.fresh(bytes),others=[];
 const re=n=>{if(variant==='corrected')return 1n;let x;do{x=rng.getrandbits((n-1n).toString(2).length);}while(x>=n-1n);return x+1n;};
 for(let i=1;i<9;i++){others.push(Array.from({length:7},()=>re(N)));re(P);}
 const coeff=[1n,...Array.from({length:6},(_,k)=>mod(-others.reduce((s,c)=>s+c[k+1],0n),N))],comms=coeff.map(x=>G.mul(x));
 const secret=mod(1n+others.reduce((s,c)=>s+c[0],0n),N),R=G.mul(3n),mu=mod(3n+await H(bytes(69),9,comms[0],R),N);
 const lines=[...comms.flatMap(p=>enc(p)),...enc(R),String(mu),...Array.from({length:9},(_,i)=>String(evalPoly(coeff,BigInt(i+1))))];
 if(mutate==='integer')lines[0]='x';if(mutate==='infinity'){lines[0]='0';lines[1]='0';}if(mutate==='proof')lines[16]=String(mod(mu+1n,N));if(mutate==='share')lines[17]=String(mod(BigInt(lines[17])+1n,N));
 if(variant==='corrected')lines.push(...enc(mutate==='public-share'?G:G.mul(secret)));
 lines.push(...enc(G.mul(4n)),...enc(G.mul(5n)));
 let pos=0,wins=0,S,challenge;const nonces=new Map(),outputs=[];
 const io={reward:'practice{local_dummy_reward}',randomBytes:bytes,randomBelow:()=>0n,status(){},setDeadline(){throw Error('Law has no original alarm');},
 write(s){outputs.push(s);if(s.startsWith('[+] Set of signers'))S=s.match(/\{(.+)\}/)[1].split(', ').map(Number);let m=s.match(/^\[\+\] Party (\d+) nonces: D=\((\d+), (\d+)\), E=\((\d+), (\d+)\)$/);if(m)nonces.set(Number(m[1]),[new Point(m[2],m[3]),new Point(m[4],m[5])]);m=s.match(/^\[\+\] Group challenge `c`: (\d+)$/);if(m)challenge=BigInt(m[1]);},
 async read(){if(pos<lines.length)return lines[pos++];assert.ok(S&&challenge!==undefined,'unexpected input request');const ordered=[...S].sort((a,b)=>a-b).map(i=>tuple([i,...nonces.get(i)]));const rho=await H(9,'GIVE ME THE FLAG PLEASE',ordered);pos++;return String(mod(4n+5n*rho+secret*challenge*lagrange(9,S)+(mutate==='signature'?1n:0n),N));},
 win(s){wins++;io.write(s);}};
 await run(io,{variant});return{wins,outputs,pos};
}
for(const variant of ['released','corrected']){
 test(`Law ${variant}: complete original-size signing success with controlled entropy`,async()=>{const r=await protocol(variant);assert.equal(r.wins,1);assert.match(r.outputs.at(-1),/practice\{local_dummy_reward\}/);});
 for(const failure of ['integer','infinity','proof','share','signature',...(variant==='corrected'?['public-share']:[])])test(`Law ${variant}: rejects ${failure}`,async()=>{const r=await protocol(variant,failure);assert.equal(r.wins,0);assert.match(r.outputs.at(-1),/Invalid|invalid/);});
}
