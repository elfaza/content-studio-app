import {chromium,expect} from '@playwright/test';
import {createInterface} from 'node:readline';
const input=createInterface({input:process.stdin,terminal:false});let config;
for await(const line of input){config=JSON.parse(line);break;}input.close();
const browser=await chromium.launch({channel:'msedge'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(config.url+'/dashboard?_vercel_share='+encodeURIComponent(config.share));
 await page.getByLabel('Workspace password').fill(config.password);
 const responsePromise=page.waitForResponse(r=>r.url()===config.url+'/api/studio'&&r.request().method()==='GET',{timeout:120000});
 await page.getByRole('button',{name:'Enter your studio'}).click();
 const res=await responsePromise,data=await res.json();
 if(res.status()!==200||data.mode!=='live')throw new Error('Live data unavailable');
 await expect(page.getByRole('heading',{name:'Your content at a glance',exact:true})).toBeVisible();
 await expect(page.locator('.stats-grid')).toBeVisible();
 const background=await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor);
 await page.screenshot({path:'artifacts/ui-refresh/deployed-dashboard.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.goto(config.url+'/ideas');
 await expect(page.locator('.idea-grid')).toBeVisible({timeout:60000});
 const filters=await page.getByLabel('Filter category').boundingBox();
 if(!filters||filters.width<130)throw new Error('Mobile filters too narrow');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 if(overflow)throw new Error('Mobile overflow');
 await page.screenshot({path:'artifacts/ui-refresh/deployed-ideas-mobile.png',fullPage:true});
 if(errors.length)throw new Error(errors.join(';'));
 console.log(JSON.stringify({live:true,ideas:data.ideas.length,videos:data.videos.length,snapshots:data.snapshots.length,background,mobileFilterWidth:Math.round(filters.width),overflow,pageErrors:errors.length,contentWrites:0}));
}finally{await browser.close();}
