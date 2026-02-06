import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Send,
  Loader2,
  User,
  Bot,
  AlertCircle,
} from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../../ui/button';
import { Textarea } from '../../ui/textarea';
import { ScrollArea } from '../../ui/scroll-area';
import { cn } from '../../../lib/utils';
import type { ReviewQAMessage, ReviewQAStreamChunk, ReviewQAConfig } from '../../../../shared/types';

// createSafeLink - factory function that creates a SafeLink component with i18n support
const createSafeLink = (opensInNewWindowText: string) => {
  return function SafeLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    // Validate URL - only allow http, https, and relative links
    const isValidUrl = href && (
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('/') ||
      href.startsWith('#')
    );

    if (!isValidUrl) {
      // For invalid or potentially malicious URLs, render as plain text
      return <span className="text-muted-foreground">{children}</span>;
    }

    // External links get security attributes and accessibility indicator
    const isExternal = href?.startsWith('http://') || href?.startsWith('https://');

    return (
      <a
        href={href}
        {...props}
        {...(isExternal && {
          target: '_blank',
          rel: 'noopener noreferrer',
        })}
        className="text-primary hover:underline"
      >
        {children}
        {isExternal && <span className="sr-only"> {opensInNewWindowText}</span>}
      </a>
    );
  };
};

interface ReviewQAChatProps {
  specId: string;
  taskId: string;
  projectId: string;
  sessionId?: string;
  initialQuestion?: string;
}

export function ReviewQAChat({ specId, taskId, projectId, sessionId, initialQuestion }: ReviewQAChatProps) {
  const { t } = useTranslation(['common', 'tasks', 'insights']);

  // Create markdown components with translated accessibility text
  const markdownComponents = useMemo(() => ({
    a: createSafeLink(t('common:accessibility.opensInNewWindow')),
  }), [t]);

  const [messages, setMessages] = useState<ReviewQAMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Scroll threshold in pixels - user is considered "at bottom" if within this distance
  const SCROLL_BOTTOM_THRESHOLD = 100;

  // Generate a session ID if not provided
  const effectiveSessionId = sessionId || `${specId}-${taskId}`;

  // Check if user is near the bottom of scroll area
  const checkIfAtBottom = useCallback((viewport: HTMLElement) => {
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    return scrollHeight - scrollTop - clientHeight <= SCROLL_BOTTOM_THRESHOLD;
  }, []);

  // Handle scroll events to track user position
  const handleScroll = useCallback(() => {
    if (viewportEl) {
      setIsUserAtBottom(checkIfAtBottom(viewportEl));
    }
  }, [viewportEl, checkIfAtBottom]);

  // Set up scroll listener and check initial position when viewport becomes available
  useEffect(() => {
    if (viewportEl) {
      // Check initial scroll position
      setIsUserAtBottom(checkIfAtBottom(viewportEl));
      viewportEl.addEventListener('scroll', handleScroll, { passive: true });
      return () => viewportEl.removeEventListener('scroll', handleScroll);
    }
  }, [viewportEl, handleScroll, checkIfAtBottom]);

  // Smart auto-scroll: only scroll if user is already at bottom
  useEffect(() => {
    if (isUserAtBottom && viewportEl) {
      viewportEl.scrollTop = viewportEl.scrollHeight;
    }
  }, [isUserAtBottom, viewportEl, messages, streamingContent]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Handle initial question from QuickQuestionChips
  useEffect(() => {
    if (initialQuestion && initialQuestion.trim() && initialQuestion !== pendingQuestion) {
      setPendingQuestion(initialQuestion);
      setInputValue(initialQuestion);
      // Auto-send the question after a short delay to let the input update
      const timer = setTimeout(() => {
        handleSend();
      }, 100);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  // Set up IPC event listeners for streaming responses
  useEffect(() => {
    const cleanupStreamChunk = window.electronAPI.onReviewQAStreamChunk(
      (incomingSessionId, incomingProjectId, chunk) => {
        // Only handle chunks for this session
        if (incomingSessionId !== effectiveSessionId || incomingProjectId !== projectId) {
          return;
        }

        if (chunk.type === 'text' && chunk.content) {
          setStreamingContent((prev) => prev + chunk.content);
        } else if (chunk.type === 'error') {
          setError(chunk.error || t('tasks:reviewQA.unknownError'));
          setIsLoading(false);
        } else if (chunk.type === 'done') {
          // Finalize the streaming message
          if (streamingContent) {
            const aiMessage: ReviewQAMessage = {
              id: `msg-${Date.now()}`,
              role: 'assistant',
              content: streamingContent,
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, aiMessage]);
          }
          setStreamingContent('');
          setIsLoading(false);
        }
      }
    );

    const cleanupError = window.electronAPI.onReviewQAError(
      (incomingSessionId, incomingProjectId, errorMessage) => {
        // Only handle errors for this session
        if (incomingSessionId !== effectiveSessionId || incomingProjectId !== projectId) {
          return;
        }
        setError(errorMessage);
        setIsLoading(false);
        setStreamingContent('');
      }
    );

    return () => {
      cleanupStreamChunk();
      cleanupError();
    };
  }, [effectiveSessionId, projectId, streamingContent, t]);

  const handleSend = () => {
    const question = inputValue.trim();
    if (!question || isLoading) return;

    // Add user message to chat
    const userMessage: ReviewQAMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setPendingQuestion(null); // Clear pending question after sending
    setError(null);
    setIsLoading(true);
    setIsUserAtBottom(true); // Resume auto-scroll when user sends a message

    // Send question to backend
    window.electronAPI.sendReviewQAMessage(effectiveSessionId, specId, projectId, question);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = async () => {
    try {
      await window.electronAPI.stopReviewQA(effectiveSessionId);
      setIsLoading(false);
      setStreamingContent('');
    } catch (err) {
      console.error('Failed to stop review QA:', err);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <ScrollArea
        className="flex-1 px-6 py-4"
        onViewportRef={setViewportEl}
      >
        {messages.length === 0 && !streamingContent ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <MessageSquare className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-foreground">
              {t('tasks:reviewQA.emptyState.title')}
            </h3>
            <p className="max-w-md text-sm text-muted-foreground">
              {t('tasks:reviewQA.emptyState.description')}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                markdownComponents={markdownComponents}
              />
            ))}

            {/* Streaming message */}
            {streamingContent && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="mb-1 text-sm font-medium text-foreground">
                    {t('tasks:reviewQA.assistant')}
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {streamingContent}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            )}

            {/* Thinking indicator */}
            {isLoading && !streamingContent && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('tasks:reviewQA.thinking')}
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border p-4">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('tasks:reviewQA.inputPlaceholder')}
            className="min-h-[80px] resize-none"
            disabled={isLoading}
          />
          <div className="flex flex-col gap-2">
            {isLoading ? (
              <Button
                onClick={handleStop}
                variant="destructive"
                className="self-end"
                title={t('tasks:reviewQA.stop')}
              >
                <Loader2 className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSend}
                disabled={!inputValue.trim()}
                className="self-end"
                title={t('tasks:reviewQA.send')}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t('tasks:reviewQA.inputHint')}
        </p>
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: ReviewQAMessage;
  markdownComponents: Components;
}

function MessageBubble({ message, markdownComponents }: MessageBubbleProps) {
  const { t } = useTranslation(['tasks', 'insights']);
  const isUser = message.role === 'user';

  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-muted' : 'bg-primary/10'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-primary" />
        )}
      </div>
      <div className="flex-1 space-y-2">
        <div className="text-sm font-medium text-foreground">
          {isUser ? t('tasks:reviewQA.you') : t('tasks:reviewQA.assistant')}
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
