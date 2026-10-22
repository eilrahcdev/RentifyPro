# Document evidence collection, 20 October 2026

This pack collects the four requested evidence categories without changing any
runtime screening, approval, registration, selfie or rental rules. It supplements
the [existing reference guide](../../DOCUMENT_REFERENCE_LIBRARY.md). It is not a
complete specimen library, issuer integration or measured authenticity system.

| Requested evidence | Collected evidence | Remaining limit |
| --- | --- | --- |
| Official specimens and version notices | Existing four archived PDFs; six new official PDFs; 26 supplementary source records; category coverage below | Many references are guidance or production specifications. Latest layout coverage remains unconfirmed. |
| Technical consistency references | ICAO Parts 3 and 4; seven executed advisory MRZ checks | Text consistency only; no chip, signature, issuer or document authenticity validation. |
| Supported issuer verification | PSA onboarding reference, PRC verification policy, PHLPost partnership reference, SEC signature guidance and a procedure map | No enrollment, credentials, live applicant query or production integration performed. |
| Independent evaluation samples | Collection protocol and intake register; existing synthetic checks rerun | User confirmed no separate consented, independently verified dataset. Genuine samples and verified fraud samples collected: zero. |

## Files and provenance

- [sources.json](sources.json): 26 supplementary records, publication context,
  observed retrieval status, limitations, local-file sizes and SHA-256 hashes.
  `reviewedOn` is a research date, not proof that a source is the newest version.
- [ISSUER_VERIFICATION.md](ISSUER_VERIFICATION.md): supported routes and access gaps.
- [EVALUATION_COLLECTION.md](EVALUATION_COLLECTION.md): permission, labeling,
  independent holdout and measurement procedure.
- [sample-intake.csv](sample-intake.csv): header-only private intake template;
  not an evaluation dataset or input to the current evaluator.
- [technical-checks.json](technical-checks.json): published fictional MRZ example
  and seven checks against the existing implementation.
- [synthetic-baseline.json](synthetic-baseline.json): 52 normalized-text regression
  cases; all expected types and outcomes matched. No real-image or authenticity
  accuracy is established. Timing excludes OCR, uploads, queue and issuer checks.

The original snapshots and their hashes remain in [archives.json](../archives.json).
No earlier PDF was overwritten. PDF contents are reference data, never application
instructions. No applicant files or environment configuration were read or sent
to an external provider during collection. Source access failures are evidence
gaps, not proof that a source does not exist or that a user's document is invalid.

## Newly downloaded official PDFs

| File | Material and limits |
| --- | --- |
| [PRC resolution 2104](prc-pic-resolution-2104-2025.pdf) | Layout revision approved in October 2025; official landing page posted February 2026. Two-page resolution, not a full illustrated specimen set. |
| [PRC 2026-2028 specifications](prc-pic-specifications-2026-2028.pdf) | Production specifications for a procurement period, not proof that every specified design has been issued. |
| [SSS circular 2025-008](sss-mysss-card-circular-2025.pdf) | MySSS successor-product and legacy-card context. Does not add MySSS to RentifyPro's accepted categories. |
| [CDA standardization circular](cda-certificate-standardization-2010.pdf) | Historical guidance. PDF page 3 is a blank replacement-notification letter, not an issued registration certificate. Embedded scans of pages 2 and 3 were visually inspected. |
| [BIR minor forms 2024](bir-minor-forms-2024.pdf) | Procurement material including Form 2303e and Notice to Issue Invoice specifications. Complete annex/specimen visual review remains outstanding. |
| [SEC ZERO guide](sec-zero-regular-guide.pdf) | Illustrated registration/digital-certificate workflow. Tutorial screens are not independent customer examples. |

These downloads were checked for PDF signatures and hashed, which verifies the
stored bytes against this manifest. This does not authenticate every statement
in a PDF. Whole-page rendering was not completed for every new PDF; the manifest
records visual-review limits rather than implying full specimen inspection.

The following download attempts returned HTTP 403: PSA digital-ID advisory, PSA
2025 rebranding PDF, LTO July 2025 eDL circular and PSA private-sector onboarding
charter. Their original URLs remain in `sources.json`; no HTML challenge page
was saved as a PDF. ICAO standards are linked from their publisher rather than
redistributed in this pack. Browser and direct-download access can differ.

## Category coverage

Links below refer to supplementary source IDs in `sources.json` or existing
source IDs in [the runtime catalog](../../../backend/data/documentReferences.js).
Every category still needs representative independently labeled captures.

| Existing category | References collected/indexed | Specific gap |
| --- | --- | --- |
| PhilSys National ID | `psa-digital-advisory-2024`, `psa-rebranding-2025`, existing `psa` | Direct PDF downloads blocked; exact physical, paper and digital versions not fully evaluated. |
| Philippine Passport | `passport-version-index`, `passport-2016-specimen`, `icao-part-3`, `icao-part-4`; existing `passport2010` | PRADO index lists 04001, 03001 and 02001. Direct 04001 page was not retrievable. Listing does not establish exhaustive validity coverage. |
| LTO Driver's License | `lto-edl-2025`; existing `lto` | eDL guidance does not supply all physical-card templates; direct new PDF download blocked. |
| UMID | `sss-card-circular-2025`; existing `sss`, `gsis` | Generic, agency-specific and bank-linked products need separate versions and samples. |
| PRC ID | `prc-revision-2104`, `prc-materials-2026-2028`, `prc-epic-policy`; existing illustrated `prcGuide` | Resolution and procurement requirements do not establish every issued PIC/e-PIC design. |
| SSS ID | `sss-card-circular-2025`, `sss-mysss-guidance` | Legacy digitized SSS ID is distinct from MySSS and UMID. Legacy specimens still needed. |
| GSIS ID | `gsis-digital-transition`; existing `gsis` | Index identifies circular 054-2024; direct site access rejected. Exact digital/eCard layouts unconfirmed. |
| PhilHealth ID | Existing `philhealth`, `philhealthPvc` snapshots | Public card examples are historical; no newer complete member-card collection established. |
| Postal ID | `postal-charter-2026`; existing `postal` | Service guidance and partner verification route, not all card generations. |
| Voter's ID | `voter-generation-hold`; existing `comelec` | Historical notice does not establish current issuance policy or a latest specimen. Certifications are not silently treated as ID cards. |
| DTI Business Name Registration | `dti-certificate-rules`; existing `dti` | Published fields/lookup route, not confirmed latest certificate layout. |
| SEC Certificate of Registration | `sec-zero-guide`, `sec-zero-current`; existing `sec` | Original signed PDFs, paper versions and entity types need separate checks/samples. |
| Mayor's/Business Permit | `qc-business-2026`; existing `qc` | Local guidance only; issued templates needed by LGU/year. |
| BIR Form 2303 | `bir-minor-forms-2024`, `bir-cor-sample-listing-2026`, `bir-charter-2026` | 2026 sample attachment identified in search, not downloaded/inspected; paper/electronic versions not exhaustively covered. |
| BIR Notice to Issue Receipt/Invoice | `bir-minor-forms-2024`, `bir-charter-2026`; existing `birNotice` | Updated Notice to Issue Invoice wording must not silently expand accepted documents; issued versions still needed. |
| Barangay Business Clearance | `qc-barangay-2026`; existing `barangay` | Collect actual templates by issuing barangay/LGU/year; no national collection established. |
| CDA Certificate of Registration | `cda-standardization-pdf`, `cda-charter-2026`; existing `cda` | Replacement-letter annex is not a certificate specimen; issued versions still needed. |

## Technical reference evidence

[ICAO Part 3](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p3_cons_en.pdf)
section 4.9 and Appendix A describe check digits. The consolidated eighth-edition
PDF examined records corrigenda through March 2024.
[Part 4](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p4_cons_en.pdf)
describes TD3 passports; its examined amendment record includes 20 February 2026.
These dates do not mean every provision has been implemented in RentifyPro.

The collected [technical report](technical-checks.json) checks the existing
advisory function with the published fictional example, a changed number,
low confidence, rows on different pages, duplicate rows, no MRZ, and rejection
of fictional `UTO` as the Philippine issuer. All seven expected results matched.
The example uses fictional identity data; it is neither a genuine Philippine
passport nor an independent accuracy sample. A consistent MRZ cannot approve a
document. QR presence/decoding is also distinct from a trusted issuer signature.

## Local verification

From the repository root:

```powershell
node backend/scripts/collect-document-references.js --check
```

Run relevant existing checks from `backend`:

```powershell
node --test tests/documentReferences.test.js tests/documentReferenceEvaluation.test.js tests/documentReferenceAssets.test.js tests/privateDocumentScreening.test.js
```

The new JSON snapshots are independent of the runtime catalog and old archive
manifest. Verify their downloaded entries by comparing `retrieval.bytes` and
`retrieval.sha256` with the local files; do not count `unavailable` or `link_only`
entries as downloaded. Do not move private evaluation images into this folder.

No issuer contact, enrollment, applicant lookup, paid service, runtime integration,
database change, commit or deployment was performed for this collection.
