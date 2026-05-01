import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FONTS_DIR = join(__dirname, 'fonts');

const resumeText = readFileSync(join(ROOT, 'resume.md'), 'utf8');

pdfmake.setFonts({
  LexendLight: {
    normal: join(FONTS_DIR, 'Lexend-Light.ttf'),
    bold:   join(FONTS_DIR, 'Lexend-Medium.ttf'),
  },
  LexendBold: {
    normal: join(FONTS_DIR, 'Lexend-SemiBold.ttf'),
    bold:   join(FONTS_DIR, 'Lexend-SemiBold.ttf'),
  },
});
// Deny external URL downloads — all fonts are local files
pdfmake.setUrlAccessPolicy(() => false);

const TEXT   = '#1A1A1A';
const GRAY   = '#8C8C8C';
const MID    = '#555555';
const BORDER = '#E5E5E5';

const SECTION_HEADERS = new Set([
  'Summary', 'Professional Experience', 'Education', 'Skills And Achievements',
]);

function sectionLine() {
  return {
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: BORDER }],
    margin: [0, 3, 0, 6],
  };
}

function parseResume(markdown) {
  const lines = markdown.split('\n');
  const content = [];
  let listItems = [];
  let seenFirstSection = false;

  function flushList() {
    if (listItems.length === 0) return;
    content.push({ ul: listItems.map(t => ({ text: t, style: 'body' })), margin: [0, 2, 0, 4] });
    listItems = [];
  }

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (!trimmed) { flushList(); continue; }

    if (trimmed.startsWith('# ')) {
      flushList();
      content.push({ text: trimmed.slice(2), style: 'h1', margin: [0, 0, 0, 4] });
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushList();
      seenFirstSection = true;
      const heading = trimmed.slice(3);
      if (SECTION_HEADERS.has(heading)) {
        content.push({ text: heading.toUpperCase(), style: 'sectionHeader', margin: [0, 14, 0, 0] });
        content.push(sectionLine());
      } else {
        content.push({ text: heading, style: 'roleHeader', margin: [0, 10, 0, 1] });
      }
      continue;
    }

    if (trimmed.startsWith('- ')) {
      listItems.push(trimmed.slice(2));
      continue;
    }

    if (!seenFirstSection && /^(Phone|Email|LinkedIn|GitHub):/.test(trimmed)) {
      flushList();
      content.push({ text: trimmed, style: 'contact', margin: [0, 0, 0, 0] });
      continue;
    }

    if (
      /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/.test(trimmed) ||
      /^\d{4}\s*[-–]/.test(trimmed)
    ) {
      flushList();
      content.push({ text: trimmed, style: 'roleDate', margin: [0, 0, 0, 3] });
      continue;
    }

    flushList();
    content.push({ text: trimmed, style: 'body', margin: [0, 2, 0, 2] });
  }

  flushList();
  return content;
}

const docDefinition = {
  pageSize: 'A4',
  pageMargins: [40, 40, 40, 40],
  defaultStyle: { font: 'LexendLight', fontSize: 9, lineHeight: 1.6, color: TEXT },
  styles: {
    h1:            { font: 'LexendBold',  fontSize: 18, color: TEXT, lineHeight: 1.2 },
    contact:       { font: 'LexendLight', fontSize: 8,  color: MID,  lineHeight: 1.8 },
    sectionHeader: { font: 'LexendBold',  fontSize: 9.5, color: GRAY, characterSpacing: 0.8 },
    roleHeader:    { font: 'LexendLight', bold: true, fontSize: 9.5, color: TEXT },
    roleDate:      { font: 'LexendLight', fontSize: 8,  color: GRAY },
    body:          { font: 'LexendLight', fontSize: 9,  color: TEXT, lineHeight: 1.6 },
  },
  content: parseResume(resumeText),
};

mkdirSync(join(ROOT, 'public'), { recursive: true });
const outPath = join(ROOT, 'public', 'mathew-kalarikkal-resume.pdf');

const outputDoc = pdfmake.createPdf(docDefinition);
await outputDoc.write(outPath);
console.log(`PDF generated → ${outPath}`);
