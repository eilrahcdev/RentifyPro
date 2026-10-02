import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

from app import CONFIG, classify_message


BASE_DIR = Path(__file__).parent
EVALUATION_PATH = BASE_DIR / "chatbot_evaluation.json"


def load_cases(path: Path = EVALUATION_PATH) -> List[Dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("schema_version") != "v1":
        raise RuntimeError(f"Invalid chatbot evaluation dataset: {path}")
    cases = raw.get("cases")
    if not isinstance(cases, list) or not cases:
        raise RuntimeError(f"No chatbot evaluation cases found: {path}")
    return cases


def evaluate(cases: List[Dict[str, Any]]) -> Dict[str, Any]:
    failures = []
    correct = 0
    clarification_total = 0
    clarification_correct = 0

    for index, case in enumerate(cases):
        message = str(case.get("input") or "")
        result = classify_message(message, "auto")
        expected_behavior = case.get("expected_behavior")
        expected_intent = case.get("expected_intent")
        expected_language = case.get("expected_language")
        expected_entities = case.get("expected_entities")

        if expected_behavior == "clarification":
            clarification_total += 1
            passed = bool(result.get("requires_clarification")) and result.get("intent") == "REJECT"
            if passed:
                clarification_correct += 1
        else:
            passed = (
                result.get("intent") == expected_intent
                and not result.get("requires_clarification")
            )

        if passed and expected_language:
            passed = result.get("language") == expected_language
        if passed and isinstance(expected_entities, dict):
            actual_entities = result.get("entities") or {}
            passed = all(actual_entities.get(key) == value for key, value in expected_entities.items())

        if passed:
            correct += 1
            continue

        failures.append({
            "case": index + 1,
            "input": message,
            "expected_intent": expected_intent,
            "expected_behavior": expected_behavior,
            "expected_language": expected_language,
            "expected_entities": expected_entities,
            "actual_intent": result.get("intent"),
            "actual_language": result.get("language"),
            "actual_entities": result.get("entities"),
            "confidence": result.get("confidence"),
            "reason_code": result.get("reason_code"),
            "alternatives": result.get("alternatives", []),
        })

    total = len(cases)
    accuracy = correct / total if total else 0.0
    return {
        "total": total,
        "correct": correct,
        "incorrect": total - correct,
        "clarifications_total": clarification_total,
        "clarifications_correct": clarification_correct,
        "accuracy": accuracy,
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate the RentifyPro chatbot intent classifier.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument(
        "--minimum-accuracy",
        type=float,
        default=float(CONFIG.get("evaluation_min_accuracy", 0.9)),
        help="Exit unsuccessfully below this accuracy (default comes from chatbot_config.json).",
    )
    args = parser.parse_args()

    summary = evaluate(load_cases())
    if args.json:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
    else:
        print("Chatbot Evaluation")
        print(f"Total: {summary['total']}")
        print(f"Correct: {summary['correct']}")
        print(f"Incorrect: {summary['incorrect']}")
        print(
            "Clarifications correct: "
            f"{summary['clarifications_correct']}/{summary['clarifications_total']}"
        )
        print(f"Accuracy: {summary['accuracy'] * 100:.1f}%")
        if summary["failures"]:
            print("Failures:")
            for failure in summary["failures"]:
                expected = failure["expected_behavior"] or failure["expected_intent"]
                print(
                    f"- #{failure['case']} {failure['input']!r}: expected {expected}, "
                    f"got {failure['actual_intent']} ({failure['confidence']})"
                )

    return 0 if summary["accuracy"] >= args.minimum_accuracy else 1


if __name__ == "__main__":
    raise SystemExit(main())
