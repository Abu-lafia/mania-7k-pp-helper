"""Import the official sample without MySQL; publish only a complete database."""
import sys, re, json, sqlite3, tarfile, heapq, os, time
from pathlib import Path

TUPLE = re.compile(r"\((?:'(?:\\.|[^'\\])*'|[^'()])*\)")
TOKEN = re.compile(r"(?:_binary )?'(?:\\.|[^'\\])*'|[^,]+")
ESC = {'0':'\0','n':'\n','r':'\r','t':'\t','b':'\b','Z':'\x1a'}
def value(s):
    if s.startswith('_binary '): s=s[8:]
    if s == 'NULL': return None
    if s.startswith("'"):
        return re.sub(r'\\(.)', lambda m: ESC.get(m[1], m[1]), s[1:-1])
    try: return float(s) if any(x in s.lower() for x in '.e') else int(s)
    except ValueError: return s

def main(archive, destination):
    out = Path(destination); out.parent.mkdir(parents=True, exist_ok=True)
    temp = str(out)+'.importing'; Path(temp).unlink(missing_ok=True)
    db = sqlite3.connect(temp)
    db.executescript('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE beatmaps(id INTEGER PRIMARY KEY,data TEXT); CREATE TABLE sets(id INTEGER PRIMARY KEY,data TEXT); CREATE TABLE best(user_id INTEGER PRIMARY KEY,data TEXT);')
    heaps = {}; count = 0; reported = 0; started = time.time()
    wanted = {'osu_beatmaps.sql':'beatmaps','osu_beatmapsets.sql':'sets','osu_scores_mania_high.sql':'scores'}
    done = set()
    with tarfile.open(archive, 'r|bz2') as tar:
        for member in tar:
            kind = wanted.get(Path(member.name).name)
            if not kind: continue
            print('Importing',kind,member.size,flush=True)
            columns = []; in_schema = False; batch = []
            for raw in tar.extractfile(member):
                line = raw.decode('utf-8',errors='replace').strip()
                if line.startswith('CREATE TABLE'): in_schema = True; continue
                if in_schema:
                    if line.startswith(')'): in_schema=False
                    elif line.startswith('`'): columns.append(line.split('`')[1])
                    continue
                if not line.startswith('INSERT INTO'): continue
                payload = line.split(' VALUES ',1)[1]
                rows = payload.strip(';')[1:-1].split('),(') if kind=='scores' else (m[0][1:-1] for m in TUPLE.finditer(payload))
                for row in rows:
                    if kind=='scores':
                        # This table has only numbers, enums, timestamps and country codes.
                        fields = row.split(','); uid=int(fields[2]); pp=fields[15]
                        if pp=='NULL' or int(fields[17])!=0: continue
                        item=(float(pp),int(fields[0]),int(fields[1]),int(fields[13]))
                        heap=heaps.setdefault(uid,[])
                        duplicate=next((i for i,x in enumerate(heap) if x[2]==item[2]),None) if len(heap)<50 or item>heap[0] else None
                        if duplicate is not None:
                            if item>heap[duplicate]: heap[duplicate]=item; heapq.heapify(heap)
                        elif len(heap)<50: heapq.heappush(heap,item)
                        elif item>heap[0]: heapq.heapreplace(heap,item)
                        count+=1
                    else:
                        fields=[value(m[0]) for m in TOKEN.finditer(row)]
                        if len(fields)!=len(columns):
                            Path(str(out)+'.bad-row.txt').write_text(repr(row)+'\n'+repr(fields),encoding='utf-8')
                            raise ValueError(f'SQL field count mismatch: {len(fields)} vs {len(columns)}')
                        data=dict(zip(columns,fields)); key=data['beatmap_id' if kind=='beatmaps' else 'beatmapset_id']
                        keep=['beatmap_id','beatmapset_id','checksum','version','total_length','diff_size','playmode','approved','last_update','bpm'] if kind=='beatmaps' else ['beatmapset_id','artist','title','creator','nsfw']
                        batch.append((key,json.dumps({k:data[k] for k in keep},ensure_ascii=False)))
                if batch:
                    db.executemany('INSERT INTO '+kind+' VALUES (?,?)',batch); batch.clear()
                if kind=='scores' and count-reported>=250000:
                    print('Scores',count,'elapsed',round(time.time()-started),flush=True); reported=count
            db.commit(); done.add(kind)
            print('Finished',kind,'elapsed',round(time.time()-started),flush=True)
            if done==set(wanted.values()): break
    if done!=set(wanted.values()) or not heaps: raise ValueError('Incomplete official archive')
    db.executemany('INSERT INTO best VALUES (?,?)',((u,json.dumps(sorted(h,reverse=True))) for u,h in heaps.items()))
    date=re.search(r'\d{4}_\d{2}_\d{2}',Path(archive).name)[0].replace('_','-')
    db.executemany('INSERT INTO metadata VALUES (?,?)',[('date',date),('users',str(len(heaps))),('scope','Official Mania top 10,000 sample; legacy top 50 per player')])
    db.commit(); db.close(); os.replace(temp,out)
    print('Ready',out,'users',len(heaps),'bytes',out.stat().st_size,'seconds',round(time.time()-started),flush=True)

if __name__=='__main__': main(*sys.argv[1:])
