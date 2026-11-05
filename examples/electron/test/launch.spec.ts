import { _electron as electron, expect, test } from '@playwright/test';

test('launches the built app and reads the window title', async () => {
  const app = await electron.launch({ args: ['.'] });
  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle('Electron spike');
  } finally {
    await app.close();
  }
});
