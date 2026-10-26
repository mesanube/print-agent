import path from 'path';
import os from 'os';
import fs from 'fs/promises';

/**
 * Deletes the temp receipt PNGs the GDI transport leaves behind when the agent
 * is closed abruptly (forced kill, Windows shutdown). Runs on quit and on
 * start, with the same rule: only `receipt-*.png`.
 * @param {{dir?: string}} [options]
 */
export async function cleanupTempReceipts({ dir = os.tmpdir() } = {}) {
  console.log(`[Cleanup] Scanning temp directory: ${dir}`);
  const files = await fs.readdir(dir);
  const receiptFiles = files.filter(f => f.startsWith('receipt-') && f.endsWith('.png'));

  if (receiptFiles.length === 0) {
    console.log('[Cleanup] No temp receipt files found');
    return 0;
  }
  console.log(`[Cleanup] Found ${receiptFiles.length} temp receipt files to delete`);
  let deleted = 0;
  await Promise.all(
    receiptFiles.map(async (file) => {
      try {
        await fs.unlink(path.join(dir, file));
        deleted++;
        console.log(`[Cleanup] Deleted: ${file}`);
      } catch (err) {
        console.warn(`[Cleanup] Could not delete ${file}: ${err.message}`);
      }
    })
  );
  return deleted;
}
