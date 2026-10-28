import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cleanupTempReceipts } from './temp-cleanup.js';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-cleanup-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('temp receipt cleanup', () => {
  it('deletes receipt-*.png files and nothing else', async () => {
    for (const name of ['receipt-a.png', 'receipt-b.png', 'receipt-c.txt', 'other.png', 'print-job-1.png']) {
      fs.writeFileSync(path.join(dir, name), '');
    }
    await cleanupTempReceipts({ dir });
    expect(fs.readdirSync(dir).sort()).toEqual(['other.png', 'print-job-1.png', 'receipt-c.txt']);
  });
});
