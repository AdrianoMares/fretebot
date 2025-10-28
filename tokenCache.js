import fs from 'fs';
const TOKEN_FILE = '.token.json';

export function saveToken(token, expSeconds) {
  const expAt = Date.now() + expSeconds * 1000;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, expAt }), 'utf-8');
}

export function readValidToken() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    if (Date.now() < data.expAt - 30000) return data.token;
    return null;
  } catch {
    return null;
  }
}
