import type { WindowHelpStep } from "./windowHelp";
export const QUOTE_TEXT_LABELS={introduction:"Introduction",scope:"Scope notes",exclusions:"Exclusions",paymentTerms:"Payment terms",notes:"Additional notes",footer:"Footer"} as const;

export function quoteHelpSteps(title: string): WindowHelpStep[] {
  const section = title.replace(/^Quote(?: Generator)?\s*[—:-]?\s*/i, "");
  if (/cost|markup|item|work section/i.test(section)) return [
    {heading:"Price each item",text:"Open a work section and add items. Quantity × customer unit price gives the net line total. Choose items, units, metres, square metres, hours, days or Custom unit. Expand an item to edit its description, customer-visible notes, room, trade and category. Select a project room or Custom entry for a location not on the plan."},
    {heading:"Your cost per unit — private",text:"This is what one quoted unit costs your business, not what you charge the customer. For 4 items costing 20 each, enter 20, not 80. It is optional and never appears in the customer preview or PDF. Select lines and apply a markup to set customer unit prices from these costs; a 10% markup on 20 produces 22. Markup is not profit margin. Only lines with an entered cost are changed."},
    {heading:"Sections and source links",text:"A section groups related work; rename it, add a description or reorder it. Imported quantities are an editable snapshot, not live prices. Review updates explicitly when the plan changes. Delete unused blank lines, or finish pricing them before issuing a final quotation."}
  ];
  if (/generate|materials|quantities|electrical|plumbing|fittings/i.test(section)) return [
    {heading:"Choose what to include",text:"Tick a group to select its items, or tick individual rows. Quantities come from the measured project; missing quantities and prices stay Not set. Activity entries are fixed-price lots, not inferred labour hours."},
    {heading:"Avoid double counting",text:"Activity scope, room wall areas and painted wall surfaces can overlap. Include only the quantities you intend to charge. The same source is not imported twice into one quote. Generated descriptions, quantities and prices remain editable."},
    {heading:"Import costs deliberately",text:"Use entered internal costs as initial customer prices only if you want to charge those amounts; they are not automatically selling prices. Costs in another currency are not converted. Review every imported line and add customer unit prices before issuing."}
  ];
  if (/discount|VAT|tax|totals/i.test(section)) return [
    {heading:"Running totals",text:"Priced items update the subtotal immediately. If other items are unpriced, the priced subtotal and total are provisional and exclude their unknown amounts. Not set is not zero. Finish or remove unpriced lines before issuing a final quote."},
    {heading:"Discount and tax",text:"Choose no discount, a percentage or a fixed amount in the quote currency. Discounts are allocated across priced lines; tax is calculated after discount at each line's entered rate. Enable VAT / tax only when appropriate. No tax treatment is inferred; confirm the rates you need."},
    {heading:"Draft PDF",text:"Incomplete quotes can be exported as clearly marked draft PDFs with missing values shown as Not set. Invalid discount values or totals outside the supported range must be corrected before export. A draft priced total is not the full final quotation."}
  ];
  if (/customer PDF|export|preview/i.test(section)) return [
    {heading:"Check the customer document",text:"Preview shows the current quotation, not newly recalculated project quantities. Choose which customer details, descriptions and optional text appear in the PDF. Financial totals are always included. Private costs and project source links never appear."},
    {heading:"Export safely",text:"Export PDF downloads the current document. Missing prices do not block a draft export; the PDF is marked incomplete and totals cover priced items only. Review the result and complete the prices before issuing a final quote."}
  ];
  if (/customer/i.test(section)) return [{heading:"Customer details",text:"Enter the customer's name, contact, address and reference. These belong to this quote and can be included or omitted using Customer PDF content. Check the customer and delivery address before sharing."}];
  if (/business|contractor|project/i.test(section)) return [{heading:"Business and project",text:"Enter your business identity, contact details, optional logo and project location or description. Save business profile keeps reusable details on this device for new quotes; it does not overwrite existing quotations. Project information is an editable customer-document snapshot."}];
  if (/introduction|scope|exclusions|payment|notes|footer/i.test(section)) return [{heading:QUOTE_TEXT_LABELS[section as keyof typeof QUOTE_TEXT_LABELS]??section,text:"Introduction explains the proposal; scope defines included work; exclusions state what is not included; payment terms describe the agreed payment arrangement. Additional notes and footer hold your optional customer text. Edit only what applies and review Customer PDF content before export."}];
  return [
    {heading:"Create and edit",text:"Start blank or generate from project. Quote details hold the quote number/name, date, currency and status. Work sections group the items. Edit each quantity and customer unit price; expand rows for descriptions and private costs. Changing currency does not convert prices."},
    {heading:"Save and Save as",text:"Edits are autosaved in this browser. Save immediately persists the current quotation. Save as creates a separately named editable copy and keeps the original unchanged. Duplicate as revision retains the quote number with a new revision. Use File → Save for a portable .floorplan3d backup; browser storage alone is not a backup."},
    {heading:"Review and export",text:"Check running totals, descriptions, tax and customer details in Preview. Incomplete quotations export as draft PDFs with Not set values; complete all prices before issuing a final document. Undo and redo apply to the current quote's edits."}
  ];
}
