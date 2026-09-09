// SPDX-License-Identifier: AGPL-3.0-or-later
// Browser practice port of SekaiCTF 2025 Law and Order by deuterium.
// Both archived source versions are retained; no curve checks are added.
import {PythonRandom} from '../lib/python-random.mjs';
import {pythonIntSet} from '../lib/python-set.mjs';
import {hex,integer,mod} from '../lib/bytes.mjs';
import {P,N,G,Point,H,sumPts,tuple,evalPoly,polyComms,lagrange} from './law-and-order-helpers.mjs';
export async function run(io,options={}){
 const variant=options.variant||'corrected';if(!['corrected','released'].includes(variant))throw Error('Unknown Law and Order version');
 const context=io.randomBytes(69),rng=PythonRandom.fresh(io.randomBytes),EXIT=Symbol('exit');
 const randomElement=n=>{if(variant==='corrected')return io.randomBelow(n-1n)+1n;let r;const k=(n-1n).toString(2).length;do{r=rng.getrandbits(k);}while(r>=n-1n);return r+1n;};
 const die=message=>{io.write(message);throw EXIT;};
 const inputInt=async(range=P)=>{try{const x=integer(await io.read());if(x<0n||x>=range)throw Error();return x;}catch{die('Invalid input integer');}};
 const inputPoint=async()=>{try{const x=await inputInt(),y=await inputInt();if(!x&&!y)throw Error();return new Point(x,y);}catch{die('Invalid input Point');}};
 const verifyProof=async(C,R,mu,i)=>R.eq(G.mul(mu).add(C.mul(-await H(context,i,C,R))));
 const makeProof=async(secret,i)=>{const k=randomElement(P),R=G.mul(k);return[R,mod(k+secret*await H(context,i,G.mul(secret),R),N)];};
 try{
  io.write('='.repeat(50));io.write('=== Law and Order! You should always include your friends to sign and you are mine <3 ===');io.write('='.repeat(50));
  io.write('We have 8 parties here, and you will be party #9.');io.write('Idk why is our group signing not working');io.write('\n--- Round 1: Commitment ---');io.write('context string '+hex(context));
  const coeffs=new Map(),comms=new Map();
  for(let i=1;i<9;i++){
   io.status(`Generating commitments for party ${i} of 8`);
   const cs=Array.from({length:7},()=>randomElement(N)),[R,mu]=await makeProof(cs[0],i),points=cs.map(x=>G.mul(x));
   if(!await verifyProof(points[0],R,mu,i))die(`[-] Party ${i} secret PoK invalid`);
   coeffs.set(i,cs);comms.set(i,points);io.write(`[+] Commitments from party ${i}:`);points.forEach((p,k)=>io.write(`  C_${i},${k} = ${p}`));
  }
  io.write('\n[?] Now, provide the commitments (points) for your coefficients.');
  const yours=[];for(let k=0;k<7;k++)yours.push(await inputPoint());
  io.write('\n[?] Finally, provide your proof-of-knowledge for your secret share (c_i,0).');io.write('[>] Send Point R:');const R=await inputPoint();io.write('[>] Send mu:');const mu=await inputInt();
  if(!await verifyProof(yours[0],R,mu,9))die('[-] party 9 secret PoK invalid');comms.set(9,yours);
  io.write('[+] Your commitments and proof have been accepted.');io.write('\n--- Round 2: Share Distribution ---');io.write('[?] Please provide your shares for the other 9 parties.');
  const yourShares=new Map();for(let i=1;i<=9;i++){io.write(`[>] Send share for party ${i}:`);yourShares.set(i,await inputInt(N));}
  const evaluated=new Map();for(const [j,cs]of comms)evaluated.set(j,new Map(Array.from({length:9},(_,k)=>[k+1,polyComms(cs,k+1)])));
  for(let i=1;i<=9;i++)if(!G.mul(yourShares.get(i)).eq(evaluated.get(9).get(i)))die(`[-] party 9 shares for party ${i} invalid`);
  io.write('[+] Your shares have been verified');
  const shares=new Map();for(let j=1;j<9;j++){const row=new Map(Array.from({length:9},(_,k)=>[k+1,evalPoly(coeffs.get(j),BigInt(k+1))]));for(let i=1;i<=9;i++)if(!G.mul(row.get(i)).eq(evaluated.get(j).get(i)))die(`[-] party ${j} shares for party ${i} invalid`);shares.set(j,row);io.write(`[+] Share for you from party ${j}: ${row.get(9)}`);}shares.set(9,yourShares);
  const signing=new Map(),publics=new Map();for(let i=1;i<=9;i++){const value=Array.from(shares.values()).reduce((a,row)=>a+row.get(i),0n);signing.set(i,value);publics.set(i,G.mul(value));}
  const group=sumPts(Array.from(comms.values(),cs=>cs[0]));io.write(`\n[+] Group Public Key: ${group}`);
  const expectedShare=sumPts(Array.from(evaluated.values(),row=>row.get(9)));
  if(variant==='corrected'){io.write('[?] Provide your public verification share `Y_i`.');const supplied=await inputPoint();if(!supplied.eq(expectedShare))die('[-] party 9 public share invalid');publics.set(9,supplied);}else publics.set(9,expectedShare);
  io.write('[+] Public verification shares have been computed.');io.write('\n--- Phase 3: Presign and Sign (100 rounds) ---');
  for(let round=0;round<100;round++){
   io.write('[?] Provide your nonces (D_i, E_i) for this round.');const yourD=await inputPoint(),yourE=await inputPoint(),secretNonce=new Map(),nonce=new Map();
   for(let i=1;i<=9;i++){const d=randomElement(N),e=randomElement(N);secretNonce.set(i,[d,e]);nonce.set(i,[G.mul(d),G.mul(e)]);}nonce.set(9,[yourD,yourE]);
   const S=pythonIntSet([rng.randint(7,9),rng.randint(7,9),9]);io.write('[+] Set of signers for this round: {'+S.join(', ')+'}');
   const m='GIVE ME THE FLAG PLEASE',ordered=[...S].sort((a,b)=>a-b).map(i=>tuple([i,...nonce.get(i)])),rho=new Map();for(const i of S)rho.set(i,await H(i,m,ordered));
   const combined=new Map();let groupNonce=G.mul(0n);
   for(const i of S){const [D,E]=nonce.get(i);io.write(`[+] Party ${i} nonces: D=${D}, E=${E}`);const r=D.add(E.mul(rho.get(i)));combined.set(i,r);groupNonce=groupNonce.add(r);}
   const challenge=await H(groupNonce,group,m);io.write(`[+] Group challenge \`c\`: ${challenge}`);io.write('[?] Provide your signature share `z_i`.');const zi=await inputInt(N);
   if(!G.mul(zi).eq(combined.get(9).add(publics.get(9).mul(challenge*lagrange(9,S)))))die('[-] party 9 signature shares invalid');
   const final=new Map([[9,zi]]);
   // CPython set subtraction of these small integers preserves hash-table order.
   const others=pythonIntSet(S.filter(i=>i!==9));
   for(const i of others){const[d,e]=secretNonce.get(i),z=d+e*rho.get(i)+signing.get(i)*challenge*lagrange(i,S),Yi=publics.get(i),Ri=combined.get(i);
    if(!Yi.eq(sumPts(Array.from(evaluated.values(),row=>row.get(i)))))die(`[-] party ${i} public share invalid`);
    if(!G.mul(z).eq(Ri.add(Yi.mul(challenge*lagrange(i,S)))))die(`[-] party ${i} signature share invalid`);final.set(i,z);
   }
   const z=mod(Array.from(final.values()).reduce((a,b)=>a+b,0n),N);
   if(G.mul(z).eq(groupNonce.add(group.mul(challenge)))){io.write('[+] Signature verification successful');io.win('[+] Here is your flag: '+io.reward);return;}
  }
  die('[-] We are out of signing ink');
 }catch(e){if(e!==EXIT)io.write('[-] An error occured: {e}');}
}
