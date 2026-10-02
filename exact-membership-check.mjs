import assert from 'node:assert/strict';
import {SearchJobs} from './lib/jobs.mjs';
for (const outcome of ['outside','failed','inside']) {
  const values=new Map(),cache={get:k=>values.get(k)||null,set:(k,v)=>values.set(k,v),has:k=>values.has(k)};
  let best=0,tracker=0;
  const sources={requests:0,hits:0,
    ranking:async()=>[{id:1,rank:1,username:'Candidate',rounded_pp:9000},{id:2,rank:2,username:'Below',rounded_pp:7000}],
    profile:async()=>{await new Promise(r=>setTimeout(r,20));if(outcome==='failed')throw Error('Unavailable');return {pp:outcome==='outside'?11000:9000}},
    best:async()=>{best++;return {bp_complete:true,scores:[{is7:true,beatmap_id:1,beatmapset_id:1,checksum:'fixture',mod:'NM'}]}},
    tracker:async()=>{tracker++;return {regular:1,ln:1}},
    cached:async()=>({stars:4,pp_max:100,rate:1})};
  const jobs=new SearchJobs(sources,cache),started=jobs.start({mode:'pp',min:8000,max:10000});
  await jobs.jobs.get(started.id).task;
  assert.equal(jobs.status(started.id).status,'complete');
  const expected=outcome==='inside'?1:0;
  assert.equal(jobs.latest.players.length,expected);assert.equal(jobs.latest.maps.length,expected);
  assert.equal(best,expected);assert.equal(tracker,expected);
}
console.log('Exact pp membership gates BP, tracker and aggregation for included, out-of-range and failed-profile candidates.');
