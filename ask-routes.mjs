// Server side of the question bar: the ledger, local speech-to-text, and wording-to-shape mapping.
// Answers are computed in the browser from the ledger by web/ask-engine.mjs; nothing here answers a question.
import {loadLedger} from './ask-ledger.mjs';

const INTENTS=['short','orders','fees','refunds','disputes','order','list'];
const STATIC=new Set(['/ask-ui.mjs','/ask-engine.mjs','/ask.css']);
const isoToday=(d=new Date())=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const MAP_SYSTEM='ASK_MAP You map a merchant\'s question about PayPal payouts onto a fixed shape. Return only JSON like {"intent":"short","payout_phrase":"Tuesday","range_phrase":"","order_phrase":""}. intent is one of: short (why a payout is less than expected), orders (which orders are in a payout), fees (what fees cost), refunds, disputes, order (trace one order), list (show payouts). payout_phrase is the words naming which payout, such as "Tuesday", "the latest" or "the one before", or empty. range_phrase is the words naming a period, such as "this week", or empty. order_phrase is an order ID or buyer first name, or empty. Do not answer the question and do not compute any numbers.';

const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));return true;};
async function readBytes(req,limit){
 const chunks=[];let n=0,over=false;
 await new Promise((resolve,reject)=>{req.on('data',c=>{if(over)return;n+=c.length;if(n>limit){over=true;chunks.length=0;}else chunks.push(c);});req.on('end',resolve);req.on('error',reject);});
 if(over)throw Object.assign(new Error('Recording is too large'),{status:413});
 return Buffer.concat(chunks);
}
const phrase=v=>typeof v==='string'?v.slice(0,80):'';

export function isAskAsset(pathname){return STATIC.has(pathname);}

export async function handleAsk({req,res,pathname,env,fetchImpl}){
 if(req.method==='GET'&&pathname==='/api/ask/ledger'){
  const now=new Date();
  return json(res,200,{ledger:await loadLedger(env.SETTLETRACE_DATA_DIR,now),today:isoToday(now)});
 }
 if(req.method==='POST'&&pathname==='/api/ask/listen'){
  let audio;try{audio=await readBytes(req,8*1024*1024);}catch(e){return json(res,e.status||400,{error:e.message});}
  if(!audio.length)return json(res,400,{error:'No audio received.'});
  const url=env.SETTLETRACE_STT_URL||'http://127.0.0.1:5621/listen';
  try{
   const r=await fetch(url,{method:'POST',headers:{'Content-Type':req.headers['content-type']||'application/octet-stream'},body:audio,signal:AbortSignal.timeout(60000)});
   if(!r.ok)return json(res,502,{error:'The local speech-to-text service answered '+r.status+'.'});
   const out=await r.json();
   const text=(Array.isArray(out.lines)?out.lines.map(l=>String(l.text??'').trim()).join(' '):String(out.text??'')).replace(/\s+/g,' ').trim().slice(0,400);
   return json(res,200,{text});
  }catch{return json(res,503,{error:'The local speech-to-text service is not running.'});}
 }
 if(req.method==='POST'&&pathname==='/api/ask/map'){
  let input;try{input=JSON.parse((await readBytes(req,16*1024)).toString('utf8'));}catch{return json(res,400,{error:'Expected JSON'});}
  const question=phrase(String(input?.question??'').slice(0,400)).length?String(input.question).slice(0,400):'';
  if(!question)return json(res,400,{error:'Ask a question first.'});
  if(!env.AI_BASE_URL||!env.AI_MODEL)return json(res,503,{error:'Local model not configured.'});
  try{
   const base=new URL(env.AI_BASE_URL);if(!['http:','https:'].includes(base.protocol))return json(res,503,{error:'Invalid model endpoint'});
   const api=new URL('chat/completions',base.toString().replace(/\/?$/,'/'));
   const r=await fetchImpl(api.toString(),{method:'POST',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json',...(env.AI_API_KEY?{Authorization:'Bearer '+env.AI_API_KEY}:{})},body:JSON.stringify({model:env.AI_MODEL,temperature:0,max_tokens:120,response_format:{type:'json_object'},messages:[{role:'system',content:MAP_SYSTEM},{role:'user',content:JSON.stringify({question,previous:input.context??null})}]})});
   if(!r.ok)return json(res,502,{error:'Model API failed ('+r.status+')'});
   const content=String((await r.json())?.choices?.[0]?.message?.content??'');
   let m;try{m=JSON.parse(content);}catch{return json(res,200,{mapped:null});}
   if(!INTENTS.includes(m?.intent))return json(res,200,{mapped:null});
   return json(res,200,{mapped:{intent:m.intent,payout_phrase:phrase(m.payout_phrase),range_phrase:phrase(m.range_phrase),order_phrase:phrase(m.order_phrase)}});
  }catch{return json(res,503,{error:'The local model did not answer.'});}
 }
 return false;
}
