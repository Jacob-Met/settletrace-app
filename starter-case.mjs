// The retained facts came from one genuine PayPal Sandbox course on 2026-11-10.
// Shipping a copy does not create local provider authority: every copied row stays
// an example until this workspace performs its own explicit provider read.
export const STARTER_ORDER_ID='74K13033HV980531T';
export function starterCase(){
 const capture={id:'5M502493PE612220G',status:'COMPLETED',amount:{currency:'USD',value:'12.34'}};
 return {
  orders:[{id:STARTER_ORDER_ID,title:'Example payment',status:'COMPLETED',updated:'2026-11-10T21:14:01.000Z',units:[{amount:{currency:'USD',value:'12.34'},captures:[structuredClone(capture)]}],sample:true,starter:true}],
  events:[],
  snapshots:[
   {id:'EXAMPLE-CREATED-74K13033',order_id:STARTER_ORDER_ID,status:'CREATED',source:'authored_sample',sample:true,observed_at:'2026-11-10T21:12:33.138Z',captures:[]},
   {id:'EXAMPLE-COMPLETED-74K13033',order_id:STARTER_ORDER_ID,status:'COMPLETED',source:'authored_sample',sample:true,observed_at:'2026-11-10T21:15:46.783Z',captures:[structuredClone(capture)]}
  ],
  sources:{}
 };
}
