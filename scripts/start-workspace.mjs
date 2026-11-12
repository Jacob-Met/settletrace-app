import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startServer,resolveDataFile} from '../server.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function copyPreviousWorkspace(from,destination){
 const folder=path.resolve(from),candidates=[path.join(folder,'.settletrace','state.json'),path.join(folder,'state.json')];
 const found=[];
 for(const candidate of candidates){
  try{if((await fs.stat(candidate)).isFile())found.push(candidate);}
  catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
 }
 if(found.length!==1)throw Error(found.length?'This folder contains two journals. Choose its .settletrace folder explicitly.':'No saved workspace found. Choose the previous extracted app folder or its private data directory.');
 const source=found[0],bytes=await fs.readFile(source);
 let state;try{state=JSON.parse(bytes.toString('utf8'));}catch{throw Error('The previous workspace is not valid JSON. No journal was copied.');}
 if(!state||!Array.isArray(state.orders)||!Array.isArray(state.events))throw Error('The selected file is not a SettleTrace workspace. No journal was copied.');
 destination=path.resolve(destination);
 await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
 const temporary=destination+'.resume-'+randomUUID();
 const handle=await fs.open(temporary,'wx',0o600);
 try{
  await handle.writeFile(bytes);await handle.close();
  try{await fs.link(temporary,destination);}
  catch(error){if(error.code==='EEXIST')throw Error('This release already has a workspace. It was not replaced or merged. Open it normally, or choose an empty SETTLETRACE_DATA_DIR.');throw error;}
 }finally{await handle.close().catch(()=>{});await fs.rm(temporary,{force:true});}
 return {source,destination,orders:state.orders.length,notes:Array.isArray(state.operator_notes)?state.operator_notes.length:0};
}
export async function launch(args=process.argv.slice(2)){
 const invocationDirectory=process.cwd();
 if(args.length&&!(args.length===1&&args[0]==='--demo')&&!(args.length===2&&args[0]==='--resume-from'&&args[1].trim())&&!(args.length===1&&args[0]==='--help'))throw Error('Usage: run-unix.sh [--resume-from PREVIOUS_FOLDER] (Windows: run-windows.cmd).');
 if(args[0]==='--help'){
  console.log('Start SettleTrace normally, or use --resume-from PREVIOUS_FOLDER to copy your own previous workspace into this release. The source stays unchanged; an existing destination is never replaced or merged. PREVIOUS_FOLDER may be the old extracted app folder or its SETTLETRACE_DATA_DIR. This is private local recovery, not shared-investigation import.');
  return;
 }
 process.chdir(root);
 if(args[0]==='--resume-from'){
  const result=await copyPreviousWorkspace(path.resolve(invocationDirectory,args[1]),resolveDataFile());
  console.log('Copied previous workspace: '+result.orders+' investigations, '+result.notes+' saved notes.');
  console.log('Previous journal unchanged: '+result.source);
  console.log('Current journal: '+result.destination);
 }
 const demoMode=args.includes('--demo')||process.env.SETTLETRACE_DEMO==='1';
 const app=await startServer(demoMode?(await import('../demo-mode.mjs')).demoOptions({port:Number(process.env.PORT||4179)}):{starterCase:process.env.SETTLETRACE_STARTER_CASE!=='0'});
 console.log('SettleTrace '+app.url);
}
const invoked=process.argv[1]?await fs.realpath(process.argv[1]).catch(()=>null):null;
if(invoked===await fs.realpath(fileURLToPath(import.meta.url)))launch().catch(error=>{console.error(error.message);process.exitCode=1;});
