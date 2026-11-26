import { expect, test } from '@playwright/test';
import type { OpenProject, Preferences, ProjectCatalog, StudioBridge, SystemTheme } from '@factory/contracts';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let settings: Preferences = { theme: 'system', sidebarWidth: 240 };
    let systemTheme: SystemTheme = 'light';
    const listeners = new Set<(theme: SystemTheme) => void>();
    document.addEventListener('fixture:system-theme', (event) => {
      if (event instanceof CustomEvent && (event.detail === 'dark' || event.detail === 'light')) {
        systemTheme = event.detail;
        for (const listener of listeners) listener(systemTheme);
      }
    });
    const project: OpenProject = {
      id: '02b192a8-b874-4423-9add-af527064998f',
      recentId: '02b192a8-b874-4423-9add-af527064998e',
      name: 'Renderer fixture',
      directory: '/fixture/Renderer fixture',
      availability: 'ready',
      metadata: { status: 'absent' },
      entries: [
        { path: 'src', kind: 'directory', modifiedAt: null, size: null },
        { path: 'src/index.ts', kind: 'file', modifiedAt: null, size: 25 },
        { path: 'external-link', kind: 'link', modifiedAt: null, size: null },
      ],
      partial: false,
      refreshing: false,
    };
    let catalog: ProjectCatalog = { revision: 0, projects: [], recents: [], recentsStatus: 'ready' };
    const select = async () => {
      catalog = { ...catalog, revision: catalog.revision + 1, projects: [project], recents: [{
        id: project.recentId, name: project.name, directory: project.directory, availability: project.availability,
      }] };
      return { ok: true, value: { projectId: project.id, catalog } } as const;
    };
    const studio: StudioBridge = {
      projects: {
        list: async () => ({ ok: true, value: catalog }),
        openFolder: select,
        openRecent: select,
        locateRecent: select,
        removeRecent: async () => {
          catalog = { ...catalog, revision: catalog.revision + 1, recents: [] };
          return { ok: true, value: catalog };
        },
        rescan: async () => ({ ok: true, value: catalog }),
        close: async () => {
          catalog = { ...catalog, revision: catalog.revision + 1, projects: [] };
          return { ok: true, value: catalog };
        },
        onChange: () => () => undefined,
      },
      getAppInfo: () => Promise.resolve({ ok: true, value: { version: '0.1.0', platform: 'linux' } }),
      readPreferences: () => Promise.resolve({
        ok: true, value: { preferences: settings, storage: 'ready', systemTheme },
      }),
      writePreferences: (request) => {
        if (request.action !== 'update') return Promise.resolve({ ok: false, error: 'INVALID_REQUEST' });
        settings = { ...settings, ...request.changes };
        return Promise.resolve({ ok: true, value: settings });
      },
      onSystemThemeChange: (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    };
    Object.defineProperty(window, 'studio', { value: studio });
  });
});

test('only functional destinations are available through the workbench and command palette', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(4);
  await expect(page.getByRole('navigation').getByText('Projects', { exact: true })).toBeVisible();

  const commandTrigger = page.getByRole('button', { name: 'Open command palette' });
  await commandTrigger.focus();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Search commands' });
  await expect(search).toBeFocused();
  await search.fill('clone repository');
  await expect(page.getByText('No matching commands.')).toBeVisible();
  await search.press('Escape');
  await expect(commandTrigger).toBeFocused();

  await page.keyboard.press('Control+k');
  await search.fill('settings');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});

test('themes follow native changes in System mode and render explicit Light and Dark', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  const documentRoot = page.locator('html');
  await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('fixture:system-theme', { detail: 'dark' })));
  await expect(documentRoot).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: 'Light' }).check();
  await expect(documentRoot).toHaveAttribute('data-theme', 'light');
  await expect(page.getByText('Preferences saved')).toBeVisible();
  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(documentRoot).toHaveAttribute('data-theme', 'dark');
});

test('sidebar responds to keyboard and pointer and preserves expanded width', async ({ page }) => {
  await page.goto('/');
  const divider = page.getByRole('separator', { name: 'Sidebar width' });
  await expect(divider).toHaveAttribute('aria-disabled', 'false');
  await divider.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '248');
  await divider.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '180');

  const box = await divider.boundingBox();
  if (!box) throw new Error('The sidebar separator is missing.');
  await page.mouse.move(box.x, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180, { steps: 5 });
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '320');

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('navigation', { name: 'Global navigation' })).toBeHidden();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(divider).toHaveAttribute('aria-valuenow', '320');
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 640, height: 400 }]) {
  test(`the shell is operable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Open command palette' })).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeInViewport();
    await page.getByRole('button', { name: 'Open Settings' }).click();
    await expect(page.getByRole('radio', { name: 'Light' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  });
}

test('browser development uses session-only preview even when a test bridge is present', async ({ page }) => {
  const preview = 'http://127.0.0.1:4492/';
  await page.goto(preview);
  await expect(page.getByText('Desktop preferences unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Folder', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByText('Preferences saved')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();
});

test('projects appear in tabs, can be browsed with disclosures, and reopen from recents', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Folder', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project Overview' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Renderer fixture' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Browse files' }).click();
  await expect(page.getByRole('heading', { name: 'Project Structure' })).toBeVisible();
  await expect(page.getByText('index.ts')).toBeHidden();
  await page.getByRole('button', { name: 'src', exact: true }).press('Enter');
  await expect(page.getByText('index.ts')).toBeVisible();
  await expect(page.getByText('Link skipped')).toBeVisible();
  await page.getByRole('tab', { name: 'Renderer fixture' }).press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Workspace', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('navigation').getByRole('button', { name: 'Recent Projects' }).click();
  await page.getByRole('button', { name: 'Open Renderer fixture' }).click();
  await expect(page.getByRole('heading', { name: 'Project Structure' })).toBeVisible();
  await page.getByRole('tab', { name: 'Renderer fixture' }).press('Delete');
  await expect(page.getByRole('tab', { name: 'Renderer fixture' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Recent Projects' })).toBeVisible();
});
