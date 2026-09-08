// Local browser gate. Uses the existing build-only Puppeteer/Chromium toolchain.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const baseline=process.argv.includes('--baseline');
const out=path.resolve('agent_out/blog-fixes',baseline?'before':'after');fs.mkdirSync(out,{recursive:true});
const origin=process.env.BLOG_TEST_ORIGIN||'http://127.0.0.1:4197';
const themes=[...fs.readFileSync('_data/themes.yml','utf8').matchAll(/^- id: (\S+)/gm)].map(m=>m[1]);
assert.equal(themes.length,48);
const article='/2026/03/03/unfaithful-claims-breaking-6-zkvms.html';
const profiles=[['home-mobile','/',390,844],['article-desktop',article,1440,900]];
const jobs=themes.flatMap(skin=>['light','dark'].flatMap(mode=>profiles.map(([name,route,width,height])=>({skin,mode,name,route,width,height}))));
const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking'],env:{...process.env,LD_LIBRARY_PATH:path.resolve('.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu')}});
const results=[],interactionResults=[];let cursor=0;
async function open(job,js=true){
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
 await page.setViewport({width:job.width,height:job.height,deviceScaleFactor:1});await page.setJavaScriptEnabled(js);
 await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:job.mode},{name:'prefers-reduced-motion',value:'reduce'}]);
 await page.evaluateOnNewDocument(()=>localStorage.setItem('deuterium-cookie-banner','1'));
 if(job.storageBlocked)await page.evaluateOnNewDocument(()=>{
  Storage.prototype.getItem=Storage.prototype.setItem=()=>{throw new DOMException('Storage blocked for this test','SecurityError');};
 });
 await page.setRequestInterception(true);
 page.on('request',r=>{const u=new URL(r.url());if(u.origin===origin||u.protocol==='data:')r.continue();else r.abort();});
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('requestfailed',r=>{if(r.url().startsWith(origin))errors.push(r.url()+': '+r.failure()?.errorText);});
 page.on('response',r=>{if(r.url().startsWith(origin)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 const r=await page.goto(`${origin}${job.route}?skin=${job.skin}`,{waitUntil:'networkidle0',timeout:45000});assert.equal(r.status(),200);await page.evaluate(()=>document.fonts.ready);
 return {context,page,errors};
}
async function geometry(page){return page.evaluate(()=>{
 const box=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
 return {overflow:document.documentElement.scrollWidth-innerWidth,header:box('.site-header'),title:box('#records .post-preview__title, #records .record-row__title'),description:box('#records .post-preview__description'),article:box('#article-body'),hero:box('.masthead'),publications:box('.section-cards'),records:box('#records'),menu:box('.nav-menu > summary'),skin:document.documentElement.dataset.skin||'rpn-garden',resources:performance.getEntriesByType('resource').filter(r=>r.name.startsWith(location.origin)).map(r=>new URL(r.name).pathname)};
 });}
async function matrix(job){
 const c=await open(job);
 try{
  const metrics=await geometry(c.page),failures=[];
  if(metrics.overflow>0)failures.push('page overflow');
  if(!baseline){
   if(job.name==='home-mobile'){
    await c.page.addScriptTag({path:path.resolve('.toolchain/verify/lighthouse-node_modules/axe-core/axe.min.js')});
    metrics.axeReading=await c.page.evaluate(async()=>(await axe.run({include:['.site-header','.post-preview']},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
    if(metrics.axeReading.length)failures.push('header/reading accessibility');
    const sameColor=await c.page.$$eval('.post-preview__description',es=>es.some(e=>getComputedStyle(e).color===getComputedStyle(e.closest('.post-preview')).backgroundColor));
    if(sameColor)failures.push('preview text equals its background');
   }
   if(job.name==='home-mobile'&&metrics.header.height>80)failures.push('mobile header exceeds 80px');
   if(job.name==='home-mobile'&&(!metrics.description||metrics.description.bottom>job.height))failures.push('first post description below first viewport');
   await c.page.click('.nav-menu > summary');
   if(job.name==='home-mobile'){
    metrics.axeMenu=await c.page.evaluate(async()=>(await axe.run({include:['.nav-menu']},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
    if(metrics.axeMenu.length)failures.push('menu accessibility');
   }
   const links=await c.page.$$eval('.primary-links a',es=>es.map(e=>({href:new URL(e.href).pathname,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,visible:e.checkVisibility(),hit:(()=>{const b=e.getBoundingClientRect(),top=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return top===e||e.contains(top);})()})));
   if(links.length!==6||links.some(e=>!e.visible||!e.hit||e.w<44||e.h<44))failures.push('navigation targets missing, covered or too small');
   assert.deepEqual(links.map(l=>l.href).sort(),['/','/archive.html','/WriteUps/','/ctf-tutorials/','/ramblings/','/about.html'].sort());
   assert.equal(await c.page.$$eval('.site-footer__mystery',es=>es.filter(e=>e.checkVisibility()).length),3);
   const panel=await c.page.$eval('.nav-menu__panel',e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width,scroll:e.scrollWidth,client:e.clientWidth};});
   metrics.menuPanel=panel;
   if(panel.left<0||panel.right>job.width||panel.scroll>panel.client+1)failures.push('menu panel overflow');
   assert.equal(await c.page.$$eval('#skin-picker option',es=>es.length),48);
   await c.page.keyboard.press('Escape');
   if(await c.page.$eval('.nav-menu',e=>e.open))failures.push('Escape did not close menu');
  }
  if(job.skin==='rpn-garden')await c.page.screenshot({path:path.join(out,`${job.name}-${job.mode}.png`)});
  results.push({...job,...metrics,errors:c.errors,failures});
 }finally{await c.context.close();}
}
try{
 await Promise.all(Array.from({length:4},async()=>{while(cursor<jobs.length){const job=jobs[cursor++];try{await matrix(job);}catch(e){results.push({...job,errors:[String(e)],failures:['case aborted']});}}}));
 if(!baseline){
  for(const [width,height,js]of [[320,740,true],[390,844,true],[768,1024,true],[1440,900,true],[390,844,false]]){
   const c=await open({skin:'rpn-garden',mode:'light',route:'/',width,height},js);try{
    const g=await geometry(c.page);assert.equal(g.overflow,0);if(width<=864)assert.ok(g.header.height<=80);
    assert.ok(g.description.bottom<=height);assert.ok(g.publications.y>g.records.y);
    // Native details keep collapsed links out of keyboard navigation.
    await c.page.focus('.nav-menu > summary');await c.page.keyboard.press('Tab');
    assert.equal(await c.page.evaluate(()=>Boolean(document.activeElement.closest('.nav-menu__panel'))),false);
    await c.page.focus('.nav-menu > summary');await c.page.keyboard.press('Enter');
    assert.equal(await c.page.$eval('.nav-menu',e=>e.open),true);await c.page.keyboard.press('Tab');
    assert.equal(await c.page.evaluate(()=>document.activeElement.getAttribute('data-route')),'home');
    if(js){
     await c.page.select('#skin-picker','cryptographic-blockbuster');
     await c.page.waitForFunction(()=>document.documentElement.dataset.skin==='cryptographic-blockbuster');
     await c.page.waitForNetworkIdle({idleTime:200});
     assert.equal((await geometry(c.page)).overflow,0);
     await c.page.select('#skin-picker','rpn-garden');await c.page.waitForNetworkIdle({idleTime:200});
     await c.page.keyboard.press('Escape');assert.equal(await c.page.$eval('.nav-menu',e=>e.open),false);
     assert.equal(await c.page.evaluate(()=>document.activeElement.matches('.nav-menu > summary')),true);
     await c.page.click('.nav-menu > summary');
     await c.page.screenshot({path:path.join(out,`menu-${width}.png`)});
     await c.page.click('.post-preview__description');assert.equal(await c.page.$eval('.nav-menu',e=>e.open),false);
     await c.page.addScriptTag({path:path.resolve('.toolchain/verify/lighthouse-node_modules/axe-core/axe.min.js')});
     const violations=await c.page.evaluate(async()=>(await axe.run({include:['.site-header','.masthead','#records']},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
     assert.deepEqual(violations,[]);
    }else{
     assert.equal(await c.page.$eval('#skin-picker',e=>e.disabled),true);
     await c.page.focus('.nav-menu > summary');await c.page.keyboard.press('Enter');assert.equal(await c.page.$eval('.nav-menu',e=>e.open),false);
    }
    const dock=await c.page.$$eval('.skin-dice, .theme-toggle:not([hidden]), .site-share__btn',es=>es.map(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,w:b.width,h:b.height};}));
    assert.ok(dock.every(r=>r.w>=44&&r.h>=44));
    if(width<=864){
     const text=await c.page.$$eval('.post-preview__title, .post-preview__description',es=>es.map(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom};}));
     for(const a of text)for(const b of dock)assert.ok(!(a.x<b.right&&b.x<a.right&&a.y<b.bottom&&b.y<a.bottom),'dock covers homepage reading choices');
    }
    await c.page.screenshot({path:path.join(out,`home-${width}-${js?'js':'no-js'}.png`)});
    assert.deepEqual(c.errors,[]);interactionResults.push({width,height,js,...g,pass:true});
   }finally{await c.context.close();}
  }
  for(const storageBlocked of [false,true]){
   const c=await open({skin:'rpn-garden',mode:'light',route:'/',width:390,height:844,storageBlocked});
   try{
    // The old cookie banner still appears when storage reads fail. Dismiss it
    // before checking navigation; its probability policy is a separate change.
    if(storageBlocked)await c.page.keyboard.press('Escape');
    await c.page.click('.nav-menu > summary');await c.page.select('#skin-picker','cryptographic-blockbuster');
    await c.page.waitForNetworkIdle({idleTime:200});
    assert.equal(await c.page.evaluate(()=>document.documentElement.dataset.skin),'cryptographic-blockbuster');
    if(!storageBlocked){
     await c.page.goto(origin+'/',{waitUntil:'networkidle0'});
     assert.equal(await c.page.evaluate(()=>document.documentElement.dataset.skin),'cryptographic-blockbuster');
     await c.page.goto(origin+'/?skin=rpn-garden',{waitUntil:'networkidle0'});
     assert.equal(await c.page.evaluate(()=>document.documentElement.dataset.skin),undefined);
    }
    assert.deepEqual(c.errors,[]);interactionResults.push({case:storageBlocked?'blocked-storage':'saved-and-query-skins',pass:true});
   }finally{await c.context.close();}
  }
 }
}finally{
 results.sort((a,b)=>themes.indexOf(a.skin)-themes.indexOf(b.skin)||a.name.localeCompare(b.name)||a.mode.localeCompare(b.mode));
 fs.writeFileSync(path.join(out,'matrix.json'),JSON.stringify(results,null,2)+'\n');
 fs.writeFileSync(path.join(out,'interactions.json'),JSON.stringify(interactionResults,null,2)+'\n');
 await browser.close();
}
const failed=results.filter(r=>r.errors.length||r.failures.length);
console.log(`${results.length} matrix cases; ${failed.length} failed; ${interactionResults.length} interaction profiles passed.`);
if(failed.length){console.error(failed.map(r=>({skin:r.skin,name:r.name,mode:r.mode,errors:r.errors,failures:r.failures})));process.exitCode=1;}
