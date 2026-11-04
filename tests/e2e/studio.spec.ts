import { test, expect } from "@playwright/test";
test.setTimeout(60000);
test("authentication protects private API", async ({ request }) => {
  expect((await request.get("/api/studio")).status()).toBe(401);
  expect((await request.get('/api/google')).status()).toBe(401);
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
