// Read-only Sandbox transport: no provider payload or credentials enter errors.
export function createPayPalTransport({env,base,fetchImpl=fetch,timeoutMs=15000}) {
 let token=null,expires=0,pending=null;
 const fail=(message,status=502)=>Object.assign(Error(message),{status});
 async function request(uri,options){
  const signal=AbortSignal.timeout(timeoutMs);
  try {
   const r=await fetchImpl(base+uri,{...options,signal});
   if(!r.ok)return {status:r.status};
   return {status:r.status,data:await r.json()};
  }catch(e){throw fail(signal.aborted?'PayPal Sandbox timed out. Retry the read when the connection recovers.':'PayPal Sandbox response unavailable. Check the connection and retry.',signal.aborted?504:502);}
 }
 async function authenticate(){
  if(token&&Date.now()<expires)return token;
  if(!pending)pending=(async()=>{
   const r=await request('/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.PAYPAL_CLIENT_ID+':'+env.PAYPAL_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
   if(!r.data?.access_token)throw fail(r.status===401?'PayPal Sandbox rejected the client credentials. Check the Sandbox app credentials and restart.':'PayPal Sandbox authentication unavailable ('+r.status+'). Retry later.');
   token=r.data.access_token;expires=Date.now()+Math.max(0,Number(r.data.expires_in||300)-60)*1000;return token;
  })().finally(()=>{pending=null;});
  return pending;
 }
 return async function paypal(uri,method='GET',payload){
  if(!env.PAYPAL_CLIENT_ID||!env.PAYPAL_CLIENT_SECRET)throw fail('Sandbox credentials are not configured',503);
  const retryable=method==='GET'||(method==='POST'&&uri==='/v1/notifications/verify-webhook-signature');
  for(let attempt=0;attempt<2;attempt++){
   const used=await authenticate();
   const r=await request(uri,{method,headers:{Authorization:'Bearer '+used,'Content-Type':'application/json'},...(payload===undefined?{}:{body:typeof payload==='string'?payload:JSON.stringify(payload)})});
   if(r.data)return r.data;
   if(r.status===401){if(token===used){token=null;expires=0;}if(!attempt&&retryable)continue;}
   const advice=r.status===404?'Resource not found. Check the ID and that it belongs to this Sandbox app.':r.status===403?'Access denied. Check this Sandbox app can read the resource.':r.status===429?'Rate limit reached. Wait before retrying.':r.status===401?'Authentication was rejected. Check Sandbox credentials and restart.':'Provider unavailable. Retry later.';
   throw fail('PayPal API returned '+r.status+'. '+advice);
  }
 };
}
