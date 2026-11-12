// Keep each successful response as evidence, without letting a delayed older
// request replace a later-requested successful observation.
export function retainOrderRead(state, order, observation, request) {
 const heads=state.orderReadHeads??{};
 const current=state.orders.find(x=>x.id===order.id);
 const head=heads[order.id];
 const superseded=!!(current&&head?.session===request.session&&head.sequence>request.sequence);
 const saved={...observation,requested_at:request.requested_at,...(superseded?{superseded_by:head.id}:{})};
 const selected=superseded?current:{...order,sample:false,inspected:observation.observed_at,read_id:observation.id};
 const orders=superseded?state.orders:[...state.orders.filter(x=>x.id!==order.id),selected];
 const nextHeads={...heads,...(superseded?{}:{[order.id]:{id:observation.id,session:request.session,sequence:request.sequence}})};
 const retained=new Set(orders.map(x=>x.id));
 for(const id of Object.keys(nextHeads))if(!retained.has(id))delete nextHeads[id];
 return {state:{...state,orders,orderReadHeads:nextHeads,snapshots:[...state.snapshots,saved]},order:selected,observation:saved,applied:!superseded,...(superseded?{reason:'superseded'}:{})};
}

const signature=x=>JSON.stringify([x.status,(x.captures??[]).map(c=>[c.id,c.status]).sort((a,b)=>a[0].localeCompare(b[0]))]);

export function overlappingReadFinding(order,snapshots=[]) {
 if(!order||order.imported||!order.read_id)return null;
 const selected=snapshots.find(x=>x.id===order.read_id&&x.source==='sandbox_api');
 if(!selected)return null;
 const earlier=snapshots.filter(x=>x.order_id===order.id&&x.source==='sandbox_api'&&x.superseded_by===selected.id&&signature(x)!==signature(selected));
 if(!earlier.length)return null;
 return {level:'investigate',title:'Overlapping order reads disagree',detail:'An earlier request returned after the selected newer request with different order or capture statuses. Both responses are retained. Response arrival order does not establish the current PayPal state; re-read the order to resolve the overlap.',ids:[selected.id,...earlier.map(x=>x.id)]};
}
