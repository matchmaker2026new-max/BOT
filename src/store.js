const fs = require('node:fs');
const path = require('node:path');
const { dataFile } = require('./config');

const defaults = { autoreplies: {}, settings: {}, giveaways: {}, snapshots: { roles: {}, channels: {} } };

function ensure() {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify(defaults, null, 2));
}
function read() {
  ensure();
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(dataFile, 'utf8')) }; }
  catch { return structuredClone(defaults); }
}
function write(value) { ensure(); fs.writeFileSync(dataFile, JSON.stringify(value, null, 2)); }
function update(fn) { const value = read(); fn(value); write(value); return value; }
module.exports = { read, write, update };
