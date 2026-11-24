import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { AppLocale, AuditLogEntry, KbArticle, UserRoleKey } from '../types/helpdesk';
import { clampString } from './validation';

const STOP_WORDS = new Set([
  'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'ou', 'sur', 'dans',
  'pour', 'avec', 'mon', 'mes', 'nos', 'votre', 'est', 'sont', 'pas', 'plus',
  'the', 'and', 'for', 'with', 'how', 'can', 'not', 'los', 'las', 'con', 'para',
]);

export function suggestKbArticles(
  queryText: string,
  articles: KbArticle[],
  preferredLocale?: AppLocale,
  limit = 3
): KbArticle[] {
  const clean = queryText.trim().toLowerCase();
  if (clean.length < 3) return [];

  const tokens = clean
    .split(/[^a-zà-ÿ0-9]+/i)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));

  if (tokens.length === 0) return [];

  const scored = articles
    .filter((art) => art.published)
    .map((art) => {
      const hay = `${art.title} ${art.summary} ${art.category} ${art.tags.join(' ')} ${art.body}`.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (art.title.toLowerCase().includes(tok)) score += 4;
        if (art.tags.some((tg) => tg.toLowerCase().includes(tok))) score += 3;
        if (art.category.toLowerCase().includes(tok)) score += 2;
        if (hay.includes(tok)) score += 1;
      }
      if (preferredLocale && art.language === preferredLocale && score > 0) {
        score += 1.5;
      }
      return { art, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.art);
}

export async function recordAuditLog(params: {
  uid: string;
  actorName: string;
  actorRole?: UserRoleKey;
  action: string;
  category: AuditLogEntry['category'];
  targetLabel: string;
  details: string;
}): Promise<void> {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      actorName: clampString(params.actorName, 120),
      actorRole: params.actorRole || 'admin',
      action: clampString(params.action, 120),
      category: params.category,
      targetLabel: clampString(params.targetLabel, 180),
      details: clampString(params.details, 500),
      ownerId: params.uid,
      memberIds: [params.uid],
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'auditLogs');
  }
}
