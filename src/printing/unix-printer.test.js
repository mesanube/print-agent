import { describe, it, expect, vi, beforeEach } from 'vitest';

// The unix path is a development-only renderer (raw text through lp); the notice
// (KTD11) still has to land at the top of its tickets, like in the other two renderers.
const written = [];
vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn(async (_file, text) => { written.push(text); }),
    unlink: vi.fn(async () => {}),
  },
}));
vi.mock('child_process', () => ({ exec: vi.fn((_cmd, callback) => callback(null, { stdout: '', stderr: '' })) }));
vi.mock('../core/store.js', () => ({ getSelectedPrinter: vi.fn(() => 'Caja') }));
vi.mock('./printer-manager.js', () => ({ getSystemPrinters: vi.fn(async () => [{ name: 'Caja' }]) }));

const { printReceipt, printOrder, printOrderUpdate } = await import('./unix-printer.js');

const order = { dailyOrderNumber: 7, table: '3', waiter: { name: 'Ana' }, items: [{ name: 'Pizza', quantity: 1 }], orderTotal: 1000 };
const notice = { title: 'ATRASADA', lines: ['Comandado a las: 21:10', 'Hora actual: 21:35'] };

beforeEach(() => {
  written.length = 0;
});

describe('unix printer notice', () => {
  const prints = {
    receipt: (extra = {}) => printReceipt({ order, restaurant: { name: 'Bar' }, ...extra }),
    comanda: (extra = {}) => printOrder({ order, restaurant: { name: 'Bar' }, ...extra }),
    'order update': (extra = {}) => printOrderUpdate({ order, lines: [{ kind: 'add', quantity: 1, name: 'Flan' }], ...extra }),
  };

  for (const [name, print] of Object.entries(prints)) {
    it(`${name}: starts with the title and the lines, before the usual header`, async () => {
      await print({ notice });
      expect(written[0].startsWith('ATRASADA\nComandado a las: 21:10\nHora actual: 21:35\n')).toBe(true);
    });

    it(`${name}: without a notice the text is the one it always was`, async () => {
      await print();
      const plain = written[0];
      for (const empty of [null, {}, { title: '', lines: [] }]) {
        await print({ notice: empty });
        expect(written.at(-1)).toBe(plain);
      }
      expect(plain).not.toContain('ATRASADA');
    });

    it(`${name}: a title with no lines prints just the title`, async () => {
      await print({ notice: { title: 'ATRASADA' } });
      expect(written[0].startsWith('ATRASADA\n================\n')).toBe(true);
    });
  }
});
