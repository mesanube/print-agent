import fs from 'fs';
import path from 'path';

const DEFAULT_MAX_BYTES = 1024 * 1024;

/**
 * Append-only log file with a bounded size: when the file passes `maxBytes`
 * it becomes `<name>.1` (replacing the previous one) and a new file starts, so
 * there are never more than two files (R4). A write failure never throws: the
 * log must not be able to break a print job.
 * @param {{dir: string, name?: string, maxBytes?: number, now?: () => Date}} options
 */
export function createFileLog({ dir, name = 'print-agent.log', maxBytes = DEFAULT_MAX_BYTES, now = () => new Date() }) {
  const file = path.join(dir, name);
  const previous = `${file}.1`;

  function write(line) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      try {
        if (fs.statSync(file).size >= maxBytes) fs.renameSync(file, previous);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      fs.appendFileSync(file, `${now().toISOString()} ${line}\n`);
    } catch {
      // Logging is best effort.
    }
  }

  return { write, file };
}

// Process-wide log, enabled once the app knows its data folder. Before that
// (and in tests) writes are no-ops.
let active = null;

export function initFileLog(options) {
  active = createFileLog(options);
  return active;
}

/** Logs to the console and, once enabled, to the persistent file. */
export function logToFile(line) {
  console.log(line);
  active?.write(line);
}
