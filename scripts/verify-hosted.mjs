import { chromium, expect } from '@playwright/test';
import { createInterface } from 'node:readline';
const input=createInterface({input:process.stdin,terminal:false});
let config;
for await(const line of input){config=JSON.parse(line);break;}
input.close();
const browser=await chromium.launch({channel:'msedge'});
try{
 const page=await browser.newPage();
 await page.goto(config.url+'/dashboard?_vercel_share='+encodeURIComponent(config.share),{waitUntil:'domcontentloaded'});
 await page.getByLabel('Workspace password').fill(config.password);
 await page.getByRole('button',{name:'Enter your studio'}).click();
 await expect(page.getByText('Your studio at a glance')).toBeVisible({timeout:30000});
 const response=await page.request.get(config.url+'/api/studio');
 const data=await response.json();
 if(response.status()!==200||data.mode!=='demo'||data.persistence!=='browser')throw new Error('Hosted demo API check failed');
 const title='HTTPS verification '+Date.now();
 await page.getByRole('button',{name:'Capture idea',exact:true}).click();
 await page.getByLabel('Content title',{exact:true}).fill(title);
 await page.getByRole('button',{name:'Save changes'}).click();
 await expect(page.getByRole('dialog')).not.toBeVisible();
 await page.goto(config.url+'/ideas');
 await page.getByLabel('Search content').fill(title);
 await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 await page.reload();
 await page.getByLabel('Search content').fill(title);
 await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 await page.goto(config.url+'/settings');
 await page.getByRole('button',{name:'Connect Google',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Finish creating your Google connector');
 console.log(JSON.stringify({https:true,login:true,demoApi:true,ideaSave:true,persistedAfterReload:true,googleSetupAction:true}));
}finally{await browser.close();}
