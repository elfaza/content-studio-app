import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const out = 'artifacts/ui-refresh';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:'msedge'});
try {
 const page = await browser.newPage({viewport:{width:1440,height:1000}});
 page.setDefaultNavigationTimeout(120000);
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3012/dashboard');
 await page.getByLabel('Workspace password').fill('visual-review-only-2026');
 await page.getByRole('button',{name:'Enter your studio'}).click();
 await expect(page.getByRole('heading',{name:'Your content at a glance',exact:true})).toBeVisible({timeout:90000});
 for(const width of [1440,768,390]) {
   await page.setViewportSize({width,height:1000});
   for(const route of ['dashboard','ideas','pipeline','calendar','published','analytics','settings']) {
     await page.goto('http://127.0.0.1:3012/'+route);
     await expect(page.locator('main h1')).toBeVisible({timeout:60000});
     const content={dashboard:'.stats-grid',ideas:'.idea-grid',pipeline:'.pipeline-board',calendar:'.calendar-grid',published:'.published-grid',analytics:'.stats-grid',settings:'.settings-grid'};
     await expect(page.locator(content[route]).first()).toBeVisible({timeout:90000});
     await page.waitForTimeout(300);
     const sizes=await page.evaluate(()=>({body:document.documentElement.scrollWidth,screen:innerWidth}));
     if(sizes.body>sizes.screen+1) throw new Error('Horizontal overflow '+route+' '+width+': '+JSON.stringify(sizes));
     if(width!==768)await page.screenshot({path:`${out}/${route}-${width}.png`,fullPage:true});
   }
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://127.0.0.1:3012/dashboard');
 await page.getByRole('button',{name:'Toggle theme'}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(page.locator('.stats-grid')).toBeVisible({timeout:60000});
 await page.screenshot({path:`${out}/dashboard-dark.png`,fullPage:true});
 await page.getByRole('button',{name:'Toggle theme'}).click();
 await page.getByRole('button',{name:'Capture idea',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.screenshot({path:`${out}/editor-desktop.png`});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:`${out}/editor-mobile.png`});
 if(errors.length)throw new Error(errors.join('\n'));
 console.log(JSON.stringify({pages:7,widths:[1440,768,390],horizontalOverflow:false,themePersists:true,editor:true,pageErrors:errors.length}));
} finally {await browser.close();}

