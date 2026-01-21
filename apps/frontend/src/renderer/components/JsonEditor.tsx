/**
 * JsonEditor Component
 *
 * Monaco Editor wrapper for JSON editing with syntax highlighting,
 * validation, and error display. Optimized for CustomMcpServer
 * configurations but works with any JSON data.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
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
 * JsonEditor component using Monaco Editor for JSON editing
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
export function JsonEditor({
  value,
  onChange,
  error = null,
  readonly = false,
  height = '400px',
  minHeight = '200px',
  className,
  placeholder = '{\n\t\n}',
}: JsonEditorProps) {
  const [isEditorReady, setIsEditorReady] = useState(false);
  const editorRef = useRef<unknown>(null);

  /**
   * Handle editor mount
   */
  const handleEditorDidMount = useCallback((editor: unknown) => {
    editorRef.current = editor;
    setIsEditorReady(true);

    // Auto-format on mount if there's content
    if (value && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        const formatted = JSON.stringify(parsed, null, 2);
        // Update editor content without triggering onChange
        if (typeof editor === 'object' && editor !== null && 'setValue' in editor) {
          (editor as { setValue: (value: string) => void }).setValue(formatted);
        }
      } catch {
        // Invalid JSON, don't auto-format
      }
    }
  }, [value]);

  /**
   * Handle editor value changes
   */
  const handleValueChange = useCallback(
    (newValue: string | undefined) => {
      const valueToUse = newValue ?? '';

      // Try to parse JSON to validate
      let parsed: unknown = undefined;
      try {
        parsed = JSON.parse(valueToUse);
      } catch {
        // Invalid JSON, still update value but don't provide parsed
      }

      onChange(valueToUse, parsed);
    },
    [onChange]
  );

  /**
   * Format JSON content
   */
  const formatJson = useCallback(() => {
    if (!editorRef.current) return;

    const editor = editorRef.current as {
      getValue: () => string;
      setValue: (value: string) => void;
      getAction: (action: string) => { run: () => void } | undefined;
    };

    const currentValue = editor.getValue();
    if (!currentValue.trim()) return;

    try {
      const parsed = JSON.parse(currentValue);
      const formatted = JSON.stringify(parsed, null, 2);
      editor.setValue(formatted);
    } catch {
      // Invalid JSON, can't format
    }
  }, []);

  /**
   * Minify JSON content
   */
  const minifyJson = useCallback(() => {
    if (!editorRef.current) return;

    const editor = editorRef.current as {
      getValue: () => string;
      setValue: (value: string) => void;
    };

    const currentValue = editor.getValue();
    if (!currentValue.trim()) return;

    try {
      const parsed = JSON.parse(currentValue);
      const minified = JSON.stringify(parsed);
      editor.setValue(minified);
    } catch {
      // Invalid JSON, can't minify
    }
  }, []);

  // Expose format/minify methods via ref for parent components
  useEffect(() => {
    if (editorRef.current) {
      (editorRef.current as { formatJson: () => void; minifyJson: () => void }).formatJson =
        formatJson;
      (editorRef.current as { formatJson: () => void; minifyJson: () => void }).minifyJson =
        minifyJson;
    }
  }, [formatJson, minifyJson]);

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

      {/* Monaco Editor */}
      <Editor
        value={value || placeholder}
        language="json"
        theme="vs-dark"
        options={{
          readOnly: readonly,
          minimap: { enabled: true },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          insertSpaces: true,
          detectIndentation: true,
          folding: true,
          foldingStrategy: 'indentation',
          showFoldingControls: 'always',
          formatOnPaste: true,
          formatOnType: true,
          trimAutoWhitespace: true,
          suggestOnTriggerCharacters: true,
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
          },
          parameterHints: {
            enabled: true,
          },
          wordWrap: 'on',
          // JSON-specific options
          colorDecorators: true,
          // Accessibility
          ariaLabel: 'JSON editor',
        }}
        onChange={handleValueChange}
        onMount={handleEditorDidMount}
        loading={
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
        className="flex-1"
      />

      {/* Error message overlay */}
      {error && (
        <div className="absolute bottom-0 left-0 right-0 bg-destructive/95 text-destructive-foreground px-3 py-2 text-sm">
          <p className="font-medium">Validation Error</p>
          <p className="opacity-90">{error}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Hook to programmatically control JsonEditor
 *
 * @example
 * ```tsx
 * const editorRef = useRef<{ formatJson: () => void; minifyJson: () => void }>(null);
 *
 * <JsonEditor ref={editorRef} {...props} />
 *
 * <button onClick={() => editorRef.current?.formatJson()}>
 *   Format JSON
 * </button>
 * ```
 */
export type JsonEditorRef = {
  formatJson: () => void;
  minifyJson: () => void;
};
