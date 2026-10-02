import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { compactScore, modNames } from './domain.mjs';

export class Snapshot {
  constructor(file) { this.file = file; }
  open() {
    if (this.db) return true;
    if (!fs.existsSync(this.file)) return false;
    this.db = new DatabaseSync(this.file, { readOnly: true });
    this.date = this.db.prepare("SELECT value FROM metadata WHERE key='date'").get().value;
    this.best = this.db.prepare('SELECT data FROM best WHERE user_id=?');
    this.map = this.db.prepare('SELECT data FROM beatmaps WHERE id=?');
    this.set = this.db.prepare('SELECT data FROM sets WHERE id=?');
    return true;
  }
  player(player) {
    if (!this.open()) return null;
    const row = this.best.get(player.id);
    if (!row) return null;
    const scores = JSON.parse(row.data).map(([pp,id,bid,mods]) => {
      const b = JSON.parse(this.map.get(bid)?.data || 'null');
      const s = b && JSON.parse(this.set.get(b.beatmapset_id)?.data || 'null');
      if (!b || !s) return {score_id:id, invalid:true};
      return compactScore({id,pp,mods:modNames(mods),beatmap:{id:bid,mode_int:b.playmode,convert:b.playmode!==3,
        cs:b.diff_size,checksum:b.checksum,version:b.version,bpm:b.bpm,total_length:b.total_length,
        status:({1:'ranked',2:'approved',3:'qualified',4:'loved'})[b.approved]||'pending',last_updated:b.last_update},
        beatmapset:{id:s.beatmapset_id,artist:s.artist,title:s.title,creator:s.creator,nsfw:!!s.nsfw}});
    });
    return {...player,scores,bp_count:scores.length,bp_7k_count:scores.filter(s=>s.is7).length,bp_complete:false,snapshot:true};
  }
}
