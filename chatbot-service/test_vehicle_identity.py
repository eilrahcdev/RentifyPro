import unittest

from app import classify_message
from test_conversation_memory import finish


def listing(index, name, category, subtype, seats, transmission='Automatic', fuel='Gasoline', **extra):
    return {'_id': f'{index:024x}', 'name': name, 'availabilityStatus': 'available',
            'dailyRentalRate': 500 + index, 'pricingUnit': 'hourly', 'driverOptionEnabled': False,
            'specs': {'type': category, 'subType': subtype, 'seats': seats,
                      'transmission': transmission, 'fuel': fuel}, **extra}


VEHICLES = [
    listing(901, 'BMW M3', 'car', 'Sedan', 5),
    listing(902, 'BMW X3', 'car', 'SUV', 5),
    listing(903, 'BMW X3', 'car', 'SUV', 5),
    listing(904, 'BMW X5', 'car', 'SUV', 7),
    listing(905, 'BMW X3', 'car', 'SUV', 5, availabilityStatus='unavailable', locked=True),
    listing(906, 'Koenigsegg Agera RS', 'car', 'Hypercar', 2),
    listing(907, 'Ford Raptor R', 'truck', 'Pick Up', 4),
    listing(908, 'Yamaha Mio Gear', 'motorcycle', 'Kuliglig', 2),
    listing(909, 'Kawasaki Ninja 400', 'motorcycle', 'Big Bike', 4),
    listing(910, 'Isuzu FSR', 'truck', 'Dump Truck', 3, 'Manual', 'Diesel'),
    listing(911, 'Toyota Vios', 'car', 'Sedan', 5, availabilityStatus='unavailable'),
    listing(912, 'Toyota Innova', 'car', 'SUV', 6, driverOptionEnabled=True),
    listing(913, 'Honda Click', 'motorcycle', 'Scooter', 2),
    listing(914, 'Yamaha R3', 'motorcycle', 'Sports Bike', 2, 'Manual'),
    listing(915, 'BMW Unknown', 'car', 'SUV', None),
]

REPORTED_CASES = [
    ('meron ba kayong bmw?', {'brand': 'BMW'}, [901, 902, 903]),
    ('do you have bmw?', {'brand': 'BMW'}, [901, 902, 903]),
    ('do you have bmw vehicle for rent?', {'brand': 'BMW'}, [901, 902, 903]),
    ('may pinaparentahan ba kayong koenigsegg?', {'brand': 'Koenigsegg'}, [906]),
    ('how about ducatti motorcycle?', {'brand': 'Ducati', 'category': 'motorcycle'}, []),
    ('meron ba kayong toyota vios?', {'brand': 'Toyota', 'model': 'Vios'}, []),
    ('meron ba kayong isuzu na sasakyan?', {'brand': 'Isuzu'}, [910]),
    ('do you have kawasaki motorcycle for rent?', {'brand': 'Kawasaki', 'category': 'motorcycle'}, [909]),
]


class VehicleIdentityTests(unittest.TestCase):
    def test_real_python_http_and_node_route_preserve_identity_and_booking_locks(self):
        import json
        import os
        import socket
        import subprocess
        import threading
        import time
        from unittest.mock import patch
        import uvicorn
        from app import app
        from test_response_quality import ROOT

        cases = [{'message': message, 'entities': fields, 'ids': ids} for message, fields, ids in REPORTED_CASES]
        cases += [
            {'message': 'meron ba kayong pinaparentang sportscar?', 'ids': [], 'reply': 'sports car'},
            {'message': 'Do you have BMW?', 'entities': {'brand': 'BMW'}, 'ids': [901, 902, 903]},
            {'message': 'How about X3?', 'followup': True, 'entities': {'brand': 'BMW', 'model': 'X3'}, 'ids': [902, 903]},
            {'message': 'How about Toyota?', 'followup': True, 'entities': {'brand': 'Toyota'}, 'ids': [912]},
            {'message': 'Do you have motorcycles?', 'intent': 'vehicle_categories', 'entities': {'category': 'motorcycle'}, 'ids': []},
            {'message': 'How about Ducati?', 'followup': True, 'entities': {'brand': 'Ducati', 'category': 'motorcycle'}, 'ids': []},
            {'message': 'Do you have BMW?', 'entities': {'brand': 'BMW'}, 'ids': [901, 902, 903]},
            {'message': 'Only automatic 5-seaters.', 'followup': True, 'entities': {'brand': 'BMW', 'transmission': 'automatic', 'pax': 5, 'seat_match': 'exact'}, 'ids': [901, 902, 903]},
            {'message': 'Do you have 18-seater vans?', 'ids': []},
            {'message': 'May Koenigsegg ba kayo?', 'followup': True, 'entities': {'brand': 'Koenigsegg'}, 'absent': ['pax', 'category'], 'ids': [906]},
            {'message': 'Do you rent Koenigsegg Agera RS?', 'entities': {'brand': 'Koenigsegg', 'model': 'Agera RS'}, 'ids': [906]},
            {'message': 'Is the Ford Raptor R available?', 'entities': {'brand': 'Ford', 'model': 'Raptor R'}, 'ids': [907]},
            {'message': 'BMW SUVs with at least 6 seats', 'entities': {'brand': 'BMW', 'category': 'suv', 'pax': 6, 'seat_match': 'minimum'}, 'ids': [904]},
            {'message': 'May diesel na Isuzu truck?', 'entities': {'brand': 'Isuzu', 'category': 'truck', 'fuel': 'diesel'}, 'ids': [910]},
            {'message': 'May Kawasaki motorcycle na self-drive?', 'entities': {'brand': 'Kawasaki', 'category': 'motorcycle', 'driver_requested': False}, 'ids': [909]},
            {'message': 'Pickup truck?', 'entities': {'category': 'pickup'}, 'ids': [907]},
            {'message': 'May kuliglig ba?', 'entities': {'category': 'motorcycle', 'vehicle_subtype': 'kuliglig'}, 'ids': [908]},
            {'message': 'Scooter?', 'entities': {'category': 'motorcycle', 'vehicle_subtype': 'scooter'}, 'ids': [913]},
            {'message': 'How do I add a Koenigsegg to my owner listings?', 'intent': 'owner_listing_guidance', 'ids': []},
        ]
        vehicles = [{**v, 'availabilityStatus': 'available' if v.get('locked') else v['availabilityStatus']} for v in VEHICLES]
        vehicles.append(listing(916, 'BMW X3', 'car', 'SUV', 5, bookingReservationId='fixture-reservation'))
        key = 'fixture-only-specification-http-key-32-characters'
        with patch.dict(os.environ, {'CHATBOT_INTERNAL_API_KEY': key, 'INTERNAL_API_KEY': key}):
            listener = socket.socket()
            listener.bind(('127.0.0.1', 0))
            server = uvicorn.Server(uvicorn.Config(app, log_level='error', access_log=False))
            thread = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
            thread.start()
            try:
                deadline = time.monotonic() + 10
                while not server.started and time.monotonic() < deadline:
                    time.sleep(.05)
                self.assertTrue(server.started)
                result = subprocess.run(['node', '--import', (ROOT / 'backend/tests/helpers/chatbotTestLogs.mjs').as_uri(),
                    str(ROOT / 'backend/tests/helpers/chatbotSpecificationHttp.mjs')], cwd=ROOT,
                    input=json.dumps({'classifierUrl': f'http://127.0.0.1:{listener.getsockname()[1]}', 'vehicles': vehicles, 'identityCases': cases}),
                    capture_output=True, text=True, encoding='utf-8', timeout=90)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertEqual(json.loads(result.stdout.splitlines()[-1])['passedRequests'], len(cases))
            finally:
                server.should_exit = True
                thread.join(timeout=10)
                listener.close()

    def turn(self, message, language='en', context=None, vehicles=None):
        return finish([{'message': message, 'classifier': classify_message(message, language, previous_context=context),
                       'previous_context': context, 'vehicles': VEHICLES if vehicles is None else vehicles}])[0]

    def assert_search(self, answer, fields, ids):
        self.assertFalse(answer['requires_clarification'], answer)
        self.assertIn(answer['intent'], ['vehicle_brand_search', 'available_vehicles', 'available_transmission', 'passenger_capacity'])
        for field, expected in fields.items():
            self.assertEqual(answer['entities'].get(field), expected, answer)
        self.assertEqual({v['_id'] for v in answer['recommendations']}, {f'{i:024x}' for i in ids}, answer)
        for card in answer['recommendations']:
            stored = next(v for v in VEHICLES if v['_id'] == card['_id'])
            self.assertEqual(stored['availabilityStatus'], 'available')
            if fields.get('brand'):
                self.assertTrue(stored['name'].lower().startswith(fields['brand'].lower() + ' '))
            if fields.get('model'):
                self.assertEqual(stored['name'].lower(), f"{fields['brand']} {fields['model']}".lower())
        self.assertNotEqual(answer['intent'], 'owner_listing_guidance')

    def test_reported_queries_and_identity_controls(self):
        for message, fields, ids in REPORTED_CASES + [
            ('BMW', {'brand': 'BMW'}, [901, 902, 903]),
            ('Isuzu trucks', {'brand': 'Isuzu', 'category': 'truck'}, [910]),
            ('Kawasaki', {'brand': 'Kawasaki'}, [909]),
            ('Do you rent Koenigsegg Agera RS?', {'brand': 'Koenigsegg', 'model': 'Agera Rs'}, [906]),
            ('Is the Ford Raptor R available?', {'brand': 'Ford', 'model': 'Raptor R'}, [907]),
            ('Meron ba kayong Kawasaki Ninja 400?', {'brand': 'Kawasaki', 'model': 'Ninja 400'}, [909]),
        ]:
            with self.subTest(message=message):
                self.assert_search(self.turn(message), fields, ids)

    def test_absent_sports_car_never_guesses_models_or_other_subtypes(self):
        for language in ['en', 'fil', 'taglish']:
            for message in ['meron ba kayong pinaparentang sportscar?', 'Do you have sports cars?', 'Sports car?']:
                with self.subTest(language=language, message=message):
                    answer = self.turn(message, language)
                    self.assertFalse(answer['recommendations'], answer)
                    self.assertFalse(answer['requires_clarification'], answer)
                    self.assertRegex(answer['reply'], r'(?i)sports? car')
                    self.assertEqual(answer['entities']['vehicle_subtype'], 'sports car')
                    self.assertNotRegex(answer['reply'], r'(?i)configured search|not supported')

    def test_brand_model_and_specification_followups(self):
        first = self.turn('Do you have BMW vehicles?')
        self.assert_search(first, {'brand': 'BMW'}, [901, 902, 903])
        self.assert_search(self.turn('How about Toyota?', context=first['conversation_context']), {'brand': 'Toyota'}, [912])
        self.assert_search(self.turn('How about X3?', context=first['conversation_context']), {'brand': 'BMW', 'model': 'X3'}, [902, 903])
        self.assert_search(self.turn('Only automatic 5-seaters.', context=first['conversation_context']),
                           {'brand': 'BMW', 'transmission': 'automatic', 'pax': 5, 'seat_match': 'exact'}, [901, 902, 903])
        motorcycle = self.turn('Do you have motorcycles?')
        ducati = self.turn('How about Ducati?', context=motorcycle['conversation_context'])
        self.assert_search(ducati, {'brand': 'Ducati', 'category': 'motorcycle'}, [])
        self.assertRegex(ducati['reply'], r'Ducati')
        self.assertRegex(ducati['reply'], r'motorcycle')
        van = self.turn('Do you have 18-seater vans?')
        switched = self.turn('May Koenigsegg ba kayo?', context=van['conversation_context'])
        self.assert_search(switched, {'brand': 'Koenigsegg'}, [906])
        for field in ['category', 'pax', 'vehicle_subtype']:
            self.assertNotIn(field, switched['entities'])

    def test_multilingual_compound_filters_and_supported_subtypes(self):
        cases = [
            ('Do you have a 5-seater BMW?', {'brand': 'BMW', 'pax': 5, 'seat_match': 'exact'}, [901, 902, 903]),
            ('Do you have automatic BMW SUVs?', {'brand': 'BMW', 'category': 'suv', 'transmission': 'automatic'}, [902, 903, 904]),
            ('May diesel na Isuzu truck?', {'brand': 'Isuzu', 'category': 'truck', 'fuel': 'diesel'}, [910]),
            ('Do you have a two-seater Koenigsegg?', {'brand': 'Koenigsegg', 'pax': 2, 'seat_match': 'exact'}, [906]),
            ('May Kawasaki motorcycle na self-drive?', {'brand': 'Kawasaki', 'category': 'motorcycle', 'driver_requested': False}, [909]),
            ('BMW SUVs with at least 6 seats', {'brand': 'BMW', 'category': 'suv', 'pax': 6, 'seat_match': 'minimum'}, [904]),
            ('BMW manual SUVs', {'brand': 'BMW', 'category': 'suv', 'transmission': 'manual'}, []),
            ('BMW diesel SUVs', {'brand': 'BMW', 'category': 'suv', 'fuel': 'diesel'}, []),
            ('BMW SUV with a driver', {'brand': 'BMW', 'category': 'suv', 'driver_requested': True}, []),
            ('Pickup truck?', {'category': 'pickup'}, [907]),
            ('May kuliglig ba?', {'category': 'motorcycle', 'vehicle_subtype': 'kuliglig'}, [908]),
            ('Scooter?', {'category': 'motorcycle', 'vehicle_subtype': 'scooter'}, [913]),
        ]
        for language in ['en', 'fil', 'taglish']:
            for message, fields, ids in cases:
                with self.subTest(language=language, message=message):
                    self.assert_search(self.turn(message, language), fields, ids)

    def test_owner_guidance_and_conservative_unknown_brand_handling_remain(self):
        for message in ['How do I add a Koenigsegg to my owner listings?', 'How do I list my BMW vehicle?',
                        'Paano ilista ang Kawasaki na sasakyan ko?']:
            with self.subTest(message=message):
                answer = self.turn(message)
                self.assertEqual(answer['intent'], 'owner_listing_guidance', answer)
                self.assertFalse(answer['recommendations'])
        typo = self.turn('toyotaa')
        self.assertTrue(typo['requires_clarification'])
        self.assertEqual(typo['reason_code'], 'brand_spelling_clarification')
        self.assertTrue(self.turn('Do you have ABC Motors?')['requires_clarification'])


if __name__ == '__main__':
    unittest.main()
