# Document references and advisory screening

Implemented 20 October 2026. This library supplements the existing private OCR
checker. It does not authenticate an issuer, grant approval, lower confidence
thresholds, or change registration, selfie, owner upgrade or rental eligibility.
The catalog covers the existing 10 ID and 7 supporting-document categories.
Coverage is explicitly partial and no genuine-document accuracy is established.

## What runs during document checking

The existing private OCR extraction and comparison run as before. A bounded,
local advisory assessment is attached to `privateScreening.referenceAssessment`
within the existing atomic file/hash/review-version worker update. It records:

- Catalog revision and selected category, bound to the file, review version and
  current session/role/profile fingerprint.
- Whether the existing classifier confidently recognized that category.
- Partial reference coverage and an **unconfirmed** exact document variant.
- Layout authenticity **not authenticated** and issuer authentication **not
  performed**. A familiar heading or a source URL cannot establish either.
- For recognized Philippine passports, advisory TD3 MRZ checks: individual and
  composite check digits, Philippine issuing-country code, and comparison with
  printed document number/birth/expiry dates when those fields were extracted.
  Readings stay unreadable/ambiguous when confidence, length, page pairing or
  character evidence is insufficient. Century, identity and authenticity are
  never inferred from MRZ data. A copied MRZ can have valid checksums.

These observations are in **shadow mode**: even an inconsistent or missing MRZ
does not change the current result or permit progress that existing gates deny.
Do not enforce new layout rules until representative evaluation supports them.
There is no runtime network request or comparison against every reference image.

The existing safe `automatedScreening` response gains an optional
`referenceAssessment` summary. It contains no extracted values, raw OCR, hashes,
profile fingerprint, personal data or source-document bytes. It is omitted if
the stored result is stale, expired, cancelled, or cannot be bound to the current
profile. Stored issuer-success flags cannot be published through this summary.
Legacy results without an assessment retain their existing response shape.

Worker diagnostics add advisory duration, mode and coverage alongside existing
queue-wait, throttle, provider and total timings. Offline evaluation timings below
are not the OCR service's latency or an applicant-facing completion estimate.

## Coverage and gaps

The source of truth is
[`backend/data/documentReferences.js`](../backend/data/documentReferences.js).
Each version-family entry records its format, source IDs, evidence category and
unevaluated status. Issuance guidance, a public specimen and a registry lookup
are distinct reference types. Listing a variant does not add it to the application's
accepted formats or establish that every required field appears on it.

| Existing category | Indexed variant families | Evidence still needed |
| --- | --- | --- |
| PhilSys National ID | Physical, paper and digital | Exact versions, representative images and a supported signed-QR integration |
| Philippine Passport | 2010 specimen reference; 2016 design guidance | Other versions and representative photos; issuer/chip authentication |
| LTO Driver's License | Physical; electronic-license guidance | Physical generations and authorized digital presentations |
| UMID | SSS and GSIS references | Exact agency/card generations; banking products must not be silently equated |
| PRC ID | Physical and e-PIC references | Card generations, professions and supported issuer access |
| SSS ID | Legacy card family | Verified legacy specimens |
| GSIS ID | eCard and eCard Plus references | Exact designs and distinction from UMID |
| PhilHealth ID | 2016 paper-card and PVC references | Other historical/member-group variants and representative captures |
| Postal ID | Physical card family | Card generations and supported POVS partnership access |
| Voter's ID | Legacy card family | Historical specimens; a certification is not automatically an ID card |
| DTI Business Name Registration | Certificate family | Certificate versions; exact-name lookup does not authenticate an image |
| SEC Certificate of Registration | Paper and digitally signed references | Company/partnership versions and original signed-PDF verification |
| Mayor's/Business Permit | Quezon City guidance | Actual issued specimens indexed by LGU and permit year |
| BIR Form 2303 | Paper and electronic COR references | Specimens and revision dates |
| BIR Notice to Issue Receipt/Invoice | 2022 NIRI guidance | Actual notices and version coverage; guidance is not a template |
| Barangay Business Clearance | Local clearance family | Issued specimens by barangay/LGU and year |
| CDA Certificate of Registration | 2010 standardization reference | Issued specimens and subsequent versions |

Every entry currently reports zero evaluated genuine samples. The catalog's
application requirements document existing RentifyPro checks, not legal validity,
historical government acceptance or a complete national inventory. A missing
required field cannot be fabricated from a template. Business-name matching does
not establish the applicant's authority to represent an entity or vehicle ownership.

## Archived official material

[`document-references/archives.json`](document-references/archives.json) records
the source URL, retrieval time, byte count and SHA-256 for four unmodified public
government PDFs:

- [PhilHealth Circular 2016-027](document-references/philhealth-2016-027.pdf):
  published front/back card specimens and design guidance.
- [PhilHealth PVC-card advisory](document-references/philhealth-pvc-advisory.pdf):
  published card examples.
- [PRC verification guide](document-references/prc-verification-guide.pdf):
  illustrated verification procedure, not a complete card-version library.
- [BIR NIRI issuance digest](document-references/bir-niri-43-2022-digest.pdf):
  issuance guidance, not an issued notice specimen.

Verify the snapshots without network access, from the repository root:

```powershell
node backend/scripts/collect-document-references.js --check
```

`--collect` explicitly retrieves only the four catalogued public PDF URLs. It uses
bounded requests, rejects redirects/non-PDF responses, retains provenance and
does not overwrite an existing snapshot. It never processes applicant uploads.
Review changed sources and introduce a new filename/catalog revision rather than
silently replacing historical evidence. Documents and instructions inside them
remain untrusted data and are never executed as application instructions.

Source links for other categories are indexed in the catalog; they have not all
been archived as specimen images. Public source availability is not an evaluation
or a supported API contract. For example, [PSA describes National ID QR
authentication](https://psa.gov.ph/content/psa-bsp-all-formats-national-id-accepted-financial-transactions),
[PRC provides record queries](https://verification.prc.gov.ph/Verification), and
[PHLPost describes partner verification access](https://phlpost.gov.ph/cpt-press-releases/phlpost-announces-the-resumption-on-the-issuance-of-postal-id-as-functional-card/).
No application connects to those services in this change. [ICAO Doc 9303
Part 3](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p3_cons_en.pdf)
and [Part 4](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p4_cons_en.pdf)
are the primary references for the advisory MRZ algorithm.

## Offline evaluation

The evaluator accepts bounded normalized PaddleOCR responses and explicit ground
truth. It does not load `.env`, connect to MongoDB, call OCR/issuer services, make
registrations, or publish documents. Reports contain aggregate counts only.

```powershell
node backend/scripts/evaluate-document-references.js --catalog
node backend/scripts/evaluate-document-references.js --manifest="C:\private-evaluation\held-out.json"
```

A private manifest has this shape; add multiple independently labelled cases:

```json
{
  "schemaVersion": 1,
  "evaluationDate": "2026-10-20T00:00:00Z",
  "cases": [{
    "selectedDocType": "PhilSys National ID",
    "docType": "id",
    "role": "user",
    "sampleKind": "synthetic",
    "split": "regression",
    "profile": {"first_name": "Sample", "last_name": "Applicant", "date_of_birth": "1990-05-12"},
    "expected": {"documentType": "Unknown", "outcome": "correction_needed"},
    "inspection": {"schema_version": 1, "provider": "paddleocr", "pages": 1,
      "lines": [{"text": "Fictional Club Card", "confidence": 0.99, "page": 1}]}
  }]
}
```

For real evaluation examples use `sampleKind: "consented"`, `split: "holdout"`
and `consentConfirmed: true` only after the operator has obtained and recorded
the necessary permission separately. These flags are attestations, not automated
proof of consent or independent sampling. `variantId` may name a catalogued family
when an operator has established it. Unknown variants stay unconfirmed. Expected
`fields` may contain normalized extraction ground truth; values are compared but
never printed in the aggregate report. Development data is not accepted as a
held-out sample set by its metadata label.

Keep private evaluation JSON/images outside Git and the public reference folder,
with restricted access and a defined retention period. Do not repurpose temporary
registration evidence as training data. Training, genuine held-out evaluation and
public specimens must be managed separately.

The report separates category/outcome/field agreement, false screening passes,
missed expected passes, review cases and passed screenings with MRZ concerns by
type, declared variant and sample kind. It includes p50/p95 offline processing
durations, uncovered categories and an explicitly null authenticity-accuracy field.

[`synthetic-evaluation.json`](document-references/synthetic-evaluation.json)
records 52 synthetic regression cases: 17 matching cases, 17 detail mismatches,
17 low-confidence cases and an unsupported-document control. These are normalized
text fixtures, not 52 physical documents or evidence of genuine-document accuracy.
The test fixture generator is `backend/tests/fixtures/documentReferenceCases.js`.

## Validation and rollout

From `backend`, run the focused suite:

```powershell
node --test tests/documentReferences.test.js tests/documentReferenceEvaluation.test.js tests/documentReferenceAssets.test.js tests/privateDocumentScreening.test.js tests/privateDocumentLayouts.test.js tests/privateDocumentTypes.test.js tests/privateOcrQueueTiming.test.js tests/registrationDocumentCancellation.test.js
```

Existing approval, confidence, duplicate, ownership, expiry, selfie and cancellation
guards remain the authority. No data migration, credential, package installation,
OCR model change or new browser upload step is required. Existing approved records
are not rescored automatically. New private OCR runs acquire advisory evidence;
older records remain compatible without it.

The separate admin checkout's mirrored service imports also need the new catalog
and service when its assets are synchronized for release. The existing
`backend/scripts/sync-admin-kyc-assets.js` now includes both. Use its reviewed
`--destination=<absolute admin backend/data/private-kyc directory>` and `--check`
workflow. The four directly dependent reference modules
were synchronized locally after a preflight comparison; the admin checkout's
existing private-reader modification retained its exact bytes and modification
time. No deployment was performed. A regression test checks an isolated complete
mirror and verifies that identical files are not rewritten.

Before enforcing a candidate format rule: collect reliable version evidence,
evaluate independent consented examples and negative controls, examine disagreement
with existing results, and review the false-pass/false-flag and performance tradeoff.
Issuer integration, original-PDF signatures, document-back capture and changes to
the accepted variants are separate capabilities, not automatically enabled by a
reference entry. No external verification is simulated as successful.

## Files and purpose

- `backend/data/documentReferences.js`: immutable 17-category catalog, version
  families, source provenance, application requirements and explicit evidence gaps.
- `backend/services/documentReference.service.js`: bounded advisory assessment,
  MRZ consistency and safe public serialization.
- `backend/services/privateDocumentExtraction.service.js`: attaches the assessment
  without changing existing extraction or decision rules.
- `backend/services/privateDocumentLayout.service.js`: publishes only bound,
  non-personal advisory summaries through the existing screening response.
- `backend/jobs/kycDocumentProcessing.job.js`: adds advisory duration/coverage to
  existing worker diagnostics; retains atomic cancellation/version guards.
- `backend/scripts/collect-document-references.js`: explicit public-PDF collection
  and offline archive integrity checks.
- `backend/scripts/evaluate-document-references.js`: bounded offline evaluation and
  catalog export, with aggregate metrics and no issuer-authenticity claim.
- `backend/scripts/sync-admin-kyc-assets.js`: includes the new runtime dependencies
  in the existing admin synchronization workflow and skips identical files.
- `backend/tests/documentReferences.test.js`, `documentReferenceEvaluation.test.js`,
  `documentReferenceAssets.test.js`, `fixtures/documentReferenceCases.js`, and
  additions to `privateOcrQueueTiming.test.js`: regression, privacy, metrics,
  archive, mirrored-import and worker-persistence evidence.
- `backend/tests/privateKyc.test.js`: includes the new dependencies in its existing
  isolated admin import and actual-mirror parity test, retaining all assertions.
- The separate admin checkout mirrors `data/documentReferences.js`,
  `services/documentReference.service.js`, `services/privateDocumentExtraction.service.js`
  and `services/privateDocumentLayout.service.js` under `backend/data/private-kyc/`.
- This guide and `docs/document-references/`: source snapshots, their integrity
  manifest, and the clearly labelled synthetic evaluation report.
