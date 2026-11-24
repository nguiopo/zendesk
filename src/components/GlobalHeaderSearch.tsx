import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Building2,
  Inbox,
  Search,
  X,
} from 'lucide-react';
import {
  CLIENT_HEALTH_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from '../lib/formatters';
import { I18N } from '../lib/i18n';
import { AppLocale, ClientAccount, KbArticle, Ticket } from '../types/helpdesk';

export type GlobalSearchScope = 'all' | 'tickets' | 'clients' | 'kb';

interface GlobalHeaderSearchProps {
  tickets: Ticket[];
  clients: ClientAccount[];
  kbArticles: KbArticle[];
  locale?: AppLocale;
  onSelectTicket: (ticket: Ticket, queryText: string) => void;
  onSelectClient: (client: ClientAccount, queryText: string) => void;
  onSelectArticle: (article: KbArticle, queryText: string) => void;
  onApplyFilterToTab: (scope: 'tickets' | 'clients' | 'kb', queryText: string) => void;
}

type SearchResultItem =
  | { kind: 'ticket'; id: string; item: Ticket }
  | { kind: 'client'; id: string; item: ClientAccount }
  | { kind: 'kb'; id: string; item: KbArticle };

export const GlobalHeaderSearch: React.FC<GlobalHeaderSearchProps> = ({
  tickets,
  clients,
  kbArticles,
  locale = 'fr',
  onSelectTicket,
  onSelectClient,
  onSelectArticle,
  onApplyFilterToTab,
}) => {
  const dict = I18N[locale].search;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<GlobalSearchScope>('all');
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalized = query.trim().toLowerCase();

  const matchedTickets = useMemo(() => {
    if (!normalized) return [];
    return tickets.filter(
      (t) =>
        t.reference.toLowerCase().includes(normalized) ||
        t.subject.toLowerCase().includes(normalized) ||
        t.clientName.toLowerCase().includes(normalized) ||
        t.category.toLowerCase().includes(normalized) ||
        t.description.toLowerCase().includes(normalized) ||
        (t.assignedAgentName || '').toLowerCase().includes(normalized) ||
        t.tags.some((tag) => tag.toLowerCase().includes(normalized))
    );
  }, [tickets, normalized]);

  const matchedClients = useMemo(() => {
    if (!normalized) return [];
    return clients.filter(
      (c) =>
        c.companyName.toLowerCase().includes(normalized) ||
        c.contactName.toLowerCase().includes(normalized) ||
        c.contactEmail.toLowerCase().includes(normalized) ||
        c.contactPhone.toLowerCase().includes(normalized) ||
        c.region.toLowerCase().includes(normalized) ||
        c.tier.toLowerCase().includes(normalized)
    );
  }, [clients, normalized]);

  const matchedArticles = useMemo(() => {
    if (!normalized) return [];
    return kbArticles.filter(
      (a) =>
        a.title.toLowerCase().includes(normalized) ||
        a.summary.toLowerCase().includes(normalized) ||
        a.category.toLowerCase().includes(normalized) ||
        a.body.toLowerCase().includes(normalized) ||
        a.tags.some((tag) => tag.toLowerCase().includes(normalized))
    );
  }, [kbArticles, normalized]);

  const flatResults = useMemo<SearchResultItem[]>(() => {
    const items: SearchResultItem[] = [];
    if (scope === 'all' || scope === 'tickets') {
      const cap = scope === 'all' ? 5 : 10;
      for (const t of matchedTickets.slice(0, cap)) {
        items.push({ kind: 'ticket', id: `tk-${t.id}`, item: t });
      }
    }
    if (scope === 'all' || scope === 'clients') {
      const cap = scope === 'all' ? 4 : 10;
      for (const c of matchedClients.slice(0, cap)) {
        items.push({ kind: 'client', id: `cl-${c.id}`, item: c });
      }
    }
    if (scope === 'all' || scope === 'kb') {
      const cap = scope === 'all' ? 4 : 10;
      for (const a of matchedArticles.slice(0, cap)) {
        items.push({ kind: 'kb', id: `kb-${a.id}`, item: a });
      }
    }
    return items;
  }, [scope, matchedTickets, matchedClients, matchedArticles]);

  const totalMatches = matchedTickets.length + matchedClients.length + matchedArticles.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [normalized, scope]);

  // Ctrl+K / Cmd+K global shortcut to focus header search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const triggerSelection = (entry: SearchResultItem) => {
    setOpen(false);
    if (entry.kind === 'ticket') {
      onSelectTicket(entry.item, query.trim());
    } else if (entry.kind === 'client') {
      onSelectClient(entry.item, entry.item.companyName);
    } else {
      onSelectArticle(entry.item, query.trim());
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open && e.key === 'ArrowDown') {
      setOpen(true);
      return;
    }
    if (flatResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % flatResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + flatResults.length) % flatResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = flatResults[activeIndex] || flatResults[0];
      if (target) triggerSelection(target);
    }
  };

  const renderSectionHeader = (
    label: string,
    count: number,
    targetScope: 'tickets' | 'clients' | 'kb'
  ) => (
    <div className="px-3 py-1.5 bg-slate-50/90 dark:bg-slate-950/60 border-y border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
      <span className="font-semibold text-slate-600 dark:text-slate-300">
        {label} ({count})
      </span>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          onApplyFilterToTab(targetScope, query.trim());
        }}
        className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
      >
        <span>{dict.openInTab}</span>
        <ArrowUpRight className="w-3 h-3" />
      </button>
    </div>
  );

  const visibleTickets =
    scope === 'all' || scope === 'tickets'
      ? matchedTickets.slice(0, scope === 'all' ? 5 : 10)
      : [];
  const visibleClients =
    scope === 'all' || scope === 'clients'
      ? matchedClients.slice(0, scope === 'all' ? 4 : 10)
      : [];
  const visibleArticles =
    scope === 'all' || scope === 'kb'
      ? matchedArticles.slice(0, scope === 'all' ? 4 : 10)
      : [];

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md min-w-[180px]">
      <div className="relative flex items-center">
        <Search
          className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={dict.placeholder}
          aria-label={dict.ariaLabel}
          aria-expanded={open && normalized.length > 0}
          className="w-full pl-9 pr-16 py-1.5 text-xs bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors"
        />

        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label={dict.clearAria}
            className="absolute right-2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <kbd className="hidden sm:inline-block absolute right-2.5 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded pointer-events-none">
            Ctrl+K
          </kbd>
        )}
      </div>

      {/* Live Search Dropdown */}
      {open && normalized.length > 0 && (
        <div
          role="listbox"
          aria-label={dict.resultsAria}
          className="absolute left-0 right-0 sm:min-w-[460px] mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden"
        >
          {/* Scope Filter Tabs */}
          <div className="px-3 py-2 bg-slate-50 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {(
                [
                  ['all', dict.scopeAll, totalMatches],
                  ['tickets', dict.scopeTickets, matchedTickets.length],
                  ['clients', dict.scopeClients, matchedClients.length],
                  ['kb', dict.scopeKb, matchedArticles.length],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setScope(id)}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    scope === id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 font-semibold shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <span>{label}</span>
                  <span className="font-mono tabular-nums opacity-75">({count})</span>
                </button>
              ))}
            </div>

            <span className="hidden sm:inline text-[10px] text-slate-400 dark:text-slate-500 font-mono">
              {dict.navHint}
            </span>
          </div>

          <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {flatResults.length === 0 ? (
              <div className="p-6 text-center space-y-1.5">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {dict.noResults} « {query.trim()} »
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {dict.noResultsHint}
                </p>
              </div>
            ) : (
              <>
                {visibleTickets.length > 0 && (
                  <div>
                    {renderSectionHeader(dict.sectionTickets, matchedTickets.length, 'tickets')}
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                      {visibleTickets.map((ticket) => {
                        const idx = flatResults.findIndex((r) => r.id === `tk-${ticket.id}`);
                        const isActive = idx === activeIndex;
                        return (
                          <button
                            key={ticket.id}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => triggerSelection({ kind: 'ticket', id: `tk-${ticket.id}`, item: ticket })}
                            className={`w-full text-left px-3.5 py-2.5 flex items-start gap-3 transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-blue-50/80 dark:bg-blue-950/40'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <Inbox className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                                  <span className="font-mono text-blue-700 dark:text-blue-400 mr-1.5">
                                    {ticket.reference}
                                  </span>
                                  {ticket.subject}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                {ticket.clientName} · {TICKET_STATUS_LABELS[ticket.status]} ·{' '}
                                {TICKET_PRIORITY_LABELS[ticket.priority]}
                                {ticket.assignedAgentName ? ` · ${ticket.assignedAgentName}` : ''}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {visibleClients.length > 0 && (
                  <div>
                    {renderSectionHeader(dict.sectionClients, matchedClients.length, 'clients')}
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                      {visibleClients.map((client) => {
                        const idx = flatResults.findIndex((r) => r.id === `cl-${client.id}`);
                        const isActive = idx === activeIndex;
                        return (
                          <button
                            key={client.id}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => triggerSelection({ kind: 'client', id: `cl-${client.id}`, item: client })}
                            className={`w-full text-left px-3.5 py-2.5 flex items-start gap-3 transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-blue-50/80 dark:bg-blue-950/40'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <Building2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {client.companyName}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                {client.contactName} · {client.region} ·{' '}
                                {CLIENT_HEALTH_LABELS[client.healthStatus]} · {client.tier}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {visibleArticles.length > 0 && (
                  <div>
                    {renderSectionHeader(dict.sectionKb, matchedArticles.length, 'kb')}
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                      {visibleArticles.map((article) => {
                        const idx = flatResults.findIndex((r) => r.id === `kb-${article.id}`);
                        const isActive = idx === activeIndex;
                        return (
                          <button
                            key={article.id}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => triggerSelection({ kind: 'kb', id: `kb-${article.id}`, item: article })}
                            className={`w-full text-left px-3.5 py-2.5 flex items-start gap-3 transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-blue-50/80 dark:bg-blue-950/40'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <BookOpen className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {article.title}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                {article.category} · {article.language.toUpperCase()} ·{' '}
                                {article.viewsCount} {dict.viewsLabel}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
