import { chromium } from 'playwright';

const pages = ['/mikami/', '/mikami/personajes', '/mikami/personajes/19564', '/mikami/episodios', '/mikami/info', '/mikami/galeria'];
const viewports = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

for (const [name, viewport] of Object.entries(viewports)) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  for (const p of pages) {
    await page.goto(`http://127.0.0.1:4321${p}`, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
    const slug = p.replace(/\//g, '_') || 'root';
    await page.screenshot({ path: `/tmp/claude-0/-home-user-mikami/82167168-36df-55c9-b3bb-64f35b205173/scratchpad/${name}${slug}.png`, fullPage: true });
  }
  await context.close();
}

await browser.close();
console.log('done');
