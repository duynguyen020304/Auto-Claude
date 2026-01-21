/**
 * @vitest-environment jsdom
 */
/**
 * Tests for JsonEditor Component
 * Tests Monaco Editor wrapper component for JSON editing
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JsonEditor } from '../JsonEditor';

// Mock Monaco Editor
vi.mock('@monaco-editor/react', () => ({
  default: vi.fn(({ onChange, value, onMount }) => {
    // Simulate editor mount callback
    setTimeout(() => {
      if (onMount) {
        const mockEditor = {
          getValue: () => value,
          setValue: vi.fn(),
          getAction: vi.fn()
        };
        onMount(mockEditor);
      }
    }, 0);

    return (
      <div data-testid="monaco-editor">
        <textarea
          data-testid="editor-textarea"
          value={value || ''}
          onChange={(e) => onChange && onChange(e.target.value)}
        />
      </div>
    );
  })
}));

describe('JsonEditor Component', () => {
  describe('Rendering', () => {
    it('should render Monaco Editor container', () => {
      render(<JsonEditor value="" onChange={vi.fn()} />);
      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });

    it('should render textarea for input', () => {
      render(<JsonEditor value="" onChange={vi.fn()} />);
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument();
    });

    it('should render with provided value', () => {
      const value = '{"name": "test"}';
      render(<JsonEditor value={value} onChange={vi.fn()} />);
      const textarea = screen.getByTestId('editor-textarea');
      expect(textarea).toHaveValue(value);
    });

    it('should render with custom height', () => {
      const { container } = render(
        <JsonEditor value="" onChange={vi.fn()} height="500px" />
      );
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.style.height).toBe('500px');
    });

    it('should render with custom minHeight', () => {
      const { container } = render(
        <JsonEditor value="" onChange={vi.fn()} minHeight="300px" />
      );
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.style.minHeight).toBe('300px');
    });

    it('should render with custom className', () => {
      const { container } = render(
        <JsonEditor value="" onChange={vi.fn()} className="custom-class" />
      );
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass('custom-class');
    });
  });

  describe('Error Display', () => {
    it('should display error message when error prop is provided', () => {
      const errorMessage = 'Invalid JSON syntax';
      render(
        <JsonEditor value="" onChange={vi.fn()} error={errorMessage} />
      );

      expect(screen.getByText(/validation error/i)).toBeInTheDocument();
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    it('should not display error when error prop is null', () => {
      render(<JsonEditor value="" onChange={vi.fn()} error={null} />);

      expect(screen.queryByText(/validation error/i)).not.toBeInTheDocument();
    });

    it('should apply destructive border styling when error present', () => {
      const { container } = render(
        <JsonEditor value="" onChange={vi.fn()} error="Error" />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass('border-destructive');
    });

    it('should not apply destructive border when no error', () => {
      const { container } = render(
        <JsonEditor value="" onChange={vi.fn()} error={null} />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).not.toHaveClass('border-destructive');
    });
  });

  describe('Placeholder', () => {
    it('should display placeholder when value is empty', () => {
      const placeholder = '{\n\t\n}';
      render(<JsonEditor value="" onChange={vi.fn()} placeholder={placeholder} />);

      const textarea = screen.getByTestId('editor-textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe(placeholder);
    });

    it('should use default placeholder when not provided', () => {
      render(<JsonEditor value="" onChange={vi.fn()} />);

      const textarea = screen.getByTestId('editor-textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('{\n\t\n}');
    });

    it('should display value instead of placeholder when value provided', () => {
      const value = '{"test": true}';
      render(<JsonEditor value={value} onChange={vi.fn()} />);

      const textarea = screen.getByTestId('editor-textarea');
      expect(textarea).toHaveValue(value);
    });
  });

  describe('onChange Callback', () => {
    it('should have onChange callback in props', () => {
      const handleChange = vi.fn();
      render(<JsonEditor value="" onChange={handleChange} />);

      // Component should render without errors
      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });
  });

  describe('Component Structure', () => {
    it('should have border class', () => {
      const { container } = render(
        <JsonEditor value="" onChange={vi.fn()} />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass('border');
    });

    it('should have rounded corners', () => {
      const { container } = render(
        <JsonEditor value="" onChange={vi.fn()} />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass('rounded-lg');
    });

    it('should have overflow hidden', () => {
      const { container } = render(
        <JsonEditor value="" onChange={vi.fn()} />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass('overflow-hidden');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string value', () => {
      render(<JsonEditor value="" onChange={vi.fn()} />);
      const textarea = screen.getByTestId('editor-textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('{\n\t\n}'); // placeholder
    });

    it('should handle whitespace-only value', () => {
      render(<JsonEditor value="   " onChange={vi.fn()} />);
      const textarea = screen.getByTestId('editor-textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('   ');
    });

    it('should handle complex nested JSON', () => {
      const complexJson = JSON.stringify({
        level1: {
          level2: {
            level3: {
              array: [1, 2, 3],
              nested: { a: 1, b: 2 }
            }
          }
        }
      });

      render(<JsonEditor value={complexJson} onChange={vi.fn()} />);
      const textarea = screen.getByTestId('editor-textarea');
      expect(textarea).toHaveValue(complexJson);
    });

    it('should handle JSON array', () => {
      const arrayJson = JSON.stringify([1, 2, 3, 'test', { nested: true }]);

      render(<JsonEditor value={arrayJson} onChange={vi.fn()} />);
      const textarea = screen.getByTestId('editor-textarea');
      expect(textarea).toHaveValue(arrayJson);
    });

    it('should handle JSON primitives', () => {
      const testCases = [
        { value: 'true' },
        { value: 'false' },
        { value: 'null' },
        { value: '123' },
        { value: '"string"' }
      ];

      testCases.forEach(({ value }) => {
        const { unmount } = render(<JsonEditor value={value} onChange={vi.fn()} />);
        const textarea = screen.getByTestId('editor-textarea');
        expect(textarea).toHaveValue(value);
        unmount();
      });
    });
  });

  describe('Read-only Mode', () => {
    it('should accept readonly prop', () => {
      render(<JsonEditor value="" onChange={vi.fn()} readonly={true} />);

      // Component should render without errors in readonly mode
      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('should render without crashing', () => {
      render(<JsonEditor value="" onChange={vi.fn()} />);

      // Component should render successfully
      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper DOM structure', () => {
      const { container } = render(<JsonEditor value="" onChange={vi.fn()} />);

      // Should have proper container structure
      expect(container.firstChild).toBeInTheDocument();
    });
  });
});
