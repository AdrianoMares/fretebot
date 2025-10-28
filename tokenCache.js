// Simple file-based JWT cache
import fs from 'fs/promises';

export async function readToken(cachePath) {
  try {
    const raw = await fs.readFile(cachePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !data.token) return null;
    // if has exp (seconds timestamp), ensure still valid for 2 minutes
    if (data.exp && Date.now() >= (data.exp - 120) * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export async function writeToken(cachePath, payload) {
  const data = JSON.stringify(payload, null, 2);
  await fs.writeFile(cachePath, data, 'utf-8');
}
