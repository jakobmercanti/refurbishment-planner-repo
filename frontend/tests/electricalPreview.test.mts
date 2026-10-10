import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ElectricalExportWindow } from '../components/ElectricalExportWindow.tsx';
import { showElectricalDocumentPreview } from '../lib/electricalDocumentPreview.ts';

test('export exposes a separate preview before the explicit export action', () => {
  const html = renderToStaticMarkup(createElement(ElectricalExportWindow, { onExport() {}, onPreview() {} }));
  assert.ok(html.indexOf('Preview in separate window') < html.indexOf('Open print / Save as PDF'));
});
test('document preview never prints on opening; printing and closing require explicit actions', () => {
  class Element {
    textContent = ''; className = ''; children: Element[] = []; events = new Map<string, () => void>();
    append(...items: Element[]) { this.children.push(...items); }
    prepend(...items: Element[]) { this.children.unshift(...items); }
    setAttribute() {}
    addEventListener(name: string, callback: () => void) { this.events.set(name, callback); }
  }
  const body = new Element(), head = new Element(); let writes = '', prints = 0, closes = 0;
  const target = { opener: {}, document: { body, head, open() {}, write(html: string) { writes = html; }, close() {}, createElement() { return new Element(); } }, print() { prints++; }, close() { closes++; } };
  showElectricalDocumentPreview(target as unknown as Window, '<html><body>Exact generated drawing and schedules</body></html>');
  assert.equal(prints, 0); assert.equal(target.opener, null); assert.match(writes, /Exact generated drawing/);
  assert.match(body.children[0].children[0].textContent, /nothing exported yet/);
  body.children[0].children[1].events.get('click')!(); assert.equal(prints, 1);
  body.children[0].children[2].events.get('click')!(); assert.equal(closes, 1);
  assert.match(head.children[0].textContent, /@media print/);
});
