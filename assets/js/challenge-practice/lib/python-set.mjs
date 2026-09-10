// CPython small nonnegative integer set insertion/table iteration (no deletes).
export function pythonIntSet(values){
 let table=Array(8).fill(null),used=0;
 function insert(v,t){const mask=t.length-1;let i=v&mask,perturb=v;for(;;){const probes=i+9<=mask?9:0;for(let j=0;j<=probes;j++){if(t[i+j]===v)return false;if(t[i+j]===null){t[i+j]=v;return true;}}perturb=Math.floor(perturb/32);i=(5*i+1+perturb)&mask;}}
 for(const v of values){if(!Number.isSafeInteger(v)||v<0||v>0x7fffffff)throw Error('small integer required');if(!insert(v,table))continue;used++;if(used*5>=(table.length-1)*3){let n=8;while(n<=used*(used>50000?2:4))n*=2;const t=Array(n).fill(null);for(const x of table)if(x!==null)insert(x,t);table=t;}}
 return table.filter(v=>v!==null);
}
