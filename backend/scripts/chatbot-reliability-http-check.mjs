import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Vehicle from '../models/Vehicle.js';
import Booking from '../models/Booking.js';
import { rentalVehicles } from '../tests/fixtures/chatbotRentalVehicles.js';
import { chatbotOfferConversations } from '../tests/fixtures/chatbotOfferConversations.js';
import { createChatbotProtection, chatbotProtectionConfig } from '../middleware/chatbotProtection.js';

const target = new URL(process.argv[2]);
assert.ok(['127.0.0.1','localhost'].includes(target.hostname), 'Use an isolated local classifier with a fixture service key');
process.env.CHATBOT_URL = target.origin;
process.env.CHATBOT_SERVICE_AUTOSTART = 'false';
process.env.CHATBOT_INTERNAL_API_KEY = 'fixture-only-reliability-test-key-32-characters';
const metadata = await (await fetch(`${process.env.CHATBOT_URL}/`,{headers:{'x-internal-key':process.env.CHATBOT_INTERNAL_API_KEY}})).json();
const hash = createHash('sha256').update(readFileSync(new URL('../../chatbot-service/rentifypro_chatbot_dataset_v6.json', import.meta.url))).digest('hex');
assert.equal(metadata.routing_revision,'search-relevance-limits-2026-10-12');
assert.equal(metadata.intent_count,61);
assert.equal(metadata.dataset_sha256,hash);
assert.equal(metadata.config_sha256,createHash('sha256').update(readFileSync(new URL('../../chatbot-service/chatbot_config.json',import.meta.url))).digest('hex'));
let inventory = [...rentalVehicles,{...rentalVehicles[0],_id:'000000000000000000000008',name:'Isuzu Cargo Truck',specs:{type:'truck',subType:'Cargo'},dailyRentalRate:5000}];
Vehicle.find = () => ({select:()=>({lean:async()=>inventory})});
Booking.distinct = async () => [];
const { default: chatRoutes } = await import('../routes/chat.routes.js');
const app = express(); app.use(express.json()); app.use('/api/chat',chatRoutes);
const server = app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
const records=[];
async function post(message,conversationContext=null,previousLanguage=null,language='auto'){
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,conversationContext,previousLanguage,language})});
  assert.equal(response.status,200); const result=await response.json(); records.push({message,result}); return result;
}
try {
  assert.equal((await post('Show available cars')).entities.category,'car');
  assert.equal((await post('Show trucks')).recommendations[0].name,'Isuzu Cargo Truck');
  const compound=await post('Show SUVs in Cebu and quote one for 5 days');
  assert.equal(compound.additional_answers[0].entities.location,'cebu');
  assert.equal(compound.conversation_context.intent,'rental_rate');
  assert.equal((await post('the first one',compound.conversation_context)).quote.rentalSubtotal,9000);
  assert.equal((await post('magkano rent ng vios 3 days')).quote.rentalSubtotal,7200);
  assert.match((await post('Naaksidente ako gamit ang nirentahan kong kotse.')).reply,/911/);
  assert.equal((await post('Can I shorten my rental period?')).intent,'booking_changes_guidance');
  assert.equal((await post('What if my GCash payment fails?')).intent,'payment_troubleshooting');
  let context=null;
  for(const message of ['Can I choose a specific model?','sure?','how?','What if that model is unavailable?']){
    const result=await post(message,context); assert.equal(result.intent,'choose_specific_model'); context=result.conversation_context;
  }
  assert.equal(records.at(-1).result.response_variant,'unavailable');
  context=null;
  for(const [message,intent] of [['How do I book?','how_to_book'],['and?','how_to_book'],['you okay?','chat_wellbeing'],['Anyway, what about payment?','payment_methods'],['how?','payment_methods']]){
    const result=await post(message,context); assert.equal(result.intent,intent); context=result.conversation_context;
  }
  assert.equal(records.at(-1).result.response_variant,'instructions');
  context=(await post('How do I book?')).conversation_context;
  assert.match((await post('How long does approval take?',context)).reply,/cannot promise a turnaround time/);
  assert.equal((await post('my booking status')).reason_code,'authentication_required');
  assert.equal((await post('start a new chat',context)).conversation_context,null);
  const repairChains = [
    [['How do I message the owner?','messaging','instructions','instructions'],['I asked how.','messaging','instructions_detail','instructions'],['Where do I click?','messaging','navigation','navigation']],
    [['Can I message the owner?','messaging','overview','overview'],['How?','messaging','instructions','instructions'],["What if they don't reply?",'messaging','no_reply','troubleshooting']],
    [['How do I book?','how_to_book',null,'instructions'],["That's not what I asked.",'how_to_book',null,'instructions'],['Show me the steps.','how_to_book',null,'instructions']],
    [['How can I request walk-in payment?','walk_in_payment','instructions','instructions'],['I meant how to request it.','walk_in_payment','instructions','instructions'],['What if the owner rejects it?','walk_in_payment','rejection',null]],
    [['Paano mag-message kay owner?','messaging','instructions','instructions'],['Paano nga?','messaging','instructions_detail','instructions'],['Saan ko makikita?','messaging','navigation','navigation']],
    [['How do I contact the owner?','messaging','instructions','instructions'],['Start a new conversation.','chat_greeting','reset',null],['I asked how.','REJECT',null,'instructions']],
  ];
  for(const chain of repairChains) {
    context=null;
    let previousLanguage=null;
    for(const [message,intent,variant,kind] of chain) {
      const result=await post(message,context,previousLanguage);
      assert.equal(result.intent,intent);
      assert.equal(result.response_variant??null,variant);
      assert.equal(result.requested_answer_type??null,kind);
      assert.doesNotMatch(result.reply,/Of course!|What are you looking for/);
      if(previousLanguage) assert.equal(result.language,previousLanguage);
      context=result.conversation_context;
      previousLanguage=result.language;
    }
  }
  for(const [message,intent,variant] of [['How do I browse vehicles?','available_vehicles','instructions'],['Where can I message the owner?','messaging','navigation'],["Why can't I message the owner?",'messaging','troubleshooting']]) {
    const result=await post(message);
    assert.equal(result.intent,intent); assert.equal(result.response_variant,variant);
    assert.deepEqual(result.recommendations,[]);
  }
  for(const chain of chatbotOfferConversations) {
    context=null; let previousLanguage=null;
    for(const turn of chain.turns) {
      const result=await post(turn.input,context,previousLanguage,turn.language||'auto');
      assert.equal(result.intent,turn.intent,`${chain.id}: ${turn.input}`);
      assert.equal(result.response_variant??null,turn.response_variant,`${chain.id}: ${turn.input}`);
      assert.doesNotMatch(result.reply,/Of course!|Tell me what you're trying to do|add a little more detail/);
      for(const phrase of turn.reply_contains) assert.ok(result.reply.toLowerCase().includes(phrase.toLowerCase()),`${chain.id}: ${phrase}: ${result.reply}`);
      if(turn.reply_any) assert.ok(turn.reply_any.includes(result.reply),`${chain.id}: multilingual acknowledgement`);
      if(turn.task) assert.equal(result.conversation_context.intent,turn.task);
      if(turn.offer) assert.equal(result.conversation_context.pending_offer.action,turn.offer);
      if(turn.no_offer) assert.equal(result.conversation_context?.pending_offer,undefined);
      if(turn.no_context) assert.equal(result.conversation_context,null);
      if(turn.language) assert.equal(result.language,turn.language);
      context=result.conversation_context; previousLanguage=result.language;
    }
  }
  const forgedPrivate = await post('How?',{intent:'my_unpaid_balance',entities:{},assistant_action:'instructions'});
  assert.equal(forgedPrivate.reason_code,'authentication_required');
  assert.match(forgedPrivate.reply,/sign in/i);
  assert.equal(forgedPrivate.conversation_context?.pending_offer,undefined);
  const forgedOffer = await post("What's next?",{intent:'my_unpaid_balance',entities:{},pending_offer:{intent:'my_unpaid_balance',action:'instructions',source_variant:'base'}});
  assert.equal(forgedOffer.intent,'REJECT');
  assert.match(forgedOffer.reply,/Which task/);
  assert.equal(forgedOffer.conversation_context,null);
  context=null;
  for(const message of ['Is insurance included?','okay thanks','huh?','what do you mean got it?']) {
    const result=await post(message,context);
    assert.equal(result.conversation_context.intent,'insurance_included');
    assert.doesNotMatch(result.reply,/Which part|add a little more detail/);
    if(message==='huh?') assert.equal(result.response_variant,'explanation');
    if(message.startsWith('what do')) assert.match(result.reply,/understood.*acknowledgement/);
    context=result.conversation_context;
  }
  for(const [message,category,pax,duration] of [['trucks?','truck'],['pick up trucks?','pickup'],['vans?','van'],['motorcycle?','motorcycle'],['big bike motorcycle?','motorcycle'],['is there an available 18 seater van?','van',18],['meron bang 10 seater na suv?','suv',10],['van for 18 days','van',null,18],['SUV for 10 people','suv',10]]) {
    const result=await post(message);
    assert.equal(result.intent,'available_vehicles'); assert.equal(result.entities.category,category);
    assert.equal(result.requires_clarification,false);
    if(pax) {assert.equal(result.entities.pax,pax);assert.deepEqual(result.recommendations,[]);assert.ok(result.reply.includes(String(pax)));}
    if(duration) {assert.equal(result.entities.duration_value,duration);assert.equal(result.entities.pax,undefined);}
    if(message.startsWith('big bike')) {assert.equal(result.entities.vehicle_subtype,'big bike');assert.match(result.reply,/engine size/);}
  }
  const unsupported=await post('meron ba kayong tricycle?');
  assert.equal(unsupported.response_variant,'unsupported_tricycle'); assert.match(unsupported.reply,/not.*supported|Hindi supported/);assert.deepEqual(unsupported.recommendations,[]);
  const pickup=await post('pick up my truck tomorrow');
  assert.equal(pickup.intent,'pickup_location');assert.deepEqual(pickup.recommendations,[]);assert.match(pickup.reply,/Messages/);
  inventory.push({...rentalVehicles[3],_id:'000000000000000000000018',name:'Toyota Hiace 18',specs:{type:'van',subType:'Passenger',seats:18},dailyRentalRate:3500});
  const capacity=await post('van for 18 people');
  assert.deepEqual(capacity.recommendations.map(v=>v.name),['Toyota Hiace 18']);
  let clock=Date.now();
  const protection=createChatbotProtection({enabled:true,secret:'fixture-only-rate-limit-signing-key-32-characters',now:()=>clock,
    config:{...chatbotProtectionConfig({}),burstMax:2}});
  const limitedApp=express();limitedApp.use(express.json());limitedApp.use('/api/chat',protection.concurrencyGuard,protection.limiter,chatRoutes);
  const limitedServer=limitedApp.listen(0,'127.0.0.1');await new Promise(resolve=>limitedServer.once('listening',resolve));
  try {
    const limitedPost=async(message,conversationContext=null)=>{
      const response=await fetch(`http://127.0.0.1:${limitedServer.address().port}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,conversationContext})});
      records.push({message,http_status:response.status,scenario:'rate_recovery',result:await response.clone().json()});return response;
    };
    context=(await (await limitedPost('Is insurance included?')).json()).conversation_context;
    context=(await (await limitedPost('okay thanks',context)).json()).conversation_context;
    const before=structuredClone(context);
    const rejection=await limitedPost('huh?',context);
    assert.equal(rejection.status,429);const rate=await rejection.json();assert.equal(rate.code,'CHAT_RATE_LIMITED');assert.equal(rejection.headers.get('retry-after'),'30');
    assert.equal(rate.conversation_context,undefined);assert.deepEqual(context,before);
    clock+=30000;
    const recovered=await (await limitedPost('huh?',context)).json();assert.equal(recovered.response_variant,'explanation');assert.match(recovered.reply,/insurance/);
  } finally {limitedServer.closeAllConnections();await new Promise(resolve=>limitedServer.close(resolve));}
  const path=join(tmpdir(),'rentifypro-search-relevance-http-20261012.json'); writeFileSync(path,JSON.stringify({metadata,records},null,2));
  console.log(JSON.stringify({passedRequests:records.length,failed:0,sourceHashMatched:true,intents:metadata.intent_count,routingRevision:metadata.routing_revision,evidence:path}));
  if(process.argv.includes('--serve')) {
    console.log(JSON.stringify({fixtureApiUrl:`http://127.0.0.1:${server.address().port}`}));
    await new Promise(resolve=>process.once('SIGINT',resolve));
  }
} finally {server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));}
