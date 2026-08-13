import fs from 'fs';
import path from 'path';
import { getLogoPath } from '../core/store.js';

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp'
  };
  return mimeTypes[ext] || 'image/png';
}

export function getAbsoluteLogoPath() {
  const logoPath = getLogoPath();
  if (!logoPath) return null;
  try {
    return fs.existsSync(logoPath) ? logoPath : null;
  } catch (error) {
    console.error('[Logo] Error accessing logo path:', error);
    return null;
  }
}

export function getLogoAsBase64() {
  const logoPath = getAbsoluteLogoPath();
  if (!logoPath) return null;
  try {
    const imageBuffer = fs.readFileSync(logoPath);
    const mimeType = getMimeType(logoPath);
    const base64 = imageBuffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('[Logo] Failed to convert logo to base64:', error);
    return null;
  }
}