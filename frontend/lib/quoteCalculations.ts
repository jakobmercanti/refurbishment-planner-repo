import type { QuoteDocument, QuoteItem } from "./quoteDocument";
import type { CurrencyCode } from "./appPreferences";

/** Non-negative decimal rationals; no floating-point monetary arithmetic. */
export function decimalRatio(value: string): [bigint, bigint] {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(value)) throw new Error("Enter a non-negative decimal with at most six decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)];
}
export const roundRatio = (numerator: bigint, denominator: bigint) => (numerator * 2n + denominator) / (2n * denominator);
export const currencyDigits = (currency: CurrencyCode) => currency === "JPY" ? 0 : 2;
export function parseMoney(value: string, currency: CurrencyCode): number | null {
  if (!value.trim()) return null;
  const [n, d] = decimalRatio(value);
  const minor = roundRatio(n * 10n ** BigInt(currencyDigits(currency)), d);
  if (minor > 1000000000000n) throw new Error("Amount is too large.");
  return Number(minor);
}
export function moneyInput(value: number | null, currency: CurrencyCode): string {
  if (value === null) return "";
  const digits = currencyDigits(currency), divisor = 10n ** BigInt(digits), minor = BigInt(value);
  return `${minor / divisor}${digits ? "." + (minor % divisor).toString().padStart(digits, "0") : ""}`;
}
/** Currency changes preserve nominal selling prices, never imply an FX conversion. */
export function changeQuoteCurrency(quote: QuoteDocument, currency: CurrencyCode): QuoteDocument {
  if (currency === quote.currency) return quote;
  return { ...quote, currency, sections: quote.sections.map(section => ({ ...section, items: section.items.map(item => ({ ...item, unitPriceMinor: parseMoney(moneyInput(item.unitPriceMinor, quote.currency), currency), internalCostMinor: null })) })) };
}
export function quoteMoney(minor: bigint | number, currency: CurrencyCode): string {
  const value = BigInt(minor), digits = currencyDigits(currency), divisor = 10n ** BigInt(digits);
  const fraction = (value % divisor).toString().padStart(digits, "0");
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).formatToParts(value / divisor).map(part => part.type === "fraction" ? fraction : part.value).join("");
}
export function quoteLineSubtotal(item: QuoteItem): bigint | null {
  if (item.quantity === null || item.unitPriceMinor === null) return null;
  const [n, d] = decimalRatio(item.quantity);
  return roundRatio(n * BigInt(item.unitPriceMinor), d);
}
export function calculateQuote(quote: QuoteDocument) {
  const entries = quote.sections.flatMap(section => section.items.map(item => ({ item, sectionId: section.sectionId, subtotal: quoteLineSubtotal(item) })));
  const errors: string[] = [];
  if (!entries.length) errors.push("Add at least one quote item.");
  for (const { item, subtotal } of entries) {
    if (subtotal === null) errors.push(`${item.description || "Untitled item"}: quantity or unit price is Not set.`);
    if (Number(item.taxRate) > 100) errors.push(`${item.description}: tax rate must be between 0 and 100%.`);
  }
  const subtotal = entries.reduce((sum, entry) => sum + (entry.subtotal ?? 0n), 0n);
  let discount = 0n;
  if (quote.discount.type !== "none" && quote.discount.value === null) errors.push("Discount value is Not set.");
  if (quote.discount.type !== "none" && quote.discount.value !== null) {
    const [n, d] = decimalRatio(quote.discount.value);
    discount = quote.discount.type === "percentage" ? roundRatio(subtotal * n, d * 100n) : roundRatio(n * 10n ** BigInt(currencyDigits(quote.currency)), d);
    if (discount > subtotal) errors.push("Discount cannot exceed the subtotal.");
    if (quote.discount.type === "percentage" && n > 100n * d) errors.push("Discount percentage cannot exceed 100%.");
    discount = discount > subtotal ? subtotal : discount;
  }
  // Largest-remainder allocation makes discounted line amounts sum exactly to the quote discount.
  const allocations = entries.map(entry => subtotal > 0n ? discount * (entry.subtotal ?? 0n) / subtotal : 0n);
  let remaining = discount - allocations.reduce((sum, amount) => sum + amount, 0n);
  const order = entries.map((entry, index) => ({ index, remainder: subtotal > 0n ? discount * (entry.subtotal ?? 0n) % subtotal : 0n })).sort((a, b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.index - b.index);
  for (const { index } of order) if (remaining > 0n) { allocations[index]++; remaining--; }
  const lines = entries.map((entry, index) => {
    const [n, d] = decimalRatio(entry.item.taxRate);
    const net = (entry.subtotal ?? 0n) - allocations[index];
    const tax = quote.taxApplicable ? roundRatio(net * n, d * 100n) : 0n;
    return { ...entry, discount: allocations[index], net, tax, total: entry.subtotal === null ? null : net + tax };
  });
  const tax = lines.reduce((sum, line) => sum + line.tax, 0n);
  const total = subtotal - discount + tax;
  if (subtotal > BigInt(Number.MAX_SAFE_INTEGER) || total > BigInt(Number.MAX_SAFE_INTEGER)) errors.push("Quote total exceeds the supported monetary range.");
  const sections = quote.sections.map(section => ({ sectionId: section.sectionId, subtotal: lines.filter(line => line.sectionId === section.sectionId).reduce((sum, line) => sum + (line.subtotal ?? 0n), 0n) }));
  const taxBreakdown = [...new Set(lines.map(line => line.item.taxRate))].map(rate => ({ rate, net: lines.filter(line => line.item.taxRate === rate).reduce((sum, line) => sum + line.net, 0n), tax: lines.filter(line => line.item.taxRate === rate).reduce((sum, line) => sum + line.tax, 0n) }));
  return { lines, sections, subtotal, discount, tax, total, taxBreakdown, errors, complete: errors.length === 0 };
}
export function markupPrice(costMinor: number, percentage: string): number {
  const [n, d] = decimalRatio(percentage);
  const value = roundRatio(BigInt(costMinor) * (100n * d + n), 100n * d);
  if (value > 1000000000000n) throw new Error("Markup price is too large.");
  return Number(value);
}
