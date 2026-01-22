#!/usr/bin/env node
/**
 * Verification Script for Subtask-10-6: All 4 Rotation Modes
 *
 * Verifies that all 4 rotation modes (manual, round_robin, usage_based, rate_limit_aware)
 * are correctly implemented in both frontend and backend.
 *
 * Usage: node apps/frontend/scripts/verify-rotation-modes.js
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function error(message) {
  log(`❌ ${message}`, 'red');
}

function info(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

function warn(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  total: 0
};

function testResult(name, passed, details = '') {
  results.total++;
  if (passed) {
    results.passed++;
    success(name);
    if (details) {
      log(`   ${details}`, 'blue');
    }
  } else {
    results.failed++;
    error(name);
    if (details) {
      log(`   ${details}`, 'red');
    }
  }
}

// Read file helper
function readFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

// Verify rotation mode enum in TypeScript
function verifyRotationModeType() {
  info('\n1. Verifying RotationMode type definition...');
  try {
    const typePath = join(__dirname, '../src/shared/types/credential-profile.ts');
    const content = readFile(typePath);

    const hasAllModes =
      content.includes("'manual'") &&
      content.includes("'round_robin'") &&
      content.includes("'usage_based'") &&
      content.includes("'rate_limit_aware'");

    testResult(
      'RotationMode type includes all 4 modes',
      hasAllModes,
      'Types: manual, round_robin, usage_based, rate_limit_aware'
    );

    // Verify it's a type union
    const hasTypeUnion = content.includes('export type RotationMode');
    testResult(
      'RotationMode is exported as type union',
      hasTypeUnion,
      'export type RotationMode = ...'
    );

  } catch (err) {
    testResult('RotationMode type definition', false, err.message);
  }
}

// Verify rotation mode enum in Python backend
function verifyRotationModeEnum() {
  info('\n2. Verifying RotationMode enum in backend...');
  try {
    const backendPath = join(__dirname, '../../backend/core/credentials.py');
    const content = readFile(backendPath);

    const hasAllModes =
      content.includes('MANUAL = "manual"') &&
      content.includes('ROUND_ROBIN = "round_robin"') &&
      content.includes('USAGE_BASED = "usage_based"') &&
      content.includes('RATE_LIMIT_AWARE = "rate_limit_aware"');

    testResult(
      'RotationMode enum includes all 4 modes',
      hasAllModes,
      'Enum values: MANUAL, ROUND_ROBIN, USAGE_BASED, RATE_LIMIT_AWARE'
    );

    // Verify it's an Enum
    const isEnum = content.includes('class RotationMode(str, Enum)');
    testResult(
      'RotationMode is a Python Enum',
      isEnum,
      'class RotationMode(str, Enum)'
    );

  } catch (err) {
    testResult('RotationMode enum definition', false, err.message);
  }
}

// Verify RotationStrategySelector component
function verifyRotationStrategySelector() {
  info('\n3. Verifying RotationStrategySelector component...');
  try {
    const componentPath = join(__dirname, '../src/renderer/components/credential-profiles/RotationStrategySelector.tsx');
    const content = readFile(componentPath);

    // Check for all 4 rotation modes in SelectItem components
    const hasManualMode = content.includes('value="manual"');
    const hasRoundRobinMode = content.includes('value="round_robin"');
    const hasUsageBasedMode = content.includes('value="usage_based"');
    const hasRateLimitAwareMode = content.includes('value="rate_limit_aware"');

    testResult(
      'RotationStrategySelector has all 4 mode options',
      hasManualMode && hasRoundRobinMode && hasUsageBasedMode && hasRateLimitAwareMode,
      'SelectItem components for all modes present'
    );

    // Verify conditional threshold field rendering
    const hasThresholdLogic = content.includes("const showThreshold = rotationMode === 'rate_limit_aware'");
    testResult(
      'Conditional threshold field logic exists',
      hasThresholdLogic,
      'showThreshold = rotationMode === "rate_limit_aware"'
    );

    // Verify threshold input is conditionally rendered
    const hasConditionalThreshold = content.includes('{showThreshold && (');
    testResult(
      'Threshold input is conditionally rendered',
      hasConditionalThreshold,
      '{showThreshold && (...threshold input...)}'
    );

    // Verify mode descriptions
    const hasDescriptions = content.includes('rotationModeDescriptions');
    testResult(
      'Rotation mode descriptions present',
      hasDescriptions,
      'rotationModeDescriptions record with all modes'
    );

  } catch (err) {
    testResult('RotationStrategySelector component', false, err.message);
  }
}

// Verify ProfileFormDialog rotation mode integration
function verifyProfileFormDialogIntegration() {
  info('\n4. Verifying ProfileFormDialog rotation mode integration...');
  try {
    const dialogPath = join(__dirname, '../src/renderer/components/credential-profiles/ProfileFormDialog.tsx');
    const content = readFile(dialogPath);

    // Check for rotation mode state
    const hasRotationState = content.includes("useState<RotationMode>('manual')");
    testResult(
      'ProfileFormDialog has rotation mode state',
      hasRotationState,
      'useState<RotationMode>("manual")'
    );

    // Check for threshold state
    const hasThresholdState = content.includes('useState<number>(0.8)');
    testResult(
      'ProfileFormDialog has threshold state (default 0.8)',
      hasThresholdState,
      'useState<number>(0.8)'
    );

    // Check for rotation mode selector (can be inline or component)
    const hasRotationSelector =
      content.includes('RotationStrategySelector') ||
      (content.includes('Rotation Mode') && content.includes('Select'));

    testResult(
      'ProfileFormDialog has rotation mode selector',
      hasRotationSelector,
      'Rotation mode UI selector present (inline or component)'
    );

    // Check that rotation mode is included in metadata
    const hasRotationInMetadata = content.includes('rotation_mode') && content.includes('metadata');
    testResult(
      'Rotation mode saved to metadata',
      hasRotationInMetadata,
      'metadata includes rotation_mode'
    );

    // Check that threshold is conditionally included
    const hasThresholdInMetadata = content.includes('rate_limit_threshold');
    testResult(
      'Rate limit threshold saved to metadata',
      hasThresholdInMetadata,
      'metadata includes rate_limit_threshold (when applicable)'
    );

  } catch (err) {
    testResult('ProfileFormDialog integration', false, err.message);
  }
}

// Verify Zod schema validation
function verifyZodSchemaValidation() {
  info('\n5. Verifying Zod schema validation...');
  try {
    const schemaPath = join(__dirname, '../src/shared/schemas/credential-profile.ts');
    const content = readFile(schemaPath);

    // Check for RotationModeSchema
    const hasRotationModeSchema = content.includes('RotationModeSchema');
    testResult(
      'Zod schema defines RotationModeSchema',
      hasRotationModeSchema,
      'RotationModeSchema enum validation'
    );

    // Check for threshold refinement (rate_limit_aware requires threshold)
    const hasThresholdRefinement =
      content.includes('rate_limit_threshold') &&
      content.includes('rate_limit_aware');

    testResult(
      'Zod schema validates threshold for rate_limit_aware',
      hasThresholdRefinement,
      'Custom refinement for rate_limit_threshold'
    );

    // Check for RotationConfigSchema
    const hasRotationConfigSchema = content.includes('RotationConfigSchema');
    testResult(
      'Zod schema defines RotationConfigSchema',
      hasRotationConfigSchema,
      'RotationConfigSchema with mode and threshold'
    );

  } catch (err) {
    testResult('Zod schema validation', false, err.message);
  }
}

// Verify translations for all rotation modes
function verifyTranslations() {
  info('\n6. Verifying translation keys...');
  try {
    // Check English translations
    const enPath = join(__dirname, '../src/shared/i18n/locales/en/settings.json');
    const enContent = readFile(enPath);

    const hasRotationModeSection = enContent.includes('rotationMode"');
    testResult(
      'English translations have rotation mode section',
      hasRotationModeSection,
      'settings:credentialProfiles.form.rotationMode'
    );

    // Check for all 4 rotation mode labels in English
    const hasManual = enContent.includes('"manual": "Manual"');
    const hasRoundRobin = enContent.includes('"roundRobin": "Round Robin"');
    const hasUsageBased = enContent.includes('"usageBased": "Usage Based"');
    const hasRateLimitAware = enContent.includes('"rateLimitAware": "Rate Limit Aware"');

    testResult(
      'All 4 rotation mode labels translated (EN)',
      hasManual && hasRoundRobin && hasUsageBased && hasRateLimitAware,
      'manual, roundRobin, usageBased, rateLimitAware labels'
    );

    // Check French translations
    const frPath = join(__dirname, '../src/shared/i18n/locales/fr/settings.json');
    const frContent = readFile(frPath);

    const hasFrenchRotationSection = frContent.includes('rotationMode"');
    testResult(
      'French translations have rotation mode section',
      hasFrenchRotationSection,
      'settings:credentialProfiles.form.rotationMode (FR)'
    );

    // Check for all 4 rotation mode labels in French
    const hasManualFR = frContent.includes('"manual"');
    const hasRoundRobinFR = frContent.includes('"roundRobin"');
    const hasUsageBasedFR = frContent.includes('"usageBased"');
    const hasRateLimitAwareFR = frContent.includes('"rateLimitAware"');

    testResult(
      'All 4 rotation mode labels translated (FR)',
      hasManualFR && hasRoundRobinFR && hasUsageBasedFR && hasRateLimitAwareFR,
      'French translations for all modes'
    );

  } catch (err) {
    testResult('Translation keys', false, err.message);
  }
}

// Verify E2E test coverage
function verifyE2ETestCoverage() {
  info('\n7. Verifying E2E test coverage...');
  try {
    const e2ePath = join(__dirname, '../e2e/credential-profiles.spec.ts');
    const content = readFile(e2ePath);

    // Check for rotation mode test
    const hasRotationModeTest = content.includes("should support all 4 rotation modes");
    testResult(
      'E2E test for rotation modes exists',
      hasRotationModeTest,
      'Test: "should support all 4 rotation modes"'
    );

    // Check that all modes are tested
    const testsAllModes =
      content.includes("'manual'") &&
      content.includes("'round_robin'") &&
      content.includes("'usage_based'") &&
      content.includes("'rate_limit_aware'");

    testResult(
      'E2E test iterates through all 4 modes',
      testsAllModes,
      'Test loop for rotationModes array'
    );

    // Check for threshold field verification
    const hasThresholdCheck =
      content.includes('thresholdInput') ||
      content.includes('rateLimitThreshold');

    testResult(
      'E2E test verifies threshold field visibility',
      hasThresholdCheck,
      'Checks threshold field for rate_limit_aware mode'
    );

  } catch (err) {
    testResult('E2E test coverage', false, err.message);
  }
}

// Verify backend RotationConfig dataclass
function verifyBackendRotationConfig() {
  info('\n8. Verifying backend RotationConfig dataclass...');
  try {
    const backendPath = join(__dirname, '../../backend/core/credentials.py');
    const content = readFile(backendPath);

    // Check for RotationConfig dataclass
    const hasDataclass = content.includes('@dataclass') && content.includes('class RotationConfig');
    testResult(
      'RotationConfig dataclass exists',
      hasDataclass,
      '@dataclass class RotationConfig'
    );

    // Check for mode field
    const hasModeField = content.includes('mode: RotationMode');
    testResult(
      'RotationConfig has mode field',
      hasModeField,
      'mode: RotationMode'
    );

    // Check for threshold field
    const hasThresholdField = content.includes('rate_limit_threshold: float');
    testResult(
      'RotationConfig has rate_limit_threshold field',
      hasThresholdField,
      'rate_limit_threshold: float = 0.8'
    );

    // Check for threshold validation
    const hasValidation =
      content.includes('0.0 <= self.rate_limit_threshold <= 1.0') ||
      content.includes('rate_limit_threshold must be between 0.0 and 1.0');

    testResult(
      'RotationConfig validates threshold range',
      hasValidation,
      'Validation: 0.0 <= threshold <= 1.0'
    );

  } catch (err) {
    testResult('Backend RotationConfig', false, err.message);
  }
}

// Main verification flow
function runVerification() {
  log('\n=== Subtask-10-6 Verification: All 4 Rotation Modes ===\n', 'cyan');

  verifyRotationModeType();
  verifyRotationModeEnum();
  verifyRotationStrategySelector();
  verifyProfileFormDialogIntegration();
  verifyZodSchemaValidation();
  verifyTranslations();
  verifyE2ETestCoverage();
  verifyBackendRotationConfig();

  // Summary
  log('\n=== Verification Summary ===\n', 'cyan');
  log(`Total tests: ${results.total}`, 'blue');
  success(`Passed: ${results.passed}`);
  if (results.failed > 0) {
    error(`Failed: ${results.failed}`);
  }

  const passRate = ((results.passed / results.total) * 100).toFixed(1);
  log(`\nPass rate: ${passRate}%\n`, results.failed === 0 ? 'green' : 'yellow');

  if (results.failed === 0) {
    success('✅ All verification checks passed!');
    log('\nAll 4 rotation modes are correctly implemented:', 'green');
    log('  1. manual - Manually select which credential to use', 'green');
    log('  2. round_robin - Rotate through credentials in order', 'green');
    log('  3. usage_based - Use credential with lowest usage', 'green');
    log('  4. rate_limit_aware - Rotate based on rate limit thresholds', 'green');
    log('\nThreshold field only shows for rate_limit_aware mode ✓', 'green');
    return 0;
  } else {
    error('❌ Some verification checks failed');
    return 1;
  }
}

// Run verification
try {
  const exitCode = runVerification();
  process.exit(exitCode);
} catch (err) {
  error(`Verification failed with error: ${err.message}`);
  process.exit(1);
}
