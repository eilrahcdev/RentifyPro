import json
import os
import socket
import subprocess
import threading
import time
import unittest
from unittest.mock import patch

import uvicorn
from app import app, classify_message
from test_response_quality import ROOT
from test_vehicle_identity import listing


class DynamicInventoryTests(unittest.TestCase):
    def test_discovery_signal_preserves_known_social_responses(self):
        self.assertTrue(classify_message('RIVIAN', 'en').get('inventory_vocabulary_requested'))
        for message in ['haha', 'nice', 'thank you', 'salamat', 'Hay nako', 'are you a femboy']:
            self.assertFalse(classify_message(message, 'en').get('inventory_vocabulary_requested'), message)

    def test_current_inventory_vocabulary_is_request_scoped(self):
        vocabulary = {'brands': ['Rivian'], 'models': [{'brand': 'Rivian', 'model': 'R1T'}],
                      'subtypes': [{'category': 'truck', 'name': 'adventure utility'}]}
        answer = classify_message('Do you have adventure utility vehicles?', 'en', inventory_vocabulary=vocabulary)
        self.assertEqual(answer['entities']['vehicle_subtype'], 'adventure utility')
        self.assertEqual(answer['entities']['category'], 'truck')
        model = classify_message('Show R1T rentals', 'en', inventory_vocabulary=vocabulary)
        self.assertEqual(model['entities']['brand'], 'Rivian')
        self.assertEqual(model['entities']['model'], 'R1T')
        empty = classify_message('Do you have adventure utility vehicles?', 'en')
        self.assertNotIn('vehicle_subtype', empty['entities'])
        tricycle = classify_message('Do you have tricycles?', 'en', inventory_vocabulary={
            'subtypes': [{'category': 'motorcycle', 'name': 'tricycle'}]})
        self.assertEqual(tricycle['entities']['vehicle_subtype'], 'tricycle')
        self.assertNotEqual(tricycle.get('response_variant'), 'unsupported_tricycle')

    def test_malformed_vocabulary_cannot_inject_private_or_unbounded_context(self):
        for vocabulary in [{'brands': ['Rivian'], 'owner': 'private'}, {'brands': ['X'] * 129},
                           {'brands': ['Rivian'], 'models': [{'brand': 'Rivian', 'model': 'R1T', 'price': 1}]},
                           {'subtypes': [{'category': 'admin', 'name': 'adventure utility'}]}]:
            answer = classify_message('Do you have adventure utility vehicles?', 'en', inventory_vocabulary=vocabulary)
            self.assertNotIn('vehicle_subtype', answer['entities'])

    def test_concurrent_vocabularies_do_not_leak_between_requests(self):
        from concurrent.futures import ThreadPoolExecutor
        def classify(category):
            return classify_message('Do you have urban shuttles?', 'en', inventory_vocabulary={
                'subtypes': [{'category': category, 'name': 'urban shuttle'}]})['entities']['category']
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(list(pool.map(classify, ['van', 'truck'])), ['van', 'truck'])

    def test_owner_update_and_final_http_answers_without_restart(self):
        vehicles = [listing(1001, 'Yamaha Mio Gear', 'motorcycle', 'Kuliglig', 2),
                    listing(1002, 'Yamaha R3', 'motorcycle', 'Sports Bike', 2),
                    listing(1003, 'BMW M3', 'car', 'Sports Car', 5),
                    listing(1004, 'Toyota Test Coupe', 'car', 'Supercar', 2),
                    listing(1005, 'Koenigsegg Agera RS', 'car', 'Hypercar', 2),
                    listing(1006, 'Rivian R1T', 'truck', 'Adventure Utility', 5),
                    listing(1007, 'Toyota Commuter', 'van', '18 Seater', 18),
                    listing(1008, 'Ducati Monster', 'motorcycle', 'Cruiser', 2, availabilityStatus='unavailable')]
        cases = [
            {'message': 'Do you have Chevrolet?', 'entities': {'brand': 'Chevrolet'}, 'ids': []},
            {'message': 'May Mitsubishi ba?', 'entities': {'brand': 'Mitsubishi'}, 'ids': []},
            {'message': 'How about ducatti?', 'entities': {'brand': 'Ducati'}, 'ids': []},
            {'message': 'Meron bang kuliglig?', 'ids': [1001]},
            {'message': 'How about Yamaha?', 'followup': True, 'entities': {'brand': 'Yamaha'},
             'absent': ['vehicle_subtype'], 'ids': [1001, 1002]},
            {'message': 'Do you have kuliglig?', 'update': {'id': 1001, 'subtype': 'Scooter'}, 'ids': []},
            {'message': 'Do you have scooters?', 'entities': {'vehicle_subtype': 'scooter'}, 'ids': [1001]},
            {'message': 'Do you have adventure utility vehicles?', 'entities': {'vehicle_subtype': 'adventure utility', 'category': 'truck'}, 'ids': [1006]},
            {'message': 'How about automatic ones?', 'followup': True,
             'entities': {'vehicle_subtype': 'adventure utility', 'transmission': 'automatic'}, 'ids': [1006]},
            {'message': 'Show R1T rentals', 'entities': {'brand': 'Rivian', 'model': 'R1T'}, 'ids': [1006]},
            {'message': 'RIVIAN', 'entities': {'brand': 'Rivian'}, 'ids': [1006]},
            {'message': 'Yamaha Mio Geer', 'entities': {'brand': 'Yamaha'}, 'ids': [1001]},
            {'message': 'Do you have sports cars?', 'entities': {'vehicle_subtype': 'sports car'}, 'ids': [1003]},
            {'message': 'Gusto ko supercar, hindi hypercar', 'followup': True,
             'entities': {'vehicle_subtype': 'supercar', 'excluded_subtypes': ['hypercar']}, 'ids': [1004]},
            {'message': 'Do you have BMW?', 'entities': {'brand': 'BMW'}, 'ids': [1003]},
            {'message': 'How about Toyota?', 'followup': True, 'entities': {'brand': 'Toyota'}, 'ids': [1004, 1007]},
            {'message': 'Do you have 18-seater vans?', 'entities': {'pax': 18}, 'ids': [1007]},
            {'message': 'How about an automatic one?', 'followup': True, 'entities': {'pax': 18, 'transmission': 'automatic'}, 'ids': [1007]},
        ]
        for language, message in [('en', 'Do you have adventure utility vehicles?'),
                                  ('fil', 'May adventure utility ba?'),
                                  ('taglish', 'Show adventure utility na sasakyan')]:
            cases.append({'message': message, 'language': language, 'entities': {'vehicle_subtype': 'adventure utility'}, 'ids': [1006]})
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
                    input=json.dumps({'classifierUrl': f'http://127.0.0.1:{listener.getsockname()[1]}',
                                      'vehicles': vehicles, 'identityCases': cases}),
                    capture_output=True, text=True, encoding='utf-8', timeout=120)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertEqual(json.loads(result.stdout.splitlines()[-1])['passedRequests'], len(cases))
            finally:
                server.should_exit = True
                thread.join(timeout=10)
                listener.close()
