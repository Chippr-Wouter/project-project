const summarize = (value) => {
  if (value === null || typeof value !== "object") return { type: typeof value }
  const object = value
  const checkpoint =
    object.checkpoint && typeof object.checkpoint === "object"
      ? {
          epoch: object.checkpoint.epoch,
          revision: object.checkpoint.revision
        }
      : undefined
  return {
    keys: Object.keys(object).slice(0, 24),
    id: typeof object.id === "string" ? object.id : undefined,
    identity: typeof object.identity === "string" ? object.identity : undefined,
    userId: typeof object.userId === "string" ? object.userId : undefined,
    accountId:
      typeof object.accountId === "string" ? object.accountId : undefined,
    server: typeof object.server === "string" ? object.server : undefined,
    project: typeof object.project === "string" ? object.project : undefined,
    orgSlug: typeof object.orgSlug === "string" ? object.orgSlug : undefined,
    slug: typeof object.slug === "string" ? object.slug : undefined,
    generation: Number.isInteger(object.generation)
      ? object.generation
      : undefined,
    revoked: typeof object.revoked === "boolean" ? object.revoked : undefined,
    checkpoint,
    itemCount: Array.isArray(object.items) ? object.items.length : undefined
  }
}

export const identityProbe =
  "fetch('/__prototype/identity').then(async response => ({status:response.status,body:await response.json().catch(() => null)}))"

export const authProbe = `(async()=>{
 const response=await fetch('/api/me');
 const body=await response.json().catch(()=>null);
 return {status:response.status,userId:body&&typeof body.id==='string'?body.id:undefined,body:body&&typeof body==='object'?{id:body.id,email:body.email,username:body.username}:body};
})()`

export const projectAccessProbe = `(async()=>{
 const response=await fetch('/api/orgs/measure/projects/ten-thousand');
 const body=await response.json().catch(()=>null);
 return {status:response.status,body:body&&typeof body==='object'?{id:body.id,slug:body.slug,name:body.name}:body};
})()`

export const cacheInventoryProbe = `(async()=>{
 if(typeof indexedDB.databases !== 'function')return {supported:false,databases:[]};
 const listed=(await indexedDB.databases()).map(x=>x.name).filter(name=>typeof name==='string'&&name.startsWith('PROTOTYPE-'));
 const open=name=>new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result)});
 const readStore=(db,name)=>new Promise((resolve,reject)=>{const request=db.transaction(name,'readonly').objectStore(name).getAll();request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result)});
 const databases=[];
  for(const name of listed){
  let db;
  try {
   db=await open(name);
   const stores=[];
   for(const store of [...db.objectStoreNames]){
    const values=await readStore(db,store);
    stores.push({name:store,count:values.length,samples:values.slice(0,3).map(${summarize.toString()})});
   }
   db.close();
   databases.push({name,version:db.version,stores});
  } catch(error) {
   db?.close();
   databases.push({name,error:String(error)});
  }
 }
 return {supported:true,databases};
})()`

export const overviewProbe = `(async()=>({
 identity:window.__prototypeIdentity,
 path:location.pathname,
 lists:[...document.querySelectorAll('[data-loaded-rows]')].map(list=>({loaded:Number(list.dataset.loadedRows),mounted:Number(list.dataset.mountedRows)})),
 text:document.body.innerText.slice(0,160)
}))()`

export const networkProbe =
  "({identity:window.__prototypeNetwork?.identity,delayed:[...(window.__prototypeNetwork?.delayed??[])],failures:[...(window.__prototypeNetwork?.failures??[])],pending:window.__prototypeNetwork?.pendingPaths()??[],url:location.href,requests:(window.__prototypeNetwork?.requests??[]).slice(-30)})"

export const setIdentityProbe = (identity) =>
  `window.__prototypeNetwork?.setIdentity(${JSON.stringify(identity)})`

export const delayPathProbe = (path) =>
  `window.__prototypeNetwork?.delay(${JSON.stringify(path)})`

export const releasePathProbe = (path) =>
  `window.__prototypeNetwork?.release(${path === undefined ? "undefined" : JSON.stringify(path)})`

export const failPathProbe = (path) =>
  `window.__prototypeNetwork?.fail(${JSON.stringify(path)})`

export const recoverPathProbe = (path) =>
  `window.__prototypeNetwork?.recover(${JSON.stringify(path)})`

export const releaseDelayedRequests =
  "(() => { window.__prototypeNetwork?.release(); const url = new URL(location.href); url.searchParams.delete('prototypeDelay'); history.replaceState(history.state, '', url); return {url:location.href,pending:window.__prototypeNetwork?.pendingPaths()??[]}; })()"
