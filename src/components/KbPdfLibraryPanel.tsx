import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  BookOpen,
  BookPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  FileUp,
  Highlighter,
  Maximize2,
  Minimize2,
  NotebookPen,
  Search,
  Sparkles,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AppLocale,
  KbArticle,
  KbArticleType,
  KbPdfContributionStatus,
  KbPdfDocument,
} from '../types/helpdesk';
import { LOCALE_OPTIONS } from '../lib/i18n';
import { recordAuditLog } from '../lib/kbSuggestions';
import { clampInt, clampString, clampTags } from '../lib/validation';
import {
  deletePdfBlobLocal,
  exportReadableNotesPdf,
  extractPdfContent,
  formatBytesCompact,
  getPdfBlobLocal,
  renderPdfBlobPageToCanvas,
  savePdfBlobLocal,
  splitExtractedTextByPages,
  triggerBlobDownload,
} from '../lib/pdfLibrary';

interface KbPdfLibraryPanelProps {
  uid: string;
  currentUserName: string;
  locale: AppLocale;
  pdfDocuments: KbPdfDocument[];
  kbArticles: KbArticle[];
  onOpenKbArticle: (articleId: string) => void;
}

const STATUS_LABELS: Record<KbPdfContributionStatus, string> = {
  to_review: 'À lire / Analyser',
  drafting: 'Notes en cours',
  integrated: 'Intégré à la KB',
};

export const KbPdfLibraryPanel: React.FC<KbPdfLibraryPanelProps> = ({
  uid,
  currentUserName,
  locale,
  pdfDocuments,
  kbArticles,
  onOpenKbArticle,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachFileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | KbPdfContributionStatus>('all');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Reader Mode State
  const [readerViewMode, setReaderViewMode] = useState<'text' | 'visual'>('text');
  const [readerExpanded, setReaderExpanded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomScale, setZoomScale] = useState(1.2);
  const [textFontSize, setTextFontSize] = useState<'sm' | 'base' | 'lg'>('sm');
  const [readerSearch, setReaderSearch] = useState('');
  const [localPdfBlob, setLocalPdfBlob] = useState<Blob | null>(null);
  const [renderingPage, setRenderingPage] = useState(false);

  // Agent Notes & KB Enrichment State
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSavedNotice, setNotesSavedNotice] = useState<string | null>(null);

  // Convert PDF -> New KB Article / Enrich Existing KB Article
  const [kbActionMode, setKbActionMode] = useState<'none' | 'create' | 'enrich'>('none');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [kbDraftError, setKbDraftError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftCategory, setDraftCategory] = useState('Utilisation plateforme');
  const [draftLang, setDraftLang] = useState<AppLocale>(locale);
  const [draftType, setDraftType] = useState<KbArticleType>('guide');
  const [draftTags, setDraftTags] = useState('');
  const [targetExistingId, setTargetExistingId] = useState(kbArticles[0]?.id || '');
  const [enrichSnippet, setEnrichSnippet] = useState('');
  const [publishingToKb, setPublishingToKb] = useState(false);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return pdfDocuments.filter((docItem) => {
      if (statusFilter !== 'all' && docItem.kbContributionStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        docItem.title.toLowerCase().includes(q) ||
        docItem.fileName.toLowerCase().includes(q) ||
        docItem.category.toLowerCase().includes(q) ||
        docItem.extractedText.toLowerCase().includes(q) ||
        docItem.tags.some((tg) => tg.toLowerCase().includes(q))
      );
    });
  }, [pdfDocuments, searchQuery, statusFilter]);

  const activeDoc = useMemo(() => {
    if (selectedDocId) {
      const found = pdfDocuments.find((d) => d.id === selectedDocId);
      if (found) return found;
    }
    return filteredDocs[0] ?? pdfDocuments[0] ?? null;
  }, [filteredDocs, pdfDocuments, selectedDocId]);

  const activeDocPages = useMemo(() => {
    if (!activeDoc) return [] as string[];
    return splitExtractedTextByPages(activeDoc.extractedText);
  }, [activeDoc]);

  // Sync local draft & IndexedDB PDF binary when active document changes
  useEffect(() => {
    if (!activeDoc) {
      setNotesDraft('');
      setLocalPdfBlob(null);
      setCurrentPage(1);
      return;
    }
    setNotesDraft(activeDoc.agentNotes || '');
    setCurrentPage(Math.min(Math.max(1, activeDoc.lastReadPage || 1), Math.max(1, activeDoc.pageCount || 1)));
    setKbActionMode('none');
    setNotesSavedNotice(null);
    setKbDraftError(null);

    let cancelled = false;
    getPdfBlobLocal(activeDoc.id).then((blob) => {
      if (cancelled) return;
      setLocalPdfBlob(blob);
      if (!blob && readerViewMode === 'visual') {
        setReaderViewMode('text');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeDoc?.id]);

  // Render visual PDF page to canvas when in visual mode
  useEffect(() => {
    if (readerViewMode !== 'visual' || !localPdfBlob || !canvasRef.current) return;
    let cancelled = false;
    setRenderingPage(true);
    renderPdfBlobPageToCanvas(localPdfBlob, currentPage, canvasRef.current, zoomScale)
      .catch(() => {
        if (!cancelled) setReaderViewMode('text');
      })
      .finally(() => {
        if (!cancelled) setRenderingPage(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentPage, localPdfBlob, readerViewMode, zoomScale]);

  const metrics = useMemo(() => {
    const total = pdfDocuments.length;
    const integrated = pdfDocuments.filter((d) => d.kbContributionStatus === 'integrated').length;
    const totalPages = pdfDocuments.reduce((sum, d) => sum + (d.pageCount || 0), 0);
    const avgProgress =
      total > 0
        ? Math.round(pdfDocuments.reduce((sum, d) => sum + (d.readingProgressPct || 0), 0) / total)
        : 0;
    return { total, integrated, totalPages, avgProgress };
  }, [pdfDocuments]);

  const handleUploadPdfFile = async (file: File) => {
    setUploadError(null);
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setUploadError('Veuillez sélectionner un fichier au format PDF (.pdf).');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setUploadError('Le fichier dépasse la limite recommandée de 25 Mo.');
      return;
    }

    setUploading(true);
    try {
      const extracted = await extractPdfContent(file);
      const baseTitle = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || 'Document technique PDF';

      const docRef = await addDoc(collection(db, 'kbPdfDocuments'), {
        title: clampString(baseTitle, 200),
        fileName: clampString(file.name, 240),
        fileSizeBytes: Math.max(0, Math.round(file.size)),
        pageCount: clampInt(extracted.pageCount, 1, 5000),
        category: 'Procédure & Runbook',
        language: locale,
        tags: clampTags(['pdf', 'documentation', 'support']),
        extractedText: clampString(extracted.fullText, 35000, 'Document PDF importé.'),
        agentNotes: '',
        readingProgressPct: Math.round((1 / Math.max(1, extracted.pageCount)) * 100),
        lastReadPage: 1,
        kbContributionStatus: 'to_review',
        uploadedBy: clampString(currentUserName, 120, 'Agent Helpdesk'),
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await savePdfBlobLocal(docRef.id, file);
      setLocalPdfBlob(file);
      setSelectedDocId(docRef.id);
      setReaderViewMode('visual');
      setCurrentPage(1);

      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'agent',
        action: 'PDF sauvegardé dans la bibliothèque KB',
        category: 'kb',
        targetLabel: clampString(file.name, 180),
        details: `${extracted.pageCount} page(s) · ${formatBytesCompact(file.size)}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Impossible de lire ce fichier PDF.';
      setUploadError(msg);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.CREATE, 'kbPdfDocuments');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleAttachOriginalBinary = async (file: File) => {
    if (!activeDoc) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') return;
    await savePdfBlobLocal(activeDoc.id, file);
    setLocalPdfBlob(file);
    setReaderViewMode('visual');
  };

  const handleChangePage = async (nextPage: number) => {
    if (!activeDoc) return;
    const total = Math.max(1, activeDoc.pageCount || activeDocPages.length || 1);
    const bounded = Math.min(Math.max(1, nextPage), total);
    setCurrentPage(bounded);
    const pct = clampInt(Math.round((bounded / total) * 100), 0, 100);
    try {
      await updateDoc(doc(db, 'kbPdfDocuments', activeDoc.id), {
        lastReadPage: bounded,
        readingProgressPct: Math.max(activeDoc.readingProgressPct || 0, pct),
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-blocking progress sync
    }
  };

  const handleSaveNotes = async () => {
    if (!activeDoc) return;
    setSavingNotes(true);
    setNotesSavedNotice(null);
    try {
      const nextStatus: KbPdfContributionStatus =
        activeDoc.kbContributionStatus === 'integrated'
          ? 'integrated'
          : notesDraft.trim().length > 0
          ? 'drafting'
          : 'to_review';

      await updateDoc(doc(db, 'kbPdfDocuments', activeDoc.id), {
        agentNotes: clampString(notesDraft, 4000, ''),
        kbContributionStatus: nextStatus,
        updatedAt: serverTimestamp(),
      });
      setNotesSavedNotice('Notes de lecture sauvegardées dans votre bibliothèque.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `kbPdfDocuments/${activeDoc.id}`);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleAppendCurrentPageToNotes = () => {
    const pageContent = activeDocPages[currentPage - 1] || activeDoc?.extractedText || '';
    if (!pageContent.trim()) return;
    const snippet = pageContent.slice(0, 600).trim();
    const block = `[Extrait Page ${currentPage}]\n${snippet}`;
    setNotesDraft((prev) => (prev.trim() ? `${prev.trim()}\n\n${block}` : block));
  };

  const handleDownloadSavedPdf = () => {
    if (!activeDoc) return;
    if (localPdfBlob) {
      triggerBlobDownload(localPdfBlob, activeDoc.fileName);
      return;
    }
    exportReadableNotesPdf({
      title: activeDoc.title,
      category: activeDoc.category,
      extractedText: activeDoc.extractedText,
      agentNotes: notesDraft || activeDoc.agentNotes,
      fileName: activeDoc.fileName,
    });
  };

  const handleDeletePdfDoc = async (docItem: KbPdfDocument) => {
    try {
      await deleteDoc(doc(db, 'kbPdfDocuments', docItem.id));
      await deletePdfBlobLocal(docItem.id);
      if (selectedDocId === docItem.id) {
        setSelectedDocId(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `kbPdfDocuments/${docItem.id}`);
    }
  };

  const openManualKbCreate = () => {
    if (!activeDoc) return;
    setKbDraftError(null);
    setDraftTitle(activeDoc.title);
    setDraftSummary(`Guide issu de la documentation PDF « ${activeDoc.fileName} ».`);
    setDraftBody(
      [
        notesDraft.trim() ? `### Points clés retenus\n${notesDraft.trim()}` : '',
        `### Procédure issue du document (${activeDoc.fileName})\n${activeDoc.extractedText.slice(0, 3200)}`,
      ]
        .filter(Boolean)
        .join('\n\n')
    );
    setDraftCategory(activeDoc.category);
    setDraftLang(activeDoc.language);
    setDraftType('guide');
    setDraftTags(activeDoc.tags.join(', '));
    setKbActionMode('create');
  };

  const handleGenerateAiKbDraft = async () => {
    if (!activeDoc) return;
    setKbDraftError(null);
    setAiGenerating(true);
    setKbActionMode('create');
    try {
      const response = await fetch('/api/ai/pdf-to-kb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: activeDoc.title,
          category: activeDoc.category,
          language: activeDoc.language,
          extractedText: activeDoc.extractedText,
          agentNotes: notesDraft || activeDoc.agentNotes,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Échec de la synthèse IA.');
      }
      setDraftTitle(String(data.title || activeDoc.title));
      setDraftSummary(String(data.summary || ''));
      setDraftBody(String(data.body || ''));
      setDraftCategory(String(data.category || activeDoc.category));
      setDraftType(
        data.articleType === 'faq' || data.articleType === 'article' ? data.articleType : 'guide'
      );
      setDraftTags(Array.isArray(data.tags) ? data.tags.join(', ') : activeDoc.tags.join(', '));
    } catch (err) {
      setKbDraftError(
        err instanceof Error
          ? `${err.message} — Vous pouvez compléter manuellement le brouillon ci-dessous.`
          : 'Synthèse IA indisponible — mode édition manuelle activé.'
      );
      openManualKbCreate();
    } finally {
      setAiGenerating(false);
    }
  };

  const handlePublishNewKbArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDoc || !draftTitle.trim() || !draftBody.trim()) return;
    setPublishingToKb(true);
    try {
      const tagsList = clampTags(
        draftTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      );
      const createdArticle = await addDoc(collection(db, 'kbArticles'), {
        title: clampString(draftTitle, 200),
        summary: clampString(draftSummary || draftBody.slice(0, 180), 500),
        body: clampString(draftBody, 6000),
        category: clampString(draftCategory, 100, 'Utilisation plateforme'),
        language: draftLang,
        articleType: draftType,
        tags: tagsList.length > 0 ? tagsList : ['pdf', 'guide'],
        published: true,
        viewsCount: 1,
        deflectionsCount: 0,
        helpfulCount: 0,
        authorName: clampString(currentUserName, 120, 'Support Lead'),
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'kbPdfDocuments', activeDoc.id), {
        agentNotes: clampString(notesDraft, 4000, ''),
        kbContributionStatus: 'integrated',
        linkedKbArticleId: createdArticle.id,
        linkedKbArticleTitle: clampString(draftTitle, 200),
        updatedAt: serverTimestamp(),
      });

      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'agent',
        action: 'Article KB créé depuis un PDF',
        category: 'kb',
        targetLabel: clampString(draftTitle, 180),
        details: `Source PDF : ${activeDoc.fileName}`,
      });

      setKbActionMode('none');
      setNotesSavedNotice('Nouvel article publié dans la Base de connaissances !');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'kbArticles');
    } finally {
      setPublishingToKb(false);
    }
  };

  const openEnrichExistingKb = () => {
    if (!activeDoc) return;
    const defaultTarget = kbArticles[0]?.id || '';
    setTargetExistingId(defaultTarget);
    const snippetSource =
      notesDraft.trim() ||
      (activeDocPages[currentPage - 1] || activeDoc.extractedText).slice(0, 1000).trim();
    setEnrichSnippet(
      `Complément issu du PDF « ${activeDoc.title} » :\n${snippetSource}`
    );
    setKbActionMode('enrich');
  };

  const handleEnrichExistingKb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDoc || !targetExistingId || !enrichSnippet.trim()) return;
    const targetArticle = kbArticles.find((a) => a.id === targetExistingId);
    if (!targetArticle) return;

    setPublishingToKb(true);
    try {
      const mergedBody = clampString(`${targetArticle.body}\n\n${enrichSnippet.trim()}`, 6000);
      await updateDoc(doc(db, 'kbArticles', targetArticle.id), {
        body: mergedBody,
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'kbPdfDocuments', activeDoc.id), {
        agentNotes: clampString(notesDraft, 4000, ''),
        kbContributionStatus: 'integrated',
        linkedKbArticleId: targetArticle.id,
        linkedKbArticleTitle: clampString(targetArticle.title, 200),
        updatedAt: serverTimestamp(),
      });

      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'agent',
        action: 'Article KB enrichi depuis lecteur PDF',
        category: 'kb',
        targetLabel: targetArticle.title,
        details: `Ajout issu de ${activeDoc.fileName}`,
      });

      setKbActionMode('none');
      setNotesSavedNotice(`Article « ${targetArticle.title} » enrichi avec succès !`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `kbArticles/${targetArticle.id}`);
    } finally {
      setPublishingToKb(false);
    }
  };

  const currentPageText = activeDocPages[currentPage - 1] || activeDoc?.extractedText || '';

  return (
    <div className="space-y-5">
      {/* Top Upload Dropzone & KPI Strip */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) void handleUploadPdfFile(dropped);
          }}
          className={`xl:col-span-7 bg-white dark:bg-slate-900 border-2 border-dashed rounded-xl p-5 flex flex-wrap items-center justify-between gap-4 transition-colors ${
            dragActive
              ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30'
              : 'border-slate-300 dark:border-slate-700'
          }`}
        >
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 shrink-0">
              <FileUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Sauvegarder et lire un PDF pour améliorer la Base de connaissances
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Déposez un manuel technique, runbook ou procédure PDF : le texte est indexé pour la lecture, annoté puis transformé en article KB.
              </p>
              {uploadError && (
                <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                  {uploadError}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUploadPdfFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{uploading ? 'Analyse du PDF...' : 'Importer un PDF'}</span>
            </button>
          </div>
        </div>

        <div className="xl:col-span-5 grid grid-cols-3 gap-3">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">PDF sauvegardés</p>
            <p className="mt-1 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {metrics.total}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {metrics.totalPages} pages
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Intégrés à la KB</p>
            <p className="mt-1 font-display text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {metrics.integrated}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Articles enrichis</p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Lecture moyenne</p>
            <p className="mt-1 font-display text-2xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400">
              {metrics.avgProgress}%
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Progression équipe</p>
          </div>
        </div>
      </div>

      {/* Main Split View: Library List + Reader & KB Studio */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {!readerExpanded && (
          <div className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Documents sauvegardés ({filteredDocs.length})
                </h3>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher dans les PDF ou le texte..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as 'all' | KbPdfContributionStatus)
                }
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value="all">Tous les statuts d’enrichissement</option>
                <option value="to_review">À lire / Analyser</option>
                <option value="drafting">Notes en cours</option>
                <option value="integrated">Intégré à la KB</option>
              </select>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 overflow-y-auto max-h-[640px]">
              {filteredDocs.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <FileText className="w-7 h-7 text-slate-400 mx-auto" />
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Aucun document PDF trouvé
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Importez un PDF ci-dessus pour démarrer votre bibliothèque de lecture.
                  </p>
                </div>
              ) : (
                filteredDocs.map((docItem) => {
                  const isSelected = activeDoc?.id === docItem.id;
                  const statusTone =
                    docItem.kbContributionStatus === 'integrated'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : docItem.kbContributionStatus === 'drafting'
                      ? 'text-blue-700 dark:text-blue-400'
                      : 'text-amber-700 dark:text-amber-400';

                  return (
                    <button
                      key={docItem.id}
                      type="button"
                      onClick={() => setSelectedDocId(docItem.id)}
                      className={`w-full text-left p-4 transition-colors cursor-pointer block ${
                        isSelected
                          ? 'bg-blue-50/70 dark:bg-blue-950/35 ring-1 ring-inset ring-blue-200 dark:ring-blue-800'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] mb-1">
                        <span className="font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {docItem.language} · {docItem.pageCount} p.
                        </span>
                        <span className={`font-semibold ${statusTone}`}>
                          {STATUS_LABELS[docItem.kbContributionStatus]}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-1">
                        {docItem.title}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="truncate max-w-[180px]">{docItem.fileName}</span>
                        <span className="font-mono tabular-nums">
                          {formatBytesCompact(docItem.fileSizeBytes)} · {docItem.readingProgressPct}%
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Right: Dual PDF Reader & KB Enrichment Workspace */}
        <div
          className={`${
            readerExpanded ? 'xl:col-span-12' : 'xl:col-span-8'
          } bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4`}
        >
          {!activeDoc ? (
            <div className="py-16 text-center space-y-2">
              <BookOpen className="w-9 h-9 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Sélectionnez ou importez un PDF pour ouvrir le mode lecture
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Vous pourrez lire page par page, annoter vos observations et enrichir la Base de connaissances.
              </p>
            </div>
          ) : (
            <>
              {/* Document Header & Reader Controls */}
              <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-mono font-semibold uppercase">
                      PDF · {activeDoc.language}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                      {activeDoc.category}
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {activeDoc.pageCount} page(s) · {formatBytesCompact(activeDoc.fileSizeBytes)}
                    </span>
                    {activeDoc.linkedKbArticleId && activeDoc.linkedKbArticleTitle && (
                      <button
                        type="button"
                        onClick={() => onOpenKbArticle(activeDoc.linkedKbArticleId!)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-semibold hover:underline cursor-pointer"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Voir l’article : {activeDoc.linkedKbArticleTitle}</span>
                      </button>
                    )}
                  </div>
                  <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                    {activeDoc.title}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Sauvegardé par {activeDoc.uploadedBy} · Fichier :{' '}
                    <span className="font-mono">{activeDoc.fileName}</span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleDownloadSavedPdf}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-blue-600" />
                    <span>Sauvegarder PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setReaderExpanded((prev) => !prev)}
                    title={readerExpanded ? 'Réduire le lecteur' : 'Agrandir le lecteur'}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {readerExpanded ? (
                      <Minimize2 className="w-3.5 h-3.5" />
                    ) : (
                      <Maximize2 className="w-3.5 h-3.5" />
                    )}
                    <span>{readerExpanded ? 'Vue liste' : 'Mode lecture large'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeletePdfDoc(activeDoc)}
                    title="Supprimer ce PDF de la bibliothèque"
                    className="p-1.5 border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Reader Toolbar: Mode Switch + Pagination */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setReaderViewMode('text')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      readerViewMode === 'text'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Lecture texte structurée</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (localPdfBlob) setReaderViewMode('visual');
                      else attachFileInputRef.current?.click();
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      readerViewMode === 'visual'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{localPdfBlob ? 'Aperçu PDF original' : 'Lier le fichier PDF local'}</span>
                  </button>
                  <input
                    ref={attachFileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleAttachOriginalBinary(f);
                      e.target.value = '';
                    }}
                  />
                </div>

                {/* Page Navigation & Zoom / Font Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  {readerViewMode === 'visual' ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setZoomScale((z) => Math.max(0.7, Number((z - 0.15).toFixed(2))))}
                        className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 cursor-pointer"
                        title="Zoom arrière"
                      >
                        <ZoomOut className="w-3.5 h-3.5" />
                      </button>
                      <span className="font-mono text-[11px] px-1.5 text-slate-600 dark:text-slate-300">
                        {Math.round(zoomScale * 100)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setZoomScale((z) => Math.min(2.2, Number((z + 0.15).toFixed(2))))}
                        className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 cursor-pointer"
                        title="Zoom avant"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      {(['sm', 'base', 'lg'] as const).map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => setTextFontSize(sz)}
                          className={`px-2 py-1 rounded text-[11px] font-mono cursor-pointer ${
                            textFontSize === sz
                              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {sz === 'sm' ? 'A-' : sz === 'base' ? 'A' : 'A+'}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200 dark:border-slate-700">
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() => handleChangePage(currentPage - 1)}
                      className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono tabular-nums text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Page {currentPage} / {Math.max(1, activeDoc.pageCount || activeDocPages.length)}
                    </span>
                    <button
                      type="button"
                      disabled={currentPage >= Math.max(1, activeDoc.pageCount || activeDocPages.length)}
                      onClick={() => handleChangePage(currentPage + 1)}
                      className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Dual Reader Body + Notes / KB Enrichment */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Reader Surface */}
                <div className="lg:col-span-7 space-y-3">
                  {readerViewMode === 'visual' && localPdfBlob ? (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-100 dark:bg-slate-950 p-4 overflow-auto max-h-[500px] flex flex-col items-center">
                      {renderingPage && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                          Rendu de la page {currentPage}...
                        </p>
                      )}
                      <canvas
                        ref={canvasRef}
                        className="rounded shadow-sm bg-white max-w-full h-auto"
                      />
                    </div>
                  ) : (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="relative flex-1 min-w-[180px]">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={readerSearch}
                            onChange={(e) => setReaderSearch(e.target.value)}
                            placeholder="Rechercher un terme dans cette page..."
                            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handleAppendCurrentPageToNotes}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Highlighter className="w-3.5 h-3.5 text-amber-600" />
                          <span>Extraire vers notes</span>
                        </button>
                      </div>

                      <div
                        className={`max-h-[420px] overflow-y-auto pr-2 leading-relaxed whitespace-pre-wrap text-slate-800 dark:text-slate-200 ${
                          textFontSize === 'lg'
                            ? 'text-base'
                            : textFontSize === 'base'
                            ? 'text-sm'
                            : 'text-xs'
                        }`}
                      >
                        {readerSearch.trim()
                          ? currentPageText
                              .split(new RegExp(`(${readerSearch.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
                              .map((part, idx) =>
                                part.toLowerCase() === readerSearch.trim().toLowerCase() ? (
                                  <mark
                                    key={idx}
                                    className="bg-amber-200 dark:bg-amber-800 text-slate-900 dark:text-slate-100 px-0.5 rounded"
                                  >
                                    {part}
                                  </mark>
                                ) : (
                                  <React.Fragment key={idx}>{part}</React.Fragment>
                                )
                              )
                          : currentPageText}
                      </div>
                    </div>
                  )}
                </div>

                {/* Notes & KB Contribution Studio */}
                <div className="lg:col-span-5 space-y-3">
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 bg-slate-50/50 dark:bg-slate-950/40">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <NotebookPen className="w-4 h-4 text-blue-600" />
                        <h4 className="font-display text-xs font-bold text-slate-900 dark:text-slate-100">
                          Notes de lecture &amp; amélioration KB
                        </h4>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {activeDoc.readingProgressPct}% lu
                      </span>
                    </div>

                    <textarea
                      rows={7}
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder="Notez ici les étapes de résolution, points de vigilance ou corrections à publier dans la Base de connaissances..."
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                    />

                    {notesSavedNotice && (
                      <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-[11px] text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{notesSavedNotice}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={savingNotes}
                        onClick={handleSaveNotes}
                        className="px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 disabled:opacity-50 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {savingNotes ? 'Sauvegarde...' : 'Sauvegarder notes'}
                      </button>
                    </div>

                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                      <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        Transformer cette lecture en amélioration KB :
                      </p>

                      <div className="grid grid-cols-1 gap-2">
                        <button
                          type="button"
                          disabled={aiGenerating}
                          onClick={handleGenerateAiKbDraft}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>
                            {aiGenerating
                              ? 'Synthèse IA en cours...'
                              : 'Synthèse IA → Nouvel article KB'}
                          </span>
                        </button>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={openManualKbCreate}
                            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-lg whitespace-nowrap cursor-pointer"
                          >
                            <BookPlus className="w-3.5 h-3.5 text-blue-600" />
                            <span>Rédiger article</span>
                          </button>

                          <button
                            type="button"
                            disabled={kbArticles.length === 0}
                            onClick={openEnrichExistingKb}
                            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-lg whitespace-nowrap cursor-pointer"
                          >
                            <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Enrichir existant</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Panel: Create New KB Article from PDF */}
              {kbActionMode === 'create' && (
                <form
                  onSubmit={handlePublishNewKbArticle}
                  className="border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      Publier un nouvel article KB depuis ce PDF
                    </h4>
                    <button
                      type="button"
                      onClick={() => setKbActionMode('none')}
                      className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                    >
                      Fermer
                    </button>
                  </div>

                  {kbDraftError && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">{kbDraftError}</p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    <label className="md:col-span-2 block space-y-1">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Titre de l’article KB
                      </span>
                      <input
                        type="text"
                        required
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Format &amp; Langue
                      </span>
                      <div className="grid grid-cols-2 gap-1.5">
                        <select
                          value={draftType}
                          onChange={(e) => setDraftType(e.target.value as KbArticleType)}
                          className="px-2 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                        >
                          <option value="guide">Guide</option>
                          <option value="faq">FAQ</option>
                          <option value="article">Article</option>
                        </select>
                        <select
                          value={draftLang}
                          onChange={(e) => setDraftLang(e.target.value as AppLocale)}
                          className="px-2 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                        >
                          {LOCALE_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.short}
                            </option>
                          ))}
                        </select>
                      </div>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Résumé court
                      </span>
                      <input
                        type="text"
                        value={draftSummary}
                        onChange={(e) => setDraftSummary(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Catégorie &amp; Mots-clés
                      </span>
                      <div className="grid grid-cols-2 gap-1.5">
                        <input
                          type="text"
                          value={draftCategory}
                          onChange={(e) => setDraftCategory(e.target.value)}
                          className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                        />
                        <input
                          type="text"
                          value={draftTags}
                          onChange={(e) => setDraftTags(e.target.value)}
                          placeholder="tag1, tag2"
                          className="px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                        />
                      </div>
                    </label>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Contenu structuré pour la Base de connaissances
                    </span>
                    <textarea
                      rows={6}
                      required
                      value={draftBody}
                      onChange={(e) => setDraftBody(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                    />
                  </label>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setKbActionMode('none')}
                      className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      disabled={publishingToKb}
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      {publishingToKb ? 'Publication...' : 'Publier dans la Base de connaissances'}
                    </button>
                  </div>
                </form>
              )}

              {/* Action Panel: Enrich Existing KB Article */}
              {kbActionMode === 'enrich' && (
                <form
                  onSubmit={handleEnrichExistingKb}
                  className="border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      Enrichir un article KB existant à partir de ce PDF
                    </h4>
                    <button
                      type="button"
                      onClick={() => setKbActionMode('none')}
                      className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                    >
                      Fermer
                    </button>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Article cible à compléter
                    </span>
                    <select
                      value={targetExistingId}
                      onChange={(e) => setTargetExistingId(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                    >
                      {kbArticles.map((art) => (
                        <option key={art.id} value={art.id}>
                          [{art.language.toUpperCase()}] {art.title}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Section ajoutée à la suite de l’article
                    </span>
                    <textarea
                      rows={5}
                      required
                      value={enrichSnippet}
                      onChange={(e) => setEnrichSnippet(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                    />
                  </label>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setKbActionMode('none')}
                      className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      disabled={publishingToKb}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      {publishingToKb ? 'Mise à jour...' : 'Ajouter à l’article KB'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
