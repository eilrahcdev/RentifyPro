# RentifyPro accepted verification documents

Compiled from the current workspace on September 10, 2026.

This catalog describes document types currently offered by RentifyPro registration and verification. Inclusion in the application's list does not establish that a particular upload is authentic, unexpired, or legally sufficient. Government issuance rules and document variants have not been researched for this code inventory.

## Requirements by flow

| Flow | Identity document | Supporting business document | Other verification |
| --- | --- | --- | --- |
| New renter/user registration | One of the 10 ID types below | Not required | ID name and birth date must match before selfie verification; required documents must have `verified` status in the same pre-registration session |
| New individual owner registration | One of the 10 ID types below | One of the 7 supporting types below | ID name must match before selfie verification; same document-approval requirements |
| New business owner registration | One of the 10 ID types below | One of the 7 supporting types below | ID name must match before selfie verification; same document-approval requirements |
| Existing user upgrading to owner | Upgrade endpoint does not request a new ID | One of the 7 supporting types below | Verified email and a verified supporting document in the owner pre-registration session |
| Logged-in identity verification | One of the 10 ID types below | Not part of this flow | ID upload and selfie verification |

The owner registration requirement applies to both `individual` and `business`. Currently, the backend checks for one verified supporting document; it does not require all seven or select a different document bundle for each business structure. Selfies and email OTPs are separate verification evidence, not additional document types.

Sources: [registration and owner-upgrade controller](../backend/controllers/auth.controller.js), [renter registration](../frontend/src/components/RegisterPage.jsx), [owner registration](../frontend/src/pages/RegisterOwnerPage.jsx), [owner upgrade form](../frontend/src/pages/AccountSettings.jsx), [logged-in verification](../frontend/src/verification/VerificationStepper.jsx).

## Identity documents: 10 accepted types

Use these exact labels when integrating with the current application. Every row belongs to backend category `id` and is offered to both renters and owners.

| # | Exact application label |
| --- | --- |
| 1 | PhilSys National ID |
| 2 | Philippine Passport |
| 3 | LTO Driver's License |
| 4 | UMID |
| 5 | PRC ID |
| 6 | SSS ID |
| 7 | GSIS ID |
| 8 | PhilHealth ID |
| 9 | Postal ID |
| 10 | Voter's ID |

The current screening service expects an ID image with at least one visible human face photograph. Therefore, being selectable does not guarantee that every format or version of a listed ID will pass screening.

## Owner supporting documents: 7 accepted types

Every row belongs to backend category `supporting`. These are selectable alternatives for an owner supporting-document upload, not substitutes for the owner's identity ID.

| # | Exact application label |
| --- | --- |
| 1 | DTI Business Name Registration |
| 2 | SEC Certificate of Registration |
| 3 | Mayor's/Business Permit |
| 4 | BIR Certificate of Registration (Form 2303) |
| 5 | BIR Notice to Issue Receipt/Invoice |
| 6 | Barangay Business Clearance |
| 7 | CDA Certificate of Registration |

The owner form asks for the business/trade name and permit/registration number shown on the uploaded document. The screening service also receives the applicant's name, owner type, and address for comparison.

Both document lists were checked against [the frontend catalog](../frontend/src/data/kycDocumentTypes.js) and [the backend screening allowlists](../backend/services/geminiDocument.service.js). Their labels and order match.

## Upload rules currently implemented

| Rule | Identity ID | Supporting document |
| --- | --- | --- |
| Frontend file formats | JPEG/JPG, PNG | JPEG/JPG, PNG, PDF |
| Frontend maximum file size | 4 MiB, displayed as 4 MB | 4 MiB, displayed as 4 MB |
| Upload count | One ID file | One supporting file |
| Image dimensions | Client checks at least 480 px wide and 300 px high | No equivalent dimension check in the shared supporting-file validator |
| Basic image quality | Client runs a simple edge-based blank/blur check | No equivalent check in the shared supporting-file validator |
| Backend file validation | Base64 decoding, byte limit, and JPEG/PNG signature checks | Base64 decoding, byte limit, and JPEG/PNG/PDF signature checks |
| Document-type selection | Required | Required |

The controller's byte limit defaults to 4 MiB and can be changed with `KYC_IMAGE_MAX_BYTES`; the Gemini service also has `KYC_DOC_MAX_BYTES`, defaulting to 4 MiB. These are code defaults, not a check of the running deployment's environment.

The data model has a unique `(email, docType)` index. It stores at most one record per email for each category, rather than a separate record for every accepted type or document side. There is no dedicated front/back upload pair in these forms.

Sources: [file rules](../frontend/src/utils/fileValidation.js), [ID image checks](../frontend/src/utils/cameraKyc.js), [KYC controller](../backend/controllers/kyc.controller.js), [document model](../backend/models/PreKycDocument.js).

## Existing AI screening and decisions

RentifyPro already calls Gemini through `verifyPhilippinesDocument()` in [geminiDocument.service.js](../backend/services/geminiDocument.service.js).

The service currently:

- Asks the model to recognize and classify the upload independently without receiving the applicant's selected document type.
- Allows an explicit `UNKNOWN` result and treats plain paper, typed or handwritten personal information, screenshots, unrelated images, unsupported documents, and ambiguous layouts as unrecognized.
- Applies backend hard gates for readability, supported Philippine origin, exact type match, and document-specific structural features before extracting and comparing registration data.
- Requires passport MRZ/layout regions, LTO license-card regions, ID portrait/number/birth-date regions, or official business-registration features as appropriate.
- Compares the business name and the identifier appropriate to the selected supporting document: permit or registration number for DTI/SEC/Mayor's Permit/CDA, or TIN plus branch code for the two accepted BIR documents. A Barangay Business Clearance without a reference number can proceed to manual review after its name and official features pass the other checks.
- Routes uncertain authenticity, low classification certainty, and duplicate documents to manual review. These are screening signals; the implementation does not confirm authenticity with a government issuer.
- Requires complete first-name and surname token matches for IDs instead of substring matching. Renter IDs also require an exact birth-date match; conflicting identity data requires correction or a matching replacement ID and cannot use ordinary administrator approval.
- Allows administrator decisions only after processing reaches manual review. Queued, processing, retrying, and unresolved-identity records cannot be approved.
- Stores only a masked extracted document number and a keyed fingerprint after hard gates pass. The private, temporary pre-registration profile snapshot contains the applicant-entered comparison fields, including TIN and branch code for BIR uploads; these fields are not copied into the permanent owner profile. Ordinary applicant status responses do not expose confidence calculations or raw extracted identity numbers.

The queue worker defaults `KYC_ALLOW_RULE_BASED_AUTO_VERIFY` to `false`. In that configuration, documents that pass every hard gate move to `pending_review` for a Super Admin decision. `KYC_ALLOW_GEMINI_AUTO_APPROVE` remains a compatibility fallback. If rule-based auto-verification is explicitly enabled, the classification threshold defaults to 90/100 and the extraction threshold to 85/100; neither score is proof of authenticity.

Temporary provider failures retry and eventually move to manual review. They do not automatically reject the applicant. Registration checks verified documents and a matching selfie separately.

Status flow:

```text
queued -> processing -> pending_review -> verified or rejected
              |
              +-> retry_wait -> processing

Optional auto-approval: processing -> verified
```

Sources: [queue worker](../backend/jobs/kycDocumentProcessing.job.js), [review service](../backend/services/kycReview.service.js), [workflow guide](KYC_VERIFICATION_WORKFLOW.md).

## Planning the next validator

The following are proposed additions, not claims about existing functionality or official document requirements.

1. **Define document variants.** For each of the 17 types, explicitly enumerate supported versions, sides/pages, and physical/digital formats. The current lists do not separately define ePhilID, Digital National ID, electronic driver's licenses, or older/newer layouts. Decide those policies before labeling examples or enforcing a template.
2. **Extract structured fields with evidence.** For IDs, consider name, date of birth, document number, issue/expiry dates where present, and portrait location. For supporting documents, consider registered entity/business name, registration/permit number, named proprietor where present, address, issuing office, and dates where present. Record the source page/region and an unreadable/missing state rather than inventing absent values. These are candidate fields; a type-specific policy should determine which are needed.
3. **Separate extraction from validation.** Compare extracted values with the user's profile in deterministic code. Keep raw text and normalized values distinct. Treat instructions printed inside uploaded documents as document content, never as instructions to the validator.
4. **Handle personal and entity names separately.** A company registration may identify an entity rather than the individual applicant. Define what evidence establishes the applicant's relationship to that entity; the current generic name check does not establish that authority.
5. **Add explicit date and status policies.** The present service has no structured, per-type expiry validation. Define how each supported variant handles absent expiry dates, validity periods, and unreadable dates, then implement those checks independently of the model.
6. **Keep identity and driving eligibility separate.** The current registration gate accepts any listed ID; it does not require the selected document to be an LTO driver's license. If driving eligibility is a product requirement, give it its own evidence and validation rules.
7. **Separate authenticity evidence from appearance.** Track whether a result came from OCR/model screening, human review, or a future issuer-backed check. Do not label an upload issuer-verified solely because the model reports a high confidence score. Issuer integrations and verification procedures would require separate research.
8. **Evaluate before changing approval policy.** Build labeled cases per supported variant covering legible and unreadable uploads, wrong selected type, profile mismatch, missing sides, relevant expiry cases, and suspected alteration. Measure false acceptance and false rejection by type. Keep uncertain results reviewable with a correction reason.

Suggested result fields for a future validator:

```text
category: id | supporting
selected_type: exact catalog label
detected_type: exact catalog label | unknown
variant: supported variant identifier | unknown
extracted_fields: values with page/region evidence
checks: file, quality, type_match, profile_match, dates, tampering
check_status: pass | fail | unknown | not_applicable (per check)
issuer_check: not_performed | verified | failed | unavailable
decision: pending_review | verified | rejected
reason_codes: stable codes for UI and audit records
policy_version, model_version, reviewed_by, reviewed_at
```

This suggested schema is a planning sketch, not the current API contract.

## Scope and verification

This is a source-code inventory of the main RentifyPro checkout. It does not include copies of users' private documents or a training-image dataset. Passport/ID specimens, issuer specifications, and legal acceptance rules need a separate collection and verification step.

NBI clearances, police clearances, birth certificates, TIN IDs, utility bills, student IDs, and vehicle OR/CR are not named in the current registration document allowlists. That is a statement about this application's configured list, not their validity for other purposes.

Private document bytes and database metadata are separate: the code writes evidence to private file storage and keeps keys, hashes, and screening metadata in MongoDB. Records have expiry support. Do not assume registration uploads form a permanent training corpus.

Validation for this compilation: inspected the current form consumers, frontend/backend allowlists, upload validators, registration gates, queue worker, and document model. No live provider, government service, database, or real-document acceptance tests were run.
