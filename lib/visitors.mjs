import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { SearchJobs } from './jobs.mjs';
import { Downloads } from './downloads.mjs';

// Keep anonymous browser state separate; only public calculation caches are shared.
export class Visitors {
  constructor(sources, cache, directory, secure=false) {
    Object.assign(this,{sources,cache,directory,secure}); this.sessions=new Map();
  }
  get(req,res) {
    let id=/(?:^|;\s*)ppy_visitor=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
    if (!id) {
      id=randomBytes(32).toString('hex');
      res.setHeader('Set-Cookie',`ppy_visitor=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${this.secure?'; Secure':''}`);
    }
    let session=this.sessions.get(id);
    if (!session) {
      const privateKey=k=>k==='last-result-native7-v1'?`visitor-last-v1:${id}`:k;
      const cache={get:(k,...args)=>this.cache.get(privateKey(k),...args),
        set:(k,...args)=>this.cache.set(privateKey(k),...args),has:k=>this.cache.has(privateKey(k))};
      session={jobs:new SearchJobs(this.sources,cache),downloads:new Downloads(path.join(this.directory,id)),token:randomBytes(24).toString('hex')};
      this.sessions.set(id,session);
    }
    session.accessed=Date.now();
    // Discard idle in-memory contexts; completed history is persisted under the cookie.
    for (const [key,old] of this.sessions) if (Date.now()-old.accessed>86400000 &&
      ![...old.jobs.jobs.values()].some(j=>j.status==='running') && old.downloads.status()?.status!=='running') this.sessions.delete(key);
    return session;
  }
  stop() { for (const s of this.sessions.values()) {
    for (const j of s.jobs.jobs.values()) j.controller.abort(); s.downloads.cancel();
  } }
}
