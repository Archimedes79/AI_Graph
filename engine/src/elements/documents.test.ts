import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docxMarkdown, fileContent, isInlineFile } from './documents.ts';
import { nodeFiles } from '../host/node.ts';
import { zip } from '../host/editor/zip.ts';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (inner: string, properties = ''): string => `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${inner}</w:p>`;
const r = (text: string, properties = ''): string => `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

/** A Word document as Word writes one: zipped, deflated, its styles by id. */
function docx(body: string): Uint8Array {
  const files: Record<string, string> = {
    'word/document.xml': `<w:document ${W}><w:body>${body}</w:body></w:document>`,
    'word/styles.xml': `<w:styles ${W}><w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Titel"><w:name w:val="Title"/></w:style></w:styles>`,
    'word/numbering.xml': `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
  };
  return new Uint8Array(zip(Object.entries(files).map(([path, text]) => ({ path, content: Buffer.from(text, 'utf8') }))));
}

const bullet = (id: number): string => `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`;

describe('a Word document, read', () => {
  it('is its text as Markdown: headings by what their style is called, in any language', async () => {
    const said = await docxMarkdown(docx(
      p(r('Bericht'), '<w:pStyle w:val="Titel"/>') + p(r('Einleitung'), '<w:pStyle w:val="berschrift1"/>') + p(r('Text &amp; mehr &lt;3')),
    ));
    expect(said).toBe('# Bericht\n\n## Einleitung\n\nText & mehr <3\n');
  });

  it('keeps bold and italic, and does not mark the spaces around them', async () => {
    expect(await docxMarkdown(docx(p(r('ein ') + r('fettes ', '<w:b/>') + r('Wort', '<w:i/>') + r(' nicht', '<w:b w:val="0"/>')))))
      .toBe('ein **fettes** *Wort* nicht\n');
  });

  it('writes a list as its numbering says, bulleted or numbered, one block', async () => {
    expect(await docxMarkdown(docx(p(r('a'), bullet(1)) + p(r('b'), bullet(1)) + p(r('eins'), bullet(2)))))
      .toBe('- a\n- b\n1. eins\n');
  });

  it('writes a table as a table, its first row the head', async () => {
    const cell = (text: string): string => `<w:tc>${p(r(text))}</w:tc>`;
    const table = `<w:tbl><w:tr>${cell('A')}${cell('B')}</w:tr><w:tr>${cell('1')}${cell('x | y')}</w:tr></w:tbl>`;
    expect(await docxMarkdown(docx(table))).toBe('| A | B |\n| --- | --- |\n| 1 | x \\| y |\n');
  });

  it('says what it is when it is no Word document', async () => {
    await expect(docxMarkdown(new TextEncoder().encode('plain text'))).rejects.toThrow(/no zip archive/);
  });
});

describe('a file a node reads', () => {
  it('is its text, a Word document as Markdown, a PDF as itself', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-documents-'));
    try {
      await writeFile(join(dir, 'note.txt'), 'hello');
      await writeFile(join(dir, 'report.docx'), docx(p(r('Hallo'))));
      await writeFile(join(dir, 'statement.pdf'), '%PDF-1.4');
      expect(await fileContent(join(dir, 'note.txt'), nodeFiles)).toBe('hello');
      expect(await fileContent(join(dir, 'report.docx'), nodeFiles)).toBe('Hallo\n');
      const pdf = await fileContent(join(dir, 'statement.pdf'), nodeFiles);
      expect(pdf).toBe(`data:application/pdf;base64,${Buffer.from('%PDF-1.4').toString('base64')}`);
      expect(isInlineFile(pdf)).toBe(true);
      expect(isInlineFile('data:text/plain;base64,aGk=')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
