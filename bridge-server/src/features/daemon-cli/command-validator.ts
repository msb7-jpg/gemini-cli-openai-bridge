/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

const KNOWN_COMMANDS = [
  "start",
  "status",
  "quota",
  "usage",
  "stop",
  "restart",
  "logs",
  "help",
  "version",
] as const;

type KnownCommand = (typeof KNOWN_COMMANDS)[number];

export interface CommandValidationResult {
  isValid: boolean;
  command?: string;
  suggestion?: string;
  error?: string;
}

/**
 * Computes standard Levenshtein distance between two strings.
 *
 * @param source - Source string.
 * @param target - Target string.
 * @returns Minimum single-character edits (insertions, deletions, substitutions).
 */
export function computeLevenshteinDistance(source: string, target: string): number {
  const matrix: number[][] = [];
  for (let row = 0; row <= source.length; row++) {
    matrix[row] = [row];
  }
  for (let col = 0; col <= target.length; col++) {
    matrix[0][col] = col;
  }

  for (let row = 1; row <= source.length; row++) {
    for (let col = 1; col <= target.length; col++) {
      const substitutionCost = source[row - 1] === target[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + substitutionCost,
      );
    }
  }

  return matrix[source.length][target.length];
}

/**
 * Searches for the closest known command matching the input if within distance threshold.
 *
 * @param input - The unrecognized command string.
 * @param maxDistance - Maximum edit distance to consider a match (defaults to 2).
 * @returns The closest known command name or undefined.
 */
export function findClosestCommand(input: string, maxDistance = 2): string | undefined {
  const normalizedInput = input.toLowerCase();
  let closestMatch: string | undefined;
  let lowestDistance = maxDistance + 1;

  for (const candidate of KNOWN_COMMANDS) {
    const distance = computeLevenshteinDistance(normalizedInput, candidate);
    if (distance <= maxDistance && distance < lowestDistance) {
      lowestDistance = distance;
      closestMatch = candidate;
    }
  }

  return closestMatch;
}

/**
 * Validates CLI arguments and checks for unrecognized subcommands or typos.
 *
 * @param rawArgs - CLI argument array from `process.argv.slice(2)`.
 * @returns Result with validation state, detected command, and suggestions if invalid.
 */
export function validateCliCommand(rawArgs: string[]): CommandValidationResult {
  if (rawArgs.length === 0) {
    return { isValid: true };
  }

  const firstArg = rawArgs[0];
  if (!firstArg || firstArg.startsWith("-")) {
    return { isValid: true };
  }

  const normalized = firstArg.toLowerCase();
  const isKnown = KNOWN_COMMANDS.includes(normalized as KnownCommand);

  if (isKnown) {
    return { isValid: true, command: normalized };
  }

  const suggestion = findClosestCommand(normalized);
  const errorMessage = suggestion
    ? `Unknown command: "${firstArg}". Did you mean "${suggestion}"?`
    : `Unknown command: "${firstArg}".`;

  return {
    isValid: false,
    command: firstArg,
    suggestion,
    error: errorMessage,
  };
}
