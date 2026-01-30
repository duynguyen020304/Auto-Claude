/**
 * Tests for rate limit detection from API response headers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseRateLimitHeaders,
  updateAPIProfileRateLimit,
  type RateLimitInfo
} from '../services/profile-service';

// Mock the api-usage-storage module
vi.mock('../utils/api-usage-storage', () => ({
  updateProfileUsage: vi.fn(),
  getProfileUsage: vi.fn()
}));

import { updateProfileUsage } from '../utils/api-usage-storage';

describe('parseRateLimitHeaders', () => {
  it('should parse Anthropic-specific rate limit headers', () => {
    const response = new Response(null, {
      status: 200,
      headers: {
        'anthropic-ratelimit-requests-remaining': '50',
        'anthropic-ratelimit-requests-limit': '100',
        'anthropic-ratelimit-requests-reset': '1735689600' // Unix timestamp in seconds
      }
    });

    const result = parseRateLimitHeaders(response);

    expect(result.isRateLimited).toBe(false);
    expect(result.is429).toBe(false);
    expect(result.remainingRequests).toBe(50);
    expect(result.requestLimit).toBe(100);
    expect(result.resetTime).toBe(1735689600000); // Converted to milliseconds
  });

  it('should detect rate limiting when remaining requests is 0', () => {
    const response = new Response(null, {
      status: 200,
      headers: {
        'anthropic-ratelimit-requests-remaining': '0',
        'anthropic-ratelimit-requests-limit': '100'
      }
    });

    const result = parseRateLimitHeaders(response);

    expect(result.isRateLimited).toBe(true);
    expect(result.remainingRequests).toBe(0);
  });

  it('should detect 429 Too Many Requests status', () => {
    const response = new Response(null, {
      status: 429,
      headers: {}
    });

    const result = parseRateLimitHeaders(response);

    expect(result.isRateLimited).toBe(true);
    expect(result.is429).toBe(true);
  });

  it('should parse retry-after header with seconds for 429 responses', () => {
    const response = new Response(null, {
      status: 429,
      headers: {
        'retry-after': '60' // 60 seconds
      }
    });

    const result = parseRateLimitHeaders(response);

    expect(result.is429).toBe(true);
    expect(result.isRateLimited).toBe(true);
    expect(result.resetTime).toBeDefined();
    // Reset time should be approximately now + 60 seconds
    const expectedTime = Date.now() + 60000;
    expect(result.resetTime).toBeGreaterThanOrEqual(expectedTime - 1000); // Allow 1s tolerance
    expect(result.resetTime).toBeLessThanOrEqual(expectedTime + 1000);
  });

  it('should parse standard RateLimit headers', () => {
    const response = new Response(null, {
      status: 200,
      headers: {
        'ratelimit-remaining': '25',
        'ratelimit-limit': '50',
        'ratelimit-reset': '1735689600'
      }
    });

    const result = parseRateLimitHeaders(response);

    expect(result.remainingRequests).toBe(25);
    expect(result.requestLimit).toBe(50);
    expect(result.resetTime).toBe(1735689600000);
  });

  it('should parse x-ratelimit headers (alternative naming)', () => {
    const response = new Response(null, {
      status: 200,
      headers: {
        'x-ratelimit-remaining': '10',
        'x-ratelimit-limit': '100'
      }
    });

    const result = parseRateLimitHeaders(response);

    expect(result.remainingRequests).toBe(10);
    expect(result.requestLimit).toBe(100);
  });

  it('should handle response with no rate limit headers', () => {
    const response = new Response(null, {
      status: 200,
      headers: {}
    });

    const result = parseRateLimitHeaders(response);

    expect(result.isRateLimited).toBe(false);
    expect(result.is429).toBe(false);
    expect(result.remainingRequests).toBeUndefined();
    expect(result.requestLimit).toBeUndefined();
    expect(result.resetTime).toBeUndefined();
  });

  it('should handle invalid numeric values in headers', () => {
    const response = new Response(null, {
      status: 200,
      headers: {
        'anthropic-ratelimit-requests-remaining': 'invalid',
        'anthropic-ratelimit-requests-limit': 'not-a-number'
      }
    });

    const result = parseRateLimitHeaders(response);

    expect(result.isRateLimited).toBe(false);
    expect(result.remainingRequests).toBeUndefined();
    expect(result.requestLimit).toBeUndefined();
  });

  it('should prefer Anthropic headers over standard headers', () => {
    const response = new Response(null, {
      status: 200,
      headers: {
        'anthropic-ratelimit-requests-remaining': '50',
        'anthropic-ratelimit-requests-limit': '100',
        'ratelimit-remaining': '25', // Should be ignored
        'ratelimit-limit': '50' // Should be ignored
      }
    });

    const result = parseRateLimitHeaders(response);

    // Should use Anthropic headers
    expect(result.remainingRequests).toBe(50);
    expect(result.requestLimit).toBe(100);
  });

  it('should handle reset timestamp in milliseconds (< year 2286)', () => {
    const response = new Response(null, {
      status: 200,
      headers: {
        'ratelimit-reset': '1735689600000' // Milliseconds
      }
    });

    const result = parseRateLimitHeaders(response);

    // Should detect it's in milliseconds and not multiply
    expect(result.resetTime).toBe(1735689600000);
  });
});

describe('updateAPIProfileRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update profile usage with rate limit info', () => {
    const response = new Response(null, {
      status: 200,
      headers: {
        'anthropic-ratelimit-requests-remaining': '50',
        'anthropic-ratelimit-requests-limit': '100'
      }
    });

    const result = updateAPIProfileRateLimit('test-profile-1', response);

    expect(result.isRateLimited).toBe(false);
    expect(result.remainingRequests).toBe(50);
    expect(updateProfileUsage).toHaveBeenCalledWith(
      'test-profile-1',
      expect.objectContaining({
        isRateLimited: false,
        rateLimitResetTime: undefined
      })
    );
  });

  it('should mark profile as rate limited when remaining is 0', () => {
    const response = new Response(null, {
      status: 200,
      headers: {
        'anthropic-ratelimit-requests-remaining': '0',
        'anthropic-ratelimit-requests-reset': '1735689600'
      }
    });

    const result = updateAPIProfileRateLimit('test-profile-1', response);

    expect(result.isRateLimited).toBe(true);
    expect(updateProfileUsage).toHaveBeenCalledWith(
      'test-profile-1',
      expect.objectContaining({
        isRateLimited: true,
        rateLimitResetTime: 1735689600000
      })
    );
  });

  it('should handle 429 response with retry-after', () => {
    const response = new Response(null, {
      status: 429,
      headers: {
        'retry-after': '120'
      }
    });

    const result = updateAPIProfileRateLimit('test-profile-1', response);

    expect(result.is429).toBe(true);
    expect(result.isRateLimited).toBe(true);
    expect(updateProfileUsage).toHaveBeenCalledWith(
      'test-profile-1',
      expect.objectContaining({
        isRateLimited: true,
        rateLimitResetTime: expect.any(Number)
      })
    );
  });
});
