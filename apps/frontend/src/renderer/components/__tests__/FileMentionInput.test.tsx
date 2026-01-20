/**
 * @vitest-environment jsdom
 */
/**
 * Tests for FileMentionInput component
 * Tests rendering, props handling, @ mention detection, and visual highlighting
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FileMentionInput } from '../FileMentionInput';

// Mock the file-explorer-store
const mockLoadDirectory = vi.fn();
const mockFiles = new Map();

vi.mock('../../stores/file-explorer-store', () => ({
  useFileExplorerStore: vi.fn(() => ({
    loadDirectory: mockLoadDirectory,
    files: mockFiles
  }))
}));

// Mock FileAutocomplete component
vi.mock('../FileAutocomplete', () => ({
  FileAutocomplete: ({ query, onSelect, onClose }: {
    query: string;
    projectPath: string;
    position: { top: number; left: number };
    onSelect: (filename: string, fullPath: string) => void;
    onClose: () => void;
  }) => (
    <div data-testid="file-autocomplete">
      <div data-testid="autocomplete-query">{query}</div>
      <button
        data-testid="select-file-btn"
        onClick={() => onSelect('test-file.tsx', '/project/src/test-file.tsx')}
      >
        Select test-file.tsx
      </button>
      <button
        data-testid="close-autocomplete-btn"
        onClick={onClose}
      >
        Close
      </button>
    </div>
  )
}));

describe('FileMentionInput', () => {
  // Mock callbacks
  const mockOnChange = vi.fn();
  const mockOnFileMentioned = vi.fn();

  // Default props
  const defaultProps = {
    value: '',
    onChange: mockOnChange,
    projectPath: '/test/project',
    placeholder: 'Type @ to mention files...',
    rows: 4,
    disabled: false,
    id: 'test-input',
    ariaLabel: 'Test file mention input',
    onFileMentioned: mockOnFileMentioned
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    mockFiles.clear();
  });

  describe('Rendering and Basic Props', () => {
    it('should render textarea with correct attributes', () => {
      render(<FileMentionInput {...defaultProps} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveAttribute('id', 'test-input');
      expect(textarea).toHaveAttribute('aria-label', 'Test file mention input');
      expect(textarea).toHaveAttribute('rows', '4');
      expect(textarea).not.toBeDisabled();
    });

    it('should render with custom placeholder', () => {
      render(<FileMentionInput {...defaultProps} placeholder="Custom placeholder" />);

      const textarea = screen.getByPlaceholderText('Custom placeholder');
      expect(textarea).toBeInTheDocument();
    });

    it('should render with provided value', () => {
      render(<FileMentionInput {...defaultProps} value="Hello world" />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue('Hello world');
    });

    it('should be disabled when disabled prop is true', () => {
      render(<FileMentionInput {...defaultProps} disabled={true} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
    });

    it('should load project directory on mount', () => {
      render(<FileMentionInput {...defaultProps} projectPath="/test/project" />);

      expect(mockLoadDirectory).toHaveBeenCalledWith('/test/project');
    });

    it('should not load directory when projectPath is empty', () => {
      render(<FileMentionInput {...defaultProps} projectPath="" />);

      expect(mockLoadDirectory).not.toHaveBeenCalled();
    });
  });

  describe('@ Mention Rendering', () => {
    it('should render @ symbol in textarea', () => {
      render(<FileMentionInput {...defaultProps} value="@" />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue('@');
    });

    it('should render @ with file extension', () => {
      render(<FileMentionInput {...defaultProps} value="@src/App.tsx" />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue('@src/App.tsx');
    });

    it('should render @ in middle of text', () => {
      render(<FileMentionInput {...defaultProps} value="Check @src/App.tsx for details" />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue('Check @src/App.tsx for details');
    });

    it('should render text without @ symbols', () => {
      render(<FileMentionInput {...defaultProps} value="Hello world" />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue('Hello world');
    });
  });

  describe('Visual Highlighting Overlay', () => {
    it('should render highlight overlay', () => {
      render(<FileMentionInput {...defaultProps} />);

      const overlay = screen.getByTestId('highlight-overlay');
      expect(overlay).toBeInTheDocument();
    });

    it('should highlight @ mentions in overlay', () => {
      const { container } = render(
        <FileMentionInput {...defaultProps} value="Check @App.tsx and @utils.ts" />
      );

      const overlay = container.querySelector('[data-testid="highlight-overlay"]');
      expect(overlay).toBeInTheDocument();

      // Check for highlighted spans with mention styling
      const highlights = overlay?.querySelectorAll('.bg-info\\/20');
      expect(highlights?.length).toBeGreaterThan(0);
    });

    it('should highlight mentions with line ranges', () => {
      const { container } = render(
        <FileMentionInput {...defaultProps} value="@App.tsx:10-20" />
      );

      const overlay = container.querySelector('[data-testid="highlight-overlay"]');
      expect(overlay).toBeInTheDocument();

      // Check for highlighted mention with line range
      const highlights = overlay?.querySelectorAll('.bg-info\\/20');
      expect(highlights?.length).toBeGreaterThan(0);
    });

    it('should not highlight non-mentions', () => {
      const { container } = render(
        <FileMentionInput {...defaultProps} value="Regular text without mentions" />
      );

      const overlay = container.querySelector('[data-testid="highlight-overlay"]');
      const highlights = overlay?.querySelectorAll('.bg-info\\/20');

      // Should have no highlights
      expect(highlights?.length).toBe(0);
    });
  });

  describe('Value Rendering', () => {
    it('should display empty value', () => {
      render(<FileMentionInput {...defaultProps} value="" />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue('');
    });

    it('should display @ mentions in value', () => {
      render(<FileMentionInput {...defaultProps} value="@file.tsx" />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue('@file.tsx');
    });

    it('should display multiple @ mentions', () => {
      render(
        <FileMentionInput {...defaultProps} value="@first.tsx and @second.tsx" />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue('@first.tsx and @second.tsx');
    });

    it('should display @ with line ranges', () => {
      render(<FileMentionInput {...defaultProps} value="@App.tsx:10-20" />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue('@App.tsx:10-20');
    });

    it('should display @ with special characters', () => {
      render(<FileMentionInput {...defaultProps} value="@file-with-dash.js" />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue('@file-with-dash.js');
    });
  });

  describe('Accessibility', () => {
    it('should have correct ARIA label', () => {
      render(<FileMentionInput {...defaultProps} ariaLabel="Custom ARIA label" />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveAttribute('aria-label', 'Custom ARIA label');
    });

    it('should work without ariaLabel', () => {
      render(<FileMentionInput {...defaultProps} ariaLabel={undefined} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeInTheDocument();
    });
  });

  describe('Disabled State', () => {
    it('should not trigger autocomplete when disabled', () => {
      render(<FileMentionInput {...defaultProps} disabled={true} value="@" />);

      // Autocomplete should not appear for disabled input
      expect(screen.queryByTestId('file-autocomplete')).not.toBeInTheDocument();
    });

    it('should not allow typing when disabled', () => {
      render(<FileMentionInput {...defaultProps} disabled={true} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
    });
  });
});
