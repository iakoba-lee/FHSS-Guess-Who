const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const RELS_FILE = path.join(ROOT, 'docx_extract', 'word', '_rels', 'document.xml.rels');
const DOC_FILE = path.join(ROOT, 'docx_extract', 'word', 'document.xml');

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function getRelationships(xml) {
  const rels = {};
  const pattern = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    rels[match[1]] = match[2];
  }
  return rels;
}

function getBlocks(xml, tagName) {
  const pattern = new RegExp(`<[^>]*:${tagName}\\b[\\s\\S]*?<\\/[^>]*:${tagName}>`, 'g');
  return xml.match(pattern) || [];
}

function getCellText(cellXml) {
  const parts = [];
  const pattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let match;
  while ((match = pattern.exec(cellXml)) !== null) {
    const text = decodeXml(match[1]).trim();
    if (text) parts.push(text);
  }
  return parts.join(' ');
}

function getCellImage(cellXml, rels) {
  const match = cellXml.match(/<a:blip\b[^>]*\br:embed="([^"]+)"/);
  return match ? rels[match[1]] || null : null;
}

const rels = getRelationships(fs.readFileSync(RELS_FILE, 'utf8'));
const documentXml = fs.readFileSync(DOC_FILE, 'utf8');

for (const tableXml of getBlocks(documentXml, 'tbl')) {
  for (const rowXml of getBlocks(tableXml, 'tr')) {
    for (const cellXml of getBlocks(rowXml, 'tc')) {
      const cell = {
        text: getCellText(cellXml),
        image: getCellImage(cellXml, rels)
      };
      if (cell.text || cell.image) {
        console.log(cell);
      }
    }
  }
}
