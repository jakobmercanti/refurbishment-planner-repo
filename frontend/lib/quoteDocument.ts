import { z } from "zod";
import { CURRENCY_OPTIONS, type CurrencyCode } from "./appPreferences";
import { isIsoDate, localDateKey } from "./plannerBuild";

const id = z.string().min(1).max(150).regex(/^[\w:-]+$/);
const text = z.string().max(10000);
const decimal = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).nullable();
const minor = z.number().int().nonnegative().max(1e12).nullable();
const date = z.string().refine(value => !value || isIsoDate(value), "Use a valid date in YYYY-MM-DD format");
export const quotePartySchema = z.object({ name: text, contact: text, address: text, email: text, telephone: text, reference: text, website: text, companyNumber: text, vatNumber: text, logo: z.string().max(90000).refine(value => !value || /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value), "Use a PNG or JPEG logo") }).strict();
export const quoteSourceValueSchema = z.object({ description: text, quantity: decimal, unit: text, internalCostMinor: minor, currency: z.string().max(3), room: text, trade: text }).strict();
export const quoteItemSchema = z.object({
  quoteItemId: id, description: text, quantity: decimal, unit: z.string().max(100), unitPriceMinor: minor,
  taxRate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/).refine(value => Number(value) <= 100),
  category: z.enum(["Labour", "Materials", "Fixed-price work", "Services", "Fees", "Other"]),
  room: text, trade: text, notes: text, internalCostMinor: minor,
  source: z.object({ key: z.string().min(1).max(500), label: text, baseline: quoteSourceValueSchema }).strict().optional(),
}).strict();
export const quoteSectionSchema = z.object({ sectionId: id, title: text, description: text, items: z.array(quoteItemSchema).max(2000) }).strict();
export const quoteSchema = z.object({
  version: z.literal(1), quoteId: id, projectId: id, quoteNumber: z.string().max(200), reference: z.string().max(200), revision: z.number().int().nonnegative().max(100000),
  status: z.enum(["Draft", "Sent", "Accepted", "Rejected", "Expired"]), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  quoteDate: date, validUntil: date, currency: z.enum(CURRENCY_OPTIONS.map(option => option.code) as [CurrencyCode, ...CurrencyCode[]]),
  supplier: quotePartySchema, customer: quotePartySchema,
  projectInfo: z.object({ name: text, address: text, description: text, reference: text }).strict(),
  sections: z.array(quoteSectionSchema).max(200),
  discount: z.object({ type: z.enum(["none", "percentage", "fixed"]), value: decimal }).strict(),
  taxApplicable: z.boolean(),
  introduction: text, scope: text, exclusions: text, paymentTerms: text, notes: text, footer: text,
  exportOptions: z.object({ customer: z.boolean(), project: z.boolean(), descriptions: z.boolean(), tax: z.boolean(), scope: z.boolean(), exclusions: z.boolean(), paymentTerms: z.boolean(), notes: z.boolean() }).strict(),
}).strict().superRefine((quote, ctx) => {
  const ids = [quote.quoteId, ...quote.sections.flatMap(section => [section.sectionId, ...section.items.map(item => item.quoteItemId)])];
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Duplicate quotation entity ID" });
});
export type QuoteParty = z.infer<typeof quotePartySchema>;
export type QuoteSourceValue = z.infer<typeof quoteSourceValueSchema>;
export type QuoteItem = z.infer<typeof quoteItemSchema>;
export type QuoteSection = z.infer<typeof quoteSectionSchema>;
export type QuoteDocument = z.infer<typeof quoteSchema>;
export const quoteId = () => globalThis.crypto.randomUUID();
export const emptyQuoteParty = (): QuoteParty => ({ name: "", contact: "", address: "", email: "", telephone: "", reference: "", website: "", companyNumber: "", vatNumber: "", logo: "" });
export const newQuoteSection = (title = "Work items"): QuoteSection => ({ sectionId: quoteId(), title, description: "", items: [] });
export const newQuoteItem = (): QuoteItem => ({ quoteItemId: quoteId(), description: "", quantity: null, unit: "items", unitPriceMinor: null, taxRate: "0", category: "Other", room: "", trade: "", notes: "", internalCostMinor: null });
export function newQuote(projectId: string, projectName: string, currency: CurrencyCode, existing: readonly QuoteDocument[] = [], supplier = emptyQuoteParty()): QuoteDocument {
  const today = localDateKey(), now = new Date().toISOString();
  let sequence = 1;
  const prefix = `Q-${today.slice(0, 4)}-`;
  while (existing.some(quote => quote.quoteNumber === prefix + String(sequence).padStart(3, "0"))) sequence++;
  return { version: 1, quoteId: quoteId(), projectId, quoteNumber: prefix + String(sequence).padStart(3, "0"), reference: "", revision: 0, status: "Draft", createdAt: now, updatedAt: now, quoteDate: today, validUntil: "", currency, supplier: structuredClone(supplier), customer: emptyQuoteParty(), projectInfo: { name: projectName, address: "", description: "", reference: "" }, sections: [newQuoteSection()], discount: { type: "none", value: null }, taxApplicable: false, introduction: "", scope: "", exclusions: "", paymentTerms: "", notes: "", footer: "", exportOptions: { customer: true, project: true, descriptions: true, tax: true, scope: true, exclusions: true, paymentTerms: true, notes: true } };
}
export function duplicateQuote(quote: QuoteDocument, asRevision = false, existing: readonly QuoteDocument[] = []): QuoteDocument {
  const now = new Date().toISOString();
  const revision = asRevision ? Math.max(quote.revision, ...existing.filter(item => item.quoteNumber === quote.quoteNumber).map(item => item.revision)) + 1 : 0;
  return { ...structuredClone(quote), quoteId: quoteId(), quoteNumber: asRevision ? quote.quoteNumber : `${quote.quoteNumber} copy`, revision, status: "Draft", createdAt: now, updatedAt: now, sections: quote.sections.map(section => ({ ...structuredClone(section), sectionId: quoteId(), items: section.items.map(item => ({ ...structuredClone(item), quoteItemId: quoteId() })) })) };
}
const PROFILE_KEY = "freefloorplan3d:quote-business-profile:v1";
export function readQuoteBusinessProfile(storage: Pick<Storage, "getItem">): QuoteParty {
  try { return quotePartySchema.parse(JSON.parse(storage.getItem(PROFILE_KEY) ?? "null")); } catch { return emptyQuoteParty(); }
}
export function saveQuoteBusinessProfile(profile: QuoteParty, storage: Pick<Storage, "setItem">): void {
  storage.setItem(PROFILE_KEY, JSON.stringify(quotePartySchema.parse(profile)));
}
