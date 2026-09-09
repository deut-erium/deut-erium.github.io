// CPython's MT19937 integer-seed, getrandbits and selection behavior.
// Practice-only deterministic PRNG; fresh() seeds it with browser entropy.
export class PythonRandom {
  constructor(seed=0n) {
    seed=BigInt(seed);if(seed<0n)seed=-seed;
    const key=[];do{key.push(Number(seed&0xffffffffn));seed>>=32n;}while(seed);
    this.seedArray(key);
  }
  static fresh(randomBytes) {
    const bytes=randomBytes(2496),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const rng=new PythonRandom();rng.seedArray(Array.from({length:624},(_,i)=>view.getUint32(i*4,true)));return rng;
  }
  seedArray(key) {
    this.state=new Uint32Array(624);this.state[0]=19650218;
    for(let i=1;i<624;i++)this.state[i]=(Math.imul(1812433253,this.state[i-1]^(this.state[i-1]>>>30))+i)>>>0;
    let i=1,j=0;
    for(let k=Math.max(624,key.length);k;k--){this.state[i]=((this.state[i]^Math.imul(this.state[i-1]^(this.state[i-1]>>>30),1664525))+key[j]+j)>>>0;i++;j++;if(i>=624){this.state[0]=this.state[623];i=1;}if(j>=key.length)j=0;}
    for(let k=623;k;k--){this.state[i]=((this.state[i]^Math.imul(this.state[i-1]^(this.state[i-1]>>>30),1566083941))-i)>>>0;i++;if(i>=624){this.state[0]=this.state[623];i=1;}}
    this.state[0]=0x80000000;this.index=624;
  }
  uint32() {
    if(this.index>=624){for(let i=0;i<624;i++){const y=(this.state[i]&0x80000000)|(this.state[(i+1)%624]&0x7fffffff);this.state[i]=(this.state[(i+397)%624]^(y>>>1)^((y&1)?0x9908b0df:0))>>>0;}this.index=0;}
    let y=this.state[this.index++];y^=y>>>11;y^=(y<<7)&0x9d2c5680;y^=(y<<15)&0xefc60000;y^=y>>>18;return y>>>0;
  }
  getrandbits(k) {
    if(!Number.isSafeInteger(k)||k<0)throw Error('invalid bit count');
    if(k===0)return 0n;
    let v=0n;for(let i=0;i<k;i+=32){let word=this.uint32();if(k-i<32)word>>>=32-(k-i);v|=BigInt(word)<<BigInt(i);}return v;
  }
  random(){return ((this.uint32()>>>5)*67108864+(this.uint32()>>>6))/9007199254740992;}
  randbelow(n){if(!Number.isSafeInteger(n)||n<=0)throw Error('invalid range');const k=BigInt(n).toString(2).length;let r;do{r=Number(this.getrandbits(k));}while(r>=n);return r;}
  randint(a,b){return a+this.randbelow(b-a+1);}
  choice(a){return a[this.randbelow(a.length)];}
  choices(a,k){return Array.from({length:k},()=>a[Math.floor(this.random()*a.length)]);}
  shuffle(a){for(let i=a.length-1;i>0;i--){const j=this.randbelow(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
}
