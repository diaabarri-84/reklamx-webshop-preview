import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../App';
import { formatTime, localeFor } from '../lib/dateFormat';
import { holdReloads } from '../lib/reloadHold';
import { 
  Bot, 
  User, 
  Send, 
  X, 
  MapPin, 
  Maximize2, 
  Minimize2, 
  Trash2, 
  Copy, 
  Check, 
  Printer, 
  FileCheck, 
  Compass, 
  Layers,
  ChevronDown,
  GripHorizontal,
  Move
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { cn } from '../lib/utils';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  groundingChunks?: Array<{
    web?: { uri: string; title: string };
    maps?: { uri: string; title: string; address?: string };
  }>;
}

/**
 * The four starter buttons.
 *
 * BOTH HALVES ARE READ BY A CUSTOMER — the label on the button and the prompt,
 * which is posted as their own message — so both are translated. They used to be
 * English literals in a shop that sells in four languages.
 *
 * AND NONE OF THEM ASKS FOR A GOOGLE LOOKUP ANY MORE. The first was
 * "Find Nearest Print Hubs" in `mode: 'maps'`, which needs grounded Google Maps —
 * a paid capability this shop's key does not have, so the button was a promise
 * that answered "I cannot" every time it was pressed. Pickup and delivery are
 * things the shop itself knows, so the advisor answers them.
 */
const PRESET_PROMPTS = [
  { icon: MapPin, labelKey: 'chatPreset1Label', promptKey: 'chatPreset1Prompt', mode: 'assistant' },
  { icon: Layers, labelKey: 'chatPreset2Label', promptKey: 'chatPreset2Prompt', mode: 'assistant' },
  { icon: FileCheck, labelKey: 'chatPreset3Label', promptKey: 'chatPreset3Prompt', mode: 'assistant' },
  { icon: Printer, labelKey: 'chatPreset4Label', promptKey: 'chatPreset4Prompt', mode: 'complex' },
] as const;

export const GeminiChatbot: React.FC = () => {
  const { t, language } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [mode, setMode] = useState<'assistant' | 'maps' | 'complex'>('assistant');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      // It promised "Finding print hubs & pickup stores via Google Maps" — in
      // English, to every customer, for a lookup this key cannot perform.
      content: t('chatWelcome'),
      timestamp: formatTime(new Date(), localeFor(language)),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // The greeting is created once, at mount, so it kept the language the page
  // happened to open in even after the customer switched. Rewriting only the
  // welcome bubble leaves the conversation itself untouched — what a person
  // already said, and what was already answered, is not retranslated under them.
  useEffect(() => {
    setMessages((prev) =>
      prev.map((m) => (m.id === 'welcome-1' ? { ...m, content: t('chatWelcome') } : m)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  /*
   * THE ASSISTANT HIDES ITSELF WHEN THE SERVER CANNOT ANSWER.
   *
   * The live shop had no AI key for most of its life, so /api/chat answered 503
   * to every question. Since 2026-09-13 the owner can paste a key from Google,
   * OpenAI or Anthropic in the dashboard, so this may now be on — which is
   * exactly why the gate stays: it asks the server rather than assuming either
   * way. The launcher floated in the corner of every page regardless; a
   * customer opened it, read a greeting promising Google-Maps hub lookups, GSM
   * advice and pre-press checks, asked something, and got "the chat assistant
   * is unavailable right now" — every time, on the shop's own front page.
   *
   * /api/health now says whether chat can work, and the widget believes it.
   * `null` means "not asked yet", and nothing is drawn while that is true, so
   * the button never appears and then vanishes. If the check itself fails the
   * answer is no: a launcher that cannot be shown to work is not shown.
   *
   * Put the key on the server and the button comes back on its own — there is
   * nothing else to switch on.
   */
  const [chatAvailable, setChatAvailable] = useState<boolean | null>(null);
  // WHICH SERVICE ANSWERS (round 16): the Maps lookup is Google's alone, the
  // deeper "Pro" mode has nothing deeper to switch to on DeepSeek, and a DeepSeek
  // chat goes to China — which the customer is told here, where he types.
  const [chatProvider, setChatProvider] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setChatAvailable(Boolean(d?.chat));
        setChatProvider(typeof d?.chatProvider === 'string' ? d.chatProvider : null);
      })
      .catch(() => { if (!cancelled) setChatAvailable(false); });
    return () => { cancelled = true; };
  }, []);
  const mapsOffered = chatProvider === 'google';
  const proOffered = chatProvider !== 'deepseek';
  useEffect(() => {
    if ((mode === 'maps' && !mapsOffered) || (mode === 'complex' && !proOffered)) setMode('assistant');
  }, [mode, mapsOffered, proOffered]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  // The shop reloads itself after a deploy on its quiet pages (BuildWatcher) — the
  // home page and the product list among them, where this chat floats. Not while a
  // conversation is open, or a question half-typed: the reload threw it away
  // mid-sentence (code review 2026-10-11, REVIEW-3 #7 / L). Closed, or back to the
  // greeting alone, it holds nothing.
  const conversationOpen = isOpen && (messages.length > 1 || input.trim() !== '');
  useEffect(() => (conversationOpen ? holdReloads() : undefined), [conversationOpen]);

  const handleSend = async (customPrompt?: string, forcedMode?: 'assistant' | 'maps' | 'complex') => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || isLoading) return;

    const currentMode = forcedMode || mode;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: textToSend.trim(),
      timestamp: formatTime(new Date(), localeFor(language)),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setInput('');
    setIsLoading(true);

    try {
      // Prepare history for API
      const conversationHistory = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversationHistory,
          mode: currentMode,
        }),
      });

      // THE BODY IS READ BEFORE THE STATUS IS TRUSTED. This host serves an HTML
      // 502 page of its own, and res.json() on that throws "Unexpected token '<'"
      // — which must not become the bubble a customer reads.
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        // A refused location lookup has its own answer. "The assistant could not
        // answer" is true but unhelpful for someone who asked where to collect
        // an order; this says which part is unavailable.
        throw new Error(data?.code === 'maps-unavailable' ? 'maps' : 'ai');
      }

      const text = String(data?.text ?? '').trim();
      // An empty reply used to be papered over with an English apology. It is a
      // failure, and the translated bubble below is the honest answer.
      if (!text) throw new Error('ai');

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: text,
        groundingChunks: data?.groundingChunks || [],
        timestamp: formatTime(new Date(), localeFor(language)),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error('Chat Error:', err);
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        // A CUSTOMER READS THIS BUBBLE.
        //
        // It used to end "Please ensure GEMINI_API_KEY is configured" whenever the
        // error carried no message — telling a shopper to set an environment
        // variable on a server they have never heard of. The same sentence was
        // removed from the server twice; this was its last copy, and the one
        // actually printed into the conversation.
        //
        // `err.message` is a fetch/network message ("Failed to fetch",
        // "NetworkError"), not the server's — the server's own text is already
        // handled above. Neither belongs in front of a customer.
        content: `⚠️ ${err?.message === 'maps' ? t('chatMapsUnavailable') : t('chatUnavailable')}`,
        timestamp: formatTime(new Date(), localeFor(language)),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClear = () => {
    // THE GREETING, NOT A SECOND ENGLISH SENTENCE. This replaced the whole
    // conversation with 'Chat session reset. What would you like to inquire about
    // next?' — hard-coded English in a shop that sells in four languages, and the
    // one bubble left on screen after the customer pressed the bin.
    //
    // The id is 'welcome-1' on purpose: it is what the language effect looks for,
    // so this bubble follows a language switch like the original greeting does.
    setMessages([
      {
        id: 'welcome-1',
        role: 'assistant',
        content: t('chatWelcome'),
        timestamp: formatTime(new Date(), localeFor(language)),
      },
    ]);
  };

  if (!chatAvailable) return null;

  return (
    <>
      {/* Floating Launcher Button
          z-40, one step BELOW the drawers and modals (all z-50).
          At z-50 it tied with them and won on DOM order, so the assistant
          bubble floated on top of the open cart drawer, the product
          configurator and the invoice/packing-slip sheets — on a phone it
          landed squarely over their buttons. The chat PANEL below stays at
          z-50; it is the thing in front when it is open. */}
      <div className="fixed bottom-6 right-6 z-40">
        <AnimatePresence>
          {!isOpen && (
            <motion.button
              drag
              dragMomentum={false}
              whileDrag={{ scale: 1.08, cursor: 'grabbing' }}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsOpen(true)}
              // Icon only, and a round button rather than a pill: the owner
              // wanted the wording gone and the target bigger. The name lives
              // in the tooltip and on the panel this opens, so nothing is lost
              // — and a circle takes less of the page than the label did while
              // being easier to hit. Dragging still works anywhere on it.
              className="group relative flex items-center justify-center w-14 h-14 bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-full shadow-lg hover:shadow-orange-500/25 transition-all duration-300 focus:outline-none cursor-grab active:cursor-grabbing"
              title={t('chatOpenTitle')}
              aria-label={t('chatOpenAria')}
            >
              <div className="relative">
                <Bot className="w-7 h-7 text-white" />
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 border border-orange-600 rounded-full animate-pulse" />
              </div>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Chat Drawer / Modal Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            drag
            dragMomentum={false}
            dragElastic={0.05}
            whileDrag={{ cursor: 'grabbing', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)' }}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={cn(
              // Above the "update ready" bar (z-60): an open conversation holds the reload, so
              // the bar stays — and on a phone it lay over the chat's own input (final review).
              "fixed bottom-6 right-6 z-[61] bg-white border border-gray-200/90 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300",
              isExpanded 
                ? "w-[calc(100vw-2rem)] md:w-[43.75rem] h-[calc(100vh-4rem)] max-h-[50rem]" 
                : "w-[calc(100vw-2rem)] sm:w-[26.25rem] h-[36.25rem]"
            )}
          >
            {/* Header / Drag Handle */}
            <div className="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 text-white p-3.5 px-4 flex items-center justify-between border-b border-gray-800 shrink-0 cursor-grab active:cursor-grabbing select-none">
              <div className="flex items-center space-x-2.5">
                <div className="p-1.5 text-gray-400 hover:text-white" title={t('chatDragHint')}>
                  <GripHorizontal className="w-4 h-4" />
                </div>
                <div className="p-2 bg-orange-600 rounded-xl text-white shadow-xs">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="font-bold text-sm tracking-tight">ReklamX AI</h3>
                    {/* NO MODEL BADGE. It read "Gemini 2.5" — a model this shop
                        can no longer call — and before that "Gemini 3.6", and the
                        comment left here swore no such model existed, which is
                        the exact id Google's own 404 now tells us to move to. It
                        was also provider-blind: the same badge appeared over an
                        OpenAI or Anthropic key. A customer does not need the
                        engine's name, and every version written here has been
                        wrong within months. */}
                  </div>
                  <p className="text-[0.6875rem] text-gray-400 flex items-center gap-1">
                    <Move className="w-2.5 h-2.5 text-orange-400" />
                    <span>{t('chatDragHint')}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-1">
                <button
                  onClick={handleClear}
                  title={t('chatClear')}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  title={isExpanded ? t('chatCollapse') : t('chatExpand')}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors hidden sm:block"
                >
                  {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>

                <button
                  onClick={() => setIsOpen(false)}
                  title={t('chatClose')}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sub-Header: Mode Selector Pill */}
            <div className="bg-gray-50 border-b border-gray-200/70 p-2 px-3 flex items-center justify-between text-xs shrink-0">
              <span className="text-gray-500 font-medium text-[0.6875rem]">{t('chatModeLabel')}</span>
              <div className="flex items-center space-x-1 bg-gray-200/70 p-0.5 rounded-lg text-[0.6875rem] font-medium">
                <button
                  onClick={() => setMode('assistant')}
                  className={cn(
                    "px-2 py-1 rounded-md transition-all",
                    mode === 'assistant'
                      ? "bg-white text-gray-900 shadow-2xs font-bold"
                      : "text-gray-600 hover:text-gray-900"
                  )}
                >
                  {t('chatModeAdvisor')}
                </button>
                {mapsOffered && (
                <button
                  onClick={() => setMode('maps')}
                  className={cn(
                    "px-2 py-1 rounded-md transition-all flex items-center space-x-1",
                    mode === 'maps'
                      ? "bg-white text-orange-600 shadow-2xs font-bold"
                      : "text-gray-600 hover:text-gray-900"
                  )}
                >
                  <MapPin className="w-3 h-3" />
                  <span>{t('chatModeMaps')}</span>
                </button>
                )}
                {proOffered && (
                <button
                  onClick={() => setMode('complex')}
                  className={cn(
                    "px-2 py-1 rounded-md transition-all",
                    mode === 'complex'
                      ? "bg-white text-indigo-600 shadow-2xs font-bold"
                      : "text-gray-600 hover:text-gray-900"
                  )}
                >
                  {t('chatModePro')}
                </button>
                )}
              </div>
            </div>
            {chatProvider === 'deepseek' && (
              <p className="px-3 py-1.5 text-[0.625rem] font-bold text-gray-500 bg-amber-50/70 border-b border-amber-100 shrink-0" data-rx-chat-processor>
                {t('chatProcessedByDeepSeek')}
              </p>
            )}

            {/* Message Thread */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex space-x-2.5 max-w-[88%]",
                    msg.role === 'user' ? "ml-auto flex-row-reverse space-x-reverse" : "mr-auto"
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white font-bold text-xs shadow-2xs",
                      msg.role === 'user' ? "bg-gray-800" : "bg-orange-600"
                    )}
                  >
                    {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>

                  {/* Message Bubble */}
                  <div className="group relative">
                    <div
                      className={cn(
                        "p-3.5 rounded-2xl text-xs leading-relaxed space-y-2 shadow-2xs",
                        msg.role === 'user'
                          ? "bg-orange-600 text-white rounded-tr-none font-medium"
                          : "bg-white border border-gray-200/80 text-gray-800 rounded-tl-none"
                      )}
                    >
                      <div className="markdown-body">
                        <Markdown>{msg.content}</Markdown>
                      </div>

                      {/* Render Grounding Maps / Web Chunks if any */}
                      {msg.groundingChunks && msg.groundingChunks.length > 0 && (
                        <div className="pt-2 border-t border-gray-100 space-y-1.5">
                          <p className="text-[0.625rem] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-orange-500" />
                            Verified Locations & Map References:
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.groundingChunks.map((chunk, idx) => {
                              const uri = chunk.maps?.uri || chunk.web?.uri;
                              const title = chunk.maps?.title || chunk.web?.title || 'Map Location';
                              if (!uri) return null;
                              return (
                                <a
                                  key={idx}
                                  href={uri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  referrerPolicy="no-referrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-lg text-[0.6875rem] font-semibold transition-colors"
                                >
                                  <Compass className="w-3 h-3 text-orange-600" />
                                  <span>{title}</span>
                                </a>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1 text-[0.625rem] text-gray-400">
                        <span>{msg.timestamp}</span>
                        {msg.role === 'assistant' && (
                          <button
                            onClick={() => handleCopy(msg.id, msg.content)}
                            className="opacity-0 group-hover:opacity-100 hover:text-gray-700 transition-opacity p-0.5"
                            title={t('chatCopy')}
                          >
                            {copiedId === msg.id ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Typing Indicator */}
              {isLoading && (
                <div className="flex items-center space-x-2 text-gray-500 text-xs bg-white p-3 rounded-2xl border border-gray-200/80 w-max shadow-2xs">
                  <Bot className="w-4 h-4 text-orange-600 animate-spin-slow" />
                  <span className="font-medium text-[0.6875rem]">{t('chatTyping')}</span>
                  <div className="flex space-x-1">
                    <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Preset Suggestions when conversation is short */}
            {messages.length <= 2 && !isLoading && (
              <div className="p-2.5 bg-white border-t border-gray-100 shrink-0">
                <p className="text-[0.625rem] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">
                  {t('chatSuggested')}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {PRESET_PROMPTS.map((item, idx) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={idx}
                        onClick={() => handleSend(t(item.promptKey), item.mode as any)}
                        className="p-2 bg-gray-50 hover:bg-orange-50 hover:border-orange-200 border border-gray-200/80 rounded-xl text-[0.6875rem] text-gray-700 hover:text-orange-900 font-medium text-left transition-all flex items-start space-x-2"
                      >
                        <Icon className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
                        <span className="line-clamp-2 leading-tight">{t(item.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Input Bar */}
            <div className="p-3 bg-white border-t border-gray-200 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center space-x-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={mode === 'maps' ? t('chatPlaceholderMaps') : t('chatPlaceholderDefault')}
                  disabled={isLoading}
                  className="flex-1 px-3.5 py-2 bg-gray-100 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:bg-white focus:ring-1 focus:ring-orange-500 transition-all placeholder:text-gray-400"
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="p-2.5 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 disabled:opacity-50 text-white rounded-xl shadow-2xs transition-colors shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
