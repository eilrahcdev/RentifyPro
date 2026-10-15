# RentifyPro accepted verification documents

Updated October 14, 2026. This describes the application's private OCR screening policy. A selectable category, an OCR match, and government authentication are different claims. RentifyPro does not verify these documents with a government issuer.

## Registration requirements

Renters submit one accepted identity document. New owners submit one identity document and one accepted supporting business document. Existing users upgrading to owner submit a supporting document through the existing upgrade flow. Selfie verification and email verification remain separate requirements.

Renter identity screening compares complete first name, surname and birth date. Owner automated screening compares the name and any birth date supplied by the existing flow. The manual ID comparison retains its existing requirement for a printed birth date. An ID variant lacking a field required by the flow cannot establish that field; use another accepted ID showing it. No value is inferred or fabricated.

The private checker never grants final approval. Final registration still requires the existing verified-document and selfie gates. An automated match can enable the next step while the document remains `pending_review`; a Super Admin must inspect and compare the original before final approval.

## All 17 categories

The exact labels remain unchanged in [the frontend catalog](../frontend/src/data/kycDocumentTypes.js) and [the backend allowlists](../backend/services/documentValidation.service.js).

### Identity documents

| Category | Category-specific identifier labels recognized | Expiry policy |
| --- | --- | --- |
| PhilSys National ID | PCN, PSN, PhilSys card number; unique four-group printed card number | Check if an expiry field is printed |
| Philippine Passport | Passport number / Passport No. | Required |
| LTO Driver's License | License number / License No. | Required |
| UMID | CRN / Common Reference Number | Check if printed |
| PRC ID | Registration number / Registration No. | Required |
| SSS ID | SS Number, SSS number, Social Security Number | Check if printed |
| GSIS ID | BP Number, Business Partner Number, GSIS number | Check if printed |
| PhilHealth ID | PIN / PhilHealth identification number | Check if printed |
| Postal ID | PRN / Postal Reference Number | Required |
| Voter's ID | VIN / Voter's Identification Number | Check if printed |

These are application screening requirements, not statements that every historical version has these labels or dates. Generic document-number labels remain supported. Names can be separate first/middle/surname fields, bilingual fields, or an LTO combined heading. Surname-first names and compound surnames are handled without substring matching.

### Supporting business documents

| Category | Comparison fields and recognized labels | Expiry policy |
| --- | --- | --- |
| DTI Business Name Registration | Business name below “This certifies that”; Business Name No. / registration number | Required; explicit valid-from/to period supported |
| SEC Certificate of Registration | Company/business name; Company Registration No. / SEC registration number | Check if printed |
| Mayor's/Business Permit | Business/trade name; Business Permit No. / permit number | Required |
| BIR Certificate of Registration (Form 2303) | Business/trade name; Taxpayer Identification Number / TIN plus branch code | Check if printed |
| BIR Notice to Issue Receipt/Invoice | Business name; TIN plus branch code, including a combined caption | Check if printed |
| Barangay Business Clearance | Business name; clearance/reference number if supplied in registration | Check if printed |
| CDA Certificate of Registration | Name of Coop. / cooperative/business name; cooperative registration number | Check if printed |

For BIR documents, a permit number cannot substitute for TIN and branch code. Masked identifiers cannot produce an automated match. A Barangay clearance without a reference number retains the existing optional-reference policy. Company names are compared as complete normalized names; an entity match does not establish an applicant's authority to represent that entity.

## Extraction and decisions

The Python service returns bounded text, confidence, page and normalized rectangles from local PaddleOCR models. The Node backend independently recognizes the category and then associates values with labels on the same page and spatial column. It supports nearby right-hand/below values, padded rectangles that overlap adjacent rows, BIR/CDA captions below values, and bounded wrapped business names. Category-specific patterns separate a merged LTO number/date row.

DTI recognition supports the certificate's printed narrative issuer clause together with its certificate title. BIR notice recognition supports its posted receipt/invoice title together with BIR issuer or specific official contact evidence. These are recognition signals requiring original-document inspection, not proof of authenticity. Arbitrary issuer references alone do not establish a category. Instructions inside documents remain data, never commands to the application.

Both category evidence and every required field must meet at least 90% confidence, or a higher configured threshold. Lowering configuration values cannot bypass the 90% floor. Ambiguous readings, contradictory values, absent positions for non-inline fields, and impossible dates remain uncertain. Numeric dates are accepted only when their interpretation is unambiguous; `05/12/2099` is not guessed. Required missing expiry stays unknown. Future issue dates or an issue date after expiry require inspection.

| Result | Applicant behavior | Security gate |
| --- | --- | --- |
| Complete confident type and detail match | Continue to the next permitted step | `pending_review`; final approval remains manual |
| Correct category but uncertain/missing field | Await administrator comparison or replace the upload | `review_needed`; no automated selfie unlock |
| Missing required birth date | Use another accepted ID showing birth date if this variant lacks it | Birth-date verification remains required |
| Wrong/unrecognized/multiple categories | Correct the selection or upload the complete correct document | `reupload_required` |
| Confident identity mismatch or expiry | Correct the registration details or provide a matching current document | Existing correction gates remain enforced |
| Duplicate, changed file/revision/profile/session, suspected alteration | Follow existing review/correction workflow | No stale or duplicate selfie authorization |

Administrators must still inspect the private original, confirm its official layout/markings and readability, and enter matching fields. Expiry requirements and complete-name comparisons also apply when saving manual comparisons. Human comparison and final approval remain separate actions, with existing authentication, authorization, audit and duplicate checks.

## Upload and image-quality checks

| Rule | Identity ID | Supporting document |
| --- | --- | --- |
| Formats | JPEG, PNG | JPEG, PNG, PDF |
| Frontend byte limit | 4 MiB | 4 MiB |
| Image dimensions | At least 480 px wide and 300 px high | Same for images; PDFs use server PDF checks |
| Basic image quality | Decode, darkness and insufficient visible detail | Same for images |
| Backend validation | Existing byte/signature/private-file checks | Existing byte/signature/private-file and bounded PDF checks |

White paper is naturally bright. Mean luminance alone cannot determine glare, so a readable white certificate is no longer rejected as overexposed. Horizontal and vertical adjacent-pixel detail checks still reject blank images. This client check cannot prove legibility or detect every patch of glare; required-field confidence and human inspection handle uncertain content afterward.

The Python limits remain unchanged: 4 MiB file bytes, 20 million image pixels, five PDF pages and bounded OCR output. Existing file/session expiry and secure private storage remain unchanged. There is no new front/back upload workflow, issuer connection, image-training corpus or cloud OCR fallback in this change.

## Apply and verify locally

Restart the Node backend and refresh/rebuild the frontend after applying the source changes. No Python dependency or model update is needed for these parser fixes. Resubmit a previously unsuccessful or pending upload to obtain a fresh result. Automated screening policy version 3 invalidates older automated matches on resubmission; approved documents and current recorded manual comparisons retain their existing protections.

The separate admin application imports mirrored KYC modules under its `backend/data/private-kyc` directory. Keep those modules synchronized with this checkout using [the existing synchronization script](../backend/scripts/sync-admin-kyc-assets.js), then restart the admin backend. Verify with its `--check` option. Do not overwrite independent admin edits without reviewing them.

Focused backend verification, from `backend`:

```powershell
node --test --test-reporter=spec tests/privateDocumentLayouts.test.js tests/privateDocumentScreening.test.js tests/privateDocumentTypes.test.js tests/privateKyc.test.js tests/privateOcrServiceManager.test.js tests/preKycSelfieGate.test.js tests/preKycDocumentGate.test.js tests/documentConfidence.test.js tests/documentValidation.test.js
```

Frontend and native-browser verification:

```powershell
# From frontend
node --test tests/cameraKyc.test.mjs
npm.cmd run build
# From repository root; requires local Chrome, or KYC_TEST_CHROME pointing to Chromium
node scripts/kyc-image-quality-browser-check.mjs
```

The native-browser script creates and closes its own temporary browser profile. Its synthetic white-paper/blank/dark/low-resolution cases do not call APIs. Optional local samples can be checked with `--sample-directory=<absolute directory>`; image bytes remain local and only filenames, dimensions and decisions are printed.

## Evidence and limits

Regression fixtures exercise the 17 category aliases, wrong-type matrix, LTO combined/overlapping/merged rows, DTI narrative fields, BIR posted notices and captions, CDA labels, wrapped business names, name boundaries, ambiguous dates, expiry, manual review and stale authorization. Fixtures use synthetic values; private participant images are not stored in the repository.

Local PaddleOCR checks on the supplied LTO, DTI and National ID images produced matching automated results with matching registration profiles. The masked-TIN BIR sample remains for manual review. Fictional/unrecognized ID and business-permit controls remain rejected. Native Chrome quality checks accept the readable local images and reject unusable controls.

These checks do not establish live registration, live database/admin approval, issuer verification, government legal acceptance, or an accuracy rate across every historical layout. Representative genuine samples of the remaining categories and versions are still needed for a broader evaluation before claiming those results in a thesis defense.

Implementation sources: [private field extraction](../backend/services/privateDocumentExtraction.service.js), [bound automated matches](../backend/services/privateDocumentLayout.service.js), [manual comparison](../backend/services/manualDocumentComparison.js), [client image checks](../frontend/src/utils/cameraKyc.js), [private OCR service](../kyc-ocr-service/main.py), and [queue worker](../backend/jobs/kycDocumentProcessing.job.js).
