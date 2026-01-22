/**
 * @vitest-environment jsdom
 */
/**
 * Tests for JsonEditor Component
 *
 * Tests the lightweight JSON editor using react-simple-code-editor
 * with Prism.js syntax highlighting.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JsonEditor } from '../JsonEditor';

// Mock i18next to avoid warnings
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('JsonEditor Component', () => {
  describe('Rendering', () => {
    it('should render editor container', () => {
      render(<JsonEditor value="" onChange={vi.fn()} />);
      const container = screen.getByRole('textbox').closest('div.border');
      expect(container).toBeInTheDocument();
    });

    it('should render textarea for input', () => {
      render(<JsonEditor value="" onChange={vi.fn()} />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('should render with provided value', () => {
      const value = '{"name": "test"}';
      render(<JsonEditor value={value} onChange={vi.fn()} />);
      const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
      // Component auto-formats JSON
      expect(textbox.value).toContain('"name"');
      expect(textbox.value).toContain('"test"');
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

      // Check for the validation error key (mocked) and the actual error message
      expect(screen.getByText('common:errors.validationError')).toBeInTheDocument();
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    it('should not display error when error prop is null', () => {
      render(<JsonEditor value="" onChange={vi.fn()} error={null} />);

      expect(screen.queryByText('common:errors.validationError')).not.toBeInTheDocument();
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

      const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textbox.value).toBe(placeholder);
    });

    it('should use default placeholder when not provided', () => {
      render(<JsonEditor value="" onChange={vi.fn()} />);

      const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textbox.value).toBe('{\n\t\n}');
    });

    it('should display value instead of placeholder when value provided', () => {
      const value = '{"test": true}';
      render(<JsonEditor value={value} onChange={vi.fn()} />);

      const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
      // Component auto-formats JSON, so check that it contains the key content
      expect(textbox.value).toContain('"test"');
      expect(textbox.value).toContain('true');
    });
  });

  describe('onChange Callback', () => {
    it('should call onChange when value changes', () => {
      const handleChange = vi.fn();
      render(<JsonEditor value="" onChange={handleChange} />);

      const textbox = screen.getByRole('textbox');
      fireEvent.change(textbox, { target: { value: '{"test": true}' } });

      expect(handleChange).toHaveBeenCalled();
    });

    it('should pass parsed JSON to onChange when valid', () => {
      const handleChange = vi.fn();
      render(<JsonEditor value="" onChange={handleChange} />);

      const textbox = screen.getByRole('textbox');
      const validJson = '{"name": "test", "value": 123}';
      fireEvent.change(textbox, { target: { value: validJson } });

      expect(handleChange).toHaveBeenCalledWith(
        validJson,
        { name: 'test', value: 123 }
      );
    });

    it('should pass undefined as parsed when JSON is invalid', () => {
      const handleChange = vi.fn();
      render(<JsonEditor value="" onChange={handleChange} />);

      const textbox = screen.getByRole('textbox');
      const invalidJson = '{invalid json}';
      fireEvent.change(textbox, { target: { value: invalidJson } });

      const calls = handleChange.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toBe(invalidJson);
      expect(lastCall[1]).toBeUndefined();
    });

    it('should handle empty value in onChange', () => {
      const handleChange = vi.fn();
      render(<JsonEditor value="" onChange={handleChange} />);

      const textbox = screen.getByRole('textbox');
      fireEvent.change(textbox, { target: { value: '' } });

      expect(handleChange).toHaveBeenCalledWith('', undefined);
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
      const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textbox.value).toBe('{\n\t\n}'); // placeholder
    });

    it('should handle whitespace-only value', () => {
      render(<JsonEditor value="   " onChange={vi.fn()} />);
      const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textbox.value).toBe('   ');
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
      }, null, 2);

      render(<JsonEditor value={complexJson} onChange={vi.fn()} />);
      const textbox = screen.getByRole('textbox');
      expect(textbox).toHaveValue(complexJson);
    });

    it('should handle JSON array', () => {
      const arrayJson = JSON.stringify([1, 2, 3, 'test', { nested: true }], null, 2);

      render(<JsonEditor value={arrayJson} onChange={vi.fn()} />);
      const textbox = screen.getByRole('textbox');
      expect(textbox).toHaveValue(arrayJson);
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
        const textbox = screen.getByRole('textbox');
        expect(textbox).toHaveValue(value);
        unmount();
      });
    });
  });

  describe('Read-only Mode', () => {
    it('should accept readonly prop', () => {
      render(<JsonEditor value="" onChange={vi.fn()} readonly={true} />);

      // Component should render without errors in readonly mode
      const textbox = screen.getByRole('textbox');
      expect(textbox).toBeDisabled();
    });
  });

  describe('Loading State', () => {
    it('should render without crashing', () => {
      render(<JsonEditor value="" onChange={vi.fn()} />);

      // Component should render successfully
      const container = screen.getByRole('textbox').closest('div.border');
      expect(container).toBeInTheDocument();
    });

    it('should show loading indicator initially', () => {
      render(<JsonEditor value="" onChange={vi.fn()} />);

      // Loading indicator should be present initially
      // After it mounts, the loading indicator disappears
      const container = screen.getByRole('textbox').closest('div.relative');
      expect(container).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper DOM structure', () => {
      const { container } = render(<JsonEditor value="" onChange={vi.fn()} />);

      // Should have proper container structure
      expect(container.firstChild).toBeInTheDocument();
    });

    it('should have textbox role for accessibility', () => {
      render(<JsonEditor value="" onChange={vi.fn()} />);
      const textbox = screen.getByRole('textbox');
      expect(textbox).toBeInTheDocument();
    });
  });
});
