// Content filter.
//
// Wikipedia is not a curated, all-ages image source: articles like "Erection" carry
// explicit photographs, and the pageviews API happily puts them in a month's top 1,000.
// This module decides whether an article may be shown, using four signals from the
// MediaWiki API:
//
//   1. the article title            ("Erection")
//   2. the short description        ("...hardening and enlargement of the penis")
//   3. the article's categories     ("Category:Penis", "Category:Sexual arousal")
//   4. the page image's file name   ("A_Erect_human_penis.JPG")
//
// Any one of them is enough to filter the article out. Filtering is deliberately
// cautious: the game has ~950 other articles to choose from every month, so removing a
// borderline one costs nothing, while showing an explicit image costs a lot.
//
// Two things this filter intentionally does NOT do:
//   - It does not treat sexual orientation or gender identity as adult content.
//     Patterns use word boundaries, so "Bisexuality", "Asexuality", "Transgender" and
//     similar articles are not matched. They are encyclopedia topics like any other.
//   - It does not try to judge articles about war, crime, or death, whose images are
//     normally ordinary photographs. Only a short list of graphic-injury topics is
//     included below.
//
// No filter built from word lists is perfect. See README.md for the known limits.

/** Lowercase, drop underscores, and strip Latin accents so "pornografía" matches "pornografia". */
export function normalizeText(value = '') {
  return String(value)
    .replace(/_/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Latin combining marks only, so Japanese text survives
    .normalize('NFC')
    .toLowerCase();
}

// Matched against the title, the short description, and the image file name.
// Terms cover the seven languages the site offers (en, de, es, fr, it, ja, pt).
const EXPLICIT_TERMS = [
  // Genitals and sexual anatomy
  /\b(penis|penises|penile|penes|pene|phallus|phallic|foreskin|prepuce|prepucio|scrotum|scroto|testicle|testicles|hoden|testiculo|testicolo)\b/,
  /\b(vagina|vaginal|vulva|vulve|vagin|clitoris|clitoride|klitoris|labia)\b/,
  /\b(erection|erections|erectile|erektion|ereccion|erecao|erezione|tumescence)\b/,
  /\b(sexual dysfunction|sexual arousal|sexual stimulation)\b/,
  /\b(genitalia|genitals|genital|genitales|genitali|genitais|genitalien|organes genitaux)\b/,
  // Sexual acts
  /\b(sexual intercourse|sexual activity|sexual position|sexual positions|sex position|sex positions|oral sex|anal sex|group sex|premarital sex)\b/,
  /\b(masturbation|masturbacion|masturbacao|masturbazione|onanism|orgasm|orgasmo|orgasmus|orgasme|ejaculation|ejakulation|eyaculacion|ejaculacao|eiaculazione)\b/,
  /\b(fellatio|fellation|felacion|felacao|fellazione|cunnilingus|coitus|coito|copulation|sodomy|geschlechtsverkehr)\b/,
  /\b(rapport sexuel|rapports sexuels|relacion sexual|relaciones sexuales|relacao sexual|rapporto sessuale|atto sessuale)\b/,
  // Pornography, nudity, and the adult industry
  /\b(porn|porno|pornography|pornographic|pornografia|pornografie|pornographie|pornografica|hentai|ecchi)\b/,
  /\b(erotica|erotic|erotik|erotico|erotismo|eroticism|erotisme)\b/,
  // Nouns for nudity as a topic, not the adjectives: "naked", "nackt", and "desnudo" appear
  // in ordinary titles of books and films ("Nackt unter Wölfen", "The Naked Gun").
  /\b(nudity|nude|nudes|nudism|nudist|naturism|nacktheit|desnudez|nudite|nudita|nudez|toplessness|topless)\b/,
  /\b(striptease|stripper|sex toy|sex toys|sex doll|dildo|vibrator|bdsm|bondage|fetish|fetishism|orgy|orgies)\b/,
  /\b(brothel|brothels|prostitution|prostitute|prostitutes|prostituta|prostituierte|escort service|red light district)\b/,
  /\b(onlyfans|pornhub|xvideos|xhamster|xnxx|brazzers|youporn|redtube|playboy|hustler magazine|rule 34|nsfw)\b/,
  /\b(adult film|adult films|adult video|adult videos|adult industry|adult entertainment|porn star|porn actress|porn actor|av actress|av idol|camgirl|cam girl)\b/,
  // Child protection: never show these, whatever else the signals say
  /\b(child sexual|child pornography|csam|pedophilia|paedophilia|pedofilia|pedophile|paedophile|child abuse imagery)\b/,
  // A short list of graphic-injury topics whose lead images are often explicit
  /\b(beheading|beheadings|decapitation|dismemberment|mutilation|necrophilia|snuff film|self-immolation)\b/,
  // Japanese has no word boundaries, so these are matched as substrings
  /(性行為|性交|性器|ペニス|陰茎|勃起|射精|自慰|オナニー|アダルトビデオ|ポルノ|ヌード|裸体|全裸|巨乳|風俗嬢|エロ|春画|官能小説)/,
];

// Matched against the article's category names (the "Category:" prefix is stripped first).
// Categories are the strongest signal, because they come from Wikipedia's own editors.
const EXPLICIT_CATEGORIES = [
  /\b(pornography|pornographic|pornografia|pornografie|pornographie|pornografis)/,
  /\b(erotica|erotic|erotik|erotismo|erotisme|erotico)/,
  /\b(nudity|nudism|naturism|nacktheit|desnudez|nudite|nudita|nudez)\b/,
  /\b(sexuality|sexualitat|sexualidad|sexualite|sessualita|sexualidade|sexology|sexologia|sexologie)\b/,
  /\bsexual (acts?|anatomy|arousal|intercourse|positions?|activity|fetishism|slang|organs?|practices?)\b/,
  /\b(sex organs?|sex toys?|sex industry|sex positions?|sexual abuse imagery)\b/,
  /\b(penis|penile|vulva|vagina|genitalia|genitals|genitalien|genitales|genitali|genitais)\b/,
  // "masturbation" and "orgasm" are left out here on purpose: as categories they get
  // attached to films and songs as themes, and those articles show ordinary artwork.
  // The articles actually about them are caught by the title check above.
  /\b(prostitution|brothels?|striptease|bdsm|paraphilias?|fetishism)\b/,
  /\b(geschlechtsverkehr|sexualpraktik|sexualpraktiken)\b/,
  /(ポルノ|性行為|性器|アダルト|ヌード|裸)/,
];

// Only applied to image file names, where these words are a strong signal but would
// cause false positives in article text ("erect stems" in a plant description).
const IMAGE_ONLY_TERMS = [/\b(erect|nudo|nue|nua)\b/];

// Categories that say what a work is *about* describe its plot, not its picture:
// "Films about prostitution in India" is a normal movie poster, and "Anti-pedophile
// activism" is a journalist's portrait. These are skipped so the filter doesn't
// remove ordinary films, books, and biographies.
const CONTEXT_CATEGORY = /(^|\s)about\s|^anti-|^opposition to\s/;

// An escape hatch: if something explicit ever gets past the checks above, add its exact
// title here (any language) and it is blocked immediately, no pattern-writing needed.
const ALWAYS_BLOCK = new Set([
  // 'Some Article Title',
].map((t) => normalizeText(t)));

const matchesAny = (patterns, text) => patterns.find((pattern) => pattern.test(text)) ?? null;

/**
 * Decide whether an article can be shown.
 * Any signal that is unavailable is simply skipped, so this works both before page
 * details are fetched (title only) and after (description, categories, image).
 *
 * @param {{title?: string, key?: string, description?: string, categories?: string[], thumbnail?: string|null}} article
 * @returns {{blocked: boolean, signal?: string}} `signal` says which check matched (used in tests and the filtered-out table)
 */
export function assessArticle({ title = '', key = '', description = '', categories = [], thumbnail = '' } = {}) {
  const titleText = normalizeText(title || key);
  if (ALWAYS_BLOCK.has(titleText)) return { blocked: true, signal: 'blocklist' };
  if (matchesAny(EXPLICIT_TERMS, titleText)) return { blocked: true, signal: 'title' };

  if (description && matchesAny(EXPLICIT_TERMS, normalizeText(description))) {
    return { blocked: true, signal: 'description' };
  }

  for (const category of categories) {
    const name = normalizeText(String(category).replace(/^[^:]+:/, '')); // drop the "Category:" prefix
    if (CONTEXT_CATEGORY.test(name)) continue;
    if (matchesAny(EXPLICIT_CATEGORIES, name) || matchesAny(EXPLICIT_TERMS, name)) {
      return { blocked: true, signal: 'category' };
    }
  }

  if (thumbnail) {
    // Use the file name only: the rest of the URL has no bearing on the picture.
    const fileName = normalizeText(decodeURIComponent(thumbnail.split('?')[0].split('/').pop() ?? ''));
    if (matchesAny(EXPLICIT_TERMS, fileName) || matchesAny(IMAGE_ONLY_TERMS, fileName)) {
      return { blocked: true, signal: 'image' };
    }
  }

  return { blocked: false };
}

/** Convenience wrapper for the title-only stage, before page details are loaded. */
export const isExplicitTitle = (title) => assessArticle({ title }).blocked;

/** Shown wherever the filter needs explaining. */
export const FILTER_REASON = 'Adult or graphic content';
export const FILTER_NOTE =
  'Articles with adult or graphic content are filtered out using Wikipedia’s own categories, ' +
  'descriptions, titles, and image file names.';
