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

function getParagraphText(paragraphXml) {
  const parts = [];
  const pattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let match;
  while ((match = pattern.exec(paragraphXml)) !== null) {
    const text = decodeXml(match[1]).trim();
    if (text) parts.push(text);
  }
  return parts.join('');
}

const rels = getRelationships(fs.readFileSync(RELS_FILE, 'utf8'));
const documentXml = fs.readFileSync(DOC_FILE, 'utf8');
const elements = [];
const pattern = /<w:p\b[\s\S]*?<\/w:p>/g;
let match;

while ((match = pattern.exec(documentXml)) !== null) {
  const block = match[0];
  const text = getParagraphText(block);
  if (text) elements.push({ type: 'text', val: text });

  const imagePattern = /<a:blip\b[^>]*\br:embed="([^"]+)"/g;
  let imageMatch;
  while ((imageMatch = imagePattern.exec(block)) !== null) {
    if (rels[imageMatch[1]]) {
      elements.push({ type: 'image', val: rels[imageMatch[1]] });
    }
  }
}

for (const element of elements.slice(0, 50)) {
  console.log(element);
}
