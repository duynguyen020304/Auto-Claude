import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileAutocomplete } from './FileAutocomplete';
import { useFileExplorerStore } from '../stores/file-explorer-store';
import { cn } from '../lib/utils';

interface FileMentionInputProps {
  /** Current input value */
  value: string;
  /** Callback when input value changes */
  onChange: (value: string) => void;
  /** Project path for file resolution */
  projectPath: string;
  /** Placeholder text */
  placeholder?: string;
  /** Number of rows for the textarea */
  rows?: number;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** ID for the textarea */
  id?: string;
  /** ARIA label for accessibility */
  ariaLabel?: string;
  /** Additional CSS classes */
  className?: string;
  /** Callback when a file is mentioned */
  onFileMentioned?: (fileName: string, fullPath: string) => void;
}

/**
 * FileMentionInput - Textarea with @ file mention autocomplete
 *
 * Features:
 * - Auto-complete popup triggered by @ character
 * - File search/filtering from project
 * - Visual highlighting of mentions
 * - Keyboard navigation (↑↓ Enter Esc Tab)
 * - Line range support (e.g., @file.js:10-50)
 */
export function FileMentionInput({
  value,
  onChange,
  projectPath,
  placeholder,
  rows = 4,
  disabled = false,
  id,
  ariaLabel,
  className,
  onFileMentioned
}: FileMentionInputProps) {
  const { t } = useTranslation(['insights', 'common']);
  const { loadDirectory } = useFileExplorerStore();

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autocomplete state
  const [autocomplete, setAutocomplete] = useState<{
    show: boolean;
    query: string;
    startPos: number;
    position: { top: number; left: number };
  } | null>(null);

  // Load root directory on mount
  useEffect(() => {
    if (projectPath) {
      loadDirectory(projectPath);
    }
  }, [projectPath, loadDirectory]);

  /**
   * Detect @ mention being typed
   */
  const detectAtMention = useCallback((text: string, cursorPos: number) => {
    const beforeCursor = text.slice(0, cursorPos);
    const match = beforeCursor.match(/@([\w\-./\\]*)$/);
    if (match) {
      return { query: match[1], startPos: cursorPos - match[0].length };
    }
    return null;
  }, []);

  /**
   * Calculate autocomplete position based on cursor
   */
  const calculateAutocompletePosition = useCallback((
    textarea: HTMLTextAreaElement,
    text: string,
    cursorPos: number
  ): { top: number; left: number } => {
    const rect = textarea.getBoundingClientRect();
    const textareaStyle = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(textareaStyle.lineHeight) || 20;
    const paddingTop = parseFloat(textareaStyle.paddingTop) || 8;
    const paddingLeft = parseFloat(textareaStyle.paddingLeft) || 12;

    const textBeforeCursor = text.slice(0, cursorPos);
    const lines = textBeforeCursor.split('\n');
    const currentLineIndex = lines.length - 1;
    const currentLineLength = lines[currentLineIndex].length;

    // Approximate character width (can vary by font)
    const charWidth = 8;
    const top = paddingTop + (currentLineIndex + 1) * lineHeight + 4;
    const left = paddingLeft + Math.min(currentLineLength * charWidth, rect.width - 300);

    return { top, left: Math.max(0, left) };
  }, []);

  /**
   * Handle input change and check for @ mentions
   */
  const handleChange = useCallback((newValue: string) => {
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart || 0;

    onChange(newValue);

    const mention = detectAtMention(newValue, cursorPos);
    if (mention && textarea) {
      const position = calculateAutocompletePosition(textarea, newValue, cursorPos);
      setAutocomplete({
        show: true,
        query: mention.query,
        startPos: mention.startPos,
        position
      });
    } else if (autocomplete?.show) {
      setAutocomplete(null);
    }
  }, [onChange, detectAtMention, calculateAutocompletePosition, autocomplete?.show]);

  /**
   * Handle autocomplete file selection
   */
  const handleAutocompleteSelect = useCallback((fileName: string, fullPath: string) => {
    if (!autocomplete) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    // Insert file name with @ prefix
    const beforeMention = value.slice(0, autocomplete.startPos);
    const afterMention = value.slice(autocomplete.startPos + 1 + autocomplete.query.length);
    const newValue = beforeMention + '@' + fileName + afterMention;

    onChange(newValue);
    setAutocomplete(null);

    // Notify parent that a file was mentioned
    if (onFileMentioned) {
      onFileMentioned(fileName, fullPath);
    }

    // Restore cursor focus
    queueMicrotask(() => {
      const newCursorPos = autocomplete.startPos + 1 + fileName.length;
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    });
  }, [autocomplete, value, onChange, onFileMentioned]);

  /**
   * Handle keyboard events (close autocomplete on Escape)
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && autocomplete?.show) {
      e.preventDefault();
      setAutocomplete(null);
    }
  }, [autocomplete?.show]);

  /**
   * Close autocomplete when clicking outside
   */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (autocomplete?.show && textareaRef.current) {
        const rect = textareaRef.current.getBoundingClientRect();
        const clickedOutside =
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom;
        if (clickedOutside) {
          setAutocomplete(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [autocomplete?.show]);

  /**
   * Render highlight overlay for @ mentions
   */
  const highlightOverlay = (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden rounded-md border border-transparent"
      style={{
        padding: '0.5rem 0.75rem',
        font: 'inherit',
        lineHeight: '1.5',
        wordWrap: 'break-word',
        whiteSpace: 'pre-wrap',
        color: 'transparent'
      }}
    >
      {value.split(/(@[\w\-./\\]+\.\w+(:\d+(?:-\d+)?)?)/g).map((part, i) => {
        // Match @mentions with optional line range
        if (part.match(/^@[\w\-./\\]+\.\w+(:\d+(?:-\d+)?)?$/)) {
          return (
            <span
              key={i}
              className="bg-info/20 text-info-foreground rounded px-0.5"
              style={{ color: 'hsl(var(--info))' }}
            >
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </div>
  );

  return (
    <div className="relative">
      {/* Highlight overlay */}
      {highlightOverlay}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'bg-transparent', // Make textarea transparent to show overlay
          className
        )}
        style={{ caretColor: 'auto' }}
      />

      {/* Autocomplete popup */}
      {autocomplete?.show && projectPath && (
        <FileAutocomplete
          query={autocomplete.query}
          projectPath={projectPath}
          position={autocomplete.position}
          onSelect={handleAutocompleteSelect}
          onClose={() => setAutocomplete(null)}
        />
      )}
    </div>
  );
}
