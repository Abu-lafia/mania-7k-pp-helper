import assert from 'node:assert/strict';
import {SearchJobs} from './lib/jobs.mjs';
import {calculationKey} from './lib/calculator.mjs';
const values=new Map(), cache={get:k=>values.get(k)||null,set:(k,v)=>values.set(k,v),has:k=>values.has(k)};
const score={is7:true,beatmap_id:1,beatmapset_id:1,checksum:'x',mod:'NM',artist:'A',title:'T',difficulty:'7K',bpm:100,length:10};
const gate=Promise.withResolvers();
const players=[1,2].map(id=>({id,username:'P'+id,rank:id,pp:9000,rounded_pp:9000}));
const sources={requests:0,hits:0,ranking:async()=>structuredClone(players),
  snapshot:{date:'2026-09-01',player:p=>({...p,scores:[score],bp_count:1,bp_complete:false,snapshot:true})},
  best:async()=>{await gate.promise;return {scores:[score],bp_complete:true}},
  tracker:async()=>({regular:1,ln:1}),cached:async k=>{assert.equal(k,calculationKey(score));return {pp_max:100,stars:4,rate:1}}};
const jobs=new SearchJobs(sources,cache), initial=jobs.start({mode:'rank',min:1,max:2});
await new Promise(r=>setTimeout(r,20));
assert.equal(jobs.status(initial.id).status,'running');
assert.equal(jobs.latest.phase,'snapshot');assert.equal(jobs.latest.snapshot_date,'2026-09-01');
assert.equal(jobs.latest.maps[0].frequency,2);assert.equal(jobs.latest.summary.players,2);
assert.equal(jobs.latest.maps[0].pp_max,null);
gate.resolve();await jobs.jobs.get(initial.id).task;
assert.equal(jobs.status(initial.id).status,'complete');assert.equal(jobs.latest.maps[0].frequency,2);
assert.equal(jobs.latest.maps[0].pp_max,100);assert.ok(jobs.status(initial.id).result_revision>1);
const again=jobs.start({mode:'rank',min:1,max:2,refresh:true});
assert.equal(jobs.latest.phase,'cached');assert.equal(jobs.latest.id,again.id);
await jobs.jobs.get(again.id).task;
console.log('Snapshot appears before BP finishes; live replacement preserves frequency; PP updates and refreshed cached preview passed.');
