import type { EmailNotificationKind } from "./catalogue";
import {
  LAYOUT_FIELDS,
  PLAIN_FIELDS,
  type EmailTemplateSpec,
  type LockedBlock,
  type MessageLanguage,
  type TemplateContent,
  type TemplateFields,
  type TemplateVariable,
} from "./email-templates";

/**
 * THE CODE DEFAULTS — every email's words, in English and Hindi.
 *
 * The English is lifted VERBATIM from the renderers it replaced (player-mail,
 * email-sender, email-changed-notice, the demo, review and support mailers,
 * `subjectFor`), and the parity test in apps/web renders each kind both ways
 * and compares the bytes — so moving the words here changed nothing anybody
 * receives. The Hindi is the simple spoken Hindi of a north-Indian club:
 * English words people actually use (टीम, नीलामी, रजिस्ट्रेशन, कोड) stay,
 * Sanskritised coinages do not.
 *
 * What is NOT here and never becomes wording: URLs (a button's destination is
 * the code's), the code block, the details tables and the finance document's
 * own text. And what the code writes per language into a variable — a sentence
 * whose grammar depends on the data — is marked `computed`.
 *
 * Keyed by `EmailNotificationKind`: a kind that sends email without an entry
 * here, or an entry for a kind that sends none, does not compile.
 */

const SUPPORT = "support@desiauction.in";

function layout(
  fields: Pick<TemplateFields, "subject" | "preheader" | "heading" | "paragraphs" | "footnote"> &
    Partial<Pick<TemplateFields, "after" | "actions">>,
): TemplateFields {
  return { after: [], actions: {}, ...fields };
}

function plain(subject: string, paragraphs: readonly string[]): TemplateFields {
  return { subject, preheader: "", heading: "", paragraphs, after: [], actions: {}, footnote: "" };
}

function one(fields: TemplateFields): TemplateContent {
  return { variants: { default: fields } };
}

function text(
  name: string,
  description: string,
  en: string,
  hi: string,
  extra: Partial<TemplateVariable> = {},
): TemplateVariable {
  return { name, description, sample: { en, hi }, ...extra };
}

function flag(name: string, description: string, sample = true): TemplateVariable {
  return { name, description, type: "flag", sample: { en: sample, hi: sample } };
}

const DEFAULT_VARIANT = [{ id: "default", label: "The email" }] as const;

// --- Shared variables ---------------------------------------------------------

const NAME = text("name", "The person's first name, as they gave it.", "Arjun", "अर्जुन");
const SEASON = text(
  "season",
  "The season's name.",
  "Malad Premier League 2026",
  "मलाड प्रीमियर लीग 2026",
);
const ORG = text(
  "orgName",
  "The club running the season.",
  "Malad Cricket Club",
  "मलाड क्रिकेट क्लब",
);
const TEAM = text("teamName", "The team's name.", "Cup Kings", "कप किंग्स");

// --- Locked blocks -------------------------------------------------------------

const IF_NOT_YOU: LockedBlock = {
  id: "if-not-you",
  field: "after",
  text: {
    en: `If it wasn't you, somebody may have reached your account. Write to ${SUPPORT} straight away from this address and we will help you get it back.`,
    hi: `अगर यह आपने नहीं किया, तो हो सकता है किसी और ने आपके अकाउंट तक पहुँच बना ली हो। तुरंत इसी पते से ${SUPPORT} पर लिखें, हम अकाउंट वापस पाने में आपकी मदद करेंगे।`,
  },
  why: "A security alert always tells the owner what to do if the change was not theirs.",
};

// --- Sign-in codes -------------------------------------------------------------

const CODE_EXPIRY = {
  login: {
    en: "It expires in 15 minutes.",
    hi: "यह 15 मिनट में खत्म हो जाएगा।",
  },
  signup: {
    en: "It expires in 15 minutes. Entering it creates your account on this address.",
    hi: "यह 15 मिनट में खत्म हो जाएगा। इसे डालते ही इस पते पर आपका अकाउंट बन जाएगा।",
  },
  email_change: {
    en: "Enter it on your account page to confirm this address. It expires in 15 minutes.",
    hi: "इस पते को पक्का करने के लिए इसे अपने अकाउंट पेज पर डालें। यह 15 मिनट में खत्म हो जाएगा।",
  },
} as const;

const EMAIL_CODE: EmailTemplateSpec = {
  kind: "auth.email_code",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: [
    { id: "login", label: "Sign-in" },
    { id: "signup", label: "Sign-up" },
    { id: "email_change", label: "Confirm a new address" },
  ],
  actions: [],
  variables: [
    text(
      "code",
      "The six-digit code. It is also shown large, on its own, under the first paragraphs.",
      "482913",
      "482913",
      {
        required: true,
      },
    ),
  ],
  locked: (["login", "signup", "email_change"] as const).map((variant) => ({
    id: `expiry-${variant}`,
    field: "after" as const,
    variants: [variant],
    text: CODE_EXPIRY[variant],
    why: "Says how long the code lasts. The code itself is always shown, large, under the opening paragraphs.",
  })),
  note: "Sign-in codes are never switched off. No links are ever added to these mails — a typed code cannot be followed out of a forwarded message.",
  defaults: {
    en: {
      variants: {
        login: layout({
          subject: "Your DesiAuction sign-in code",
          preheader: "Your sign-in code is {{code}}. It expires in 15 minutes.",
          heading: "Your sign-in code",
          paragraphs: ["Your DesiAuction sign-in code is:"],
          after: [
            CODE_EXPIRY.login.en,
            "If you did not try to sign in, someone entered your address on our sign-in page. Your account is safe as long as you do not share this code.",
          ],
          footnote: "You received this because this address was entered on our sign-in page.",
        }),
        signup: layout({
          subject: "Your DesiAuction sign-up code",
          preheader: "Your sign-up code is {{code}}. It expires in 15 minutes.",
          heading: "Welcome to DesiAuction",
          paragraphs: ["Your sign-up code is:"],
          after: [
            CODE_EXPIRY.signup.en,
            "If you did not ask for this, ignore this message — nothing is created until the code is used.",
          ],
          footnote: "You received this because this address was entered on our sign-up page.",
        }),
        email_change: layout({
          subject: "Confirm your email for DesiAuction",
          preheader: "Your confirmation code is {{code}}.",
          heading: "Confirm your email",
          paragraphs: ["Your DesiAuction confirmation code is {{code}}."],
          after: [CODE_EXPIRY.email_change.en, "If you did not ask for this, ignore this message."],
          footnote: "You received this because this address was added to a DesiAuction account.",
        }),
      },
    },
    hi: {
      variants: {
        login: layout({
          subject: "आपका DesiAuction साइन-इन कोड",
          preheader: "आपका साइन-इन कोड {{code}} है। यह 15 मिनट में खत्म हो जाएगा।",
          heading: "आपका साइन-इन कोड",
          paragraphs: ["आपका DesiAuction साइन-इन कोड है:"],
          after: [
            CODE_EXPIRY.login.hi,
            "अगर आपने साइन-इन की कोशिश नहीं की, तो किसी ने हमारे साइन-इन पेज पर आपका पता डाला है। जब तक आप यह कोड किसी को नहीं बताते, आपका अकाउंट सुरक्षित है।",
          ],
          footnote: "आपको यह इसलिए मिला क्योंकि हमारे साइन-इन पेज पर यह पता डाला गया था।",
        }),
        signup: layout({
          subject: "आपका DesiAuction साइन-अप कोड",
          preheader: "आपका साइन-अप कोड {{code}} है। यह 15 मिनट में खत्म हो जाएगा।",
          heading: "DesiAuction में आपका स्वागत है",
          paragraphs: ["आपका साइन-अप कोड है:"],
          after: [
            CODE_EXPIRY.signup.hi,
            "अगर आपने यह नहीं माँगा, तो इस मेल को अनदेखा करें — कोड डाले बिना कुछ नहीं बनेगा।",
          ],
          footnote: "आपको यह इसलिए मिला क्योंकि हमारे साइन-अप पेज पर यह पता डाला गया था।",
        }),
        email_change: layout({
          subject: "DesiAuction के लिए अपना ईमेल पक्का करें",
          preheader: "आपका पुष्टि कोड {{code}} है।",
          heading: "अपना ईमेल पक्का करें",
          paragraphs: ["आपका DesiAuction पुष्टि कोड {{code}} है।"],
          after: [CODE_EXPIRY.email_change.hi, "अगर आपने यह नहीं माँगा, तो इस मेल को अनदेखा करें।"],
          footnote: "आपको यह इसलिए मिला क्योंकि यह पता एक DesiAuction अकाउंट में जोड़ा गया था।",
        }),
      },
    },
  },
};

// --- Security alerts -------------------------------------------------------------

const HELP = [{ id: "help", description: "The support page." }] as const;

const PHONE_CHANGED: EmailTemplateSpec = {
  kind: "security.phone_changed",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: DEFAULT_VARIANT,
  actions: HELP,
  variables: [
    text(
      "last4",
      "The last four digits of the new number — never the whole number.",
      "4321",
      "4321",
      {
        required: true,
      },
    ),
  ],
  locked: [IF_NOT_YOU],
  defaults: {
    en: one(
      layout({
        subject: "Your DesiAuction mobile number was changed",
        preheader: "This account's mobile number now ends {{last4}}.",
        heading: "Your mobile number was changed",
        paragraphs: [
          "The mobile number on your DesiAuction account was changed to one ending {{last4}}. Sign-in codes and texts go there from now on, and every other device was signed out.",
          "If that was you, there is nothing to do.",
        ],
        after: [IF_NOT_YOU.text.en],
        actions: { help: "Get help" },
        footnote:
          "You received this because this is the verified email on a DesiAuction account whose mobile number just changed.",
      }),
    ),
    hi: one(
      layout({
        subject: "आपका DesiAuction मोबाइल नंबर बदल दिया गया है",
        preheader: "इस अकाउंट का मोबाइल नंबर अब {{last4}} पर खत्म होता है।",
        heading: "आपका मोबाइल नंबर बदल दिया गया है",
        paragraphs: [
          "आपके DesiAuction अकाउंट का मोबाइल नंबर बदलकर {{last4}} पर खत्म होने वाला नंबर कर दिया गया है। अब साइन-इन कोड और मैसेज उसी नंबर पर जाएँगे, और बाकी सभी डिवाइस से साइन आउट कर दिया गया है।",
          "अगर यह आपने किया है, तो कुछ करने की ज़रूरत नहीं है।",
        ],
        after: [IF_NOT_YOU.text.hi],
        actions: { help: "मदद लें" },
        footnote:
          "आपको यह इसलिए मिला क्योंकि यह उस DesiAuction अकाउंट का पक्का ईमेल है जिसका मोबाइल नंबर अभी बदला गया है।",
      }),
    ),
  },
};

const EMAIL_CHANGED: EmailTemplateSpec = {
  kind: "security.email_changed",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: DEFAULT_VARIANT,
  actions: HELP,
  variables: [
    text(
      "maskedEmail",
      "The new sign-in address, masked (a•••@example.com) — never in full.",
      "a•••@example.com",
      "a•••@example.com",
      { required: true },
    ),
  ],
  locked: [IF_NOT_YOU],
  defaults: {
    en: one(
      layout({
        subject: "Your DesiAuction sign-in email was changed",
        preheader: "This account now signs in with {{maskedEmail}}.",
        heading: "Your sign-in email was changed",
        paragraphs: [
          "The DesiAuction account that used this address now signs in with {{maskedEmail}}. Codes and account mail go there from now on, and every other device was signed out.",
          "If that was you, there is nothing to do.",
        ],
        after: [IF_NOT_YOU.text.en],
        actions: { help: "Get help" },
        footnote:
          "You received this because this address was the sign-in email on a DesiAuction account until a moment ago.",
      }),
    ),
    hi: one(
      layout({
        subject: "आपका DesiAuction साइन-इन ईमेल बदल दिया गया है",
        preheader: "यह अकाउंट अब {{maskedEmail}} से साइन इन होता है।",
        heading: "आपका साइन-इन ईमेल बदल दिया गया है",
        paragraphs: [
          "जो DesiAuction अकाउंट इस पते से चलता था, वह अब {{maskedEmail}} से साइन इन होता है। अब कोड और अकाउंट के मेल वहीं जाएँगे, और बाकी सभी डिवाइस से साइन आउट कर दिया गया है।",
          "अगर यह आपने किया है, तो कुछ करने की ज़रूरत नहीं है।",
        ],
        after: [IF_NOT_YOU.text.hi],
        actions: { help: "मदद लें" },
        footnote:
          "आपको यह इसलिए मिला क्योंकि कुछ देर पहले तक यही पता एक DesiAuction अकाउंट का साइन-इन ईमेल था।",
      }),
    ),
  },
};

// --- Registration decisions ------------------------------------------------------

const REGISTRATION_FOOTNOTE = {
  en: 'You received this because you registered for {{season}}. Switch off "Registration decisions" in your account to stop these.',
  hi: 'आपको यह इसलिए मिला क्योंकि आपने {{season}} के लिए रजिस्टर किया था। ये मेल बंद करने के लिए अपने अकाउंट में "Registration decisions" बंद करें।',
};

const REGISTRATION_ACTION = { en: "See your registration", hi: "अपना रजिस्ट्रेशन देखें" };

function decision(
  kind: EmailNotificationKind,
  words: Record<MessageLanguage, { subject: string; heading: string; lines: readonly string[] }>,
  extra: readonly TemplateVariable[] = [],
): EmailTemplateSpec {
  const build = (language: MessageLanguage) => {
    const chosen = words[language];
    return one(
      layout({
        subject: chosen.subject,
        preheader: chosen.lines[0] ?? chosen.heading,
        heading: chosen.heading,
        paragraphs: [language === "en" ? "Hi {{name}}," : "नमस्ते {{name}},", ...chosen.lines],
        actions: { registration: REGISTRATION_ACTION[language] },
        footnote: REGISTRATION_FOOTNOTE[language],
      }),
    );
  };
  return {
    kind,
    format: "layout",
    editable: true,
    editableFields: LAYOUT_FIELDS,
    languages: ["en", "hi"],
    variants: DEFAULT_VARIANT,
    actions: [{ id: "registration", description: "The player's home, where the registration is." }],
    variables: [NAME, SEASON, ...extra],
    locked: [],
    defaults: { en: build("en"), hi: build("hi") },
  };
}

// --- The season ------------------------------------------------------------------

const AUCTION_FOOTNOTE_SWITCH = {
  en: 'Switch off "Auction updates" in your account to stop these.',
  hi: 'ये मेल बंद करने के लिए अपने अकाउंट में "Auction updates" बंद करें।',
};

const SEASON_ACTION = { id: "season", description: "The player's home, with the season on it." };
const SEE_SEASON = { en: "See your season", hi: "अपना सीज़न देखें" };

const SOLD: EmailTemplateSpec = {
  kind: "auction.sold",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: DEFAULT_VARIANT,
  actions: [
    {
      id: "card",
      description:
        "Their public player card, with its share sheet — shown when the season is public and they are an adult.",
    },
    SEASON_ACTION,
  ],
  variables: [
    NAME,
    SEASON,
    ORG,
    TEAM,
    text("price", "What the team paid (₹75,000).", "₹75,000", "₹75,000", { required: true }),
    text("basePrice", "The player's base price.", "₹25,000", "₹25,000"),
    text(
      "multipleNote",
      "“— three times your base”, when the price was at least 1.5× the base; otherwise nothing.",
      " — 3 times your base",
      " — आपके बेस प्राइस का 3 गुना",
      { computed: true, whenEmpty: "blank" },
    ),
    text(
      "bidStory",
      "Who bid and how many times, as one sentence.",
      "Cup Kings, Tigers and Falcons all bid for you — 7 bids in all, from ₹25,000 to ₹75,000. Cup Kings won.",
      "कप किंग्स, टाइगर्स और फ़ॉल्कन्स — सबने आप पर बोली लगाई। कुल 7 बोलियाँ लगीं, ₹25,000 से ₹75,000 तक। कप किंग्स जीती।",
      { computed: true },
    ),
    text(
      "highlight",
      "A line worth telling (“You were the most expensive buy of the night”), when there is one. Its paragraph is left out otherwise.",
      "You were the most expensive buy of the night",
      "आप इस रात की सबसे महंगी खरीद रहे",
      { computed: true, whenEmpty: "drop" },
    ),
    text(
      "shareLine",
      "The nudge to share the player card, when the card is public (a public season, an adult). Its paragraph is left out otherwise.",
      "Your player card is ready. Share it with your groups or post it to your Status — the button below does both.",
      "आपका प्लेयर कार्ड तैयार है। इसे अपने ग्रुप्स में भेजें या अपने स्टेटस पर लगाएँ — नीचे का बटन दोनों करता है।",
      { computed: true, whenEmpty: "drop" },
    ),
  ],
  locked: [],
  note: "The squad table under the paragraphs is written by the code, in the reader's language.",
  defaults: {
    en: one(
      layout({
        subject: "Congratulations — {{teamName}} bought you for {{price}}",
        preheader: "{{teamName}} bought you in the {{season}} auction.",
        heading: "You're a {{teamName}} player",
        paragraphs: [
          "Congratulations, {{name}}!",
          "{{teamName}} bought you for {{price}} in the {{season}} auction{{multipleNote}}.",
          "{{bidStory}}",
          "{{highlight}}.",
          "{{shareLine}}",
        ],
        after: [
          "That is your squad so far at {{teamName}}. Your organizer, {{orgName}}, will share fixtures next.",
        ],
        actions: { card: "Share your player card", season: SEE_SEASON.en },
        footnote: `You received this because you played in the {{season}} auction. ${AUCTION_FOOTNOTE_SWITCH.en}`,
      }),
    ),
    hi: one(
      layout({
        subject: "बधाई हो — {{teamName}} ने आपको {{price}} में खरीदा",
        preheader: "{{season}} की नीलामी में {{teamName}} ने आपको खरीदा।",
        heading: "अब आप {{teamName}} के खिलाड़ी हैं",
        paragraphs: [
          "बधाई हो, {{name}}!",
          "{{season}} की नीलामी में {{teamName}} ने आपको {{price}} में खरीदा{{multipleNote}}।",
          "{{bidStory}}",
          "{{highlight}}।",
          "{{shareLine}}",
        ],
        after: [
          "यह {{teamName}} में अब तक की आपकी टीम है। आपके आयोजक, {{orgName}}, आगे मैचों की जानकारी देंगे।",
        ],
        actions: { card: "अपना प्लेयर कार्ड शेयर करें", season: SEE_SEASON.hi },
        footnote: `आपको यह इसलिए मिला क्योंकि आप {{season}} की नीलामी में थे। ${AUCTION_FOOTNOTE_SWITCH.hi}`,
      }),
    ),
  },
};

const UNSOLD: EmailTemplateSpec = {
  kind: "auction.unsold",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: DEFAULT_VARIANT,
  actions: [SEASON_ACTION],
  variables: [NAME, SEASON, ORG],
  locked: [],
  note: "Said plainly and kindly, and never by text — a message that just says “unsold” lands too hard.",
  defaults: {
    en: one(
      layout({
        subject: "Your {{season}} auction",
        preheader: "You weren't picked this time — you're still registered.",
        heading: "Not this time",
        paragraphs: [
          "Hi {{name}},",
          "The {{season}} auction has finished, and you weren't picked this time. That happens to good players on every auction night — squads fill up fast and teams plan around a few names.",
          "You're still registered with {{orgName}}, and organizers often bring players in as replacements during the season.",
        ],
        actions: { season: SEE_SEASON.en },
        footnote: `You received this because you registered for {{season}}. ${AUCTION_FOOTNOTE_SWITCH.en}`,
      }),
    ),
    hi: one(
      layout({
        subject: "आपकी {{season}} नीलामी",
        preheader: "इस बार आपका चयन नहीं हुआ — आपका रजिस्ट्रेशन अभी भी बना हुआ है।",
        heading: "इस बार नहीं",
        paragraphs: [
          "नमस्ते {{name}},",
          "{{season}} की नीलामी पूरी हो गई है, और इस बार आपका चयन नहीं हुआ। हर नीलामी में अच्छे खिलाड़ियों के साथ ऐसा होता है — टीमें जल्दी भर जाती हैं और कुछ गिने-चुने नामों के हिसाब से प्लान बनाती हैं।",
          "आप अभी भी {{orgName}} के साथ रजिस्टर्ड हैं, और सीज़न के दौरान आयोजक अक्सर खिलाड़ियों को रिप्लेसमेंट के तौर पर बुलाते हैं।",
        ],
        actions: { season: SEE_SEASON.hi },
        footnote: `आपको यह इसलिए मिला क्योंकि आपने {{season}} के लिए रजिस्टर किया था। ${AUCTION_FOOTNOTE_SWITCH.hi}`,
      }),
    ),
  },
};

const OWNER_SUMMARY: EmailTemplateSpec = {
  kind: "auction.owner_summary",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: DEFAULT_VARIANT,
  actions: [
    {
      id: "share",
      description:
        "The team's public squad page, with its share sheet — used when the season is public.",
    },
    { id: "team", description: "The season's teams page — used when the season is private." },
  ],
  variables: [
    NAME,
    SEASON,
    TEAM,
    text("squadSize", "How many players the owner bought.", "14", "14"),
    text("spent", "What the owner spent in all.", "₹4,50,000", "₹4,50,000"),
    text("purseLeft", "What is left in the purse.", "₹50,000", "₹50,000"),
    text("squadMin", "The season's minimum squad size.", "15", "15"),
    text(
      "shortBy",
      "How many players short of the minimum. Its paragraph is left out when the squad is full enough.",
      "1",
      "1",
      { whenEmpty: "drop" },
    ),
    text(
      "shareLine",
      "The nudge to share the squad card, when the season is public. Its paragraph is left out otherwise.",
      "Your squad card is ready. Send it to your team group or post it to your Status.",
      "आपकी टीम का कार्ड तैयार है। इसे टीम ग्रुप में भेजें या अपने स्टेटस पर लगाएँ।",
      { computed: true, whenEmpty: "drop" },
    ),
  ],
  locked: [],
  note: "The squad, spend and purse table is written by the code, in the reader's language.",
  defaults: {
    en: one(
      layout({
        subject: "{{teamName}}: your squad from the {{season}} auction",
        preheader: "{{squadSize}} players · {{spent}} spent · {{purseLeft}} left.",
        heading: "Your {{teamName}} squad",
        paragraphs: [
          "Hi {{name}},",
          "The {{season}} auction is done. Here is the squad you built, with what you paid for each player.",
          "{{shareLine}}",
        ],
        after: [
          "Your squad is {{shortBy}} short of the minimum of {{squadMin}}. Your organizer will tell you how the gap is filled.",
        ],
        actions: { share: "Share your squad", team: "Open your team" },
        footnote: "You received this because you own {{teamName}} in {{season}}.",
      }),
    ),
    hi: one(
      layout({
        subject: "{{teamName}}: {{season}} की नीलामी से आपकी टीम",
        preheader: "{{squadSize}} खिलाड़ी · {{spent}} खर्च · {{purseLeft}} बचे।",
        heading: "आपकी {{teamName}} टीम",
        paragraphs: [
          "नमस्ते {{name}},",
          "{{season}} की नीलामी पूरी हो गई है। यह रही आपकी बनाई टीम, और हर खिलाड़ी के लिए आपने कितना दिया।",
          "{{shareLine}}",
        ],
        after: [
          "आपकी टीम में कम से कम {{squadMin}} खिलाड़ी चाहिए, और अभी {{shortBy}} कम हैं। कमी कैसे पूरी होगी, यह आपके आयोजक बताएँगे।",
        ],
        actions: { share: "अपनी टीम शेयर करें", team: "अपनी टीम खोलें" },
        footnote: "आपको यह इसलिए मिला क्योंकि {{season}} में {{teamName}} आपकी टीम है।",
      }),
    ),
  },
};

const APPOINTED: EmailTemplateSpec = {
  kind: "team.appointed",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: DEFAULT_VARIANT,
  actions: [SEASON_ACTION],
  variables: [
    NAME,
    SEASON,
    ORG,
    TEAM,
    text(
      "roleTitle",
      "Every role being announced, in words (“captain and icon player”).",
      "captain and icon player",
      "कप्तान और आइकन खिलाड़ी",
      { computed: true },
    ),
    {
      name: "roleLines",
      description: "One sentence per role, about what it means. A paragraph on its own.",
      type: "list",
      computed: true,
      sample: {
        en: [
          "You'll lead the side — setting the tone, rallying the team, and making the calls that win close games.",
          "Icon players are the marquee names a team is built around.",
        ],
        hi: [
          "आप टीम की अगुवाई करेंगे — माहौल बनाएँगे, टीम का हौसला बढ़ाएँगे, और करीबी मुकाबलों में जीत दिलाने वाले फ़ैसले लेंगे।",
          "आइकन खिलाड़ी वे बड़े नाम होते हैं जिनके इर्द-गिर्द टीम बनाई जाती है।",
        ],
      },
    },
    flag(
      "ifSignedDirect",
      "Shows its paragraph only for a player who joins the team without the auction (a captain, icon or retained player who was not bought).",
    ),
  ],
  locked: [],
  defaults: {
    en: one(
      layout({
        subject: "You're the {{roleTitle}} of {{teamName}}",
        preheader: "{{orgName}} named you {{roleTitle}} of {{teamName}} for {{season}}.",
        heading: "You're the {{roleTitle}} of {{teamName}}",
        paragraphs: [
          "Congratulations, {{name}}!",
          "{{orgName}} has named you {{roleTitle}} of {{teamName}} for {{season}}.",
          "{{roleLines}}",
          "{{ifSignedDirect}}You join {{teamName}} directly, without going through the auction.",
        ],
        actions: { season: SEE_SEASON.en },
        footnote: `You received this because {{orgName}} named you in {{season}}. ${AUCTION_FOOTNOTE_SWITCH.en}`,
      }),
    ),
    hi: one(
      layout({
        subject: "आप {{teamName}} के {{roleTitle}} हैं",
        preheader: "{{orgName}} ने आपको {{season}} के लिए {{teamName}} का {{roleTitle}} बनाया है।",
        heading: "आप {{teamName}} के {{roleTitle}} हैं",
        paragraphs: [
          "बधाई हो, {{name}}!",
          "{{orgName}} ने आपको {{season}} के लिए {{teamName}} का {{roleTitle}} बनाया है।",
          "{{roleLines}}",
          "{{ifSignedDirect}}आप नीलामी में जाए बिना सीधे {{teamName}} में शामिल हो रहे हैं।",
        ],
        actions: { season: SEE_SEASON.hi },
        footnote: `आपको यह इसलिए मिला क्योंकि {{orgName}} ने {{season}} में आपको यह भूमिका दी। ${AUCTION_FOOTNOTE_SWITCH.hi}`,
      }),
    ),
  },
};

const SQUAD_SHEET: EmailTemplateSpec = {
  kind: "team.squad_sheet",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: DEFAULT_VARIANT,
  actions: [SEASON_ACTION],
  variables: [
    NAME,
    SEASON,
    ORG,
    TEAM,
    text("playerCount", "How many players are in the squad.", "15", "15"),
    text(
      "coachClause",
      "“, coached by Ravi”, when the team has a coach; otherwise nothing.",
      ", coached by Ravi Shastri",
      ", कोच रवि शास्त्री",
      { computed: true, whenEmpty: "blank" },
    ),
    text(
      "firstMatch",
      "The first match (“vs Tigers · Sun, 4 Oct 2026, 7:30 am · Malad Ground”). Its paragraph is left out when none is scheduled.",
      "vs Tigers · Sun, 4 Oct 2026, 7:30 am · Malad Ground",
      "vs Tigers · Sun, 4 Oct 2026, 7:30 am · Malad Ground",
      { whenEmpty: "drop" },
    ),
    flag("ifNoFirstMatch", "Shows its paragraph only when no match is scheduled yet.", false),
  ],
  locked: [],
  note: "The squad table, with the coach, is written by the code, in the reader's language.",
  defaults: {
    en: one(
      layout({
        subject: "Meet your {{teamName}} squad",
        preheader:
          "{{playerCount}} players{{coachClause}} — the {{teamName}} squad for {{season}}.",
        heading: "Meet your {{teamName}} squad",
        paragraphs: [
          "Hi {{name}},",
          "{{orgName}} has set the {{teamName}} squad for {{season}}. Here is who you'll be playing with.",
        ],
        after: [
          "{{ifNoFirstMatch}}{{orgName}} will share the fixtures soon.",
          "Your first match: {{firstMatch}}.",
        ],
        actions: { season: SEE_SEASON.en },
        footnote: `You received this because you play for {{teamName}} in {{season}}. ${AUCTION_FOOTNOTE_SWITCH.en}`,
      }),
    ),
    hi: one(
      layout({
        subject: "अपनी {{teamName}} टीम से मिलिए",
        preheader:
          "{{playerCount}} खिलाड़ी{{coachClause}} — {{season}} के लिए {{teamName}} की टीम।",
        heading: "अपनी {{teamName}} टीम से मिलिए",
        paragraphs: [
          "नमस्ते {{name}},",
          "{{orgName}} ने {{season}} के लिए {{teamName}} की टीम तय कर दी है। ये रहे आपके साथी खिलाड़ी।",
        ],
        after: [
          "{{ifNoFirstMatch}}{{orgName}} जल्द ही मैचों का शेड्यूल बताएँगे।",
          "आपका पहला मैच: {{firstMatch}}।",
        ],
        actions: { season: SEE_SEASON.hi },
        footnote: `आपको यह इसलिए मिला क्योंकि आप {{season}} में {{teamName}} के लिए खेलते हैं। ${AUCTION_FOOTNOTE_SWITCH.hi}`,
      }),
    ),
  },
};

const LINEUP: EmailTemplateSpec = {
  kind: "lineup.announced",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: DEFAULT_VARIANT,
  actions: [SEASON_ACTION],
  variables: [
    NAME,
    SEASON,
    TEAM,
    text("opponent", "The other team.", "Tigers", "टाइगर्स"),
    text(
      "when",
      "The kick-off (“Sun, 4 Oct 2026, 7:30 pm”).",
      "Sun, 4 Oct 2026, 7:30 pm",
      "Sun, 4 Oct 2026, 7:30 pm",
    ),
    text(
      "placeClause",
      "“ at Malad Ground”, when the match has a ground; otherwise nothing.",
      " at Malad Ground",
      ", मलाड ग्राउंड में",
      { computed: true, whenEmpty: "blank" },
    ),
  ],
  locked: [],
  note: "The lineup table is written by the code, in the reader's language.",
  defaults: {
    en: one(
      layout({
        subject: "You're in the {{teamName}} lineup vs {{opponent}}",
        preheader: "{{when}}{{placeClause}} — {{season}}.",
        heading: "You're in the {{teamName}} lineup",
        paragraphs: [
          "Hi {{name}},",
          "You're playing for {{teamName}} against {{opponent}} on {{when}}{{placeClause}}. Here's the lineup.",
        ],
        after: ["Good luck!"],
        actions: { season: SEE_SEASON.en },
        footnote: `You received this because you play for {{teamName}} in {{season}}. ${AUCTION_FOOTNOTE_SWITCH.en}`,
      }),
    ),
    hi: one(
      layout({
        subject: "{{opponent}} के ख़िलाफ़ {{teamName}} की प्लेइंग टीम में आप हैं",
        preheader: "{{when}}{{placeClause}} — {{season}}।",
        heading: "{{teamName}} की प्लेइंग टीम में आप हैं",
        paragraphs: [
          "नमस्ते {{name}},",
          "आप {{when}}{{placeClause}} {{opponent}} के ख़िलाफ़ {{teamName}} के लिए खेल रहे हैं। यह रही टीम।",
        ],
        after: ["शुभकामनाएँ!"],
        actions: { season: SEE_SEASON.hi },
        footnote: `आपको यह इसलिए मिला क्योंकि आप {{season}} में {{teamName}} के लिए खेलते हैं। ${AUCTION_FOOTNOTE_SWITCH.hi}`,
      }),
    ),
  },
};

// --- Money -----------------------------------------------------------------------

const FINANCE: EmailTemplateSpec = {
  kind: "finance.document.issued",
  format: "plain",
  editable: true,
  editableFields: PLAIN_FIELDS,
  languages: ["en", "hi"],
  variants: [
    { id: "receipt", label: "Receipt" },
    { id: "invoice", label: "Invoice" },
    { id: "correction", label: "Correction" },
    { id: "other", label: "Any other document" },
  ],
  actions: [],
  variables: [],
  locked: [],
  note: "The document itself — the amounts, the lines, the numbers — is the club's certified document text, reproduced exactly, and is never editable here. You can change the subject line and add opening paragraphs above it. The document is always included, after them.",
  defaults: {
    en: {
      variants: {
        receipt: plain("Your receipt from DesiAuction", []),
        invoice: plain("Your invoice from DesiAuction", []),
        correction: plain("A corrected document from DesiAuction", []),
        other: plain("A document from DesiAuction", []),
      },
    },
    hi: {
      variants: {
        receipt: plain("DesiAuction से आपकी रसीद", []),
        invoice: plain("DesiAuction से आपका इनवॉइस", []),
        correction: plain("DesiAuction से एक सुधारा हुआ दस्तावेज़", []),
        other: plain("DesiAuction से एक दस्तावेज़", []),
      },
    },
  },
};

// --- Feedback --------------------------------------------------------------------

const ASK_VARIABLES: readonly TemplateVariable[] = [
  text("name", "The person's name. Its paragraph is left out when we have none.", "Rohan", "रोहन", {
    whenEmpty: "drop",
  }),
  flag("ifNoName", "Shows its paragraph only when we have no name for the person.", false),
  text("days", "How many days the review link works.", "30", "30"),
  text(
    "accountUrl",
    "The link to their account settings, where the switch is.",
    "https://desiauction.in/account",
    "https://desiauction.in/account",
  ),
];

const PLATFORM_OPENING = {
  organizer: {
    en: "You've run a tournament on DesiAuction, and we'd like to know how it went — what worked, and what got in your way. It takes two minutes:",
    hi: "आपने DesiAuction पर एक टूर्नामेंट चलाया है, और हम जानना चाहेंगे कि वह कैसा रहा — क्या अच्छा चला, और कहाँ दिक्कत आई। इसमें बस दो मिनट लगेंगे:",
  },
  owner: {
    en: "You bid for a team in an auction on DesiAuction, and we'd like to know how it went from your side of the room — what worked, and what got in your way. Two minutes:",
    hi: "आपने DesiAuction की एक नीलामी में टीम के लिए बोली लगाई, और हम जानना चाहेंगे कि आपकी तरफ़ से वह कैसी रही — क्या अच्छा चला, और कहाँ दिक्कत आई। बस दो मिनट:",
  },
  general: {
    en: "You've used DesiAuction, and we'd like to know how it went — what worked, and what got in your way. It takes two minutes:",
    hi: "आपने DesiAuction इस्तेमाल किया है, और हम जानना चाहेंगे कि वह कैसा रहा — क्या अच्छा चला, और कहाँ दिक्कत आई। इसमें बस दो मिनट लगेंगे:",
  },
} as const;

function platformAsk(language: MessageLanguage, audience: keyof typeof PLATFORM_OPENING) {
  return language === "en"
    ? layout({
        subject: "How has DesiAuction worked for you?",
        preheader: "Two minutes on what worked and what got in your way.",
        heading: "How has DesiAuction worked for you?",
        paragraphs: ["{{ifNoName}}Hi,", "Hi {{name}},", PLATFORM_OPENING[audience].en],
        after: [
          "The link is yours and works for {{days}} days. Nothing you write is shown to anyone unless you tick the box that says we may quote it.",
          'Don\'t want to be asked? Switch off "Feedback requests" in your account settings: {{accountUrl}}',
        ],
        actions: { review: "Write your review" },
        footnote: "You received this because you used DesiAuction recently.",
      })
    : layout({
        subject: "DesiAuction आपके लिए कैसा रहा?",
        preheader: "दो मिनट में बताइए — क्या अच्छा चला और कहाँ दिक्कत आई।",
        heading: "DesiAuction आपके लिए कैसा रहा?",
        paragraphs: ["{{ifNoName}}नमस्ते,", "नमस्ते {{name}},", PLATFORM_OPENING[audience].hi],
        after: [
          "यह लिंक सिर्फ़ आपके लिए है और {{days}} दिन तक चलेगा। आप जो लिखेंगे वह किसी को नहीं दिखाया जाएगा, जब तक आप वह बॉक्स न चुनें जिसमें लिखा है कि हम उसे कोट कर सकते हैं।",
          'नहीं चाहते कि हम पूछें? अपनी अकाउंट सेटिंग में "Feedback requests" बंद करें: {{accountUrl}}',
        ],
        actions: { review: "अपना रिव्यू लिखें" },
        footnote: "आपको यह इसलिए मिला क्योंकि आपने हाल ही में DesiAuction इस्तेमाल किया।",
      });
}

const PLATFORM_ASK: EmailTemplateSpec = {
  kind: "review.platform_ask",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: [
    { id: "organizer", label: "To an organizer" },
    { id: "owner", label: "To a team owner" },
    { id: "general", label: "To anyone else" },
  ],
  actions: [{ id: "review", description: "Their own review link. Shown right after the opening." }],
  variables: ASK_VARIABLES,
  locked: [],
  defaults: {
    en: {
      variants: {
        organizer: platformAsk("en", "organizer"),
        owner: platformAsk("en", "owner"),
        general: platformAsk("en", "general"),
      },
    },
    hi: {
      variants: {
        organizer: platformAsk("hi", "organizer"),
        owner: platformAsk("hi", "owner"),
        general: platformAsk("hi", "general"),
      },
    },
  },
};

function seasonAsk(language: MessageLanguage, role: "player" | "owner") {
  if (language === "en") {
    return layout({
      subject: "How was {{season}}?",
      preheader: "Two minutes on {{season}} — for the players and owners deciding on next season.",
      heading: "How was {{season}}?",
      paragraphs: [
        "{{ifNoName}}Hi,",
        "Hi {{name}},",
        role === "owner"
          ? "You bid for a team in {{season}}, run by {{orgName}}. How did it go? Other players and owners deciding whether to join next time would like to know."
          : "You played in {{season}}, run by {{orgName}}. How did it go? Other players and owners deciding whether to join next time would like to know.",
      ],
      after: [
        `Once our team has read it, your review may appear on the season's public page. It carries your name only if you tick the box that says so; otherwise it says ${role === "owner" ? '"A team owner"' : '"A player"'}.`,
        'The link is yours and works for {{days}} days. Don\'t want to be asked? Switch off "Feedback requests" at {{accountUrl}}',
      ],
      actions: { review: "Review the season" },
      footnote: "You received this because you took part in {{season}} on DesiAuction.",
    });
  }
  return layout({
    subject: "{{season}} कैसा रहा?",
    preheader:
      "{{season}} के बारे में दो मिनट — उन खिलाड़ियों और टीम मालिकों के लिए जो अगले सीज़न का फ़ैसला कर रहे हैं।",
    heading: "{{season}} कैसा रहा?",
    paragraphs: [
      "{{ifNoName}}नमस्ते,",
      "नमस्ते {{name}},",
      role === "owner"
        ? "आपने {{season}} में एक टीम के लिए बोली लगाई, जिसे {{orgName}} चला रहे थे। यह कैसा रहा? अगली बार जुड़ने का फ़ैसला कर रहे दूसरे खिलाड़ी और टीम मालिक यह जानना चाहेंगे।"
        : "आप {{season}} में खेले, जिसे {{orgName}} चला रहे थे। यह कैसा रहा? अगली बार जुड़ने का फ़ैसला कर रहे दूसरे खिलाड़ी और टीम मालिक यह जानना चाहेंगे।",
    ],
    after: [
      `हमारी टीम के पढ़ने के बाद, आपका रिव्यू सीज़न के पब्लिक पेज पर दिख सकता है। उसमें आपका नाम तभी होगा जब आप इसके लिए बॉक्स चुनेंगे; वरना उसमें ${role === "owner" ? '"A team owner"' : '"A player"'} लिखा होगा।`,
      'यह लिंक सिर्फ़ आपके लिए है और {{days}} दिन तक चलेगा। नहीं चाहते कि हम पूछें? {{accountUrl}} पर "Feedback requests" बंद करें',
    ],
    actions: { review: "सीज़न का रिव्यू दें" },
    footnote: "आपको यह इसलिए मिला क्योंकि आपने DesiAuction पर {{season}} में हिस्सा लिया।",
  });
}

const SEASON_ASK: EmailTemplateSpec = {
  kind: "review.season_ask",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: [
    { id: "player", label: "To a player" },
    { id: "owner", label: "To a team owner" },
  ],
  actions: [{ id: "review", description: "Their own review link. Shown right after the opening." }],
  variables: [...ASK_VARIABLES, SEASON, ORG],
  locked: [],
  defaults: {
    en: { variants: { player: seasonAsk("en", "player"), owner: seasonAsk("en", "owner") } },
    hi: { variants: { player: seasonAsk("hi", "player"), owner: seasonAsk("hi", "owner") } },
  },
};

// --- Strangers: demo requests and bookings ---------------------------------------

const DEMO_NOTE =
  "Sent to somebody with no account, so always in English until they have one. Nothing they typed into the form is ever repeated back.";

const WHEN = text(
  "when",
  "The demo's time, in IST (“Tue 9 Sep, 7:00 pm IST”).",
  "Tue 9 Sep, 7:00 pm IST",
  "Tue 9 Sep, 7:00 pm IST",
);

const DEMO_REQUEST: EmailTemplateSpec = {
  kind: "demo.request_received",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: DEFAULT_VARIANT,
  actions: [{ id: "start", description: "The sign-in page." }],
  variables: [],
  locked: [],
  note: `${DEMO_NOTE} The table of their choices is written by the code.`,
  defaults: {
    en: one(
      layout({
        subject: "We've got your demo request — DesiAuction",
        preheader: "We'll get back to you within one working day to fix a time.",
        heading: "We've got your demo request",
        paragraphs: [
          "Hello,",
          "Thanks for asking about a demo of DesiAuction. We'll get back to you within one working day to fix a time.",
        ],
        after: [
          "The demo is a live walkthrough of a real auction — squads, the bidding, the gavel, and the money afterwards — on a tournament we've already run, so you see the whole night rather than an empty screen.",
          "In a hurry? You don't have to wait for us: every tournament gets the full platform free during beta.",
          "Didn't ask for this? Somebody typed your address into our demo form. You can ignore this email — we won't write again unless you reply.",
        ],
        actions: { start: "Start free" },
        footnote: `You received this because this address was entered on our demo request form. Write to ${SUPPORT} if anything changes.`,
      }),
    ),
    hi: one(
      layout({
        subject: "आपकी डेमो रिक्वेस्ट हमें मिल गई — DesiAuction",
        preheader: "समय तय करने के लिए हम एक कामकाजी दिन के अंदर आपसे संपर्क करेंगे।",
        heading: "आपकी डेमो रिक्वेस्ट हमें मिल गई",
        paragraphs: [
          "नमस्ते,",
          "DesiAuction का डेमो माँगने के लिए धन्यवाद। समय तय करने के लिए हम एक कामकाजी दिन के अंदर आपसे संपर्क करेंगे।",
        ],
        after: [
          "डेमो में हम एक असली नीलामी शुरू से आख़िर तक दिखाते हैं — टीमें, बोली, हथौड़ा, और बाद में पैसों का हिसाब — एक ऐसे टूर्नामेंट पर जो हम पहले चला चुके हैं, ताकि आप खाली स्क्रीन की जगह पूरी रात देख सकें।",
          "जल्दी है? हमारा इंतज़ार करने की ज़रूरत नहीं: बीटा के दौरान हर टूर्नामेंट को पूरा प्लेटफ़ॉर्म मुफ़्त मिलता है।",
          "आपने यह नहीं माँगा? किसी ने हमारे डेमो फ़ॉर्म में आपका पता डाल दिया। आप इस मेल को अनदेखा कर सकते हैं — जब तक आप जवाब नहीं देंगे, हम दोबारा नहीं लिखेंगे।",
        ],
        actions: { start: "मुफ़्त शुरू करें" },
        footnote: `आपको यह इसलिए मिला क्योंकि हमारे डेमो रिक्वेस्ट फ़ॉर्म पर यह पता डाला गया था। कुछ भी बदले तो ${SUPPORT} पर लिखें।`,
      }),
    ),
  },
};

const MANAGE = { id: "manage", description: "Their booking page, to move or cancel the demo." };

const BOOKING_CONFIRMED: EmailTemplateSpec = {
  kind: "demo.booking_confirmed",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: DEFAULT_VARIANT,
  actions: [MANAGE],
  variables: [WHEN],
  locked: [],
  note: `${DEMO_NOTE} The calendar invite and the booking table are written by the code.`,
  defaults: {
    en: one(
      layout({
        subject: "Your DesiAuction demo — {{when}}",
        preheader: "You're booked in for {{when}}. The calendar invite is attached.",
        heading: "Your demo is booked",
        paragraphs: ["Hello,", "You're booked in for {{when}}."],
        after: [
          "We'll walk through a real auction end to end — squads and purses, the bidding, the gavel, and the settlement afterwards. The calendar invite is attached.",
        ],
        actions: { manage: "Move or cancel" },
        footnote: "You received this because you booked a DesiAuction demo.",
      }),
    ),
    hi: one(
      layout({
        subject: "आपका DesiAuction डेमो — {{when}}",
        preheader: "आपका डेमो {{when}} के लिए बुक है। कैलेंडर इनवाइट साथ में लगा है।",
        heading: "आपका डेमो बुक हो गया है",
        paragraphs: ["नमस्ते,", "आपका डेमो {{when}} के लिए बुक है।"],
        after: [
          "हम एक असली नीलामी शुरू से आख़िर तक दिखाएँगे — टीमें और पर्स, बोली, हथौड़ा, और बाद में हिसाब-किताब। कैलेंडर इनवाइट साथ में लगा है।",
        ],
        actions: { manage: "समय बदलें या रद्द करें" },
        footnote: "आपको यह इसलिए मिला क्योंकि आपने DesiAuction डेमो बुक किया है।",
      }),
    ),
  },
};

const BOOKING_CANCELLED: EmailTemplateSpec = {
  kind: "demo.booking_cancelled",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: DEFAULT_VARIANT,
  actions: [{ id: "rebook", description: "The demo scheduling page." }],
  variables: [WHEN],
  locked: [],
  note: DEMO_NOTE,
  defaults: {
    en: one(
      layout({
        subject: "Cancelled: your DesiAuction demo — {{when}}",
        preheader: "The demo on {{when}} is cancelled.",
        heading: "Your demo is cancelled",
        paragraphs: ["Hello,", "The demo on {{when}} is cancelled and nobody will call."],
        actions: { rebook: "Pick another time" },
        footnote:
          "You received this because a DesiAuction demo booked with this address was cancelled.",
      }),
    ),
    hi: one(
      layout({
        subject: "रद्द: आपका DesiAuction डेमो — {{when}}",
        preheader: "{{when}} का डेमो रद्द कर दिया गया है।",
        heading: "आपका डेमो रद्द हो गया है",
        paragraphs: ["नमस्ते,", "{{when}} का डेमो रद्द कर दिया गया है, और कोई कॉल नहीं आएगी।"],
        actions: { rebook: "कोई और समय चुनें" },
        footnote:
          "आपको यह इसलिए मिला क्योंकि इस पते से बुक किया गया DesiAuction डेमो रद्द कर दिया गया।",
      }),
    ),
  },
};

const BOOKING_REMINDER: EmailTemplateSpec = {
  kind: "demo.booking_reminder",
  format: "layout",
  editable: true,
  editableFields: LAYOUT_FIELDS,
  languages: ["en", "hi"],
  variants: [
    { id: "day_before", label: "The day before" },
    { id: "hour_before", label: "An hour before" },
  ],
  actions: [MANAGE],
  variables: [WHEN],
  locked: [],
  note: DEMO_NOTE,
  defaults: {
    en: {
      variants: {
        day_before: layout({
          subject: "Tomorrow: your DesiAuction demo — {{when}}",
          preheader: "We're speaking {{when}}.",
          heading: "Your demo is tomorrow",
          paragraphs: [
            "Hello,",
            "A reminder that we're speaking {{when}}. We'll call the number you gave us.",
          ],
          actions: { manage: "Can't make it? Move or cancel" },
          footnote: "You received this because you booked a DesiAuction demo.",
        }),
        hour_before: layout({
          subject: "In an hour: your DesiAuction demo",
          preheader: "We're calling in about an hour.",
          heading: "Your demo is in an hour",
          paragraphs: ["Hello,", "We're calling in about an hour, at {{when}}."],
          actions: { manage: "Can't make it? Move or cancel" },
          footnote: "You received this because you booked a DesiAuction demo.",
        }),
      },
    },
    hi: {
      variants: {
        day_before: layout({
          subject: "कल: आपका DesiAuction डेमो — {{when}}",
          preheader: "हमारी बात {{when}} होगी।",
          heading: "आपका डेमो कल है",
          paragraphs: [
            "नमस्ते,",
            "याद दिला दें कि हमारी बात {{when}} होगी। हम आपके दिए नंबर पर कॉल करेंगे।",
          ],
          actions: { manage: "नहीं आ पाएँगे? समय बदलें या रद्द करें" },
          footnote: "आपको यह इसलिए मिला क्योंकि आपने DesiAuction डेमो बुक किया है।",
        }),
        hour_before: layout({
          subject: "एक घंटे में: आपका DesiAuction डेमो",
          preheader: "हम लगभग एक घंटे में कॉल करेंगे।",
          heading: "आपका डेमो एक घंटे में है",
          paragraphs: ["नमस्ते,", "हम लगभग एक घंटे में, {{when}} पर, कॉल करेंगे।"],
          actions: { manage: "नहीं आ पाएँगे? समय बदलें या रद्द करें" },
          footnote: "आपको यह इसलिए मिला क्योंकि आपने DesiAuction डेमो बुक किया है।",
        }),
      },
    },
  },
};

// --- A problem report's receipt -----------------------------------------------------

const REPORT_RECEIVED: EmailTemplateSpec = {
  kind: "support.report_received",
  format: "plain",
  editable: true,
  editableFields: PLAIN_FIELDS,
  languages: ["en", "hi"],
  variants: DEFAULT_VARIANT,
  actions: [],
  variables: [
    text(
      "screenshotClause",
      "How the sentence ends — “so we can look at it.” or, with a screenshot, “and the screenshot you sent.”",
      "and the screenshot you sent.",
      ", और आपका भेजा स्क्रीनशॉट भी।",
      { computed: true },
    ),
  ],
  locked: [],
  note: "Plain text, sent to a signed-in person's own verified address. What they typed in the report is never repeated back.",
  defaults: {
    en: one(
      plain("We've got your report — DesiAuction", [
        "Hi,",
        "Thanks for telling us. Your report has reached the team, with the page you were on\n{{screenshotClause}}",
        "We read every report. If we need more detail, or once it's fixed, we'll write back\nto this address.",
        `If it's urgent — an auction is live right now — write to ${SUPPORT} and say so\nin the subject line.`,
        "— DesiAuction",
      ]),
    ),
    hi: one(
      plain("आपकी रिपोर्ट हमें मिल गई — DesiAuction", [
        "नमस्ते,",
        "बताने के लिए धन्यवाद। आपकी रिपोर्ट, आप जिस पेज पर थे उसके साथ, हमारी टीम तक पहुँच गई है{{screenshotClause}}",
        "हम हर रिपोर्ट पढ़ते हैं। अगर हमें और जानकारी चाहिए होगी, या जब यह ठीक हो जाएगा, तो हम इसी पते पर जवाब देंगे।",
        `अगर मामला ज़रूरी है — अभी कोई नीलामी चल रही है — तो ${SUPPORT} पर लिखें और सब्जेक्ट लाइन में यह बताएँ।`,
        "— DesiAuction",
      ]),
    ),
  },
};

// --- Our own staff: English, plain text, not editable -----------------------------------

function staff(
  kind: EmailNotificationKind,
  subject: string,
  paragraphs: readonly string[],
  variables: readonly [string, string, string][],
): EmailTemplateSpec {
  return {
    kind,
    format: "plain",
    editable: false,
    editableFields: [],
    languages: ["en"],
    variants: DEFAULT_VARIANT,
    actions: [],
    variables: variables.map(([name, description, sample]) =>
      text(name, description, sample, sample, { computed: true, whenEmpty: "blank" }),
    ),
    locked: [],
    note: "Our own notice, to the support mailbox. English, plain text, and not editable — it is a record of what somebody sent us.",
    defaults: { en: one(plain(subject, paragraphs)) },
  };
}

const STAFF_DEMO = staff(
  "staff.demo_request",
  "Demo request — {{orgName}} ({{size}})",
  [
    "{{name}} · {{phone}}{{emailClause}}\n{{orgName}} — {{size}}\n{{auctionLine}}\nPrefers: {{window}}\nCame from: {{source}}",
    "{{note}}",
    "{{deskUrl}}",
  ],
  [
    ["name", "Who asked.", "Rohan Mehta"],
    ["phone", "Their phone.", "+919812345678"],
    ["emailClause", "“ · their address”, when they gave one.", " · rohan@example.com"],
    ["orgName", "Their organisation.", "Malad Cricket Club"],
    ["size", "The tournament size they chose.", "8–16 teams"],
    ["auctionLine", "Their auction date, or that there is none yet.", "Auction: 2026-10-04"],
    ["window", "When they prefer to talk.", "weekday evenings"],
    ["source", "Where the form was.", "landing"],
    ["note", "Their note, or “(no note)”.", "(no note)"],
    ["deskUrl", "The demo desk.", "https://desiauction.in/admin/demos#01J"],
  ],
);

const STAFF_REPORT = staff(
  "staff.problem_report",
  "[Report] {{category}} — {{summary}}",
  [
    "{{category}}, from {{reporter}}\n{{replyLine}}",
    "Page: {{pageUrl}}{{contextBlock}}",
    "{{description}}",
    "{{screenshotLine}}",
    "{{deskUrl}}",
  ],
  [
    ["category", "What kind of problem.", "Something is broken"],
    ["summary", "The description's first line.", "The bid button did nothing"],
    ["reporter", "Who reported it.", "Arjun (01J…)"],
    ["replyLine", "The reply address, or that there is none.", "No reply address given."],
    ["pageUrl", "The page they were on.", "https://desiauction.in/home"],
    [
      "contextBlock",
      "The browser context, when there is any.",
      "\n\nContext:\n  viewport: 390x844",
    ],
    ["description", "What they wrote.", "The bid button did nothing."],
    ["screenshotLine", "Whether a screenshot is attached.", "No screenshot."],
    ["deskUrl", "The reports desk.", "https://desiauction.in/admin/reports#01J"],
  ],
);

const STAFF_REVIEW = staff(
  "staff.review_arrived",
  "[Review] {{rating}}/5 from {{personName}}",
  [
    "{{rating}}/5 — {{personLine}}\n{{quoteLine}}",
    "What went well:\n{{wentWell}}",
    "What to improve:\n{{improve}}",
    "{{deskUrl}}",
  ],
  [
    ["rating", "The rating, 1 to 5.", "5"],
    ["personName", "Who wrote it, or “a customer”.", "Rohan"],
    ["personLine", "Who wrote it, or that we have no name.", "Rohan"],
    ["quoteLine", "Whether we may quote it, and how it is signed.", "Not for quoting."],
    ["wentWell", "What went well.", "(nothing written)"],
    ["improve", "What to improve.", "(nothing written)"],
    ["deskUrl", "The reviews desk.", "https://desiauction.in/admin/reviews"],
  ],
);

// --- The registry --------------------------------------------------------------------

export const EMAIL_TEMPLATES: Readonly<Record<EmailNotificationKind, EmailTemplateSpec>> = {
  "auth.email_code": EMAIL_CODE,
  "security.phone_changed": PHONE_CHANGED,
  "security.email_changed": EMAIL_CHANGED,
  "registration.approved": decision("registration.approved", {
    en: {
      subject: "You're approved for {{season}}",
      heading: "You're in",
      lines: [
        "Your registration for {{season}} is approved. You're in the player pool for auction day.",
      ],
    },
    hi: {
      subject: "{{season}} के लिए आपका रजिस्ट्रेशन मंज़ूर हो गया",
      heading: "आप शामिल हैं",
      lines: [
        "{{season}} के लिए आपका रजिस्ट्रेशन मंज़ूर हो गया है। नीलामी के दिन आप खिलाड़ियों की सूची में हैं।",
      ],
    },
  }),
  "registration.waitlisted": decision("registration.waitlisted", {
    en: {
      subject: "You're on the waitlist for {{season}}",
      heading: "You're on the waitlist",
      lines: [
        "Your registration for {{season}} is on the waitlist. The organizer moves players up if a place opens, and we'll tell you if that happens.",
      ],
    },
    hi: {
      subject: "{{season}} के लिए आप वेटलिस्ट पर हैं",
      heading: "आप वेटलिस्ट पर हैं",
      lines: [
        "{{season}} के लिए आपका रजिस्ट्रेशन वेटलिस्ट पर है। जगह खाली होने पर आयोजक खिलाड़ियों को आगे बढ़ाते हैं, और ऐसा होने पर हम आपको बताएँगे।",
      ],
    },
  }),
  "registration.rejected": decision(
    "registration.rejected",
    {
      en: {
        subject: "Your registration for {{season}} wasn't approved",
        heading: "Your registration wasn't approved",
        lines: [
          "Your registration for {{season}} was not approved.",
          "The reason given: {{reason}}.",
        ],
      },
      hi: {
        subject: "{{season}} के लिए आपका रजिस्ट्रेशन मंज़ूर नहीं हुआ",
        heading: "आपका रजिस्ट्रेशन मंज़ूर नहीं हुआ",
        lines: [
          "{{season}} के लिए आपका रजिस्ट्रेशन मंज़ूर नहीं किया गया।",
          "बताई गई वजह: {{reason}}।",
        ],
      },
    },
    [
      text(
        "reason",
        "The organizer's reason, in the player's words (a fixed list, translated).",
        "the season is full",
        "सीज़न की सभी जगहें भर गई हैं",
        { computed: true },
      ),
    ],
  ),
  "registration.withdrawn": decision("registration.withdrawn", {
    en: {
      subject: "Your registration for {{season}} was withdrawn",
      heading: "Your registration was withdrawn",
      lines: [
        "Your registration for {{season}} was withdrawn. You can register again while registration is open.",
      ],
    },
    hi: {
      subject: "{{season}} के लिए आपका रजिस्ट्रेशन वापस ले लिया गया",
      heading: "आपका रजिस्ट्रेशन वापस ले लिया गया",
      lines: [
        "{{season}} के लिए आपका रजिस्ट्रेशन वापस ले लिया गया है। रजिस्ट्रेशन खुला रहने तक आप फिर से रजिस्टर कर सकते हैं।",
      ],
    },
  }),
  "registration.restored": decision("registration.restored", {
    en: {
      subject: "Your registration for {{season}} is back under review",
      heading: "Back under review",
      lines: [
        "Your registration for {{season}} is back under review. We'll tell you what the organizer decides.",
      ],
    },
    hi: {
      subject: "{{season}} के लिए आपका रजिस्ट्रेशन फिर से जाँच में है",
      heading: "फिर से जाँच में",
      lines: [
        "{{season}} के लिए आपका रजिस्ट्रेशन फिर से जाँच में है। आयोजक जो भी फ़ैसला करेंगे, हम आपको बताएँगे।",
      ],
    },
  }),
  "auction.sold": SOLD,
  "auction.unsold": UNSOLD,
  "auction.owner_summary": OWNER_SUMMARY,
  "team.appointed": APPOINTED,
  "team.squad_sheet": SQUAD_SHEET,
  "lineup.announced": LINEUP,
  "finance.document.issued": FINANCE,
  "review.platform_ask": PLATFORM_ASK,
  "review.season_ask": SEASON_ASK,
  "demo.request_received": DEMO_REQUEST,
  "demo.booking_confirmed": BOOKING_CONFIRMED,
  "demo.booking_cancelled": BOOKING_CANCELLED,
  "demo.booking_reminder": BOOKING_REMINDER,
  "support.report_received": REPORT_RECEIVED,
  "staff.demo_request": STAFF_DEMO,
  "staff.problem_report": STAFF_REPORT,
  "staff.review_arrived": STAFF_REVIEW,
};

export function emailTemplateOf(kind: EmailNotificationKind): EmailTemplateSpec {
  return EMAIL_TEMPLATES[kind];
}

export function isEmailTemplateKind(kind: string): kind is EmailNotificationKind {
  return Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, kind);
}
