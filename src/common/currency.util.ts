// Every place money is shown to a user -- notifications, the payslip PDF --
// routes through this, so the currency label can't drift per call site.
// Nepali Rupees only, never the ₹ (Indian Rupee) glyph.
export function formatCurrency(amount: number, options?: { decimals?: number }): string {
  const decimals = options?.decimals;
  const formatted =
    decimals != null
      ? amount.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : amount.toLocaleString();
  return `Rs ${formatted}`;
}
