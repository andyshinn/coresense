import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import type { Channel } from '../../src/shared/types';
import { launchApp } from './support/launch';

// My Node's Location card in the real app: type a position and save it over
// the replay transport, then (where map tiles and WebGL are available) drag
// the pin. The connect fixture's frames are reused with an auto-OK for
// CMD_SET_ADVERT_LATLON (14), so the save gets the radio's RESP_OK.

const SET_ADVERT_LATLON = 14;

const CHANNELS: Channel[] = [
  { key: 'ch:Public', name: 'Public', kind: 'public', idx: 0, secretHex: '00112233445566778899aabbccddeeff' },
];

let dir: string;
let fixture: string;

test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'coresense-e2e-fixture-'));
  fixture = join(dir, 'my-node.json');
  const frames = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/frames/e2e-connect.json'), 'utf8'));
  writeFileSync(fixture, JSON.stringify({ frames, autoOkOpcodes: [SET_ADVERT_LATLON] }));
});

test.afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function openMyNode(page: Page) {
  // RESP_SELF_INFO carries the advert name; the owner card's name opens My Node.
  await expect(page.getByTestId('owner-name')).toHaveText('egrme.sh Hand');
  await page.getByTestId('owner-name').click();
  await expect(page.getByLabel('Latitude')).toBeEditable();
}

/** Drop any position draft, so closing the app isn't held by the quit prompt. */
async function revertDraft(page: Page) {
  const revert = page.getByRole('button', { name: 'Revert' });
  if (await revert.isEnabled().catch(() => false)) await revert.click();
}

test('My Node: type a position and push it to the radio', async () => {
  const { page, close } = await launchApp({ fixture });
  try {
    await openMyNode(page);
    await page.getByLabel('Latitude').fill('51.50123');
    await page.getByLabel('Longitude').fill('-0.14189');
    await expect(page.getByText('Unsaved', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Position pushed to radio')).toBeVisible();
    // The radio's OK updates the identity, which ends the draft.
    await expect(page.getByText('Unsaved', { exact: true })).toBeHidden();
    await expect(page.getByLabel('Latitude')).toHaveValue('51.50123');
  } finally {
    await revertDraft(page);
    await close();
  }
});

test('My Node: leaving with an unsaved position asks first', async () => {
  const { page, close } = await launchApp({ fixture, channels: CHANNELS });
  try {
    await openMyNode(page);
    await page.getByLabel('Latitude').fill('40');
    await page.getByLabel('Longitude').fill('10');

    const publicItem = page.getByTestId('channel-nav-item').filter({ hasText: 'Public' });
    await publicItem.waitFor({ state: 'attached' });
    if (!(await publicItem.isVisible())) await page.getByText('Channels', { exact: true }).click();
    await publicItem.click();
    await expect(page.getByText('Unsaved position')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Latitude')).toHaveValue('40');

    await publicItem.click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('channel-view')).toHaveAttribute('data-channel-key', 'ch:Public');
  } finally {
    await revertDraft(page);
    await close();
  }
});

test('My Node: dragging the pin makes a draft', async () => {
  const { page, close } = await launchApp({ fixture });
  try {
    await openMyNode(page);
    const map = page.getByTestId('location-map');
    const noTiles = map.getByText("Map tiles aren't installed");
    const failed = map.getByText('The map failed to render');
    const canvas = map.locator('canvas');
    await expect(noTiles.or(failed).or(canvas)).toBeVisible();
    // The e2e build resolves tiles under .vite/build, and CI checks out without
    // Git LFS, so there is usually no basemap; a GPU-less runner has no WebGL2.
    // Either way there is no map to drag on: decide before typing anything.
    test.skip(await noTiles.isVisible(), 'No basemap in the e2e build, so there is no map to drag the pin on');
    test.skip(await failed.isVisible(), 'No WebGL2 in this environment, so the map cannot render');

    // The pin starts on the radio's own position, where the map opens.
    const savedLat = await page.getByLabel('Latitude').inputValue();
    const savedLon = await page.getByLabel('Longitude').inputValue();
    const pin = map.locator('.cs-map-drag');
    await expect(pin).toBeVisible();
    const box = await pin.boundingBox();
    if (!box) throw new Error('pin has no box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 20, { steps: 8 });
    await page.mouse.move(x + 60, y + 40, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByLabel('Latitude')).not.toHaveValue(savedLat);
    await expect(page.getByLabel('Longitude')).not.toHaveValue(savedLon);
    await expect(page.getByText('Unsaved', { exact: true })).toBeVisible();
  } finally {
    await revertDraft(page);
    await close();
  }
});
