import {chromium,expect} from '@playwright/test';
import {createInterface} from 'node:readline';
const lines=createInterface({input:process.stdin,terminal:false});let config;
for await(const line of lines){config=JSON.parse(line);break;}lines.close();
const browser=await chromium.launch({channel:'msedge'});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto(config.url+'/dashboard?_vercel_share='+encodeURIComponent(config.share));
 await page.getByLabel('Workspace password').fill(config.password);
 const ready=page.waitForResponse(r=>r.url()===config.url+'/api/studio'&&r.request().method()==='GET',{timeout:120000});
 await page.getByRole('button',{name:'Enter your studio'}).click();
 const response=await ready,data=await response.json();
 if(response.status()!==200||data.mode!=='live')throw Error('Live data unavailable');
 await page.getByRole('button',{name:'Capture idea',exact:true}).click();
 const category=page.getByRole('combobox',{name:'Category',exact:true});
 await category.click();
 const name=[...data.ideas,...data.videos].map(r=>r.category?.trim()).find(Boolean);
 await expect(page.getByRole('option',{name,exact:true})).toBeVisible();
 await category.fill(name);
 await page.getByRole('option',{name,exact:true}).click();
 await expect(category).toHaveValue(name);
 await category.fill('New category preview');
 await expect(page.getByRole('option',{name:'Tambah kategori “New category preview”',exact:true})).toBeVisible();
 await category.press('Escape');
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:'Close dialog'}).click();
 console.log(JSON.stringify({live:true,categorySuggestions:true,search:true,newCategoryOption:true,escapeKeepsForm:true,contentWrites:0}));
}finally{await browser.close();}
