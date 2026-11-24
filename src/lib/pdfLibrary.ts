import { jsPDF } from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const DB_NAME = 'zentradesk_kb_pdfs_v1';
const STORE_NAME = 'pdf_blobs';

export interface ExtractedPdfContent {
  pageCount: number;
  pages: string[];
  fullText: string;
}

function openPdfDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB non disponible dans ce navigateur.'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Erreur ouverture IndexedDB.'));
  });
}

export async function savePdfBlobLocal(docId: string, blob: Blob): Promise<void> {
  try {
    const db = await openPdfDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(blob, docId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Erreur écriture IndexedDB.'));
    });
    db.close();
  } catch {
    // Non-blocking: Firestore still preserves extracted text and notes
  }
}

export async function getPdfBlobLocal(docId: string): Promise<Blob | null> {
  try {
    const db = await openPdfDb();
    const result = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(docId);
      req.onsuccess = () => {
        const val = req.result;
        resolve(val instanceof Blob ? val : null);
      };
      req.onerror = () => reject(req.error || new Error('Erreur lecture IndexedDB.'));
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function deletePdfBlobLocal(docId: string): Promise<void> {
  try {
    const db = await openPdfDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(docId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Erreur suppression IndexedDB.'));
    });
    db.close();
  } catch {
    // Ignore storage cleanup failures
  }
}

export async function extractPdfContent(fileOrBlob: Blob): Promise<ExtractedPdfContent> {
  const buffer = await fileOrBlob.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdfDoc = await loadingTask.promise;
  const pageCount = Math.max(1, pdfDoc.numPages);
  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let currentLine = '';
    let lastY: number | null = null;

    for (const item of content.items) {
      if (!('str' in item)) continue;
      const textItem = item as { str: string; transform?: number[]; hasEOL?: boolean };
      const y = Array.isArray(textItem.transform) ? Math.round(textItem.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = textItem.str;
      } else {
        currentLine += (currentLine && !currentLine.endsWith(' ') && !textItem.str.startsWith(' ') ? ' ' : '') + textItem.str;
      }
      if (textItem.hasEOL) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = '';
      }
      lastY = y;
    }
    if (currentLine.trim()) lines.push(currentLine.trim());

    const pageText = lines.join('\n').trim();
    pages.push(
      pageText ||
        `[Page ${pageNum}] Aucun texte sélectionnable détecté (document scanné ou image). Utilisez la vue visuelle PDF ou ajoutez vos notes de lecture ci-contre.`
    );
  }

  const formattedPages = pages.map((text, idx) => `--- Page ${idx + 1} ---\n${text}`);
  const joined = formattedPages.join('\n\n').slice(0, 34500);

  return {
    pageCount,
    pages,
    fullText:
      joined.trim() ||
      'Document PDF importé. Aucun texte brut extrait automatiquement.',
  };
}

export async function renderPdfBlobPageToCanvas(
  blob: Blob,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.35
): Promise<{ numPages: number }> {
  const buffer = await blob.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdfDoc = await loadingTask.promise;
  const safePage = Math.min(Math.max(1, pageNumber), pdfDoc.numPages);
  const page = await pdfDoc.getPage(safePage);
  const viewport = page.getViewport({ scale });

  const ctx = canvas.getContext('2d');
  if (!ctx) return { numPages: pdfDoc.numPages };

  const outputScale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
  }).promise;

  return { numPages: pdfDoc.numPages };
}

export function splitExtractedTextByPages(extractedText: string): string[] {
  const markerRegex = /^--- Page \d+ ---$/m;
  if (!markerRegex.test(extractedText)) {
    return [extractedText];
  }
  const segments = extractedText
    .split(/--- Page \d+ ---\n?/)
    .map((s) => s.trim())
    .filter(Boolean);
  return segments.length > 0 ? segments : [extractedText];
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportReadableNotesPdf({
  title,
  category,
  extractedText,
  agentNotes,
  fileName,
}: {
  title: string;
  category: string;
  extractedText: string;
  agentNotes: string;
  fileName: string;
}): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 14;
  const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
  let y = 18;

  const sanitize = (str: string) =>
    String(str ?? '')
      .replace(/[\u2018\u2019\u02BC]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u0153/g, 'oe')
      .replace(/\u0152/g, 'OE');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(sanitize(title), margin, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(sanitize(`Categorie : ${category} | Export Base de connaissances ZentraDesk`), margin, y);
  y += 8;

  if (agentNotes.trim()) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(sanitize("Notes d'amelioration helpdesk"), margin, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const noteLines = doc.splitTextToSize(sanitize(agentNotes), maxWidth);
    for (const line of noteLines) {
      if (y > 278) {
        doc.addPage();
        y = 18;
      }
      doc.text(line, margin, y);
      y += 4.5;
    }
    y += 6;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(sanitize('Contenu documentaire'), margin, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const bodyLines = doc.splitTextToSize(sanitize(extractedText.slice(0, 18000)), maxWidth);
  for (const line of bodyLines) {
    if (y > 280) {
      doc.addPage();
      y = 18;
    }
    doc.text(line, margin, y);
    y += 4.3;
  }

  const outName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  doc.save(outName);
}

export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Ko';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}
