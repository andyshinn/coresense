import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './support/launch';

// Decodes to a GroupText mesh packet; reused from the component tests
// (packet-decoder-dialog.test.tsx, rail-packetlog.test.tsx) since it's a
// known-good fixture that produces both breakdown sections.
const GROUP_TEXT_HEX = '1501782abbcc00112233';

const SCREENSHOT_DIR = join(process.cwd(), 'test-results', 'packet-log');
const SCREENSHOT_PATH = join(SCREENSHOT_DIR, 'decoder-dialog.png');

test('Packet Log view mounts and the standalone decoder decodes + spotlights bytes on hover', async () => {
  const { page, close } = await launchApp();
  try {
    // a) Navigate to the Packet Log via the left nav; the "RAW PACKETS"
    // toolbar header is the mount signal (present even with an empty list).
    await page.getByRole('button', { name: 'Packet Log' }).click();
    await expect(page.getByText('RAW PACKETS')).toBeVisible();

    // b) Open the standalone decoder via the right rail's empty-state
    // "Decode hex…" button. The rail starts closed (only the Contact
    // Manager auto-opens it), so open it first.
    await page.getByRole('button', { name: 'Show right rail' }).click();
    await page.getByRole('button', { name: /Decode hex/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Decode a packet' });
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder(/paste/i).fill(GROUP_TEXT_HEX);
    await dialog.getByRole('button', { name: 'Decode', exact: true }).click();

    await expect(dialog.getByText('Packet Byte Breakdown')).toBeVisible();
    await expect(dialog.getByText('Group Text Payload Byte Breakdown')).toBeVisible();

    // c) Verify the byte↔field hover spotlight (fix-wave-1 dialog-hover fix:
    // the dialog now stores raw decode data instead of frozen JSX, so hover
    // updates live). Every field card starts fully opaque; hovering a byte
    // should dim every field but the one it maps to.
    const fieldCards = dialog.locator('[aria-label*=" field, "]');
    const opacitiesBefore = await fieldCards.evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
    expect(opacitiesBefore.length).toBeGreaterThan(1);
    expect(opacitiesBefore.every((o) => o === '1')).toBe(true);

    // Byte 0x15 (header) — all ten decoded byte values are distinct, so its
    // rendered hex text "15" is unique within the dialog.
    const headerByte = dialog.getByText('15', { exact: true });
    await headerByte.hover();

    // React needs a tick to flush the hover-driven re-render; poll rather
    // than reading getComputedStyle once immediately after .hover().
    await expect
      .poll(async () => {
        const opacities = await fieldCards.evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
        return opacities.filter((o) => o === '0.55').length;
      })
      .toBeGreaterThan(0);

    const opacitiesAfter = await fieldCards.evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
    expect(opacitiesAfter.filter((o) => o === '1').length).toBeGreaterThan(0);

    // The breakdown stays rendered — hovering didn't throw or unmount anything.
    await expect(dialog.getByText('Packet Byte Breakdown')).toBeVisible();
    await expect(dialog.getByText('Group Text Payload Byte Breakdown')).toBeVisible();

    // d) Screenshot the decoder dialog with the breakdown + spotlight visible.
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH });
  } finally {
    await close();
  }
});
