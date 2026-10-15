import json
import subprocess
import unittest
from pathlib import Path

from app import classify_message


ROOT = Path(__file__).resolve().parent.parent
BRIDGE = ROOT / "backend/tests/helpers/chatbotRentalFulfill.mjs"


def listing(number, name, category, subtype, seats=2):
    return {"_id": f"{number:024x}", "name": name, "availabilityStatus": "available",
            "dailyRentalRate": 1200, "pricingUnit": "hourly", "location": "Cebu",
            "driverOptionEnabled": False,
            "specs": {"type": category, "subType": subtype, "seats": seats,
                      "transmission": "Automatic", "fuel": "Gasoline"}}


VEHICLES = [listing(951, "BMW M3", "car", "Sedan", 5),
            listing(952, "BMW X3", "car", "SUV", 5),
            listing(953, "Toyota Hiace", "van", "18 Seater", 18),
            listing(954, "Koenigsegg Agera RS", "car", "Hypercar"),
            listing(955, "Toyota Test Coupe", "car", "Supercar"),
            listing(956, "BMW Unclassified", "car", "", 5)]


def turn(message, language="auto", context=None, previous_language=None, vehicles=VEHICLES):
    classified = classify_message(message, language, previous_language=previous_language,
                                  previous_context=context)
    result = subprocess.run(["node", str(BRIDGE)], input=json.dumps([
        {"message": message, "classifier": classified, "vehicles": vehicles,
         "previous_context": context}]), cwd=ROOT, text=True, encoding="utf-8",
        capture_output=True, check=True)
    return json.loads(result.stdout)[0]


class PipelineQualityTests(unittest.TestCase):
    def test_gratitude_differs_from_acknowledgement_and_retains_task(self):
        task = turn("Can I extend my rental?")
        for message, style in [("okay, thanks", "en"), ("thank you", "en"),
                               ("thank you so much", "en"), ("salamat", "fil"),
                               ("salamat po", "fil"), ("okay, salamat", "taglish")]:
            with self.subTest(message=message):
                answer = turn(message, context=task["conversation_context"])
                self.assertEqual(answer["intent"], "chat_gratitude", answer)
                self.assertEqual(answer["language"], style, answer)
                self.assertGreater(len(answer["reply"]), 30)
                self.assertLess(len(answer["reply"]), 160)
                self.assertEqual(answer["conversation_context"]["intent"], "booking_extension")
                self.assertNotRegex(answer["reply"], r"approved|paid|automatically|next step")
        self.assertEqual(turn("okay")["intent"], "chat_acknowledgement")

    def test_payment_instructions_in_all_languages_and_auto_detection(self):
        for message, style in [("How do I pay for my booking?", "en"),
                               ("Paano makapagbayad ng booking?", "fil"),
                               ("How do I pay ang booking ko?", "taglish")]:
            with self.subTest(message=message):
                answer = turn(message)
                self.assertEqual(answer["intent"], "payment_methods", answer)
                self.assertEqual(answer["response_variant"], "instructions", answer)
                self.assertEqual(answer["language"], style, answer)
                self.assertIn("Pay Now", answer["reply"])
                self.assertIn("PayMongo", answer["reply"])
                self.assertNotIn("selfie", answer["reply"])
                self.assertNotRegex(answer["reply"], r"paidAmount|bookingId|renterId")
        answer = turn("Paano magbayad ng down payment?")
        self.assertEqual(answer["intent"], "payment_downpayment")
        self.assertEqual(answer["language"], "fil")
        self.assertIn("30%", answer["reply"])

    def test_general_policies_have_a_grounded_overview_and_specific_topics(self):
        for message, style in [("What policies does RentifyPro have?", "en"),
                               ("Ano ang mga patakaran ng RentifyPro?", "fil"),
                               ("What policies ang meron sa RentifyPro?", "taglish")]:
            with self.subTest(message=message):
                answer = turn(message)
                self.assertEqual(answer["intent"], "help_request", answer)
                self.assertEqual(answer["response_variant"], "policies", answer)
                self.assertEqual(answer["language"], style)
                self.assertIn("30%", answer["reply"])
                self.assertNotRegex(answer["reply"], r"guaranteed refund|refund within \d")
                for followup, intent in [("What is your cancellation policy?", "booking_cancellation"),
                                         ("May refund ba?", "rental_refund_guidance"),
                                         ("Ano ang policy sa late return?", "late_return_policy")]:
                    self.assertEqual(turn(followup, context=answer["conversation_context"])["intent"], intent)

    def test_brand_replacement_drops_capacity_but_explicit_refinement_retains_it(self):
        seats = turn("Is there an 18-seater?")
        self.assertEqual([v["name"] for v in seats["recommendations"]], ["Toyota Hiace"])
        brand = turn("How about BMW vehicles?", context=seats["conversation_context"])
        self.assertEqual(brand["entities"]["brand"], "BMW")
        self.assertNotIn("pax", brand["entities"])
        self.assertNotIn("seat_match", brand["entities"])
        self.assertTrue(brand["recommendations"])
        corrected = turn("I mean BMW vehicles for rent", context=brand["conversation_context"])
        self.assertEqual(corrected["entities"]["brand"], "BMW")
        self.assertNotIn("pax", corrected["entities"])
        automatic = turn("How about an automatic one?", context=seats["conversation_context"])
        self.assertEqual(automatic["entities"]["pax"], 18)
        self.assertEqual(automatic["entities"]["transmission"], "automatic")
        retained = turn("BMW with the same seat requirement", context=seats["conversation_context"])
        self.assertEqual(retained["entities"]["pax"], 18)
        self.assertEqual(retained["recommendations"], [])

    def test_subtypes_use_declared_specs_and_do_not_guess_from_brand(self):
        for message, subtype, name in [("May supercar ba?", "supercar", "Toyota Test Coupe"),
                                       ("May hypercar ba?", "hypercar", "Koenigsegg Agera RS"),
                                       ("Gusto ko supercar, hindi hypercar", "supercar", "Toyota Test Coupe")]:
            for language in ["en", "fil", "taglish"]:
                with self.subTest(message=message, language=language):
                    answer = turn(message, language)
                    self.assertFalse(answer["requires_clarification"], answer)
                    self.assertEqual(answer["entities"]["vehicle_subtype"], subtype, answer)
                    self.assertEqual([v["name"] for v in answer["recommendations"]], [name])
                    self.assertEqual(answer["recommendations"][0]["subtype"], subtype)
        first = turn("May Koenigsegg ba?")
        switched = turn("May supercar ba?", context=first["conversation_context"])
        self.assertNotIn("Koenigsegg", switched["reply"])
        excluded = turn("No hypercars please", context=first["conversation_context"])
        self.assertEqual(excluded["recommendations"], [])
        unknown = turn("May supercar ba?", vehicles=[VEHICLES[-1]])
        self.assertEqual(unknown["recommendations"], [])

    def test_explicit_language_switches_and_neutral_followups(self):
        initial = turn("Paano makapagbayad ng booking?")
        followup = turn("how?", context=initial["conversation_context"], previous_language="fil")
        self.assertEqual(followup["language"], "fil")
        switched = turn("How do I pay online?", context=initial["conversation_context"], previous_language="fil")
        self.assertEqual(switched["language"], "en")
        taglish = turn("How do I pay ang booking ko?", context=switched["conversation_context"], previous_language="en")
        self.assertEqual(taglish["language"], "taglish")


if __name__ == "__main__":
    unittest.main()
