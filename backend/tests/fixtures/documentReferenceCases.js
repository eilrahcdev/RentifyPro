export function syntheticReferenceCases() {
  const definitions = [
    ["PhilSys National ID", "PAMBANSANG PAGKAKAKILANLAN"],
    ["Philippine Passport", "REPUBLIC OF THE PHILIPPINES", "PASAPORTE / PASSPORT"],
    ["LTO Driver's License", "LAND TRANSPORTATION OFFICE", "DRIVER'S LICENSE"],
    ["UMID", "UNIFIED MULTI-PURPOSE ID"], ["PRC ID", "PROFESSIONAL REGULATION COMMISSION", "PROFESSIONAL IDENTIFICATION CARD"],
    ["SSS ID", "SOCIAL SECURITY SYSTEM", "SSS IDENTIFICATION CARD"],
    ["GSIS ID", "GOVERNMENT SERVICE INSURANCE SYSTEM", "GSIS E-CARD"],
    ["PhilHealth ID", "PHILIPPINE HEALTH INSURANCE CORPORATION", "PHILHEALTH IDENTIFICATION CARD"],
    ["Postal ID", "PHILIPPINE POSTAL CORPORATION", "POSTAL ID"], ["Voter's ID", "COMMISSION ON ELECTIONS", "VOTER'S IDENTIFICATION CARD"],
    ["DTI Business Name Registration", "DEPARTMENT OF TRADE AND INDUSTRY", "CERTIFICATE OF BUSINESS NAME REGISTRATION"],
    ["SEC Certificate of Registration", "SECURITIES AND EXCHANGE COMMISSION", "CERTIFICATE OF INCORPORATION"],
    ["Mayor's/Business Permit", "CITY OF SAMPLE", "BUSINESS PERMIT"],
    ["BIR Certificate of Registration (Form 2303)", "BUREAU OF INTERNAL REVENUE", "CERTIFICATE OF REGISTRATION", "BIR FORM 2303"],
    ["BIR Notice to Issue Receipt/Invoice", "BUREAU OF INTERNAL REVENUE", "NOTICE TO ISSUE RECEIPT / INVOICE"],
    ["Barangay Business Clearance", "BARANGAY SAMPLE", "BUSINESS CLEARANCE"],
    ["CDA Certificate of Registration", "COOPERATIVE DEVELOPMENT AUTHORITY", "CERTIFICATE OF REGISTRATION"],
  ];
  const profile = { first_name: "Sample", last_name: "Applicant", date_of_birth: "1990-05-12", business_name: "Sample Rentals",
    permit_number: "TEST123", tax_identification_number: "123456789", branch_code: "00000" };
  const cases = definitions.map(([selectedDocType, ...headers], index) => ({ selectedDocType, docType: index < 10 ? "id" : "supporting",
    role: index < 10 ? "user" : "owner", profile: { ...profile }, sampleKind: "synthetic", split: "regression",
    expected: { documentType: selectedDocType, outcome: "passed", fields: index < 10 ? { full_name: "SAMPLE APPLICANT", birth_date: "1990-05-12" } : { business_name: "SAMPLE RENTALS" } },
    inspection: { schema_version: 1, provider: "paddleocr", pages: 1, lines: [...headers, "Full Name: SAMPLE APPLICANT", "Date of Birth: 1990-05-12",
      "Document Number: TEST123", "Expiration Date: 2099-05-12", "Business Name: SAMPLE RENTALS", "Permit Number: TEST123",
      "TIN: 123456789", "Branch Code: 00000"].map(text => ({ text, page: 1, confidence: 0.99 })) } }));
  for (const base of [...cases]) {
    const wrongName = structuredClone(base);
    if (base.docType === "id") wrongName.profile.first_name = "Different";
    else wrongName.profile.business_name = "Different Business";
    wrongName.expected.outcome = "correction_needed";
    cases.push(wrongName);
    const uncertain = structuredClone(base);
    uncertain.inspection.lines.forEach(line => { line.confidence = 0.8; });
    uncertain.expected.outcome = "review_needed";
    cases.push(uncertain);
  }
  const unsupported = structuredClone(cases[0]);
  unsupported.inspection.lines = [{ text: "Fictional Club Membership Card", page: 1, confidence: 0.99 }];
  unsupported.expected = { documentType: "Unknown", outcome: "correction_needed" }; cases.push(unsupported);
  return { schemaVersion: 1, evaluationDate: "2026-10-20T00:00:00Z", cases };
}
