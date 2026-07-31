/**
 * 导出统计核心纯函数。
 * 仅依赖字符串参数，无副作用。
 */

const HAN_RE = /\p{Script=Han}/gu;
const CJK_PUNCT_RE = /[\u3000-\u303F\uFF00-\uFFEF]/g;

/**
 * 统计文本字数：每个汉字计 1 词，其余部分按空白分词计词。
 * CJK 标点不计；英文标点附着单词不单独计数；不剥离 Markdown 语法。
 */
export function countWords(text: string): number {
  const hanCount = text.match(HAN_RE)?.length ?? 0;
  const nonHanText = text
    .replace(HAN_RE, '')
    .replace(CJK_PUNCT_RE, ' ');
  const wordCount = nonHanText.split(/\s+/).filter(Boolean).length;
  return hanCount + wordCount;
}

/**
 * 统计行数：尾部空白行被 trim 剔除，中间空行计入。
 */
export function countLines(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split('\n').length;
}
