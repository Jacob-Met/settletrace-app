import test from 'node:test';
import assert from 'node:assert/strict';
import {chronologicalActivity,presentTimelineRecord} from '../web/case-presentation.mjs';

test('shared event reads follow their reported read clock, not the original event time',()=>{
 const late={id:'READ-LATE',kind:'webhook',source:'imported_packet',reported_source:'sandbox_event_api',reported_provider_observed_at:'2026-11-11T14:00:00Z',occurred:'2026-11-11T10:00:00Z',type:'PAYMENT.CAPTURE.PENDING'};
 const earlier={id:'EVENT-EARLIER',kind:'webhook',source:'imported_packet',occurred:'2026-11-11T12:00:00Z',received:'2026-11-11T15:00:00Z',type:'PAYMENT.CAPTURE.COMPLETED'};
 const records=[late,earlier];assert.deepEqual(chronologicalActivity(records),[earlier,late]);assert.deepEqual(records,[late,earlier]);
 assert.equal(presentTimelineRecord(late).timeLabel,'Reported read');
});
test('unknown clocks follow known observations without inventing an import-time order',()=>{
 const unknown={id:'UNKNOWN',kind:'order_read',source:'imported_packet',observed_at:null,imported_at:'2026-11-11T09:00:00Z',captures:[]};
 const bad={...unknown,id:'BAD',observed_at:'invalid'};
 const read={...unknown,id:'READ',observed_at:'2026-11-11T12:00:00Z'};
 const same={...read,id:'SAME'};
 assert.deepEqual(chronologicalActivity([unknown,read,bad,same]).map(x=>x.id),['READ','SAME','UNKNOWN','BAD']);
});
