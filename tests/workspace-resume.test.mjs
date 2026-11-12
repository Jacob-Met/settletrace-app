import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {copyPreviousWorkspace} from '../scripts/start-workspace.mjs';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'settletrace-resume-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 return root;
}
const saved={orders:[{id:'retained-order'}],events:[],operator_notes:[{id:'n1',text:'Original conclusion',source:'local'}],investigation_work:{'retained-order':{archived:true}},sources:{original:{body:'retained original'}},snapshots:[{id:'s1',source:'paypal'}]};
test('explicit previous app copy preserves complete bytes and leaves the old journal independent',async t=>{
 const root=await fixture(t),previous=path.join(root,'previous release'),source=path.join(previous,'.settletrace','state.json'),destination=path.join(root,'new release','.settletrace','state.json');
 await fs.mkdir(path.dirname(source),{recursive:true});const original=JSON.stringify(saved,null,2)+'\n';await fs.writeFile(source,original);
 const result=await copyPreviousWorkspace(previous,destination);
 assert.equal(result.orders,1);assert.equal(result.notes,1);assert.equal(await fs.readFile(destination,'utf8'),original);assert.deepEqual(JSON.parse(await fs.readFile(destination,'utf8')),saved);
 await fs.writeFile(destination,JSON.stringify({...saved,operator_notes:[]}));assert.equal(await fs.readFile(source,'utf8'),original);
});
test('an explicit external private data directory is supported',async t=>{
 const root=await fixture(t),source=path.join(root,'private journal'),destination=path.join(root,'new','state.json');
 await fs.mkdir(source);await fs.writeFile(path.join(source,'state.json'),JSON.stringify(saved));
 await copyPreviousWorkspace(source,destination);assert.deepEqual(JSON.parse(await fs.readFile(destination,'utf8')),saved);
});
test('existing destination is never replaced or merged, including a same-folder request',async t=>{
 const root=await fixture(t),source=path.join(root,'old'),destination=path.join(root,'new','state.json');
 await fs.mkdir(source);await fs.mkdir(path.dirname(destination));await fs.writeFile(path.join(source,'state.json'),JSON.stringify(saved));await fs.writeFile(destination,'existing journal bytes');
 await assert.rejects(copyPreviousWorkspace(source,destination),/not replaced or merged/);assert.equal(await fs.readFile(destination,'utf8'),'existing journal bytes');assert.deepEqual(await fs.readdir(path.dirname(destination)),['state.json']);
 await assert.rejects(copyPreviousWorkspace(source,path.join(source,'state.json')),/not replaced or merged/);assert.deepEqual(JSON.parse(await fs.readFile(path.join(source,'state.json'),'utf8')),saved);
});
test('missing, malformed and non-workspace inputs refuse before creating a destination',async t=>{
 const root=await fixture(t),source=path.join(root,'old'),destination=path.join(root,'new','state.json');await fs.mkdir(source);
 await assert.rejects(copyPreviousWorkspace(source,destination),/No saved workspace/);
 for(const body of ['{broken','null',JSON.stringify({orders:[]})]){
  await fs.writeFile(path.join(source,'state.json'),body);await assert.rejects(copyPreviousWorkspace(source,destination),/not valid JSON|not a SettleTrace workspace/);
  await assert.rejects(fs.stat(destination),{code:'ENOENT'});
 }
});
test('two possible source journals are refused rather than guessed',async t=>{
 const root=await fixture(t),source=path.join(root,'old'),destination=path.join(root,'new','state.json');await fs.mkdir(path.join(source,'.settletrace'),{recursive:true});
 for(const file of ['state.json','.settletrace/state.json'])await fs.writeFile(path.join(source,file),JSON.stringify(saved));
 await assert.rejects(copyPreviousWorkspace(source,destination),/two journals/);await assert.rejects(fs.stat(destination),{code:'ENOENT'});
});

test('the actual CLI runs through an aliased installation path and refuses a missing workspace',async t=>{
 const root=await fixture(t),alias=path.join(root,'app alias'),repository=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
 await fs.symlink(repository,alias,'junction');
 const result=spawnSync(process.execPath,[path.join(alias,'scripts/start-workspace.mjs'),'--resume-from',path.join(root,'missing')],{cwd:root,env:{...process.env,PORT:'0',SETTLETRACE_STARTER_CASE:'0',SETTLETRACE_DATA_DIR:path.join(root,'destination')},encoding:'utf8',timeout:3000});
 assert.equal(result.signal,null);assert.equal(result.status,1,result.stdout+result.stderr);assert.match(result.stderr,/No saved workspace/);
 await assert.rejects(fs.stat(path.join(root,'destination','state.json')),{code:'ENOENT'});
});
