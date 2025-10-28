import fs from 'fs/promises';

export async function readToken(cachePath) {
  try {
    const raw = await fs.readFile(cachePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.token) return null;
    if (data.exp && Date.now() >= (data.exp - 120) * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export async function writeToken(cachePath, payload) {
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf-8');
}
