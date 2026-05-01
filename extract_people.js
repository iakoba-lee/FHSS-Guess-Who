const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const RELS_FILE = path.join(ROOT, 'docx_extract', 'word', '_rels', 'document.xml.rels');
const DOC_FILE = path.join(ROOT, 'docx_extract', 'word', 'document.xml');
const PEOPLE_FILE = path.join(ROOT, 'people.json');

function readXml(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

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
  const textParts = [];
  const pattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let match;
  while ((match = pattern.exec(cellXml)) !== null) {
    const text = decodeXml(match[1]).trim();
    if (text) textParts.push(text);
  }
  return textParts.join(' ');
}

function getCellImage(cellXml, rels) {
  const match = cellXml.match(/<a:blip\b[^>]*\br:embed="([^"]+)"/);
  return match ? rels[match[1]] || null : null;
}

function extractPeople() {
  const rels = getRelationships(readXml(RELS_FILE));
  const documentXml = readXml(DOC_FILE);
  const people = [];

  for (const tableXml of getBlocks(documentXml, 'tbl')) {
    const rows = getBlocks(tableXml, 'tr').map((rowXml) => (
      getBlocks(rowXml, 'tc').map((cellXml) => ({
        text: getCellText(cellXml),
        image: getCellImage(cellXml, rels)
      }))
    ));

    for (let i = 0; i < rows.length; i += 3) {
      if (i + 2 >= rows.length) continue;
      const imageRow = rows[i];
      const nameRow = rows[i + 1];
      const positionRow = rows[i + 2];
      const columns = Math.min(imageRow.length, nameRow.length, positionRow.length);

      for (let col = 0; col < columns; col += 1) {
        const name = nameRow[col].text;
        if (!name) continue;
        people.push({
          name,
          position: positionRow[col].text,
          image: imageRow[col].image
        });
      }
    }
  }

  fs.writeFileSync(PEOPLE_FILE, `${JSON.stringify(people, null, 4)}\n`);
  console.log(`Extracted ${people.length} people.`);
}

extractPeople();
