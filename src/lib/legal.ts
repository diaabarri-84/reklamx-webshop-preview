// The shop's legal pages.
//
// WHAT THIS IS AND IS NOT
// A working draft written from what this codebase actually does — the fields the
// checkout collects, the keys it stores, the processors it sends data to — rather
// than a template. It still has to be reviewed by the shop owner, who alone knows
// the real answers about retention, returns and delivery, and it is not legal
// advice. Anything the owner must fill in is marked [ ... ] and shows as an
// obvious gap on the page, because a plausible-looking wrong statement in a
// privacy policy is worse than a visible blank.
//
// The seller's identity comes from site settings, not from here, so it is stated
// in one place and cannot drift between the invoice and the policy.
//
// GROUNDING (verified against the source, 2026-08-14):
//   Collected at checkout: first/last name, company, org/VAT number, email,
//     billing email, phone, street, postcode, city, country, separate delivery
//     address, order contents, uploaded artwork, free-text comments.
//   Accounts: email + password (scrypt hash, MySQL). No Google sign-in since
//     the move off Firebase (2026-10-15). Loyalty points, order history.
//   Contact form: name, email, message (contact_inquiries).
//   Browser storage: reklamx_cart, reklamx_checkout_form (the half-typed
//     checkout — name, company, org/VAT number, both e-mails, phone, full
//     address, comments; written on every keystroke, and until 2026-09-13
//     deleted ONLY after a confirmed payment, so an abandoned checkout left
//     all of it in that browser for ever, including on a shared machine.
//     It now expires after 24 hours — see src/lib/checkoutDraft.ts),
//     reklamx_pending_order, reklamx_language, reklamx_currency,
//     reklamx_include_vat, reklamx_exchange_rates, reklamx_site_settings,
//     and, for the tab only (sessionStorage), reklamx_pod_attempt and
//     reklamx_ordered_lines (ids, no personal data; 2026-10-11). The online
//     designer keeps its drafts in IndexedDB on the device — texts and
//     pictures the customer put in — and signing out deletes them,
//     keeping only the owner's template drafts (2026-10-11),
//     plus the sign-in session and the visitor's answer to the consent
//     banner. The shop's own code still sets no cookies (there is no
//     document.cookie anywhere), but Google does: the Maps iframe on the
//     contact page sets Google cookies the moment that page opens, and
//     Analytics / Ads set theirs once the visitor has accepted measurement.
//     Neither Analytics nor Ads is loaded before that acceptance, and neither
//     is loaded at all while the measurement ids are unset.
//   Processors: HostX365 (server, MySQL database, files and mail; Hetzner,
//     Helsinki, EU — since 2026-10-15, before that Google Firebase), the chat assistant's AI
//     provider — Google unless the owner chose OpenAI, Anthropic or DeepSeek in
//     the dashboard; the policy names the one in use (fillAiProvider) — and
//     Mollie (payments).
//
// The keys the shop sets itself are strictly necessary for a service the visitor
// asked for, and for those Swedish law (lagen om elektronisk kommunikation,
// implementing the ePrivacy directive) requires that visitors be INFORMED, not
// that they consent. Analytics and advertising are the other kind: they need
// opt-in consent, which is why the banner asks and why nothing loads until the
// visitor accepts. Keep this comment, the banner and the text below in step with
// what the site actually loads — a policy is only worth having while it is true.

import type { Language } from './translations';

export type LegalSection = { heading: string; body: string[] };
export type LegalDocument = { title: string; updated: string; intro: string; sections: LegalSection[] };
export type LegalKind = 'privacy' | 'terms' | 'cookies';

// MOVED WHENEVER THE TEXT MOVES. A policy that changed on a date it does not
// admit to is worse than one that never changed: the date is the only way a
// reader can tell whether what they agreed to is what is on the page.
// 2026-09-13: the half-typed checkout disclosed and given a 24-hour life, and
// the basket summary of 5.7c added with its basis and its retention.
// 2026-10-05: the AI assistant's provider is the one in use (he may choose
// DeepSeek), and a DeepSeek chat is said to be processed in China.
// 2026-10-15: off Google — the database, sign-in, files and e-mail now run on
// our own host (HostX365, Helsinki), there is no Google sign-in, and the
// contact form is disclosed with its retention.
const UPDATED = '2026-10-15';

/** Filled from site settings at render time. */
export const SELLER_PLACEHOLDER = '[company details not yet set]';

/**
 * WHO RECEIVES WHAT A CUSTOMER TYPES INTO THE CHAT — the company actually in use
 * (round 16, item 8: the owner can switch the assistant to DeepSeek). The text
 * carries {AI_PROVIDER} and {AI_TRANSFER}; LegalPage fills them when it renders —
 * in his own text as well — from settings/legalPages.aiProcessor, which the
 * server writes when he saves an AI key.
 */
export interface AiProcessor {
  provider: string | null;
  /** DeepSeek only: he confirmed an agreement covering the transfer out of the EU. */
  transferConfirmed?: boolean;
}
const AI_PROVIDER_IN: Record<Language, Record<string, string>> = {
  en: { google: 'Google', openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek (China)', none: 'Our AI provider' },
  sv: { google: 'Google', openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek (Kina)', none: 'Vår AI-leverantör' },
  da: { google: 'Google', openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek (Kina)', none: 'Vores AI-leverandør' },
  no: { google: 'Google', openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek (Kina)', none: 'Vår AI-leverandør' },
};
// THE SAFEGUARD IS CLAIMED ONLY WHEN HE HAS CONFIRMED IT. Until then the policy
// names the transfer and shows the missing agreement as a [gap] — the page
// renders a bracket as an amber "not finished" mark, as it does for missing
// company details — rather than letting the sentence before it say that
// standard contractual clauses cover a transfer nobody has signed for.
const DEEPSEEK_TRANSFER: Record<Language, { confirmed: string; open: string }> = {
  en: {
    confirmed: ' DeepSeek, which runs the AI assistant, processes what you type into the chat in China, under our data processing agreement with DeepSeek, which includes those standard contractual clauses.',
    open: ' DeepSeek, which runs the AI assistant, processes what you type into the chat in China. [The agreement that covers this transfer is not yet confirmed]',
  },
  sv: {
    confirmed: ' DeepSeek, som driver AI-assistenten, behandlar det du skriver i chatten i Kina, enligt vårt personuppgiftsbiträdesavtal med DeepSeek, som innehåller dessa standardavtalsklausuler.',
    open: ' DeepSeek, som driver AI-assistenten, behandlar det du skriver i chatten i Kina. [Avtalet som täcker denna överföring är ännu inte bekräftat]',
  },
  da: {
    confirmed: ' DeepSeek, som driver AI-assistenten, behandler det, du skriver i chatten, i Kina i henhold til vores databehandleraftale med DeepSeek, som indeholder disse standardkontraktbestemmelser.',
    open: ' DeepSeek, som driver AI-assistenten, behandler det, du skriver i chatten, i Kina. [Aftalen, der dækker denne overførsel, er endnu ikke bekræftet]',
  },
  no: {
    confirmed: ' DeepSeek, som driver AI-assistenten, behandler det du skriver i chatten, i Kina i henhold til vår databehandleravtale med DeepSeek, som inneholder disse standardkontraktsklausulene.',
    open: ' DeepSeek, som driver AI-assistenten, behandler det du skriver i chatten, i Kina. [Avtalen som dekker denne overføringen, er ennå ikke bekreftet]',
  },
};

export function fillAiProvider(text: string, processor: AiProcessor | null | undefined, language: Language): string {
  const names = AI_PROVIDER_IN[language] ?? AI_PROVIDER_IN.en;
  const provider = processor?.provider ?? null;
  const name = (provider && names[provider]) || names.none;
  const transfer = provider === 'deepseek'
    ? (DEEPSEEK_TRANSFER[language] ?? DEEPSEEK_TRANSFER.en)[processor?.transferConfirmed ? 'confirmed' : 'open']
    : '';
  return text.split('{AI_PROVIDER}').join(name).split('{AI_TRANSFER}').join(transfer);
}

/**
 * His OWN privacy text, written before this existed, has no {AI_TRANSFER} — so
 * with DeepSeek in use it would never say where the chat goes. This section is
 * then added at the end of it.
 */
export function aiTransferSection(processor: AiProcessor | null | undefined, language: Language): LegalSection | null {
  if (processor?.provider !== 'deepseek') return null;
  const heading: Record<Language, string> = { en: 'The AI assistant', sv: 'AI-assistenten', da: 'AI-assistenten', no: 'AI-assistenten' };
  return { heading: heading[language] ?? heading.en, body: [fillAiProvider('{AI_TRANSFER}', processor, language).trim()] };
}

const en: Record<LegalKind, LegalDocument> = {
  privacy: {
    title: 'Privacy policy',
    updated: UPDATED,
    intro:
      'This policy explains what personal data we collect when you use this shop, why we need it, who else sees it and what you can ask us to do about it. It applies to everything on this website.',
    sections: [
      {
        heading: 'Who is responsible for your data',
        body: [
          'The controller is the company named at the end of this page. You can reach us at the address and email shown there with any question about your data.',
        ],
      },
      {
        heading: 'What we collect, and why',
        body: [
          'When you place an order: your name, email address, telephone number and delivery address; a billing email and a separate delivery address if you give us one; and, if you order as a business, your company name and organisation or VAT number. We need these to produce your order, deliver it, and issue an invoice that meets Swedish accounting rules. The legal basis is performance of our contract with you, and for the invoice itself our legal obligation.',
          'The files you upload for printing, together with the sizes, materials and options you chose, and any note you add to the order. We need these to print the job.',
          'If you create an account: your email address and a password, which we store only in scrambled (hashed) form and can never read. Your order history and any loyalty points are attached to that account. The legal basis is performance of our contract, or your consent where you chose to create an account.',
          'If you write to our chat assistant, the messages you send it. The legal basis is our legitimate interest in answering customer questions. Please do not put sensitive personal information in the chat.',
          'If you write to us through the contact form: your name, email address and message, so we can answer you. The legal basis is our legitimate interest in answering questions.',
          'If you are signed in and leave something in your basket without ordering, a summary of it: which products, how many, and what they came to. Not the files you uploaded, and not their names. We use it to see how often an order is not completed, so we can fix what is getting in the way. The legal basis is our legitimate interest in understanding where orders are lost. You can object at any time using the contact details above and we will delete it; it is deleted automatically after 30 days, and as soon as you place the order.',
          'If you accept measurement in the cookie banner, Google Analytics and Google Ads are told that you visited the shop and, after an order, that a purchase happened and what it was worth. If you refuse, or if we are not running those tools, nothing is collected for advertising. We do not build profiles of you ourselves and we do not sell your data.',
        ],
      },
      {
        heading: 'Who else processes your data',
        body: [
          'HostX365, our web host — the servers in Helsinki, Finland (within the EU) that run this shop, hold the database with your order, your account and your uploaded files, and send our e-mails.',
          '{AI_PROVIDER} — the AI assistant, which receives the messages you type into the chat.',
          'Google — Analytics and Ads, but only if you accept measurement in the cookie banner. Before you accept, nothing is sent to them; if you refuse, nothing is sent at all.',
          'Google — the map on our contact page, where one is set up. Opening that page loads the map from Google, which receives your IP address and sets its own cookies. That happens as the page opens, and your answer in the cookie banner does not switch it off.',
          'Mollie B.V. — payments. You enter your card or bank details on Mollie\'s own page; they never pass through this website, and we never see or store them.',
          'Our shipping partner, to deliver your order.',
          'The database, chat, payment and shipping partners act on our instructions under a data processing agreement. Google Analytics, Google Ads and Google Maps also use what reaches them for their own purposes, which is why the first two are loaded only if you accept them. Where data is transferred outside the EU/EEA it is covered by the European Commission\'s standard contractual clauses.{AI_TRANSFER}',
        ],
      },
      {
        heading: 'How long we keep it',
        body: [
          'Accounting records, including invoices and what they relate to: seven years, as required by the Swedish Bookkeeping Act (bokföringslagen).',
          'Your uploaded print files and the details of your orders: seven years, together with our accounting records — which also lets a reorder use the same files.',
          'Your account and its order history: until you ask us to close it.',
          'Chat messages: we do not keep them. Nothing of the conversation is saved on our side once the answer has been sent.',
          'Messages sent through the contact form: kept with our customer records until you ask us to delete them.',
          'A summary of a basket you left without ordering: thirty days, then deleted — and deleted as soon as you place the order.',
        ],
      },
      {
        heading: 'Your rights',
        body: [
          'You can ask us for a copy of the personal data we hold about you, to correct anything that is wrong, to delete it, to restrict or object to how we use it, and to receive it in a portable format. Where we rely on your consent you can withdraw it at any time.',
          'Some data we cannot delete on request — an invoice, for example, has to be kept for seven years by law.',
          'Write to the email address at the end of this page and we will answer within one month.',
          'If you believe we have handled your data wrongly you may complain to the Swedish Authority for Privacy Protection (Integritetsskyddsmyndigheten, imy.se).',
        ],
      },
      {
        heading: 'Security',
        body: [
          'The site is served over an encrypted connection. Order data is held on our web host\'s servers in Finland, within the EU, with access restricted to the shop\'s own staff accounts. Passwords are stored only in scrambled form. Payment details are handled entirely by Mollie and never reach us.',
        ],
      },
    ],
  },

  terms: {
    title: 'Terms and conditions',
    updated: UPDATED,
    intro:
      'These terms apply when you buy from this shop. Please read them before ordering — placing an order means you accept them.',
    sections: [
      {
        heading: 'Prices and VAT',
        body: [
          'All prices are shown in Swedish kronor. You can switch between prices excluding and including VAT using the control in the header; the amount you pay is always the total including VAT, shown at checkout before you confirm.',
          'Swedish VAT is added at the rate in force. Shipping is charged separately and is shown before you confirm.',
        ],
      },
      {
        heading: 'Placing an order',
        body: [
          'Your order is a binding offer to buy. The contract is formed when we confirm the order.',
          'We calculate the price of every order on our own server from the current product data. If a price shown to you was wrong because of a technical fault or an obvious error, we will contact you before producing the job and you may cancel free of charge.',
        ],
      },
      {
        heading: 'Your artwork',
        body: [
          'You are responsible for the files you send us: that you hold the rights to the content, and that it is correct. We print what you supply. We do not check spelling, and we do not verify that you may use an image or a logo.',
          'We will tell you if a file is unsuitable for print — too low a resolution, for instance — but the final decision to print is yours.',
          'You keep all rights to your artwork. We use it only to produce your order.',
        ],
      },
      {
        heading: 'Payment',
        body: [
          'Payment is taken online through Mollie, using the payment methods shown at checkout. Your order enters production once payment is confirmed.',
        ],
      },
      {
        heading: 'Delivery',
        body: [
          'Normal production time is three to five working days. Delivery time comes on top and is shown for each shipping option at checkout.',
          'Risk passes to you when the goods are handed to you or to a carrier you appointed.',
        ],
      },
      {
        heading: 'Right of withdrawal',
        body: [
          'Under the Swedish Distance Contracts Act (distansavtalslagen) a consumer normally has fourteen days to withdraw from a distance purchase.',
          'That right does NOT apply to goods made to your specification or clearly personalised — which covers most printed work in this shop. Once a personalised job has gone into production it cannot be cancelled or returned.',
          'It does apply to any standard, non-personalised item you buy. To use it, e-mail us at the address shown on this page within fourteen days of receiving the goods.',
        ],
      },
      {
        heading: 'Faults and complaints',
        body: [
          'If what you receive is faulty or is not what you ordered, tell us within a reasonable time and we will reprint or refund it. Please include photographs and your order number.',
          'Colour on a printed sheet is never an exact match for colour on a screen. Small variation is normal and is not a fault.',
          'Contact us as soon as you discover a fault — within two months of discovering it is always in time, and as a consumer you keep your three-year right of complaint under the Swedish Consumer Sales Act (konsumentköplagen). Returns go to the company address shown on this page.',
        ],
      },
      {
        heading: 'If we disagree',
        body: [
          'Talk to us first — most things are settled quickly. If we cannot agree, a consumer may refer the matter to the Swedish National Board for Consumer Disputes (Allmänna reklamationsnämnden, arn.se) or the EU online dispute resolution platform. Swedish law applies.',
        ],
      },
    ],
  },

  cookies: {
    title: 'Cookies and browser storage',
    updated: UPDATED,
    intro:
      'The short version: the shop keeps a few things in your browser so it can work. Measurement and advertising tools are loaded only if you accept them, and never if you refuse. The exception is the Google map on our contact page: it sets Google cookies as soon as that page opens.',
    sections: [
      {
        heading: 'What is stored, and why',
        body: [
          'Your basket — so it survives moving between pages.',
          'If you start filling in the checkout, what you have typed — so a failed payment or a closed tab does not cost you your address twice. It is kept in your browser for 24 hours and then deleted, and it is deleted as soon as an order is paid.',
          'Your chosen language and currency, and whether you want prices shown with or without VAT — so you are not asked again on every page.',
          'Current exchange rates and shop settings — held briefly so pages load faster.',
          'If you sign in, a session so you stay signed in.',
          'Your answer to the cookie banner, where you were asked one — so you are not asked again.',
          'If you accepted measurement: the cookies Google Analytics and Google Ads set to count visits and to link an order back to the ad that brought you here. If you refused, or if we are not running those tools, none of them exist.',
          'On our contact page, where a map is shown, the cookies Google Maps sets when that page opens.',
        ],
      },
      {
        heading: 'When we ask for your consent, and when we do not',
        body: [
          'Consent is required for storage that is not necessary for a service you asked for — analytics and advertising, typically. The basket, the language and currency, the VAT setting and your sign-in are necessary: without them the basket empties, the language resets and you are signed out. For those, Swedish law (lagen om elektronisk kommunikation) requires that we inform you, which is what this page does, and we do not ask you to accept them.',
          'Measurement and advertising are your choice. If we run those tools, the banner at the bottom of the page asks first: they load only after you press Accept, and never if you press Reject. The shop behaves the same either way. You can change your answer at any time by clearing the storage this site keeps in your browser.',
        ],
      },
      {
        heading: 'Clearing it',
        body: [
          'You can clear this at any time through your browser settings. Your basket and preferences will be forgotten, and so will your answer about measurement — so you will be asked again on your next visit. If you were signed in, a summary of what was in your basket may already have been recorded on our side; see the privacy policy, where it is described and where you can ask us to delete it.',
        ],
      },
    ],
  },
};

/**
 * Swedish. This is the shop's home market, so the Swedish text is the one that
 * matters most — it is written out in full rather than falling back to English.
 */
const sv: Record<LegalKind, LegalDocument> = {
  privacy: {
    title: 'Integritetspolicy',
    updated: UPDATED,
    intro:
      'Den här policyn förklarar vilka personuppgifter vi samlar in när du använder butiken, varför vi behöver dem, vilka fler som ser dem och vad du kan begära av oss. Den gäller hela webbplatsen.',
    sections: [
      {
        heading: 'Vem ansvarar för dina uppgifter',
        body: [
          'Personuppgiftsansvarig är företaget som anges längst ned på sidan. Du når oss på adressen och e-postadressen där med frågor om dina uppgifter.',
        ],
      },
      {
        heading: 'Vad vi samlar in, och varför',
        body: [
          'När du beställer: namn, e-postadress, telefonnummer och leveransadress; en fakturaadress och en separat leveransadress om du anger en; och, om du beställer som företag, företagsnamn och organisations- eller momsregistreringsnummer. Vi behöver dessa för att tillverka och leverera din order och för att utfärda en faktura som uppfyller svenska bokföringsregler. Rättslig grund är fullgörande av avtal, och för fakturan vår rättsliga förpliktelse.',
          'De filer du laddar upp för tryck, tillsammans med de mått, material och alternativ du valt, samt eventuell notering du lämnar. Vi behöver dessa för att kunna trycka jobbet.',
          'Om du skapar ett konto: din e-postadress och ett lösenord, som vi bara sparar i krypterad (hashad) form och aldrig kan läsa. Din orderhistorik och eventuella lojalitetspoäng knyts till kontot.',
          'Om du skriver till vår chattassistent, de meddelanden du skickar. Rättslig grund är vårt berättigade intresse av att besvara kundfrågor. Skriv inte känsliga personuppgifter i chatten.',
          'Om du skriver till oss via kontaktformuläret: ditt namn, din e-postadress och ditt meddelande, så att vi kan svara dig. Rättslig grund är vårt berättigade intresse av att besvara frågor.',
          'Om du är inloggad och lämnar något i varukorgen utan att beställa, en sammanfattning av den: vilka produkter, hur många och vad de gick på. Inte filerna du laddade upp och inte deras namn. Vi använder den för att se hur ofta en order inte slutförs, så att vi kan åtgärda det som står i vägen. Rättslig grund är vårt berättigade intresse av att förstå var order går förlorade. Du kan när som helst invända via kontaktuppgifterna ovan, så raderar vi den; den raderas automatiskt efter 30 dagar och så snart du lägger ordern.',
          'Godkänner du mätning i rutan om kakor får Google Analytics och Google Ads veta att du besökt butiken och, efter en order, att ett köp har skett och vad det var värt. Nekar du, eller kör vi inte de verktygen, samlas ingenting in för annonsering. Vi bygger inga egna profiler av dig och vi säljer inte dina uppgifter.',
        ],
      },
      {
        heading: 'Vilka fler behandlar dina uppgifter',
        body: [
          'HostX365, vårt webbhotell — servrarna i Helsingfors, Finland (inom EU) som driver butiken, lagrar databasen med din order, ditt konto och dina uppladdade filer, och skickar våra e-postmeddelanden.',
          '{AI_PROVIDER} — AI-assistenten, som tar emot det du skriver i chatten.',
          'Google — Analytics och Ads, men bara om du godkänner mätning i rutan om kakor. Innan du godkänner skickas ingenting dit, och nekar du skickas ingenting alls.',
          'Google — kartan på kontaktsidan, där en sådan är inlagd. När sidan öppnas hämtas kartan från Google, som får din IP-adress och sätter egna kakor. Det sker när sidan öppnas, och ditt svar i rutan om kakor stänger inte av det.',
          'Mollie B.V. — betalningar. Du anger kort- eller bankuppgifter på Mollies egen sida; de passerar aldrig den här webbplatsen och vi ser dem aldrig.',
          'Vår fraktpartner, för att leverera din order.',
          'Databas-, chatt-, betal- och fraktleverantörerna behandlar uppgifterna på våra instruktioner enligt personuppgiftsbiträdesavtal. Google Analytics, Google Ads och Google Maps använder även det som når dem för egna ändamål, och därför laddas de två första bara om du godkänner dem. Överförs uppgifter utanför EU/EES sker det med EU-kommissionens standardavtalsklausuler.{AI_TRANSFER}',
        ],
      },
      {
        heading: 'Hur länge vi sparar dem',
        body: [
          'Bokföringsunderlag, inklusive fakturor: sju år enligt bokföringslagen.',
          'Dina uppladdade tryckfiler och uppgifterna om dina ordrar: sju år, tillsammans med vår bokföring — så kan ett omtryck även använda samma filer.',
          'Ditt konto och dess orderhistorik: tills du ber oss avsluta det.',
          'Chattmeddelanden: vi sparar dem inte. Ingenting av samtalet lagras hos oss när svaret har skickats.',
          'Meddelanden via kontaktformuläret: sparas i vårt kundregister tills du ber oss radera dem.',
          'En sammanfattning av en varukorg du lämnat utan att beställa: trettio dagar, därefter raderas den — och den raderas så snart du lägger ordern.',
        ],
      },
      {
        heading: 'Dina rättigheter',
        body: [
          'Du har rätt att få ett registerutdrag, att få felaktiga uppgifter rättade, att få uppgifter raderade, att begränsa eller invända mot behandlingen och att få dina uppgifter i ett portabelt format. Har vi bett om ditt samtycke kan du när som helst återkalla det.',
          'Vissa uppgifter kan vi inte radera på begäran — en faktura måste enligt lag sparas i sju år.',
          'Skriv till e-postadressen längst ned på sidan så svarar vi inom en månad.',
          'Anser du att vi hanterat dina uppgifter felaktigt kan du klaga till Integritetsskyddsmyndigheten (imy.se).',
        ],
      },
      {
        heading: 'Säkerhet',
        body: [
          'Webbplatsen levereras över krypterad anslutning. Orderuppgifter lagras på vårt webbhotells servrar i Finland, inom EU, med åtkomst begränsad till butikens egna personalkonton. Lösenord sparas bara i krypterad form. Betaluppgifter hanteras helt av Mollie och når aldrig oss.',
        ],
      },
    ],
  },

  terms: {
    title: 'Köpvillkor',
    updated: UPDATED,
    intro:
      'Dessa villkor gäller när du handlar i butiken. Läs dem innan du beställer — genom att lägga en order accepterar du dem.',
    sections: [
      {
        heading: 'Priser och moms',
        body: [
          'Alla priser anges i svenska kronor. Du kan växla mellan priser exklusive och inklusive moms i sidhuvudet; det du betalar är alltid totalsumman inklusive moms, som visas i kassan innan du bekräftar.',
          'Svensk moms tillkommer med gällande sats. Frakt debiteras separat och visas innan du bekräftar.',
        ],
      },
      {
        heading: 'Att lägga en order',
        body: [
          'Din order är ett bindande anbud. Avtal sluts när vi bekräftar ordern.',
          'Vi beräknar priset för varje order på vår egen server utifrån aktuella produktuppgifter. Har ett pris visats fel på grund av ett tekniskt fel eller ett uppenbart misstag kontaktar vi dig innan produktion, och du kan avbeställa utan kostnad.',
        ],
      },
      {
        heading: 'Ditt original',
        body: [
          'Du ansvarar för filerna du skickar: att du har rättigheterna till innehållet och att det är korrekt. Vi trycker det du levererar. Vi korrekturläser inte och vi kontrollerar inte om du får använda en bild eller en logotyp.',
          'Vi säger till om en fil är olämplig för tryck — till exempel för låg upplösning — men beslutet att trycka är ditt.',
          'Du behåller alla rättigheter till ditt original. Vi använder det endast för att producera din order.',
        ],
      },
      {
        heading: 'Betalning',
        body: [
          'Betalning sker online via Mollie, med de betalsätt som visas i kassan. Din order går i produktion när betalningen är bekräftad.',
        ],
      },
      {
        heading: 'Leverans',
        body: [
          'Normal produktionstid är tre till fem arbetsdagar. Leveranstid tillkommer och visas per fraktalternativ i kassan.',
          'Risken övergår på dig när varan lämnas till dig eller till en transportör du anlitat.',
        ],
      },
      {
        heading: 'Ångerrätt',
        body: [
          'Enligt distansavtalslagen har en konsument normalt fjorton dagars ångerrätt vid distansköp.',
          'Ångerrätten gäller INTE varor som tillverkats enligt dina anvisningar eller som har en tydlig personlig prägel — vilket omfattar merparten av trycksakerna i butiken. När ett personligt anpassat jobb gått i produktion kan det inte avbeställas eller returneras.',
          'Den gäller däremot standardvaror utan personlig anpassning. Mejla oss på adressen längst ned på sidan inom fjorton dagar från det att du tagit emot varan.',
        ],
      },
      {
        heading: 'Fel och reklamation',
        body: [
          'Är det du fått felaktigt eller inte det du beställt — hör av dig inom skälig tid, så trycker vi om eller återbetalar. Bifoga gärna foton och ordernummer.',
          'Färg på tryck motsvarar aldrig exakt färg på en skärm. Mindre variationer är normala och utgör inte ett fel.',
          'Kontakta oss så snart du upptäcker ett fel — inom två månader från upptäckten är alltid i tid, och som konsument har du kvar din treåriga reklamationsrätt enligt konsumentköplagen. Returer skickas till företagsadressen som visas på denna sida.',
        ],
      },
      {
        heading: 'Om vi inte är överens',
        body: [
          'Prata med oss först — det mesta löser sig snabbt. Kommer vi inte överens kan en konsument vända sig till Allmänna reklamationsnämnden (arn.se) eller EU:s onlineplattform för tvistlösning. Svensk lag tillämpas.',
        ],
      },
    ],
  },

  cookies: {
    title: 'Kakor och lagring i webbläsaren',
    updated: UPDATED,
    intro:
      'Kort sagt: butiken sparar några saker i din webbläsare för att fungera. Verktyg för mätning och annonsering laddas bara om du godkänner dem, aldrig om du nekar. Undantaget är Google-kartan på kontaktsidan: den sätter Googles kakor så fort sidan öppnas.',
    sections: [
      {
        heading: 'Vad som sparas, och varför',
        body: [
          'Din varukorg — så att den finns kvar när du byter sida.',
          'Om du börjar fylla i kassan, det du har skrivit — så att en misslyckad betalning eller en stängd flik inte kostar dig adressen två gånger. Det sparas i din webbläsare i 24 timmar och raderas sedan, och det raderas så snart en order är betald.',
          'Ditt val av språk och valuta, och om priser ska visas med eller utan moms — så att du slipper välja om på varje sida.',
          'Aktuella växelkurser och butiksinställningar — sparas kort så att sidor laddar snabbare.',
          'Loggar du in sparas en session så att du förblir inloggad.',
          'Ditt svar i rutan om kakor, där du fått frågan — så att du slipper frågan igen.',
          'Har du godkänt mätning: de kakor Google Analytics och Google Ads sätter för att räkna besök och koppla en order till annonsen som ledde hit. Har du nekat, eller kör vi inte verktygen, finns ingen av dem.',
          'På kontaktsidan, där en karta visas, de kakor Google Maps sätter när sidan öppnas.',
        ],
      },
      {
        heading: 'När vi ber om ditt samtycke, och när vi inte gör det',
        body: [
          'Samtycke krävs för lagring som inte är nödvändig för en tjänst du bett om — typiskt analys och annonsering. Varukorgen, språket och valutan, momsinställningen och din inloggning är nödvändiga: utan dem töms varukorgen, språket återställs och du loggas ut. För dem kräver lagen om elektronisk kommunikation att vi informerar dig, vilket den här sidan gör, och vi ber dig inte godkänna dem.',
          'Mätning och annonsering väljer du själv. Kör vi sådana verktyg frågar rutan längst ned på sidan först: de laddas först när du tryckt Godkänn, och aldrig om du tryckt Neka. Butiken fungerar likadant oavsett vad du väljer. Du kan ändra ditt svar när som helst genom att rensa det som butiken sparat i din webbläsare.',
        ],
      },
      {
        heading: 'Rensa lagringen',
        body: [
          'Du kan rensa detta när som helst via webbläsarens inställningar. Varukorg och inställningar glöms bort, och även ditt svar om mätning — så du får frågan igen nästa gång du kommer hit. Om du var inloggad kan en sammanfattning av vad som låg i varukorgen redan ha registrerats hos oss; se integritetspolicyn, där den beskrivs och där du kan be oss radera den.',
        ],
      },
    ],
  },
};

/**
 * Danish. Translated from the Swedish text, which is the authoritative one:
 * the shop is Swedish and Swedish law applies, so Swedish statutes keep their
 * Swedish names with a short Danish gloss, exactly as the English text does.
 */
const da: Record<LegalKind, LegalDocument> = {
  privacy: {
    title: 'Privatlivspolitik',
    updated: UPDATED,
    intro:
      'Denne politik forklarer, hvilke personoplysninger vi indsamler, når du bruger butikken, hvorfor vi har brug for dem, hvem der ellers ser dem, og hvad du kan bede os om. Den gælder for hele webstedet.',
    sections: [
      {
        heading: 'Hvem der er ansvarlig for dine oplysninger',
        body: [
          'Dataansvarlig er den virksomhed, der er angivet nederst på siden. Du kan kontakte os på adressen og e-mailadressen dér med spørgsmål om dine oplysninger.',
        ],
      },
      {
        heading: 'Hvad vi indsamler, og hvorfor',
        body: [
          'Når du bestiller: navn, e-mailadresse, telefonnummer og leveringsadresse; en fakturaadresse og en separat leveringsadresse, hvis du angiver en; og, hvis du bestiller som virksomhed, virksomhedsnavn og organisations- eller momsregistreringsnummer. Vi har brug for disse for at fremstille og levere din ordre og for at udstede en faktura, der opfylder svenske bogføringsregler. Retsgrundlaget er opfyldelse af aftalen, og for fakturaen vores retlige forpligtelse.',
          'De filer, du uploader til tryk, sammen med de mål, materialer og valgmuligheder, du har valgt, samt eventuelle bemærkninger, du tilføjer. Vi har brug for disse for at kunne trykke opgaven.',
          'Hvis du opretter en konto: din e-mailadresse og en adgangskode, som vi kun gemmer i krypteret (hashet) form og aldrig kan læse. Din ordrehistorik og eventuelle loyalitetspoint knyttes til kontoen.',
          'Hvis du skriver til vores chatassistent, de beskeder du sender. Retsgrundlaget er vores legitime interesse i at besvare kundespørgsmål. Skriv ikke følsomme personoplysninger i chatten.',
          'Hvis du skriver til os via kontaktformularen: dit navn, din e-mailadresse og din besked, så vi kan svare dig. Retsgrundlaget er vores legitime interesse i at besvare spørgsmål.',
          'Hvis du er logget ind og efterlader noget i kurven uden at bestille, et sammendrag af den: hvilke produkter, hvor mange og hvad de løb op i. Ikke de filer, du uploadede, og ikke deres navne. Vi bruger det til at se, hvor ofte en ordre ikke fuldføres, så vi kan rette det, der står i vejen. Retsgrundlaget er vores legitime interesse i at forstå, hvor ordrer går tabt. Du kan til enhver tid gøre indsigelse via kontaktoplysningerne ovenfor, så sletter vi det; det slettes automatisk efter 30 dage og så snart du afgiver ordren.',
          'Accepterer du måling i cookiebanneret, får Google Analytics og Google Ads at vide, at du har besøgt butikken, og efter en ordre at der er sket et køb, og hvad det var værd. Afviser du, eller kører vi ikke de værktøjer, indsamles der intet til reklameformål. Vi laver ikke selv profiler af dig, og vi sælger ikke dine oplysninger.',
        ],
      },
      {
        heading: 'Hvem der ellers behandler dine oplysninger',
        body: [
          'HostX365, vores webhotel — serverne i Helsinki, Finland (inden for EU), som driver butikken, opbevarer databasen med din ordre, din konto og dine uploadede filer og sender vores e-mails.',
          '{AI_PROVIDER} — AI-assistenten, som modtager det, du skriver i chatten.',
          'Google — Analytics og Ads, men kun hvis du accepterer måling i cookiebanneret. Før du accepterer, sendes der intet dertil, og afviser du, sendes der intet overhovedet.',
          'Google — kortet på kontaktsiden, hvor et sådant er sat op. Når siden åbnes, hentes kortet fra Google, som modtager din IP-adresse og sætter sine egne cookies. Det sker, når siden åbnes, og dit svar i cookiebanneret slår det ikke fra.',
          'Mollie B.V. — betalinger. Du indtaster kort- eller bankoplysninger på Mollies egen side; de passerer aldrig dette websted, og vi ser dem aldrig.',
          'Vores fragtpartner, som leverer din ordre.',
          'Database-, chat-, betalings- og fragtleverandørerne behandler oplysningerne efter vores instruks i henhold til en databehandleraftale. Google Analytics, Google Ads og Google Maps bruger også det, der når frem til dem, til deres egne formål, og derfor indlæses de to første kun, hvis du accepterer dem. Overføres oplysninger til lande uden for EU/EØS, sker det med EU-Kommissionens standardkontraktbestemmelser.{AI_TRANSFER}',
        ],
      },
      {
        heading: 'Hvor længe vi gemmer dem',
        body: [
          'Regnskabsmateriale, herunder fakturaer: syv år i henhold til den svenske bogføringslov (bokföringslagen).',
          'Dine uploadede trykfiler og oplysningerne om dine ordrer: syv år sammen med vores regnskab — så et genoptryk også kan bruge de samme filer.',
          'Din konto og dens ordrehistorik: indtil du beder os om at lukke den.',
          'Chatbeskeder: vi gemmer dem ikke. Intet af samtalen gemmes hos os, når svaret er sendt.',
          'Beskeder via kontaktformularen: gemmes i vores kunderegister, indtil du beder os om at slette dem.',
          'Et sammendrag af en kurv, du har forladt uden at bestille: tredive dage, hvorefter det slettes — og det slettes, så snart du afgiver ordren.',
        ],
      },
      {
        heading: 'Dine rettigheder',
        body: [
          'Du har ret til at få indsigt i de oplysninger, vi har om dig, at få forkerte oplysninger rettet, at få oplysninger slettet, at begrænse eller gøre indsigelse mod behandlingen og at få dine oplysninger i et portabelt format. Har vi bedt om dit samtykke, kan du til enhver tid trække det tilbage.',
          'Visse oplysninger kan vi ikke slette på anmodning — en faktura skal ifølge loven gemmes i syv år.',
          'Skriv til e-mailadressen nederst på siden, så svarer vi inden for en måned.',
          'Mener du, at vi har behandlet dine oplysninger forkert, kan du klage til det svenske datatilsyn (Integritetsskyddsmyndigheten, imy.se).',
        ],
      },
      {
        heading: 'Sikkerhed',
        body: [
          'Webstedet leveres over en krypteret forbindelse. Ordreoplysninger opbevares på vores webhotels servere i Finland, inden for EU, med adgang begrænset til butikkens egne personalekonti. Adgangskoder gemmes kun i krypteret form. Betalingsoplysninger håndteres udelukkende af Mollie og når aldrig frem til os.',
        ],
      },
    ],
  },

  terms: {
    title: 'Handelsbetingelser',
    updated: UPDATED,
    intro:
      'Disse betingelser gælder, når du handler i butikken. Læs dem, før du bestiller — ved at afgive en ordre accepterer du dem.',
    sections: [
      {
        heading: 'Priser og moms',
        body: [
          'Alle priser er angivet i svenske kroner. Du kan skifte mellem priser eksklusive og inklusive moms i sidehovedet; det, du betaler, er altid totalbeløbet inklusive moms, som vises i kassen, før du bekræfter.',
          'Svensk moms tillægges med den gældende sats. Fragt opkræves separat og vises, før du bekræfter.',
        ],
      },
      {
        heading: 'At afgive en ordre',
        body: [
          'Din ordre er et bindende tilbud. Aftalen indgås, når vi bekræfter ordren.',
          'Vi beregner prisen for hver ordre på vores egen server ud fra aktuelle produktdata. Er en pris blevet vist forkert på grund af en teknisk fejl eller en åbenlys fejltagelse, kontakter vi dig inden produktion, og du kan annullere uden omkostninger.',
        ],
      },
      {
        heading: 'Dit originalmateriale',
        body: [
          'Du er ansvarlig for de filer, du sender: at du har rettighederne til indholdet, og at det er korrekt. Vi trykker det, du leverer. Vi læser ikke korrektur, og vi kontrollerer ikke, om du må bruge et billede eller et logo.',
          'Vi siger til, hvis en fil er uegnet til tryk — for eksempel for lav opløsning — men beslutningen om at trykke er din.',
          'Du beholder alle rettigheder til dit originalmateriale. Vi bruger det kun til at producere din ordre.',
        ],
      },
      {
        heading: 'Betaling',
        body: [
          'Betaling sker online via Mollie med de betalingsmetoder, der vises ved kassen. Din ordre går i produktion, når betalingen er bekræftet.',
        ],
      },
      {
        heading: 'Levering',
        body: [
          'Normal produktionstid er tre til fem arbejdsdage. Leveringstid kommer oveni og vises for hver fragtmulighed i kassen.',
          'Risikoen overgår til dig, når varen overdrages til dig eller til en transportør, du selv har valgt.',
        ],
      },
      {
        heading: 'Fortrydelsesret',
        body: [
          'I henhold til den svenske lov om fjernsalg (distansavtalslagen) har en forbruger normalt fjorten dages fortrydelsesret ved fjernsalg.',
          'Fortrydelsesretten gælder IKKE varer, der er fremstillet efter dine anvisninger eller har et tydeligt personligt præg — hvilket omfatter størstedelen af tryksagerne i butikken. Når en personligt tilpasset opgave er gået i produktion, kan den ikke annulleres eller returneres.',
          'Den gælder derimod standardvarer uden personlig tilpasning. Skriv til os på e-mailadressen nederst på siden inden fjorten dage efter, at du har modtaget varen.',
        ],
      },
      {
        heading: 'Fejl og reklamation',
        body: [
          'Er det, du har modtaget, fejlbehæftet eller ikke det, du bestilte — kontakt os inden for rimelig tid, så trykker vi om eller refunderer. Vedhæft gerne fotos og ordrenummer.',
          'Farver på tryk svarer aldrig nøjagtigt til farver på en skærm. Mindre variationer er normale og udgør ikke en fejl.',
          'Kontakt os, så snart du opdager en fejl — inden for to måneder efter opdagelsen er altid rettidigt, og som forbruger beholder du din treårige reklamationsret i henhold til den svenske forbrugerkøbelov (konsumentköplagen). Returneringer sendes til virksomhedsadressen, der vises på denne side.',
        ],
      },
      {
        heading: 'Hvis vi ikke er enige',
        body: [
          'Tal med os først — det meste løser sig hurtigt. Kan vi ikke blive enige, kan en forbruger henvende sig til det svenske forbrugerklagenævn (Allmänna reklamationsnämnden, arn.se) eller EU\'s onlineplatform for tvistbilæggelse. Svensk ret finder anvendelse.',
        ],
      },
    ],
  },

  cookies: {
    title: 'Cookies og lagring i browseren',
    updated: UPDATED,
    intro:
      'Kort sagt: butikken gemmer nogle få ting i din browser, for at den kan fungere. Værktøjer til måling og reklame indlæses kun, hvis du accepterer dem, og aldrig hvis du afviser. Undtagelsen er Google-kortet på kontaktsiden: det sætter Googles cookies, så snart siden åbnes.',
    sections: [
      {
        heading: 'Hvad der gemmes, og hvorfor',
        body: [
          'Din indkøbskurv — så den bevares, når du skifter side.',
          'Hvis du begynder at udfylde kassen, det du har skrevet — så en mislykket betaling eller en lukket fane ikke koster dig adressen to gange. Det gemmes i din browser i 24 timer og slettes derefter, og det slettes, så snart en ordre er betalt.',
          'Dit valg af sprog og valuta, og om priser skal vises med eller uden moms — så du ikke skal vælge igen på hver side.',
          'Aktuelle valutakurser og butiksindstillinger — gemmes kortvarigt, så siderne indlæses hurtigere.',
          'Logger du ind, gemmes en session, så du forbliver logget ind.',
          'Dit svar i cookiebanneret, hvor du er blevet spurgt — så du ikke bliver spurgt igen.',
          'Har du accepteret måling: de cookies, Google Analytics og Google Ads sætter for at tælle besøg og koble en ordre til den annonce, der førte dig hertil. Har du afvist, eller kører vi dem ikke, findes ingen af dem.',
          'På kontaktsiden, hvor der vises et kort, de cookies Google Maps sætter, når siden åbnes.',
        ],
      },
      {
        heading: 'Hvornår vi beder om dit samtykke, og hvornår vi ikke gør',
        body: [
          'Samtykke kræves for lagring, der ikke er nødvendig for en tjeneste, du har bedt om — typisk analyse og reklame. Indkøbskurven, sproget og valutaen, momsindstillingen og dit login er nødvendige: uden dem tømmes indkøbskurven, sproget nulstilles, og du logges ud. For dem kræver svensk lov (lagen om elektronisk kommunikation), at vi informerer dig, hvilket denne side gør, og vi beder dig ikke acceptere dem.',
          'Måling og reklame vælger du selv. Kører vi den slags værktøjer, spørger banneret nederst på siden først: de indlæses først, når du har trykket Accepter, og aldrig hvis du har trykket Afvis. Butikken fungerer ens, uanset hvad du vælger. Du kan til enhver tid ændre dit svar ved at rydde det, butikken har gemt i din browser.',
        ],
      },
      {
        heading: 'Ryd lagringen',
        body: [
          'Du kan til enhver tid rydde dette via browserens indstillinger. Indkøbskurv og indstillinger glemmes, og det gør dit svar om måling også — så du bliver spurgt igen næste gang, du besøger os. Hvis du var logget ind, kan et sammendrag af, hvad der lå i kurven, allerede være registreret hos os; se privatlivspolitikken, hvor det beskrives, og hvor du kan bede os slette det.',
        ],
      },
    ],
  },
};

/**
 * Norwegian (bokmål). Translated from the Swedish text, which is the
 * authoritative one: the shop is Swedish and Swedish law applies, so Swedish
 * statutes keep their Swedish names with a short Norwegian gloss, exactly as
 * the English text does.
 */
const no: Record<LegalKind, LegalDocument> = {
  privacy: {
    title: 'Personvernerklæring',
    updated: UPDATED,
    intro:
      'Denne erklæringen forklarer hvilke personopplysninger vi samler inn når du bruker butikken, hvorfor vi trenger dem, hvem andre som ser dem og hva du kan be oss om. Den gjelder hele nettstedet.',
    sections: [
      {
        heading: 'Hvem som er ansvarlig for opplysningene dine',
        body: [
          'Behandlingsansvarlig er selskapet som er oppgitt nederst på siden. Du når oss på adressen og e-postadressen der med spørsmål om opplysningene dine.',
        ],
      },
      {
        heading: 'Hva vi samler inn, og hvorfor',
        body: [
          'Når du bestiller: navn, e-postadresse, telefonnummer og leveringsadresse; en fakturaadresse og en egen leveringsadresse hvis du oppgir en; og, hvis du bestiller som bedrift, firmanavn og organisasjons- eller mva-nummer. Vi trenger disse for å produsere og levere ordren din og for å utstede en faktura som oppfyller svenske bokføringsregler. Rettslig grunnlag er oppfyllelse av avtalen, og for fakturaen vår rettslige forpliktelse.',
          'Filene du laster opp for trykk, sammen med målene, materialene og alternativene du har valgt, samt eventuelle merknader du legger ved. Vi trenger disse for å kunne trykke jobben.',
          'Hvis du oppretter en konto: e-postadressen din og et passord, som vi bare lagrer i kryptert (hashet) form og aldri kan lese. Ordrehistorikken din og eventuelle lojalitetspoeng knyttes til kontoen.',
          'Hvis du skriver til chatassistenten vår, meldingene du sender. Rettslig grunnlag er vår berettigede interesse i å besvare kundespørsmål. Ikke skriv sensitive personopplysninger i chatten.',
          'Hvis du skriver til oss via kontaktskjemaet: navnet ditt, e-postadressen din og meldingen din, slik at vi kan svare deg. Rettslig grunnlag er vår berettigede interesse i å besvare spørsmål.',
          'Hvis du er innlogget og lar noe ligge i handlekurven uten å bestille, et sammendrag av den: hvilke produkter, hvor mange og hva de kom på. Ikke filene du lastet opp, og ikke navnene deres. Vi bruker det til å se hvor ofte en ordre ikke fullføres, slik at vi kan rette det som står i veien. Rettslig grunnlag er vår berettigede interesse i å forstå hvor ordrer går tapt. Du kan når som helst protestere via kontaktopplysningene over, så sletter vi det; det slettes automatisk etter 30 dager og så snart du legger inn ordren.',
          'Godtar du måling i boksen om informasjonskapsler, får Google Analytics og Google Ads vite at du har besøkt butikken, og etter en ordre at et kjøp har skjedd og hva det var verdt. Avviser du, eller kjører vi ikke de verktøyene, samles ingenting inn til reklameformål. Vi lager ingen egne profiler av deg, og vi selger ikke opplysningene dine.',
        ],
      },
      {
        heading: 'Hvem andre som behandler opplysningene dine',
        body: [
          'HostX365, vårt webhotell — serverne i Helsingfors, Finland (innenfor EU) som driver butikken, lagrer databasen med ordren din, kontoen din og filene du har lastet opp, og sender e-postene våre.',
          '{AI_PROVIDER} — AI-assistenten, som mottar det du skriver i chatten.',
          'Google — Analytics og Ads, men bare hvis du godtar måling i boksen om informasjonskapsler. Før du godtar, sendes ingenting dit, og avviser du, sendes ingenting i det hele tatt.',
          'Google — kartet på kontaktsiden, der et slikt er lagt inn. Når siden åpnes, hentes kartet fra Google, som mottar IP-adressen din og setter sine egne informasjonskapsler. Det skjer når siden åpnes, og svaret ditt i boksen slår det ikke av.',
          'Mollie B.V. — betalinger. Du oppgir kort- eller bankopplysninger på Mollies egen side; de passerer aldri dette nettstedet, og vi ser dem aldri.',
          'Fraktpartneren vår, som leverer ordren din.',
          'Database-, chat-, betalings- og fraktleverandørene behandler opplysningene etter våre instruksjoner i henhold til en databehandleravtale. Google Analytics, Google Ads og Google Maps bruker også det som når dem, til sine egne formål, og derfor lastes de to første bare hvis du godtar dem. Overføres opplysninger til land utenfor EU/EØS, skjer det med EU-kommisjonens standardkontraktsklausuler.{AI_TRANSFER}',
        ],
      },
      {
        heading: 'Hvor lenge vi lagrer dem',
        body: [
          'Regnskapsmateriale, inkludert fakturaer: sju år i henhold til den svenske bokføringsloven (bokföringslagen).',
          'Trykkfilene du har lastet opp og opplysningene om ordrene dine: sju år, sammen med regnskapet vårt — slik at et opptrykk også kan bruke de samme filene.',
          'Kontoen din og ordrehistorikken dens: til du ber oss avslutte den.',
          'Chatmeldinger: vi lagrer dem ikke. Ingenting av samtalen lagres hos oss når svaret er sendt.',
          'Meldinger via kontaktskjemaet: lagres i kunderegisteret vårt til du ber oss slette dem.',
          'Et sammendrag av en handlekurv du har forlatt uten å bestille: tretti dager, deretter slettes det — og det slettes så snart du legger inn ordren.',
        ],
      },
      {
        heading: 'Dine rettigheter',
        body: [
          'Du har rett til innsyn i opplysningene vi har om deg, til å få uriktige opplysninger rettet, til å få opplysninger slettet, til å begrense eller protestere mot behandlingen og til å få opplysningene dine i et portabelt format. Har vi bedt om ditt samtykke, kan du når som helst trekke det tilbake.',
          'Enkelte opplysninger kan vi ikke slette på forespørsel — en faktura må etter loven oppbevares i sju år.',
          'Skriv til e-postadressen nederst på siden, så svarer vi innen én måned.',
          'Mener du at vi har behandlet opplysningene dine feil, kan du klage til det svenske datatilsynet (Integritetsskyddsmyndigheten, imy.se).',
        ],
      },
      {
        heading: 'Sikkerhet',
        body: [
          'Nettstedet leveres over en kryptert tilkobling. Ordreopplysninger lagres på webhotellets servere i Finland, innenfor EU, med tilgang begrenset til butikkens egne personalkontoer. Passord lagres bare i kryptert form. Betalingsopplysninger håndteres i sin helhet av Mollie og når aldri oss.',
        ],
      },
    ],
  },

  terms: {
    title: 'Kjøpsvilkår',
    updated: UPDATED,
    intro:
      'Disse vilkårene gjelder når du handler i butikken. Les dem før du bestiller — ved å legge inn en ordre aksepterer du dem.',
    sections: [
      {
        heading: 'Priser og mva',
        body: [
          'Alle priser er oppgitt i svenske kroner. Du kan veksle mellom priser eksklusive og inklusive mva i sidehodet; det du betaler er alltid totalsummen inklusive mva, som vises i kassen før du bekrefter.',
          'Svensk mva kommer i tillegg med gjeldende sats. Frakt belastes separat og vises før du bekrefter.',
        ],
      },
      {
        heading: 'Å legge inn en ordre',
        body: [
          'Ordren din er et bindende tilbud. Avtale inngås når vi bekrefter ordren.',
          'Vi beregner prisen for hver ordre på vår egen server ut fra gjeldende produktdata. Er en pris blitt vist feil på grunn av en teknisk feil eller en åpenbar feiltakelse, kontakter vi deg før produksjon, og du kan avbestille uten kostnad.',
        ],
      },
      {
        heading: 'Originalmaterialet ditt',
        body: [
          'Du er ansvarlig for filene du sender: at du har rettighetene til innholdet, og at det er korrekt. Vi trykker det du leverer. Vi leser ikke korrektur, og vi kontrollerer ikke om du har lov til å bruke et bilde eller en logo.',
          'Vi sier fra hvis en fil er uegnet for trykk — for eksempel for lav oppløsning — men beslutningen om å trykke er din.',
          'Du beholder alle rettigheter til originalmaterialet ditt. Vi bruker det bare til å produsere ordren din.',
        ],
      },
      {
        heading: 'Betaling',
        body: [
          'Betaling skjer på nett via Mollie, med betalingsmåtene som vises i kassen. Ordren din går i produksjon når betalingen er bekreftet.',
        ],
      },
      {
        heading: 'Levering',
        body: [
          'Normal produksjonstid er tre til fem virkedager. Leveringstid kommer i tillegg og vises per fraktalternativ i kassen.',
          'Risikoen går over på deg når varen overleveres til deg eller til en transportør du selv har valgt.',
        ],
      },
      {
        heading: 'Angrerett',
        body: [
          'I henhold til den svenske loven om fjernsalg (distansavtalslagen) har en forbruker normalt fjorten dagers angrerett ved fjernkjøp.',
          'Angreretten gjelder IKKE varer som er fremstilt etter dine anvisninger eller har et tydelig personlig preg — noe som omfatter mesteparten av trykksakene i butikken. Når en personlig tilpasset jobb har gått i produksjon, kan den ikke avbestilles eller returneres.',
          'Den gjelder derimot standardvarer uten personlig tilpasning. Send oss en e-post til adressen nederst på siden innen fjorten dager etter at du har mottatt varen.',
        ],
      },
      {
        heading: 'Feil og reklamasjon',
        body: [
          'Er det du har mottatt feilaktig eller ikke det du bestilte — ta kontakt innen rimelig tid, så trykker vi opp på nytt eller refunderer. Legg gjerne ved bilder og ordrenummer.',
          'Farger på trykk tilsvarer aldri nøyaktig farger på en skjerm. Mindre variasjoner er normale og utgjør ikke en feil.',
          'Kontakt oss så snart du oppdager en feil — innen to måneder etter at du oppdaget den er alltid i tide, og som forbruker beholder du din treårige reklamasjonsrett i henhold til den svenske forbrukerkjøpsloven (konsumentköplagen). Returer sendes til firmaadressen som vises på denne siden.',
        ],
      },
      {
        heading: 'Hvis vi ikke blir enige',
        body: [
          'Snakk med oss først — det meste løser seg raskt. Blir vi ikke enige, kan en forbruker henvende seg til den svenske forbrukerklagenemnda (Allmänna reklamationsnämnden, arn.se) eller EUs nettbaserte plattform for tvisteløsning. Svensk rett gjelder.',
        ],
      },
    ],
  },

  cookies: {
    title: 'Informasjonskapsler og lagring i nettleseren',
    updated: UPDATED,
    intro:
      'Kort sagt: butikken lagrer noen få ting i nettleseren din for at den skal fungere. Verktøy for måling og annonsering lastes bare hvis du godtar dem, aldri hvis du avviser. Unntaket er Google-kartet på kontaktsiden: det setter Googles informasjonskapsler så snart siden åpnes.',
    sections: [
      {
        heading: 'Hva som lagres, og hvorfor',
        body: [
          'Handlekurven din — slik at den består når du bytter side.',
          'Hvis du begynner å fylle ut kassen, det du har skrevet — slik at en mislykket betaling eller en lukket fane ikke koster deg adressen to ganger. Det lagres i nettleseren din i 24 timer og slettes deretter, og det slettes så snart en ordre er betalt.',
          'Valget ditt av språk og valuta, og om priser skal vises med eller uten mva — slik at du slipper å velge på nytt på hver side.',
          'Gjeldende valutakurser og butikkinnstillinger — lagres kort slik at sidene laster raskere.',
          'Logger du inn, lagres en økt slik at du forblir innlogget.',
          'Svaret ditt i boksen om informasjonskapsler, der du har fått spørsmålet — slik at du slipper å bli spurt igjen.',
          'Har du godtatt måling: informasjonskapslene Google Analytics og Google Ads setter for å telle besøk og koble en ordre til annonsen som førte deg hit. Har du avvist, eller kjører vi dem ikke, finnes ingen av dem.',
          'På kontaktsiden, der det vises et kart, informasjonskapslene Google Maps setter når siden åpnes.',
        ],
      },
      {
        heading: 'Når vi ber om ditt samtykke, og når vi ikke gjør det',
        body: [
          'Samtykke kreves for lagring som ikke er nødvendig for en tjeneste du har bedt om — typisk analyse og annonsering. Handlekurven, språket og valutaen, mva-innstillingen og innloggingen din er nødvendige: uten dem tømmes handlekurven, språket tilbakestilles og du logges ut. For dem krever svensk lov (lagen om elektronisk kommunikation) at vi informerer deg, og det er det denne siden gjør; vi ber deg ikke godta dem.',
          'Måling og annonsering velger du selv. Kjører vi slike verktøy, spør boksen nederst på siden først: de lastes først når du har trykket Godta, og aldri hvis du har trykket Avvis. Butikken fungerer likt uansett hva du velger. Du kan endre svaret ditt når som helst ved å slette det butikken har lagret i nettleseren din.',
        ],
      },
      {
        heading: 'Slette lagringen',
        body: [
          'Du kan når som helst slette dette via innstillingene i nettleseren. Handlekurv og innstillinger glemmes, og det gjør også svaret ditt om måling — så du blir spurt på nytt neste gang du er innom. Hvis du var innlogget, kan et sammendrag av hva som lå i handlekurven allerede være registrert hos oss; se personvernerklæringen, der det beskrives og der du kan be oss slette det.',
        ],
      },
    ],
  },
};

/**
 * Every shop language is now written out in full, so nothing falls back to
 * English and no "translation pending" banner is shown.
 */
export const LEGAL_TRANSLATION_PENDING: Language[] = [];

export function getLegalDocument(kind: LegalKind, language: Language): LegalDocument {
  if (language === 'sv') return sv[kind];
  if (language === 'da') return da[kind];
  if (language === 'no') return no[kind];
  return en[kind];
}

/** The shipped draft as editable plain text, for the dashboard. */
export function documentToText(doc: LegalDocument): string {
  const parts = [doc.intro, ''];
  for (const section of doc.sections) {
    parts.push(`## ${section.heading}`);
    parts.push(...section.body);
    parts.push('');
  }
  return parts.join('\n').trim();
}

/**
 * Parse what the owner typed back into sections.
 *
 * `## ` starts a heading; blank lines separate paragraphs; anything before the
 * first heading is the intro. Plain text on purpose — no markup can reach the
 * page, and there is no rich-text editor to fight.
 */
export function textToDocument(text: string, title: string, updated: string): LegalDocument {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections: LegalSection[] = [];
  const introLines: string[] = [];
  let current: LegalSection | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), body: [] };
      continue;
    }
    if (!line.trim()) continue;
    if (current) current.body.push(line.trim());
    else introLines.push(line.trim());
  }
  if (current) sections.push(current);

  return { title, updated, intro: introLines.join(' '), sections };
}
