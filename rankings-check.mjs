import assert from 'node:assert/strict';
import { ppCandidates } from './lib/rankings.mjs';
for (const [min,max] of [[39980,39990],[38900,39900],[30001,30050],[40001,40100]]) {
  const calls=new Map();
  const source={async ranking(page){
    calls.set(page,(calls.get(page)||0)+1);
    await new Promise(r=>setTimeout(r,1));
    return Array.from({length:50},(_,i)=>{const rank=(page-1)*50+i+1;return {id:rank,rank,pp:40001-rank,rounded_pp:40001-rank};});
  }};
  const found=await ppCandidates(source,{min,max});
  const selected=found.players.filter(p=>p.pp>=min&&p.pp<=max);
  assert.equal(selected.length,Math.max(0,Math.min(max,40000)-Math.max(min,30001)+1));
  assert.ok([...calls.values()].every(n=>n===1),'Repeated boundary requests');
}
console.log('Parallel pp boundaries: same-page, multi-page, bottom boundary and empty ranges passed.');
