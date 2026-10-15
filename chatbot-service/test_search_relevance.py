import json
import re
import subprocess
import unittest

from app import classify_message, validated_conversation_context
from test_response_quality import ROOT, fulfill
from test_conversation_memory import finish


class SearchRelevanceTests(unittest.TestCase):
    def test_reported_insurance_confusion_preserves_facts_and_explains_acknowledgement(self):
        for language in ["en", "fil", "taglish"]:
            context = None
            answers = []
            for message in ["Is insurance included?", "okay thanks", "huh?", "what do you mean got it?"]:
                answer = fulfill(message, language, context)
                answers.append(answer)
                context = answer["conversation_context"]
                self.assertEqual(context["intent"], "insurance_included", answer)
                self.assertTrue(validated_conversation_context(context))
                self.assertNotRegex(answer["reply"], r"Which part|add a little more detail|Of course!")
            self.assertEqual(answers[2].get("response_variant"), "explanation")
            self.assertIn("insurance", answers[2]["reply"].lower())
            self.assertIn("owner", answers[2]["reply"])
            self.assertEqual(answers[3]["intent"], "chat_acknowledgement")
            self.assertEqual(answers[3]["response_variant"], "explanation")
            self.assertNotEqual(answers[3]["reply"], answers[1]["reply"])
            self.assertRegex(answers[3]["reply"], r"understood|naintindihan")
            self.assertIn("insurance", answers[3]["reply"].lower())

    def test_exact_category_capacity_subtype_and_duration_inputs(self):
        cases = [
            ("trucks?", "available_vehicles", {"category": "truck"}),
            ("pick up trucks?", "available_vehicles", {"category": "pickup"}),
            ("vans?", "available_vehicles", {"category": "van"}),
            ("motorcycle?", "available_vehicles", {"category": "motorcycle"}),
            ("big bike motorcycle?", "available_vehicles", {"category": "motorcycle", "vehicle_subtype": "big bike"}),
            ("is there an available 18 seater van?", "available_vehicles", {"category": "van", "pax": 18}),
            ("meron bang 10 seater na suv?", "available_vehicles", {"category": "suv", "pax": 10}),
            ("meron ba kayong tricycle?", "vehicle_categories", {}),
            ("van for 18 days", "available_vehicles", {"category": "van", "duration_value": 18, "duration_unit": "day"}),
            ("SUV for 10 people", "available_vehicles", {"category": "suv", "pax": 10}),
            ("pick up my truck tomorrow", "pickup_location", {"category": "truck"}),
        ]
        for message, intent, entities in cases:
            with self.subTest(message=message):
                result = fulfill(message)
                self.assertEqual(result["intent"], intent, result)
                self.assertFalse(result["requires_clarification"], result)
                self.assertNotRegex(result["reply"], r"Are you looking for vehicles|add a little more detail|Of course!")
                for key, value in entities.items():
                    self.assertEqual(result["entities"].get(key), value, result)
                self.assertNotIn("pax" if "days" in message else "duration_value", result["entities"])
                if intent == "available_vehicles":
                    self.assertEqual(result["conversation_context"]["intent"], intent)
                    for vehicle in result["recommendations"]:
                        self.assertGreaterEqual(vehicle["seats"], entities.get("pax", 1))
                        self.assertEqual(vehicle["type"], entities["category"])
                if "tricycle" in message:
                    self.assertEqual(result["response_variant"], "unsupported_tricycle")
                    self.assertIn("Tricycle", result["reply"])
                    self.assertFalse(result["recommendations"])
                if "18 seater" in message or "10 " in message:
                    self.assertFalse(result["recommendations"], result)
                    self.assertRegex(result["reply"], r"18-seat|10-seat")
                if message.startswith("pick up my"):
                    self.assertIn("Messages", result["reply"])
                    self.assertFalse(result["recommendations"])

    def test_live_fixture_filters_are_strict_and_subtype_is_a_label_not_engine_size(self):
        vehicles = [
            {"_id": "000000000000000000000081", "name": "Toyota Hiace 18", "dailyRentalRate": 3000,
             "pricingUnit": "daily", "availabilityStatus": "available", "specs": {"type": "van", "subType": "Passenger", "seats": 18}},
            {"_id": "000000000000000000000082", "name": "Toyota Hiace 12", "dailyRentalRate": 1500,
             "pricingUnit": "daily", "availabilityStatus": "available", "specs": {"type": "van", "subType": "Passenger", "seats": 12}},
            {"_id": "000000000000000000000083", "name": "Yamaha MT09", "dailyRentalRate": 3000,
             "pricingUnit": "daily", "availabilityStatus": "available", "specs": {"type": "motorcycle", "subType": "Big Bike", "seats": 2}},
            {"_id": "000000000000000000000084", "name": "Honda Scooter", "dailyRentalRate": 500,
             "pricingUnit": "daily", "availabilityStatus": "available", "specs": {"type": "motorcycle", "subType": "Scooter", "seats": 2}},
        ]
        for language in ["en", "fil", "taglish"]:
            requests = [{"message": message, "classifier": classify_message(message, language), "vehicles": vehicles}
                        for message in ["18-seater van", "van for 18 people", "big bike motorcycle", "10-seat SUV", "SUV rental for 10 days"]]
            responses = finish(requests)
            for index in [0, 1]:
                self.assertEqual([v["name"] for v in responses[index]["recommendations"]], ["Toyota Hiace 18"])
                self.assertEqual(responses[index]["entities"]["pax"], 18)
            self.assertEqual([v["name"] for v in responses[2]["recommendations"]], ["Yamaha MT09"])
            self.assertIn("engine size", responses[2]["reply"])
            self.assertEqual(responses[2]["conversation_context"]["entities"]["vehicle_subtype"], "big bike")
            self.assertFalse(responses[3]["recommendations"])
            self.assertEqual(responses[3]["entities"]["category"], "suv")
            self.assertNotIn("pax", responses[4]["entities"])
            self.assertEqual(responses[4]["entities"]["duration_value"], 10)

    def test_subtype_state_new_topics_and_explanation_without_claimed_history(self):
        context = fulfill("big bike motorcycle")["conversation_context"]
        next_task = fulfill("vans?", context=context)
        self.assertEqual(next_task["entities"]["category"], "van")
        self.assertNotIn("vehicle_subtype", next_task["entities"])
        self.assertNotRegex(next_task["reply"], r"big bike|all.*categories")
        for subtype in ["tricycle", [], {}, "x" * 200]:
            self.assertEqual(validated_conversation_context({"intent": "available_vehicles", "entities": {
                "category": "motorcycle", "vehicle_subtype": subtype}}), {})
        quoted = fulfill("what does got it mean?")
        self.assertEqual(quoted["response_variant"], "explanation")
        self.assertRegex(quoted["reply"], r"understood")
        self.assertIsNone(quoted["conversation_context"])
        capacity = fulfill("will eight people fit in the van")
        self.assertEqual(capacity["intent"], "passenger_capacity")
        self.assertEqual(capacity["entities"]["pax"], 8)


class ReportedSearchRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture = subprocess.run(['node', '--input-type=module', '-e',
            'import { rentalVehicles } from "./backend/tests/fixtures/chatbotRentalVehicles.js";'
            'process.stdout.write(JSON.stringify(rentalVehicles));'],
            cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True, timeout=30)
        cls.vehicles = json.loads(fixture.stdout)
        cls.vehicles += [
            {**cls.vehicles[0], '_id': '000000000000000000000101', 'name': 'Isuzu FSR',
             'specs': {'type': 'truck', 'subType': 'Dump Truck', 'transmission': 'Manual', 'seats': 3}},
            {**cls.vehicles[0], '_id': '000000000000000000000102', 'name': 'Ford Ranger Raptor',
             'specs': {'type': 'truck', 'subType': 'Pick Up', 'transmission': 'Automatic', 'seats': 5}},
        ]
        cls.no_manual_cars = [
            {**vehicle, 'specs': {**vehicle['specs'], 'transmission': 'Automatic'}}
            if vehicle['specs']['type'] in ['sedan', 'suv', 'car'] else vehicle
            for vehicle in cls.vehicles
        ]

    def turn(self, message, context=None, vehicles=None, language='en'):
        classifier = classify_message(message, language, previous_context=context)
        return finish([{'message': message, 'classifier': classifier, 'previous_context': context,
                        'vehicles': self.vehicles if vehicles is None else vehicles}])[0]

    def assert_one_search(self, result, category, expected_names):
        self.assertEqual(result['intent'], 'available_vehicles', result)
        self.assertEqual(result['entities'].get('category'), category, result)
        self.assertFalse(result['requires_clarification'], result)
        self.assertEqual(result['additional_answers'], [], result)
        self.assertEqual({vehicle['name'] for vehicle in result['recommendations']}, set(expected_names), result)
        self.assertTrue(re.search(rf'\b{len(expected_names)}\s+(?:currently\s+)?available\b', result['reply'], re.I)
                        or all(name in result['reply'] for name in expected_names), result['reply'])
        self.assertNotRegex(result['reply'], r'(?i)\b(?:haha|nice)\b|😄')

    def test_dependent_filipino_motorcycle_question_is_one_live_search(self):
        self.assert_one_search(self.turn('Eh motorsiklo? Meron kayo?'),
                               'motorcycle', ['Honda Click', 'Yamaha Mio'])

    def test_dependent_english_motorcycle_question_is_one_live_search(self):
        self.assert_one_search(self.turn('What about motorcycles? Do you have any?'),
                               'motorcycle', ['Honda Click', 'Yamaha Mio'])

    def test_dependent_truck_question_is_one_live_search(self):
        self.assert_one_search(self.turn('Eh trucks? Meron kayo?'),
                               'truck', ['Isuzu FSR', 'Ford Ranger Raptor'])

    def test_direct_van_question_remains_a_live_search(self):
        self.assert_one_search(self.turn('May van ba kayo?'), 'van', ['Toyota Hiace'])

    def test_explicit_truck_topic_change_drops_the_old_car_filter_without_duplicate_answers(self):
        first = self.turn('Do you have manual transmission cars?', vehicles=self.no_manual_cars)
        self.assertEqual(first['recommendations'], [])
        self.assertEqual(first['entities']['category'], 'car')
        self.assertEqual(first['entities']['transmission'], 'manual')
        context = first['conversation_context']
        for message in ['How about trucks? May truck ba kayong pinaparenta?',
                        'Tinatanong ko kung meron ba kayong truck na pinaparenta?']:
            result = self.turn(message, context, self.no_manual_cars)
            context = result['conversation_context']
            with self.subTest(message=message):
                self.assertNotIn('transmission', result['entities'], result)
                self.assert_one_search(result, 'truck', ['Isuzu FSR', 'Ford Ranger Raptor'])

    def test_explicit_manual_truck_request_still_respects_its_new_filter(self):
        context = self.turn('Do you have manual transmission cars?', vehicles=self.no_manual_cars)['conversation_context']
        result = self.turn('Show manual trucks available for rent', context, self.no_manual_cars)
        self.assertEqual(result['intent'], 'available_transmission', result)
        self.assertEqual(result['entities']['category'], 'truck')
        self.assertFalse(result['requires_clarification'], result)
        self.assertEqual(result['additional_answers'], [])
        self.assertEqual([vehicle['name'] for vehicle in result['recommendations']], ['Isuzu FSR'])
        self.assertEqual(result['entities']['transmission'], 'manual')

    def test_no_match_followups_explain_verified_filters_instead_of_repeating_the_answer(self):
        first = self.turn('Do you have manual transmission cars?', vehicles=self.no_manual_cars)
        self.assertEqual(first['recommendations'], [])
        context = first['conversation_context']
        previous_reply = first['reply']
        for message in ['Huh?', "Why couldn't you find any?"]:
            result = self.turn(message, context, self.no_manual_cars)
            context = result['conversation_context']
            with self.subTest(message=message):
                self.assertEqual(result['intent'], 'available_transmission', result)
                self.assertEqual(result['entities'].get('category'), 'car')
                self.assertEqual(result['entities'].get('transmission'), 'manual')
                self.assertEqual(result['recommendations'], [])
                self.assertFalse(result['requires_clarification'], result)
                self.assertNotEqual(result['reply'], previous_reply)
                self.assertRegex(result['reply'], r'(?i)manual')
                self.assertRegex(result['reply'], r'(?i)cars?|vehicles?')
                self.assertNotRegex(result['reply'], r'(?i)rephrase|could not understand|add a little more detail')
                self.assertTrue(validated_conversation_context(context))
            previous_reply = result['reply']

    def test_current_python_contract_reaches_current_node_fulfillment(self):
        messages = ['Show available cars', 'Show available trucks',
                    'Find the cheapest motorcycle in Cebu for three days',
                    'Quote Toyota Vios for four days',
                    'How can I move my pickup date after approval?',
                    'Is there a mileage limit for my rental?']
        requests = [{'message': message, 'classifier': classify_message(message, 'en'),
                     'vehicles': self.vehicles} for message in messages]
        for request, result in zip(requests, finish(requests)):
            with self.subTest(message=request['message']):
                self.assertTrue(result['valid'], result)
                self.assertEqual(result['intent'], request['classifier']['intent'])
                for key, value in request['classifier']['entities'].items():
                    self.assertEqual(result['entities'].get(key), value, result)
                self.assertNotEqual(result['reason_code'], 'malformed_classifier')

    def test_dependent_queries_and_independent_questions_in_all_styles(self):
        for language in ['en', 'fil', 'taglish']:
            for message, category, names in [
                ('Eh motorsiklo? Meron kayo?', 'motorcycle', ['Honda Click', 'Yamaha Mio']),
                ('What about motorcycles? Do you have any?', 'motorcycle', ['Honda Click', 'Yamaha Mio']),
                ('Eh trucks? Meron kayo?', 'truck', ['Isuzu FSR', 'Ford Ranger Raptor']),
                ('How about trucks? May truck ba kayong pinaparenta?', 'truck', ['Isuzu FSR', 'Ford Ranger Raptor']),
                ('Tinatanong ko kung meron ba kayong truck na pinaparenta?', 'truck', ['Isuzu FSR', 'Ford Ranger Raptor']),
                ('May van ba kayo?', 'van', ['Toyota Hiace']),
            ]:
                with self.subTest(language=language, message=message):
                    self.assert_one_search(self.turn(message, language=language), category, names)
        for message, intents in [
            ('What about motorcycles? Do you have any? What payment methods are accepted?', ['available_vehicles', 'payment_methods']),
            ('How about trucks? How do I book?', ['available_vehicles', 'how_to_book']),
            ('Show manual trucks? Show automatic trucks?', ['available_vehicles', 'available_vehicles']),
        ]:
            result = self.turn(message)
            self.assertEqual([result['intent']] + [answer['intent'] for answer in result['additional_answers']], intents, result)
        conflicting = self.turn('How about manual trucks? Do you have automatic trucks?')
        self.assertEqual(len(conflicting['additional_answers']), 1)
        self.assertEqual(conflicting['entities']['transmission'], 'manual')
        self.assertEqual(conflicting['additional_answers'][0]['entities']['transmission'], 'automatic')

    def test_category_switch_resets_filters_unless_explicitly_carried_forward(self):
        context = self.turn('Do you have manual transmission cars?', vehicles=self.no_manual_cars)['conversation_context']
        plain = self.turn('How about trucks?', context, self.no_manual_cars)
        self.assert_one_search(plain, 'truck', ['Isuzu FSR', 'Ford Ranger Raptor'])
        self.assertNotIn('transmission', plain['entities'])
        for message in ['How about manual trucks?', 'How about trucks with the same filters?']:
            result = self.turn(message, context, self.no_manual_cars)
            self.assertEqual(result['entities']['transmission'], 'manual')
            self.assertEqual(result['entities']['category'], 'truck')
            self.assertEqual([vehicle['name'] for vehicle in result['recommendations']], ['Isuzu FSR'])
            self.assertEqual(result['additional_answers'], [])

        budget_context = self.turn('Show manual cars in Cebu under 1500 per day')['conversation_context']
        budget = self.turn('How about trucks with the same budget?', budget_context)
        self.assertEqual(budget['entities']['max_budget'], 1500)
        self.assertEqual(budget['entities']['rate_unit'], 'day')
        self.assertNotIn('transmission', budget['entities'])
        self.assertNotIn('location', budget['entities'])

    def test_how_followup_still_requests_search_instructions(self):
        first = self.turn('Show available cars')
        result = self.turn('How?', first['conversation_context'])
        self.assertEqual(result['intent'], 'available_vehicles')
        self.assertEqual(result['response_variant'], 'instructions')
        self.assertEqual(result['requested_answer_type'], 'instructions')
        self.assertEqual(result['recommendations'], [])
        self.assertRegex(result['reply'], r'Open Vehicles')

    def test_search_explanations_are_grounded_in_filters_and_inventory_in_all_styles(self):
        for language, followups in [
            ('en', ['Huh?', "Why couldn't you find any?"]),
            ('fil', ['Ano ang ibig sabihin?', 'Bakit wala kang mahanap?']),
            ('taglish', ['Hindi ko gets.', 'Why walang match?']),
        ]:
            first = self.turn('Do you have manual transmission cars?', vehicles=self.no_manual_cars, language=language)
            context, previous_reply = first['conversation_context'], first['reply']
            for message in followups:
                result = self.turn(message, context, self.no_manual_cars, language)
                with self.subTest(language=language, message=message):
                    self.assertEqual(result['intent'], 'available_transmission', result)
                    self.assertEqual(result['requested_answer_type'], 'explanation')
                    self.assertEqual(result['entities'], first['entities'])
                    self.assertEqual(result['recommendations'], [])
                    self.assertNotEqual(result['reply'], previous_reply)
                    self.assertRegex(result['reply'], r'(?i)manual.*transmission')
                    self.assertRegex(result['reply'], r'(?i)filter')
                    self.assertNotRegex(result['reply'], r'(?i)booking (?:is |was )?confirmed|reserved for you|tomorrow|bukas')
                context, previous_reply = result['conversation_context'], result['reply']
            switched = self.turn('May van ba kayo?', context, language=language)
            self.assertEqual(switched['entities']['category'], 'van')
            self.assertNotIn('transmission', switched['entities'])
            self.assertEqual([vehicle['name'] for vehicle in switched['recommendations']], ['Toyota Hiace'])

    def test_no_suv_and_successful_search_explanations_and_repetition(self):
        first = self.turn('Show SUVs in Davao')
        self.assertEqual(first['recommendations'], [])
        explained = self.turn('Can you explain?', first['conversation_context'])
        self.assertEqual(explained['intent'], 'available_vehicles')
        self.assertEqual(explained['requested_answer_type'], 'explanation')
        self.assertRegex(explained['reply'], r'(?i)suv.*location: Davao')
        self.assertNotEqual(explained['reply'], first['reply'])
        for language in ['en', 'fil', 'taglish']:
            available = self.turn('Show automatic cars', language=language)
            clarified = self.turn('What do you mean?', available['conversation_context'], language=language)
            self.assertEqual(clarified['requested_answer_type'], 'explanation')
            self.assertEqual(clarified['entities'], available['entities'])
            self.assertEqual(clarified['recommendations'], available['recommendations'])
            self.assertNotEqual(clarified['reply'], available['reply'])
            self.assertRegex(clarified['reply'], r'(?i)automatic.*transmission')
            for vehicle in clarified['recommendations']:
                self.assertIn(vehicle['name'], clarified['reply'])
            repeated = self.turn('Repeat that.', available['conversation_context'], language=language)
            self.assertEqual(repeated['reply'], available['reply'])

    def test_missing_expired_and_ambiguous_context_do_not_invent_search_results(self):
        context = self.turn('Do you have manual transmission cars?', vehicles=self.no_manual_cars)['conversation_context']
        for language in ['en', 'fil', 'taglish']:
            for previous in [None, {**context, 'idle_turns': 3}, {'intent': 'REJECT', 'topic': 'vehicles',
                             'candidate_intents': ['available_vehicles', 'vehicle_categories'], 'entities': {},
                             'clarification': {'required': True, 'type': 'ambiguous_intent', 'field': None}}]:
                for message in ['Huh?', "Why couldn't you find any?", 'Why?']:
                    with self.subTest(language=language, context=previous, message=message):
                        result = self.turn(message, previous, language=language)
                        self.assertTrue(result['requires_clarification'] or result['intent'] == 'unclear_message')
                        self.assertIn('?', result['reply'])
                        self.assertEqual(result['recommendations'], [])
                        self.assertNotRegex(result['reply'], r'(?i)manual.*transmission|none of the current available listings')


class SpecificationSearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(['node', '--input-type=module', '-e',
            'import { specificationVehicles } from "./backend/tests/fixtures/chatbotSpecificationVehicles.js";'
            'process.stdout.write(JSON.stringify(specificationVehicles));'], cwd=ROOT,
            capture_output=True, text=True, encoding='utf-8', check=True, timeout=30)
        cls.vehicles = json.loads(result.stdout)

    def turn(self, message, language='en', context=None, vehicles=None):
        return finish([{'message': message, 'classifier': classify_message(message, language, previous_context=context),
                       'previous_context': context, 'vehicles': self.vehicles if vehicles is None else vehicles}])[0]

    def test_reported_specification_searches_reach_exact_fixture_matches(self):
        cases = [
            ('Is there an 18 seater vehicle available?', {'pax': 18}, ['Ford Transit']),
            ('I am looking for a vehicle that is 18 seater.', {'pax': 18}, ['Ford Transit']),
            ('May 10-seater SUV ba?', {'category': 'suv', 'pax': 10}, []),
            ('Do you have trucks?', {'category': 'truck'}, ['Isuzu FSR', 'Ford Ranger']),
            ('Do you have pickup trucks?', {'category': 'pickup'}, ['Ford Ranger']),
            ('Is there a car for rent that includes driver?', {'category': 'car', 'driver_requested': True}, ['Ford Everest']),
            ('Find Ford cars with a driver', {'brand': 'Ford', 'category': 'car', 'driver_requested': True}, ['Ford Everest']),
            ('Do you have manual transmission vehicles?', {'transmission': 'manual'}, ['Toyota Fortuner', 'Toyota Hiace', 'Isuzu FSR']),
            ('May automatic na motorcycle?', {'category': 'motorcycle', 'transmission': 'automatic'}, ['Honda Click', 'Yamaha Mio', 'Honda Kuliglig', 'Yamaha Electric']),
            ('Show gasoline motorcycles.', {'category': 'motorcycle', 'fuel': 'gasoline'}, ['Honda Click', 'Yamaha Mio', 'Honda Kuliglig']),
            ('Manual diesel truck.', {'category': 'truck', 'transmission': 'manual', 'fuel': 'diesel'}, ['Isuzu FSR']),
            ('May kuliglig ba?', {'category': 'motorcycle', 'vehicle_subtype': 'kuliglig'}, ['Honda Kuliglig']),
        ]
        for message, entities, names in cases:
            with self.subTest(message=message):
                result = self.turn(message)
                self.assertIn(result['intent'], ['available_vehicles', 'available_transmission', 'passenger_capacity'])
                self.assertFalse(result['requires_clarification'], result)
                for field, value in entities.items():
                    self.assertEqual(result['entities'].get(field), value, result)
                actual = {v['name'] for v in result['recommendations']}
                self.assertEqual(actual, set(names[:3]) if len(names) <= 3 else {'Honda Click', 'Honda Kuliglig', 'Yamaha Electric'})
                self.assertEqual(result['additional_answers'], [])
                if 'driver_requested' in entities:
                    self.assertRegex(result['reply'], r'(?i)optional')
                    self.assertNotRegex(result['reply'], r'(?i)driver (?:is )?included (?:in|with) (?:the )?(?:rate|price)')

    def test_multiple_filters_language_aliases_and_no_silent_relaxation(self):
        for language in ['en', 'fil', 'taglish']:
            for message, entities, names in [
                ('Show an 18-seater AT diesel van', {'pax': 18, 'transmission': 'automatic', 'fuel': 'diesel'}, ['Ford Transit']),
                ('May MT na diesel truck?', {'transmission': 'manual', 'fuel': 'diesel'}, ['Isuzu FSR']),
                ('May mt na diesel truck?', {'transmission': 'manual', 'fuel': 'diesel'}, ['Isuzu FSR']),
                ('Show at diesel vans', {'category': 'van', 'transmission': 'automatic', 'fuel': 'diesel'}, ['Ford Transit']),
                ('Find MT trucks not AT', {'category': 'truck', 'transmission': 'manual', 'excluded_transmissions': ['automatic']}, ['Isuzu FSR']),
                ('Show petrol motorcycles for 2 passengers in Cebu', {'pax': 2, 'fuel': 'gasoline', 'location': 'cebu'}, ['Honda Click', 'Yamaha Mio', 'Honda Kuliglig']),
                ('No less than 10 seats', {'pax': 10}, ['Toyota Hiace', 'Ford Transit']),
                ('Kasya 18', {'pax': 18}, ['Ford Transit']),
                ('Find manual gasoline trucks', {'category': 'truck', 'transmission': 'manual', 'fuel': 'gasoline'}, []),
                ('Find trucks in Cebu diesel manual', {'category': 'truck', 'location': 'cebu', 'transmission': 'manual', 'fuel': 'diesel'}, ['Isuzu FSR']),
            ]:
                with self.subTest(language=language, message=message):
                    result = self.turn(message, language)
                    self.assertFalse(result['requires_clarification'], result)
                    for key, value in entities.items(): self.assertEqual(result['entities'].get(key), value, result)
                    self.assertEqual({v['name'] for v in result['recommendations']}, set(names))
                    self.assertNotIn('max_budget', result['entities'])
                    if not names:
                        self.assertRegex(result['reply'], r'(?i)manual')
                        self.assertRegex(result['reply'], r'(?i)gasoline')

    def test_driver_modes_and_missing_specifications_are_not_invented(self):
        only = self.turn('Self-drive only.')
        self.assertFalse(only['requires_clarification'], only)
        self.assertEqual(only['entities'].get('driver_requested'), False)
        self.assertTrue(only['recommendations'])
        self.assertTrue(all(v.get('driverOptionEnabled') is False for v in only['recommendations']))
        self_drive = self.turn('Automatic self-drive motorcycle')
        self.assertTrue(self_drive['recommendations'])
        self.assertEqual(self_drive['entities']['driver_requested'], False)
        for message in ['Find gasoline cars', 'Find automatic cars', 'Find cars with a driver', 'Self-drive only']:
            result = self.turn(message)
            self.assertNotIn('Toyota Unknown Specs', [v['name'] for v in result['recommendations']], result)

    def test_conflicting_filters_require_a_focused_clarification(self):
        for message, field in [('Find automatic and manual cars', 'transmission'),
                               ('Find gasoline and diesel motorcycles', 'fuel'),
                               ('Find a car with driver and without driver', 'driver')]:
            for language in ['en', 'fil', 'taglish']:
                with self.subTest(message=message, language=language):
                    result = self.turn(message, language)
                    self.assertTrue(result['requires_clarification'], result)
                    self.assertEqual(result['clarification']['field'], field)
                    self.assertEqual(result['recommendations'], [])
                    self.assertIn('?', result['reply'])

    def test_duration_negation_and_availability_controls(self):
        capacity = self.turn('Kasya ba 7 pax?')
        self.assertEqual(capacity['intent'], 'passenger_capacity')
        self.assertFalse(capacity['requires_clarification'])
        self.assertTrue(all(v['seats'] >= 7 for v in capacity['recommendations']))
        capacity = self.turn('Which rental can fit 7 passengers?')
        self.assertEqual(capacity['intent'], 'passenger_capacity')
        self.assertFalse(capacity['requires_clarification'])
        result = self.turn('Find gasoline motorcycles for three days')
        self.assertEqual(result['entities']['duration_value'], 3)
        self.assertNotIn('pax', result['entities'])
        result = self.turn('Find motorcycles, not electric')
        self.assertEqual(result['entities']['excluded_fuels'], ['electric'])
        self.assertNotIn('Yamaha Electric', [v['name'] for v in result['recommendations']])
        result = self.turn('Find cars at Cebu')
        self.assertNotIn('transmission', result['entities'])
        result = self.turn('Show tricycle rentals')
        self.assertEqual(result['recommendations'], [])
        self.assertEqual(result['response_variant'], 'unsupported_tricycle')
        no_matches = self.turn('Show 18-seater vans', vehicles=[])
        self.assertEqual(no_matches['recommendations'], [])
        self.assertRegex(no_matches['reply'], r'18')
        for vehicle in self.turn('Show available vehicles')['recommendations']:
            self.assertNotEqual(vehicle['name'], 'Toyota Camry')
        private = self.turn('May kuliglig ba?')
        self.assertNotRegex(json.dumps(private), r'FIX-123|private-fixture')

    def test_specification_followups_keep_filters_and_allow_explicit_changes(self):
        first = self.turn('Find gasoline motorcycles')
        followup = self.turn('Automatic only', context=first['conversation_context'])
        self.assertEqual(followup['entities']['fuel'], 'gasoline')
        self.assertEqual(followup['entities']['transmission'], 'automatic')
        self.assertTrue(all(v['fuel'] == 'gasoline' and v['transmission'] == 'automatic' for v in followup['recommendations']))
        conflict = self.turn('Find gasoline and diesel motorcycles')
        resolved = self.turn('Gasoline', context=conflict['conversation_context'])
        self.assertFalse(resolved['requires_clarification'])
        self.assertTrue(resolved['recommendations'])
        self.assertTrue(all(v['fuel'] == 'gasoline' for v in resolved['recommendations']))
        first = self.turn('Find self-drive only cars')
        changed = self.turn('With driver', context=first['conversation_context'])
        self.assertTrue(changed['entities']['driver_requested'])
        self.assertNotIn('self_drive_only', changed['entities'])
        self.assertEqual([v['name'] for v in changed['recommendations']], ['Ford Everest'])


class SpecificationAccuracyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SpecificationSearchTests.setUpClass.__func__(cls)

    turn = SpecificationSearchTests.turn

    def test_real_python_http_to_node_route_enforces_the_reported_specifications(self):
        import os
        import socket
        import threading
        import time
        from unittest.mock import patch
        import uvicorn
        from app import app as chatbot_app

        fixtures = [
            ('BMW X3', 5, 'car', 'SUV', 'Automatic', 'Gasoline', False),
            ('Toyota Innova', 6, 'car', 'SUV', 'Automatic', 'Gasoline', False),
            ('Manual SUV', 5, 'car', 'SUV', 'Manual', 'Gasoline', False),
            ('ISUZU FSR', 3, 'truck', 'Cargo', 'Manual', 'Diesel', False),
            ('Five-seat sedan', 5, 'car', 'Sedan', 'Automatic', 'Gasoline', False),
            ('Unknown seats SUV', None, 'car', 'SUV', 'Automatic', 'Gasoline', False),
            ('Unknown fuel SUV', 6, 'car', 'SUV', 'Automatic', None, False),
            ('Unknown transmission SUV', 5, 'car', 'SUV', None, 'Gasoline', False),
            ('Unavailable diesel SUV', 5, 'car', 'SUV', 'Automatic', 'Diesel', True),
        ]
        vehicles = [{'_id': f'{index + 400:024x}', 'name': name, 'availabilityStatus': 'available',
            'dailyRentalRate': 500, 'pricingUnit': 'hourly', 'locked': locked,
            'specs': {key: value for key, value in dict(type=category, subType=subtype, seats=seats,
                transmission=transmission, fuel=fuel).items() if value is not None}}
            for index, (name, seats, category, subtype, transmission, fuel, locked) in enumerate(fixtures)]
        key = 'fixture-only-specification-http-key-32-characters'
        with patch.dict(os.environ, {'CHATBOT_INTERNAL_API_KEY': key, 'INTERNAL_API_KEY': key}):
            listener = socket.socket(); listener.bind(('127.0.0.1', 0))
            server = uvicorn.Server(uvicorn.Config(chatbot_app, log_level='error', access_log=False))
            thread = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
            thread.start()
            try:
                deadline = time.monotonic() + 10
                while not server.started and time.monotonic() < deadline: time.sleep(.05)
                self.assertTrue(server.started, 'Isolated real Python HTTP service did not start')
                result = subprocess.run(['node', '--import', (ROOT / 'backend/tests/helpers/chatbotTestLogs.mjs').as_uri(),
                    str(ROOT / 'backend/tests/helpers/chatbotSpecificationHttp.mjs')], cwd=ROOT,
                    input=json.dumps({'classifierUrl': f'http://127.0.0.1:{listener.getsockname()[1]}', 'vehicles': vehicles}),
                    capture_output=True, text=True, encoding='utf-8', timeout=90)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                report = json.loads(result.stdout.splitlines()[-1])
                self.assertEqual(report['passedRequests'], 17)
            finally:
                server.should_exit = True; thread.join(timeout=10); listener.close()

    def test_exact_capacity_words_plural_and_minimum_are_distinct(self):
        for message, seats in [('do you have 2 seater?', 2), ('two seater', 2),
                ('do you have 5 seaters?', 5), ('do you have 5 seater vehicles for rent?', 5),
                ('five-seater', 5), ('seats for 5', 5), ('5 passenger vehicle', 5),
                ('may 10 seats', 10), ('sasakyang may 18 upuan', 18),
                ('is there an 18 seater vehicle available?', 18), ('I am looking for an 18 seater.', 18)]:
            with self.subTest(message=message):
                answer = self.turn(message)
                self.assertFalse(answer['requires_clarification'], answer)
                self.assertIn(answer['intent'], ['available_vehicles', 'available_transmission', 'passenger_capacity'])
                self.assertEqual(answer['entities'].get('pax'), seats, answer)
                self.assertEqual(answer['entities'].get('seat_match'), 'exact', answer)
                self.assertNotIn('duration_value', answer['entities'])
                self.assertTrue(all(v['seats'] == seats for v in answer['recommendations']), answer)
                self.assertRegex(answer['reply'], rf'exactly {seats}')
        for message in ['Can fit at least 5 passengers?', 'Vehicle for five people', 'pang limang tao', 'kasya limang tao']:
            answer = self.turn(message)
            self.assertEqual(answer['entities'].get('pax'), 5, answer)
            self.assertNotEqual(answer['entities'].get('seat_match'), 'exact')
            self.assertTrue(all(v['seats'] >= 5 for v in answer['recommendations']))
        for message in ['Van for 18 days', 'Car for 5 hours']:
            self.assertNotIn('pax', self.turn(message)['entities'])

    def test_reported_fuel_subtype_and_positive_controls(self):
        for message, fields in [('deisel engine?', {'fuel': 'diesel'}), ('diesel engine?', {'fuel': 'diesel'}),
                ('gasolina motorcycles', {'fuel': 'gasoline', 'category': 'motorcycle'}),
                ('meron ba kayong pinaparentahang suv?', {'category': 'suv'}),
                ('is there any manual transmission vehicles?', {'transmission': 'manual'}),
                ('how about automatic transmission?', {'transmission': 'automatic'}),
                ('do you have a car with driver?', {'category': 'car', 'driver_requested': True}),
                ('may motorcycle na gasoline?', {'category': 'motorcycle', 'fuel': 'gasoline'}),
                ('show me pickup trucks.', {'category': 'pickup'}),
                ('may self-drive only na motorcycle?', {'category': 'motorcycle', 'self_drive_only': True})]:
            with self.subTest(message=message):
                answer = self.turn(message)
                self.assertFalse(answer['requires_clarification'], answer)
                self.assertTrue(answer['recommendations'], answer)
                for key, value in fields.items(): self.assertEqual(answer['entities'].get(key), value)
                for vehicle in answer['recommendations']:
                    for key in ['fuel', 'transmission']:
                        if key in fields: self.assertEqual(vehicle[key], fields[key])
        for message in ['how about dump truck?', 'How about dump trucks?']:
            answer = self.turn(message, context=self.turn('Do you have trucks?')['conversation_context'])
            self.assertFalse(answer['recommendations'], answer)
            self.assertRegex(answer['reply'], r'(?i)dump truck')
            self.assertEqual(answer['entities']['vehicle_subtype'], 'dump truck')
            self.assertNotRegex(answer['reply'], r'(?i)configured search|not supported')

    def test_followup_refinements_replace_filters_and_reset(self):
        for messages, expected in [
                (['Show manual vehicles', 'How about automatic?'], {'transmission': 'automatic'}),
                (['Show automatic vehicles', 'Deisel engine?'], {'transmission': 'automatic', 'fuel': 'diesel'}),
                (['Show automatic SUVs', 'Only 5 seaters.'], {'category': 'suv', 'transmission': 'automatic', 'pax': 5, 'seat_match': 'exact'}),
                (['Show vans', 'How about SUVs?'], {'category': 'suv'}),
                (['Find 5-seater cars', 'For at least seven people'], {'category': 'car', 'pax': 7}),
                (['Find gasoline cars', 'How do I book?', 'deisel engine?'], {'fuel': 'diesel'}),
                (['Find gasoline cars', 'reset conversation', 'deisel engine?'], {'fuel': 'diesel'})]:
            context = None
            for message in messages:
                answer = self.turn(message, context=context)
                context = answer['conversation_context']
            for key, value in expected.items(): self.assertEqual(answer['entities'].get(key), value, answer)
            if messages[-1] == 'deisel engine?': self.assertNotIn('category', answer['entities'])
            if messages[-1] == 'For at least seven people': self.assertNotEqual(answer['entities'].get('seat_match'), 'exact')
            self.assertFalse(answer['requires_clarification'], answer)
        answer = self.turn('may automatic na 5 seater suv na gasoline?')
        self.assertEqual(answer['recommendations'], [])
        self.assertRegex(answer['reply'], r'exactly 5')
        self.assertRegex(answer['reply'], r'gasoline')

    def test_named_and_selected_listing_specifications_use_inventory(self):
        for message, fragment in [('How many seats does the Ford Ranger have?', '5'),
                ('What fuel does the ISUZU FSR use?', 'diesel'), ('Is the Yamaha Mio automatic?', 'automatic'),
                ('What type of motorcycle is the Honda Kuliglig?', 'kuliglig')]:
            with self.subTest(message=message):
                answer = self.turn(message)
                self.assertFalse(answer['requires_clarification'], answer)
                self.assertIn(fragment, answer['reply'].lower())
                self.assertEqual(len(answer['recommendations']), 1, answer)
                self.assertNotRegex(answer['reply'], r'closest|minimum seats|Are you looking')
        selected = self.turn('Show pickup trucks')['conversation_context']
        for language in ['en', 'fil', 'taglish']:
            for message in ['Does this one have a driver?', 'Is the driver included in this vehicle?', 'Does this vehicle allow self-drive?']:
                answer = self.turn(message, language, selected)
                self.assertFalse(answer['requires_clarification'], answer)
                self.assertEqual(answer['recommendations'][0]['name'], 'Ford Ranger', answer)
                self.assertNotRegex(json.dumps(answer), r'FIX-123|private-fixture')
            included = self.turn('Is the driver included in this vehicle?', language, selected)
            self.assertRegex(included['reply'], r'(?i)optional|hiwalay|dagdag')
        for message in ['Does this one have a driver?', 'What fuel does this vehicle use?']:
            self.assertTrue(self.turn(message)['requires_clarification'])
        duplicates = [v for v in self.vehicles if v['name'] == 'Ford Ranger']
        duplicates += [{**duplicates[0], '_id': '000000000000000000000299', 'specs': {**duplicates[0]['specs'], 'seats': 4}}]
        ambiguous = self.turn('How many seats does the Ford Ranger have?', vehicles=duplicates)
        self.assertTrue(ambiguous['requires_clarification'], ambiguous)
        self.assertNotRegex(ambiguous['reply'], r'has 5 seats')
        chosen = self.turn('The second one', context=ambiguous['conversation_context'], vehicles=duplicates)
        self.assertFalse(chosen['requires_clarification'], chosen)
        self.assertIn('4 seats', chosen['reply'])
        self.assertEqual(chosen['recommendations'][0]['_id'], duplicates[1]['_id'])
        unknown = self.turn('What fuel does the Toyota Unknown Specs use?')
        self.assertRegex(unknown['reply'], r'(?i)unknown|not recorded')

    def test_included_driver_price_is_not_inferred_from_optional_driver(self):
        answer = self.turn('Find cars with driver included in the price')
        self.assertEqual(answer['recommendations'], [])
        self.assertRegex(answer['reply'], r'(?i)cannot verify|not recorded')
        self.assertRegex(answer['reply'], r'(?i)optional')
        optional = self.turn('With driver', context=answer['conversation_context'])
        self.assertFalse(optional['requires_clarification'], optional)
        self.assertNotIn('driver_included_required', optional['entities'])
        self.assertTrue(optional['recommendations'])

    def test_named_examples_missing_context_and_language_capacity_variations(self):
        examples = [
            ('How many seats does the Ford Raptor R have?', 'Ford Raptor R', '5', 'truck', 'Pickup', 5),
            ('Is the Yamaha Mio Gear automatic?', 'Yamaha Mio Gear', 'automatic', 'motorcycle', 'Scooter', 2),
            ('What type of motorcycle is the Kawasaki Ninja 400?', 'Kawasaki Ninja 400', 'sports bike', 'motorcycle', 'Sports Bike', 2),
        ]
        for index, (message, name, fragment, category, subtype, seats) in enumerate(examples):
            fixture = [{**self.vehicles[0], '_id': f'{300 + index:024x}', 'name': name,
                'specs': {'type': category, 'subType': subtype, 'seats': seats, 'transmission': 'Automatic'}}]
            answer = self.turn(message, vehicles=fixture)
            self.assertFalse(answer['requires_clarification'], answer)
            self.assertIn(fragment, answer['reply'].lower())
            self.assertEqual(answer['recommendations'][0]['name'], name)
            self.assertTrue(answer['recommendations'][0]['displayRate'] > 0)
        for language in ['en', 'fil', 'taglish']:
            for message in ['May sasakyang may limang upuan?', 'May five-seater na car?', 'Do you have 5 seaters?']:
                answer = self.turn(message, language)
                self.assertEqual(answer['entities'].get('pax'), 5, answer)
                self.assertEqual(answer['entities'].get('seat_match'), 'exact', answer)
                self.assertTrue(all(v['seats'] == 5 for v in answer['recommendations']))
        context = self.turn('Show pickup trucks')['conversation_context']
        context['idle_turns'] = 3
        self.assertTrue(self.turn('Does this one have a driver?', context=context)['requires_clarification'])
        missing = self.turn('What fuel does this vehicle use?')
        named = self.turn('Isuzu FSR', context=missing['conversation_context'])
        self.assertFalse(named['requires_clarification'], named)
        self.assertIn('diesel', named['reply'])


if __name__ == "__main__":
    unittest.main()
