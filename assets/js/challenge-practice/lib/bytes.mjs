// Helpers for the archived programs' ASCII integer and hexadecimal inputs.
export const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export function fromHex(text){
  if(!/^(?:[\t\n\v\f\r ]*[0-9a-fA-F]{2})*[\t\n\v\f\r ]*$/.test(text))throw Error('non-hexadecimal number found in fromhex() arg');
  return Uint8Array.from(text.replace(/[\t\n\v\f\r ]/g,'').match(/../g)||[],v=>parseInt(v,16));
}
export function integer(text,base=10){
  // Python int() accepts Unicode whitespace, but not a BOM or ASCII FS/GS/RS/US.
  let s=String(text).replace(/^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,''),negative=false;
  if(s[0]==='-'||s[0]==='+'){negative=s[0]==='-';s=s.slice(1);}
  if(base===16){if(!/^(?:0[xX]_?)?[0-9a-fA-F](?:_?[0-9a-fA-F])*$/.test(s))throw Error('invalid literal for int() with base 16');s=s.replace(/^0[xX]_?/,'').replaceAll('_','');return (negative?-1n:1n)*BigInt('0x'+s);}
  if(base!==10||!/^\d(?:_?\d)*$/.test(s))throw Error('invalid literal for int() with base 10');
  return (negative?-1n:1n)*BigInt(s.replaceAll('_',''));
}
export function fromBigInt(n,size){n=BigInt(n);if(n<0n)throw Error('negative integer');const out=new Uint8Array(size);for(let i=size-1;i>=0;i--){out[i]=Number(n&255n);n>>=8n;}if(n)throw Error('integer too big to convert');return out;}
export function toBigInt(bytes){let n=0n;for(const b of bytes)n=(n<<8n)|BigInt(b);return n;}
export function mod(a,n){const r=a%n;return r<0n?r+n:r;}
export function powMod(a,n,m){if(n<0n)throw Error('negative exponent');let r=1n;a=mod(a,m);for(;n;n>>=1n,a=a*a%m)if(n&1n)r=r*a%m;return r;}
export function gcd(a,b){for(;b;[a,b]=[b,a%b]);return a<0n?-a:a;}
export function inverse(a,n){let b=n,x=1n,y=0n;a=mod(a,n);for(;b;){const q=a/b;[a,b]=[b,a-q*b];[x,y]=[y,x-q*y];}if(a!==1n)throw Error('base is not invertible for the given modulus');return mod(x,n);}
