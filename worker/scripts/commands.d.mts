// Types for commands.mjs, so the Worker (src/bot/help.ts) can read the same definitions Discord gets.

export interface CommandOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  choices?: { name: string; value: string | number }[];
  options?: CommandOption[];
  [key: string]: unknown;
}

export interface Command {
  name: string;
  description: string;
  options?: CommandOption[];
  default_member_permissions?: string;
  [key: string]: unknown;
}

export const HELP_SECTIONS: [title: string, names: string[]][];
export const PUBLIC_REPLIES: string[];
export const COMMANDS: Command[];
