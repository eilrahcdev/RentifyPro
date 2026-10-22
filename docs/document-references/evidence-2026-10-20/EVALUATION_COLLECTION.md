# Independent evaluation collection procedure

Status on 20 October 2026: the user confirmed there is no separate test dataset.
This pack contains zero consented genuine captures and zero independently verified
fraud samples. Authenticity accuracy is unmeasured. This procedure prepares the
missing evidence; it is not evidence that collection/evaluation has already happened.

## Permission and storage

1. Recruit willing test participants or obtain issuer-provided authorized samples.
   Record permission covering collection, annotation, evaluation, permitted
   processors, storage access, retention/deletion and any allowed transformations.
   A registration upload or its normal processing consent is not automatically
   permission to reuse it for a dataset.
2. Assign non-identifying sample IDs. Keep images, original PDFs, OCR, field ground
   truth, consent records and issuer evidence in restricted storage outside Git
   and this public documentation folder. Do not use filenames containing names
   or document numbers. Apply an agreed retention/deletion schedule.
3. Keep the permission ledger and identity linkage separate from the test runner.
   The [intake header](sample-intake.csv) describes metadata fields only. Populate
   it in the restricted location, not in this folder. Do not paste private dataset
   paths, participant details, keys or issuer-response payloads into reports.

## Independent labels and splits

Use issuer-supported evidence or a qualified independent reviewer to establish
the actual category, version, required page/side, fields and claimed authenticity.
Record how each label was established. Do not ask the same model being evaluated
to supply its own ground truth. Resolve disagreements with a second reviewer or
issuer evidence; retain an inconclusive label when unresolved.

Keep authenticity, current validity, readability, category recognition, field
extraction, registration matching and final application eligibility as separate
labels. A genuine expired card and a genuine document from another person are
not automatically counterfeit. A deliberately changed registration profile is a
matching control, not evidence of forged-image detection.

Split by participant and underlying credential before tuning any rules. Keep all
recaptures, sides, transformed images and PDFs from one underlying credential in
one split. Reserve an untouched holdout and record its provenance. Public specimens,
synthetic fixtures, tutorial screens and development examples are not independent
holdout samples, even when renamed or photographed again.

## Coverage to collect

Use the 17-category matrix in [README.md](README.md). For each supported version,
record issuer, issue/revision evidence, physical/paper/digital presentation, issuing
LGU/year where applicable, pages/sides and actual required fields. Historical and
current forms need separate coverage. Unknown versions remain unknown.

Capture varied phones, cameras, resolutions, lighting, glare, orientation, crops,
compression and PDF sources. Keep low-quality captures to measure review behavior.
Multiple captures of one card improve capture-robustness testing but do not count
as multiple independently genuine credentials.

Use documented controls: wrong selected category, profile/name/date mismatch,
expired document, missing field/side, ambiguous date, unrelated image, duplicate
credential and low-quality capture. Label artificial transformations as synthetic
or derived controls. Only call a document fraudulent when independent evidence
supports that label; do not collect random internet ID photographs as genuine data.

For business documents, label the business identity and applicant's authority
separately. Certificate appearance or a registry match does not establish either
authority to represent the business or vehicle ownership.

## Evaluation stages

1. **Current baseline:** rerun the existing normalized-OCR fixtures and seven MRZ
   consistency checks. Reports here document only this stage.
2. **Image/OCR evaluation:** feed the private, permitted captures through the
   actual intended OCR service in a separate authorized test environment. Preserve
   ground-truth fields and compare per category/version. This was not run here.
3. **Screening evaluation:** use the same profiles and fixed decision rules for
   baseline and candidate reference rules. Record passes, correction requests,
   reviews and failures separately. A review is not an authenticity rejection.
4. **Issuer/authenticity evaluation:** only where supported and authorized, compare
   against independent issuer/reviewer evidence. Do not substitute MRZ consistency
   or category agreement for an authenticity label.
5. **Operational evaluation:** measure actual OCR/provider/queue latency and failure
   behavior separately from local text-processing time. Test supported mobile
   captures on actual devices before claiming device coverage.

The existing evaluator accepts normalized OCR JSON, not document images. A private
manifest follows [the existing guide](../../DOCUMENT_REFERENCE_LIBRARY.md#offline-evaluation).
Its `sampleKind: "consented"`, `consentConfirmed: true` and `split: "holdout"`
fields are operator attestations; they do not prove permission or independence.
Only supply an existing catalog `variantId` after independently establishing it.
Unknown/new versions need separate reviewed catalog work; do not invent IDs to
make a case pass. The existing evaluator always leaves authenticity accuracy null.

## Measurements and release criteria

Report independent credential counts and capture counts separately, per category,
version and locality. Show field accuracy, expected screening passes missed,
incorrect screening passes, review rate, failure rate and latency. State each
metric's numerator and denominator. Distinguish an incorrect screening pass from
accepting an independently verified forgery.

For future real-data measurements, report uncertainty/confidence intervals and
define acceptable error/review thresholds before examining the holdout. Sample
size must support the claimed error bound; zero observed errors in a small sample
does not establish perfect performance. No sample count or numerical target in
this pack certifies accuracy.

Run candidate rules in advisory mode first. Investigate disagreement and gaps;
do not relax current authorization, confidence, cancellation, duplicate or review
guards to improve a score. Unsupported or uncertain cases should remain reviewable.
Do not enforce a category/version rule until independent evidence supports it and
the implementation change has been separately reviewed and authorized.
