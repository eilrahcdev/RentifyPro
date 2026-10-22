const freeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const source = (title, url, kind, archive = "") => ({ title, url, kind, checkedOn: "2026-10-20", ...(archive ? { archive } : {}) });

export const DOCUMENT_REFERENCE_SOURCES = freeze({
  psa: source("PSA: National ID formats and authentication", "https://psa.gov.ph/content/psa-bsp-all-formats-national-id-accepted-financial-transactions", "issuer_guidance"),
  passport2010: source("PRADO Philippine passport 02001", "https://www.consilium.europa.eu/prado/en/PHL-AO-02001/index.html", "public_specimen"),
  passport2016: source("DFA: new ePassport design, 2016", "https://genevapm.dfa.gov.ph/consulate-press-releases/364-phl-consulate-general-in-geneva-starts-issuance-of-new-philippine-epassport", "issuer_guidance"),
  icao3: source("ICAO Doc 9303 Part 3: check digits", "https://www.icao.int/sites/default/files/publications/DocSeries/9303_p3_cons_en.pdf", "technical_standard"),
  icao4: source("ICAO Doc 9303 Part 4: TD3 passports", "https://www.icao.int/sites/default/files/publications/DocSeries/9303_p4_cons_en.pdf", "technical_standard"),
  lto: source("LTO electronic driver's license circular", "https://www.lto.gov.ph/wp-content/uploads/2023/08/MC_HAV-2023-2410.pdf", "issuer_guidance"),
  sss: source("SSS membership and accepted SS ID/UMID references", "https://www.sss.gov.ph/become-an-sss-member/", "issuer_guidance"),
  gsis: source("GSIS UMID, eCard and eCard Plus", "https://www.gsis.gov.ph/ginhawa-for-all/umid-card/", "issuer_guidance"),
  prc: source("PRC verification and e-PIC guidance", "https://verification.prc.gov.ph/Verification", "issuer_lookup"),
  prcGuide: source("PRC illustrated card verification procedure", "https://www.prc.gov.ph/sites/default/files/Annex%20B%20-%20Step%20by%20Step%20Procedure.pdf", "illustrated_guidance", "prc-verification-guide.pdf"),
  philhealth: source("PhilHealth Circular 2016-027: card design", "https://www.philhealth.gov.ph/circulars/2016/circ2016-027.pdf", "public_specimen", "philhealth-2016-027.pdf"),
  philhealthPvc: source("PhilHealth PVC health insurance card advisory", "https://www.philhealth.gov.ph/advisories/2016/adv2016-0012.pdf", "public_specimen", "philhealth-pvc-advisory.pdf"),
  postal: source("PHLPost verification partnership information", "https://phlpost.gov.ph/cpt-press-releases/phlpost-announces-the-resumption-on-the-issuance-of-postal-id-as-functional-card/", "issuer_guidance"),
  comelec: source("COMELEC voter ID information (historical guidance)", "https://www.comelec.gov.ph/?r=VoterRegistration%2FWhatisVoterRegistration%2FVoterIDIssuance", "issuer_guidance"),
  dti: source("DTI BNRS exact-name search", "https://bnrs.dti.gov.ph/search", "issuer_lookup"),
  sec: source("SEC eSPARC digitally signed certificates", "https://nameverification.sec.gov.ph/application", "issuer_guidance"),
  qc: source("Quezon City business permit issuance", "https://quezoncity.gov.ph/wp-content/uploads/2025/04/ISSUANCE-OF-NEW-BUSINESS-PERMIT.pdf", "local_issuer_guidance"),
  bir2303: source("BIR documentary requirements and electronic COR", "https://web-services.bir.gov.ph/eappointment/files/checklist_of_documentary_requirements.pdf", "issuer_guidance"),
  birNotice: source("BIR RMO 43-2022 NIRI guidance", "https://bir-cdn.bir.gov.ph/local/pdf/RMO%20No.%2043-2022%20Digest%20RGA.pdf", "issuer_guidance", "bir-niri-43-2022-digest.pdf"),
  barangay: source("DILG barangay business clearance guidance", "https://region12.dilg.gov.ph/sites/default/files/issuances/MC2010-142.pdf", "local_issuer_guidance"),
  cda: source("CDA MC 2010-09 certificate standardization", "https://cda.gov.ph/memorandum-circulars/mc-2010-09-guidelines-on-the-standardization-of-certificate-of-registration/", "issuer_guidance"),
});

const variant = (id, format, sources, evidence = "guidance_only") => ({ id, format, sources, evidence,
  evaluationStatus: "not_evaluated", exactLayoutConfirmed: false });
const document = (id, documentType, docType, issuer, requiredFields, expiry, variants, gaps, issuerMethod = "manual_issuer_contact") => ({
  id, documentType, docType, issuer, coverage: "partial",
  applicationRequirements: { requiredFields, expiry }, variants, gaps,
  evaluation: { genuineSamples: 0, accuracyEstablished: false },
  issuerVerification: { method: issuerMethod, integration: "not_integrated", automaticallyAttempted: false },
});

// Application requirements describe RentifyPro's existing rules, not every issuer's historical policy.
export const DOCUMENT_REFERENCE_CATALOG = freeze({
  schemaVersion: 1, revision: "2026-10-20.1", mode: "shadow", complete: false,
  documents: [
    document("philsys", "PhilSys National ID", "id", "PSA", ["name", "document_number", "birth_date_when_required"], "if_printed", [
      variant("philsys-card", "physical_card", ["psa"]), variant("philsys-paper", "paper", ["psa"]),
      variant("philsys-digital", "digital", ["psa"])], ["Exact version inventory and representative consented samples needed", "QR authentication requires a separate supported integration"], "signed_qr"),
    document("passport", "Philippine Passport", "id", "DFA", ["name", "document_number", "birth_date_when_required"], "required", [
      variant("passport-2010-reference", "booklet_biodata_page", ["passport2010", "icao3", "icao4"], "specimen_identified"),
      variant("passport-2016-reference", "booklet_biodata_page", ["passport2016", "icao3", "icao4"])],
    ["Reference years are not an exhaustive list of valid versions", "MRZ checks are advisory consistency checks, not chip or issuer authentication"], "chip_or_issuer_authentication"),
    document("lto", "LTO Driver's License", "id", "LTO", ["name", "document_number", "birth_date_when_required"], "required", [
      variant("lto-physical-version-unconfirmed", "physical_card", ["lto"]), variant("lto-edl-2023-guidance", "electronic_license", ["lto"])],
    ["Physical card versions and authorized digital presentation need separate evaluation"], "issuer_license_lookup"),
    document("umid", "UMID", "id", "SSS/GSIS", ["name", "document_number", "birth_date_when_required"], "if_printed", [
      variant("umid-sss-reference", "physical_card", ["sss"]), variant("umid-gsis-reference", "physical_card", ["gsis"])],
    ["Generic UMID, bank-linked cards and agency variants must not be silently equated"]),
    document("prc", "PRC ID", "id", "PRC", ["name", "document_number", "birth_date_when_required"], "required", [
      variant("prc-physical-reference", "physical_card", ["prc", "prcGuide"], "illustration_identified"),
      variant("prc-epic-reference", "electronic_card", ["prc", "prcGuide"], "illustration_identified")],
    ["Profession/card generations need representative evaluation", "A matching professional record does not authenticate an uploaded image"], "issuer_license_lookup"),
    document("sss", "SSS ID", "id", "SSS", ["name", "document_number", "birth_date_when_required"], "if_printed", [
      variant("sss-legacy-version-unconfirmed", "physical_card", ["sss"])], ["Legacy specimens still needed; new banking products are not automatically accepted variants"]),
    document("gsis", "GSIS ID", "id", "GSIS", ["name", "document_number", "birth_date_when_required"], "if_printed", [
      variant("gsis-ecard-reference", "physical_card", ["gsis"]), variant("gsis-ecard-plus-reference", "physical_card", ["gsis"])],
    ["Exact eCard and legacy designs remain unconfirmed; UMID is a separate selected category"]),
    document("philhealth", "PhilHealth ID", "id", "PhilHealth", ["name", "document_number", "birth_date_when_required"], "if_printed", [
      variant("philhealth-2016-paper-reference", "paper_card", ["philhealth"], "specimen_identified"),
      variant("philhealth-pvc-reference", "physical_card", ["philhealthPvc"], "specimen_identified")],
    ["Other member-group and historical variants need collection", "A variant missing a field required by registration cannot establish it"]),
    document("postal", "Postal ID", "id", "PHLPost", ["name", "document_number", "birth_date_when_required"], "required", [
      variant("postal-physical-version-unconfirmed", "physical_card", ["postal"])], ["Card generations need specimen evaluation", "POVS access requires supported partnership arrangements"], "partner_verification"),
    document("voter", "Voter's ID", "id", "COMELEC", ["name", "document_number", "birth_date_when_required"], "if_printed", [
      variant("voter-legacy-version-unconfirmed", "physical_card", ["comelec"])], ["Historical issuance guidance is not a complete specimen library", "Voter certifications are not automatically an ID-card variant"]),
    document("dti", "DTI Business Name Registration", "supporting", "DTI", ["business_name", "registration_number"], "required", [
      variant("dti-certificate-version-unconfirmed", "certificate", ["dti"])], ["Certificate layout versions still need collection", "Exact-name registry lookup is not a certificate-image authenticity check"], "business_registry_lookup"),
    document("sec", "SEC Certificate of Registration", "supporting", "SEC", ["business_name", "registration_number"], "if_printed", [
      variant("sec-paper-reference", "paper_certificate", ["sec"]), variant("sec-digitally-signed-reference", "signed_pdf", ["sec"])],
    ["Company/partnership certificate versions need evaluation", "A photograph cannot preserve a PDF's cryptographic signature"], "pdf_signature_and_registry"),
    document("mayor", "Mayor's/Business Permit", "supporting", "Issuing city/municipality", ["business_name", "permit_number"], "required", [
      variant("mayor-qc-guidance", "local_permit", ["qc"])], ["Quezon City guidance does not establish national coverage", "Track issuing LGU, permit year and actual issued specimens"]),
    document("bir-cor", "BIR Certificate of Registration (Form 2303)", "supporting", "BIR", ["business_name", "tin", "branch_code"], "if_printed", [
      variant("bir-2303-paper-reference", "paper_certificate", ["bir2303"]), variant("bir-2303-electronic-reference", "electronic_certificate", ["bir2303"])],
    ["Paper/electronic COR specimens and revision dates still need collection"]),
    document("bir-niri", "BIR Notice to Issue Receipt/Invoice", "supporting", "BIR", ["business_name", "tin", "branch_code"], "if_printed", [
      variant("bir-niri-2022-guidance", "posted_notice", ["birNotice"])], ["Issuance digest is guidance, not a complete notice specimen", "Do not silently expand acceptance to unrelated invoice forms"]),
    document("barangay", "Barangay Business Clearance", "supporting", "Issuing barangay/LGU", ["business_name", "reference_if_supplied"], "if_printed", [
      variant("barangay-local-version-unconfirmed", "local_clearance", ["barangay"])], ["Collect issued specimens by barangay/LGU and year; no nationwide template is established"]),
    document("cda", "CDA Certificate of Registration", "supporting", "CDA", ["business_name", "registration_number"], "if_printed", [
      variant("cda-2010-standardization-reference", "certificate", ["cda"])], ["Standardization guidance and later issued versions require specimen evaluation"]),
  ],
});
