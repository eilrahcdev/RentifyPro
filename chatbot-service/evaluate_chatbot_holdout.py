"""Evaluate held-out classifier results and Node fulfillment with a fixed vehicle snapshot."""

import argparse
import json
import subprocess
from collections import Counter
from pathlib import Path

from app import classify_message, CONFIG, INTENTS_BY_ID, POSITIVE_ROWS, normalize_for_match


BASE_DIR = Path(__file__).parent
CASES_PATH = BASE_DIR / "chatbot_holdout.json"
COVERAGE_PATH = BASE_DIR / "chatbot_coverage.json"
FULFILL_PATH = BASE_DIR.parent / "backend" / "scripts" / "chatbot-holdout-fulfill.mjs"


def compare_fields(actual, expected, prefix, failures, category):
    for key, value in expected.items():
        observed = actual.get(key) if isinstance(actual, dict) else None
        if observed != value:
            failures.append({"category": category, "field": f"{prefix}.{key}", "expected": value, "actual": observed})


def evaluate():
    document = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    if document.get("schema_version") != "v1" or not document.get("cases"):
        raise RuntimeError("Invalid chatbot holdout set")
    coverage = json.loads(COVERAGE_PATH.read_text(encoding="utf-8"))
    if coverage.get("schema_version") != "v1":
        raise RuntimeError("Invalid chatbot coverage set")
    cases = document["cases"] + coverage["cases"]
    tested_intents = {case["intent"] for case in coverage["cases"]}
    if not set(INTENTS_BY_ID).issubset(tested_intents):
        raise RuntimeError("Coverage set must exercise every supported intent")
    positives = {normalize_for_match(row["text"]) for row in POSITIVE_ROWS}
    overlaps = [case["id"] for case in cases if normalize_for_match(case["input"]) in positives]
    if overlaps:
        raise RuntimeError(f"Holdout questions overlap training examples or aliases: {overlaps}")
    classified = [
        classify_message(case["input"], "auto", case.get("previous_language"), case.get("previous_context"))
        for case in cases
    ]
    repeated = [
        classify_message(case["input"], "auto", case.get("previous_language"), case.get("previous_context"))
        for case in cases
    ]
    requests = [{"message": case["input"], "classifier": result} for case, result in zip(cases, classified)]
    process = subprocess.run(
        ["node", str(FULFILL_PATH)], input=json.dumps(requests + requests, ensure_ascii=False),
        capture_output=True, text=True, encoding="utf-8", timeout=30, check=True,
    )
    fulfilled = json.loads(process.stdout)
    if len(fulfilled) != len(cases) * 2:
        raise RuntimeError("Node fulfillment returned the wrong number of cases")

    failures = []
    passed = 0
    by_topic = {}
    unnecessary_clarifications = 0
    direct_answer_total = sum(case["intent"] != "REJECT" and not case.get("clarification", {}).get("required") for case in cases)
    for index, (case, classifier, again, final) in enumerate(zip(cases, classified, repeated, fulfilled)):
        issues = []
        if classifier != again or final != fulfilled[index + len(cases)]:
            issues.append({"category": "nondeterministic", "field": "result"})
        if classifier["intent"] != case["intent"] or final["intent"] != case["intent"]:
            issues.append({"category": "wrong_intent", "field": "intent", "actual": classifier["intent"]})
        if classifier["language"] != case["language"] or final["language"] != case["language"]:
            issues.append({"category": "wrong_language", "field": "language", "actual": classifier["language"]})
        compare_fields(classifier.get("entities"), case.get("entities", {}), "entities", issues, "bad_entity")
        compare_fields(classifier.get("conditions"), case.get("conditions", {}), "conditions", issues, "missing_condition")
        compare_fields(final.get("clarification"), case.get("clarification", {}), "clarification", issues, "irrelevant_clarification")
        if final.get("clarification", {}).get("required") and case["intent"] != "REJECT" and not case.get("clarification", {}).get("required"):
            unnecessary_clarifications += 1
            issues.append({"category": "unnecessary_clarification", "field": "clarification.required"})
        if final.get("additional_intents") != case.get("additional_intents", []):
            issues.append({"category": "incomplete_compound_answer", "field": "additional_intents", "actual": final.get("additional_intents")})
        if "reason_code" in case and final.get("reason_code") != case["reason_code"]:
            issues.append({"category": "unsafe_routing", "field": "reason_code", "actual": final.get("reason_code")})
        ids = [vehicle["id"] for vehicle in final["recommendations"]]
        if ids != case.get("recommendations", []):
            issues.append({"category": "incorrect_live_lookup", "field": "recommendations", "expected": case.get("recommendations", []), "actual": ids})
        if "display_rate" in case and (not final["recommendations"] or final["recommendations"][0]["displayRate"] != case["display_rate"]):
            issues.append({"category": "wrong_rate_unit", "field": "display_rate"})
        if "display_rate_unit" in case and (not final["recommendations"] or final["recommendations"][0]["displayRateUnit"] != case["display_rate_unit"]):
            issues.append({"category": "wrong_rate_unit", "field": "display_rate_unit"})
        reply = final["reply"].casefold()
        for phrase in case.get("reply_contains", []):
            if phrase.casefold() not in reply:
                issues.append({"category": "incomplete_or_irrelevant_reply", "field": "reply_contains", "missing": phrase})
        for phrase in case.get("reply_excludes", []):
            if phrase.casefold() in reply:
                issues.append({"category": "hallucinated_or_irrelevant_reply", "field": "reply_excludes", "unexpected": phrase})
        topic = next((name for name, spec in CONFIG["topics"].items() if case["intent"] in spec["intents"]), "scope_or_clarification")
        stats = by_topic.setdefault(topic, {"total": 0, "passed": 0})
        stats["total"] += 1
        stats["passed"] += not issues
        if issues:
            failures.append({"case": case["id"], "input": case["input"], "issues": issues})
        else:
            passed += 1
    conversation_turns = 0
    for conversation in coverage["conversations"]:
        context = None
        language = None
        for index, turn in enumerate(conversation["turns"]):
            if turn.get("reset"):
                context, language = None, None
            classifier = classify_message(turn["input"], "auto", language, context)
            repeated = classify_message(turn["input"], "auto", language, context)
            request = {"message": turn["input"], "classifier": classifier}
            process = subprocess.run(["node", str(FULFILL_PATH)], input=json.dumps([request, request], ensure_ascii=False),
                capture_output=True, text=True, encoding="utf-8", timeout=30, check=True)
            final, again = json.loads(process.stdout)
            issues = []
            if classifier != repeated or final != again:
                issues.append({"category": "nondeterministic", "field": "result"})
            if classifier["intent"] != turn["intent"] or final["intent"] != turn["intent"]:
                issues.append({"category": "wrong_intent", "field": "intent", "actual": classifier["intent"]})
            compare_fields(final.get("clarification"), turn.get("clarification", {}), "clarification", issues, "irrelevant_clarification")
            compare_fields(final.get("entities"), turn.get("entities", {}), "entities", issues, "bad_entity")
            direct_answer_total += turn["intent"] != "REJECT" and not turn.get("clarification", {}).get("required")
            if final.get("clarification", {}).get("required") and turn["intent"] != "REJECT" and not turn.get("clarification", {}).get("required"):
                unnecessary_clarifications += 1
            for phrase in turn.get("reply_contains", []):
                if phrase.casefold() not in final["reply"].casefold():
                    issues.append({"category": "incomplete_or_irrelevant_reply", "field": "reply_contains", "missing": phrase})
            for phrase in turn.get("reply_excludes", []):
                if phrase.casefold() in final["reply"].casefold():
                    issues.append({"category": "hallucinated_or_irrelevant_reply", "field": "reply_excludes", "unexpected": phrase})
            if "recommendations" in turn and [v["id"] for v in final["recommendations"]] != turn["recommendations"]:
                issues.append({"category": "incorrect_live_lookup", "field": "recommendations"})
            conversation_turns += 1
            topic = next((name for name, spec in CONFIG["topics"].items() if turn["intent"] in spec["intents"]), "scope_or_clarification")
            stats = by_topic.setdefault(topic, {"total": 0, "passed": 0})
            stats["total"] += 1
            stats["passed"] += not issues
            if issues:
                failures.append({"case": f"{conversation['id']}/{index + 1}", "input": turn["input"], "issues": issues})
            else:
                passed += 1
            context, language = final["conversation_context"], final["language"]
    categories = Counter(issue["category"] for failure in failures for issue in failure["issues"])
    for stats in by_topic.values():
        stats["accuracy"] = round(stats["passed"] / stats["total"], 4)
    return {"total": len(cases) + conversation_turns, "passed": passed, "failed": len(failures),
            "covered_intents": len(tested_intents - {"REJECT"}), "training_overlap": len(overlaps),
            "by_topic": by_topic, "conversation_turns": conversation_turns,
            "unnecessary_clarifications": unnecessary_clarifications,
            "unnecessary_clarification_rate": round(unnecessary_clarifications / max(1, direct_answer_total), 4),
            "failure_categories": dict(categories), "failures": failures}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = evaluate()
    if args.json:
        print(json.dumps(result, ensure_ascii=True, indent=2))
    else:
        print(f"Chatbot holdout: {result['passed']}/{result['total']} passed")
        for failure in result["failures"]:
            print(f"- {failure['case']}: {failure['issues']}")
    raise SystemExit(0 if result["failed"] == 0 else 1)
