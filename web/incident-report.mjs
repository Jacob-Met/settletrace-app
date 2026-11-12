/**
 * Read-only references copied from an untrusted support report.
 * A valid quote establishes provenance only, never resource type, relevance,
 * payment state, signature verification, or permission to call a provider.
 */
export const REPORT_LIMIT = 8000;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9-]{5,99}$/;
const BOUNDARY = /[A-Za-z0-9_-]/;
const KINDS = new Set(['order', 'capture', 'refund', 'event']);
// Share request vocabulary across positive, clause and negative forms.
const REQUEST_VERB = '(?:inspect|investigate|check|review|look\\s+up)';
const REQUEST_INTENT = new RegExp('\\b(?:current|today|now|' + REQUEST_VERB + ')\\b');
const REQUEST_CLAUSE = new RegExp(',\\s*(?=(?:and\\s+)?(?:please\\s+)?' + REQUEST_VERB + '\\s)', 'gi');
const REQUESTED_HISTORY = new RegExp('\\b' + REQUEST_VERB + "\\s+(?:the\\s+)?(?:old|previous|yesterday's)\\s+(?:paypal\\s+)?(?:order|capture|refund|event)s?(?:[ _-]*(?:ids?|numbers?|references?))?\\s*[:=#\\\"'\\s]*$");
const DENIED_REFERENCE = new RegExp("\\b(?:do\\s+not|don't|not|never|cannot|can't)\\s+(?:(?:" + REQUEST_VERB + "|use)\\s+)?(?:the\\s+)?(?:(?:related|associated|linked)\\s+)?(?:paypal\\s+)?(?:order|capture|refund|event)s?\\s*(?:ids?\\s*)?[:=#\\\"'\\s]*$");

const ID = '([A-Za-z0-9][A-Za-z0-9-]{5,99})(?![A-Za-z0-9_-])';

export class ReportLookupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReportLookupError';
    this.code = 'invalid_report_lookup';
  }
}

export function validateReport(report) {
  if (typeof report !== 'string' || !report.trim())
    throw new ReportLookupError('Paste a report containing a PayPal reference.');
  if (report.length > REPORT_LIMIT)
    throw new ReportLookupError('Use a report of at most 8,000 characters.');
  return report;
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function hasWholeToken(text, id) {
  let at = -1;
  while ((at = text.indexOf(id, at + 1)) !== -1) {
    const before = at ? text[at - 1] : '';
    const after = text[at + id.length] || '';
    if ((!before || !BOUNDARY.test(before)) && (!after || !BOUNDARY.test(after))) return true;
  }
  return false;
}

export function validateReportLookups(report, raw) {
  validateReport(report);
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); }
    catch { throw new ReportLookupError('Suggestions must be a JSON object.'); }
  }
  if (!exactKeys(value, ['lookups', 'uncertain'])
      || !Array.isArray(value.lookups) || value.lookups.length > 3
      || typeof value.uncertain !== 'boolean')
    throw new ReportLookupError('Suggestions must contain at most three references and an uncertainty flag.');
  if (!value.lookups.length && !value.uncertain)
    throw new ReportLookupError('An empty suggestion must be marked uncertain.');
  const seen = new Set();
  const lookups = value.lookups.map(item => {
    if (!exactKeys(item, ['kind', 'id', 'quote']) || !KINDS.has(item.kind)
        || typeof item.id !== 'string' || !TOKEN.test(item.id)
        || typeof item.quote !== 'string' || !item.quote.length || item.quote.length > 360)
      throw new ReportLookupError('Each reference needs a resource type, an identifier, and a short exact quote.');
    if (!report.includes(item.quote) || !hasWholeToken(item.quote, item.id)
        || !hasWholeToken(report, item.id))
      throw new ReportLookupError('A suggested identifier must appear as a whole token in its exact source quote.');
    const key = item.kind + ':' + item.id;
    if (seen.has(key)) throw new ReportLookupError('Duplicate suggestions are not allowed.');
    seen.add(key);
    return {kind: item.kind, id: item.id, quote: item.quote};
  });
  return {lookups, uncertain: value.uncertain};
}

function context(report, start, end) {
  let left = start, right = end;
  const boundary = at => /[;!?\n]/.test(report[at])
    || (report[at] === '.' && !(/\d/.test(report[at - 1] || '') && /\d/.test(report[at + 1] || '')));
  while (left > 0 && start - left < 150 && !boundary(left - 1)) left--;
  while (right < report.length && right - end < 150 && !boundary(right)) right++;
  // A later explicit request belongs to its own clause, not to earlier IDs.
  // Otherwise those background IDs inherit its ranking boost and fill the cap.
  const suffix = report.slice(end, right);
  const nextRequest = [...suffix.matchAll(REQUEST_CLAUSE)][0];
  if (nextRequest) right = end + nextRequest.index;
  const prefix = report.slice(left, start);
  for (const match of prefix.matchAll(/\b(?:but|instead|rather)\b/gi))
    left = start - prefix.length + match.index + match[0].length;
  // A fresh explicit request after a comma starts its own relevance clause.
  // Keep ordinary comma-separated ID lists inside their original instruction.
  for (const match of prefix.matchAll(REQUEST_CLAUSE))
    left = Math.max(left, start - prefix.length + match.index + match[0].length);
  return {
    quote: report.slice(left, Math.min(right, left + 360)).trim(),
    before: report.slice(left, start).toLowerCase(),
    after: report.slice(end, right).toLowerCase()
  };
}

function plausible(id) {
  return TOKEN.test(id) && (/\d/.test(id) || (/^[A-Z]+$/.test(id) && id.length >= 12));
}

function excluded(ctx) {
  const before = ctx.before.slice(-120);
  // A historical payment can itself be the requested investigation target.
  // Require a local explicit request; bare historical context still abstains.
  const requestedHistory = REQUESTED_HISTORY.test(before)
    && !/\b(?:not|never|don't|cannot|can't)\b/.test(before);
  return /\b(?:ignore|skip|disregard|irrelevant|example|sample)\b/.test(before)
    || (!requestedHistory && /\b(?:previous|yesterday|old)\b/.test(before))
    || DENIED_REFERENCE.test(before)
    || /\b(?:merchant|cart|invoice|ticket)\s+(?:order|capture|refund|event)(?:[ _-]id)?\s*[:=#"'\s]*$/.test(before)
    || /^\s*(?:[,;:—-]\s*)?(?:(?:is|was)\s+)?(?:already\s+resolved|irrelevant|an?\s+example|from\s+yesterday)\b/.test(ctx.after);
}

/**
 * Production extractor: explicit fields, API paths, nearby type cues, WH event
 * identifiers, local negation/stale-reference filters. No model or network.
 * It intentionally cannot decide all narrative ambiguity.
 */
export function suggestReportLookups(report) {
  validateReport(report);
  const candidates = [];
  const add = (kind, id, start, priority, listBefore) => {
    if (!plausible(id) || (start > 0 && BOUNDARY.test(report[start - 1]))) return;
    const ctx = context(report, start, start + id.length);
    if (!ctx.quote.includes(id) || excluded(listBefore === undefined ? ctx : {...ctx, before:listBefore})) return;
    const intent = REQUEST_INTENT.test(ctx.before + ' ' + ctx.after) ? 2 : 0;
    candidates.push({kind, id, quote: ctx.quote, start, priority: priority + intent});
  };
  for (const [kind, path] of [
    ['order', '/v2/checkout/orders/'],
    ['capture', '/v2/payments/captures/'],
    ['refund', '/v2/payments/refunds/'],
    ['event', '/v1/notifications/webhooks-events/']
  ]) {
    const pattern = new RegExp(path + ID, 'g');
    for (const match of report.matchAll(pattern))
      add(kind, match[1], match.index + match[0].length - match[1].length, 4);
  }
  const labelled = new RegExp(
    '\\b(order|capture|refund|event)(?:[ _-]*(?:id|number|reference))?\\b["\\x27]?\\s*'
    + '(?:(?:field\\s+says|is|was|=|:|#)\\s*)?["\\x27]?' + ID, 'gi');
  for (const match of report.matchAll(labelled))
    add(match[1].toLowerCase(), match[2], match.index + match[0].length - match[2].length, 4);

  // Only carry an explicit plural resource label across a contiguous ID list.
  // A new sentence/type cue or ordinary prose ends the list.
  const plural = /\b(orders|captures|refunds|events|order\s+ids|capture\s+ids|refund\s+ids|event\s+ids)\s*[:=]?\s*/gi;
  for (const match of report.matchAll(plural)) {
    const kind = match[1].toLowerCase().split(/\s/)[0].replace(/s$/, '');
    let at = match.index + match[0].length, count = 0;
    const listContext = context(report, at, at);
    if (excluded(listContext)) continue;
    while (count < 20) {
      const token = new RegExp('^' + ID).exec(report.slice(at));
      if (!token || !plausible(token[1])) break;
      add(kind, token[1], at, 4, listContext.before); count++;
      at += token[1].length;
      const separator = /^(?:\s*,\s*(?:and\s+)?|\s+and\s+)/i.exec(report.slice(at));
      if (!separator) break;
      at += separator[0].length;
    }
  }

  const trailing = new RegExp(ID
    + '\\s*(?:is|was)\\s+(?:the\\s+)?(?:PayPal\\s+)?(order|capture|refund|event)(?:[ _-]*id)?\\b', 'gi');
  for (const match of report.matchAll(trailing)) add(match[2].toLowerCase(), match[1], match.index, 3);
  for (const match of report.matchAll(/\bWH-[A-Za-z0-9-]{3,97}(?![A-Za-z0-9_-])/g))
    add('event', match[0], match.index, 2);

  const kindsById = new Map();
  for (const c of candidates) {
    if (!kindsById.has(c.id)) kindsById.set(c.id, new Set());
    kindsById.get(c.id).add(c.kind);
  }
  let uncertain = /\b(?:not sure|unsure|ambiguous|cannot tell|can't tell|could not tell|might be|maybe|either)\b/i.test(report);
  const unique = new Map();
  for (const candidate of candidates.sort((a,b) => b.priority-a.priority || a.start-b.start)) {
    if (kindsById.get(candidate.id).size > 1) { uncertain = true; continue; }
    const key = candidate.kind + ':' + candidate.id;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  if (unique.size > 3) uncertain = true;
  const lookups = [...unique.values()].slice(0, 3).map(({kind,id,quote}) => ({kind,id,quote}));
  return validateReportLookups(report, {lookups, uncertain: uncertain || !lookups.length});
}
