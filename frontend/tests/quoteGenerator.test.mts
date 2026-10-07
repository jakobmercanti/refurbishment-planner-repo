import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import 'fake-indexeddb/auto';
import { PDFDocument } from 'pdf-lib';
import { newProject, parseProject } from '../lib/projectDocument.ts';
import { LocalProjectRepository } from '../lib/projectRepository.ts';
import { exportProject, importProject, inspectPackage } from '../lib/projectPackage.ts';
import { newQuote, newQuoteItem, duplicateQuote, quoteSchema, readQuoteBusinessProfile, saveQuoteBusinessProfile } from '../lib/quoteDocument.ts';
import { calculateQuote, moneyInput, parseMoney, quoteMoney, markupPrice, changeQuoteCurrency } from '../lib/quoteCalculations.ts';
import { quoteCandidates, generateQuoteItems, quoteSourceChanges, refreshQuoteItem } from '../lib/quoteSources.ts';
import { buildQuotePdf, quoteTextBlocks } from '../lib/quotePdf.ts';
import { parsePlannerBuildView } from '../lib/plannerBuildView.ts';
import starterDemo from '../lib/starterDemo.json';
import type { Room } from '../lib/types.ts';

function pricedQuote() {
  const p = newProject(), q = newQuote(p.projectId, p.name, 'GBP');
  q.sections[0].items = [{ ...newQuoteItem(), description: 'Edited customer work', quantity: '2.5', unit: 'hours', unitPriceMinor: 1001, taxRate: '20', internalCostMinor: 731 }];
  return { p, q };
}
test('view preference accepts exactly the new views and migrates the old table preference', () => {
  assert.deepEqual(['GANTT','DASHBOARD','QUOTE','TABLE',null,'garbage'].map(parsePlannerBuildView), ['GANTT','DASHBOARD','QUOTE','DASHBOARD','GANTT','GANTT']);
});
test('money uses exact minor units, half-up rounding and currency-aware display', () => {
  assert.equal(parseMoney('0.005','GBP'), 1);
  assert.equal(parseMoney('123.5','JPY'), 124);
  assert.equal(moneyInput(1000000000000,'GBP'), '10000000000.00');
  assert.equal(quoteMoney(12345n,'GBP'), '£123.45');
  assert.equal(quoteMoney(12345n,'EUR'), '€123.45');
  assert.equal(quoteMoney(12345n,'USD'), 'US$123.45');
  assert.equal(parseMoney('','GBP'), null);
  assert.throws(() => parseMoney('-1','GBP'));
  assert.equal(markupPrice(999,'10'),1099);
});
test('quote totals use one deterministic rounding policy, discounts and tax on discounted lines', () => {
  const { q } = pricedQuote(); q.taxApplicable = true;
  q.sections[0].items.push({ ...newQuoteItem(), description:'Materials',quantity:'1',unitPriceMinor:1000,taxRate:'5' });
  q.discount = { type:'percentage',value:'10' };
  const t = calculateQuote(q);
  assert.equal(t.complete,true); assert.equal(t.subtotal,3503n); assert.equal(t.discount,350n);
  assert.equal(t.tax,496n); assert.equal(t.total,3649n);
  assert.equal(t.lines.reduce((sum,line)=>sum+line.discount,0n),t.discount);
  assert.equal(t.sections[0].subtotal,t.subtotal);
  q.discount={type:'fixed',value:'1.01'}; assert.equal(calculateQuote(q).discount,101n);
  q.taxApplicable=false; assert.equal(calculateQuote(q).tax,0n);
  q.discount={type:'percentage',value:'101'}; assert.equal(calculateQuote(q).complete,false);
});
test('missing values stay unknown and block invalid totals rather than become zero', () => {
  const {q}=pricedQuote(); q.sections[0].items[0].quantity=null;
  assert.equal(calculateQuote(q).complete,false); assert.equal(calculateQuote(q).lines[0].subtotal,null);
  q.sections[0].items[0].quantity='0'; q.sections[0].items[0].unitPriceMinor=0;
  assert.equal(calculateQuote(q).complete,true); assert.equal(calculateQuote(q).total,0n);
  q.discount={type:'fixed',value:null}; assert.match(calculateQuote(q).errors.join(' '),/Not set/);
});
test('currency changes do not invent FX rates or relabel internal costs', () => {
  const {q}=pricedQuote(), changed=changeQuoteCurrency(q,'JPY');
  assert.equal(changed.sections[0].items[0].unitPriceMinor,10);
  assert.equal(changed.sections[0].items[0].internalCostMinor,null);
  assert.equal(q.currency,'GBP'); assert.equal(q.sections[0].items[0].internalCostMinor,731);
});
test('old projects load with no quotes; versioned quotes validate ownership and IDs', () => {
  const {p,q}=pricedQuote(); const old=structuredClone(p); delete old.quotes;
  assert.deepEqual(parseProject(old).quotes,[]);
  assert.equal(quoteSchema.parse(q).quoteId,q.quoteId);
  assert.throws(()=>quoteSchema.parse({...q,version:2}));
  assert.throws(()=>parseProject({...p,quotes:[{...q,projectId:'another-project'}]}));
  assert.throws(()=>parseProject({...p,quotes:[q,q]}));
  assert.throws(()=>quoteSchema.parse({...q,quoteDate:'2026-02-30'}));
});
test('blank, multiple quotes and revisions preserve previous commercial documents', () => {
  const {p,q}=pricedQuote(); q.status='Sent';
  const original=structuredClone(q), revision=duplicateQuote(q,true), duplicate=duplicateQuote(q);
  revision.sections[0].items[0].description='Revision edit';
  assert.deepEqual(q,original); assert.equal(revision.revision,1); assert.equal(revision.status,'Draft');
  assert.notEqual(revision.quoteId,q.quoteId); assert.notEqual(revision.sections[0].items[0].quoteItemId,q.sections[0].items[0].quoteItemId);
  assert.notEqual(newQuote(p.projectId,p.name,'GBP',[q]).quoteNumber,q.quoteNumber);
  assert.equal(parseProject({...p,quotes:[q,revision,duplicate]}).quotes?.length,3);
});
test('generation reuses room metrics and entered costs, leaves unknowns blank and does not double import', () => {
  const p=newProject(); p.rooms=[structuredClone((starterDemo as unknown as {room:Room}).room)];
  p.rooms[0].id='quote-room';
  p.plannerBuild.activities=[{activityId:'quote-work',name:'Entered work',startDate:'2026-10-01',endDate:'2026-10-02',colour:'#287FB8',category:'FIRST FIX',progress:0,type:'task',status:'not_started',dependencyIds:[],sortOrder:0,estimatedCost:125.25,currency:'GBP'}];
  const candidates=quoteCandidates(p,'GBP'), q=newQuote(p.projectId,p.name,'GBP');
  const floor=candidates.find(c=>c.key==='room:quote-room:floor')!;
  assert.match(floor.value.quantity!,/^\d+\.\d$/); assert.equal(floor.value.unit,'m²');
  const generated=generateQuoteItems(q,candidates,candidates.map(c=>c.key));
  const work=generated.sections.flatMap(s=>s.items).find(i=>i.source?.key==='activity:quote-work')!;
  assert.equal(work.internalCostMinor,12525); assert.equal(work.unitPriceMinor,null);
  assert.equal(generateQuoteItems(q,candidates,['activity:quote-work'],true).sections.flatMap(s=>s.items)[0].unitPriceMinor,12525);
  assert.deepEqual(generateQuoteItems(generated,candidates,candidates.map(c=>c.key)),generated);
  assert.equal(quoteCandidates(p,'USD').find(c=>c.key==='activity:quote-work')!.value.internalCostMinor,null);
  p.rooms[0].wall_height.value=0;
  assert.equal(quoteCandidates(p,'GBP').find(c=>c.key==='room:quote-room:walls')!.value.quantity,null);
});
test('project changes only flag snapshots; selective refresh preserves edited commercial values and manual lines', () => {
  const {p,q}=pricedQuote(), originalItem=q.sections[0].items[0];
  const value={description:'Original project description',quantity:'12',unit:'items',internalCostMinor:500,currency:'GBP',room:'Kitchen',trade:'Electrician'};
  const candidate={key:'test-source',label:'Electrical schedule',group:'Electrical' as const,section:'Electrical',category:'Materials' as const,value};
  const generated=generateQuoteItems(q,[candidate],['test-source']);
  const linked=generated.sections[1].items[0]; linked.description='Customer description'; linked.notes='Commercial notes'; linked.unitPriceMinor=9900; linked.quantity='11';
  const snapshot=structuredClone(generated), updated={...value,quantity:'14',internalCostMinor:600};
  const changes=quoteSourceChanges(generated,[{...candidate,value:updated}]);
  assert.equal(changes.length,1); assert.deepEqual(generated,snapshot);
  const refreshed=refreshQuoteItem(linked,updated);
  assert.equal(refreshed.quantity,'14'); assert.equal(refreshed.unitPriceMinor,9900); assert.equal(refreshed.description,'Customer description'); assert.equal(refreshed.notes,'Commercial notes');
  assert.equal(generated.sections[0].items[0].quoteItemId,originalItem.quoteItemId);
  assert.equal(quoteSourceChanges(generated,[])[0].current,null);
  assert.deepEqual(p.quotes,[]);
});
test('quotes survive portable file save/load, autosave repository backups and project duplication', async () => {
  const {p,q}=pricedQuote(); p.quotes=[q,duplicateQuote(q,true)];
  const blob=await exportProject(p), bytes=new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(inspectPackage(bytes).project.quotes,p.quotes);
  const restored=await importProject(new File([bytes],'quote.floorplan3d'));
  assert.deepEqual(restored.quotes,p.quotes);
  const repo=new LocalProjectRepository(); await repo.saveProject({...p,name:'Autosaved quote project'});
  assert.deepEqual((await repo.getProject(p.projectId))!.quotes,p.quotes);
  const copy=await repo.duplicateProject(p.projectId);
  assert.equal(copy.quotes?.length,2); assert.equal(copy.quotes![0].projectId,copy.projectId);
  assert.notEqual(copy.quotes![0].quoteId,q.quoteId); assert.deepEqual((await repo.getProject(p.projectId))!.quotes,p.quotes);
});
test('business identity is reusable locally and separate from geometry', () => {
  const {q}=pricedQuote(); q.supplier.name='User supplied business';
  const data=new Map<string,string>(), storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
  saveQuoteBusinessProfile(q.supplier,storage); assert.deepEqual(readQuoteBusinessProfile(storage),q.supplier);
  storage.setItem([...data.keys()][0],'bad json'); assert.equal(readQuoteBusinessProfile(storage).name,'');
});
test('PDF exports the current quote, wraps long edited content, paginates, and rejects missing prices', async () => {
  const {q}=pricedQuote(); q.customer.name='Edited customer'; q.supplier.name='Łódź contractor'; q.notes='Current notes'; q.paymentTerms='User payment terms';
  q.sections[0].items[0].notes='Customer-facing item notes';
  for(let i=0;i<70;i++) q.sections[0].items.push({...newQuoteItem(),description:`Edited item ${i} `+'Long description '.repeat(15),quantity:'1.25',unit:'m²',unitPriceMinor:12345,taxRate:'5'});
  q.scope='Scope paragraph '.repeat(500); q.taxApplicable=true;
  const fonts=await Promise.all(['latin','latin-ext'].map(name=>readFile(new URL(`../public/quote-fonts/${name}.woff`,import.meta.url)))) as [Uint8Array,Uint8Array];
  const bytes=await buildQuotePdf(q,fonts), pdf=await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount()>3); assert.equal(pdf.getTitle(),`Quote ${q.quoteNumber}`);
  assert.equal(pdf.getAuthor(),q.supplier.name); assert.equal(calculateQuote(q).complete,true);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({data:new Uint8Array(bytes),useSystemFonts:true,disableFontFace:true});
  const document = await task.promise;
  let content = '';
  for (let pageNumber=1;pageNumber<=document.numPages;pageNumber++) {
    const page = await document.getPage(pageNumber), text = await page.getTextContent();
    content += text.items.map(item=>'str' in item ? item.str : '').join(' ')+'\n';
  }
  await task.destroy();
  assert.match(content,/Edited customer work/); assert.match(content,/Edited customer/);
  assert.match(content,/Customer-facing item notes/); assert.match(content,/Current notes/);
  assert.match(content,/User payment terms/); assert.ok(content.includes(quoteMoney(calculateQuote(q).total,q.currency)));
  for (let index=0;index<70;index++) assert.ok(content.includes(`Edited item ${index} `));
  assert.doesNotMatch(content,/Internal cost|Linked to project|731/);
  assert.ok(quoteTextBlocks(q).some(([label,text])=>label==='Payment terms'&&text===q.paymentTerms));
  q.sections[0].items[0].unitPriceMinor=null; await assert.rejects(()=>buildQuotePdf(q,fonts),/Not set/);
});
