import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createFileLog } from './file-log.js';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-log-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('file log', () => {
  it('appends dated lines at the end of the file', () => {
    const log = createFileLog({ dir, now: () => new Date('2026-10-26T12:00:00.000Z') });
    log.write('first');
    log.write('second');
    expect(fs.readFileSync(log.file, 'utf-8')).toBe(
      '2026-10-26T12:00:00.000Z first\n2026-10-26T12:00:00.000Z second\n');
  });

  it('rotates past the maximum size and never keeps more than two files', () => {
    const log = createFileLog({ dir, maxBytes: 100 });
    for (let i = 0; i < 40; i++) log.write(`line ${i} ${'x'.repeat(20)}`);
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual(['print-agent.log', 'print-agent.log.1']);
    expect(fs.readFileSync(log.file, 'utf-8')).toContain('line 39');
    expect(fs.readFileSync(`${log.file}.1`, 'utf-8')).toContain('line ');
    expect(fs.statSync(log.file).size).toBeLessThan(400);
  });

  it('does not throw when the folder cannot be written', () => {
    const blocker = path.join(dir, 'file-not-folder');
    fs.writeFileSync(blocker, '');
    const log = createFileLog({ dir: path.join(blocker, 'logs') });
    expect(() => log.write('x')).not.toThrow();
  });
});
