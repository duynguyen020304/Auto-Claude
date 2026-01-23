import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import English translation resources
import enCommon from './locales/en/common.json';
import enNavigation from './locales/en/navigation.json';
import enSettings from './locales/en/settings.json';
import enTasks from './locales/en/tasks.json';
import enWelcome from './locales/en/welcome.json';
import enOnboarding from './locales/en/onboarding.json';
import enDialogs from './locales/en/dialogs.json';
import enGitlab from './locales/en/gitlab.json';
import enTaskReview from './locales/en/taskReview.json';
import enTerminal from './locales/en/terminal.json';
import enErrors from './locales/en/errors.json';
import enInsights from './locales/en/insights.json';
import enChangelog from './locales/en/changelog.json';
import enRoadmap from './locales/en/roadmap.json';
import enIdeation from './locales/en/ideation.json';

// Import French translation resources
import frCommon from './locales/fr/common.json';
import frNavigation from './locales/fr/navigation.json';
import frSettings from './locales/fr/settings.json';
import frTasks from './locales/fr/tasks.json';
import frWelcome from './locales/fr/welcome.json';
import frOnboarding from './locales/fr/onboarding.json';
import frDialogs from './locales/fr/dialogs.json';
import frGitlab from './locales/fr/gitlab.json';
import frTaskReview from './locales/fr/taskReview.json';
import frTerminal from './locales/fr/terminal.json';
import frErrors from './locales/fr/errors.json';
import frInsights from './locales/fr/insights.json';
import frChangelog from './locales/fr/changelog.json';
import frRoadmap from './locales/fr/roadmap.json';
import frIdeation from './locales/fr/ideation.json';

// Import Vietnamese translation resources
import viCommon from './locales/vi/common.json';
import viNavigation from './locales/vi/navigation.json';
import viSettings from './locales/vi/settings.json';
import viTasks from './locales/vi/tasks.json';
import viWelcome from './locales/vi/welcome.json';
import viOnboarding from './locales/vi/onboarding.json';
import viDialogs from './locales/vi/dialogs.json';
import viGitlab from './locales/vi/gitlab.json';
import viTaskReview from './locales/vi/taskReview.json';
import viTerminal from './locales/vi/terminal.json';
import viErrors from './locales/vi/errors.json';
import viInsights from './locales/vi/insights.json';
import viChangelog from './locales/vi/changelog.json';
import viRoadmap from './locales/vi/roadmap.json';
import viIdeation from './locales/vi/ideation.json';

export const defaultNS = 'common';

export const resources = {
  en: {
    changelog: enChangelog,
    common: enCommon,
    navigation: enNavigation,
    settings: enSettings,
    tasks: enTasks,
    welcome: enWelcome,
    onboarding: enOnboarding,
    dialogs: enDialogs,
    gitlab: enGitlab,
    taskReview: enTaskReview,
    terminal: enTerminal,
    errors: enErrors,
    insights: enInsights,
    roadmap: enRoadmap,
    ideation: enIdeation
  },
  fr: {
    changelog: frChangelog,
    common: frCommon,
    navigation: frNavigation,
    settings: frSettings,
    tasks: frTasks,
    welcome: frWelcome,
    onboarding: frOnboarding,
    dialogs: frDialogs,
    gitlab: frGitlab,
    taskReview: frTaskReview,
    terminal: frTerminal,
    errors: frErrors,
    insights: frInsights,
    roadmap: frRoadmap,
    ideation: frIdeation
  },
  vi: {
    changelog: viChangelog,
    common: viCommon,
    navigation: viNavigation,
    settings: viSettings,
    tasks: viTasks,
    welcome: viWelcome,
    onboarding: viOnboarding,
    dialogs: viDialogs,
    gitlab: viGitlab,
    taskReview: viTaskReview,
    terminal: viTerminal,
    errors: viErrors,
    insights: viInsights,
    roadmap: viRoadmap,
    ideation: viIdeation
  }
} as const;

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en', // Default language (will be overridden by settings)
    fallbackLng: 'en',
    defaultNS,
    ns: ['changelog', 'common', 'navigation', 'onboarding', 'roadmap', 'settings', 'tasks', 'welcome', 'dialogs', 'gitlab', 'taskReview', 'terminal', 'errors', 'insights', 'ideation'],
    interpolation: {
      escapeValue: false // React already escapes values
    },
    react: {
      useSuspense: false // Disable suspense for Electron compatibility
    }
  });

export default i18n;
