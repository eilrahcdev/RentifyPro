import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChatbotGuardrails, buildChatbotPayload, normalizeChatbotResponse, normalizeChatbotConversationContext } from '../utils/chatbotPayload.js';
import { getChatbotScheduleRange } from '../utils/chatbotRentalQuote.js';
import { rentalVehicles } from './fixtures/chatbotRentalVehicles.js';

const fulfill = (entities, vehicles, intent = 'available_vehicles') => applyChatbotGuardrails(
  { intent, confidence: 0.99, language: 'en', entities }, buildChatbotPayload('vehicle search', 'en', vehicles, entities));

test('broad car and truck filters cover real subtypes while exact subtype filters stay narrow', () => {
  const rows = [
    ['car','Sedan'],['car','SUV'],['car','Hatchback'],['car','Luxury'],
    ['truck','Pick-up'],['truck','Cargo'],['truck','Refrigerated'],['truck','Flatbed'],
    ['van','Cargo'],['motorcycle','Scooter'],['motorcycle','Sports Bike'],['van','SUV'],
  ].map(([type, subType], index) => ({ ...rentalVehicles[0], _id: String(index + 10).padStart(24,'0'),
    name: `Listing ${index}`, dailyRentalRate: 1000+index, specs: { type, subType } }));
  assert.equal(buildChatbotPayload('cars','en',rows,{category:'car'}).vehicles.length, 4);
  assert.equal(buildChatbotPayload('trucks','en',rows,{category:'truck'}).vehicles.length, 4);
  assert.equal(buildChatbotPayload('SUV','en',rows,{category:'suv'}).vehicles.length, 1);
  assert.equal(buildChatbotPayload('pickup','en',rows,{category:'pickup'}).vehicles.length, 1);
  assert.equal(buildChatbotPayload('vans','en',rows,{category:'van'}).vehicles.length, 1);
  assert.equal(buildChatbotPayload('motorcycles','en',rows,{category:'motorcycle'}).vehicles.length, 2);
  assert.equal(buildChatbotPayload('cars','en',rentalVehicles,{category:'car'}).vehicles.length, 3);
  assert.equal(fulfill({category:'truck'}, rows).recommendations.length,3);
});

test('unknown, private, malformed and oversized classifier fields fail closed', () => {
  const valid = { intent:'available_vehicles', confidence:0.99, language:'en', entities:{category:'car'} };
  for (const patch of [{ privateBooking:{} }, { quote:{rentalSubtotal:1} }, { requires_live_data:'false' }, {language:'Spanish'}, {language:{}},
    { reply:'x'.repeat(4001) }, { alternatives:new Array(4).fill({intent:'rental_rate',confidence:0.8}) },
    { response_variant:'auto_approved' }, { entities:{category:'car', bookingId:'private'} }]) {
    assert.equal(normalizeChatbotResponse({...valid,...patch}).valid,false);
    assert.equal(applyChatbotGuardrails({...valid,...patch},buildChatbotPayload('cars','en',rentalVehicles)).reason_code,'malformed_classifier');
  }
  assert.ok(normalizeChatbotResponse(valid).valid);
  for (const [language,expected] of [['english','en'],['filipino','fil'],['taglish','taglish']]) {
    assert.equal(normalizeChatbotResponse({...valid,language}).language,expected);
  }
  assert.ok(normalizeChatbotConversationContext({intent:'available_vehicles',topic:'vehicles',entities:{category:'truck'},choices:[]}));
});

test('a model without an invented manufacturer quotes only a uniquely matching live listing', () => {
  const entities = {model:'vios',duration_value:3,duration_unit:'day'};
  assert.equal(fulfill(entities,rentalVehicles,'rental_rate').quote.rentalSubtotal,7200);
  assert.equal(fulfill(entities,[...rentalVehicles,{...rentalVehicles[0],_id:'a'.repeat(24)}],'rental_rate').clarification.field,'model');
  assert.equal(fulfill(entities,[],'rental_rate').quote,undefined);
});

test('complete schedules use Manila time and shared duration validation before database overlap lookup', () => {
  const entities = {requested_date:'2026-10-15', requested_return_date:'2026-10-16',pickup_time:'09:00',return_time:'10:30'};
  const range = getChatbotScheduleRange(entities);
  assert.equal(range.pickupAt.toISOString(),'2026-10-15T01:00:00.000Z');
  assert.equal(range.returnAt.toISOString(),'2026-10-16T02:30:00.000Z');
  for (const patch of [{return_time:undefined},{requested_return_date:'2026-10-14'}, {duration_value:3,duration_unit:'day'}, {pickup_time:'99:00'}]) {
    assert.equal(getChatbotScheduleRange({...entities,...patch}),null);
  }
});

test('emergency variants stay canonical and never produce recommendations or invented liability', () => {
  for (const language of ['en','fil','taglish']) {
    const response = applyChatbotGuardrails({intent:'rental_problem_support',response_variant:'emergency',confidence:0.99,language,
      reply:'Your insurance will cover this.',entities:{category:'car'}},buildChatbotPayload('accident',language,rentalVehicles));
    assert.match(response.reply,/911/);
    assert.deepEqual(response.recommendations,[]);
    assert.doesNotMatch(response.reply,/Your insurance will cover this/);
  }
});
