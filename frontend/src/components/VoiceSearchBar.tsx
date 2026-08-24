'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send, Volume2, Languages } from 'lucide-react';

interface Props {
  language: 'hi' | 'en';
  onLanguageChange: (lang: 'hi' | 'en') => void;
  onSubmit: (text: string) => void;
  busy?: boolean;
  lastReply?: string;
}

// Web Speech API is not in the standard TS DOM lib.
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

const PROMPTS: Record<'hi' | 'en', string[]> = {
  hi: ['क्या आज छिड़काव करूँ?', 'गेहूँ का भाव क्या है?', 'पत्ती पीली हो रही है', 'PM-KISAN की किस्त कब आएगी?'],
  en: ['Should I spray today?', 'What is the wheat rate?', 'My leaves are turning yellow', 'When is the PM-KISAN instalment?'],
};

export default function VoiceSearchBar({ language, onLanguageChange, onSubmit, busy, lastReply }: Props) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    const rec: SpeechRecognitionLike = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setText(transcript);
      const isFinal = event.results[event.results.length - 1]?.isFinal;
      if (isFinal && transcript.trim()) {
        setListening(false);
        onSubmit(transcript.trim());
        setText('');
      }
    };

    rec.onerror = (e: any) => {
      setListening(false);
      const map: Record<string, string> = {
        'no-speech': language === 'hi' ? 'आवाज़ सुनाई नहीं दी, दोबारा बोलें।' : 'No speech detected, please try again.',
        'not-allowed': language === 'hi' ? 'माइक की अनुमति दें।' : 'Please allow microphone access.',
        network: language === 'hi' ? 'नेटवर्क कमज़ोर है — टाइप करके पूछें।' : 'Network is weak — please type instead.',
      };
      setError(map[e?.error] ?? (language === 'hi' ? 'माइक काम नहीं कर रहा।' : 'Microphone unavailable.'));
    };

    rec.onend = () => setListening(false);
    recognitionRef.current = rec;

    return () => {
      try { rec.abort(); } catch { /* noop */ }
    };
  }, [language, onSubmit]);

  const toggleMic = useCallback(() => {
    setError(null);
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) {
      rec.stop();
      setListening(false);
      return;
    }
    rec.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    try {
      rec.start();
      setListening(true);
    } catch {
      setError(language === 'hi' ? 'माइक शुरू नहीं हुआ।' : 'Could not start the microphone.');
    }
  }, [language, listening]);

  const speak = useCallback(() => {
    if (!lastReply || typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(lastReply);
    u.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    u.rate = 0.92;
    window.speechSynthesis.speak(u);
  }, [lastReply, language]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    onSubmit(value);
    setText('');
  };

return (
    <div className="w-full">
      <div className="flex items-center gap-2 rounded-2xl border border-leaf-100 bg-white p-2 shadow-card">
        <button
          type="button"
          onClick={() => onLanguageChange(language === 'hi' ? 'en' : 'hi')}
          className="flex shrink-0 items-center gap-1 rounded-xl bg-leaf-50 px-3 py-2.5 text-sm font-semibold text-leaf-700 transition hover:bg-leaf-100"
          aria-label="Switch language"
        >
          <Languages size={16} />
          {language === 'hi' ? 'हिं' : 'EN'}
        </button>

        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={language === 'hi' ? 'बोलिए या लिखिए…' : 'Speak or type…'}
          className="min-w-0 flex-1 bg-transparent px-1 text-base text-soil-900 outline-none placeholder:text-soil-700/50"
          disabled={busy}
        />

        {lastReply && (
          <button
            type="button"
            onClick={speak}
            className="shrink-0 rounded-xl p-2.5 text-leaf-600 transition hover:bg-leaf-50"
            aria-label="Read the answer aloud"
          >
            <Volume2 size={18} />
          </button>
        )}

        <button
          type="button"
          onClick={toggleMic}
          disabled={!supported || busy}
          className={`relative shrink-0 rounded-xl p-3 transition ${
            listening ? 'bg-alert-600 text-white' : 'bg-leaf-600 text-white hover:bg-leaf-700'
          } disabled:opacity-40`}
          aria-label={listening ? 'Stop listening' : 'Start voice input'}
        >
          {listening && <span className="absolute inset-0 animate-pulseRing rounded-xl bg-alert-400/60" />}
          {supported ? (listening ? <MicOff size={20} /> : <Mic size={20} />) : <MicOff size={20} />}
        </button>

        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || busy}
          className="shrink-0 rounded-xl bg-soil-900 p-3 text-white transition hover:bg-black disabled:opacity-30"
          aria-label="Send"
        >
          <Send size={18} />
        </button>
      </div>

      {listening && (
        <p className="mt-2 animate-slideUp text-center text-sm font-medium text-alert-600">
          {language === 'hi' ? '🎙️ सुन रहा हूँ… बोलिए' : '🎙️ Listening… speak now'}
        </p>
      )}
      {error && <p className="mt-2 text-center text-sm text-alert-600">{error}</p>}
      {!supported && (
        <p className="mt-2 text-center text-xs text-soil-700">
          {language === 'hi'
            ? 'इस ब्राउज़र में आवाज़ काम नहीं करती — कृपया Chrome इस्तेमाल करें या टाइप करें।'
            : 'Voice input is unsupported in this browser — use Chrome or type instead.'}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {PROMPTS[language].map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onSubmit(p)}
            disabled={busy}
            className="rounded-full border border-leaf-100 bg-white px-3 py-1.5 text-xs text-leaf-700 transition hover:bg-leaf-50 disabled:opacity-40"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}