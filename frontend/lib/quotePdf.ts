import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { QuoteDocument, QuoteParty } from "./quoteDocument";
import { calculateQuote, moneyInput, quoteMoney } from "./quoteCalculations";

export function quotePartyLines(party: QuoteParty, supplier = false): string[] {
  return [party.name, party.contact, party.address, party.email, party.telephone, party.reference && `Reference: ${party.reference}`, ...(supplier ? [party.website, party.companyNumber && `Company number: ${party.companyNumber}`, party.vatNumber && `VAT number: ${party.vatNumber}`] : [])].filter(Boolean);
}
export function quoteTextBlocks(quote: QuoteDocument): Array<[string, string]> {
  const options = quote.exportOptions;
  return [["Introduction", quote.introduction], ["Scope", options.scope ? quote.scope : ""], ["Exclusions", options.exclusions ? quote.exclusions : ""], ["Payment terms", options.paymentTerms ? quote.paymentTerms : ""], ["Additional notes", options.notes ? quote.notes : ""], ["Footer", quote.footer]];
}
/** PDF receives only the current QuoteDocument; never reads project quantities or account state. */
export async function buildQuotePdf(quote: QuoteDocument, fontBytes?: [Uint8Array, Uint8Array]): Promise<Uint8Array> {
  const totals = calculateQuote(quote);
  if (!totals.complete) throw new Error(totals.errors.join("\n"));
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  pdf.setTitle(`Quote ${quote.quoteNumber}`); pdf.setAuthor(quote.supplier.name);
  if (!fontBytes) {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    fontBytes = await Promise.all(["latin", "latin-ext"].map(async name => {
      const response = await fetch(`${base}/quote-fonts/${name}.woff`);
      if (!response.ok) throw new Error("Quotation font could not load. Try exporting again.");
      return new Uint8Array(await response.arrayBuffer());
    })) as [Uint8Array, Uint8Array];
  }
  const fonts = await Promise.all(fontBytes.map(bytes => pdf.embedFont(bytes, { subset: true })));
  const characterSets = fonts.map(font => new Set(font.getCharacterSet()));
  const characterFonts = new Map<string, PDFFont>();
  const fontFor = (char: string): PDFFont => {
    const cached = characterFonts.get(char); if (cached) return cached;
    const code = char.codePointAt(0)!;
    const font = fonts.find((_, index) => characterSets[index].has(code));
    if (!font) throw new Error(`The quotation font does not support “${char}”. Please replace that character before PDF export.`);
    characterFonts.set(char, font);
    return font;
  };
  const characterWidths = new Map<string, number>();
  const charWidth = (char: string, size: number) => { const key = `${size}:${char}`; if (!characterWidths.has(key)) characterWidths.set(key, fontFor(char).widthOfTextAtSize(char, size)); return characterWidths.get(key)!; };
  const width = (text: string, size: number) => [...text].reduce((sum, char) => sum + charWidth(char, size), 0);
  const ink = rgb(.08, .14, .19), accent = rgb(.08, .29, .32), pale = rgb(.94, .96, .97);
  let page!: PDFPage, y = 785;
  const draw = (text: string, x: number, atY: number, size = 10, colour = ink) => {
    let cursor = x, run = "", activeFont: PDFFont | undefined;
    const flush = () => { if (!run || !activeFont) return; page.drawText(run, { x: cursor, y: atY, size, font: activeFont, color: colour }); cursor += width(run, size); run = ""; };
    for (const char of text) { const font = fontFor(char); if (font !== activeFont) { flush(); activeFont = font; } run += char; }
    flush();
  };
  const newPage = () => {
    page = pdf.addPage([595.28, 841.89]); y = 785;
    page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(1, 1, 1) });
    const heading = `QUOTE · ${quote.quoteNumber}${quote.revision ? ` · Revision ${quote.revision}` : ""}`;
    for (const line of wrap(heading, 515, 12)) { draw(line, 40, y, 12, accent); y -= 17; }
    y -= 8;
  };
  const ensure = (height: number) => { if (y - height < 55) newPage(); };
  const wrap = (text: string, maxWidth: number, size = 10): string[] => {
    const lines: string[] = [];
    for (const paragraph of text.replace(/\r/g, "").split("\n")) {
      let current = "";
      for (const char of paragraph) {
        if (current && width(current + char, size) > maxWidth) { const lastSpace = current.lastIndexOf(" "); if (lastSpace > 0) { lines.push(current.slice(0, lastSpace)); current = current.slice(lastSpace + 1) + char; } else { lines.push(current); current = char; } }
        else current += char;
      }
      lines.push(current);
    }
    return lines;
  };
  const paragraph = (text: string, size = 10) => { for (const line of wrap(text, 515, size)) { ensure(size + 5); draw(line, 40, y, size); y -= size + 5; } y -= 6; };
  newPage();
  if (quote.supplier.logo) {
    const image = quote.supplier.logo.startsWith("data:image/png") ? await pdf.embedPng(quote.supplier.logo) : await pdf.embedJpg(quote.supplier.logo);
    const scale = Math.min(130 / image.width, 65 / image.height);
    page.drawImage(image, { x: 40, y: y - image.height * scale, width: image.width * scale, height: image.height * scale }); y -= image.height * scale + 12;
  }
  paragraph(quotePartyLines(quote.supplier, true).join("\n"));
  paragraph(`Date: ${quote.quoteDate || "Not set"}${quote.validUntil ? `   Valid until: ${quote.validUntil}` : ""}\nCurrency: ${quote.currency}${quote.reference ? `   Reference: ${quote.reference}` : ""}`);
  if (quote.exportOptions.customer && quotePartyLines(quote.customer).length) { ensure(35); paragraph("Customer", 12); paragraph(quotePartyLines(quote.customer).join("\n")); }
  if (quote.exportOptions.project) paragraph([quote.projectInfo.name, quote.projectInfo.address, quote.projectInfo.description, quote.projectInfo.reference].filter(Boolean).join("\n"));
  const xs = [40, 295, 340, 385, 455, 495];
  const showTax = quote.taxApplicable && quote.exportOptions.tax;
  const tableHeader = () => {
    ensure(28); page.drawRectangle({ x: 40, y: y - 6, width: 515, height: 22, color: pale });
    ["Description", "Qty", "Unit", "Unit price", showTax ? "VAT" : "", "Total"].forEach((label, index) => draw(label, xs[index], y, 9, accent)); y -= 28;
  };
  let ordinal = 0;
  for (const section of quote.sections) {
    if (!section.items.length) continue;
    ensure(70 + Math.min(200, wrap(section.items[0].description, 240, 9).length * 15)); paragraph(section.title || "Work items", 12);
    if (section.description) paragraph(section.description);
    tableHeader();
    for (const item of section.items) {
      ordinal++;
      const description = quote.exportOptions.descriptions ? [item.description || "Untitled item", item.notes].filter(Boolean).join("\n") : `Item ${ordinal}`;
      const lines = wrap(description, 240, 9);
      const lineTotal = totals.lines.find(line => line.item.quoteItemId === item.quoteItemId)!;
      // Keep ordinary rows together; exceptionally long descriptions can continue across pages.
      if (lines.length <= 40 && y - (lines.length * 15 + 8) < 55) { newPage(); tableHeader(); }
      for (let index = 0; index < lines.length; index++) {
        if (y - 16 < 55) { newPage(); tableHeader(); }
        draw(lines[index], xs[0], y, 9);
        if (index === 0) {
          const values = [item.quantity ?? "Not set", item.unit, moneyInput(item.unitPriceMinor, quote.currency), showTax ? item.taxRate + "%" : "", moneyInput(Number(lineTotal.subtotal), quote.currency)];
          values.forEach((value, column) => {
            // Shrink numeric cells only as required; never clip or round stored quotation values.
            const max = [40, 40, 65, 35, 60][column];
            const size = Math.min(9, max * 9 / Math.max(max, width(value, 9)));
            draw(value, xs[column + 1], y, size);
          });
        }
        y -= 15;
      }
      y -= 8;
    }
  }
  ensure(105); y -= 10;
  for (const [label, amount] of [["Subtotal", totals.subtotal], ["Discount", totals.discount], [quote.taxApplicable ? "VAT / tax" : "VAT not applicable", totals.tax], ["TOTAL", totals.total]] as const) {
    draw(label, 345, y, 11, accent); const value = quoteMoney(amount, quote.currency); draw(value, 555 - width(value, 11), y, 11); y -= 22;
  }
  y -= 15;
  if (showTax) for (const band of totals.taxBreakdown) paragraph(`VAT / tax ${band.rate}% on ${quoteMoney(band.net, quote.currency)}: ${quoteMoney(band.tax, quote.currency)}`, 9);
  for (const [label, text] of quoteTextBlocks(quote)) if (text) { ensure(40); paragraph(label, 12); paragraph(text); }
  const pages = pdf.getPages();
  pages.forEach((current, index) => { page = current; const text = `${quote.quoteNumber} · Page ${index + 1} of ${pages.length}`; draw(text, 40, 27, Math.min(8, 515 * 8 / Math.max(515, width(text, 8)))); });
  return pdf.save();
}
