const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'dist', 'esm');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');
console.log('esm marker written:', path.join(dir, 'package.json'));
