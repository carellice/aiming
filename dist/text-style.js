export const textFonts = {
  sans: '"Segoe UI", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, "Courier New", monospace',
};

// Legacy text cards had two fields. Present both in one editor without rewriting
// stored data; the first actual edit replaces them with a single content field.
export function textValue(card) {
  return [card.title, card.content].filter(value => typeof value === 'string' && value.length).join('\n');
}

export function textHeight(card) {
  const size=card.fontSize||24, padding=card.textBackground?20:8;
  const columns=Math.max(1,Math.floor((card.width-padding)/(size*.56)));
  const lines=textValue(card).split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/columns)),0);
  return Math.max(size*1.35+padding,lines*size*1.35+padding);
}

export function textVariables(card) {
  return `--text-size:${card.fontSize||24}px;--text-color:${card.textColor||'#424b3c'};--text-weight:${card.bold?700:400};--text-style:${card.italic?'italic':'normal'};--text-decoration:${card.underline?'underline':'none'};--text-align:${card.textAlign||'left'};--text-family:${textFonts[card.fontFamily]||textFonts.sans};--card-color:${card.color||'#ffffff'}`;
}
