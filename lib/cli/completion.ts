/*
 * Shell tab completion wiring.
 *
 * We use `@bomb.sh/tab` (the commander adapter) to turn the generated commander
 * program into a completion provider. `tab(program)`:
 *   - adds a `complete [shell]` subcommand that prints a bash/zsh/fish/powershell
 *     completion script, and
 *   - intercepts `morgue complete -- <words...>` invocations (issued by that
 *     script) to emit candidates.
 *
 * On top of the commander adapter's automatic command/flag completion, we add
 * data-driven completion for `universe` and `project` values, sourced from the
 * user's logged-in config (~/.morgue/current.json). The set of project/universe
 * positionals and flags comes from generated metadata (completionMeta), which is
 * derived from usage.kdl by scripts/generate-cli.ts.
 *
 * Two `tab` facts shape the implementation:
 *   1. The commander adapter registers commands and options but NOT positional
 *      arguments, so we register positional handlers on the returned tab tree
 *      ourselves (project is a positional in almost every command).
 *   2. Completion handlers receive no typed-argument context, so to scope
 *      projects by `--universe` we read the completion request's words out of
 *      process.argv directly.
 */

import type {Command} from 'commander';
import * as fs from 'fs';
import {configFile} from './constants';
import {completionMeta, CompletionKind} from './generated/completions';

// ---------------------------------------------------------------------------
// Minimal structural types for the (ESM-only, untyped-from-CJS) tab tree.
// Mirrors @bomb.sh/tab's exported shapes; see node_modules/@bomb.sh/tab/dist.
// ---------------------------------------------------------------------------

type Complete = (value: string, description: string) => void;
type TabHandler = (complete: Complete, options?: unknown) => void;

interface TabOption {
  value: string;
  description: string;
  handler?: TabHandler;
  isBoolean?: boolean;
}

interface TabCommand {
  value: string;
  options: Map<string, TabOption>;
  arguments: Map<string, unknown>;
  argument(name: string, handler?: TabHandler, variadic?: boolean): TabCommand;
}

interface TabRoot extends TabCommand {
  commands: Map<string, TabCommand>;
}

type TabFn = (program: Command) => TabRoot;

// ---------------------------------------------------------------------------
// Config-backed candidate sources
// ---------------------------------------------------------------------------

interface MinimalConfig {
  config?: {universes?: {[name: string]: {projects?: string[]}}};
}

/** Read + parse ~/.morgue/current.json. Returns undefined on any problem. */
function readConfig(): MinimalConfig | undefined {
  try {
    const text = fs.readFileSync(configFile, {encoding: 'utf8'});
    if (!text) return undefined;
    return JSON.parse(text) as MinimalConfig;
  } catch {
    // No login yet / unreadable / malformed: emit no candidates.
    return undefined;
  }
}

/**
 * The words of the current completion request, i.e. everything after the `--`
 * that the generated shell script passes to `morgue complete -- <words...>`.
 * Falls back to the args after a bare `complete` token.
 */
function completionWords(): string[] {
  const argv = process.argv.slice(2);
  const dashDash = argv.indexOf('--');
  if (dashDash !== -1) return argv.slice(dashDash + 1);
  const complete = argv.indexOf('complete');
  if (complete !== -1) return argv.slice(complete + 1);
  return argv;
}

/** The value of a `--universe` already present in the request, if any. */
function universeFromWords(words: string[]): string | undefined {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '--universe') return words[i + 1];
    if (w.startsWith('--universe=')) return w.slice('--universe='.length);
  }
  return undefined;
}

/** The word currently being completed (last word of the request). */
function currentWord(words: string[]): string {
  return words.length ? words[words.length - 1] : '';
}

type Universes = NonNullable<NonNullable<MinimalConfig['config']>['universes']>;

export interface Candidate {
  value: string;
  description: string;
}

/** Pure: universe candidates (names + project counts) for the given config. */
export function universeCandidates(universes: Universes): Candidate[] {
  return Object.keys(universes).map(name => {
    const count = universes[name].projects?.length ?? 0;
    return {
      value: name,
      description: count === 1 ? '1 project' : `${count} projects`,
    };
  });
}

/**
 * Pure: project candidates for the given config, scoped by the request words.
 * `words` is the full completion request; `word` is the token being completed.
 * tab prefix-filters the returned values, so we emit full candidate strings.
 */
export function projectCandidates(
  universes: Universes,
  words: string[],
  word: string,
): Candidate[] {
  // `universe/project` form: if the user is typing `<universe>/...`, offer the
  // fully-qualified candidates for that universe.
  const slash = word.indexOf('/');
  if (slash !== -1) {
    const uni = word.slice(0, slash);
    return (universes[uni]?.projects ?? []).map(project => ({
      value: `${uni}/${project}`,
      description: `project in ${uni}`,
    }));
  }

  // Otherwise scope to an explicit --universe if one was given (offering nothing
  // for an unknown universe rather than misleadingly listing other universes'
  // projects), else offer the de-duped union of projects across all universes.
  const scoped = universeFromWords(words);
  if (scoped) {
    return (universes[scoped]?.projects ?? []).map(project => ({
      value: project,
      description: `project in ${scoped}`,
    }));
  }

  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const uni of Object.keys(universes)) {
    for (const project of universes[uni].projects ?? []) {
      if (seen.has(project)) continue;
      seen.add(project);
      out.push({value: project, description: `project in ${uni}`});
    }
  }
  return out;
}

function completeUniverses(complete: Complete): void {
  const universes = readConfig()?.config?.universes;
  if (!universes) return;
  for (const c of universeCandidates(universes))
    complete(c.value, c.description);
}

function completeProjects(complete: Complete): void {
  const universes = readConfig()?.config?.universes;
  if (!universes) return;
  const words = completionWords();
  for (const c of projectCandidates(universes, words, currentWord(words))) {
    complete(c.value, c.description);
  }
}

function handlerForKind(kind: CompletionKind): TabHandler {
  return kind === 'universe'
    ? complete => completeUniverses(complete)
    : complete => completeProjects(complete);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * Wire `@bomb.sh/tab` into the commander program and attach our universe/project
 * value completions. Loads tab via a runtime dynamic import (the package is
 * ESM-only; the `new Function` indirection prevents TypeScript from down-leveling
 * the import to a `require`, which would fail on an ESM module).
 */
export async function installCompletion(program: Command): Promise<void> {
  const importEsm = new Function('s', 'return import(s)') as (
    s: string,
  ) => Promise<{default: TabFn}>;
  const mod = await importEsm('@bomb.sh/tab/commander');
  const tab = mod.default;
  const t = tab(program);

  // Attach value-completion handlers to universe/project flags, both the global
  // ones (on the root) and any command-local ones (e.g. `sampling configure
  // --project`).
  const attachFlagHandlers = (cmd: TabCommand) => {
    for (const [flag, kind] of Object.entries(completionMeta.valueFlags)) {
      const option = cmd.options.get(flag);
      if (option) option.handler = handlerForKind(kind);
    }
  };
  attachFlagHandlers(t);
  for (const cmd of t.commands.values()) attachFlagHandlers(cmd);

  // The commander adapter registers the global --universe/--project flags only
  // on the root, so `morgue list --universe <TAB>` (flag typed after the
  // subcommand) wouldn't complete. Add them to project-bearing commands so the
  // value completes there too, mirroring how morgue accepts these flags.
  for (const path of Object.keys(completionMeta.commands)) {
    const cmd = t.commands.get(path);
    if (!cmd) continue;
    for (const [flag, kind] of Object.entries(completionMeta.valueFlags)) {
      if (cmd.options.has(flag)) continue;
      cmd.options.set(flag, {
        value: flag,
        description: kind === 'universe' ? 'Universe name' : 'Project name',
        isBoolean: false,
        handler: handlerForKind(kind),
      });
    }
  }

  // Register positional-argument handlers. The commander adapter does not
  // register arguments, so we add them to the tab tree directly. We register
  // every positional in order (giving non-project/universe ones no handler) so
  // tab's positional indexing stays aligned with the real command line.
  for (const [path, args] of Object.entries(completionMeta.commands)) {
    const cmd = t.commands.get(path);
    if (!cmd) continue;
    for (const arg of args) {
      const handler = arg.kind ? handlerForKind(arg.kind) : undefined;
      cmd.argument(arg.name, handler, arg.variadic);
    }
  }
}
