import { test, expect } from "@playwright/test";
test.setTimeout(60000);
test("authentication protects private API", async ({ request }) => {
  expect((await request.get("/api/studio")).status()).toBe(401);
  expect((await request.get('/api/google')).status()).toBe(401);
  expect((await request.get('/api/instagram')).status()).toBe(401);
  expect((await request.post('/api/instagram/sync')).status()).toBe(401);
});

test('Google connection shows an actionable setup message when OAuth is unconfigured',async({page})=>{
  await page.goto('/settings');
  await page.getByLabel('Workspace password').fill(process.env.E2E_PASSWORD||'content-studio-local-2026');
  await page.getByRole('button',{name:'Enter your studio'}).click();
  await page.getByRole('button',{name:'Connect Google',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Direct Google OAuth is not configured');
});
test("capture, edit, schedule, publish, and record performance", async ({
  page,
}) => {
  const title = "A test story " + Date.now();
  await page.goto("/dashboard");
  await page
    .getByLabel("Workspace password")
    .fill(process.env.E2E_PASSWORD || "content-studio-local-2026");
  await page.getByRole("button", { name: "Enter your studio" }).click();
  await expect(page.getByText("Your studio at a glance")).toBeVisible();
  expect((await (await page.request.get("/api/studio")).json()).mode).toBe(
    "demo",
  );
  await page.getByRole("button", { name: "Capture idea", exact: true }).click();
  await page.getByLabel("Content title", { exact: true }).fill(title);
  await page.getByLabel("Category", { exact: true }).fill("Running");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/ideas");
  await page.getByLabel("Search content").fill(title);
  await page.getByRole("heading", { name: title, exact: true }).click();
  await page
    .getByLabel("Hook · first 3 seconds")
    .fill("A real story starts here.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/pipeline");
  await page.getByLabel("Search content").fill(title);
  await page
    .getByLabel("Change stage for " + title, { exact: true })
    .selectOption("Filming");
  await expect(
    page.getByLabel("Change stage for " + title, { exact: true }),
  ).toHaveValue("Filming");
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page.getByLabel("Content to schedule").selectOption({ label: title });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button").filter({ hasText: title }),
  ).toBeVisible();
  await page.goto("/published");
  await page.getByRole("button", { name: "Add video", exact: true }).click();
  await page.getByLabel("Video title").fill(title);
  await page.getByLabel("Related content idea").selectOption({ label: title });
  await page
    .getByLabel("Instagram post link", { exact: true })
    .first()
    .fill("https://www.instagram.com/reel/test-" + Date.now() + "/");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Record performance", exact: true })
    .click();
  await page.getByLabel("Published video").selectOption({ label: title });
  await page.getByLabel("Views", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/analytics");
  await expect(page.getByRole("cell").filter({ hasText: title })).toBeVisible();
});
test("mobile navigation and idea capture remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page
    .getByLabel("Workspace password")
    .fill(process.env.E2E_PASSWORD || "content-studio-local-2026");
  await page.getByRole("button", { name: "Enter your studio" }).click();
  await expect(
    page.getByRole("heading", { name: "Your content at a glance" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Capture idea", exact: true }).click();
  await expect(page.getByLabel("Content title", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "More" })
    .click();
  await expect(
    page.locator(".mobile-more").getByRole("link", { name: "Settings" }),
  ).toBeVisible();
});

test("all workspace pages render on desktop and mobile", async ({ page }) => {
  await page.goto("/dashboard");
  await page
    .getByLabel("Workspace password")
    .fill(process.env.E2E_PASSWORD || "content-studio-local-2026");
  await page.getByRole("button", { name: "Enter your studio" }).click();
  await expect(page.getByText("Your studio at a glance")).toBeVisible();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  for (const path of [
    "ideas",
    "pipeline",
    "calendar",
    "published",
    "analytics",
    "performance",
    "settings",
  ]) {
    await page.goto("/" + path);
    await expect(
      page.getByRole("main").getByRole("heading", { level: 1 }),
    ).toBeVisible();
    await expect(page.locator(".skeleton")).toHaveCount(0);
    await expect(
      page.getByRole("alert").filter({ hasText: "Unable to synchronize" }),
    ).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "dashboard",
    "ideas",
    "pipeline",
    "calendar",
    "published",
    "analytics",
    "performance",
    "settings",
  ]) {
    await page.goto("/" + path);
    await expect(
      page.getByRole("main").getByRole("heading", { level: 1 }),
    ).toBeVisible();
    await expect(page.locator(".skeleton")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      path + " fits mobile viewport",
    ).toBeTruthy();
    if (path === "dashboard")
      await page.screenshot({
        path: "test-results/dashboard-mobile.png",
        fullPage: true,
      });
  }
  expect(errors).toEqual([]);
});

test("offline reload reads last synced content and disables writes", async ({
  page,
  context,
}) => {
  await page.goto("/dashboard");
  await page
    .getByLabel("Workspace password")
    .fill(process.env.E2E_PASSWORD || "content-studio-local-2026");
  await page.getByRole("button", { name: "Enter your studio" }).click();
  await expect(page.getByText("Your studio at a glance")).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  await page.reload();
  await expect(page.getByText("Your studio at a glance")).toBeVisible();
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByText("Your studio at a glance")).toBeVisible();
    await expect(page.getByText(/Offline reading/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Capture idea", exact: true }),
    ).toBeDisabled();
  } finally {
    await context.setOffline(false);
  }
});


// Category suggestions are provided by the app, not browser autocomplete.
test('category picker lists, searches, and saves new categories', async ({page}) => {
  await page.goto('/dashboard');
  await page.getByLabel('Workspace password').fill(process.env.E2E_PASSWORD || 'content-studio-local-2026');
  await page.getByRole('button', {name:'Enter your studio'}).click();
  await expect(page.locator('.stats-grid')).toBeVisible();
  await page.getByRole('button', {name:'Capture idea',exact:true}).click();
  const category=page.getByRole('combobox',{name:'Category',exact:true});
  await category.click();
  await expect(page.getByRole('option',{name:'Cycling',exact:true})).toBeVisible();
  await category.fill('runn');
  await expect(page.getByRole('option',{name:'Running',exact:true})).toBeVisible();
  await category.press('ArrowDown');
  await category.press('Enter');
  await expect(category).toHaveValue('Running');
  await expect(page.getByRole('dialog')).toBeVisible();
  await category.fill('Category check '+Date.now());
  const newCategory=await category.inputValue();
  await page.getByRole('option',{name:'Tambah kategori “'+newCategory+'”',exact:true}).click();
  await page.getByLabel('Content title',{exact:true}).fill('Category picker verification');
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Capture idea',exact:true}).click();
  await page.getByRole('combobox',{name:'Category',exact:true}).click();
  await expect(page.getByRole('option',{name:newCategory,exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/ui-refresh/category-picker-mobile.png'});
  await page.getByRole('combobox',{name:'Category',exact:true}).press('Escape');
  await expect(page.getByRole('listbox',{name:'Categories'})).not.toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('post links show in the idea and opening the editor never saves', async ({page}) => {
  const title='Linked post '+Date.now();
  let writes=0;
  page.on('request', request => {if(request.url().endsWith('/api/studio') && request.method()==='POST') writes++;});
  await page.goto('/dashboard');
  await page.getByLabel('Workspace password').fill(process.env.E2E_PASSWORD || 'content-studio-local-2026');
  await page.getByRole('button',{name:'Enter your studio'}).click();
  await expect(page.locator('.stats-grid')).toBeVisible();
  await page.getByRole('button',{name:'Capture idea',exact:true}).click();
  await page.getByLabel('Content title',{exact:true}).fill(title);
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/pipeline');
  await page.getByRole('heading',{name:title,exact:true}).click();
  await page.getByLabel('Production & performance notes').fill('Keep my unsaved draft');
  const before=writes;
  await page.getByRole('button',{name:'Add published post link',exact:true}).click();
  await expect(page.getByLabel('Instagram post link',{exact:true})).toBeVisible();
  expect(writes).toBe(before);
  await page.getByRole('button',{name:'Back to idea',exact:false}).click();
  await expect(page.getByLabel('Production & performance notes')).toHaveValue('Keep my unsaved draft');
  expect(writes).toBe(before);
  await page.getByRole('button',{name:'Add published post link',exact:true}).click();
  const url='https://www.instagram.com/reel/link-'+Date.now()+'/';
  await page.getByLabel('Instagram post link',{exact:true}).fill(url);
  await page.getByRole('button',{name:'Save post links'}).click();
  await expect(page.getByRole('link',{name:url,exact:true})).toBeVisible();
  await expect(page.getByLabel('Production & performance notes')).toHaveValue('Keep my unsaved draft');
  expect(writes).toBe(before+1);
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByLabel('Change stage for '+title,{exact:true})).toHaveValue('Published');
  await page.getByRole('heading',{name:title,exact:true}).click();
  await expect(page.getByRole('link',{name:url,exact:true})).toBeVisible();
  const saved=writes;
  await page.getByRole('button',{name:'Edit published post links',exact:true}).click();
  await expect(page.getByLabel('Instagram post link',{exact:true})).toHaveValue(url);
  expect(writes).toBe(saved);
  await page.getByRole('button',{name:'Back to idea',exact:false}).click();
  expect(writes).toBe(saved);
});

test('choosing Published opens the linked post form instead of an error', async ({page}) => {
  const title='Publish from pipeline '+Date.now();
  await page.goto('/dashboard');
  await page.getByLabel('Workspace password').fill(process.env.E2E_PASSWORD || 'content-studio-local-2026');
  await page.getByRole('button',{name:'Enter your studio'}).click();
  await expect(page.locator('.stats-grid')).toBeVisible();
  await page.getByRole('button',{name:'Capture idea',exact:true}).click();
  await page.getByLabel('Content title',{exact:true}).fill(title);
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/pipeline');
  await page.getByLabel('Change stage for '+title,{exact:true}).selectOption('Published');
  await expect(page.getByLabel('Instagram post link',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Video title',{exact:true})).toHaveValue(title);
  await expect(page.getByLabel('TikTok post link',{exact:true})).toBeVisible();
  await expect(page.getByLabel('YouTube post link',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog'}).click();
  await expect(page.getByLabel('Change stage for '+title,{exact:true})).toHaveValue('Idea');
});

test('cancel idea requires a reason, persists it, stops plans, and can be restored', async ({page}) => {
  const title='Cancelled idea '+Date.now(),reason='Not relevant to my audience anymore';
  let writes=0;page.on('request',r=>{if(r.url().endsWith('/api/studio')&&r.method()==='POST')writes++;});
  await page.goto('/dashboard');
  await page.getByLabel('Workspace password').fill(process.env.E2E_PASSWORD || 'content-studio-local-2026');
  await page.getByRole('button',{name:'Enter your studio'}).click();
  await expect(page.locator('.stats-grid')).toBeVisible();
  await page.getByRole('button',{name:'Capture idea',exact:true}).click();
  await page.getByLabel('Content title',{exact:true}).fill(title);
  await page.getByRole('combobox',{name:'Production stage',exact:true}).selectOption('Filming');
  await page.getByLabel('Production & performance notes').fill('Keep my original notes');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/calendar');
  await page.getByRole('button',{name:'Schedule',exact:true}).click();
  await page.getByLabel('Content to schedule').selectOption({label:title});
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/ideas');await page.getByLabel('Search content').fill(title);
  const card=page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
  const before=writes;
  await card.getByRole('button',{name:'Cancel idea',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();expect(writes).toBe(before);
  await expect(page.getByRole('button',{name:'Cancel idea',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Keep idea',exact:true}).click();expect(writes).toBe(before);
  await card.getByRole('button',{name:'Cancel idea',exact:true}).click();
  await page.getByLabel('Cancellation reason',{exact:true}).fill(reason);
  await page.getByRole('button',{name:'Cancel idea',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(card.getByText('Cancelled',{exact:true})).toBeVisible();
  await expect(card.getByText(reason,{exact:false})).toBeVisible();
  await page.reload();await page.getByLabel('Search content').fill(title);
  await expect(card.getByText(reason,{exact:false})).toBeVisible();
  let cache=await page.evaluate(()=>JSON.parse(localStorage.getItem('cs-hosted-demo')!));
  const idea=cache.ideas.find((i:{title:string})=>i.title===title);
  expect(idea.cancellationReason).toBe(reason);expect(idea.notes).toBe('Keep my original notes');
  expect(cache.schedule.find((s:{contentId:string})=>s.contentId===idea.id).status).toBe('Cancelled');
  await page.getByLabel('Filter stage').selectOption('Cancelled');
  await expect(card).toBeVisible();
  await card.getByRole('button',{name:'Restore idea',exact:true}).click();
  await expect(card).not.toBeVisible();
  await page.getByLabel('Filter stage').selectOption('All stages');
  await expect(card.getByText('Filming',{exact:true})).toBeVisible();
  cache=await page.evaluate(()=>JSON.parse(localStorage.getItem('cs-hosted-demo')!));
  expect(cache.ideas.find((i:{id:string})=>i.id===idea.id).cancellationReason).toBe(reason);
  expect(cache.schedule.find((s:{contentId:string})=>s.contentId===idea.id).status).toBe('Cancelled');
});

test('pipeline cancellation prompts for a reason without saving on open', async ({page}) => {
  const title='Pipeline cancel '+Date.now();
  await page.setViewportSize({width:390,height:844});
  await page.goto('/dashboard');
  await page.getByLabel('Workspace password').fill(process.env.E2E_PASSWORD || 'content-studio-local-2026');
  await page.getByRole('button',{name:'Enter your studio'}).click();
  await expect(page.locator('.stats-grid')).toBeVisible();
  await page.getByRole('button',{name:'Capture idea',exact:true}).click();
  await page.getByLabel('Content title',{exact:true}).fill(title);
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/pipeline');
  const control=page.getByLabel('Change stage for '+title,{exact:true});
  await control.selectOption('Cancelled');
  await expect(page.getByLabel('Cancellation reason',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Keep idea',exact:true}).click();
  await expect(control).toHaveValue('Idea');
  await page.getByRole('heading',{name:title,exact:true}).click();
  await page.getByRole('button',{name:'Cancel idea',exact:true}).click();
  await expect(page.getByLabel('Cancellation reason',{exact:true})).toBeVisible();
  await page.getByLabel('Cancellation reason',{exact:true}).fill('No footage available');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(control).toHaveValue('Cancelled');
});


test('platform versions stay in one card and analytics never mix platforms', async ({page}) => {
  test.setTimeout(120000);
  await page.goto('/dashboard');
  await page.getByLabel('Workspace password').fill(process.env.E2E_PASSWORD || 'content-studio-local-2026');
  const loginResponse=page.waitForResponse(r=>r.url().endsWith('/api/session') && r.request().method()==='POST');
  await page.getByRole('button',{name:'Enter your studio'}).click();
  if((await loginResponse).status()===429) {
    await expect.poll(async()=> (await page.request.post('/api/session',{headers:{Origin:new URL(page.url()).origin},data:{password:process.env.E2E_PASSWORD || 'content-studio-local-2026'}})).status(),{timeout:70000,intervals:[10000]}).toBe(200);
    await page.goto('/dashboard');
  }
  await expect(page.locator('.stats-grid')).toBeVisible();
  expect((await (await page.request.get('/api/studio')).json()).mode).toBe('demo');
  await page.evaluate(() => {
    const dataset=JSON.parse(localStorage.getItem('cs-hosted-demo') || localStorage.getItem('cs-offline')!);
    const date=(offset:number)=>{const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)};
    dataset.videos=[{id:'platform-story',version:'demo-1',title:'Two versions of one story',category:'Workday',duration:'60',igUrl:'https://instagram.com/reel/version/',tiktokUrl:'https://tiktok.com/@creator/video/123',igDuration:'45',tiktokDuration:'70',igDate:date(-5),tiktokDate:date(-20)}];
    dataset.snapshots=[
      {id:'ig-old',version:'demo-1',videoId:'platform-story',title:'Two versions of one story',platform:'Instagram',date:date(-10),views:'3742',likes:'60',avgWatch:'30'},
      {id:'ig-new',version:'demo-1',videoId:'platform-story',title:'Two versions of one story',platform:'Instagram',date:date(-5),views:'3779',likes:'70',avgWatch:'30'},
      {id:'tt',version:'demo-1',videoId:'platform-story',title:'Two versions of one story',platform:'TikTok',date:date(-20),views:'245',likes:'4',avgWatch:'30'},
    ];
    dataset.mode='demo';dataset.persistence='browser';localStorage.setItem('cs-hosted-demo',JSON.stringify(dataset));
  });
  await page.goto('/published');
  const card=page.locator('.published-card');
  await expect(card).toHaveCount(1);
  const ig=card.getByRole('region',{name:'Instagram performance',exact:true});
  const tt=card.getByRole('region',{name:'TikTok performance',exact:true});
  await expect(ig).toContainText('3,779');await expect(ig).toContainText('45 sec');await expect(ig).toContainText('66.7%');
  await expect(tt).toContainText('245');await expect(tt).toContainText('70 sec');await expect(tt).toContainText('42.9%');
  await expect(card).not.toContainText('4,024');
  await card.getByText('Observation history (3)',{exact:true}).click();
  await card.getByLabel('Observation history platform').selectOption('TikTok');
  await expect(card.locator('.snapshot-line')).toHaveCount(1);
  await expect(card.locator('.snapshot-line')).toContainText('245 views');
  await card.getByRole('button',{name:'Edit details',exact:false}).click();
  await expect(page.getByText('Previous shared duration: 60 seconds (preserved).', {exact:false})).toBeVisible();
  await page.getByLabel('Instagram duration (seconds)',{exact:true}).fill('50');
  await page.getByLabel('TikTok duration (seconds)',{exact:true}).fill('75');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await expect(ig).toContainText('50 sec');await expect(tt).toContainText('75 sec');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('cs-hosted-demo')!));
  expect(saved.videos[0].duration).toBe('60');expect(saved.snapshots).toHaveLength(3);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'test-results/platform-card-mobile.png',fullPage:true});
  await page.goto('/dashboard');
  const tabs=page.getByRole('group',{name:'Analytics platform',exact:true});
  await expect(tabs.getByRole('button',{name:'Instagram',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.stats-grid')).toContainText('3,779');await expect(page.locator('.stats-grid')).not.toContainText('4,024');
  await tabs.getByRole('button',{name:'TikTok',exact:true}).click();
  await expect(page.locator('.stats-grid')).toContainText('245');await expect(page.locator('.story-table')).not.toContainText('Instagram');
  await page.goto('/analytics');
  await expect(page.getByRole('heading',{name:'TikTok analytics',exact:true})).toBeVisible();
  await expect(page.locator('.analytics-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.analytics-table tbody tr')).toContainText('245');
  await expect(page.locator('.analytics-table tbody tr')).toContainText('40%');
  await page.reload();await expect(tabs.getByRole('button',{name:'TikTok',exact:true})).toHaveAttribute('aria-pressed','true');
  await tabs.getByRole('button',{name:'YouTube',exact:true}).click();
  await expect(page.locator('.analytics-table tbody tr')).toHaveCount(0);
  await expect(page.getByText('No recorded metrics in this date range.',{exact:true})).toBeVisible();
  await tabs.getByRole('button',{name:'Instagram',exact:true}).click();
  await expect(page.locator('.analytics-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.analytics-table tbody tr')).toContainText('3,779');
});


test('performance tracker filters by date and saves explicit corrections with stable IDs', async ({page}) => {
  test.setTimeout(120000);
  await page.goto('/performance');
  await expect.poll(async()=> (await page.request.post('/api/session',{headers:{Origin:new URL(page.url()).origin},data:{password:process.env.E2E_PASSWORD || 'content-studio-local-2026'}})).status(),{timeout:70000,intervals:[10000]}).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Performance tracker',exact:true})).toBeVisible();
  expect((await (await page.request.get('/api/studio')).json()).mode).toBe('demo');
  await page.getByRole('button',{name:'Add observation',exact:true}).click();
  await page.getByRole('combobox',{name:'Published video',exact:true}).selectOption({index:1});
  await page.getByRole('combobox',{name:'Platform',exact:true}).selectOption('Instagram');
  await page.getByLabel('Observation date · WIB',{exact:true}).fill('2001-01-01');
  await page.getByLabel('Views',{exact:true}).fill('0');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByLabel('Observed from',{exact:true}).fill('2001-01-01');
  await page.getByLabel('Observed until',{exact:true}).fill('2001-01-03');
  const row=page.locator('.tracker-row');await expect(row).toHaveCount(1);await expect(row).toContainText('Instagram');
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('cs-hosted-demo')!).snapshots.find((s:{date:string})=>s.date==='2001-01-01'));
  let writes=0;page.on('request',r=>{if(r.url().endsWith('/api/studio')&&r.method()==='POST')writes++});
  await row.getByRole('button',{name:'Edit observation:',exact:false}).click();
  await expect(page.getByLabel('Views',{exact:true})).toHaveValue('0');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();expect(writes).toBe(0);
  await row.getByRole('button',{name:'Edit observation:',exact:false}).click();
  await page.getByRole('combobox',{name:'Platform',exact:true}).selectOption('TikTok');
  await page.getByLabel('Observation date · WIB',{exact:true}).fill('2001-01-02');
  await page.getByLabel('Views',{exact:true}).fill('245');
  await page.getByRole('button',{name:'Save correction',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();expect(writes).toBe(1);
  await expect(row).toContainText('TikTok');await expect(row).toContainText('2001-01-02');await expect(row).toContainText('245');
  await row.getByText('Correction history (1)',{exact:true}).click();await expect(row).toContainText('2001-01-01');await expect(row).toContainText('Instagram');
  await page.getByRole('combobox',{name:'Tracker platform',exact:true}).selectOption('Instagram');await expect(row).toHaveCount(0);
  await page.getByRole('combobox',{name:'Tracker platform',exact:true}).selectOption('TikTok');await expect(row).toHaveCount(1);
  await page.reload();await page.getByLabel('Observed from',{exact:true}).fill('2001-01-02');await page.getByLabel('Observed until',{exact:true}).fill('2001-01-02');await expect(row).toHaveCount(1);
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('cs-hosted-demo')!).snapshots.find((s:{date:string})=>s.date==='2001-01-02'));
  expect(after.id).toBe(before.id);expect(after.platform).toBe('TikTok');expect(JSON.parse(after.correctionHistory)[0].before.views).toBe('0');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'test-results/performance-tracker-mobile.png',fullPage:true});
  await page.goto('/published');
  await page.getByLabel('Search content').fill(after.title);
  const published=page.locator('.published-card').filter({has:page.getByRole('heading',{name:after.title,exact:true})});
  await published.locator('summary').click();
  await published.getByRole('button',{name:'Edit TikTok observation 2001-01-02',exact:true}).click();
  await expect(page.getByLabel('Views',{exact:true})).toHaveValue('245');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();expect(writes).toBe(1);
});


test('Instagram setup is explicit and does not sync on opening Settings', async ({page}) => {
  test.setTimeout(120000);
  await page.goto('/settings');
  await expect.poll(async()=> (await page.request.post('/api/session',{headers:{Origin:new URL(page.url()).origin},data:{password:process.env.E2E_PASSWORD || 'content-studio-local-2026'}})).status(),{timeout:70000,intervals:[10000]}).toBe(200);
  let syncs=0;page.on('request',r=>{if(r.url().endsWith('/api/instagram/sync'))syncs++});
  await page.reload();
  const panel=page.locator('.instagram-settings');
  await expect(panel.getByRole('heading',{name:'Instagram insights'})).toBeVisible({timeout:20000});
  await expect(panel.getByRole('button',{name:'Sync Instagram',exact:true})).toBeDisabled();
  await panel.getByRole('button',{name:'Connect Instagram',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('Instagram is not configured yet');
  expect(syncs).toBe(0);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await panel.screenshot({path:'test-results/instagram-settings-mobile.png'});
});

test('System User validation stays in Settings and enables explicit sync', async ({page}) => {
  let connected=false, validations=0, syncs=0;
  await page.route('**/api/studio', async route => {
    if(route.request().method()!=='GET') throw new Error('Validation must not write studio data');
    const response=await route.fetch();
    const dataset=await response.json();
    return route.fulfill({json:{...dataset,mode:'live',writable:true}});
  });
  await page.route('**/api/instagram', async route => {
    if(route.request().method()==='POST') {
      validations++; connected=true;
      return route.fulfill({json:{connected:true,username:'creator'}});
    }
    return route.fulfill({json:{configured:true,connected,username:connected?'creator':'',expiresAt:null,connectionMethod:'system_user'}});
  });
  page.on('request', r=>{if(r.url().endsWith('/api/instagram/sync'))syncs++});
  await page.goto('/settings');
  await page.request.post('/api/session',{headers:{Origin:new URL(page.url()).origin},data:{password:process.env.E2E_PASSWORD || 'content-studio-local-2026'}});
  await page.reload();
  const panel=page.locator('.instagram-settings');
  await expect(panel.getByRole('button',{name:'Sync Instagram',exact:true})).toBeDisabled();
  expect(validations).toBe(0);
  await panel.getByRole('button',{name:'Validate Instagram connection',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('Connected to @creator');
  await expect(panel.getByRole('button',{name:'Sync Instagram',exact:true})).toBeEnabled();
  expect(page.url()).toContain('/settings');
  expect(validations).toBe(1);
  expect(syncs).toBe(0);
});
