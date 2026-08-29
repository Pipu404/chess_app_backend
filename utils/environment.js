const fs = require('fs');
const path = require('path');

function loadEnvironment() {
  const values = new Map();
  for (const filename of ['.env', '.env.local']) {
    const envPath = path.resolve(__dirname, '..', filename);
    if (!fs.existsSync(envPath)) continue;

    for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) continue;

      const key = line.slice(0, separatorIndex).trim();
      if (!key) continue;
      if (filename === '.env' && values.has(key)) continue;
      values.set(key, line.slice(separatorIndex + 1).trim());
    }
  }

  for (const [key, value] of values) process.env[key] = value;
}

module.exports = { loadEnvironment };
