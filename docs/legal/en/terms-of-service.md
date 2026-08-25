# Courtto Academy Terms of Service

**Version:** 2026-08-21
**Effective from:** [EFFECTIVE DATE]

> **DRAFT — requires review by qualified Polish counsel before publication.** See [README](../README.md).
>
> **This is a courtesy translation. The Polish version is binding** (§ 19.6). In the event of any discrepancy, the Polish text prevails.

These Terms govern the provision of services by electronic means within the meaning of the Polish Act of 18 July 2002 on Providing Services by Electronic Means and constitute the terms of service referred to in art. 8 of that Act.

---

## § 1. Definitions

1. **Provider** — [ENTITY NAME], [legal form], seated at [ADDRESS], Tax ID [NIP], [KRS / CEIDG registration], email: [kontakt@courtto.pl];
2. **Application** — the Courtto Academy software provided as SaaS at [https://app.courtto.pl], together with its programming interfaces;
3. **School** — an entrepreneur operating a racket-sports school or club that has entered into the Agreement and for which an Organization is maintained in the Application;
4. **Organization** — the School's isolated data environment in the Application, accessible only to Users assigned to it;
5. **User** — a natural person holding an Account in the Application;
6. **Account** — the set of resources and permissions assigned to a User, accessible after authentication;
7. **Role** — a User's scope of permissions within an Organization: `owner`, `admin`, `coach` or `student`;
8. **Participant** — a person attending classes organized by the School whose data the School processes in the Application, whether or not they hold an Account;
9. **Guardian** — the legal representative of a minor Participant, or another person designated by the School as a contact for a Participant;
10. **Trial Period** — the 14 days following creation of an Organization, during which the Application is provided free of charge;
11. **Subscription** — the paid provision of the Service under a selected plan;
12. **Participant Fees** — amounts owed to the School by Participants or Guardians for classes, collected through the Application as described in § 9;
13. **Payment Operator** — Stripe Payments Europe, Limited, seated in Dublin, Ireland, together with its affiliates;
14. **Agreement** — the agreement for the provision of services by electronic means concluded between the Provider and the School on the terms hereof;
15. **Terms** — this document.

## § 2. General provisions

1. The Terms are made available free of charge before conclusion of the Agreement at [https://app.courtto.pl/terms], in a manner permitting their retrieval, reproduction and recording.
2. The Application is intended **exclusively for entrepreneurs**. The Provider does not enter into Agreements with consumers.
3. Where the School is a natural person conducting business activity, the Parties agree that entering into the Agreement is of a professional character for that person within the meaning of art. 385(5) of the Polish Civil Code, as the Application serves the conduct of their business. Consumer protection provisions do not apply.
4. Use of the Application requires acceptance of the Terms. Acceptance is given by ticking the relevant box during Account creation and is recorded together with the version of the Terms and the date.
5. The Provider is not a party to the legal relationship between the School and a Participant or Guardian.

## § 3. Scope of services

1. The Provider supplies the Application as software under a SaaS model, comprising in particular:
   a) maintaining an Organization, including management of members and their roles;
   b) maintaining records of Participants, Guardians and consents;
   c) managing courts, zones and their availability;
   d) scheduling classes, including recurring classes, with enrolment, waiting lists and attendance records;
   e) in-application and email notifications;
   f) reports and summaries, including the compliance report and court utilization statistics;
   g) technical facilitation of Participant Fee collection under § 9.
2. The functions available to a School depend on the selected plan. Current plans are presented in the Application.
3. The Provider may develop the Application, including adding, modifying and withdrawing functions. Withdrawal of a function material to use of the Application follows the procedure in § 17.
4. The Service is continuous and provided for an indefinite term until the Agreement is terminated.

## § 4. Technical requirements

1. Use of the Application requires:
   a) a device with Internet access;
   b) a current version of the Chrome, Firefox, Safari or Edge browser with JavaScript enabled;
   c) cookies necessary for authentication enabled;
   d) an active email address.
2. The Provider advises that the use of services provided by electronic means carries risks typical of the Internet, in particular unauthorised access to data, malicious software and interception of transmissions. The Provider applies the measures described in § 13.5, which do not, however, eliminate risk on the User's device.
3. Users are advised to use a unique password, current anti-virus software and to log out promptly on shared devices.

## § 5. Conclusion of the Agreement, Account and authentication

1. The Agreement is concluded upon creation of an Organization by a User acting on behalf of the School.
2. When creating an Account, the User provides their name, email address and a password. Provision of this data is voluntary but necessary to conclude and perform the Agreement.
3. A User creating an Organization represents that they are authorised to conclude the Agreement on behalf of the School. The Provider may request evidence of such authority.
4. An Account is assigned to a single natural person. Sharing authentication credentials is prohibited, including within a single School. Every person with access to data should hold their own Account — this is a precondition for the audit log referred to in § 11.6 to function.
5. A minor may hold an Account only with the consent of their legal representative. The School inviting a Participant is responsible for verifying that such consent exists.
6. Users shall promptly notify the Provider of any suspected unauthorised access to an Account at [security@courtto.pl].
7. The Provider has no access to User passwords; passwords are stored solely as cryptographic hashes.

## § 6. Roles and permissions

1. A User's permissions within an Organization follow from their assigned Role. The `owner` Role carries the broadest permissions, including the exclusive right to manage the Subscription, configure Participant Fee collection and transfer ownership of the Organization.
2. The School assigns and revokes Roles independently. The Provider does not verify whether their assignment is justified.
3. The School shall ensure that each User's access corresponds to the scope of their duties and shall promptly revoke access from persons who have ceased cooperation. This is the School's obligation as data controller under art. 32 GDPR.
4. An Organization must at all times have at least one User with the `owner` Role. The Application prevents operations that would breach this rule.

## § 7. Trial Period and Subscription

1. A newly created Organization uses the Application free of charge for a Trial Period of 14 days. The Trial Period does not require payment card details.
2. After the Trial Period, use of the Application requires a Subscription.
3. Absence of an active Subscription after the Trial Period results in the Organization being **restricted to read-only mode**: the School retains access to its data and the ability to export it but cannot make changes. Data is not deleted on this ground.
4. The Subscription is billed monthly, in advance, at the rates in force when ordered.
5. Prices shown in the Application are net; value added tax is added at the rate applicable on the invoice date.
6. A change in pricing does not affect a billing period already paid for and follows the procedure in § 17.
7. The School may change plan or cancel the Subscription at any time in the billing management panel. Cancellation takes effect at the end of the paid billing period. Fees for a commenced period are non-refundable unless cancellation results from causes attributable to the Provider.

## § 8. Subscription payments

1. Subscription payments are handled by the Payment Operator. The Provider does not process or store payment card data.
2. Invoices are issued by the Provider and made available in the billing management panel.
3. Where a charge fails, the Provider retries in accordance with the Payment Operator's rules and notifies the School. Continued non-payment results in the restriction under § 7.3.
4. The Provider may charge statutory interest for late payment in commercial transactions.

## § 9. Collection of Participant Fees

> This section governs a money flow separate from the Subscription: **the Participant pays the School**, not the Provider.

1. The Application enables the School to collect Participant Fees through the Payment Operator using a connected account model (Stripe Connect).
2. **The School alone is the seller of the training services and the recipient of Participant Fees.** The Provider is not a party to the agreement for the provision of classes, does not acquire Participant funds and does not provide payment services within the meaning of the Polish Payment Services Act.
3. In particular, the School is responsible for:
   a) setting class prices and settlement terms with Participants;
   b) issuing invoices or receipts and accounting for value added tax;
   c) handling complaints, refunds and chargebacks;
   d) discharging information and consumer obligations towards Participants and Guardians, including those concerning the right of withdrawal from a distance contract.
4. Collection of Participant Fees requires creation and successful verification of a connected account with the Payment Operator and acceptance of its terms. Verification rests solely with the Payment Operator; the Provider has no influence over its outcome or timing.
5. Participant Fees are credited to the School's connected account and paid out in accordance with the Payment Operator's rules. The Provider does not hold these funds.
6. The Provider is entitled to a commission on Participant Fees at the rate stated in the price list, collected automatically upon settlement. **As at the effective date of these Terms the commission is 0%.** Its introduction follows the procedure in § 17.
7. Collection of Participant Fees requires an active Subscription.
8. A Participant's failure to pay results solely in the enrolment being flagged as overdue and the School being notified. **The Application does not unenrol a Participant or block their access on account of non-payment** — that decision rests with the School.

## § 10. Personal data

1. In respect of the data of Users creating an Account, the Provider is the controller. Processing is described in the **Privacy Policy** at [https://app.courtto.pl/privacy].
2. In respect of the data of Participants, Guardians and other data entered by the School into its Organization, **the School is the controller** and the Provider is a processor.
3. Processing is entrusted under a **Data Processing Agreement** annexed to these Terms, which the School enters into upon accepting the Terms. The Data Processing Agreement prevails over these Terms in matters of personal data processing.
4. The School represents that it has a legal basis for processing the data it enters into the Application and that it has discharged its information obligation towards data subjects — including towards Guardians whose data it obtains other than from them directly (art. 14 GDPR).
5. The Provider makes template clauses and consent forms available to Schools. These are of an auxiliary nature and **do not relieve the School of its own assessment** of their adequacy.

## § 11. Data and content entered by the School

1. The School retains all rights to data entered into its Organization.
2. The School is responsible for the lawfulness, accuracy and currency of the data it enters.
3. Entering unlawful content into the Application is prohibited, in particular content infringing personal rights, intellectual property rights or data protection law.
4. **It is prohibited to enter into free-text fields — in particular the member profile notes and guardian notes fields — data revealing health, racial or ethnic origin, political opinions, religious or philosophical beliefs, trade union membership, genetic or biometric data, or data concerning sex life or sexual orientation** within the meaning of art. 9(1) GDPR. Those fields are not intended for processing such data and are not covered by measures appropriate to that category. Breach of this prohibition rests with the School as controller.
5. The Provider does not monitor content entered by the School. Upon obtaining credible notice of unlawful data, the Provider may disable access to it and notify the School, in accordance with art. 14 of the Act on Providing Services by Electronic Means.
6. The Application maintains an audit log recording operations on Organization members and financial operations. Log entries serve accountability purposes and **cannot be edited or deleted** by the School.
7. The School may export its Organization's data at any time in a machine-readable format.

## § 12. Prohibited use

1. It is prohibited to:
   a) take actions disrupting the Application, including attempts at unauthorised access, penetration testing without written consent, and denial-of-service attacks;
   b) reproduce, decompile or modify the Application beyond the scope permitted by mandatory law;
   c) automatically extract data other than through the interfaces provided;
   d) make the Application available to third parties, including resale of access, without the Provider's written consent;
   e) use the Application for purposes other than operating a sports school or club.
2. Breach of section 1 entitles the Provider to suspend access following an ineffective demand to cease the breach with a deadline of no less than 7 days, unless the breach threatens the security of the Application or of other Schools' data — in which case suspension is immediate and notice is given promptly thereafter.

## § 13. Availability and security

1. The Provider endeavours to keep the Application continuously available.
2. The Provider reserves the right to technical maintenance windows. Planned windows fall, where possible, outside 07:00–22:00 Central European Time and are announced at least 48 hours in advance.
3. [OPTIONAL — to be decided: a guaranteed service level of 99.5% per month, calculated excluding planned maintenance, with a remedy in the form of an extension of the Subscription.]
4. The Provider maintains data backups. The declared recovery point objective (RPO) is [24 hours] and the recovery time objective (RTO) is [8 hours].
5. The Provider applies the technical and organisational measures described in Annex 3 to the Data Processing Agreement, including transport encryption, storage of passwords solely as cryptographic hashes, logical isolation of each Organization's data, and event logging.
6. Data is processed and stored **exclusively within the European Economic Area**.

## § 14. Liability

1. The Provider is liable for non-performance or improper performance of the Agreement on general terms, subject to the limitations below.
2. The Provider's liability under the Agreement is limited to actual damage and to an amount equal to [the Subscription fees paid by the School in the 12 months preceding the event]. This limitation does not apply to damage caused intentionally or where exclusion of liability is impermissible.
3. The Provider is not liable for:
   a) the consequences of inaccurate data supplied by the School or a User;
   b) the consequences of disclosing authentication credentials to an unauthorised person;
   c) the content and lawfulness of data entered by the School, including breach of the prohibition in § 11.4;
   d) settlements between the School and Participants, including unpaid amounts;
   e) the decisions and timing of the Payment Operator, including refusal to verify a connected account;
   f) unavailability of the Application caused by force majeure or failure on the part of infrastructure suppliers, provided the Provider exercised due care in their selection and supervision.
4. The limitations in sections 2 and 3 **do not apply to liability for personal data breaches**, which is governed by art. 82 GDPR and the Data Processing Agreement.
5. The School shall hold the Provider harmless against third-party claims and reasonable defence costs where the claim arises from the School's breach of § 10.4 or § 11.3–4.

## § 15. Complaints

1. Complaints are submitted to [support@courtto.pl] or in writing to the Provider's registered address.
2. A complaint should identify the School, describe the objections, state the date the problem arose and specify the remedy sought.
3. The Provider considers complaints within **14 days** of receipt. In particularly complex matters this may be extended to 30 days, of which the Provider gives notice before the original deadline expires.
4. A response is sent to the email address from which the complaint was submitted unless otherwise indicated.
5. Data protection matters are directed to [privacy@courtto.pl] and are subject to GDPR deadlines rather than those in section 3.

## § 16. Term and termination

1. The Agreement is concluded for an indefinite term.
2. The School may terminate at any time with effect at the end of the paid billing period, by cancelling the Subscription in the Application or by notice to the address in § 15.1.
3. The Provider may terminate on **30 days'** notice.
4. The Provider may terminate with immediate effect where:
   a) § 12.1 is grossly breached;
   b) Subscription arrears exceed 30 days, following an ineffective demand with a 7-day deadline;
   c) the Application is used in a manner threatening the security of other Schools' data.
5. **Following termination, Organization data remains available for export for 30 days.** Thereafter it is permanently deleted, together with backups in their rotation cycle, save for data whose retention is required by law, in particular accounting records retained for 5 years under art. 74(2) of the Polish Accounting Act.
6. Deletion of a User's Account does not terminate the Agreement with the School. Deletion of the Account of the sole User holding the `owner` Role is not possible until ownership of the Organization has been transferred.

### Permanent discontinuation of the Service

7. The Provider undertakes to notify the School of any intention to permanently discontinue the Service **at least 90 days in advance**, by email and by a message in the Application.
8. During the notice period under section 7, the Provider maintains the Application at least to the extent required for reading and exporting data. The School is not charged Subscription fees for periods after the discontinuation date, and fees paid for an unused period are refunded pro rata.
9. Throughout the period under section 7 and for **30 days after** the discontinuation date, the School may download the complete Organization data in a machine-readable format. The Provider supplies a description of the exported data structure sufficient to load it into another system.

### Insolvency of the Provider

10. Where a petition for the Provider's bankruptcy is filed, bankruptcy is declared, or liquidation is opened, the Provider — and after a declaration of bankruptcy the trustee or liquidator within the scope of their powers — shall promptly notify the School and enable the download of Organization data on the terms in section 9.
11. **The Provider states the limits of that undertaking honestly.** A trustee's powers derive from statute — Polish bankruptcy law permits withdrawal from mutual contracts not performed in full — and may limit the effectiveness of contractual commitments towards the School. For that reason, **the only fully effective safeguard is for the School to download its own copy of the Organization data regularly.** The Provider supplies an export function for that purpose and recommends using it no less than once a month.
12. **Organization data does not form part of the Provider's assets.** The Provider processes it solely as a processor, on the School's instructions, and acquires no rights to it. Such data may not be sold, pledged or otherwise disposed of separately from the Agreement, including in bankruptcy or liquidation proceedings. A sale of the Provider's business is governed by § 19.5, together with the School's right to terminate.
13. Confidentiality and processing-security obligations under the Data Processing Agreement remain binding in bankruptcy or liquidation and bind any entity that in fact processes the entrusted data.

### Independence from the Provider

14. The Provider does not employ measures that make changing supplier difficult. Data is exported in commonly used, open formats, and downloading it is not conditional on an additional fee or on the Provider's consent.
15. [OPTIONAL — to be decided for clients requiring heightened assurances: at the School's request, the Provider shall enter into a source code escrow agreement with an independent agent, providing for release of the code to the School upon permanent discontinuation of the Service or the Provider's bankruptcy. The cost of the escrow is borne by the School requesting it.]

## § 17. Amendments

1. The Provider may amend the Terms for valid reasons, in particular: changes in law, changes to the scope or manner of service provision, changes to pricing, changes affecting subcontractors, or the need to raise the level of security.
2. The Provider gives notice of amendments by email and by a message in the Application, **no later than 14 days before** the change takes effect.
3. A School that does not accept an amendment may terminate with effect as of the day preceding its entry into force. Failure to terminate within that period constitutes acceptance.
4. Amendments consisting solely of the correction of clerical errors or of editorial changes not affecting rights and obligations do not require the procedure in section 2.
5. The current and previous versions of the Terms, with their effective dates, are available at [https://app.courtto.pl/terms].

## § 18. Intellectual property

1. The Application, its code, interface, documentation, trade marks and other designations are the property of the Provider or the Provider holds the relevant rights. The Agreement does not transfer those rights.
2. The School obtains a non-exclusive, non-transferable licence, limited to the term of the Agreement, to use the Application in accordance with its intended purpose.
3. Section 1 does not apply to data entered by the School as referred to in § 11.1.
4. The Provider may use the School's name and logo in reference materials **only with its prior consent**, which may be withdrawn at any time.

## § 19. Final provisions

1. The governing law is Polish law. This choice does not deprive the School of protection afforded by mandatory provisions of the law of its country of establishment, where applicable.
2. The competent court is the common court having jurisdiction over the Provider's registered seat.
3. The Parties shall endeavour to resolve disputes amicably before commencing court proceedings.
4. Should any provision prove invalid or ineffective, the remaining provisions remain in force, and the invalid provision is replaced by one closest to its economic purpose.
5. The School may not assign its rights and obligations without the Provider's written consent. The Provider may assign its rights and obligations to a legal successor or acquirer of its business upon 30 days' notice to the School, in which case the School is entitled to terminate.
6. The Terms are made available in Polish and English. **In the event of any discrepancy, the Polish version prevails.**
7. Annexes forming an integral part of the Terms:
   - Annex 1 — Privacy Policy;
   - Annex 2 — Data Processing Agreement with its annexes;
   - Annex 3 — Price list.
