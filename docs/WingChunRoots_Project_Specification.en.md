# WingChunRoots Project Specification

English consolidation of the project description, prepared 30 September 2026.

WingChunRoots is a proposed multilingual platform for preserving Wing Chun teaching lineages, connecting practitioners with schools, and supporting instructors and federations. Its central product is a documented network of teacher–student relationships, supported by profiles, verification, a school map, and a digital training passport. Subscriptions, publishing, merchandise, and promotion provide the proposed revenue streams.

## 1. Document status and source treatment

This specification consolidates the Bulgarian Word document `Генеалогично дърво на Винг Чун.docx` and the accompanying `WingChunRoots_Documentation.md`. The Word document contains 1,757 paragraphs and 14 tables, including repeated discussions, examples, later corrections, and draft promotional and legal text. The original files remain unchanged.

The user requested a structured English specification preserving distinct requirements rather than a translation of every exchange. Repeated explanations and conversational prompts have therefore been consolidated. Proposed copy is represented by its purpose, content, and triggers rather than repeated verbatim.

The following distinctions apply throughout:

- **Source requirement:** a feature or business rule described in the supplied material. It is not necessarily approved for the first release.
- **Source proposal:** an option, example, commercial assumption, or draft policy that still requires a decision.
- **Planning clarification:** a correction or implementation recommendation introduced during consolidation. These are explicitly identified, principally in Section 23 and the separate execution plan.

Later explicit changes take precedence where the source is clear: five account types; one photo for a free student; two photos for a free Sifu; multiple simultaneous teachers; preservation of lineage after subscription expiry; and administrator review for succession. Remaining contradictions are recorded rather than silently resolved.

Source examples involving Sifu Stefan Kunev, teaching dates, schools, ranks, generation numbers, and lineage are illustrative until confirmed by the owner. The spellings “Ci zhan jiang,” “Chi Zhan Jiang,” and “Chī Shǒu Jiāng,” and the characters “黐手將,” occur in different forms in the source. Their equivalence and the preferred public spelling require confirmation.

## 2. Purpose and audience

### 2.1 Product objectives

- Preserve the history of Wing Chun / Ving Tsun / Wing Tsun across branches and countries.
- Make the evidence and approval behind teaching relationships visible.
- Help prospective students find schools by geography and lineage.
- Give practitioners a record of training, examinations, certificates, and seminars.
- Give Sifus tools to manage their presence, students, and schools.
- Give federations tools to administer their own organizations without controlling the historical record of other branches.
- Turn approved, consented data into lineage posters, certificates, country almanacs, and lineage monographs.
- Support a broader community through events, products, greetings, and promotion.

### 2.2 Audiences and responsibilities

| Audience | Principal needs |
| --- | --- |
| Visitor or prospective student | Search the archive, explore lineages, find schools and events |
| Free student | Basic profile, teacher relationship requests, entry into the lineage network |
| Premium student | Full training passport, certificates, media, event notifications, personal posters |
| Free Sifu | Verified identity and lineage with limited student administration |
| Professional Sifu | Student administration, public school presence, media, events, selling and promotion |
| Federation or organization | Authorized branch administration, bulk import, certification, analytics and branding |
| Parent or guardian | Manage child profiles, permissions and subscriptions |
| Archivist or authenticity committee | Review historical claims and supporting evidence |
| Moderator or arbitration board | Resolve disputes, abuse reports and succession requests |
| Platform administrator | Manage access, operations, publishing and platform configuration |

Parent, moderator, archivist and administrator are functional roles, not additional paid subscription tiers.

## 3. Account plans and entitlements

### 3.1 Consolidated source matrix

Prices are source proposals in USD, not approved launch prices. Quotas are the latest explicit values in the source. A paid entitlement does not by itself establish authenticity.

| Feature | Tier 1 Free Student | Tier 2 Premium Student | Tier 1-B Free Sifu | Tier 3 Professional Sifu | Tier 4 Federation |
| --- | --- | --- | --- | --- | --- |
| Proposed monthly price | $0 | $4 | $0 | $19 | $99 |
| Advertising | Yes | No | Yes | No | No |
| Names and Kung Fu identity | Yes | Yes | Yes | Yes | Organization and leader identity |
| Training start information | Start year | Start year and timeline | Start year and experience | Detailed training history | Organization history |
| Photo allowance | 1 | 10 | 2 | 100 | Unlimited in source |
| Video allowance | 0 | 2 | 0 | 20 | Unlimited in source |
| Claim teacher relationships | Yes | Yes | Yes | Yes | Organization root and authorized relationships |
| Approve students | No | No | Up to 5 | Unlimited in source | Unlimited within authorized scope |
| Public school map presence | Browse only | Browse only | No school pin | Active school pin | Organization heatmap and school network |
| School schedule and business profile | No | No | No | Yes | Yes |
| Digital passport | Basic | Full timeline | Basic instructor record | Full instructor record | Administrative dashboard |
| Digital successor | No | No | No | Yes | Yes |
| Marketplace | Buyer | Buyer | No selling entitlement | Up to 20 listings | Global brand catalog |
| Events | Browse | Browse and notifications | No publishing entitlement | Up to 2 events per month | Unlimited publishing and community push in source |
| Lineage poster ordering | No | Personal | No | School | Federation |
| Almanac inclusion | Purchase only | Name only | Name and lineage | Full page with photo and biography | Premium branded section |

Almanac inclusion also requires consent and the appropriate verification. Tier 4 includes bulk CSV/Excel import, digital certificate issuance, organization analytics by country and city, and administration of affiliated schools.

Earlier sections allow certificate uploads for Tiers 2–4. The free Sifu verification process also needs evidence submission, although the final matrix does not specify a public certificate gallery for that tier. Evidence uploads and gallery quotas must be defined separately.

“Unlimited” must receive an operational definition before implementation. The source does not specify file sizes, storage ceilings, fair use, or video duration. Free Sifu access to general marketplace browsing and event browsing is also not explicit; the matrix clearly restricts selling and publishing.

### 3.2 Upgrade interactions

- A free student attempting a second photo sees the Tier 2 benefits and proposed price.
- A free Sifu attempting a third photo sees the Tier 3 gallery, map, marketplace and event benefits.
- A free Sifu attempting to approve a sixth student sees a Tier 3 upgrade prompt; the request remains pending.
- Prompts provide a close or cancel action.
- The source requests that the interrupted action continue after a successful upgrade. The implementation must recheck authorization and prevent duplicate uploads or approvals.

## 4. Profile information and multilingual support

### 4.1 Practitioner profile

Store a stable identifier, account ownership, verification status and account plan, together with:

- First and last name in the original language and Latin script.
- Chinese name or characters, pinyin, Kung Fu nickname, title, and searchable aliases where supplied.
- Preferred interface language and biographies in multiple languages.
- Active teacher, inactive practitioner, deceased or memorial status.
- Country, city, associated schools and organizations.
- Training start year and training periods with individual teachers.
- Current rank and issuing organization; instructor or master titles where applicable.
- Teaching relationships and lineage branches.
- Generation number relative to a specified lineage root, where supportable.
- Forms and weapons taught or studied: Siu Nim Tao, Chum Kiu, Biu Jee, Muk Yan Jong, Luk Dim Boon Kwun and Baat Cham Dao are source examples.
- Photo, video and certificate records within the relevant entitlements.
- Birth information for age handling and optional birthday features, with visibility controls.
- Separate publication, social sharing and other consent settings.
- Successor nomination and last activity where applicable.

### 4.2 School profile

School or academy name, instructor links, organization membership, country and city, exact address and geographic coordinates where appropriate, public location preference, website, contact methods, training schedule, fees, forms taught, room photographs, school logo and trial lesson contact action.

The source includes WhatsApp/Viber contact links and a school profile view counter, with a weekly regional views example. These are feature ideas, not existing integrations or measured activity.

### 4.3 Organization application

The Tier 4 application collects:

1. Official organization or federation name.
2. Name and Kung Fu title of the leader.
3. Official website.
4. Headquarters country.
5. Approximate number of affiliated schools.
6. Optional supporting document, such as registration, charter or brand ownership evidence.

Organization approval and payment status must remain separately visible.

### 4.4 Language requirements

The long-term objective is worldwide multilingual use. The source explicitly names Bulgarian, English, traditional and simplified Chinese, German and Spanish. It proposes i18next or Phrase for interface localization and multilingual records for names and biographies.

Search must account for aliases and different transcriptions. The source’s example JSON is illustrative, includes comments and inconsistent name spellings, and must not be copied directly into production data. Generation numbers, Chinese transliterations and biographical assertions require evidence or owner confirmation.

## 5. Lineage model and verification

### 5.1 A network of teaching relationships

One person may have multiple teachers in the same or different lineages, either sequentially or simultaneously. Each relationship has its own status and training period. Ending training does not erase the historical relationship.

The source uses `Person` nodes and `STUDENT_OF` relationships, with properties such as:

- Approval status.
- Active or historical relationship type.
- Start and end year, with an ongoing option.
- Primary or display preference.
- Verifier and teacher confirmation.

The early “one primary teacher” design is superseded by multiple simultaneous active teachers. A display preference must not prevent truthful recording of parallel training.

### 5.2 Living teacher approval

1. A student selects a teacher and submits a relationship request.
2. The teacher receives a dashboard notification.
3. The teacher reviews the claimant and training information.
4. Approval creates a verified relationship; rejection leaves it unverified and offers a route to correct details or resubmit.
5. Both participants receive appropriate status updates.

Each teacher approves their own relationship. One approval does not automatically verify a second teacher or every ancestor in a lineage.

### 5.3 Missing or historical teachers

- A practitioner can record the name of a teacher who has not joined and invite that teacher to claim or create a profile.
- Historical, deceased or unavailable teachers require evidence review by the authenticity committee.
- Evidence examples include training photographs, certificates, signed documents and testimony from recognized contemporaries.
- Community members can raise evidence-based challenges.
- Historical master profiles are platform-stewarded records; no single living claimant receives exclusive control merely by claiming to be a successor.

The source also proposes manually created, unclaimed profiles for students who do not use the application. Claiming, consent and guardian handling for these records remain implementation decisions; an unclaimed record must not be presented as the person’s authenticated account.

### 5.4 Verification states

| Source state | Meaning | Source presentation |
| --- | --- | --- |
| Unconfirmed | No teacher approval or accepted evidence | Red badge or gray dotted connection |
| Under review | Evidence submitted for committee review | Yellow badge |
| Verified | Teacher or committee approved the relevant claim | Green badge and solid connection |
| In arbitration | A claim is under formal dispute | Gray state and altered map presentation |

The source disagrees about whether pending relationships are publicly dotted or private until approval. This remains an explicit decision in Section 23.

## 6. Interactive lineage explorer

- Pan, zoom, search and filter the global network.
- Search by name, alias, country and lineage.
- Navigate teachers, students, ancestors and descendants, including deeper generation paths.
- Open a person’s profile from a node.
- Show relationship periods and verification status.
- Show the main lineage prominently; reveal historical relationships through selection or focus.
- Support converging branches for two teachers within one lineage.
- Support a curved secondary connection for teachers in different lineages, using cyan or blue as a source design proposal.
- Highlight all relevant ancestor paths when a person with multiple teachers is selected.
- Preserve one person’s identity rather than making duplicate people for each branch.

The source proposes choosing the longer training relationship as the default display placement and hiding or fading historical links until hover. These are presentation proposals. Mobile selection and keyboard equivalents are planning additions that must accompany any hover interaction.

## 7. World school map

### 7.1 Discovery and school cards

Provide geographic radius and lineage filters. The source example is “schools within 50 km belonging to the Wong Shun Leung lineage.” School cards show instructor, teaching lineage, photographs, schedule, fees, contacts and a trial lesson action. The map links directly to the instructor’s lineage profile.

Professional Sifus receive eligible school pins; federations receive a view of their school network and a heatmap for geographic coverage. A federation’s heatmap is distinct from independently paid school pins.

### 7.2 Private training locations

Professional Sifus can choose to hide the exact address and show only their city. The source proposes positioning the public pin at the city center and labelling the school as a private club available by invitation. Exact coordinates must also be withheld from public data responses, not just hidden visually.

### 7.3 School activity checks

The later detailed source rule is:

1. After 90 days without activity, mark the school as awaiting activity confirmation.
2. Send an email and optional SMS or notification requesting a response within approximately 14 days.
3. On day 105, hide the school pin if there is still no activity.
4. Restore the pin after activity resumes, subject to its other eligibility conditions.

An earlier proposal used day 120; day 105 is the later explicit version. The source mentions free Sifus in the activity check even though they have no public pin. Their activity may be recorded, but login must not unlock a paid map entitlement. Whether login alone is sufficient proof that a school still operates remains open.

## 8. Digital Kung Fu passport

The full passport is a chronological record of a practitioner’s training:

- Current rank and issuing organization.
- Experience derived from the available training date precision.
- Teacher-approved forms and skills, including in-progress status.
- Examination date, awarded rank and examiner linked to their profile.
- Scanned certificate or diploma, with private or public visibility.
- Seminar and camp attendance history.
- Separate training periods and accomplishments under each active or former teacher.

The source suggests years and months of experience even when only a start year is collected. Date precision must be resolved before displaying more precise durations than the data supports.

## 9. Federation administration and bulk import

Federations can administer authorized parts of their organization, issue internal certificates, support examination records, import members and analyze organization growth by country and city.

### 9.1 Source import template

| Column | Type | Meaning |
| --- | --- | --- |
| `First_Name` | Text | Student first name |
| `Last_Name` | Text | Student last name |
| `Email` | Email | Invitation and account activation destination |
| `Chinese_Name` | Text, optional | Kung Fu name |
| `Start_Year` | Integer | Year training began |
| `Current_Rank` | Text | Rank in the organization |
| `Sifu_Database_ID` | Identifier | Existing direct teacher record |
| `School_City` | Text | Training city |

The source proposes creating basic student records, linking them to the named Sifu and sending activation invitations. Implementation needs an import preview, duplicate handling, row-level errors, authorization checks, consent handling and a distinction between imported claims and verified relationships. Those are planning additions rather than source guarantees.

### 9.2 Federation approval

The source proposes payment followed by technical access to import tools while public organization verification remains pending. The board then reviews the organization before activating its official public map presence. A preparation decision must establish what a pending organization can do, when it can be charged, and what happens if verification is declined.

## 10. Subscriptions and federation trials

### 10.1 Payments and cancellation

Source requirements include recurring subscriptions, upgrading, cancellation from the dashboard, and retention of paid benefits until the end of the paid period. After expiry, data and training history remain stored while paid features become unavailable.

The desired payment options include Visa, Mastercard, PayPal, Revolut, Apple Pay, Google Pay, ePay.bg and European bank methods such as SEPA. The source mentions iDEAL and Sofort as examples. Availability and recurring-payment support must be checked against the actual merchant country, currencies, account and integration before any method is promised.

The proposed integration is Stripe Checkout, with a separate PayPal subscription integration if needed. Current Stripe documentation also describes PayPal support, including recurring payments subject to approval in some cases; the source’s blanket assumption that PayPal requires a separate integration should not be treated as final. See [Stripe PayPal documentation](https://docs.stripe.com/payments/paypal) and [payment method support](https://docs.stripe.com/payments/payment-methods/payment-method-support).

### 10.2 Complimentary federation access

- Offer selected major organizations a six- or twelve-month complimentary Tier 4 period; the later campaign uses twelve months.
- Do not require a card at the start of the complimentary period under the source proposal.
- Send reminders 14 and 7 days before expiry.
- Offer monthly or annual continuation with clear recurring billing information.
- Preserve records when a trial expires without payment; restrict paid administrative features.
- Source dates such as 25 September 2026 are examples, not actual trial deadlines.

The later annual price example is $990, while an earlier proposal was $799. Neither is approved.

### 10.3 Independent downstream subscriptions

When a federation stops paying:

- Keep historical lineage relationships intact.
- Mark the organization’s paid administration as inactive without describing its history as false.
- Remove the organization heatmap or paid branding as applicable.
- Preserve independently paid Tier 3 school pins, student approvals and other entitlements.
- Preserve independently paid Tier 2 passports and other entitlements.
- Do not transfer the federation’s financial status to unrelated account subscriptions.

The source also proposes allowing a Tier 3 school to become administratively independent after more than 90 days of federation non-payment. Historical teacher relationships remain intact, and renewed federation payment does not automatically restore authority over a school that has separated. The governance and membership rules need confirmation.

### 10.4 Billing implementation issues to resolve

The source lists webhook examples for successful payments, failed payments and subscription deletion, but its downgrade timing is inconsistent. Implementation must use the actual subscription lifecycle, provider configuration and paid-through date rather than treating a single failed invoice as immediate cancellation. The source’s fixed “three retries” is an assumption to validate.

Downgrade destinations need an explicit rule now that a Free Sifu plan exists. Existing approved students and history must not disappear because a former paid Sifu exceeds the free allowance. Over-quota media should have a documented retention and visibility policy rather than silent deletion.

## 11. Events and marketplace

### 11.1 World calendar

- Publish seminars, camps, examination sessions and other approved community events.
- Include organizer, instructor, date, time, location, description, poster and event link.
- Apply Tier 3’s two-event monthly allowance and the Tier 4 policy.
- Allow general viewing and premium student notifications.
- Support federation announcements to its community.
- Record attendance in passports where appropriate.
- Feed approved events into social announcements and weekly digests.

The source does not define event ticketing, refunds, attendance verification, time zones or month-boundary quota rules. These need decisions before implementation.

### 11.2 Products and selling

The proposed marketplace covers training uniforms, equipment, wooden dummies, training weapons, books, audio recordings and related materials. Sifus can display their own or recommended products in their profiles. Federations can maintain a global catalog, with relevant products shown in affiliated school profiles.

Two source monetization alternatives remain open:

| Model | Source proposal |
| --- | --- |
| Listing subscription | Approximately $10 per month in addition to Tier 3 for up to 20 listings |
| Sales commission | Free listing with approximately 5–8% of sales paid to the platform |

The final tier matrix appears to include 20 listings in Tier 3, so an additional seller fee must be explicitly decided. Stripe Connect is proposed for routing seller proceeds and platform commission. Fulfillment, seller onboarding, returns, taxes, allowed product categories and country restrictions remain separate implementation and operating requirements.

## 12. Posters, certificates and publishing

### 12.1 Personal and organizational lineage products

- Generate a personal, school or federation lineage visualization from the recorded network.
- Offer a high-resolution PDF and a premium physical product.
- Include names, titles, lineage and relevant approved signs or signatures where permission exists.
- Evaluate verification across the relationships represented, including living ancestors.
- Include a unique serial number and a QR link to a platform verification record.
- Support public serial-number lookup and current status inspection.
- Physical source proposals include premium paper, mailing tube, branded seal, tamper-evident hologram and embossed stamp.

The source calls the QR code “cryptographic” and describes posters as impossible to forge. These are intended security goals, not achieved properties. A QR image alone is not a security mechanism. The certificate design must identify the issued record, the depicted lineage, its evidence and current validity without claiming to establish ultimate historical truth.

Source prices: $29 for a digital certificate/poster package; $69–$99 for a physical package; an assumed approximately $20 print-and-delivery cost. These are unvalidated commercial examples.

### 12.2 Catalog types

- **Country almanac:** verified schools and practitioners in a chosen country, with biographies, photographs, schedules and lineages.
- **Lineage monograph:** descendants of a selected historical teacher, organized by generation and geography.
- **Federation edition:** a branded publication for an organization, potentially under a revenue-sharing agreement.

Generate print-ready PDFs from structured, approved records and publication consent. The source proposes country or lineage filters, alphabetical and generation ordering, paid full-page school placements of approximately $50, and direct sales or crowdfunding.

### 12.3 Country almanac structure

1. Cover with publication year and WingChunRoots identity.
2. Founder’s introduction and local historical overview.
3. National lineage diagram, potentially a two-page spread.
4. Chapters by historical branch, then city and school.
5. Sifu portrait, school photograph, biography, forms, training history and verified lineage.
6. Eligible consenting student names.
7. School contacts and QR link to current online information.
8. Alphabetical instructor index and geographic index.

## 13. Social distribution and recognition

### 13.1 Intended channels and accounts

The source proposes Facebook, Instagram, TikTok, YouTube Shorts, X and LinkedIn. For Meta it proposes a WingChunRoots Facebook Page linked to an Instagram business account, with logo, cover, description, website and action button.

Suggested page identity: WingChunRoots / `@wingchunroots`; cover wording: “The Global Verified Wing Chun Archive & School Locator.” Domain and handle availability are unverified. Automation capabilities, permissions, review requirements, supported post types and token lifecycle must be checked before implementation.

### 13.2 Content streams

| Stream | Source selection and content |
| --- | --- |
| Master of the Day | Verified consenting instructor; portrait, name, training start, lineage and profile link |
| Story of a Lineage | Approved consenting training video, branded frame, lineage overlay and school discovery link |
| New events | Approved event triggers an announcement with poster, details and website link |
| Weekly event digest | Group upcoming seminars and events by country |
| Birthdays | Eligible consenting birthday participants, subject to privacy and age policy |

The source proposes Make.com, Buffer or Zapier between the application and social platforms. A scheduled selector sends a standardized payload containing event type, language, profile information and media links.

### 13.3 Rotation and delivery

- Use controlled rotation among eligible profiles, with proposed preference for Tiers 3 and 4.
- Track the last successful sharing time to avoid repeating the same person.
- Recheck verification, consent, age eligibility and media approval.
- Adapt text, images and video to each channel.
- After confirmed publication, send a branded congratulatory card through the dashboard and email with the published post link.

The source alternates between Sunday evening and Monday morning for the weekly digest and gives 09:00 as an example daily time. Scheduling and time zones remain configurable decisions. Random ordering alone does not implement weighted or fair rotation, and an HTTP 200 alone may not establish final publication; those details require correction during implementation.

### 13.4 Recognition and upgrades

Source positioning uses social recognition, branded “Master of the Day” cards, birthdays and FOMO to encourage upgrades. The required product mechanism is visibility of actual benefits and genuine publication outcomes. Reach figures, selection guarantees and fabricated scarcity must not be inferred from illustrative copy.

## 14. Birthdays and community greetings

- Find eligible birthdays daily from private birth information.
- Send a personal branded card by email and dashboard notification.
- Optionally show a celebratory dialog at first login that day.
- Display a daily homepage birthday area below the event section.
- Show photo and title for Tiers 2, 3, 4 and Free Sifu; the source proposes name-only listings for free students.
- Provide a “Send a greeting” action and notify the recipient.
- Optionally include authorized birthday content in social distribution.

The source example runs at 00:01. Time zone, leap-day behavior, recipient preferences, repeat prevention and whether an organization celebrates a founding anniversary instead of a person’s birthday remain to be defined. Public birthday display needs a separate control from the private age-checking data.

## 15. Succession and historical stewardship

- Tier 3 and Tier 4 may nominate a digital successor from their verified students.
- The source requires the nominee to have an active Tier 2 or Tier 3 profile.
- Send the nominee an invitation to accept the responsibility.
- Display pending, accepted and cancelled nomination states.
- Permit a succession request after death or more than 180 days of inactivity under the source proposal.
- Require board review and supporting evidence before transfer.
- Transfer authorized school or organization administration and route appropriate pending work to the successor.
- Preserve the original teacher’s historical record.

The later process requiring board approval supersedes the early suggestion of an automatic transfer. Mere inactivity is not proof of death. Memorial status and administrative delegation need separate decisions, and delegation does not make a successor the historical teacher of every student in the branch.

## 16. Moderation, arbitration and administration

### 16.1 Lineage disputes

The source proposes an evidence-based report, temporary arbitration status, private communication among the parties and administrators, additional evidence review, and a reasoned outcome. Administrative actions include clearing a flag, temporarily hiding an account, revoking an unsupported relationship and suspending a fraudulent account.

Historical master records are shared archival records. Organizational splits must preserve supported teaching history even if both branches claim leadership. The platform does not decide who is the “better” master.

An unsuccessful report should not automatically be treated as malicious. The source’s immediate status changes on accusation, permanent deletion and IP/hardware bans are proposals requiring governance review, not ready implementation rules.

### 16.2 Media moderation

- Check uploaded media before public display where appropriate.
- Provide reporting for copyright, spam, inappropriate content and misleading information.
- Send flagged items to a moderator queue.
- The source proposes temporary hiding after three reports from distinct verified users within 48 hours.
- Consider automated media review services, with AWS Rekognition and Google Cloud Vision named as candidates.

The source’s promise of one-second detection and comprehensive detection of all unsuitable content is not a specification guarantee. Martial arts training must be distinguished from prohibited content. Coordinated false reporting, appeal handling and restoration require an explicit workflow.

### 16.3 Administrator workspace

Provide queues for historical evidence, organization applications, succession requests, lineage disputes, media reports and content publication. A succession queue includes requester, master profile, evidence and approve/reject actions. Historical profiles require controlled archival editing and must not carry advertising under the source concept.

## 17. Privacy, guardians and policy requirements

### 17.1 Source consent model

The source asks for separate records for:

- Acceptance of terms and acknowledgment of privacy information.
- Declaration that submitted lineage and training information is authentic and reviewable.
- Optional inclusion in print and digital catalogs.
- Optional inclusion in social promotion.

Additional controls arise elsewhere in the source for birthdays, guardian approval and certificate visibility. Users can change publication settings and request profile editing, deletion or account deletion. The relationship between erasure requests and preservation of historical records needs an approved retention policy.

Boolean consent fields are the source example. Version, time, actor, scope and withdrawal history are planning additions needed for a reviewable implementation.

### 17.2 Source proposal for children and teenagers

The proposed product rules are:

- Under 14: a parent-managed sub-account, or a Sifu-created record with explicit guardian consent; no independent registration.
- Ages 14–17: a free account with parent/guardian email and controlled access to sensitive settings.
- Under 18: upgrades are requested through a guardian; the guardian is the payer and manages the subscription.
- A parent dashboard can manage multiple child profiles, plans, payment settings and visibility controls.
- Exact birth dates are withheld from public responses.
- The source gives an under-14 example visible only to the child’s Sifu.
- Birthday display may use an abbreviated name without age or birth year when authorized.
- Social distribution defaults to excluding minors; some passages propose a guardian-consent exception, while the final summary excludes minors altogether.

These age thresholds are source proposals, not a verified global legal standard. European Commission guidance explains that the GDPR parental-consent threshold for consent-based online services varies between 13 and 16 across Member States. This does not by itself settle contractual capacity, payment eligibility or all child-data requirements. Country-specific policy and legal review are needed before enrolling minors. See [European Commission guidance on children’s data](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data/are-there-any-specific-safeguards-data-about-children_en).

### 17.3 Policy subjects retained from the source

Terms and privacy documents must address service scope, recurring billing, cancellation, trial conversion, refunds, personalized orders, copyright and hosting permissions, public versus private data, optional publication, moderation, false claims, account suspension, guardians and deletion requests.

The source’s blanket “all payments are final and non-refundable” wording is retained as a draft proposal only. EU consumer requirements distinguish services, digital content, personalized goods and the conditions for withdrawal exceptions. A qualified reviewer must approve the actual policy and checkout disclosures. See [Your Europe guidance on distance selling](https://europa.eu/youreurope/business/selling-in-eu/selling-goods-services/ecommerce-distance-selling/index_en.htm).

## 18. Notifications and content inventory

| Trigger or page | Required content and action |
| --- | --- |
| Student relationship request | Student, teacher, training start and link to the review queue |
| Relationship approved | Identify the approved teacher relationship; link to profile and passport |
| Relationship rejected | Neutral explanation, correction or resubmission path; no unsupported accusation |
| Pending request digest | Source proposes a weekly teacher email in addition to dashboard notices |
| Tier 3 activated | Actual unlocked features, profile completion steps and school setup link |
| Photo or student quota reached | Current allowance, relevant paid benefits, price, upgrade and cancel actions |
| Federation trial ending | Expiry date, plan choices and continuation link at 14 and 7 days |
| School activity reminder | School and city, response deadline and activity confirmation action |
| Successor nomination | Nominator, responsibility, accept and decline actions |
| Social feature published | Congratulatory card with the actual published post link |
| Birthday | Personal greeting; public placement only if authorized and actually shown |
| Guardian upgrade request | Child, Sifu, plan, recurring price, approval and payment review link |
| Import invitation | Organization, reason for invitation and secure account claiming action |
| FAQ | Missing teacher, deceased teacher evidence, unauthorized claims, poster verification, cancellation and retained history |

Source delivery candidates are SendGrid, Postmark and Amazon SES. Email deliverability must be measured; choosing a provider cannot guarantee that every message avoids spam. Push, dashboard and optional SMS channels need explicit recipient preferences.

## 19. Visual and interaction direction

### 19.1 Brand

Working name: **WingChunRoots**, with **WCRoots** as a short form. Earlier naming options were VingTsunTree and SiFuRegistry.

Logo proposal: a circular tree whose branches end in connected digital nodes, with roots influenced by Chinese calligraphy. The source aims to combine heritage, lineage and a contemporary interface.

### 19.2 Consolidated palette

| Purpose | Source color |
| --- | --- |
| Main dark background | `#121214` |
| Main text | `#EAEAEA` |
| Brand and primary action accent | `#D32F2F` |
| Verified state and active map pins | `#00E676` |
| Supporting surfaces | `#2A2A2E` |
| Print background | `#FDFBF7` |

Earlier options `#1A1A1A` and `#00A86B` are superseded by the later style guide. Some examples show red active pins; the later guide assigns green to verified active pins. Status must also be conveyed through text and shape.

Source typography candidates: Cinzel and Noto Serif TC for headings, Inter or Roboto for body text. Final font selection was explicitly deferred during the discussion and later candidates are not a confirmed decision. Check Latin, Cyrillic and Chinese coverage.

Source interaction details include 8–12 px rounded corners, translucent map overlays with 10 px blur, 2 px verified relationship lines and subtle hover emphasis. Print artifacts use a light paper-like background, black text and a red seal motif.

### 19.3 Principal screens

- Homepage with mission, map and registration actions, explanation of verification, three-step onboarding, poster preview, authorized partner logos, events, birthday area, help and policy links.
- Searchable global lineage explorer.
- World map and school detail.
- Person profile with cover, avatar, title, verified relationships, training history, certificates and media.
- Student passport.
- Sifu dashboard with requests/tree, school/map and multilingual profile sections.
- Federation dashboard with imports, organization details, school network and analytics.
- Teacher relationship editor supporting parallel current and historical teachers.
- Successor nomination and review screens.
- Parent dashboard.
- Administrator evidence, moderation and dispute queues.
- Pricing, checkout, billing management and trial continuation screens.
- Marketplace, event calendar, certificate lookup and publishing workflows as their phases arrive.

The source suggests a slow-motion training video behind the homepage hero and an interactive 3D poster preview. These are optional presentation ideas, not prerequisites for core functionality.

## 20. Technology and operations described in the source

### 20.1 Proposed stack

| Component | Source proposal or alternatives |
| --- | --- |
| Web application | Responsive Next.js / React application with Node.js; earlier React or Vue options |
| Lineage storage | Neo4j; Amazon Neptune mentioned as an early alternative |
| Accounts and transactions | PostgreSQL |
| Graph rendering | D3.js, GoJS or Cytoscape.js |
| Localization | i18next or Phrase |
| Map | Mapbox or Google Maps |
| Billing | Stripe Checkout; PayPal if a separate integration is necessary |
| Marketplace payments | Stripe Connect |
| Social integration | Make.com, Buffer or Zapier |
| Transactional email | SendGrid, Postmark or Amazon SES |
| Media review | AWS Rekognition or Google Cloud Vision as candidates |
| Error monitoring | Sentry as an example |
| Backup storage | Isolated Amazon S3 or Google Cloud Storage |

These are source candidates, not selected vendors or installed dependencies. The early source also suggests a shared spreadsheet or Bubble prototype to validate interest. Final architecture and hosting depend on the execution plan and any existing developer work.

### 20.2 Security and recovery

- Hash passwords; the source names bcrypt with a strong work factor.
- Require two-factor authentication for platform administrators.
- Create encrypted daily backups of both lineage and relational data, with 03:00 as the source schedule.
- Store backups separately from the application server and retain 30 days of history.
- The source calls for a 3-2-1 backup approach; its example alone does not demonstrate all three copies and two media types.
- Test the application in a restricted staging environment using test payments.
- Capture errors and resolve defects before launch.

Restore drills, cross-database consistency, media backups, access control tests, secret management, abuse limits and recovery targets are execution-plan additions required to turn these intentions into verifiable operations.

## 21. Business, outreach and launch assets

### 21.1 Source acquisition strategy

Start with a Bulgarian pilot around the founder’s school, then expand to major international branches. Offer selected federations complimentary access, invite their teachers and students, and demonstrate the archive, map and administrative benefits.

The source proposes contacting approximately 20 organizations or lineage representatives, initially considering EWTO, VTAA and IWTA. Outreach concepts include a respectful personalized invitation and a short demonstration. No invitation has been sent and no partner has agreed to participate.

### 21.2 Candidate list retained from the discussion

These are research leads from the source, not verified current leaders, affiliations, endorsements or contact records:

1. Ip Chun / Ip Ching legacy and VTAA.
2. Leung Ting / IWTA.
3. Keith Kernspecht / EWTO legacy or organization.
4. Donald Mak / IWTO.
5. Philipp Bayer / Ving Tsun Kung Fu Association Europe.
6. David Peterson.
7. William Cheung / World Wing Chun Kung Fu Association.
8. Samuel Kwok and his association.
9. Duncan Leung / Applied Wing Chun.
10. Augustine Fong and his federation.
11. Robert Chu / Chu Sau Lei Wing Chun.
12. Sergio Iadarola / IWKA, with Alex Kozlowski also named in the source entry.
13. Yuen Kay-san lineage representatives.
14. Lo Kin Keung / Gu Lao or Kulo lineage.
15. Pan Nam lineage representatives.
16. Nam Wah Wing Chun representatives.
17. Cho Hung Choy / Cho family lineage.
18. Sifu Stefan Kunev and the proposed pilot academy.
19. Bozhidar Stanchev or another relevant Bulgarian pioneer.
20. Ivan Radulov / Milen Petrov as source suggestions for Bulgarian coverage.

Check names, roles, living/deceased status, organizations, official contacts and the legitimacy of any implied association before using this list. Include branches beyond Ip Man to support the source’s neutrality objective.

### 21.3 Domains and social identity

Domain candidates in the source: `WCRoots.com`, `WingChunRoots.com`, `TheWingChunRoots.com`, `GoWingChunRoots.com`, `WingChunRegistry.com`, `VingTsunRegistry.com`, `SifuRegistry.com`, `WingChunTree.com`, `WingChunLineage.com` and `WingChunRoots.net`. The source proposes one main domain and one or two redirects, with Cloudflare, Name.com and Superhosting.bg mentioned as registration options.

Availability, ownership and acquisition price have not been verified. The source’s example website URLs and support address are placeholders, not established project assets.

### 21.4 Launch content

Retain these deliverables for the growth phase:

- Founder invitation to federation leaders describing the mission, complimentary trial, authorized branch administration and a brief demo.
- Bulgarian and international announcement posts, adapted to actual launch readiness.
- Two proposed advertising messages: protection of teaching history and school discovery.
- A proposed $5–$10 daily advertising test, followed by retargeting where appropriate and authorized.
- An early-access or beta interest form.
- A launch video of approximately 90–120 seconds, with Bulgarian speech and English subtitles or separate takes.

Source video sequence: wooden-dummy training and heritage introduction; the problem of fragmented or misleading records; introduction of the lineage explorer and map; passport, poster and events; registration call to action. Suggested production uses a training hall, dark lighting, close-up movement, a phone/tablet demonstration and restrained music with traditional percussion. Timing examples run approximately 0:00–1:50.

Do not publish claims such as “the world’s first,” guaranteed authenticity, millions of views, successful completed beta testing or named partnerships without evidence. Specific audience targeting options and social platform capabilities in the source require fresh validation.

## 22. Source financial assumptions and beta plan

### 22.1 Illustrative development budget

| Component | Source duration | Source cost estimate |
| --- | --- | --- |
| Graph data architecture | 2 weeks | $1,200–$1,800 |
| Interface and map | 4 weeks | $2,500–$3,500 |
| Payments and PDF generation | 2 weeks | $1,000–$1,500 |
| Testing, security and deployment | 1 week | $500–$800 |
| Source total | Approximately 2 months | $5,200–$7,600 |

The line-item durations total nine weeks if sequential. The source’s approximate two-month total would require overlap or adjustment. These estimates predate much of the expanded scope and are not a delivery quote for this specification. The source discusses hiring two freelancers or a small agency through Upwork/Freelancer; later it states a programmer is already engaged. Existing code and responsibilities must therefore be checked before creating a parallel implementation.

### 22.2 Illustrative monthly scenario

| Item | Source assumption | Monthly amount |
| --- | --- | --- |
| Hosting and graph database | Example operating cost | -$150 |
| Software maintenance | Example retainer | -$400 |
| Marketing | Example spend | -$250 |
| Tier 3 subscriptions | 100 × $19 | $1,900 |
| Tier 2 subscriptions | 300 × $4 | $1,200 |
| Poster contribution | 20 × $50 assumed contribution | $1,000 |
| Combined inflow/contribution less listed costs | Source example | $3,300 |

This is a source scenario framed around 2,000 users and a 12–18 month horizon, not a validated forecast. It mixes subscription revenue with assumed product contribution and omits costs such as payment fees, taxes, moderation, support, production exceptions and owner labor. The source’s approximately 45-Sifu break-even and “100% profit” digital product statements are not reliable business conclusions without a complete cost model.

### 22.3 Source closed beta proposal

- **Week 1:** restricted staging, test payments and error monitoring.
- **Week 2:** founder registration, profile and media, test Tier 3 upgrade, school pin and welcome notification.
- **Week 3:** five to ten students register and request lineage links; test both approval and rejection; at least two test premium upgrades.
- Gather feedback on finding teachers, mobile media loading and lineage exploration.
- Fix identified defects before public launch.

This is an operational beta outline, not the complete security, recovery or regression test plan. No beta has yet been run in this workspace.

## 23. Conflicts and decisions for preparation

| ID | Topic | Source issue | Proposed treatment for approval |
| --- | --- | --- | --- |
| D01 | First release | The discussion repeatedly expands the MVP | Phase the full scope as specified in the execution plan |
| D02 | Existing developer work | A programmer is mentioned, but no application files are present here | Locate existing work and confirm who owns implementation before scaffolding |
| D03 | Pending lineage visibility | Public dotted lines conflict with private pending requests | Keep pending claims private to involved users and authorized reviewers by default |
| D04 | Trust and payment | Some passages imply payment confers authenticity | Separate verification, subscription and administrative authority |
| D05 | Multiple teachers | Early single-primary model conflicts with later parallel active teachers | Preserve all supported active relationships; display preference is independent |
| D06 | Free Sifu quota | “Verification only” evolves into five student approvals | Use the later five-approval allowance; preserve existing history after downgrade |
| D07 | Free media quotas | Early 0/0 conflicts with later one and two photos | Use the later one-photo student and two-photo Sifu allowances |
| D08 | Downgrade | Immediate downgrade conflicts with end-of-period access; new free Sifu plan changes fallback | Respect paid-through dates; define student, Sifu and federation fallback separately |
| D09 | Prices | Ranges and annual proposals differ | Treat $4/$19/$99 monthly and $990 annual federation as working proposals only |
| D10 | Minors | Fixed age bands and social exceptions conflict with final exclusion | Validate jurisdiction rules; keep minors out of public promotion until policy approval |
| D11 | Succession | Automatic inactivity transfer conflicts with board review | Board approval required; do not infer death from inactivity |
| D12 | Federation control | Billing, history and authority are sometimes conflated | Model organization membership and authority separately from teaching history |
| D13 | Evidence and gallery | Free verification needs documents despite media restrictions | Define protected evidence storage separately from public gallery quotas |
| D14 | Marketplace fees | Included listings conflict with an extra $10 seller fee | Decide listing-only versus transactional marketplace and one explicit fee model |
| D15 | Social integrations | Broad API and token assumptions are unverified | Validate each provider; confirm actual publication before celebration cards |
| D16 | Birthdays | Public display and age rules need separate consent | Private DOB; independent birthday preference and guardian restrictions |
| D17 | Map freshness | Day 120 versus day 105; login mistaken for school confirmation | Later 90/105 timing, with explicit operating-status confirmation proposed |
| D18 | School restoration | Login might restore ineligible pins | Restore only if verification, subscription, moderation and privacy allow it |
| D19 | Disputes | A report is sometimes treated as proof; permanent deletion proposed | Review evidence, preserve an audit record and provide a review/appeal route |
| D20 | Person examples | Names, dates, lineages and ranks are partly invented examples | Obtain owner-approved records; use clearly fictional fixtures meanwhile |
| D21 | Certificates | “Unforgeable” and “cryptographic QR” are unsupported guarantees | Define issued snapshots, identifiers, status lookup and revocation behavior |
| D22 | Historical roots | A single generation number assumes one uncontested origin | Qualify by root and source; allow unknown or disputed historical claims |
| D23 | Policy text | Blanket refunds and universal age rules are not validated | Obtain jurisdiction-specific legal review before public use |
| D24 | Performance and recovery | No measurable load, availability or recovery targets | Set acceptance targets during technical preparation |
| D25 | Unlimited resources | No storage, duration or fair-use terms | Establish documented quotas and operating costs |
| D26 | Publishing rights | Permission and snapshot rules are incomplete | Track rights, publication consent, edition snapshots and withdrawal handling |

These proposed treatments are planning recommendations. Recording them here does not represent the user’s approval.

## 24. Coverage map

All 14 source tables were reviewed. Tables 1–4 cover finances, development estimates, marketplace models and early entitlements; tables 5–9 contain video dialogue; table 10 covers succession review; table 11 covers proposed payment methods; table 12 is the import template; tables 13–14 are the revised five-plan matrices.

| Source subject | Consolidated section |
| --- | --- |
| Global mission, profiles and languages | 2–4 |
| Approval, historical evidence and parallel teachers | 5–6 |
| School discovery, private addresses and stale listings | 7 |
| Passport, grades and examinations | 8 |
| Federation application, import and authority | 9–10 |
| Billing, trials and independent downstream subscriptions | 10 |
| Events, products and marketplace options | 11 |
| Posters, authenticity lookup and catalogs | 12 |
| Channel distribution, rotation and feature cards | 13 |
| Birthdays and greeting interaction | 14 |
| Digital successors and memorial records | 15 |
| Disputes, archival stewardship and media moderation | 16 |
| Consent, policies and guardian controls | 17 |
| Emails, upgrade copy and FAQ subjects | 18 |
| Branding, profile layouts and home page | 19 |
| Source architecture, security and backups | 20 |
| Outreach candidates, domains, advertising and video | 21 |
| Cost examples and beta process | 22 |
| Conflicts and planning clarifications | 23 |

The separate [execution plan](WingChunRoots_Execution_Plan.en.md) defines recommended delivery phases, agent responsibilities, skills and the preparation boundary.
