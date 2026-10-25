import test from 'node:test';
import assert from 'node:assert/strict';
import { windowHelpSteps } from '../lib/windowHelp';
import { QUOTE_TEXT_LABELS } from '../lib/quoteHelp';

const text=(title:string)=>windowHelpSteps(title).map(s=>`${s.heading}: ${s.text}`).join(' ');
test('CFD convergence help describes the actual monitor, local lifetime and unavailable live connection',()=>{
 const help=text('CFD convergence');
 assert.match(help,/Solver → Run/);assert.match(help,/Phase selector/);assert.match(help,/No OpenFOAM worker/);
 assert.match(help,/latest three/);assert.match(help,/not saved in the project/);
 assert.match(help,/unverified/);assert.match(help,/Clear log/);
});
test('New outline help explains the two-step destructive reset, not annotation tools',()=>{
 assert.match(text('New outline'),/Delete contents & start/);
 assert.doesNotMatch(text('New outline'),/Select a text, line, marker/);
});
test('roof construction help is not mistaken for architectural roof geometry',()=>{
 for(const title of ['Define wall layers','Define floor layers','Define roof layers'])assert.match(text(title),/equivalent-resistance layer/);
 assert.match(text('Roof & ceiling'),/ridge/);
});
test('roof help matches the precise direction entry, expanded finishes and viewer-only exterior action',()=>{
 const help=text('Roof & ceiling');
 assert.match(help,/Custom angle/);assert.match(help,/0° to 360°/);assert.match(help,/never rounded/);
 for(const material of ['asphalt shingles','timber shingles','bitumen membrane','corrugated metal'])assert.ok(help.includes(material),material);
 assert.match(help,/Exterior view belongs to the main 3D viewer/);
});
test('quotation section help reaches its own guide rather than generic service help',()=>{
 assert.match(text('Quote — Items and private costs'),/never appears in the customer/);
 assert.match(text('Quote — Customer PDF content'),/Private costs/);
 assert.match(text('Quote — Discount and VAT / tax'),/tax is calculated after discount/);
});
test('electrical import help matches the actual replace-only confirmation without inventing a Merge button',()=>{
 assert.match(text('Load electrical layout'),/Replace layout/);assert.match(text('Load electrical layout'),/validated before/);assert.match(text('Load electrical layout'),/Cancel/);
 assert.doesNotMatch(text('Load electrical layout'),/Merge adds|previewed|choose Merge/i);
});
test('saved view help describes images rather than claiming an editable project is saved',()=>{
 assert.match(text('Save view'),/PNG|JPEG/);assert.match(text('Save view'),/not an editable/);
});
test('insulation display help never instructs the user to connect electrical switches',()=>{
 assert.doesNotMatch(text('Energy & Insulation — Display options'),/connect a switch|circuit.*destination/i);
 assert.match(text('Energy & Insulation — Display options'),/overlay|labels|display/i);
});
test('heating and thermal controls do not leak instructions between domains',()=>{
 assert.doesNotMatch(text('Define wall layers — Material'),/heating element|radiator/i);
 assert.match(text('Heating Layout — Items to review'),/output|performance|heat loss/i);
});
test('every named workspace help window has task-specific guidance',()=>{
 const titles=['Preferences','View properties','Build floorplan','New outline','Save view','Save project as','Project download','Appearance & dimensions','Selected object controls','Camera','Camera properties','Human mock-up','Coordinates','Activity templates','Add activity','Edit activity','Privacy and local saving','Object catalogue','Catalogue entry details','Material entry details','Supplier catalogue entry','Object catalogue manager','Layout analysis','Local asset library','Account & plans','Floorplan export','Calibrate imported drawing','Annotations & lines','Full Electrical Layout module','Electrical BOM / Export','Lighting layout test','Heating Layout','Underfloor heating setup','Import UFH performance data','Energy & Insulation','Define wall layers','Define floor layers','Define roof layers','Floors & building','Floor properties','Floor openings','Roof & ceiling','Roof materials & colour'];
 for(const title of titles){const steps=windowHelpSteps(title);assert.ok(steps.length>0,title);for(const s of steps){assert.ok(s.heading&&s.text,title);assert.doesNotMatch(s.heading,/^Using /,title);}}
});
test('quote text labels are human-readable and use the same labels in help',()=>{
 assert.equal(QUOTE_TEXT_LABELS.paymentTerms,'Payment terms');
 assert.equal(QUOTE_TEXT_LABELS.notes,'Additional notes');
 for(const label of Object.values(QUOTE_TEXT_LABELS)){const help=text('Quote — '+label);assert.match(help,/optional customer text/);assert.doesNotMatch(help,/paymentTerms|Choose.*circuit/);}
});
