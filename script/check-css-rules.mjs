import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {rulePreludes} from './css-rule-selectors.mjs';
const ref=process.argv.find(a=>a.startsWith('--ref='))?.slice(6);
const prefix='agent_out/blog-fixes/css'+(ref?'-before':'-after');
const files=(ref?execFileSync('git',['ls-tree','-r','--name-only',ref,'assets/css'],{encoding:'utf8'}).trim().split('\n'):fs.readdirSync('assets/css',{recursive:true}).map(f=>'assets/css/'+f)).filter(f=>f.endsWith('.css')).sort();
const inputs=[],errors=[];
for(const file of files){
 const css=ref?execFileSync('git',['show',ref+':'+file],{encoding:'utf8',maxBuffer:4*1024*1024}):fs.readFileSync(file,'utf8');
 try{for(const r of rulePreludes(css))inputs.push({file,...r});}
 catch(e){errors.push({file,message:String(e)});}
}
const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking'],env:{...process.env,LD_LIBRARY_PATH:path.resolve('.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu')}});
try{
 const page=await browser.newPage();
 const rejected=await page.evaluate(inputs=>{
  const sheet=new CSSStyleSheet(),errors=[];
  for(const r of inputs){try{const index=sheet.insertRule(r.prelude+' {}',0);sheet.deleteRule(index);}catch(e){errors.push({...r,message:e.name});}}
  return errors;
 },inputs);
 errors.push(...rejected);
}finally{await browser.close();}
fs.mkdirSync(path.dirname(prefix),{recursive:true});fs.writeFileSync(prefix+'.json',JSON.stringify({files:files.length,rules:inputs.length,errors},null,2)+'\n');
console.log(`${files.length} CSS files; ${inputs.length} rule preludes; ${errors.length} rejected.`);
for(const e of errors)console.error(`${e.file}:${e.line||'?'} ${e.prelude||''} ${e.message}`);
if(errors.length)process.exitCode=1;
