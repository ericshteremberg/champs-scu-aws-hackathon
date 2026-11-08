// Stripe stores charge amounts in minor units. ISK and UGX retain a
// two-decimal API representation despite their zero-decimal display.
// https://docs.stripe.com/currencies#special-cases
const zeroDecimal = new Set(['bif','clp','djf','gnf','jpy','kmf','krw','mga','pyg','rwf','vnd','vuv','xaf','xof','xpf']);
const threeDecimal = new Set(['bhd','jod','kwd','omr','tnd']);
export function minorUnitScale(currency: string): number {
  const code = currency.toLowerCase();
  return zeroDecimal.has(code) ? 1 : threeDecimal.has(code) ? 1000 : 100;
}
export function formatMoney(amount: number, currency = 'usd'): string {
  const code = currency.toLowerCase();
  const digits = zeroDecimal.has(code) || ['isk','ugx'].includes(code) ? 0 : threeDecimal.has(code) ? 3 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: code.toUpperCase(), minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(amount / minorUnitScale(code));
}
