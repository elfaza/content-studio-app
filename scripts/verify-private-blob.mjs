import {get,put,del} from '@vercel/blob';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const input=createInterface({input:process.stdin,terminal:false});let config;
for await(const line of input){config=JSON.parse(line);break;}input.close();
if(process.stdin.isTTY)process.stdin.setRawMode(false);
process.env.VERCEL_BLOB_RETRIES='0';
const path='content-studio/storage-probe/'+randomUUID()+'.json';
const options={access:'private',token:config.token,addRandomSuffix:false,allowOverwrite:false,contentType:'application/json',cacheControlMaxAge:0};
let created=false;
try{
 const first=await put(path,JSON.stringify({probe:'one'}),options);created=true;
 let createOnly=false;
 try{await put(path,JSON.stringify({probe:'unexpected'}),options);}catch{createOnly=true;}
 if(!createOnly)throw Error();
 const read=await get(path,{access:'private',token:config.token,useCache:false});
 if(read?.statusCode!==200||(await new Response(read.stream).json()).probe!=='one')throw Error();
 await put(path,JSON.stringify({probe:'two'}),{...options,allowOverwrite:true,ifMatch:read.blob.etag});
 let staleEtagRejected=false;
 try{await put(path,JSON.stringify({probe:'old'}),{...options,allowOverwrite:true,ifMatch:first.etag});}catch{staleEtagRejected=true;}
 const latest=await get(path,{access:'private',token:config.token,useCache:false});
 if(!staleEtagRejected||latest?.statusCode!==200||(await new Response(latest.stream).json()).probe!=='two')throw Error();
 await del(path,{token:config.token});created=false;
 console.log(JSON.stringify({privateStore:true,atomicCreateOnly:true,conditionalWrite:true,consistentRead:true,retries:0,probeRemoved:true,googleCredentialsUsed:false}));
}catch{
 // Do not print provider objects, credentials, request headers, or URLs.
 console.error('Private Blob verification failed; no credential content was used.');
 process.exitCode=1;
}finally{if(created){try{await del(path,{token:config.token});}catch{console.error('Temporary storage probe cleanup needs review.');}}}
