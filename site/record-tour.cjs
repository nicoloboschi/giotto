// Writes docs/tour.svg, the README's walkthrough: the docs (served from _site) exported as one animated SVG.
// Needs Playwright: node site/build.mjs && (cd _site && python3 -m http.server 4396) &
//                   NODE_PATH=$(npm root -g) node site/record-tour.cjs http://localhost:4396/ docs/tour.svg
// CHROME=/path/to/chrome uses that browser instead of Playwright's own.
const fs = require('fs');
const { chromium } = require('playwright');
const [url = 'http://localhost:4396/', out = 'docs/tour.svg'] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 1000, height: 625 }, colorScheme: 'light' });
  page.on('pageerror', (e) => console.error(e.message));
  await page.goto(`${url}?export`);
  await page.waitForFunction(() => window.exportTour);
  const svg = await page.evaluate(() => window.exportTour());
  fs.writeFileSync(out, svg);
  console.log(`${out}: ${(svg.length / 1e6).toFixed(2)} MB`);
  await browser.close();
})();
