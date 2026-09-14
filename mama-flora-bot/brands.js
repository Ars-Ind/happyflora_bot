const fs = require('fs');
const path = require('path');

const BRANDS_DIR = path.join(__dirname, 'brands');

function loadAllBrands() {
  const files = fs.readdirSync(BRANDS_DIR).filter((f) => f.endsWith('.json'));
  return files.map((file) => JSON.parse(fs.readFileSync(path.join(BRANDS_DIR, file), 'utf8')));
}

function getBrandById(id) {
  const brands = loadAllBrands();
  return brands.find((b) => b.id === id) || null;
}

module.exports = { loadAllBrands, getBrandById };
