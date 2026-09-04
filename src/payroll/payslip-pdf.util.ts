import PDFDocument from 'pdfkit';
import { formatCurrency } from '../common/currency.util';

export interface PayslipPdfInput {
  tenantName: string;
  logoBuffer: Buffer | null;
  periodLabel: string;
  employeeName: string;
  employeeCode: string | null;
  designation: string | null;
  departmentName: string | null;
  grossPay: number;
  incomeTax: number;
  providentFund: number;
  employerContribution: number;
  netPay: number;
  previousMonthReceivable: number;
  advanceRecovery: number;
  netPayable: number;
  generatedAt: Date;
}

function money(n: number): string {
  return formatCurrency(n, { decimals: 2 });
}

// A4 payslip, built with plain Helvetica only (no embedded Unicode font),
// so month/employee text always renders regardless of tenant locale --
// Devanagari glyphs would come out as tofu boxes without a bundled font,
// so this stays English/Latin even when the tenant's interface is Nepali.
export function renderPayslipPdf(input: PayslipPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const textLeft = input.logoBuffer ? 110 : 50;
    if (input.logoBuffer) {
      try {
        doc.image(input.logoBuffer, 50, 45, { width: 50, height: 50 });
      } catch {
        // pdfkit only decodes PNG/JPEG; an SVG or WebP logo fails silently
        // here and the text header alone still identifies the company.
      }
    }
    doc.fontSize(18).font('Helvetica-Bold').text(input.tenantName, textLeft, 50);
    doc.fontSize(9).font('Helvetica').fillColor('#666666').text('Powered by Puggey', textLeft, 72);
    doc.fillColor('#000000');

    doc.fontSize(14).font('Helvetica-Bold').text('PAYSLIP', 50, 115, { align: 'center' });
    doc.fontSize(11).font('Helvetica').text(input.periodLabel, 50, 135, { align: 'center' });

    let y = 168;
    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 15;

    function detail(label: string, value: string) {
      doc.fontSize(10).font('Helvetica-Bold').text(label, 50, y);
      doc.font('Helvetica').text(value, 180, y);
      y += 18;
    }

    detail('Employee', input.employeeName);
    detail('Employee code', input.employeeCode ?? 'Not set');
    detail('Designation', input.designation ?? 'Not set');
    detail('Department', input.departmentName ?? 'Not set');

    y += 15;
    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 18;

    function row(label: string, amount: number, opts?: { bold?: boolean }) {
      doc.font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11);
      doc.text(label, 50, y);
      doc.text(money(amount), 350, y, { width: 195, align: 'right' });
      y += 22;
    }

    row('Gross pay', input.grossPay);
    row('Income tax', -input.incomeTax);
    row('Provident fund', -input.providentFund);
    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 10;
    row('Salary after tax', input.netPay, { bold: true });

    if (input.previousMonthReceivable > 0) row('Previous month receivable', input.previousMonthReceivable);
    if (input.advanceRecovery > 0) row('Advance recovery', -input.advanceRecovery);

    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 10;
    row('Net payable', input.netPayable, { bold: true });

    y += 15;
    if (input.employerContribution > 0) {
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#666666')
        .text(`Employer contribution this period (not deducted from pay): ${money(input.employerContribution)}`, 50, y, { width: 495 });
      y += 18;
    }

    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#666666')
      .text(`Generated on ${input.generatedAt.toLocaleString()}. This is a system-generated payslip and does not require a signature.`, 50, y, {
        width: 495,
      });

    doc.end();
  });
}
