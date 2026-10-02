// IndexedDB can store larger result sets than localStorage.
let database;
function open() {
  return database ||= new Promise((resolve,reject)=>{
    const request=indexedDB.open('ppy-personal',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('state');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function loadPersonalResult() {
  try {
    const db=await open();
    return await new Promise((resolve,reject)=>{
      const r=db.transaction('state').objectStore('state').get('latest');
      r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);
    });
  } catch { return null; }
}
export async function savePersonalResult(result) {
  try {
    const db=await open();
    const tx=db.transaction('state','readwrite');tx.objectStore('state').put(result,'latest');
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
  } catch { /* Storage disabled/full: browser session still retains server history. */ }
}
