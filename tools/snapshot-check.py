import importlib.util, tempfile, tarfile, io, sqlite3, json
from pathlib import Path
spec=importlib.util.spec_from_file_location('loader',Path(__file__).with_name('import-snapshot.py'))
loader=importlib.util.module_from_spec(spec); spec.loader.exec_module(loader)
def sql(name, columns, rows):
    return ('CREATE TABLE `'+name+'` (\n'+''.join('`'+c+'` TEXT,\n' for c in columns)+');\nINSERT INTO `'+name+'` VALUES '+rows+';\n').encode()
with tempfile.TemporaryDirectory() as root:
    archive=Path(root)/'2026_09_01_fixture.tar.bz2'; db=Path(root)/'snapshot.sqlite'
    tables={
    'osu_beatmaps':sql('osu_beatmaps',['beatmap_id','beatmapset_id','checksum','version','total_length','diff_size','playmode','approved','last_update','bpm'],"(1,2,'abc','[7K] (test)',100,7,3,1,'2026-01-01',120)"),
    'osu_beatmapsets':sql('osu_beatmapsets',['beatmapset_id','artist','title','creator','nsfw','binary'],r"(2,'A, B','It\'s (good)','C',0,_binary 'a,b')"),
    'osu_scores_mania_high':sql('osu_scores_mania_high',['c'+str(i) for i in range(19)],"(1,1,3,100,1,'S',0,0,1,0,0,0,0,0,'2026-01-01',20,0,0,'JP'),(2,1,3,100,1,'S',0,0,1,0,0,0,0,64,'2026-01-01',30,0,0,'JP'),(3,2,3,100,1,'S',0,0,1,0,0,0,0,0,'2026-01-01',100,0,1,'JP')")}
    with tarfile.open(archive,'w:bz2') as tar:
        for name,data in tables.items():
            entry=tarfile.TarInfo(name+'.sql'); entry.size=len(data);tar.addfile(entry,io.BytesIO(data))
    loader.main(str(archive),str(db))
    con=sqlite3.connect(db)
    assert con.execute("SELECT value FROM metadata WHERE key='date'").fetchone()[0]=='2026-09-01'
    assert json.loads(con.execute('SELECT data FROM best WHERE user_id=3').fetchone()[0])==[[30,2,1,64]]
    assert json.loads(con.execute('SELECT data FROM sets WHERE id=2').fetchone()[0])['title']=="It's (good)"
    con.close()
print('SQL quoting, binary strings, top-score deduplication, hidden-score exclusion and atomic import passed.')
