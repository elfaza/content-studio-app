import {chromium,expect} from '@playwright/test';
import {createInterface} from 'node:readline';
const input=createInterface({input:process.stdin,terminal:false});let config;
for await(const line of input){config=JSON.parse(line);break;}input.close();
const browser=await chromium.launch({channel:'msedge'});
try{
 const page=await browser.newPage();
 await page.goto(config.url+'/dashboard?_vercel_share='+encodeURIComponent(config.share));
 await page.getByLabel('Workspace password').fill(config.password);
 const dataResponse=page.waitForResponse(r=>r.url()===config.url+'/api/studio'&&r.request().method()==='GET',{timeout:120000});
 await page.getByRole('button',{name:'Enter your studio'}).click();
 const response=await dataResponse;const data=await response.json();
 if(response.status()!==200)throw new Error(data.error||'Live sheet read failed');
 if(data.mode!=='live'||data.writable!==false)throw new Error('Expected a live, read-only Google Sheets connection');
 await expect(page.getByText('Your studio at a glance')).toBeVisible({timeout:30000});
 await expect(page.getByText('Google Sheets connected',{exact:true})).toBeVisible();
 await expect(page.getByText('DEMO WORKSPACE',{exact:false})).toHaveCount(0);
 await page.goto(config.url+'/ideas');
 await expect(page.getByRole('main').getByRole('heading',{level:1})).toBeVisible();
 if(data.ideas.length){await page.getByLabel('Search content').fill(data.ideas[0].title);await expect(page.getByRole('heading',{name:data.ideas[0].title,exact:true}).first()).toBeVisible({timeout:30000});}
 console.log(JSON.stringify({login:true,mode:data.mode,ideas:data.ideas.length,videos:data.videos.length,snapshots:data.snapshots.length,scheduledPosts:data.schedule.length,writable:data.writable,realIdeasVisible:true,warnings:data.warnings.length}));
}finally{await browser.close();}
