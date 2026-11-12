import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startServer} from '../server.mjs';
import {operatorOriginAllowed} from '../operator-origin.mjs';
test('private HTTPS origin is exact and does not widen local defaults',()=>{
 const local=operatorOriginAllowed();
 assert.equal(local('https://demo.example:18445'),false);
 assert.equal(local('http://localhost:4179'),true);
 const allow=operatorOriginAllowed('https://demo.example:18445');
 for(const origin of ['https://demo.example','https://demo.example:18446','https://demo.example.evil:18445','null'])assert.equal(allow(origin),false);
 assert.equal(allow('https://demo.example:18445'),true);
 assert.equal(allow(undefined),true);
 for(const invalid of ['http://demo.example','https://demo.example/path','https://user:pass@demo.example','https://demo.example/'])assert.throws(()=>operatorOriginAllowed(invalid),/exact HTTPS origin/);
});
test('actual HTTP keeps foreign writes refused while admitting configured proxy origin',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'settle-origin-'));
 const app=await startServer({env:{PORT:'0',SETTLETRACE_ORIGIN:'https://demo.example:18445'},dataFile:path.join(dir,'state.json')});
 try {
  const post=origin=>fetch(app.url+'/api/packet/import',{method:'POST',signal:AbortSignal.timeout(3000),headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
  assert.equal((await post('https://other.example:18445')).status,403);
  assert.equal((await post('https://demo.example:18445')).status,422);
  assert.equal((await post('http://127.0.0.1:4179')).status,422);
 } finally {await new Promise(resolve=>app.server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
