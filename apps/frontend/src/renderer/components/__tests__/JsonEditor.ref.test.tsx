/**
 * @vitest-environment jsdom
 */
/**
 * Tests for JsonEditor Ref Methods (formatJson, minifyJson)
 *
 * These tests verify that the formatJson and minifyJson methods
 * are properly exposed via ref and work correctly.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { JsonEditor, JsonEditorRef } from '../JsonEditor';

describe('JsonEditor Ref Methods', () => {
  describe('formatJson', () => {
    it('should format minified JSON with 2-space indent', () => {
      const handleChange = vi.fn();
      let editorRefInstance: JsonEditorRef | null = null;

      const TestComponent = () => {
        const editorRef = useRef<JsonEditorRef>(null);

        return (
          <div>
            <JsonEditor
              ref={(ref) => {
                editorRef.current = ref;
                editorRefInstance = ref;
              }}
              value='{"name":"test","nested":{"key":"value"}}'
              onChange={handleChange}
            />
            <button
              data-testid="format-btn"
              onClick={() => editorRef.current?.formatJson()}
            >
              Format
            </button>
          </div>
        );
      };

      render(<TestComponent />);

      const formatBtn = screen.getByTestId('format-btn');
      formatBtn.click();

      // Verify onChange was called with formatted JSON
      expect(handleChange).toHaveBeenCalled();
      const formattedValue = handleChange.mock.calls[0][0];
      expect(formattedValue).toContain('  '); // Has 2-space indentation
      expect(formattedValue).toContain('\n'); // Has newlines
    });

    it('should format already formatted JSON', () => {
      const handleChange = vi.fn();

      const TestComponent = () => {
        const editorRef = useRef<JsonEditorRef>(null);

        return (
          <div>
            <JsonEditor
              ref={editorRef}
              value={`{\n  "name": "test"\n}`}
              onChange={handleChange}
            />
            <button
              data-testid="format-btn"
              onClick={() => editorRef.current?.formatJson()}
            >
              Format
            </button>
          </div>
        );
      };

      render(<TestComponent />);

      const formatBtn = screen.getByTestId('format-btn');
      formatBtn.click();

      // Should still call onChange
      expect(handleChange).toHaveBeenCalled();
    });

    it('should handle empty value gracefully', () => {
      const handleChange = vi.fn();

      const TestComponent = () => {
        const editorRef = useRef<JsonEditorRef>(null);

        return (
          <div>
            <JsonEditor ref={editorRef} value="" onChange={handleChange} />
            <button
              data-testid="format-btn"
              onClick={() => editorRef.current?.formatJson()}
            >
              Format
            </button>
          </div>
        );
      };

      render(<TestComponent />);

      const formatBtn = screen.getByTestId('format-btn');
      formatBtn.click();

      // Should not call onChange for empty value
      expect(handleChange).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', () => {
      const handleChange = vi.fn();

      const TestComponent = () => {
        const editorRef = useRef<JsonEditorRef>(null);

        return (
          <div>
            <JsonEditor
              ref={editorRef}
              value='{"invalid": json}'
              onChange={handleChange}
            />
            <button
              data-testid="format-btn"
              onClick={() => editorRef.current?.formatJson()}
            >
              Format
            </button>
          </div>
        );
      };

      render(<TestComponent />);

      const formatBtn = screen.getByTestId('format-btn');
      formatBtn.click();

      // Should not call onChange for invalid JSON
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe('minifyJson', () => {
    it('should minify formatted JSON', () => {
      const handleChange = vi.fn();

      const TestComponent = () => {
        const editorRef = useRef<JsonEditorRef>(null);

        return (
          <div>
            <JsonEditor
              ref={editorRef}
              value={`{\n  "name": "test",\n  "nested": {\n    "key": "value"\n  }\n}`}
              onChange={handleChange}
            />
            <button
              data-testid="minify-btn"
              onClick={() => editorRef.current?.minifyJson()}
            >
              Minify
            </button>
          </div>
        );
      };

      const { unmount } = render(<TestComponent />);

      // Clear the initial auto-format call
      handleChange.mockClear();

      const minifyBtn = screen.getByTestId('minify-btn');
      minifyBtn.click();

      // Verify onChange was called
      expect(handleChange).toHaveBeenCalled();
      const minifiedValue = handleChange.mock.calls[handleChange.mock.calls.length - 1][0];

      // After minify, the JSON should have no whitespace or just single-line
      // Note: Due to auto-format on mount, the initial value gets formatted first
      const lines = minifiedValue.split('\n').filter((line: string) => line.trim().length > 0);
      expect(lines.length).toBe(1); // Should be single line after minify

      unmount();
    });

    it('should minify already minified JSON', () => {
      const handleChange = vi.fn();

      const TestComponent = () => {
        const editorRef = useRef<JsonEditorRef>(null);

        return (
          <div>
            <JsonEditor
              ref={editorRef}
              value='{"name":"test","key":"value"}'
              onChange={handleChange}
            />
            <button
              data-testid="minify-btn"
              onClick={() => editorRef.current?.minifyJson()}
            >
              Minify
            </button>
          </div>
        );
      };

      render(<TestComponent />);

      const minifyBtn = screen.getByTestId('minify-btn');
      minifyBtn.click();

      // Should still call onChange
      expect(handleChange).toHaveBeenCalled();
    });

    it('should handle empty value gracefully', () => {
      const handleChange = vi.fn();

      const TestComponent = () => {
        const editorRef = useRef<JsonEditorRef>(null);

        return (
          <div>
            <JsonEditor ref={editorRef} value="" onChange={handleChange} />
            <button
              data-testid="minify-btn"
              onClick={() => editorRef.current?.minifyJson()}
            >
              Minify
            </button>
          </div>
        );
      };

      render(<TestComponent />);

      const minifyBtn = screen.getByTestId('minify-btn');
      minifyBtn.click();

      // Should not call onChange for empty value
      expect(handleChange).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', () => {
      const handleChange = vi.fn();

      const TestComponent = () => {
        const editorRef = useRef<JsonEditorRef>(null);

        return (
          <div>
            <JsonEditor
              ref={editorRef}
              value='{invalid json}'
              onChange={handleChange}
            />
            <button
              data-testid="minify-btn"
              onClick={() => editorRef.current?.minifyJson()}
            >
              Minify
            </button>
          </div>
        );
      };

      render(<TestComponent />);

      const minifyBtn = screen.getByTestId('minify-btn');
      minifyBtn.click();

      // Should not call onChange for invalid JSON
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe('Ref type safety', () => {
    it('should expose methods through ref', () => {
      let capturedRef: JsonEditorRef | null = null;

      const TestComponent = () => {
        const editorRef = useRef<JsonEditorRef>(null);

        const handleRef = (ref: JsonEditorRef | null) => {
          editorRef.current = ref;
          capturedRef = ref;
        };

        return (
          <JsonEditor
            ref={handleRef}
            value=""
            onChange={vi.fn()}
          />
        );
      };

      render(<TestComponent />);

      // Verify ref has the correct methods
      expect(capturedRef).toBeDefined();
      expect(typeof (capturedRef as JsonEditorRef | null)?.formatJson).toBe('function');
      expect(typeof (capturedRef as JsonEditorRef | null)?.minifyJson).toBe('function');
    });
  });
});
