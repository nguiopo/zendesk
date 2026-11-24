import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Mic, Square } from 'lucide-react';
import { AppLocale } from '../types/helpdesk';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

interface WindowWithSpeech extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export type DictationLang = 'fr-FR' | 'en-US' | 'es-ES';

interface VoiceDictationModuleProps {
  defaultLocale?: AppLocale;
  onTranscriptAppend: (text: string) => void;
  disabled?: boolean;
  stopSignal?: number;
}

const LOCALE_TO_SPEECH_LANG: Record<AppLocale, DictationLang> = {
  fr: 'fr-FR',
  en: 'en-US',
  es: 'es-ES',
};

const ERROR_MESSAGES_FR: Record<string, string> = {
  'not-allowed': "Accès au microphone refusé. Autorisez le micro dans votre navigateur.",
  'service-not-allowed': "Service de reconnaissance vocale bloqué par le navigateur.",
  'no-speech': "Aucune parole détectée. Parlez plus distinctement près du microphone.",
  'audio-capture': "Aucun microphone détecté sur cet appareil.",
  network: "Erreur réseau lors de la reconnaissance vocale.",
};

export const VoiceDictationModule: React.FC<VoiceDictationModuleProps> = ({
  defaultLocale = 'fr',
  onTranscriptAppend,
  disabled = false,
  stopSignal = 0,
}) => {
  const [speechLang, setSpeechLang] = useState<DictationLang>(
    LOCALE_TO_SPEECH_LANG[defaultLocale] || 'fr-FR'
  );
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const onTranscriptAppendRef = useRef(onTranscriptAppend);
  onTranscriptAppendRef.current = onTranscriptAppend;

  const SpeechCtor = useMemo<SpeechRecognitionConstructor | null>(() => {
    if (typeof window === 'undefined') return null;
    const win = window as WindowWithSpeech;
    return win.SpeechRecognition || win.webkitSpeechRecognition || null;
  }, []);

  const isSupported = Boolean(SpeechCtor);

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors if already stopped
      }
    }
    setIsListening(false);
    setInterimText('');
  };

  useEffect(() => {
    if (stopSignal > 0) {
      stopListening();
    }
  }, [stopSignal]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore cleanup abort errors
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  const handleToggleDictation = () => {
    if (!SpeechCtor || disabled) return;

    if (isListening) {
      stopListening();
      return;
    }

    setErrorMsg(null);
    setInterimText('');

    try {
      const recognition = new SpeechCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = speechLang;

      recognition.onstart = () => {
        setIsListening(true);
        setErrorMsg(null);
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let finalChunk = '';
        let interimChunk = '';

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = result[0]?.transcript || '';
          if (result.isFinal) {
            finalChunk += transcript;
          } else {
            interimChunk += transcript;
          }
        }

        if (finalChunk.trim()) {
          onTranscriptAppendRef.current(finalChunk.trim());
        }
        setInterimText(interimChunk.trim());
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        if (event.error === 'aborted') {
          setIsListening(false);
          setInterimText('');
          return;
        }
        setErrorMsg(
          ERROR_MESSAGES_FR[event.error] ||
            `Erreur de dictée vocale (${event.error || 'inconnue'}).`
        );
        setIsListening(false);
        setInterimText('');
      };

      recognition.onend = () => {
        setIsListening(false);
        setInterimText('');
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setErrorMsg("Impossible de démarrer la reconnaissance vocale sur ce navigateur.");
      setIsListening(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <select
            value={speechLang}
            onChange={(e) => setSpeechLang(e.target.value as DictationLang)}
            disabled={isListening || !isSupported || disabled}
            aria-label="Langue de dictée vocale"
            className="px-2 py-1 text-[11px] font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-700 dark:text-slate-300 disabled:opacity-50"
          >
            <option value="fr-FR">FR</option>
            <option value="en-US">EN</option>
            <option value="es-ES">ES</option>
          </select>

          <button
            type="button"
            onClick={handleToggleDictation}
            disabled={!isSupported || disabled}
            aria-pressed={isListening}
            title={
              !isSupported
                ? "L'API Web Speech n'est pas prise en charge par ce navigateur"
                : isListening
                ? 'Arrêter la dictée vocale'
                : 'Dicter la description par reconnaissance vocale'
            }
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              isListening
                ? 'bg-rose-600 hover:bg-rose-700 border-rose-600 text-white'
                : 'bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
            }`}
          >
            {isListening ? (
              <>
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <Square className="w-3 h-3 fill-current" />
                <span>Arrêter la dictée</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5" />
                <span>Dicter</span>
              </>
            )}
          </button>
        </div>

        {!isSupported && (
          <span className="text-[11px] text-amber-700 dark:text-amber-400">
            Web Speech API non disponible sur ce navigateur
          </span>
        )}
      </div>

      {isListening && (
        <div className="px-2.5 py-1.5 rounded-md bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/60 text-[11px] text-rose-800 dark:text-rose-200 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
          <span className="truncate">
            {interimText
              ? `Transcription en cours : « ${interimText} »`
              : 'Écoute active — parlez pour dicter la description du problème...'}
          </span>
        </div>
      )}

      {errorMsg && (
        <div className="px-2.5 py-1.5 rounded-md bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-900/60 text-[11px] text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
