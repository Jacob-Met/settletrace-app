// Reads registrations for this Sandbox app; it does not register or probe a listener.
export async function readWebhookSetup(paypal, configuredId){
 const response=await paypal('/v1/notifications/webhooks');
 if(!Array.isArray(response?.webhooks))throw Object.assign(Error('PayPal returned no usable webhook registration list. Retry the setup check.'),{status:502});
 const id=String(configuredId||'').trim();
 const registrations=response.webhooks.filter(w=>typeof w?.id==='string');
 const match=id?registrations.find(w=>w.id===id):null;
 let status=!registrations.length?'no_registration':!id?'missing_webhook_id':!match?'webhook_id_not_found':'registered';
 const result={status,observed_at:new Date().toISOString(),authenticated:true,registration_count:registrations.length,webhook_id_configured:!!id,listener_reachability:'not_tested',signature_verification:'not_tested'};
 if(match){
  try{const u=new URL(match.url);result.listener={protocol:u.protocol,host:u.host,path:u.pathname,query_omitted:!!u.search};}catch{result.listener=null;}
  result.event_types=Array.isArray(match.event_types)?match.event_types.map(t=>t?.name).filter(n=>typeof n==='string'&&/^[A-Z0-9.*_-]{1,100}$/.test(n)):[];
 }
 return result;
}
