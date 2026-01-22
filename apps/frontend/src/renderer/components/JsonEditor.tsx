/**
 * JsonEditor Component
 *
 * Lightweight JSON editor using react-simple-code-editor with Prism.js
 * syntax highlighting. Provides validation, formatting, and error display.
 * Optimized for CustomMcpServer configurations but works with any JSON data.
 */

import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/themes/prism-tomorrow.css';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { Loader2 } from 'lucide-react';

interface JsonEditorProps {
  /** Current JSON value (stringified) */
  value: string;
  /** Callback when JSON changes */
  onChange: (value: string, parsed?: unknown) => void;
  /** Validation error message to display */
  error?: string | null;
  /** Read-only mode */
  readonly?: boolean;
  /** Editor height (default: '400px') */
  height?: string;
  /** Minimum editor height */
  minHeight?: string;
  /** Additional CSS classes */
  className?: string;
  /** Placeholder text for empty editor */
  placeholder?: string;
}

/**
 * Ref interface for JsonEditor component
 */
export type JsonEditorRef = {
  formatJson: () => void;
  minifyJson: () => void;
};

/**
 * JsonEditor component using lightweight textarea with syntax highlighting
 *
 * @example
 * ```tsx
 * const [json, setJson] = useState('');
 * const [error, setError] = useState<string | null>(null);
 *
 * <JsonEditor
 *   value={json}
 *   onChange={(value, parsed) => {
 *     setJson(value);
 *     // Validate parsed data
 *   }}
 *   error={error}
 *   height="500px"
 * />
 * ```
 */
export const JsonEditor = forwardRef<JsonEditorRef, JsonEditorProps>(
  (
    {
      value,
      onChange,
      error = null,
      readonly = false,
      height = '400px',
      minHeight = '200px',
      className,
      placeholder = '{\n\t\n}',
    }: JsonEditorProps,
    ref
  ) => {
  const { t } = useTranslation(['common']);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [internalValue, setInternalValue] = useState(value);

  /**
   * Highlight JSON code using Prism.js
   */
  const highlight = useCallback((code: string) => {
    return Prism.highlight(code, Prism.languages.json, 'json');
  }, []);

  /**
   * Handle editor value changes
   */
  const handleValueChange = useCallback(
    (newValue: string) => {
      setInternalValue(newValue);

      // Try to parse JSON to validate
      let parsed: unknown = undefined;
      try {
        parsed = JSON.parse(newValue);
      } catch {
        // Invalid JSON, still update value but don't provide parsed
      }

      onChange(newValue, parsed);
    },
    [onChange]
  );

  /**
   * Format JSON content
   */
  const formatJson = useCallback(() => {
    if (!internalValue.trim()) return;

    try {
      const parsed = JSON.parse(internalValue);
      const formatted = JSON.stringify(parsed, null, 2);
      setInternalValue(formatted);
      onChange(formatted, parsed);
    } catch {
      // Invalid JSON, can't format
    }
  }, [internalValue, onChange]);

  /**
   * Minify JSON content
   */
  const minifyJson = useCallback(() => {
    if (!internalValue.trim()) return;

    try {
      const parsed = JSON.parse(internalValue);
      const minified = JSON.stringify(parsed);
      setInternalValue(minified);
      onChange(minified, parsed);
    } catch {
      // Invalid JSON, can't minify
    }
  }, [internalValue, onChange]);

  // Expose format/minify methods to parent components via ref
  useImperativeHandle(
    ref,
    () => ({
      formatJson,
      minifyJson,
    }),
    [formatJson, minifyJson]
  );

  // Auto-format on mount
  useEffect(() => {
    // Auto-format on mount if there's content
    if (value && value.trim() && !isEditorReady) {
      try {
        const parsed = JSON.parse(value);
        const formatted = JSON.stringify(parsed, null, 2);
        setInternalValue(formatted);
        // Update parent without triggering onChange again
        onChange(formatted, parsed);
      } catch {
        // Invalid JSON, use value as-is
        setInternalValue(value);
      }
    } else if (!isEditorReady) {
      setInternalValue(value);
    }

    setIsEditorReady(true);
  }, [value, isEditorReady, onChange]);

  return (
    <div
      className={cn(
        'relative flex flex-col border rounded-lg overflow-hidden',
        'transition-colors',
        error ? 'border-destructive' : 'border-border',
        'focus-within:border-primary',
        className
      )}
      style={{ height, minHeight }}
    >
      {/* Loading indicator */}
      {!isEditorReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Simple Code Editor */}
      <div className="flex-1 overflow-auto">
        <Editor
          value={internalValue || placeholder}
          onValueChange={handleValueChange}
          highlight={highlight}
          disabled={readonly}
          padding={16}
          textareaClassName={cn(
            'outline-none w-full h-full resize-none bg-transparent',
            'font-mono text-[14px] leading-relaxed',
            'text-foreground'
          )}
          style={{
            fontFamily: "'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace",
            fontSize: 14,
            minHeight: '100%',
          }}
          className={cn(
            'w-full h-full',
            readonly && 'opacity-75 cursor-not-allowed'
          )}
        />
      </div>

      {/* Error message overlay */}
      {error && (
        <div className="absolute bottom-0 left-0 right-0 bg-destructive/95 text-destructive-foreground px-3 py-2 text-sm">
          <p className="font-medium">{t('common:errors.validationError')}</p>
          <p className="opacity-90">{error}</p>
        </div>
      )}
    </div>
  );
});

JsonEditor.displayName = 'JsonEditor';
