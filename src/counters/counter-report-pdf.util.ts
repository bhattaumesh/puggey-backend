import PDFDocument from 'pdfkit';
import { formatCurrency } from '../common/currency.util';
import { NPR_DENOMINATIONS } from './counters.service';

export interface CounterReportPdfInput {
  tenantName: string;
  counterName: string;
  employeeName: string;
  assignedByName: string;
  openedAt: Date;
  closedAt: Date | null;
  openingCash: number;
  openingDenominations: Record<string, number>;
  closingCash: number | null;
  closingDenominations: Record<string, number> | null;
  totalInflow: number;
  totalOutflow: number;
  totalSales: number;
  expectedClosing: number;
  variance: number | null;
  generatedAt: Date;
}

function money(n: number): string {
  return formatCurrency(n, { decimals: 2 });
}

function denominationLine(denominations: Record<string, number>): string {
  return NPR_DENOMINATIONS.filter((d) => (denominations[String(d)] ?? 0) > 0)
    .map((d) => `${d} x ${denominations[String(d)]}`)
    .join(', ') || 'None counted';
}

// Mirrors the plain-Helvetica, English-only approach used for payslips --
// keeps the closing report renderable regardless of tenant locale.
export function renderCounterReportPdf(input: CounterReportPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).font('Helvetica-Bold').text(input.tenantName, 50, 50);
    doc.fontSize(9).font('Helvetica').fillColor('#666666').text('Powered by Puggey', 50, 72);
    doc.fillColor('#000000');

    doc.fontSize(14).font('Helvetica-Bold').text('COUNTER CLOSING REPORT', 50, 115, { align: 'center' });
    doc.fontSize(11).font('Helvetica').text(input.counterName, 50, 135, { align: 'center' });

    let y = 168;
    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 15;

    function detail(label: string, value: string) {
      doc.fontSize(10).font('Helvetica-Bold').text(label, 50, y);
      doc.font('Helvetica').text(value, 180, y, { width: 365 });
      y += 18;
    }

    detail('Handled by', input.employeeName);
    detail('Assigned by', input.assignedByName);
    detail('Opened', input.openedAt.toLocaleString());
    detail('Closed', input.closedAt ? input.closedAt.toLocaleString() : 'Still open');

    y += 15;
    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 18;

    function row(label: string, amount: number, opts?: { bold?: boolean }) {
      doc.font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11);
      doc.text(label, 50, y);
      doc.text(money(amount), 350, y, { width: 195, align: 'right' });
      y += 22;
    }

    row('Opening balance', input.openingCash);
    doc.fontSize(8).font('Helvetica').fillColor('#666666').text(denominationLine(input.openingDenominations), 50, y, { width: 495 });
    doc.fillColor('#000000');
    y += 16;

    row('Sales', input.totalSales);
    row('Inflow', input.totalInflow);
    row('Outflow', -input.totalOutflow);

    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 10;
    row('Expected closing balance', input.expectedClosing, { bold: true });

    if (input.closingCash != null) {
      row('Actual closing balance', input.closingCash);
      if (input.closingDenominations) {
        doc.fontSize(8).font('Helvetica').fillColor('#666666').text(denominationLine(input.closingDenominations), 50, y, { width: 495 });
        doc.fillColor('#000000');
        y += 16;
      }
      if (input.variance != null) {
        row('Variance', input.variance, { bold: true });
      }
    }

    y += 10;
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#666666')
      .text('Formula: Opening balance + Inflow + Sales - Outflow = Closing balance.', 50, y, { width: 495 });
    y += 14;
    doc.text(`Generated on ${input.generatedAt.toLocaleString()}. This is a system-generated report and does not require a signature.`, 50, y, {
      width: 495,
    });

    doc.end();
  });
}
