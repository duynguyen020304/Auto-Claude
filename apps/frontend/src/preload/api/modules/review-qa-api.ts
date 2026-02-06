/**
 * Review QA API - AI-powered code explanation for human review phase
 */

import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  ReviewQAStreamChunk,
  ReviewQAConfig,
  IPCResult
} from '../../../shared/types';
import { createIpcListener, invokeIpc, sendIpc, IpcListenerCleanup } from './ipc-utils';

/**
 * Active review QA session info
 */
export interface ReviewQASessionInfo {
  sessionId: string;
  specId: string;
  projectId: string;
}

/**
 * Review QA session status
 */
export interface ReviewQAStatus {
  active: boolean;
}

/**
 * Review QA API operations
 */
export interface ReviewQAAPI {
  // Operations
  sendReviewQAMessage: (
    sessionId: string,
    specId: string,
    projectId: string,
    question: string,
    config?: ReviewQAConfig
  ) => void;
  stopReviewQA: (sessionId: string) => Promise<IPCResult>;
  getReviewQAStatus: (sessionId: string) => Promise<IPCResult<ReviewQAStatus>>;
  getReviewQASessions: () => Promise<IPCResult<ReviewQASessionInfo[]>>;

  // Event Listeners
  onReviewQAStreamChunk: (
    callback: (sessionId: string, projectId: string, chunk: ReviewQAStreamChunk) => void
  ) => IpcListenerCleanup;
  onReviewQAProgress: (
    callback: (sessionId: string, projectId: string, status: unknown) => void
  ) => IpcListenerCleanup;
  onReviewQAError: (
    callback: (sessionId: string, projectId: string, error: string) => void
  ) => IpcListenerCleanup;
}

/**
 * Creates the Review QA API implementation
 */
export const createReviewQAAPI = (): ReviewQAAPI => ({
  // Operations
  sendReviewQAMessage: (
    sessionId: string,
    specId: string,
    projectId: string,
    question: string,
    config?: ReviewQAConfig
  ): void =>
    sendIpc(IPC_CHANNELS.REVIEW_QA_SEND_MESSAGE, sessionId, specId, projectId, question, config),

  stopReviewQA: (sessionId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.REVIEW_QA_STOP, sessionId),

  getReviewQAStatus: (sessionId: string): Promise<IPCResult<ReviewQAStatus>> =>
    invokeIpc(IPC_CHANNELS.REVIEW_QA_GET_STATUS, sessionId),

  getReviewQASessions: (): Promise<IPCResult<ReviewQASessionInfo[]>> =>
    invokeIpc(IPC_CHANNELS.REVIEW_QA_GET_LOGS),

  // Event Listeners
  onReviewQAStreamChunk: (
    callback: (sessionId: string, projectId: string, chunk: ReviewQAStreamChunk) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.REVIEW_QA_STREAM_CHUNK, callback),

  onReviewQAProgress: (
    callback: (sessionId: string, projectId: string, status: unknown) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.REVIEW_QA_PROGRESS, callback),

  onReviewQAError: (
    callback: (sessionId: string, projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.REVIEW_QA_ERROR, callback)
});
