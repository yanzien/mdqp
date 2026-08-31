const marked = require('marked');

let _mathBlockId = 0;
function md(text) {
  const s = String(text || '');
  const mathBlocks = [];
  const protected = s.replace(/\$\$([\s\S]+?)\$\$/g, function(m, body) {
    const id = _mathBlockId++;
    mathBlocks.push({ id: id, body: body, display: true });
    return '\x00MATH' + id + 'D\x00';
  }).replace(/\$([^\$\n]+?)\$/g, function(m, body) {
    const id = _mathBlockId++;
    mathBlocks.push({ id: id, body: body, display: false });
    return '\x00MATH' + id + 'I\x00';
  });

  let raw = marked.parse(protected, { breaks: true, gfm: true });
  
  raw = raw.replace(/\x00MATH(\d+)([DI])\x00/g, function(m, num, type) {
    const b = mathBlocks.find(function(mb){ return mb.id === Number(num); });
    if (!b) return '';
    return type === 'D' ? '$$' + b.body + '$$' : '$' + b.body + '$';
  });
  return raw;
}

const tests = [
  '测试：$$\frac{a}{b} + \sum_{i=1}^n x_i$$ 行内 $x^2$',
  '$$\begin{aligned} &\text{Hello} \frac{1}{2} \end{aligned}$$',
  '普通文本 $\LaTeX$ 和 $$\colorbox{red}{test}$$',
  '价格是 $5 和 $10$',
];

for (let i = 0; i < tests.length; i++) {
  const t = tests[i];
  console.log('=== INPUT[' + i + '] ===');
  console.log(JSON.stringify(t).substring(0, 100));
  console.log('=== OUTPUT ===');
  const out = md(t);
  console.log(out);
  console.log('  preserved: frac=' + out.includes('\frac') + ' sum=' + out.includes('\sum') + ' LaTeX=' + out.includes('\LaTeX'));
  console.log();
}
