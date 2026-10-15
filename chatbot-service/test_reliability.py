import json
import subprocess
import unittest
from pathlib import Path

from app import classify_message, extract_query_entities, find_controlled_alias_matches, validated_conversation_context

BRIDGE = Path(__file__).parent.parent / 'backend/tests/helpers/chatbotRentalFulfill.mjs'

def final(message, context=None, language='en'):
    classified = classify_message(message, language, language, context)
    result = subprocess.run(['node', str(BRIDGE)], input=json.dumps([{'message': message, 'classifier': classified, 'previous_context': context}]),
        text=True, encoding='utf-8', capture_output=True, check=True, timeout=30)
    return json.loads(result.stdout)[0]

class ReliabilityTests(unittest.TestCase):
    def test_category_location_capacity_and_duration(self):
        for query, category in [('Show cars', 'car'), ('Show trucks', 'truck'), ('Show pickup trucks', 'pickup'),
                                ('May matic ba sa Cebu', None), ('Find motorcycles near Baguio', 'motorcycle')]:
            with self.subTest(query=query):
                result = classify_message(query)
                self.assertEqual(result['entities'].get('category'), category)
                self.assertIn(result['intent'], {'available_vehicles', 'available_transmission'})
        for query in ['walk-in payment', 'Is walk-in payment possible?', 'May discount sa SUV?', 'Pwede magrent sa van?',
                      'May available sa motor?', 'pwde cash sa balance', 'I got injured in a rental car accident']:
            self.assertNotIn('location', extract_query_entities(query), query)
        for city in ['Cebu', 'Manila', 'Davao', 'Baguio', 'Puerto Princesa']:
            self.assertEqual(extract_query_entities('May SUV sa '+city)['location'], city.lower())
        result = classify_message('7 passengers for 3 days')
        self.assertEqual(result['intent'], 'available_vehicles')
        self.assertEqual(result['entities']['pax'], 7)
        self.assertEqual(result['entities']['duration_value'], 3)
        self.assertEqual(classify_message('Show vehicles for 7 people')['intent'], 'available_vehicles')

    def test_specific_aliases_and_payment_purposes(self):
        self.assertEqual(find_controlled_alias_matches('security deposit payment')[0]['intent'], 'security_deposit')
        for query, intent in [('How can I pay my 30% using GCash?', 'payment_downpayment'),
                              ('What if my GCash payment fails?', 'payment_troubleshooting'),
                              ('May discount sa SUV?', 'advance_booking_discount'),
                              ('pwde cash sa balance', 'walk_in_payment')]:
            self.assertEqual(final(query)['intent'], intent)
        self.assertEqual(final('Is the deposit the same as the 30% down payment?')['response_variant'], 'distinction')
        self.assertTrue(classify_message('payment')['requires_clarification'])

    def test_related_compounds_share_filters_without_payment_leakage(self):
        for query in ['Show me SUVs in Cebu, and how much would one cost for five days?',
                      'Show SUVs in Cebu and quote one for 5 days']:
            result = final(query)
            price = result['additional_answers'][0]
            self.assertEqual(price['intent'], 'rental_rate')
            self.assertEqual(price['entities']['category'], 'suv')
            self.assertEqual(price['entities']['location'], 'cebu')
            self.assertEqual(price['entities']['duration_value'], 5)
            self.assertEqual([v['name'] for v in price['recommendations']], ['Ford Everest'])
            self.assertNotIn('quote', price)
            self.assertEqual(result['conversation_context']['intent'], 'rental_rate')
        result = final('Can I rent a van for 3 days and pay using GCash?')
        self.assertEqual(result['intent'], 'available_vehicles')
        self.assertEqual(result['additional_answers'][0]['response_variant'], 'gcash')
        self.assertNotIn('duration_value', result['additional_answers'][0]['entities'])
        result = final('May motor sa Manila at magkano per day?', language='taglish')
        self.assertEqual(result['additional_answers'][0]['entities']['location'], 'manila')
        self.assertEqual(result['additional_answers'][0]['entities']['category'], 'motorcycle')

    def test_independent_questions_and_distinct_purposes(self):
        result = classify_message('Is there a walk-in payment? Does the owner approve walk-in payment? Who confirms walk-in payment?')
        self.assertEqual([result['response_variant']]+[v['response_variant'] for v in result['additional_answers']], ['overview','approval','confirmation'])
        result = final('Find SUVs in Cebu; What payment methods are accepted?; How do I cancel my booking?')
        self.assertEqual([v['intent'] for v in result['additional_answers']], ['payment_methods','booking_cancellation'])
        for answer in result['additional_answers']:
            self.assertNotIn('category', answer['entities'])
            self.assertNotIn('location', answer['entities'])
        self.assertEqual(classify_message('help;help;help;help')['reason_code'], 'too_many_questions')
        result = final('Can I cancel my booking and will I get a refund?')
        self.assertEqual(result['additional_answers'][0]['intent'], 'rental_refund_guidance')
        result = final('Show automatic sedans under 3k per day and tell me the cheapest one')
        self.assertEqual(result['entities']['sort_by'], 'lowest_price')

    def test_conversations_and_social_topic_reset(self):
        context = None
        for query, intent, variant in [('Can I choose a specific car model?', 'choose_specific_model', None),
             ('sure?', 'choose_specific_model', 'confirm_policy'), ('how?', 'choose_specific_model', 'instructions'),
             ('What if the model is unavailable?', 'choose_specific_model', 'unavailable')]:
            result = final(query, context)
            self.assertEqual((result['intent'], result.get('response_variant')), (intent, variant))
            context = result['conversation_context']
        self.assertIn('alternatives', result['reply'])
        context = None
        for query, intent in [('How do I book?', 'how_to_book'), ('and?', 'how_to_book'), ('you okay?', 'chat_wellbeing'),
                             ('Anyway, what about payment?', 'payment_methods'), ('how?', 'payment_methods')]:
            result = final(query, context)
            self.assertEqual(result['intent'], intent)
            context = result['conversation_context']
        self.assertEqual(result['response_variant'], 'instructions')
        result = final('start a new chat', context)
        self.assertIsNone(result['conversation_context'])
        self.assertEqual(final('pano gawin yun', language='fil')['intent'], 'REJECT')

    def test_vehicle_filters_survive_short_followups_and_model_quote(self):
        context = None
        for query in ['Find SUVs in Cebu', 'automatic', 'under 2k per day', 'tomorrow', 'for five days']:
            result = final(query, context)
            context = result['conversation_context']
            self.assertEqual(result['entities']['location'], 'cebu')
            self.assertEqual(result['entities']['category'], 'suv')
        self.assertEqual(result['entities']['transmission'], 'automatic')
        self.assertEqual(result['entities']['max_budget'], 2000)
        self.assertEqual(result['entities']['duration_value'], 5)
        quote = final('magkano rent ng vios 3 days')
        self.assertEqual(quote['quote']['rentalSubtotal'], 7200)
        self.assertIn('Toyota Vios', quote['reply'])
        self.assertNotIn('quote', final('magkano rent ng nonexistent 3 days'))

    def test_support_intents_have_safe_multilingual_final_answers(self):
        cases = [('Our rental car crashed and someone is injured', 'rental_problem_support', 'emergency'),
          ('My rental car broke down', 'rental_problem_support', 'breakdown'),
          ('Nawala ang susi ng nirentahang sasakyan', 'rental_problem_support', 'lost_keys'),
          ('My rented car was stolen', 'rental_problem_support', 'theft'),
          ('May gasgas na ang rental bago pickup', 'rental_problem_support', 'damage'),
          ('My rented car does not match the photos', 'rental_problem_support', 'damage'),
          ('Can I move my pickup date?', 'booking_changes_guidance', None),
          ('Can I shorten my rental period?', 'booking_changes_guidance', None),
          ('Who pays parking and tolls?', 'rental_terms_guidance', None),
          ('Where can I get a rental payment receipt?', 'payment_troubleshooting', 'receipt'),
          ('My ID expired for verification', 'verification_troubleshooting', 'expired_id'),
          ('Can I submit a different ID?', 'verification_troubleshooting', 'different_id'),
          ('How can I update KYC details?', 'verification_troubleshooting', 'update'),
          ('What if the owner rejects my booking after I already paid?', 'booking_status', 'rejection')]
        for language in ['en','fil','taglish']:
            for query, intent, variant in cases:
                with self.subTest(language=language, query=query):
                    result = final(query, language=language)
                    self.assertEqual((result['intent'], result.get('response_variant')), (intent, variant))
                    self.assertFalse(result['requires_clarification'])
                    self.assertEqual(result['language'], language)
                    self.assertEqual(result['recommendations'], [])
                    self.assertNotRegex(result['reply'], r'guaranteed refund|automatically approved|free replacement')
        emergency = final(cases[0][0])
        self.assertLess(emergency['reply'].index('911'), emergency['reply'].index('Messages'))

    def test_weak_policy_followups_and_contextual_rejections(self):
        for query, intent in [('My rental car broke down', 'rental_problem_support'), ('My verification was rejected', 'verification_troubleshooting'),
             ('How do I list my vehicle?', 'owner_listing_guidance'), ('How do I approve a rental request?', 'owner_booking_guidance'),
             ('Where is the pickup location?', 'pickup_location'), ('Can I get a rental refund?', 'rental_refund_guidance')]:
            context = final(query)['conversation_context']
            result = final('pano gawin yun', context, 'fil')
            self.assertEqual(result['intent'], intent)
            self.assertIn(result.get('response_variant'), {'instructions','explanation'})
            self.assertEqual(final('what next', result['conversation_context'])['response_variant'], 'continuation')
        for initial, intent in [('How do I book?', 'booking_status'), ('Is there a walk-in payment?', 'walk_in_payment')]:
            result = final('pano pag declined ni owner', final(initial)['conversation_context'])
            self.assertEqual(result['intent'], intent)
            self.assertEqual(result['response_variant'], 'rejection')

    def test_public_context_contract_does_not_store_private_or_price_claims(self):
        base = {'intent':'available_vehicles','topic':'vehicles','entities':{'category':'car'},'choices':[]}
        self.assertEqual(validated_conversation_context(base)['entities']['category'], 'car')
        for patch in [{'bookingId':'private'}, {'quote':1}, {'listing_id':'not-an-id'}, {'duration_value':3}, {'pax': True}, {'location':'a'*81}]:
            self.assertEqual(validated_conversation_context({**base,'entities':{**base['entities'],**patch}}), {})

if __name__ == '__main__':
    unittest.main()
