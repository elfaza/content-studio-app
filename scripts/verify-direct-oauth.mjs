import {chromium,expect} from '@playwright/test';
import {createInterface} from 'node:readline';
const input=createInterface({input:process.stdin,terminal:false});let config;
for await(const line of input){config=JSON.parse(line);break;}input.close();
const browser=await chromium.launch({channel:'msedge'});
try{
 const page=await browser.newPage();
 await page.goto(config.url+'/dashboard?_vercel_share='+encodeURIComponent(config.share));
 await page.getByLabel('Workspace password').fill(config.password);
 await page.getByRole('button',{name:'Enter your studio'}).click();
 await expect(page.getByText('Your studio at a glance')).toBeVisible({timeout:30000});
 const status=await(await page.request.get(config.url+'/api/google')).json();
 if(!status.configured||status.mode!=='oauth'||typeof status.connected!=='boolean')throw new Error('Direct OAuth configuration is not ready for setup');
 const invalid=await page.request.get(config.url+'/api/google/callback?code=invalid');
 if(invalid.status()!==400)throw new Error('Callback accepted a request without OAuth state');
 await page.goto(config.url+'/settings');
 await expect(page.getByRole('button',{name:/^(Reconnect|Connect) Google$/}).first()).toBeVisible();
 const response=await page.request.post(config.url+'/api/google',{headers:{Origin:config.url}});const body=await response.json();
 if(response.status()!==200)throw new Error('Google sign-in could not be started');
 const target=new URL(body.url);
 if(target.origin!=='https://accounts.google.com'||target.searchParams.get('redirect_uri')!==config.url+'/api/google/callback'||target.searchParams.get('code_challenge_method')!=='S256'||target.searchParams.get('access_type')!=='offline')throw new Error('OAuth request parameters are invalid');
 const cookie=(await page.context().cookies(config.url+'/api/google')).find(c=>c.name==='cs-google-state');
 if(!cookie?.httpOnly||!cookie.secure||cookie.sameSite!=='Lax')throw new Error('OAuth state cookie is not protected');
 console.log(JSON.stringify({login:true,directOAuthConfigured:true,invalidCallbackRejected:true,googleAuthorizationStarted:true,pkce:true,secureStateCookie:true}));
}finally{await browser.close();}
