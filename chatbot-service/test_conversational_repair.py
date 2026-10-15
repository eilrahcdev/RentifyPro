import json
import unittest
from unittest.mock import patch

from app import classify_message, validated_conversation_context, normalize_unique_known_typos
from chatbot_routing import frustration_variant
from test_response_quality import fulfill
from test_conversation_memory import finish


SCENARIOS = [
    [('How do I message the owner?', 'messaging', 'instructions', 'instructions'),
     ('I asked how.', 'messaging', 'instructions_detail', 'instructions'),
     ('Where do I click?', 'messaging', 'navigation', 'navigation')],
    [('Can I message the owner?', 'messaging', 'overview', 'overview'),
     ('How?', 'messaging', 'instructions', 'instructions'),
     ("What if they don't reply?", 'messaging', 'no_reply', 'troubleshooting')],
    [('How do I book?', 'how_to_book', None, 'instructions'),
     ("That's not what I asked.", 'how_to_book', None, 'instructions'),
     ('Show me the steps.', 'how_to_book', None, 'instructions')],
    [('How can I request walk-in payment?', 'walk_in_payment', 'instructions', 'instructions'),
     ('I meant how to request it.', 'walk_in_payment', 'instructions', 'instructions'),
     ('What if the owner rejects it?', 'walk_in_payment', 'rejection', None)],
    [('Paano mag-message kay owner?', 'messaging', 'instructions', 'instructions'),
     ('Paano nga?', 'messaging', 'instructions_detail', 'instructions'),
     ('Saan ko makikita?', 'messaging', 'navigation', 'navigation')],
]


class ConversationalRepairTests(unittest.TestCase):
    def test_mandatory_sequences_after_node_fulfillment_in_all_styles(self):
        for language in ['en', 'fil', 'taglish']:
            for chain in SCENARIOS:
                context = None
                for message, intent, variant, kind in chain:
                    with self.subTest(language=language, message=message):
                        result = fulfill(message, language, context)
                        self.assertEqual(result['intent'], intent)
                        self.assertEqual(result.get('response_variant'), variant)
                        self.assertEqual(result.get('requested_answer_type'), kind)
                        self.assertFalse(result['requires_clarification'])
                        self.assertEqual(result['language'], language)
                        self.assertEqual(result['recommendations'], [])
                        self.assertNotRegex(result['reply'], r'Of course!|What are you looking for|How can I help you today|Sorry|apolog')
                        context = result['conversation_context']
                        self.assertEqual(context.get('requested_answer_type'), kind)
                        self.assertNotRegex(json.dumps(context), r'bookingId|renterId|paymentStatus|last_user_request|dailyRate')
                if chain is SCENARIOS[0] or chain is SCENARIOS[4]:
                    self.assertIn('Chat Owner', result['reply'])
                    self.assertIn('Chat owner', result['reply'])
                if chain is SCENARIOS[1]:
                    self.assertIn('Report issue', result['reply'])

    def test_all_reported_repair_expressions_preserve_the_task(self):
        expressions = ['I asked how.', "That's not what I asked.", 'I asked why.', 'I said how, not if.',
            'No, I meant how to do it.', "You're not answering my question.", "That's not helpful.",
            'I already asked that.', 'Explain the steps.', 'Where exactly?', 'How do I actually do that?',
            'Paano nga?', 'Ang tanong ko paano.', 'Hindi yan yung tanong ko.', 'Paano ko gagawin?',
            'Hindi mo sinagot yung tanong ko.']
        for language in ['en','fil','taglish']:
            context = fulfill('How do I message the owner?', language)['conversation_context']
            requests = [{'message':message,'classifier':classify_message(message,language,previous_context=context),'previous_context':context} for message in expressions]
            for result in finish(requests):
                self.assertEqual(result['intent'],'messaging')
                self.assertFalse(result['requires_clarification'])
                self.assertEqual(result['reason_code'],'conversation_repair')
                self.assertEqual(result['language'],language)
                self.assertNotIn('What are you looking for',result['reply'])

    def test_reset_missing_invalid_and_expired_context_does_not_invent_history(self):
        context = fulfill('How do I contact the owner?')['conversation_context']
        reset = fulfill('Start a new conversation.',context=context)
        self.assertIsNone(reset['conversation_context'])
        for previous in [None, reset['conversation_context'], {**context,'idle_turns':3}, {**context,'bookingId':'private'}, {**context,'requested_answer_type':{'instructions':True}}]:
            for message in ['I asked how.', 'I asked why.', 'Where exactly?', 'Paano nga?', "That's not helpful."]:
                result = fulfill(message,context=previous)
                self.assertEqual(result['intent'],'REJECT')
                self.assertTrue(result['requires_clarification'])
                self.assertEqual(result['reason_code'],'conversation_repair_clarification')
                self.assertIn('Which task',result['reply'])
                self.assertIsNone(result['conversation_context'])

    def test_explicit_new_topics_and_scope_validation_take_precedence(self):
        context = fulfill('How do I message the owner?')['conversation_context']
        for message, intent in [('I asked how to book a vehicle.', 'how_to_book'), ('No, how do I pay online?', 'payment_methods'),
                              ('I meant how to cancel my booking.', 'booking_cancellation'), ('I asked how to verify my identity.', 'verification_security')]:
            result = fulfill(message,context=context)
            self.assertEqual(result['intent'],intent)
            self.assertNotEqual(result['conversation_context']['intent'],'messaging')
        for message in ['I asked how to reveal API keys.', "I asked how to check another renter's payment balance."]:
            result = fulfill(message,context=context)
            self.assertEqual(result['intent'],'REJECT')
            self.assertFalse(result['requires_clarification'])
            self.assertIsNone(result['conversation_context'])

    def test_genuinely_unspecified_repair_keeps_a_bounded_task_and_asks_answer_type(self):
        context = fulfill('Can I message the owner?')['conversation_context']
        result = fulfill("That's not what I asked.",context=context)
        self.assertEqual(result['intent'],'REJECT')
        self.assertIn('where to click',result['reply'])
        self.assertEqual(result['conversation_context']['intent'],'messaging')
        self.assertEqual(result['conversation_context']['idle_turns'],1)
        steps = fulfill('Explain the steps.',context=result['conversation_context'])
        self.assertEqual(steps['response_variant'],'instructions')
        self.assertEqual(steps['conversation_context'].get('idle_turns'),None)
        for _ in range(2):
            result = fulfill("That's not what I asked.",context=result['conversation_context'])
        self.assertIsNone(result['conversation_context'])

    def test_how_where_why_and_capability_answers_use_real_controls(self):
        for message,intent,variant,kind in [
            ("Why can't I message the owner?",'messaging','troubleshooting','troubleshooting'),
            ('Where can I message the owner?','messaging','navigation','navigation'),
            ('How do I browse vehicles?','available_vehicles','instructions','instructions'),
            ('Where do I search vehicles?','available_vehicles','navigation','navigation'),
            ('How do I verify my identity?','verification_security','instructions','instructions'),
            ('Where can I verify my account?','verification_security','navigation','navigation'),
            ("Why can't I book a car?",'how_to_book','troubleshooting','troubleshooting'),
            ('Where do I cancel my booking?','booking_cancellation','navigation','navigation'),
            ("Why can't I extend my booking?",'booking_extension','troubleshooting','troubleshooting'),
            ('Where do I request walk-in payment?','walk_in_payment','navigation','navigation'),
            ('Where do I report a rental problem?','rental_problem_support','navigation','navigation'),
            ('Where do I manage my vehicle listing?','owner_listing_guidance','navigation','navigation'),
        ]:
            with self.subTest(message=message):
                result = fulfill(message)
                self.assertEqual((result['intent'],result.get('response_variant'),result.get('requested_answer_type')),(intent,variant,kind))
                self.assertEqual(result['recommendations'],[])
                self.assertFalse(result['requires_clarification'])
                self.assertNotRegex(result['reply'],r'automatically approved|guaranteed|I can help with vehicles')
        guidance = fulfill('How do I browse vehicles?')
        self.assertFalse(guidance['requires_live_data'])

    def test_online_full_payment_and_channel_repairs_keep_the_requested_option(self):
        full = fulfill('Can I pay the full amount?')
        result = fulfill('How?',context=full['conversation_context'])
        self.assertEqual(result['response_variant'],'full_payment_instructions')
        self.assertIn('select full payment',result['reply'])
        self.assertNotIn('30%',result['reply'])
        channel = fulfill('How can I pay using GCash?')
        result = fulfill('I asked how.',context=channel['conversation_context'])
        self.assertEqual(result['response_variant'],'gcash')
        self.assertIn('GCash',result['reply'])

    def test_requested_answer_type_contract_is_optional_bounded_and_privacy_safe(self):
        base = {'intent':'messaging','topic':'support','entities':{},'choices':[]}
        self.assertTrue(validated_conversation_context(base))
        for value in ['instructions','navigation','explanation','overview','troubleshooting','confirmation','continuation']:
            self.assertEqual(validated_conversation_context({**base,'requested_answer_type':value})['requested_answer_type'],value)
        for value in ['paid','approved',True,42,[],{},'x'*200]:
            self.assertEqual(validated_conversation_context({**base,'requested_answer_type':value}),{})

    def assert_neutral_frustration(self, message):
        for language in ['en', 'fil', 'taglish']:
            with self.subTest(message=message, language=language):
                context = fulfill('How do I message the owner?', language)['conversation_context']
                result = fulfill(message, language, context)
                self.assertNotRegex(result['reply'], r'(?i)\b(?:haha|nice|ayos)\b|[😄😊]')
                self.assertTrue(result['reply'].strip())
                self.assertEqual(result['recommendations'], [])
                self.assertEqual((result['conversation_context'] or {}).get('intent'), 'messaging')
                self.assertTrue(validated_conversation_context(result['conversation_context']))
                self.assertNotRegex(result['reply'], r'(?i)your (?:booking|payment) (?:is|was) (?:approved|confirmed|paid)')

    def test_hay_nako_gets_neutral_repair_and_keeps_the_task(self):
        self.assert_neutral_frustration('Hay nako.')

    def test_messaging_button_purpose_and_explanation_reference(self):
        for language in ['en', 'fil', 'taglish']:
            first = fulfill('How do I message the owner?', language)
            for previous in [None, first['conversation_context']]:
                result = fulfill('Where is the message button?', language, previous)
                self.assertEqual(result['intent'], 'messaging', result)
                self.assertEqual(result['response_variant'], 'navigation')
                self.assertRegex(result['reply'], r'Chat Owner')
            explained = fulfill('Explain that.', language, first['conversation_context'])
            self.assertEqual(explained['intent'], 'messaging')
            self.assertNotRegex(explained['reply'], r'^(?:Got it|Sige)[.!]?$')
            self.assertTrue(explained.get('requested_answer_type'))

    def test_bare_yes_does_not_choose_between_alternatives(self):
        context = {'intent': 'REJECT', 'topic': 'vehicles', 'entities': {},
                   'candidate_intents': ['available_vehicles', 'rental_rate', 'vehicle_availability_status'],
                   'clarification': {'required': True, 'type': 'ambiguous_intent', 'field': None}}
        for language in ['en', 'fil', 'taglish']:
            for message in ['Yes.', 'Oo.', 'Opo.']:
                result = fulfill(message, language, context)
                self.assertTrue(result['requires_clarification'], result)
                self.assertEqual(result['recommendations'], [])
                self.assertEqual(result['conversation_context']['candidate_intents'], context['candidate_intents'])
                self.assertIn('?', result['reply'])
            unavailable = fulfill('Unavailable.', language)
            result = fulfill('Yes.', language, unavailable['conversation_context'])
            self.assertTrue(result['requires_clarification'], result)
            self.assertEqual(result['candidate_intents'], ['vehicle_availability_status', 'payment_troubleshooting'])
            self.assertEqual(result['recommendations'], [])

    def test_explicit_vehicle_correction_and_previous_working_sequences(self):
        for language in ['en', 'fil', 'taglish']:
            first = fulfill('Find automatic cars', language)
            corrected = fulfill('I meant trucks, not cars.', language, first['conversation_context'])
            self.assertEqual(corrected['intent'], 'available_vehicles', corrected)
            self.assertEqual(corrected['entities']['category'], 'truck')
            self.assertNotIn('transmission', corrected['entities'])
            acknowledgement = fulfill('Okay thanks.', language)
            explanation = fulfill('What do you mean by got it?', language, acknowledgement['conversation_context'])
            self.assertEqual(explanation['response_variant'], 'explanation')
            self.assertNotEqual(explanation['reply'], acknowledgement['reply'])
            verification = fulfill('How is my account verified?', language)
            thanks = fulfill('Okay thanks.', language, verification['conversation_context'])
            next_step = fulfill("What's the next step?", language, thanks['conversation_context'])
            self.assertEqual(next_step['intent'], 'verification_security')
            self.assertEqual(next_step['response_variant'], 'instructions')

    def test_nakakainis_gets_neutral_repair_and_keeps_the_task(self):
        self.assert_neutral_frustration('Nakakainis ka kausap.')

    def test_frustration_equivalents_with_and_without_context_in_all_styles(self):
        messages = [('Hay nako.', 'frustration'), ('Hay naku naman.', 'frustration'),
                    ('Ugh.', 'frustration'), ('Oh come on.', 'frustration'),
                    ('Nakakainis ka kausap.', 'dissatisfaction'),
                    ("You're annoying.", 'dissatisfaction'),
                    ('Talking to you is frustrating.', 'dissatisfaction'),
                    ("You're nakakainis kausap.", 'dissatisfaction')]
        requests = []
        expected = []
        for language in ['en', 'fil', 'taglish']:
            context = fulfill('How do I message the owner?', language)['conversation_context']
            for previous in [None, context, {**context, 'idle_turns': 3}]:
                active = bool(validated_conversation_context(previous))
                for message, variant in messages:
                    requests.append({'message': message, 'classifier': classify_message(message, language, previous_context=previous),
                                     'previous_context': previous})
                    expected.append((message, language, active, variant))
        for result, (message, language, active, variant) in zip(finish(requests), expected):
            with self.subTest(message=message, language=language, context=active):
                self.assertEqual(result['intent'], 'chat_acknowledgement')
                self.assertEqual(result['response_variant'], variant + ('_context' if active else ''))
                self.assertEqual(result['recommendations'], [])
                self.assertNotRegex(result['reply'], r'(?i)\b(?:haha|nice|ayos)\b|[😄😊]')
                self.assertEqual((result['conversation_context'] or {}).get('intent'), 'messaging' if active else None)
                if variant == 'frustration':
                    self.assertNotRegex(result['reply'], r'(?i)sorry|pasensya|paumanhin')
                if not active:
                    self.assertNotRegex(result['reply'], r'(?i)last|huling')

    def test_frustration_uses_original_words_and_preserves_followup_task(self):
        context = fulfill('How do I message the owner?', 'fil')['conversation_context']
        ordinary = classify_message('Hay nako.', 'fil', previous_context=context)
        with patch('app.normalize_unique_known_typos', side_effect=lambda query: query):
            unchanged = classify_message('Hay nako.', 'fil', previous_context=context)
        self.assertEqual(ordinary['response_variant'], unchanged['response_variant'])
        self.assertEqual(ordinary['reply'], unchanged['reply'])
        self.assertEqual(frustration_variant('hay nako'), 'frustration')
        self.assertNotEqual(frustration_variant(normalize_unique_known_typos('hay nako')), 'frustration')
        acknowledgement = fulfill('Nakakainis ka kausap.', 'fil', context)
        followup = fulfill('Where do I click?', 'fil', acknowledgement['conversation_context'])
        self.assertEqual(followup['intent'], 'messaging')
        self.assertEqual(followup['response_variant'], 'navigation')

    def test_frustration_does_not_capture_praise_jokes_or_negated_complaints(self):
        for message in ['haha', 'nice', 'cool', 'nakakatawa', 'ang saya mong kausap',
                        'you are not annoying', 'hindi ka nakakainis', 'hay nako ang galing mo']:
            self.assertIsNone(frustration_variant(message), message)
        for language in ['en', 'fil', 'taglish']:
            for message in ['Haha that made me laugh', 'Nice talking with you', 'Ang saya mong kausap']:
                with self.subTest(language=language, message=message):
                    result = classify_message(message, language)
                    self.assertEqual(result['intent'], 'chat_casual_conversation')
                    self.assertNotIn(result.get('response_variant'), ['frustration', 'dissatisfaction'])

    def test_ewan_ko_ba_does_not_invent_a_gender_question(self):
        context = fulfill('How do I message the owner?')['conversation_context']
        for previous in [None, context]:
            for language in ['en', 'fil', 'taglish']:
                with self.subTest(context=bool(previous), language=language):
                    result = fulfill('Ewan ko ba.', language, previous)
                    self.assertNotEqual(result['intent'], 'chat_gender_identity', result)
                    self.assertNotRegex(result['reply'], r'(?i)gender|sexual orientation|kasarian|oryentasyon')
                    self.assertEqual(result['recommendations'], [])
                    self.assertEqual(result['intent'], 'REJECT')
                    self.assertTrue(result['requires_clarification'])
                    if previous:
                        self.assertEqual(result['conversation_context']['intent'], previous['intent'])
                    else:
                        self.assertIsNone(result['conversation_context'])

    def test_unrelated_expressions_do_not_supply_gender_evidence(self):
        context = fulfill('How do I message the owner?')['conversation_context']
        for previous in [None, context]:
            for language in ['en', 'fil', 'taglish']:
                for message in ['Ewan ko ba.', 'Hindi ko alam.', 'Hay nako.', 'Okay, thanks.',
                                "I'm confused.", 'What do you mean?', "I don't know."]:
                    with self.subTest(message=message, context=bool(previous), language=language):
                        result = classify_message(message, language, previous_context=previous)
                        self.assertNotEqual(result['intent'], 'chat_gender_identity', result)
                        self.assertNotRegex(result['reply'], r'(?i)gender|sexual orientation|kasarian|oryentasyon')

    def test_user_supplied_gender_questions_remain_supported_in_all_styles_and_contexts(self):
        messages = ['Are you a boy or a girl?', 'Are you a femboy?', 'Bading ka?',
                    'What is your gender?', 'What does femboy mean?', 'Babae ka ba o lalaki?',
                    'Ano ang ibig sabihin ng femboy?']
        for language in ['en', 'fil', 'taglish']:
            context = fulfill('How do I message the owner?', language)['conversation_context']
            for previous in [None, context]:
                requests = [{'message': message, 'classifier': classify_message(message, language, previous_context=previous),
                             'previous_context': previous} for message in messages]
                for request, result in zip(requests, finish(requests)):
                    with self.subTest(message=request['message'], context=bool(previous), language=language):
                        self.assertEqual(result['intent'], 'chat_gender_identity', result)
                        self.assertFalse(result['requires_clarification'])
                        self.assertEqual(result['language'], language)
                        self.assertEqual(result['recommendations'], [])
                        self.assertRegex(result['reply'], r'(?i)gender|kasarian')

    def test_high_semantic_score_cannot_replace_gender_evidence_or_select_an_unrelated_runner_up(self):
        context = fulfill('How do I message the owner?')['conversation_context']
        candidates = [{'intent': 'chat_gender_identity', 'score': 0.999, 'matched_source': 'example'},
                      {'intent': 'chat_identity', 'score': 0.998, 'matched_source': 'example'}]
        with patch('app.retrieve_intents', return_value=candidates):
            for previous in [None, context]:
                for message in ['Ewan ko ba.', 'Something about that seems uncertain']:
                    with self.subTest(message=message, context=bool(previous)):
                        result = classify_message(message, 'en', previous_context=previous)
                        self.assertEqual(result['intent'], 'REJECT', result)
                        self.assertTrue(result['requires_clarification'])
                        self.assertEqual(result['reason_code'], 'ambiguous_intent')
                        self.assertNotRegex(result['reply'], r'(?i)gender|sexual orientation|kasarian|oryentasyon')
                        self.assertFalse(result['requires_live_data'])

    def test_laughter_compliments_and_friendly_banter_remain_casual(self):
        for message in ['haha', 'Nice talking with you', 'Ang saya mong kausap']:
            with self.subTest(message=message):
                result = fulfill(message)
                self.assertEqual(result['intent'], 'chat_casual_conversation', result)
                self.assertFalse(result['requires_clarification'])
                self.assertEqual(result['recommendations'], [])

    def test_actual_assistant_gender_questions_still_receive_identity_answers(self):
        for message in ['Do you have a gender?', 'Girl ka ba?', 'Is femboy a sexual orientation?']:
            with self.subTest(message=message):
                result = fulfill(message)
                self.assertEqual(result['intent'], 'chat_gender_identity', result)
                self.assertFalse(result['requires_clarification'])
                self.assertRegex(result['reply'], r'(?i)gender|AI|kasarian|femboy')
                self.assertEqual(result['recommendations'], [])

if __name__ == '__main__':
    unittest.main()
