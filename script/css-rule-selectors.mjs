// Extract rule preludes for browser syntax checks. Declaration validation is
// deliberately left out; this is not a replacement for a complete CSS linter.
export function rulePreludes(css) {
  const rules=[];let i=0;
  const skipTrivia=()=>{
    while(i<css.length){
      if(/\s/.test(css[i])){i++;continue;}
      if(css.startsWith('/*',i)){
        const end=css.indexOf('*/',i+2);if(end<0)throw new Error('Unclosed CSS comment');i=end+2;continue;
      }
      break;
    }
  };
  const quoted=()=>{
    const quote=css[i++];
    while(i<css.length){if(css[i]==='\\'){i+=2;continue;}if(css[i++]===quote)return;}
    throw new Error('Unclosed CSS string');
  };
  const skipBlock=()=>{
    let depth=1;
    while(i<css.length){
      if(css.startsWith('/*',i)){skipTrivia();continue;}
      if(css[i]==='"'||css[i]==="'"){quoted();continue;}
      if(css[i]==='\\'){i+=2;continue;}
      const c=css[i++];
      if(c==='{')depth++;
      else if(c==='}'&&--depth===0)return;
    }
    throw new Error('Unclosed CSS block');
  };
  const region=(nested=false)=>{
    while(i<css.length){
      skipTrivia();if(i===css.length)break;
      if(css[i]==='}'){if(!nested)throw new Error('Unexpected CSS closing brace');i++;return;}
      const start=i;
      while(i<css.length&&!['{',';','}'].includes(css[i])){
        if(css.startsWith('/*',i)){skipTrivia();continue;}
        if(css[i]==='"'||css[i]==="'"){quoted();continue;}
        if(css[i]==='\\'){i+=2;continue;}
        i++;
      }
      const prelude=css.slice(start,i).trim();
      const delimiter=css[i++];
      if(delimiter===';')continue;
      if(delimiter!=='{')throw new Error('Rule without a CSS block');
      if(!prelude)throw new Error('Empty CSS selector');
      rules.push({prelude,line:css.slice(0,start).split('\n').length});
      if(/^@(media|supports|layer|container|scope|document|starting-style)\b/.test(prelude))region(true);
      else skipBlock();
    }
    if(nested)throw new Error('Unclosed CSS group');
  };
  region();return rules;
}
