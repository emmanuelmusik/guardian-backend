import PDFDocument from 'pdfkit';

const GOLD = '#b8862f';
const DIM = '#666666';
const DARK = '#1b2a3a';

// Draws the journal-entries PDF content onto an already-created pdfkit
// document. Shared by the direct-download route and the email
// attachment generator below, so both stay visually identical.
export function drawEntriesPdf(doc, entries, headingTitle) {
  doc.fillColor(GOLD).fontSize(10).font('Helvetica-Bold').text('GUARDIAN', { characterSpacing: 2 });
  doc.moveDown(0.4);
  doc.fillColor(DARK).fontSize(24).font('Helvetica-Bold').text(headingTitle);
  doc.moveDown(0.2);
  doc.fillColor(DIM).fontSize(10).font('Helvetica').text(`Exported ${new Date().toLocaleString()}`);
  doc.moveDown(1.2);

  if (entries.length === 0) {
    doc.fillColor(DIM).fontSize(11).text('No entries recorded yet.');
    return;
  }

  entries.forEach((e, i) => {
    if (i > 0) {
      doc.moveDown(0.8);
      doc.strokeColor('#dddddd').lineWidth(1)
        .moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
      doc.moveDown(0.8);
    }
    doc.fillColor(DARK).fontSize(14).font('Helvetica-Bold').text(e.title || '(untitled)');
    doc.fillColor(DIM).fontSize(9).font('Helvetica')
      .text(`${e.type} · ${new Date(e.created_at).toLocaleString()}`);
    doc.moveDown(0.3);
    doc.fillColor(DARK).fontSize(11).font('Helvetica').text(e.content || '', { align: 'left' });
  });
}

// Generates the PDF as an in-memory buffer, for attaching to an email
// rather than streaming to an HTTP response.
export function generateEntriesPdfBuffer(entries, headingTitle) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 54, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawEntriesPdf(doc, entries, headingTitle);
    doc.end();
  });
}
