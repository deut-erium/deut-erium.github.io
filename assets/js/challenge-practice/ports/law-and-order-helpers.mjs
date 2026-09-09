// SPDX-License-Identifier: AGPL-3.0-or-later
// Law and Order's Point wrapper and transcript formatting, with py_ecc-style
// Jacobian arithmetic. This intentionally accepts the archived off-curve inputs.
// Arithmetic adapted from py_ecc (MIT); see ../licenses/py-ecc-MIT.txt.
import {mod,toBigInt} from '../lib/bytes.mjs';
export const P=(1n<<256n)-(1n<<32n)-977n;
export const N=115792089237316195423570985008687907852837564279074904382605163141518161494337n;
const f=x=>mod(x,P);
function inv(x){x=f(x);if(!x)return 0n;let a=1n,b=0n,lo=x,hi=P;while(lo>1n){const r=hi/lo;[a,b]=[b-a*r,a];[lo,hi]=[hi-lo*r,lo];}return f(a);}
export function jacDouble([x,y,z]){if(!y)return [0n,0n,0n];const y2=f(y*y),s=f(4n*x*y2),m=f(3n*x*x),nx=f(m*m-2n*s);return [nx,f(m*(s-nx)-8n*y2*y2),f(2n*y*z)];}
export function jacAdd(a,b){if(!a[1])return b;if(!b[1])return a;const [x,y,z]=a,[u,v,w]=b,u1=f(x*w*w),u2=f(u*z*z),s1=f(y*w*w*w),s2=f(v*z*z*z);if(u1===u2)return s1===s2?jacDouble(a):[0n,0n,1n];const h=u2-u1,r=s2-s1,h2=f(h*h),h3=f(h*h2),uh2=f(u1*h2),nx=f(r*r-h3-2n*uh2);return[nx,f(r*(uh2-nx)-s1*h3),f(h*z*w)];}
export function jacMul(a,n){if(!a[1]||!n)return[0n,0n,1n];if(n===1n)return a;if(n<0n||n>=N)return jacMul(a,mod(n,N));const h=jacDouble(jacMul(a,n/2n));return n&1n?jacAdd(h,a):h;}
export function affine([x,y,z]){const t=inv(z);return new Point(f(x*t*t),f(y*t*t*t));}
export class Point{
 constructor(x,y){this.x=BigInt(x);this.y=BigInt(y);}
 add(q){return affine(jacAdd([this.x,this.y,1n],[q.x,q.y,1n]));}
 mul(n){return affine(jacMul([this.x,this.y,1n],BigInt(n)));}
 neg(){return new Point(this.x,-this.y);}
 eq(q){return this.add(q.neg()).x===0n;}
 toString(){return `(${this.x}, ${this.y})`;}
}
export const G=new Point(55066263022277343669578718895168534326250603453777594175500187360389116729240n,32670510020758816978083085130507043184471273380659243275938904335757337482424n);
export const sumPts=points=>points.reduce((r,p)=>r.add(p),G.mul(0n));
export const tuple=items=>({tuple:items});
export function pyRepr(v){
 if(v instanceof Point)return v.toString();
 if(typeof v==='bigint'||typeof v==='number')return String(v);
 if(Array.isArray(v))return '['+v.map(pyRepr).join(', ')+']';
 if(v?.tuple)return '('+v.tuple.map(pyRepr).join(', ')+(v.tuple.length===1?',':'')+')';
 const bytes=v instanceof Uint8Array;
 if(bytes||typeof v==='string'){
  const codes=bytes?Array.from(v):Array.from(v,c=>c.codePointAt(0));const quote=codes.includes(39)&&!codes.includes(34)?'"':"'";let s=bytes?'b'+quote:quote;
  for(const c of codes){if(c===92)s+='\\\\';else if(c===quote.charCodeAt(0))s+='\\'+quote;else if(c===9)s+='\\t';else if(c===10)s+='\\n';else if(c===13)s+='\\r';else if(c>=32&&c<127)s+=String.fromCodePoint(c);else if(c<256)s+='\\x'+c.toString(16).padStart(2,'0');else s+='\\u'+c.toString(16).padStart(4,'0');}return s+quote;
 }
 throw Error('unsupported transcript value');
}
export async function H(...args){return toBigInt(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pyRepr(tuple(args))))));}
export function evalPoly(coeffs,x){let r=0n;for(let i=coeffs.length-1;i>=0;i--)r=mod(r*x+coeffs[i],N);return r;}
export function polyComms(comms,i){let power=1n;return sumPts(comms.map(c=>{const r=c.mul(power);power=power*BigInt(i)%N;return r;}));}
export function lagrange(i,S){let num=1n,den=1n;for(const j of S){if(j===i)continue;num*=BigInt(j);den*=BigInt(j-i);}let a=mod(den,N),b=N,x=1n,y=0n;while(b){const q=a/b;[a,b]=[b,a-q*b];[x,y]=[y,x-q*y];}if(a!==1n)throw Error('noninvertible');return mod(num*x,N);}
