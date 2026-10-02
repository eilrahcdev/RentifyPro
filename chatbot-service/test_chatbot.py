import json
import unittest
from pathlib import Path

from app import CONFIG, INTENTS_BY_ID, classify_message, normalize_for_match, normalize_informal_text


BASE_DIR = Path(__file__).parent


class ChatbotDatasetTests(unittest.TestCase):
    def test_dataset_examples_are_unique_and_responses_are_arrays(self):
        dataset = json.loads(
            (BASE_DIR / "rentifypro_chatbot_dataset_v6.json").read_text(encoding="utf-8")
        )
        owners = {}
        for item in dataset["items"]:
            for example in item["examples"]:
                normalized = normalize_for_match(example)
                self.assertNotIn(normalized, owners, f"duplicate example in {item['id']}")
                owners[normalized] = item["id"]
            for style in ("en", "fil", "taglish"):
                self.assertIsInstance(item["responses"][style], list)
                self.assertTrue(item["responses"][style])

    def test_all_configured_intents_loaded(self):
        self.assertIn("booking_limits", INTENTS_BY_ID)
        self.assertIn("schedule_conflict", INTENTS_BY_ID)
        self.assertIn("late_return_policy", INTENTS_BY_ID)
        self.assertIn("unpaid_balance", INTENTS_BY_ID)
        self.assertIn("vehicle_brand_search", INTENTS_BY_ID)
        self.assertIn("my_active_bookings", INTENTS_BY_ID)
        self.assertIn("my_overdue_return", INTENTS_BY_ID)
        self.assertIn("my_unpaid_balance", INTENTS_BY_ID)
        self.assertIn("chat_language_support", INTENTS_BY_ID)
        self.assertEqual(CONFIG["vehicle_brands"][0], "Toyota")
        self.assertNotIn("chat_capabilities", INTENTS_BY_ID)
        self.assertNotIn("online_payment", INTENTS_BY_ID)


class ChatbotClassifierTests(unittest.TestCase):
    def assert_intent(self, message, expected):
        result = classify_message(message, "auto")
        self.assertFalse(result["requires_clarification"], result)
        self.assertEqual(result["intent"], expected, result)
        self.assertGreaterEqual(result["confidence"], CONFIG["confidence_threshold"])

    def test_critical_intent_routes(self):
        cases = {
            "how do I cancel my booking": "booking_cancellation",
            "paano magbayad gamit GCash": "payment_methods",
            "30% lang muna pwede?": "payment_downpayment",
            "how can I pay my 30% using gcash": "payment_downpayment",
            "magkano late fee": "late_return_policy",
            "magkano rent per day": "rental_rate",
            "how many bookings can I have": "booking_limits",
            "can my two bookings overlap": "schedule_conflict",
            "help": "help_request",
            "bye": "chat_goodbye",
            "huh": "unclear_message",
            "hello hello hello": "chat_greeting",
        }
        for message, expected in cases.items():
            with self.subTest(message=message):
                self.assert_intent(message, expected)

    def test_renter_account_status_questions_keep_private_intents_separate_from_policy(self):
        cases = {
            "do I have an active booking?": ("my_active_bookings", "en"),
            "may active booking ba ako?": ("my_active_bookings", "taglish"),
            "may kasalukuyang renta ba ako?": ("my_active_bookings", "fil"),
            "am I overdue for return?": ("my_overdue_return", "en"),
            "are any of my rentals overdue?": ("my_overdue_return", "en"),
            "late na ba ang return ko?": ("my_overdue_return", "taglish"),
            "may late return ba ako?": ("my_overdue_return", "taglish"),
            "nahuli na ba ako sa balik?": ("my_overdue_return", "fil"),
            "do I have an unpaid balance?": ("my_unpaid_balance", "en"),
            "do I have an overdue payment?": ("my_unpaid_balance", "en"),
            "do I still owe anything?": ("my_unpaid_balance", "en"),
            "may unpaid balance ba ako?": ("my_unpaid_balance", "taglish"),
            "may utang pa ba ako?": ("my_unpaid_balance", "fil"),
            "what is my booking status?": ("booking_status", "en"),
            "may pending booking ba ako?": ("booking_status", "taglish"),
        }
        for message, (intent, language) in cases.items():
            with self.subTest(message=message):
                result = classify_message(message, "auto")
                self.assertEqual(result["intent"], intent, result)
                self.assertEqual(result["language"], language, result)
                self.assertFalse(result["requires_clarification"], result)

        for message, intent in {
            "how many active bookings can I have?": "booking_limits",
            "can I book with an unpaid balance?": "unpaid_balance",
            "may balance pa ako pwede pa ba mag book?": "unpaid_balance",
            "what is the late return fee?": "late_return_policy",
        }.items():
            with self.subTest(message=message):
                self.assertEqual(classify_message(message, "auto")["intent"], intent)

    def test_assistant_gender_questions_answer_the_question_in_each_style(self):
        cases = {
            "are you a girl?": ("en", "gender or sexual orientation"),
            "are you a boy?": ("en", "gender or sexual orientation"),
            "are you a woman?": ("en", "gender or sexual orientation"),
            "are you a gay?": ("en", "gender or sexual orientation"),
            "are you lesbian?": ("en", "gender or sexual orientation"),
            "are you bisexual?": ("en", "gender or sexual orientation"),
            "babae ka ba?": ("fil", "wala akong kasarian"),
            "lalaki ka ba?": ("fil", "wala akong kasarian"),
            "bakla ka ba?": ("fil", "wala akong kasarian"),
            "bading ka ba?": ("fil", "wala akong kasarian"),
            "bading ka?": ("fil", "wala akong kasarian"),
            "beki ka ba?": ("fil", "wala akong kasarian"),
            "tibo ka ba?": ("fil", "wala akong kasarian"),
            "lesbiyana ka ba?": ("fil", "wala akong kasarian"),
            "silahis ka ba?": ("fil", "wala akong kasarian"),
            "tomboy ka ba?": ("fil", "wala akong kasarian"),
            "bading ba si Rentify AI?": ("fil", "wala akong kasarian"),
            "ikaw ba ay bading?": ("fil", "wala akong kasarian"),
            "girl ka ba?": ("taglish", "wala akong gender"),
            "gay ka ba?": ("taglish", "wala akong gender"),
            "lesbian ka ba?": ("taglish", "wala akong gender"),
            "are you bading?": ("taglish", "wala akong gender"),
            "reply in Filipino: are you a girl?": ("fil", "wala akong kasarian"),
        }
        for message, (language, reply_text) in cases.items():
            with self.subTest(message=message):
                result = classify_message(message, "auto")
                self.assertEqual(result["intent"], "chat_gender_identity", result)
                self.assertEqual(result["language"], language, result)
                self.assertIn(reply_text, result["reply"], result)
                self.assertFalse(result["requires_clarification"], result)

        self.assertEqual(classify_message("who are you?")["intent"], "chat_identity")
        self.assertNotEqual(classify_message("can a gay renter book a car?")["intent"], "chat_gender_identity")
        self.assertNotEqual(classify_message("do you have a female driver?")["intent"], "chat_gender_identity")
        self.assertNotEqual(classify_message("bading ba si owner?")["intent"], "chat_gender_identity")
        self.assertNotEqual(classify_message("tomboy ba ang driver?")["intent"], "chat_gender_identity")

    def test_femboy_questions_explain_gender_expression_in_each_style(self):
        cases = {
            "are you a femboy?": ("en", "gender expression"),
            "femboy ka ba?": ("fil", "pagpapahayag ng kasarian"),
            "reply in Taglish: femboy ka ba?": ("taglish", "gender expression"),
            "are you a fem-boy?": ("en", "gender expression"),
        }
        for message, (language, reply_text) in cases.items():
            with self.subTest(message=message):
                result = classify_message(message, "auto")
                self.assertEqual(result["intent"], "chat_gender_identity", result)
                self.assertEqual(result["language"], language, result)
                self.assertIn(reply_text, result["reply"], result)
                self.assertIn("oryentasyon" if language == "fil" else "orientation", result["reply"])
                self.assertFalse(result["requires_clarification"], result)

        for message, language in (
            ("what does femboy mean?", "en"),
            ("ano ang ibig sabihin ng femboy?", "fil"),
            ("femboy sexual orientation", "en"),
        ):
            with self.subTest(message=message):
                result = classify_message(message, "auto")
                self.assertEqual(result["intent"], "chat_gender_identity", result)
                self.assertEqual(result["language"], language, result)
                self.assertNotIn("I'm an AI assistant", result["reply"])
                self.assertNotIn("AI assistant ako", result["reply"])

        self.assertNotEqual(classify_message("can a femboy rent a car?")["intent"], "chat_gender_identity")
        self.assertNotEqual(classify_message("femboy ba ang driver?")["intent"], "chat_gender_identity")

    def test_ambiguous_payment_requests_clarification(self):
        result = classify_message("payment", "auto")
        self.assertEqual(result["intent"], "REJECT")
        self.assertTrue(result["requires_clarification"])
        self.assertGreaterEqual(len(result["alternatives"]), 2)
        self.assertIn("30%", result["reply"])

    def test_classifier_returns_valid_structured_metadata(self):
        result = classify_message("lat retrn fee", "auto")
        self.assertEqual(result["intent"], "late_return_policy")
        self.assertIn(result["language"], {"en", "fil", "taglish"})
        self.assertIsInstance(result["alternatives"], list)
        self.assertIsInstance(result["requires_live_data"], bool)
        self.assertEqual(result["reason_code"], "controlled_alias")

    def test_controlled_textese_normalization_routes_incomplete_english_and_filipino(self):
        cases = {
            "r u an ai?": ("chat_identity", "en", {"brand": None, "model": None}),
            "anu mga pwdng renthan?": ("vehicle_categories", "fil", {"brand": None, "model": None}),
            "is thre a ford rptor availble?": (
                "vehicle_brand_search",
                "en",
                {"brand": "Ford", "model": "Raptor"},
            ),
            "kya m ba mgslita ng tgalog?": (
                "chat_language_support",
                "fil",
                {"brand": None, "model": None},
            ),
            "what paymnt methods do you accept?": (
                "payment_methods",
                "en",
                {"brand": None, "model": None},
            ),
            "is insurane included?": (
                "insurance_included",
                "en",
                {"brand": None, "model": None},
            ),
        }
        for message, (intent, language, entities) in cases.items():
            with self.subTest(message=message):
                result = classify_message(message, "auto")
                self.assertFalse(result["requires_clarification"], result)
                self.assertEqual(result["intent"], intent, result)
                self.assertEqual(result["language"], language, result)
                self.assertEqual(result["entities"], entities, result)

        self.assertEqual(
            normalize_informal_text("Can I pay 30% on 2026-09-30?"),
            "can i pay 30% on 2026-09-30",
        )
        categories = classify_message("anu mga pwdng renthan?", "auto")
        self.assertIn("mga kotse", categories["reply"])

    def test_vehicle_brand_and_model_entities(self):
        cases = {
            "Toyota": ("vehicle_brand_search", "Toyota", None),
            "toyota": ("vehicle_brand_search", "Toyota", None),
            "may Honda ba?": ("vehicle_brand_search", "Honda", None),
            "Toyota Vios": ("vehicle_brand_search", "Toyota", "Vios"),
            "Honda Click": ("vehicle_brand_search", "Honda", "Click"),
            "may available bang Toyota bukas?": ("vehicle_brand_search", "Toyota", None),
            "how much is the Toyota Vios?": ("rental_rate", "Toyota", "Vios"),
        }
        for message, (intent, brand, model) in cases.items():
            with self.subTest(message=message):
                result = classify_message(message, "auto")
                self.assertEqual(result["intent"], intent, result)
                self.assertEqual(result["entities"]["brand"], brand)
                self.assertEqual(result["entities"]["model"], model)
                if "bukas" in message:
                    self.assertIn("bukas", result["entities"]["requested_schedule"])

    def test_tagalog_brand_questions_keep_filipino_language_without_inventing_models(self):
        cases = {
            "may Toyota ba?": "Toyota",
            "Ford meron?": "Ford",
            "Ford mayroon?": "Ford",
            "meron bang Nissan?": "Nissan",
        }
        for message, brand in cases.items():
            with self.subTest(message=message):
                result = classify_message(message, "auto")
                self.assertEqual(result["intent"], "vehicle_brand_search", result)
                self.assertEqual(result["language"], "fil", result)
                self.assertEqual(result["entities"], {"brand": brand, "model": None})

    def test_brand_confusions_and_safe_typo_handling(self):
        category = classify_message("do you have SUVs?", "auto")
        self.assertNotEqual(category["intent"], "vehicle_brand_search")
        self.assertEqual(category["entities"]["brand"], None)
        self.assertEqual(category["entities"]["model"], None)
        self.assertEqual(category["entities"]["category"], "suv")

        nonsense = classify_message("asdfgh", "auto")
        self.assertEqual(nonsense["intent"], "nonsense_message")

        typo = classify_message("toyotaa", "auto")
        self.assertEqual(typo["intent"], "REJECT")
        self.assertTrue(typo["requires_clarification"])
        self.assertEqual(typo["reason_code"], "brand_spelling_clarification")
        self.assertIn("Toyota", typo["reply"])

        unknown_brand = classify_message("Do you have ABC Motors?", "auto")
        self.assertEqual(unknown_brand["intent"], "REJECT")
        self.assertTrue(unknown_brand["requires_clarification"])
        self.assertEqual(unknown_brand["entities"], {"brand": None, "model": None})

    def test_every_intent_is_reachable_through_a_declared_example(self):
        for item in INTENTS_BY_ID.values():
            with self.subTest(intent=item["id"]):
                result = classify_message(item["examples"][0], "auto")
                self.assertEqual(result["intent"], item["id"])
                if item["id"] == "booking_pickup_time":
                    self.assertEqual(result["clarification"]["field"], "booking")
                else:
                    self.assertFalse(result["requires_clarification"])

    def test_vehicle_conditions_and_model_boundaries(self):
        cases = [
            ("How much is a Toyota Vios per day?", "rental_rate", "en", "Vios", "day"),
            ("Magkano ang Toyota Vios bawat araw?", "rental_rate", "fil", "Vios", "day"),
            ("Magkano yung Toyota Vios per day?", "rental_rate", "taglish", "Vios", "day"),
            ("Toyota Vios tomorrow", "vehicle_brand_search", "en", "Vios", None),
            ("Toyota Vios available today", "vehicle_brand_search", "en", "Vios", None),
            ("Toyota Vios automatic", "vehicle_brand_search", "en", "Vios", None),
            ("Toyota Vios under ₱2,000", "available_vehicles", "en", "Vios", None),
            ("Toyota Vios for 3 days", "vehicle_brand_search", "en", "Vios", None),
        ]
        for message, intent, language, model, unit in cases:
            with self.subTest(message=message):
                result = classify_message(message)
                self.assertEqual(result["intent"], intent, result)
                self.assertEqual(result["language"], language, result)
                self.assertEqual(result["entities"]["brand"], "Toyota", result)
                self.assertEqual(result["entities"]["model"], model, result)
                self.assertEqual(result["entities"].get("rate_unit"), unit, result)

    def test_budget_search_and_missing_unit_clarification(self):
        cases = [
            ("Are there SUVs under ₱2,000?", "en", 2000, None),
            ("May SUV ba under ₱2,000 per day?", "taglish", 2000, "day"),
            ("May SUV bang mas mababa sa ₱2,000 bawat araw?", "fil", 2000, "day"),
            ("show me vans below ₱3,000 daily", "en", 3000, "day"),
            ("van below 500 per hour", "en", 500, "hour"),
            ("may SUV under 2k per day?", "taglish", 2000, "day"),
        ]
        for message, language, budget, unit in cases:
            with self.subTest(message=message):
                result = classify_message(message)
                self.assertEqual(result["intent"], "available_vehicles", result)
                self.assertEqual(result["language"], language, result)
                self.assertEqual(result["entities"]["max_budget"], budget, result)
                self.assertEqual(result["entities"]["currency"], "PHP", result)
                self.assertEqual(result["entities"].get("rate_unit"), unit, result)
                if unit is None:
                    self.assertEqual(result["clarification"], {"required": True, "type": "missing_entity", "field": "rate_unit"})
                    self.assertIn("2,000", result["reply"])

    def test_compound_payment_pickup_and_reply_style(self):
        payment = classify_message("Can I pay 30% now and the balance after the due date?")
        self.assertEqual(payment["intent"], "payment_downpayment")
        self.assertEqual(payment["conditions"], {
            "downpayment_percent": 30, "remaining_balance": True, "payment_after_due_date": True,
        })
        taglish_payment = classify_message("Pwede bang 30% muna tapos balanse pagkatapos ng due date?")
        self.assertEqual(taglish_payment["intent"], "payment_downpayment")
        self.assertEqual(taglish_payment["language"], "taglish")
        self.assertEqual(taglish_payment["conditions"], payment["conditions"])
        balance = classify_message("Can I pay the remaining balance after the deadline?")
        self.assertEqual(balance["intent"], "unpaid_balance")
        self.assertEqual(balance["conditions"], {
            "remaining_balance": True, "payment_after_due_date": True,
        })
        for message, language in [
            ("What time can I pick up the car?", "en"),
            ("Anong oras ko kukunin yung car?", "taglish"),
            ("Anong oras ko maaaring kunin ang sasakyan?", "fil"),
        ]:
            with self.subTest(message=message):
                result = classify_message(message)
                self.assertEqual(result["intent"], "booking_pickup_time")
                self.assertEqual(result["language"], language)
                self.assertEqual(result["clarification"]["field"], "booking")
        directed = classify_message("Reply in Filipino: how much is the Toyota Vios?")
        self.assertEqual((directed["intent"], directed["language"]), ("rental_rate", "fil"))
        self.assertEqual(classify_message("oo", previous_language="taglish")["language"], "taglish")
        self.assertEqual(classify_message("salamat", previous_language="en")["language"], "fil")
        self.assertEqual(classify_message("thanks", previous_language="fil")["language"], "en")
        self.assertEqual(classify_message("Answer in English.", previous_language="taglish")["language"], "en")
        followup = classify_message("per day", previous_language="taglish", previous_context={
            "category": "suv", "max_budget": 2000, "currency": "PHP",
        })
        self.assertEqual(followup["intent"], "available_vehicles")
        self.assertEqual(followup["language"], "taglish")
        self.assertEqual(followup["entities"]["rate_unit"], "day")


class ChatbotLanguageAndAvailabilityTests(unittest.TestCase):
    def test_language_questions_state_actual_supported_languages(self):
        for message, named_language in [
            ("do you know spanish?", "Spanish"),
            ("walang bisaya?", "Bisaya"),
            ("marunong ka ba mag ilonggo?", "Ilonggo"),
            ("are you good at ilocano?", "Ilocano"),
            ("Hindi ka marunong mag Ilokano?", "Ilocano"),
            ("Bisaya lang please", "Bisaya"),
            ("Kaya mo mag bisya?", "Bisaya"),
            ("Can you reply in Spanish?", "Spanish"),
            ("Can you translate deposit into Spanish?", "Spanish"),
        ]:
            with self.subTest(message=message):
                result = classify_message(message)
                self.assertEqual(result["intent"], "chat_language_support")
                self.assertFalse(result["requires_clarification"])
                self.assertFalse(result["requires_live_data"])
                self.assertIn(named_language, result["reply"])
                self.assertIn("English", result["reply"])
                self.assertIn("Filipino", result["reply"])
                self.assertIn("Taglish", result["reply"])
                self.assertNotRegex(result["reply"], r"^(Yes|Oo)\b")
                self.assertTrue("supported" in result["reply"] or "suportado" in result["reply"])
        mixed = classify_message("Can you speak Spanish and Tagalog?")
        self.assertIn("Spanish replies aren't supported", mixed["reply"])
        self.assertIn("I can reply in Filipino", mixed["reply"])
        for message in ["What languages do you support?", "Can you speak Tagalog?", "Can you speak Klingon?"]:
            self.assertEqual(classify_message(message)["intent"], "chat_language_support")
        directed = classify_message("Reply in Filipino: do you know Spanish?")
        self.assertEqual(directed["language"], "fil")
        self.assertIn("Hindi pa suportado", directed["reply"])
        for message, style in [("Tagalog please", "fil"), ("English lang", "en"), ("Taglish pls", "taglish")]:
            result = classify_message(message, previous_language="en")
            self.assertEqual(result["intent"], "chat_language_support")
            self.assertEqual(result["language"], style)

    def test_unavailable_page_and_list_requests_do_not_recommend_available_cars(self):
        for message in [
            "Bakit hindi lumalabas yung unavailable na sasakyan sa vehicles page?",
            "Why did a vehicle disappear from the available list?",
        ]:
            with self.subTest(message=message):
                result = classify_message(message)
                self.assertEqual(result["intent"], "vehicle_unavailability")
                self.assertFalse(result["requires_live_data"])
                self.assertIn("Vehicles page", result["reply"])
        for message in ["Show me unavailable cars", "Ipakita ang mga unavailable na sasakyan"]:
            result = classify_message(message)
            self.assertEqual(result["intent"], "vehicle_availability_status")
            self.assertTrue(result["conditions"]["vehicle_status_list"])
            self.assertTrue(result["requires_live_data"])
        alternatives = classify_message("Hindi available yung gusto ko. Ano pa pwede?")
        self.assertEqual(alternatives["intent"], "available_vehicles")
        self.assertTrue(alternatives["requires_live_data"])
        self.assertEqual(alternatives["entities"]["brand"], None)

    def test_vehicle_status_preserves_model_and_requires_a_live_lookup(self):
        for message, model in [
            ("Is the Honda City currently unavailable?", "City"),
            ("May Toyota Vios kahit unavailable?", "Vios"),
            ("Unavailable ba yung Toyota Vios o wala kayong listing?", "Vios"),
            ("When will Honda City be available again? It is unavailable.", "City"),
            ("When will Honda City be available again?", "City"),
        ]:
            with self.subTest(message=message):
                result = classify_message(message)
                self.assertEqual(result["intent"], "vehicle_availability_status")
                self.assertTrue(result["requires_live_data"])
                self.assertEqual(result["entities"]["model"], model)
        for message in ["Are there unavailable vehicles?", "Are all your vehicles unavailable?", "May unavailable bang SUV?"]:
            result = classify_message(message)
            self.assertEqual(result["intent"], "vehicle_availability_status")
            self.assertTrue(result["conditions"]["vehicle_status_overview"])
        unknown = classify_message("When will the unavailable car be available again?")
        self.assertEqual(unknown["intent"], "vehicle_availability_status")
        self.assertTrue(unknown["requires_clarification"])
        self.assertEqual(unknown["clarification"]["field"], "model")
        self.assertFalse(unknown["requires_live_data"])

    def test_scope_gate_precedes_brand_and_policy_aliases(self):
        messages = [
            "Cancel my Netflix subscription", "Pay my electricity bill with GCash",
            "How much is Toyota stock?", "How many passengers fit an airplane?",
            "What are library late book return fees?", "Does flight insurance include travel insurance?",
            "Do you rent Honda generators?", "Maya savings interest rate?",
            "How do I drive a manual car?", "How can I get a driver license online?",
            "Amazon payment methods?", "Generate a poem about renting a Toyota",
            "Can I extend my student visa?", "How do I book a hotel in Cebu?",
        ]
        for message in messages:
            with self.subTest(message=message):
                result = classify_message(message)
                self.assertEqual(result["intent"], "REJECT")
                self.assertEqual(result["reason_code"], "outside_scope")
                self.assertFalse(result["requires_live_data"])
                self.assertFalse(result["requires_clarification"])
                self.assertEqual(result["entities"], {"brand": None, "model": None})

    def test_practical_paraphrases_and_textese(self):
        cases = {
            "may matic ba kau?": "available_transmission",
            "pano po mag rent dito": "how_to_book",
            "pno icancel ung booking q?": "booking_cancellation",
            "pde iextend ung renta?": "booking_extension",
            "ano reqs pra maka rent?": "rental_requirements",
            "di q gets": "unclear_message",
            "saan makikita status ng booking q": "booking_status",
            "What do I need before I can hire a vehicle?": "rental_requirements",
            "May I rent a car on the day I make the request?": "same_day_rental",
            "Can I have two rentals for the exact same weekend?": "schedule_conflict",
            "Have I already cleared all my rental payments?": "my_unpaid_balance",
            "May kulang pa ba sa bayad ko?": "my_unpaid_balance",
            "Magkano pa kailangan kong bayaran?": "my_unpaid_balance",
            "Is there any rental currently running on my account?": "my_active_bookings",
            "Lagpas na ba ako sa oras ng pagsoli?": "my_overdue_return",
        }
        for message, intent in cases.items():
            with self.subTest(message=message):
                result = classify_message(message)
                self.assertEqual(result["intent"], intent, result)

    def test_compound_questions_keep_live_rates_payment_and_scope_separate(self):
        result = classify_message("How much is Toyota Vios per day and can I pay 30% with GCash?")
        self.assertEqual(result["intent"], "rental_rate")
        self.assertEqual(result["entities"]["model"], "Vios")
        self.assertEqual([item["intent"] for item in result["additional_answers"]], ["payment_downpayment", "payment_methods"])
        mixed = classify_message("What payment methods are supported? How much is Toyota stock?")
        self.assertEqual(mixed["intent"], "payment_methods")
        self.assertEqual(mixed["additional_answers"][0]["reason_code"], "outside_scope")
        unsupported = classify_message("How to book? What payment methods? How to cancel a booking? How to extend a booking?")
        self.assertEqual(unsupported["intent"], "REJECT")
        self.assertEqual(unsupported["reason_code"], "too_many_questions")

    def test_search_followups_keep_filters_but_refresh_live_data(self):
        context = {"intent": "available_vehicles", "entities": {"brand": None, "model": None,
            "category": "suv", "max_budget": 2000, "currency": "PHP", "transmission": "automatic", "location": "cebu"},
            "clarification": {"required": True, "type": "missing_entity", "field": "rate_unit"}, "choices": []}
        daily = classify_message("per day", previous_context=context)
        self.assertEqual(daily["intent"], "available_vehicles")
        self.assertEqual(daily["entities"]["location"], "cebu")
        self.assertEqual(daily["entities"]["rate_unit"], "day")
        self.assertTrue(daily["requires_live_data"])
        affirmative = classify_message("yes", previous_context=context)
        self.assertEqual(affirmative["clarification"]["field"], "rate_unit")
        self.assertFalse(affirmative["requires_live_data"])
        context["entities"] = daily["entities"]
        context["choices"] = [{"brand": "Ford", "model": "Everest"}, {"brand": "Toyota", "model": "Fortuner"}]
        tomorrow = classify_message("How about tomorrow?", previous_context=context)
        self.assertEqual(tomorrow["intent"], "available_vehicles")
        self.assertEqual(tomorrow["entities"]["max_budget"], 2000)
        first = classify_message("How much is the first one?", previous_context=context)
        self.assertEqual(first["intent"], "rental_rate")
        self.assertEqual(first["entities"]["brand"], "Ford")
        self.assertEqual(first["entities"]["model"], "Everest")
        changed = classify_message("What about Honda?", previous_context={"intent": "vehicle_brand_search",
            "entities": {"brand": "Toyota", "model": "Vios"}})
        self.assertEqual(changed["entities"], {"brand": "Honda", "model": None})
        fresh = classify_message("How much is Toyota stock?", previous_context=context)
        self.assertEqual(fresh["reason_code"], "outside_scope")
        missing = classify_message("third one", previous_context=context)
        self.assertEqual(missing["reason_code"], "missing_vehicle_choice")
        self.assertFalse(missing["requires_live_data"])
        private_text = classify_message("Toyota Vios tomorrow, contact bob@example.com")
        self.assertEqual(private_text["entities"]["requested_schedule"], "tomorrow")
        self.assertNotIn("bob", private_text["entities"]["requested_schedule"])
        stock = classify_message("Do you have Toyota cars in stock?")
        self.assertNotEqual(stock["reason_code"], "outside_scope")

    def test_negated_transmission_and_brand_order_do_not_change_the_requested_filters(self):
        result = classify_message("Not manual, show automatic cars instead")
        self.assertEqual(result["entities"]["transmission"], "automatic")
        self.assertEqual(result["entities"]["excluded_transmissions"], ["manual"])
        excluded = classify_message("I don't want Toyota, show Honda instead")
        self.assertEqual(excluded["entities"]["brand"], "Honda")
        self.assertEqual(excluded["entities"]["excluded_brands"], ["Toyota"])

    def test_unavailable_status_budget_clarification_retains_overview_and_location(self):
        initial = classify_message("Are there unavailable SUVs in Cebu under PHP 2000?")
        self.assertEqual(initial["intent"], "vehicle_availability_status")
        self.assertEqual(initial["clarification"]["field"], "rate_unit")
        self.assertFalse(initial["requires_live_data"])
        followup = classify_message("per day", previous_context={"intent": initial["intent"],
            "entities": initial["entities"], "clarification": initial["clarification"]})
        self.assertEqual(followup["intent"], "vehicle_availability_status")
        self.assertEqual(followup["entities"]["location"], "cebu")
        self.assertTrue(followup["conditions"]["vehicle_status_overview"])
        self.assertTrue(followup["requires_live_data"])

    def test_yes_confirms_only_an_explicit_brand_suggestion_and_untrusted_context_is_ignored(self):
        suggestion = classify_message("toyotaa")
        yes = classify_message("yes", previous_context={"intent": "REJECT", "entities": suggestion["entities"],
            "clarification": suggestion["clarification"], "suggested_brand": suggestion["suggested_brand"]})
        self.assertEqual(yes["entities"]["brand"], "Toyota")
        self.assertTrue(yes["requires_live_data"])
        poisoned = classify_message("per day", previous_context={"intent": "my_unpaid_balance", "entities": {"renterId": "someone-else"}})
        self.assertNotEqual(poisoned["intent"], "my_unpaid_balance")
        for malformed in [{"intent": []}, {"intent": "available_vehicles", "entities": {"rate_unit": []}}]:
            self.assertEqual(classify_message("per day", previous_context=malformed)["intent"], "rental_rate")
        other = classify_message("What is another renter's balance?")
        self.assertEqual(other["reason_code"], "private_record_scope")

    def test_other_contexts_are_not_promoted_to_vehicle_status(self):
        for message in ["my payment method is unavailable", "why is my Netflix account unavailable"]:
            result = classify_message(message)
            self.assertNotIn(result["intent"], {"vehicle_unavailability", "vehicle_availability_status"})
        for message in ["does the vehicle owner speak Spanish?", "is the driver Ilonggo?", "may sasakyan ba sa Ilocos?"]:
            self.assertNotEqual(classify_message(message)["reason_code"], "language_capability")

    def test_topic_and_action_context_rejects_injected_metadata(self):
        valid = {"intent": "REJECT", "topic": "payment", "entities": {},
            "clarification": {"required": True, "type": "ambiguous_intent", "field": None},
            "candidate_intents": ["payment_methods", "payment_downpayment", "unpaid_balance"]}
        self.assertEqual(classify_message("methods", previous_context=valid)["reason_code"], "clarification_answer")
        for invalid in [
            {**valid, "candidate_intents": ["my_unpaid_balance"]},
            {**valid, "topic": []},
            {**valid, "conditions": {"paymentAmount": 1}},
            {**valid, "clarification": {"required": True, "type": [], "field": []}},
            {**valid, "candidate_intents": [[], "payment_methods"]},
        ]:
            self.assertNotEqual(classify_message("methods", previous_context=invalid)["reason_code"], "clarification_answer")


if __name__ == "__main__":
    unittest.main()
