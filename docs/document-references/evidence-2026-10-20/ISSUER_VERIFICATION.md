# Issuer-verification evidence and access gaps

Reviewed 20 October 2026. These are documented verification routes, not enabled
integrations or successful checks of any applicant. No applicant identifiers
were queried and no agency was contacted. Publication dates and retrieval failures
are in [sources.json](sources.json). Document categories remain those of the
existing application.

| Category/issuer | Evidence for route | What must happen before a positive issuer result can be recorded |
| --- | --- | --- |
| National ID / PSA | [2025 charter](https://psa.gov.ph/system/files/citizens-charter/5-PSA-2025-Citizens-Charter-Philippine-Identification-System-Registry%20Office-External-Services.pdf), PDF page 26 onward; [eVerify](https://everify.gov.ph/) | Confirm the supported credential type and current onboarding requirements; obtain authorized relying-party access and official integration specifications. Validate the issuer response or signed credential using trusted issuer material, bound to this applicant and upload. Direct charter download was blocked; official browser text was inspected. |
| PRC | [e-PIC policy](https://www.prc.gov.ph/index.php/node/6109), [official verification portal](https://verification.prc.gov.ph/Verification), existing illustrated guide | Use the official supported profile/barcode verification procedure with appropriate authority. A public website is not a documented API. Record which credential and fields were checked; a professional-record match alone does not authenticate an image or its presenter. |
| Postal ID / PHLPost | [PHLPost partner-verification announcement](https://phlpost.gov.ph/cpt-press-releases/phlpost-announces-the-resumption-on-the-issuance-of-postal-id-as-functional-card/) | Confirm partnership/access to POVS, allowed use and response semantics. Do not scrape a partner portal or claim that merely reading its announcement enabled access. |
| SEC registration certificate | [SEC ZERO overview](https://esparc.sec.gov.ph/application/index), [downloaded guide](sec-zero-regular-guide.pdf) | Obtain the original digitally signed PDF and verify integrity, the signer and applicable trust/certificate status using supported tools. Compare entity identity. A screenshot/photograph of a signature cannot preserve PDF-signature verification. No certificate verification was performed here. |
| DTI business registration | [BNRS exact-name search](https://bnrs.dti.gov.ph/search), [published certificate fields](https://bnrs.dti.gov.ph/pdf/registration/business_law.pdf) | Use permitted exact-name queries and compare the returned business record. Treat this as registry corroboration, not proof of certificate-image authenticity, applicant authority or ownership. No supported API contract was established. |
| Driver's license / LTO | [2025 eGovPH eDL circular](https://lto.gov.ph/wp-content/uploads/2025/07/MC-GGP-2025-4530.pdf) | Confirm current supported eDL presentation/verification with LTO. This collection did not establish an API for arbitrary uploaded license photos; new circular PDF download was blocked. |
| Passport / DFA | [PRADO index](https://www.consilium.europa.eu/prado/en/prado-documents/phl/A/O/docs-per-type.html), [ICAO Part 4](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p4_cons_en.pdf) | Public specimens/MRZ checks are consistency evidence. Chip authentication or issuer confirmation is a separate capability requiring its own trusted implementation; neither is available from an ordinary upload alone. |
| UMID, SSS ID and GSIS ID | [SSS card guidance](https://www.sss.gov.ph/mysss-card/), [SSS circular](sss-mysss-card-circular-2025.pdf), [GSIS circular index](https://www.gsis.gov.ph/memorandum-circulars/) | Confirm issuer/card family and an authorized verification process. No supported third-party applicant-query integration established. Do not equate legacy cards with successor banking/digital products. |
| PhilHealth member ID | [2016 design circular](../philhealth-2016-027.pdf), [PVC advisory](../philhealth-pvc-advisory.pdf) | Design examples do not establish membership or image authenticity. Obtain a supported issuer process before claiming either; none established in this collection. |
| Voter's ID / COMELEC | [Historical generation notice](https://www.comelec.gov.ph/?r=VoterRegistration%2FPressReleases%2F20Dec2017pr) | Establish current issuer process and the exact credential. No current card-verification integration confirmed; voter certification is a separate document. |
| BIR Form 2303 and notice | [2026 charter](https://bir-cdn.bir.gov.ph/BIR/pdf/BIR%20Citizen%27s%20Charter%20%282026%20Edition%29v2.pdf), [2024 specifications](bir-minor-forms-2024.pdf) | Confirm supported BIR verification for the exact certificate/notice and branch. Matching a TIN's format does not establish taxpayer/certificate authenticity. No supported upload-authentication API established here. |
| Mayor's permit and barangay business clearance | [QC 2026 guidance](https://quezoncity.gov.ph/qcitizen-guides/how-to-register-as-a-nano-enterprise-in-qc/), [QC barangay update](https://quezoncity.gov.ph/qc-waives-barangay-business-clearance-fees-for-newly-registered-nano-enterprises/) | Identify issuing locality, year and credential; verify through that issuer's supported process. These local sources do not establish a nationwide portal or template. |
| CDA registration certificate | [2026 charter](https://cda.gov.ph/wp-content/uploads/2022/01/CDA-Citizens-Charter-Handbook-2026-1st-Edition.pdf), [historical circular](cda-certificate-standardization-2010.pdf) | Confirm cooperative identity and a supported CDA verification route. A certificate of compliance is distinct from a registration certificate; no production integration established. |

## Required evidence for any future integration

Keep approval for issuer access separate from permission to submit a document to
RentifyPro. Before activating a route, establish the allowed data, response meaning,
service limits, privacy/retention obligations and failure behavior with the issuer.
No secrets or applicant results belong in this public reference folder.

A meaningful verification result needs a record of the issuer/method, request
time, result state, fields actually confirmed, credential identifier or protected
reference, and binding to the correct file/session/review version. Statuses must
distinguish not attempted, unavailable, inconclusive, mismatch and verified.
Timeouts or lack of access cannot become a successful or fraudulent verdict.

QR text and document contents are untrusted input. Do not execute instructions,
follow arbitrary URLs, or fetch an upload-supplied address with server credentials.
Use the issuer's supported verification mechanism and trusted issuer endpoints/key
material. No such network behavior is added by this evidence pack.

Issuer/registry confirmation, holder identity, applicant authority to represent a
business, vehicle ownership and rental eligibility are separate questions. Preserve
the existing manual-review and selfie gates while evaluating any future change.
