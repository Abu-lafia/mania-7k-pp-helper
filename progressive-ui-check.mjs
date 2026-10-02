import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import * as core from './public/core.js';
import {summary} from './lib/domain.mjs';
const dom=new JSDOM(fs.readFileSync(new URL('./public/index.html',import.meta.url),'utf8'),{url:'https://helper.example.com',runScripts:'outside-only'});
const w=dom.window;
Object.assign(w,core,{t:s=>s,statusText:s=>s,locale:'en',Chart:class {destroy(){}},savePersonalResult(){},loadPersonalResult:async()=>null});
w.HTMLElement.prototype.scrollIntoView=function(){};
let code=fs.readFileSync(new URL('./public/app.js',import.meta.url),'utf8');
code=code.replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g,'').replace('initLanguage();','').replace(/\nboot\(\);/,'');
w.eval(code+'\nwindow.testing={state,renderResult};');
const {state,renderResult}=w.testing;
const p={id:1,rank:1,username:'Alpha',pp:9000,regular:{label:'1dan',group:'1dan',rating:1},ln:{label:'1dan',group:'1dan',rating:1}};
const m={key:'1:NM',beatmap_id:1,beatmapset_id:1,mod:'NM',title:'Map',artist:'Artist',creator:'Mapper',difficulty:'7K',frequency:1,pp_max:100,stars:4,bpm:120,length:60};
function result(players,maps){return {id:'fixture',query:{mode:'rank',min:1,max:2},completed_at:new Date().toISOString(),players,maps,issues:[],summary:summary(players,maps),coverage:{total_scores:players.length},sources:{}}}
state.result=result([p],[m]);renderResult();
const $=id=>w.document.getElementById(id);
for(const name of ['pp','regular','maps']){$(name+'-bins').value='0';$(name+'-bins').dispatchEvent(new w.Event('change'));}
const search=$('players-table').querySelector('.search-input');search.value='Al';search.focus();search.setSelectionRange(1,1);search.dispatchEvent(new w.Event('input'));
state.selected.add('1:NM');
state.result=result([p,{...p,id:2,rank:2,username:'Alpine'}],[m,{...m,key:'2:NM',beatmap_id:2}]);renderResult(true);
assert.equal(w.document.activeElement,search);assert.equal(search.selectionStart,1);assert.equal(search.value,'Al');
for(const id of ['pp-detail','dan-detail','map-detail']) {
  assert.equal($(id).hidden,false);assert.equal(state.tables.get(id+'-table').rows.length,2);
}
assert.equal(state.selected.has('1:NM'),true);
$('pp-detail').querySelector('.collapse-detail').click();renderResult(true);assert.equal($('pp-detail').hidden,true);
console.log('Progressive DOM updates preserve focused input/caret, live detail membership, collapsed lists and download selections.');
w.close();
