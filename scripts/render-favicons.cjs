const { Resvg } = require('C:/Users/xinyu6290/.workbuddy/binaries/node/workspace/node_modules/@resvg/resvg-js/index.js');
const fs = require('fs');

const pub = 'C:/Users/xinyu6290/WorkBuddy/2026-08-13-20-39-22/mdqp/public';
const svg = fs.readFileSync(`${pub}/favicon.svg`, 'utf8');
const sizes = [16, 32, 48, 180, 192, 512];
for (const s of sizes) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: s }, background: 'transparent' });
  const png = r.render().asPng();
  fs.writeFileSync(`${pub}/favicon-${s}.png`, png);
  console.log(`favicon-${s}.png -> ${png.length} bytes`);
}
