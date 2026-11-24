import { AppLocale, Ticket, TicketEvent } from '../types/helpdesk';

export type TicketSentimentLevel = 'tense' | 'concerned' | 'neutral' | 'positive';

export interface TicketSentimentAnalysis {
  level: TicketSentimentLevel;
  emoji: string;
  label: string;
  shortLabel: string;
  tensionScore: number;
  matchedCues: string[];
  reason: string;
  source: 'ai' | 'content';
  dotClass: string;
  badgeClass: string;
}

interface CueRule {
  pattern: RegExp;
  label: string;
  weight: number;
}

const HIGH_TENSION_CUES: CueRule[] = [
  { pattern: /\bfrustr[eé]e?s?\b/i, label: 'frustration', weight: 38 },
  { pattern: /\b(furieux|furieuse|en col[eè]re|exasp[eé]r[eé]e?|furious|angry)\b/i, label: 'colère', weight: 42 },
  { pattern: /\b(inacceptable|inadmissible|scandale|scandaleux|honteux|unacceptable)\b/i, label: 'inacceptable', weight: 40 },
  { pattern: /\b(catastrophique|catastrophe|d[eé]sastreux)\b/i, label: 'critique majeure', weight: 36 },
  { pattern: /\b(m[eé]content|insatisfait|d[eé][cç]u|dissatisfied)\b/i, label: 'insatisfaction', weight: 32 },
  { pattern: /\b(panne|outage|down|crash|coupure)\b/i, label: 'panne', weight: 30 },
  { pattern: /\b(perte de signal|perte totale|aucun signal)\b/i, label: 'perte signal', weight: 32 },
  { pattern: /\b(impossible|impossibilit[eé])\b/i, label: 'blocage', weight: 24 },
  { pattern: /\b(bloqu[eé]e?s?|verrouill[eé]e?s?|blocked|locked out)\b/i, label: 'bloqué', weight: 24 },
  { pattern: /\b(urgent|urgence|imm[eé]diat|imm[eé]diatement|asap|critique)\b/i, label: 'urgence', weight: 28 },
  { pattern: /\b(mise en demeure|avocat|r[eé]siliation|r[eé]silier|escalade)\b/i, label: 'risque escalade', weight: 38 },
  { pattern: /\b(depuis des heures|plusieurs jours|toujours rien|toujours pas)\b/i, label: 'attente prolongée', weight: 26 },
  { pattern: /\b(injoignable|hors zone)\b/i, label: 'hors zone', weight: 20 },
];

const CONCERN_CUES: CueRule[] = [
  { pattern: /\b(press[eé]e?s?|d[eé]lai|cl[oô]ture|deadline|avant ce soir)\b/i, label: 'contrainte délai', weight: 22 },
  { pattern: /\b(erreur|auth-401|403|500|timeout|[eé]chec|infructueu)/i, label: 'erreur technique', weight: 16 },
  { pattern: /\b(d[eé]connexion|instable|lent|lenteur|ralentissement)\b/i, label: 'instabilité', weight: 16 },
  { pattern: /\b(expir[eé]e?s?|suspendu)\b/i, label: 'expiration', weight: 14 },
  { pattern: /\b(rappel|relance|reprogrammer|v[eé]rifier)\b/i, label: 'suivi requis', weight: 10 },
  { pattern: /\b(n[’']arrive pas|ne fonctionne pas|cannot|unable)\b/i, label: 'difficulté usage', weight: 16 },
];

const POSITIVE_CUES: CueRule[] = [
  { pattern: /\b(constructif|constructive|collaboratif)\b/i, label: 'constructif', weight: -24 },
  { pattern: /\b(merci beaucoup|grand merci|parfait|excellent|super|bravo|ravi|satisfait)\b/i, label: 'satisfaction', weight: -24 },
  { pattern: /\b(r[eé]solu|r[eé]solue|op[eé]rationnel|fonctionne bien|thanks|thank you|great)\b/i, label: 'positif', weight: -20 },
  { pattern: /\b(prise en main|accompagnement|formation|conseil)\b/i, label: 'accompagnement', weight: -14 },
];

const SENTIMENT_COPY: Record<
  AppLocale,
  Record<TicketSentimentLevel, { label: string; shortLabel: string }>
> = {
  fr: {
    tense: { label: 'Échange tendu', shortLabel: 'Tendu' },
    concerned: { label: 'Sous pression', shortLabel: 'Pressé' },
    neutral: { label: 'Neutre', shortLabel: 'Neutre' },
    positive: { label: 'Constructif', shortLabel: 'Positif' },
  },
  en: {
    tense: { label: 'Tense exchange', shortLabel: 'Tense' },
    concerned: { label: 'Under pressure', shortLabel: 'Concerned' },
    neutral: { label: 'Neutral', shortLabel: 'Neutral' },
    positive: { label: 'Constructive', shortLabel: 'Positive' },
  },
  es: {
    tense: { label: 'Intercambio tenso', shortLabel: 'Tenso' },
    concerned: { label: 'Bajo presión', shortLabel: 'Urgente' },
    neutral: { label: 'Neutral', shortLabel: 'Neutral' },
    positive: { label: 'Constructivo', shortLabel: 'Positivo' },
  },
};

const SENTIMENT_STYLES: Record<
  TicketSentimentLevel,
  { emoji: string; dotClass: string; badgeClass: string }
> = {
  tense: {
    emoji: '😠',
    dotClass: 'bg-red-500',
    badgeClass:
      'bg-red-50 dark:bg-red-950/60 border-red-200/90 dark:border-red-800/80 text-red-700 dark:text-red-300',
  },
  concerned: {
    emoji: '😟',
    dotClass: 'bg-amber-500',
    badgeClass:
      'bg-amber-50 dark:bg-amber-950/60 border-amber-200/90 dark:border-amber-800/80 text-amber-700 dark:text-amber-300',
  },
  neutral: {
    emoji: '😐',
    dotClass: 'bg-slate-400 dark:bg-slate-500',
    badgeClass:
      'bg-slate-100/90 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300',
  },
  positive: {
    emoji: '😊',
    dotClass: 'bg-emerald-500',
    badgeClass:
      'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200/90 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300',
  },
};

const SAFE_ACRONYMS = new Set([
  'SLA',
  'SSO',
  'MFA',
  'VIP',
  'VPN',
  'SAS',
  'API',
  'CSV',
  'PDF',
  'HTTP',
  'HTTPS',
  'AUTH',
  'CTI',
  'VOIP',
  'RGPD',
  'GDPR',
  'JSON',
  'REST',
  'JIRA',
  'HTML',
  'DNS',
  'SMTP',
  'IMAP',
]);

export function analyzeTicketSentiment(
  ticket: Ticket,
  events?: TicketEvent[],
  locale: AppLocale = 'fr'
): TicketSentimentAnalysis {
  const clientMessages = Array.isArray(events)
    ? events
        .filter((ev) => ev.authorRole === 'client' && ev.visibility === 'public')
        .slice(-4)
        .map((ev) => ev.body)
        .join(' ')
    : '';

  const fullText = `${ticket.subject || ''} ${ticket.description || ''} ${clientMessages}`.trim();
  let score = 20; // Neutral baseline
  const matchedCues: string[] = [];

  for (const cue of HIGH_TENSION_CUES) {
    if (cue.pattern.test(fullText)) {
      score += cue.weight;
      if (!matchedCues.includes(cue.label)) matchedCues.push(cue.label);
    }
  }

  for (const cue of CONCERN_CUES) {
    if (cue.pattern.test(fullText)) {
      score += cue.weight;
      if (!matchedCues.includes(cue.label)) matchedCues.push(cue.label);
    }
  }

  for (const cue of POSITIVE_CUES) {
    if (cue.pattern.test(fullText)) {
      score += cue.weight;
      if (!matchedCues.includes(cue.label)) matchedCues.push(cue.label);
    }
  }

  // Punctuation / urgency formatting signals
  const exclamationCount = (fullText.match(/!/g) || []).length;
  if (exclamationCount >= 2 || /!{2,}/.test(fullText)) {
    score += 18;
    matchedCues.push('ponctuation insistante');
  }

  const capsTokens = (fullText.match(/\b[A-ZÀ-Ÿ]{4,}\b/g) || []).filter(
    (tok) => !SAFE_ACRONYMS.has(tok)
  );
  if (capsTokens.length > 0) {
    score += 15;
    matchedCues.push('majuscules');
  }

  // Priority & recurrence context modifier (mild, content remains primary)
  if (ticket.priority === 'critical') score += 12;
  else if (ticket.priority === 'high') score += 5;

  // Integrate persisted AI sentiment signal if present
  const aiText = (ticket.aiSentiment || '').trim();
  let source: 'ai' | 'content' = 'content';
  if (aiText) {
    source = 'ai';
    if (/frustr|tendu|col[eè]re|m[eé]content|inacceptable|tense|angry|negative|hostile/i.test(aiText)) {
      score = Math.max(score + 12, 76);
    } else if (/urgent|critique|impact op[eé]rationnel|press[eé]|anxieux|concerned|stressed/i.test(aiText)) {
      if (/urgent|critique|impact op[eé]rationnel/i.test(aiText) && score >= 52) {
        score = Math.max(score, 70);
      } else {
        score = Math.max(score, 48);
      }
    } else if (/constructif|positif|calme|satisfait|positive|calm|happy|helpful/i.test(aiText)) {
      if (!clientMessages || score < 55) {
        score = Math.min(score, 14);
      }
    } else if (/neutre|neutral|factuel/i.test(aiText)) {
      if (score < 45) {
        score = Math.min(Math.max(score, 18), 34);
      }
    }
  }

  // If ticket is resolved or closed and has no high-tension cues, soften tension
  if ((ticket.status === 'resolved' || ticket.status === 'closed') && score < 60) {
    score = Math.min(score, 18);
  }

  const tensionScore = Math.max(0, Math.min(100, Math.round(score)));

  let level: TicketSentimentLevel;
  if (tensionScore >= 65) {
    level = 'tense';
  } else if (tensionScore >= 36) {
    level = 'concerned';
  } else if (tensionScore <= 15) {
    level = 'positive';
  } else {
    level = 'neutral';
  }

  const copy = SENTIMENT_COPY[locale]?.[level] || SENTIMENT_COPY.fr[level];
  const style = SENTIMENT_STYLES[level];
  const reason =
    aiText && matchedCues.length > 0
      ? `${aiText} (${matchedCues.slice(0, 3).join(', ')})`
      : aiText
      ? aiText
      : matchedCues.length > 0
      ? matchedCues.slice(0, 3).join(', ')
      : copy.label;

  return {
    level,
    emoji: style.emoji,
    label: copy.label,
    shortLabel: copy.shortLabel,
    tensionScore,
    matchedCues: matchedCues.slice(0, 4),
    reason,
    source,
    dotClass: style.dotClass,
    badgeClass: style.badgeClass,
  };
}
