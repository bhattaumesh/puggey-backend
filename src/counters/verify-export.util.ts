import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { formatCurrency } from '../common/currency.util';

export interface VerifyRow {
  software: number | null;
  online: number | null;
}

const cents = (n: number) => Math.round(n * 100);

export function summarise(rows: VerifyRow[]) {
  const results = rows.map((r) => ({ ...r, ok: r.software !== null && r.online !== null && cents(r.software) === cents(r.online) }));
  const softwareTotal = rows.reduce((t, r) => t + cents(r.software ?? 0), 0) / 100;
  const onlineTotal = rows.reduce((t, r) => t + cents(r.online ?? 0), 0) / 100;
  return {
    results,
    softwareTotal,
    onlineTotal,
    totalsMatch: cents(softwareTotal) === cents(onlineTotal),
    badCount: results.filter((r) => !r.ok).length,
  };
}

const RED = 'FFE53935';
const GREEN = 'FFC8E6C9';

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

export async function verifyWorkbook(tenantName: string, rows: VerifyRow[]): Promise<ExcelJS.Buffer> {
  const { results, softwareTotal, onlineTotal, totalsMatch, badCount } = summarise(rows);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Verification');
  sheet.columns = [
    { key: 'n', width: 8 },
    { key: 'software', width: 24 },
    { key: 'online', width: 24 },
    { key: 'difference', width: 16 },
  ];

  sheet.addRow([`${tenantName} - Online transaction verification`]).font = { bold: true, size: 14 };
  sheet.addRow([`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`]);
  sheet.addRow([badCount === 0 && totalsMatch ? 'Everything matches' : `${badCount} of ${rows.length} transactions do not match`]).font = { bold: true };
  sheet.addRow([]);

  const header = sheet.addRow(['#', 'Software (cashier)', 'Online (phone pay)', 'Difference']);
  header.font = { bold: true };

  const money = '#,##0.00';
  results.forEach((r, i) => {
    const row = sheet.addRow([i + 1, r.software ?? 'Missing', r.online ?? 'Missing', r.software !== null && r.online !== null ? Math.round((r.software - r.online) * 100) / 100 : null]);
    for (const col of [2, 3, 4]) {
      const cell = row.getCell(col);
      if (typeof cell.value === 'number') cell.numFmt = money;
      cell.fill = fill(r.ok ? GREEN : RED);
      cell.font = { color: { argb: r.ok ? 'FF1B5E20' : 'FFFFFFFF' }, bold: !r.ok };
    }
  });

  const total = sheet.addRow(['Total', softwareTotal, onlineTotal, Math.round((softwareTotal - onlineTotal) * 100) / 100]);
  total.font = { bold: true };
  for (const col of [2, 3, 4]) {
    const cell = total.getCell(col);
    cell.numFmt = money;
    cell.fill = fill(totalsMatch ? GREEN : RED);
    cell.font = { bold: true, color: { argb: totalsMatch ? 'FF1B5E20' : 'FFFFFFFF' } };
  }
  return workbook.xlsx.writeBuffer();
}

function money(n: number | null): string {
  return n === null ? 'Missing' : formatCurrency(n, { decimals: 2 });
}

export function verifyPdf(tenantName: string, rows: VerifyRow[]): Promise<Buffer> {
  const { results, softwareTotal, onlineTotal, totalsMatch, badCount } = summarise(rows);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 50;
    const colWidth = 165;
    const cols = [left, left + 50, left + 50 + colWidth, left + 50 + colWidth * 2];
    const rowHeight = 22;
    const bottom = 770;
    const good = badCount === 0 && totalsMatch;

    doc.fontSize(16).font('Helvetica-Bold').fillColor('#000000').text(tenantName, left, 50);
    doc.fontSize(13).text('Online transaction verification', left, 72);
    doc.fontSize(9).font('Helvetica').fillColor('#666666').text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, left, 92);
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor(good ? '#1b5e20' : '#c62828')
      .text(good ? 'Everything matches' : `${badCount} of ${rows.length} transactions do not match`, left, 112);

    let y = 140;
    function cell(x: number, w: number, text: string, bg: string | null, fg: string, bold: boolean, align: 'left' | 'right') {
      if (bg) doc.rect(x, y, w, rowHeight).fill(bg);
      doc.fillColor(fg).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(text, x + 6, y + 6, { width: w - 12, align, lineBreak: false });
    }
    function header() {
      cell(cols[0], 50, '#', '#eeeeee', '#000000', true, 'left');
      cell(cols[1], colWidth, 'Software (cashier)', '#eeeeee', '#000000', true, 'right');
      cell(cols[2], colWidth, 'Online (phone pay)', '#eeeeee', '#000000', true, 'right');
      y += rowHeight;
    }
    header();

    results.forEach((r, i) => {
      if (y + rowHeight > bottom - rowHeight) {
        doc.addPage();
        y = 50;
        header();
      }
      const bg = r.ok ? '#c8e6c9' : '#e53935';
      const fg = r.ok ? '#1b5e20' : '#ffffff';
      cell(cols[0], 50, String(i + 1), null, '#000000', false, 'left');
      cell(cols[1], colWidth, money(r.software), bg, fg, !r.ok, 'right');
      cell(cols[2], colWidth, money(r.online), bg, fg, !r.ok, 'right');
      y += rowHeight;
    });

    if (y + rowHeight * 2 > bottom) {
      doc.addPage();
      y = 50;
    }
    y += 6;
    const bg = totalsMatch ? '#c8e6c9' : '#e53935';
    const fg = totalsMatch ? '#1b5e20' : '#ffffff';
    cell(cols[0], 50, 'Total', null, '#000000', true, 'left');
    cell(cols[1], colWidth, money(softwareTotal), bg, fg, true, 'right');
    cell(cols[2], colWidth, money(onlineTotal), bg, fg, true, 'right');
    y += rowHeight + 8;
    doc
      .fillColor('#444444')
      .font('Helvetica')
      .fontSize(9)
      .text(totalsMatch ? 'The final figures are equal.' : `The final figures differ by ${money(Math.abs(softwareTotal - onlineTotal))}.`, left, y);
    doc.end();
  });
}
