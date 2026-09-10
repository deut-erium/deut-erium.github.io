// Copyright 2024 Google LLC. Licensed under Apache-2.0.
// https://www.apache.org/licenses/LICENSE-2.0
// Derived from the archived Google CTF 2024 desfunctional challenge.
// This implementation is provided AS IS, without warranties or conditions.
import {PythonRandom} from '../lib/python-random.mjs';
import {pythonIntSet} from '../lib/python-set.mjs';
import {hex,fromHex,integer,fromBigInt} from '../lib/bytes.mjs';
import {tripleCBC} from './desfunctional-helpers.mjs';
export class Desfunctional {
 constructor(key,iv,challenge,rng){this.key=key;this.iv=iv;this.challenge=challenge;this.rng=rng;this.counter=128;this.flipped=new Set(Array.from({length:24},(_,i)=>8*i));}
 getChallenge(){return tripleCBC(this.key,this.iv,this.challenge);}
 corruption(){
  if(this.flipped.size===192)this.flipped=new Set(Array.from({length:24},(_,i)=>8*i));
  const ascending=Array.from({length:192},(_,i)=>i).filter(i=>!this.flipped.has(i));
  // CPython difference copies the large left set for a small right set;
  // otherwise it inserts the surviving integers into a fresh set table.
  const remaining=this.flipped.size<48?ascending:pythonIntSet(ascending);
  const k=this.rng.randint(1,remaining.length);
  for(const i of this.rng.choices(remaining,k))this.flipped.add(i);
  let n=0n;for(const i of this.flipped)n|=1n<<BigInt(i);const mask=fromBigInt(n,24);
  return this.key.map((b,i)=>b^mask[i]);
 }
 decrypt(bytes){this.counter--;if(this.counter<0)throw Error('Out of balance');const key=this.corruption();if(bytes.length%8)return new Uint8Array();return tripleCBC(key,this.iv,bytes,true);}
 accepts(bytes){return bytes.length===this.challenge.length&&bytes.every((b,i)=>b===this.challenge[i]);}
}
export async function run(io){
 const c=new Desfunctional(io.randomBytes(24),io.randomBytes(8),io.randomBytes(64),PythonRandom.fresh(io.randomBytes));io.setDeadline(128);
 for(;;){try{
  const option=integer(await io.read('Choose an API option\n1. Get challenge\n2. Decrypt\n3. Get the flag\n'));
  if(option===1n)io.write(hex(c.getChallenge()));
  else if(option===2n)io.write(hex(c.decrypt(fromHex(await io.read('(hex) ct: ')))));
  else if(option===3n){if(!c.accepts(fromHex(await io.read('(hex) pt: '))))throw Error('Not quite right');io.win(`b'${io.reward}'`);return;}
 }catch(e){io.write(e.message);return;}}
}
