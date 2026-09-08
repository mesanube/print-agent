// Renders a calibration page: a full-width ruler with marks every 10% of the
// printable width. The operator prints it and reads the number where the
// paper actually cuts the ruler; that number is the width adjust to enter in
// settings (plan 2026-08-19-001, U3 — the residual case H4 cannot detect via
// device query: a driver that scales the bitmap to the physical page instead
// of drawing it dot-for-dot).
export function renderCalibrationHtml() {
  const marks = Array.from({ length: 11 }, (_, i) => i * 10); // 0, 10, ..., 100
  const marksHtml = marks
    .map((pct) => `
      <div class="mark" style="left: ${pct}%;">
        <div class="tick"></div>
        <div class="label">${pct}</div>
      </div>`)
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Calibracion</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; font-family: monospace; color: #000; }
    body { padding: 16px 0 30px; }
    .title { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 6px; }
    .subtitle { text-align: center; font-size: 13px; margin-bottom: 24px; }
    .ruler { position: relative; height: 50px; margin: 0 2px; }
    .rule { position: absolute; top: 22px; left: 0; right: 0; border-top: 2px solid #000; }
    .mark { position: absolute; top: 0; width: 0; text-align: center; }
    .mark .tick { height: 22px; width: 2px; background: #000; margin: 0 auto; }
    .mark .label { font-size: 12px; font-weight: bold; margin-top: 2px; white-space: nowrap; transform: translateX(-50%); }
    .note { text-align: center; font-size: 13px; margin-top: 30px; padding: 0 8px; }
    .note strong { display: block; font-size: 15px; margin-bottom: 6px; }
  </style>
</head>
<body>
  <div class="title">PAGINA DE CALIBRACION</div>
  <div class="subtitle">Ancho de papel</div>
  <div class="ruler">
    ${marksHtml}
    <div class="rule"></div>
  </div>
  <div class="note">
    <strong>Lea el numero donde el papel corta la regla</strong>
    Cargue ese numero como ajuste de ancho en la configuracion del agente.
  </div>
</body>
</html>`;
}
