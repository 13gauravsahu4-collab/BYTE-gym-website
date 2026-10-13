// store.js - the only file that touches the disk.
// update() reads, lets your function change the data, then writes it back.
// Node runs this synchronously, so two requests can never interleave inside it.
// If your function throws, nothing is written.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'data');

function file(name) {
  return path.join(DIR, `${name}.json`);
}

function read(name) {
  const p = file(name);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function write(name, data) {
  fs.mkdirSync(DIR, { recursive: true });
  const p = file(name);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p); // a crash can never leave half a file
  return data;
}

function update(name, fn) {
  const data = read(name);
  const result = fn(data); // fn changes `data` in place
  write(name, data);
  return result;
}

module.exports = { read, write, update };