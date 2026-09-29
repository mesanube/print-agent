// Text test page (R11): lets whoever sets up a printer check, before relying
// on text mode, that the printer understands ESC/POS text, the CP858 accents,
// the column width, the native QR and the cut as configured for it.

import { twoColumns, center, rule } from './layout.js';

export function buildTextTestPage({ printerName = '' } = {}, ctx) {
  const { cols, paper } = ctx;
  const ruler = Array.from({ length: cols }, (_, i) => String((i + 1) % 10)).join('');
  const text = (t, style = {}) => ({ type: 'text', text: t, ...style });
  return [
    text(center('PRUEBA DE TEXTO', cols), { bold: true, height: 2 }),
    text(center(printerName, cols)),
    text(center(`Papel ${paper}, ${cols} columnas`, cols)),
    text(rule(cols)),
    text('Acentos: á é í ó ú  Á É Í Ó Ú'),
    text('Eñe: ñ Ñ  Diéresis: ü Ü'),
    text('Precio: $ 1.234,56'),
    text(rule(cols)),
    text('Regla de columnas:'),
    text(ruler),
    ...twoColumns('Milanesa napolitana x2', '$25.000,00', cols).map((t) => text(t)),
    text(rule(cols)),
    text(center('Negrita', cols), { bold: true }),
    text(center('Doble alto', cols), { height: 2 }),
    text(center('Doble', Math.floor(cols / 2)), { width: 2, height: 2 }),
    text(center('Invertido', cols), { invert: true }),
    text(rule(cols)),
    text(center('QR de ejemplo', cols)),
    { type: 'qr', data: 'https://www.mesanube.com' },
    text(center('Si todo se lee bien, esta impresora', cols)),
    text(center('puede quedar en modo Texto.', cols)),
    { type: 'feed', lines: 3 },
  ];
}
