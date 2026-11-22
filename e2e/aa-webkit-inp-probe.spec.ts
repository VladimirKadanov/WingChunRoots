// TEMPORARY probe (PR #77): WebKit selection timing, named to run before the M05 test (cold browser). Removed before merge.
import { test } from '@playwright/test';
import { closeHelpers, loadTestEnv } from './helpers/auth';
import { edgesInto, openExplorer, personIdOf } from './helpers/explorer';
import { installInpProbes, selectionInp, settledView } from './helpers/explorer-checks';
test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);
const VARIANTS: Record<string, string | null> = {
  asIs: null,
  legendOpen: '.explorer-legend details, .explorer-legend details::details-content, .explorer-legend details > div { display: contents !important; content-visibility: visible !important } .explorer-legend summary { display: none !important }',
  noLegend: '.explorer-legend { display: none !important }',
  noOptions: '[data-testid="explorer-options"] { display: none !important }',
};
for (const [name, css] of Object.entries(VARIANTS)) {
  for (const settle of [false, true]) {
    test(`probe ${name} settle=${settle}`, { tag: '@vitals' }, async ({ page, browserName }) => {
      test.skip(browserName !== 'webkit');
      await installInpProbes(page);
      const id = await personIdOf('demo-two-lineages');
      await openExplorer(page, { focus: id });
      if (css) await page.addStyleTag({ content: css });
      if (settle) await settledView(page);
      const teachers = await edgesInto(page, id).evaluateAll((paths) => paths.map((p) => p.getAttribute('data-teacher')!));
      const targets = [id, ...teachers];
      await selectionInp(page, browserName, 3, async (selected) => targets[selected.length] ?? null);
      const frames = await page.evaluate(() => (window as unknown as { __inp: { frames: number[] } }).__inp.frames.map(Math.round));
      const covered = await page.evaluate(() => !!document.querySelector('[data-sheet-covered]'));
      console.log(`PROBE ${name} settle=${settle} frames=${frames.join(',')} covered=${covered}`);
    });
  }
}
