import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import type { WorktreeDiffFile } from '../../../../shared/types';

interface QuickQuestionChipsProps {
  changedFiles: WorktreeDiffFile[];
  onQuestionClick: (question: string) => void;
}

export function QuickQuestionChips({ changedFiles, onQuestionClick }: QuickQuestionChipsProps) {
  const { t } = useTranslation(['tasks']);

  // Generate suggested questions based on changed files
  const suggestedQuestions = useMemo(() => {
    const questions: string[] = [];

    // Always add general summary question
    questions.push(t('tasks:reviewQA.quickQuestions.summary', 'Summarize all changes'));

    if (changedFiles.length === 0) {
      return questions;
    }

    // Add questions about specific files (limit to first 5 to avoid overwhelming UI)
    const filesToShow = changedFiles.slice(0, 5);

    for (const file of filesToShow) {
      const fileName = file.path.split('/').pop() || file.path;

      // Generate different questions based on file type
      // Note: Translation keys will be added in subtask-6-1
      if (file.status === 'deleted') {
        questions.push(
          t('tasks:reviewQA.quickQuestions.whyDeleted', `Why was ${fileName} deleted?`, { fileName })
        );
      } else if (file.status === 'added') {
        questions.push(
          t('tasks:reviewQA.quickQuestions.whatIsNew', `What is the purpose of ${fileName}?`, { fileName })
        );
      } else {
        questions.push(
          t('tasks:reviewQA.quickQuestions.explainChange', `Explain changes to ${fileName}`, { fileName }),
          t('tasks:reviewQA.quickQuestions.whyChange', `Why was ${fileName} modified?`, { fileName })
        );
      }
    }

    return questions;
  }, [changedFiles, t]);

  // Only show chips if we have changed files
  if (changedFiles.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {suggestedQuestions.map((question) => (
        <Button
          key={question}
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => onQuestionClick(question)}
        >
          {question}
        </Button>
      ))}
    </div>
  );
}

// Helper function to generate questions (can be used for testing)
export function generateQuickQuestions(
  changedFiles: WorktreeDiffFile[],
  t: (key: string, defaultValue: string, params?: Record<string, string | number>) => string
): string[] {
  const questions: string[] = [];

  // Always add general summary question
  questions.push(t('tasks:reviewQA.quickQuestions.summary', 'Summarize all changes'));

  if (changedFiles.length === 0) {
    return questions;
  }

  // Add questions about specific files (limit to first 5)
  const filesToShow = changedFiles.slice(0, 5);

  for (const file of filesToShow) {
    const fileName = file.path.split('/').pop() || file.path;

    // Generate different questions based on file type
    if (file.status === 'deleted') {
      questions.push(
        t('tasks:reviewQA.quickQuestions.whyDeleted', `Why was ${fileName} deleted?`, { fileName })
      );
    } else if (file.status === 'added') {
      questions.push(
        t('tasks:reviewQA.quickQuestions.whatIsNew', `What is the purpose of ${fileName}?`, { fileName })
      );
    } else {
      questions.push(
        t('tasks:reviewQA.quickQuestions.explainChange', `Explain changes to ${fileName}`, { fileName }),
        t('tasks:reviewQA.quickQuestions.whyChange', `Why was ${fileName} modified?`, { fileName })
      );
    }
  }

  return questions;
}
