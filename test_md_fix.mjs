import { marked } from './node_modules/marked/marked.min.js';

let _mathBlockId = 0;
function md(text) {
  const s = String(text || '');
  const mathBlocks = [];
  const protected = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, body) => {
    const id = _mathBlockId++;
    mathBlocks.push({ id, body, display: true });
    return '\x00MATH' + id + 'D\x00';
  }).replace(/\$([^\$\n]+?)\$/g, (_, body) => {
    const id = _mathBlockId++;
    mathBlocks.push({ id, body, display: false });
    return '\x00MATH' + id + 'I\x00';
  });

  let raw = marked.parse(protected, { breaks: true, gfm: true });
  
  raw = raw.replace(/\x00MATH(\d+)([DI])\x00/g, (_, num, type) => {
    const b = mathBlocks.find(m => m.id === Number(num));
    if (!b) return '';
    return type === 'D' ? '$$' + b.body + '$$' : '$' + b.body + '$';
  });
  return raw;
}

// 模拟 JSON.parse 后的真实 JS 字符串（单反斜杠）
const tests = [
  '测试：$$\frac{a}{b} + \sum_{i=1}^n x_i$$ 行内 $x^2$',
  '$$\begin{aligned} &\text{Hello} \frac{1}{2} \end{aligned}$$',
  '普通文本 $\LaTeX$ 和 $$\colorbox{red}{test}$$',
  '价格是 $5 和 $10$',
];

for (const t of tests) {
  console.log('=== INPUT ===');
  console.log(JSON.stringify(t.substring(0, 80)));
  console.log('=== OUTPUT ===');
  const out = md(t);
  console.log(out);
  const hasFrac = out.includes('\frac');
  const hasSum = out.includes('\sum');
  const hasLatex = out.includes('\LaTeX');
  console.log('  preserved: frac=' + hasFrac + ' sum=' + hasSum + ' LaTeX=' + hasLatex);
  console.log();
}
