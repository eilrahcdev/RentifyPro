# RentifyPro chatbot behavior and checks

Follow [the project setup guide](../README-SETUP.md) for dependencies, environment configuration, and the Node backend. This service uses the v6 dataset and supports English, Filipino, and Taglish replies. Questions about other languages receive an honest support limit.

Python owns question routing. It checks scope and private-record requests before brand or policy matching, normalizes common textese on a derived query, and returns structured intents. Node validates every primary and additional answer, supplies canonical policy replies, and reads current public vehicles or the authenticated renter's own booking records. Chat never approves bookings, records payments, bypasses verification, or edits listings.

The dataset covers payment troubleshooting, expired checkout, password reset, rejected verification and selfie checks, pickup location, rental problems, refunds, and owner listing, booking, and earnings guidance. Answers point to existing application controls. They do not promise payment success, a refund, approval, or private account values.

Up to three independent answers can be returned in one message. Follow-up context contains an intent, a topic, validated search filters, clarification metadata and candidate intents, bounded action flags, and up to three public brand/model choices. It carries no prices, renter IDs, booking records, or payment amounts. Every follow-up retrieves current records again. Starting a new chat clears context; stored conversations retain the existing account scope and expiry.

The `topics` map in `chatbot_config.json` assigns all 59 intents to one of eight topic families. Clear questions use specific action routes and multilingual semantic matching. Ambiguous topic words receive a focused choice: for example, `payment` asks about methods, the down payment, or balance rules, and `methods` answers that pending choice. Explicit topic changes stop vehicle filters from carrying into payment or account questions. Replies such as `why?` and `tell me more` retain the relevant approved policy. English uses of `at` and modal `may` are distinguished from Filipino wording.

`unavailable?` without context asks whether the user means vehicles or a payment option. General inventory wording such as `unavailable vehicles`, `is there any unavailable vehicle rn?`, and `the unavailable vehicle listing` checks current counts without requesting a model. `which ones?` or `list unavailable vehicles` lists up to three matching public names and reports any remaining count. A numbered follow-up resolves only choices actually shown. Questions about a particular vehicle still need a name and clarify ambiguous listings. `why are unavailable vehicles hidden?` explains the page filter, while alternative requests search available vehicles. Status names have no booking buttons and never become unavailable booking recommendations. Payment-option availability answers do not claim a provider outage; they direct the user to methods actually offered in checkout and the existing payment-status and reporting controls.

Searches honor supported vehicle category, transmission, passenger count, budget unit, location text, and explicitly excluded brands. Location matching uses the listing's public location text. A date phrase is preserved as a request, not interpreted as confirmed future availability. Users must select pickup and return dates and times on the vehicle page; existing booking checks remain authoritative. Unavailable units may be checked for public status but remain excluded from recommendations.

From the repository root in PowerShell, run:

```powershell
cd .\chatbot-service
.\venv\Scripts\python.exe -B -m unittest test_chatbot
.\venv\Scripts\python.exe -B evaluate_chatbot.py --json
.\venv\Scripts\python.exe -B evaluate_chatbot_holdout.py --json
cd ..\backend
node --test tests/chatbotDataset.test.js tests/chatbotRouteIntegration.test.js tests/chatbotRenterStatus.test.js tests/chatbotRateLimit.test.js
```

For a machine with the model already cached, set `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` to avoid a model-download check during offline tests. First-time setup still needs the model download described in the project guide.

The holdout evaluator combines `chatbot_holdout.json` with `chatbot_coverage.json`, checks all 59 intents, and rejects exact normalized overlap with training examples or aliases. It reports results by topic, unnecessary clarification counts, and conversation turns. Its fixed public vehicle fixture includes an unavailable listing; classification and fulfillment are repeated to check determinism. Conversations replay the screenshot wording, clarification choices, topic changes, public listing choices, and new-chat resets. These are reviewed regression checks, not an estimate of every user's wording or a guarantee of exhaustive coverage. Route tests use isolated database fixtures and cover guests, owners, authenticated renters, revoked sessions, malformed secondary answers, booking locks, and injected context. Fixture checks do not prove payment-provider operation.

To check rendered conversations as well, start Vite on port 4176 and an isolated headless Chrome instance with CDP on port 9236. From the repository root, set the URL of a running Python classifier and run:

```powershell
$env:CHATBOT_CLASSIFIER_URL = 'http://127.0.0.1:8001'
node --experimental-websocket scripts/chatbot-focus-browser-check.mjs
```

The optional URL enables actual Python routing and Node public vehicle fixtures for every conversation in the coverage set. Without it, the script runs the original focus, draft, budget, date, and reset checks using its predefined responses. Browser fixtures do not access live renter records.

When extending coverage, add varied examples and reviewed responses for all three supported styles, cite the actual workflow in `policy_source`, and keep test questions separate from training examples. Add unrelated questions with similar words to scope tests. Keep live values out of fixed replies. Restart the Python service after changing the dataset, configuration, or routing code so startup indexes reload. Restart the Node backend after dataset or configuration changes because its canonical answers are cached. The Python `/` endpoint reports `routing_revision` and `dataset_sha256`; use them to confirm that the running service loaded the intended version. Normal startup commands are in the project setup guide linked above.
