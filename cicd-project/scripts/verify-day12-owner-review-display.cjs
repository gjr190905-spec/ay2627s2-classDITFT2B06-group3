'use strict';
/* Runs only the installed owner-review UI block in a simulated DOM; no DB access. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve('src/public/prototype-exact/app.js'), 'utf8');
const startMark = 'const review = result.review;';
const endMark = 'form.replaceWith(card);';
const start = source.indexOf(startMark);
const end = source.indexOf(endMark, start) + endMark.length;
if (start < 0 || source.lastIndexOf(startMark) !== start || end <= start || end - start > 6000 || source.lastIndexOf(endMark) !== end - endMark.length) {
  throw new Error('Could not identify the unique installed customer review UI block');
}
const block = source.slice(start, end);
function el(tag) {
  return { tag, textContent:'', className:'', style:{}, children:[], attributes:{},
    append(...children) { this.children.push(...children); },
    setAttribute(name,value) { this.attributes[name] = value; },
    replaceWith(item) { this.replacedWith = item; },
  };
}
const rendered = (review) => {
  const form = el('form');
  const context = { form, result:{review}, document: { createElement:el }, Number, String };
  vm.createContext(context);
  vm.runInContext(block, context);
  if (!form.replacedWith) throw Error('Review card not rendered');
  const allText = e => [e.textContent, ...e.children.map(allText)].join(' ');
  return {card:form.replacedWith, text:allText(form.replacedWith)};
};
for (const [status, expected] of [ ['PENDING','Pending approval'], ['APPROVED','Approved'], ['REJECTED','Rejected'] ]) {
  const {card,text} = rendered({rating:4,comment:'Tasty meal and fast pickup.',status});
  for(const s of ['Your review','Your rating:', '(4/5)', 'Tasty meal and fast pickup.', expected]) {
    if (!text.includes(s)) throw Error(status + ' missing ' + s);
  }
  if (!card.children.every(c => c.tag !== 'script')) throw Error('Unexpected script element');
}
const {card} = rendered({rating:1,comment:'<img src=x onerror=alert(1)>',status:'PENDING'});
const commentEl = card.children.find(e=>e.textContent.includes('<img src=x'));
if (!commentEl || commentEl.tag !== 'p') throw Error('Review comment must use textContent, not HTML');
console.log('Verified private owner display: PENDING, APPROVED, REJECTED, persisted stars/text, HTML-safe output.');
