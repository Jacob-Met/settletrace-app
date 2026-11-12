export function installWebhookSetup({call,node}){
 const host=document.querySelector('#sandbox-setup .setup-content');if(!host)return;
 const section=node('section','webhook-setup-check');
 const button=node('button','outline','Check registered webhook setup');button.type='button';
 const output=node('div','quiet');output.setAttribute('role','status');output.setAttribute('aria-live','polite');
 output.textContent='Reads this Sandbox app’s webhook registrations using server-side credentials. Does not create a subscription or send an event.';
 button.onclick=async()=>{
  button.disabled=true;output.textContent='Reading this app’s webhook registrations from PayPal Sandbox…';
  try{
   const r=await call('/api/webhooks/check-setup','POST',{});
   const messages={
    no_registration:'PayPal authenticated this app, but it has no registered webhook listener. Signed deliveries cannot reach this workspace until an approved HTTPS callback is registered.',
    missing_webhook_id:'PayPal authenticated this app and found a registered listener. Set PAYPAL_WEBHOOK_ID to the intended listener’s ID and restart to verify its received deliveries.',
    webhook_id_not_found:'PayPal authenticated this app, but PAYPAL_WEBHOOK_ID does not match its registered listeners. Check that the webhook ID and client credentials belong to the same Sandbox app.',
    registered:'PayPal found the configured webhook registration for this Sandbox app.'
   };
   output.replaceChildren(node('p','',messages[r.status]||'The callback setup response was not recognized.'));
   if(r.listener)output.append(node('p','','Registered listener: '+r.listener.protocol+'//'+r.listener.host+r.listener.path+(r.listener.query_omitted?' (query omitted)':'')));
   if(r.event_types)output.append(node('p','','Subscribed events: '+(r.event_types.join(', ')||'None returned')));
   output.append(node('p','','Checked '+r.observed_at+'. This check does not establish listener reachability or verify a delivery signature.'));
  }catch(e){output.textContent='Callback setup could not be checked. '+e.message+' Existing evidence is unchanged.';}
  finally{button.disabled=false;}
 };
 section.append(button,output);host.append(section);
}
