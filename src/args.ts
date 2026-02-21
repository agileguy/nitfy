/**
 * Manual argument parsing utilities for nitfy CLI.
 * Zero dependencies - pure TypeScript string manipulation.
 */

/**
 * Get the value of a named flag from an args array.
 * Handles:
 *   --flag value
 *   --flag=value
 *   -f value  (alias)
 *   -f=value  (alias with equals)
 *
 * Returns undefined if the flag is not present.
 */
export function getFlag(
  args: string[],
  flag: string,
  alias?: string
): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // --flag=value or -f=value
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
    if (alias !== undefined && arg.startsWith(`${alias}=`)) {
      return arg.slice(alias.length + 1);
    }

    // --flag value or -f value
    if (arg === flag || (alias !== undefined && arg === alias)) {
      const next = args[i + 1];
      // next must exist and not itself be a flag
      if (next !== undefined && !next.startsWith("-")) {
        return next;
      }
      // flag is present but has no value
      return undefined;
    }
  }
  return undefined;
}

/**
 * Check whether a boolean flag exists in an args array.
 * Matches both --flag and alias forms.
 */
export function hasFlag(
  args: string[],
  flag: string,
  alias?: string
): boolean {
  for (const arg of args) {
    // Strip off any trailing =value before comparing
    const bare = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (bare === flag || (alias !== undefined && bare === alias)) {
      return true;
    }
  }
  return false;
}

/**
 * Return the positional (non-flag) arguments from an args array.
 *
 * @param args - The raw argument list (e.g. process.argv.slice(2))
 * @param flagsWithValues - Flags that consume the NEXT token as their value
 *   (e.g. ["--server", "-s", "--topic", "-t"]).  These and their values are
 *   both excluded from the positionals list.
 */
export function getPositionals(
  args: string[],
  flagsWithValues: string[]
): string[] {
  const positionals: string[] = [];
  const flagSet = new Set(flagsWithValues);

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith("-")) {
      // --flag=value form: skip this token only
      if (arg.includes("=")) {
        i++;
        continue;
      }

      // --flag value form: skip this token AND the next
      const bare = arg;
      if (flagSet.has(bare)) {
        i += 2; // skip flag + its value
        continue;
      }

      // Boolean flag with no value: skip just this token
      i++;
      continue;
    }

    // Not a flag token
    positionals.push(arg);
    i++;
  }

  return positionals;
}

/**
 * Convenience wrapper: join positionals with a single space.
 */
export function joinPositionals(
  args: string[],
  flagsWithValues: string[]
): string {
  return getPositionals(args, flagsWithValues).join(" ");
}
