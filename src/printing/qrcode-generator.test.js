import { describe, it, expect } from 'vitest';
import { generateAfipQRCodeData } from './qrcode-generator.js';

const invoice = {
  fechaEmision: '20261102',
  docEmisor: '20108918706',
  puntoVenta: 4,
  tipoComprobante: 8,
  numeroComprobante: 7,
  total: 49700,
  tipoDocReceptor: '99',
  docReceptor: '0',
  cae: '86440666869541',
};

describe('generateAfipQRCodeData', () => {
  // ARCA answers "BL..." unless the length of p is a multiple of 4. These numbers
  // cover the three possible remainders of the encoded payload.
  it.each([7, 77, 777])('keeps the base64 padding for comprobante %i', (numeroComprobante) => {
    const url = generateAfipQRCodeData({ ...invoice, numeroComprobante });
    expect(url.split('?p=')[1].length % 4).toBe(0);
  });

  it('encodes the RG 4892 fields unchanged', () => {
    const decoded = JSON.parse(Buffer.from(generateAfipQRCodeData(invoice).split('?p=')[1], 'base64').toString());
    expect(decoded).toMatchObject({ fecha: '2026-11-02', cuit: 20108918706, tipoCmp: 8, nroCmp: 7, importe: 49700, moneda: 'PES' });
  });
});
