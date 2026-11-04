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
 if(data.mode!=='live'||data.writable!==true)throw new Error('Expected live editing to be enabled');
 await expect(page.getByText('Your studio at a glance')).toBeVisible({timeout:30000});
 await expect(page.getByText('Google Sheets connected',{exact:true})).toBeVisible();
 await expect(page.getByText('DEMO WORKSPACE',{exact:false})).toHaveCount(0);
 await page.goto(config.url+'/ideas');
 await expect(page.getByRole('main').getByRole('heading',{level:1})).toBeVisible();
 if(data.ideas.length){await page.getByLabel('Search content').fill(data.ideas[0].title);await expect(page.getByRole('heading',{name:data.ideas[0].title,exact:true}).first()).toBeVisible({timeout:30000});}

 // Acquire/release the real shared lock but deliberately fail record validation:
 // exercises Google write permission without changing any content or metadata.
 let writePermissionVerified=true;
 const probe={...data.ideas[0],id:'verification-record-does-not-exist'};
 for(let n=0;n<2;n++){
   const res=await page.request.post(config.url+'/api/studio',{headers:{Origin:config.url},data:{entity:'ideas',data:probe}});
   const body=await res.json();
   if(res.status()===403&&body.error?.includes('editing access')){writePermissionVerified=false;break;}
   if(res.status()!==409||!body.error?.includes('removed externally'))throw new Error('Write permission/lock verification failed: '+body.error);
 }
 const after=await (await page.request.get(config.url+'/api/studio')).json();
 for(const key of ['ideas','videos','snapshots','schedule','settings'])if(JSON.stringify(after[key])!==JSON.stringify(data[key]))throw new Error('Verification changed content');
 await page.goto(config.url+'/settings');
 await expect(page.getByRole('button',{name:'Edit preferences'})).toBeEnabled();
 console.log(JSON.stringify({writePermissionVerified,lockReleased:writePermissionVerified,contentUnchanged:true,preferencesEnabled:true,login:true,mode:data.mode,ideas:data.ideas.length,videos:data.videos.length,snapshots:data.snapshots.length,scheduledPosts:data.schedule.length,writable:data.writable,realIdeasVisible:true,warnings:data.warnings.length}));
}finally{await browser.close();}
