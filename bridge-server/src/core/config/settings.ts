/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import {
  getErrorMessage,
  type BugCommandSettings,
  type TelemetrySettings,
  type AuthType,
} from "@google/gemini-cli-core";
import stripJsonComments from "strip-json-comments";

const SETTINGS_DIRECTORY_NAME = ".gemini";
export const USER_SETTINGS_DIR = path.join(homedir(), SETTINGS_DIRECTORY_NAME);
const USER_SETTINGS_PATH = path.join(USER_SETTINGS_DIR, "settings.json");

export interface SecurityPolicy {
  mode?: "read-only" | "edit" | "configured" | "yolo";
  allowedTools?: string[];
  shellCommandPolicy?: {
    allow?: string[];
    deny?: string[];
  };
}

interface CheckpointingSettings {
  enabled?: boolean;
}

interface AccessibilitySettings {
  disableLoadingPhrases?: boolean;
}

export interface Settings {
  theme?: string;
  selectedAuthType?: AuthType;
  sandbox?: boolean | string;
  coreTools?: string[];
  excludeTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  showMemoryUsage?: boolean;
  contextFileName?: string | string[];
  accessibility?: AccessibilitySettings;
  telemetry?: TelemetrySettings;
  usageStatisticsEnabled?: boolean;
  preferredEditor?: string;
  bugCommand?: BugCommandSettings;
  checkpointing?: CheckpointingSettings;
  autoConfigureMaxOldSpaceSize?: boolean;
  securityPolicy?: SecurityPolicy;
  fileFiltering?: {
    respectGitIgnore?: boolean;
    enableRecursiveFileSearch?: boolean;
  };
  hideWindowTitle?: boolean;
  hideTips?: boolean;
}

interface SettingsError {
  message: string;
  path: string;
}

interface SettingsFile {
  settings: Settings;
  path: string;
}

class LoadedSettings {
  readonly user: SettingsFile;
  readonly workspace: SettingsFile;
  readonly errors: SettingsError[];
  private _merged: Settings;

  constructor(user: SettingsFile, workspace: SettingsFile, errors: SettingsError[]) {
    this.user = user;
    this.workspace = workspace;
    this.errors = errors;
    this._merged = this.computeMergedSettings();
  }

  get merged(): Settings {
    return this._merged;
  }

  private computeMergedSettings(): Settings {
    return {
      ...this.user.settings,
      ...this.workspace.settings,
    };
  }
}

function resolveEnvVarsInString(value: string): string {
  const envVarRegex = /\$(?:(\w+)|{([^}]+)})/g;
  return value.replace(envVarRegex, (match, varName1, varName2) => {
    const varName = varName1 || varName2;
    if (process && process.env && typeof process.env[varName] === "string") {
      return process.env[varName]!;
    }
    return match;
  });
}

function resolveEnvVarsInObject<TValue>(obj: TValue): TValue {
  if (obj === null || obj === undefined || typeof obj === "boolean" || typeof obj === "number") {
    return obj;
  }

  if (typeof obj === "string") {
    return resolveEnvVarsInString(obj) as unknown as TValue;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVarsInObject(item)) as unknown as TValue;
  }

  if (typeof obj === "object") {
    const newObj = { ...obj } as TValue;
    for (const key in newObj) {
      if (Object.prototype.hasOwnProperty.call(newObj, key)) {
        newObj[key] = resolveEnvVarsInObject(newObj[key]);
      }
    }
    return newObj;
  }

  return obj;
}

/**
 * Loads settings from user and workspace directories.
 * Project settings override user settings.
 * @param workspaceDir - The workspace directory to load settings from.
 * @returns The loaded settings instance.
 */
export function loadSettings(workspaceDir: string): LoadedSettings {
  let userSettings: Settings = {};
  let workspaceSettings: Settings = {};
  const settingsErrors: SettingsError[] = [];

  try {
    if (fs.existsSync(USER_SETTINGS_PATH)) {
      const userContent = fs.readFileSync(USER_SETTINGS_PATH, "utf-8");
      const parsedUserSettings = JSON.parse(stripJsonComments(userContent)) as Settings;
      userSettings = resolveEnvVarsInObject(parsedUserSettings);
    }
  } catch (error: unknown) {
    settingsErrors.push({
      message: getErrorMessage(error),
      path: USER_SETTINGS_PATH,
    });
  }

  const workspaceSettingsPath = path.join(workspaceDir, SETTINGS_DIRECTORY_NAME, "settings.json");

  try {
    if (fs.existsSync(workspaceSettingsPath)) {
      const projectContent = fs.readFileSync(workspaceSettingsPath, "utf-8");
      const parsedWorkspaceSettings = JSON.parse(stripJsonComments(projectContent)) as Settings;
      workspaceSettings = resolveEnvVarsInObject(parsedWorkspaceSettings);
    }
  } catch (error: unknown) {
    settingsErrors.push({
      message: getErrorMessage(error),
      path: workspaceSettingsPath,
    });
  }

  return new LoadedSettings(
    {
      path: USER_SETTINGS_PATH,
      settings: userSettings,
    },
    {
      path: workspaceSettingsPath,
      settings: workspaceSettings,
    },
    settingsErrors,
  );
}
