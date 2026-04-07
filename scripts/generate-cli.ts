#!/usr/bin/env ts-node
/**
 * CLI Codegen: Reads usage.json and generates:
 *   - lib/cli/generated/types.ts  (TypeScript interfaces + CliCommand union)
 *   - lib/cli/generated/parser.ts (commander.js setup that produces CliCommand)
 *
 * Usage:
 *   npx ts-node scripts/generate-cli.ts                     # all commands
 *   npx ts-node scripts/generate-cli.ts --only login,list   # whitelist
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// usage.json schema types
// ---------------------------------------------------------------------------

interface UsageRoot {
  name: string;
  bin: string;
  cmd: CommandObj;
}

interface CommandObj {
  full_cmd: string[];
  usage: string;
  subcommands: Record<string, CommandObj>;
  args: ArgObj[];
  flags: FlagObj[];
  name: string;
  hide: boolean;
  help?: string;
  help_long?: string;
  subcommand_required?: boolean;
}

interface ArgObj {
  name: string;
  required: boolean;
  hide: boolean;
  default?: string[];
  choices?: { choices: string[] };
  var?: boolean;
}

interface FlagObj {
  name: string;
  short: string[];
  long: string[];
  hide: boolean;
  global: boolean;
  required?: boolean;
  var?: boolean;
  arg?: ArgObj;
}

// ---------------------------------------------------------------------------
// IR types (intermediate representation)
// ---------------------------------------------------------------------------

interface IRArg {
  fieldName: string;
  tsType: string;
  required: boolean;
  variadic: boolean;
  originalName: string;
  choices?: string[];
  defaultValue?: string[];
}

interface IRFlag {
  fieldName: string;
  longNames: string[];
  shortNames: string[];
  tsType: string;
  required: boolean;
  repeatable: boolean;
  hidden: boolean;
  help: string;
  choices?: string[];
  originalName: string;
}

interface LeafCommand {
  kind: string;
  typeName: string;
  fullCmd: string[];
  args: IRArg[];
  flags: IRFlag[];
  usesQueryOptions: boolean;
  hidden: boolean;
  help: string;
}

interface IR {
  globalFlags: IRFlag[];
  queryOptionFlags: IRFlag[];
  leaves: LeafCommand[];
  hiddenPaths: Set<string>; // dot-joined paths of hidden commands (for intermediate nodes)
}

// ---------------------------------------------------------------------------
// Known argvQuery flag names (from lib/cli/query.ts)
// ---------------------------------------------------------------------------

const QUERY_OPTION_NAMES = new Set([
  'filter', 'select', 'select-wildcard', 'age', 'time', 'limit', 'offset',
  'unique', 'histogram', 'distribution', 'mean', 'sum', 'range', 'count',
  'bin', 'head', 'tail', 'object', 'sort', 'quantize-uint', 'raw-query',
  'table', 'timestamp-attribute', 'reverse', 'template', 'factor',
  'fingerprint', 'first', 'last', 'min', 'max',
]);

// Flags handled by commander built-in (skip from codegen)
const BUILTIN_FLAGS = new Set(['help', 'version']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kebabToCamel(s: string): string {
  return s.replace(/[-.]([a-z])/g, (_, c) => c.toUpperCase());
}

function toPascalCase(segments: string[]): string {
  return segments
    .map(seg =>
      seg
        .split(/[-_]/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(''),
    )
    .join('');
}

function flagFieldName(flag: FlagObj): string {
  // Use the long name if available, otherwise the short name
  if (flag.long.length > 0) return kebabToCamel(flag.long[0]);
  if (flag.short.length > 0) return flag.short[0];
  return kebabToCamel(flag.name);
}

function flagTsType(flag: FlagObj): string {
  if (!flag.arg) return 'boolean';
  if (flag.arg.choices) {
    return flag.arg.choices.choices.map(c => `'${c}'`).join(' | ');
  }
  if (flag.var) return 'string[]';
  return 'string';
}

function argTsType(arg: ArgObj): string {
  if (arg.choices) {
    return arg.choices.choices.map(c => `'${c}'`).join(' | ');
  }
  if (arg.var) return 'string[]';
  return 'string';
}

function argFieldName(arg: ArgObj): string {
  return kebabToCamel(arg.name.replace(/[[\]<>\.]/g, ''));
}

function convertFlag(flag: FlagObj): IRFlag {
  return {
    fieldName: flagFieldName(flag),
    longNames: [...flag.long],
    shortNames: [...flag.short],
    tsType: flagTsType(flag),
    required: flag.required === true,
    repeatable: flag.var === true,
    hidden: flag.hide,
    help: (flag as any).help_first_line || (flag as any).help || '',
    choices: flag.arg?.choices?.choices,
    originalName: flag.name,
  };
}

function convertArg(arg: ArgObj): IRArg {
  return {
    fieldName: argFieldName(arg),
    tsType: argTsType(arg),
    required: arg.required,
    variadic: arg.var === true,
    originalName: arg.name,
    choices: arg.choices?.choices,
    defaultValue: arg.default,
  };
}

function isQueryFlag(flag: FlagObj): boolean {
  return QUERY_OPTION_NAMES.has(flag.name);
}

// ---------------------------------------------------------------------------
// Phase 2: Build IR
// ---------------------------------------------------------------------------

function buildIR(root: UsageRoot, whitelist?: Set<string>): IR {
  // Extract global flags from root command
  const globalFlags = root.cmd.flags
    .filter(f => f.global && !BUILTIN_FLAGS.has(f.name))
    .map(convertFlag);

  // Build QueryOptions from the known set
  const queryOptionFlags: IRFlag[] = [];
  // We'll collect these from the first command that has them (e.g. 'list')
  const listCmd = root.cmd.subcommands['list'];
  if (listCmd) {
    for (const flag of listCmd.flags) {
      if (isQueryFlag(flag) && !BUILTIN_FLAGS.has(flag.name)) {
        queryOptionFlags.push(convertFlag(flag));
      }
    }
  }
  const queryFieldNames = new Set(queryOptionFlags.map(f => f.fieldName));

  // Walk command tree to collect leaves
  const leaves: LeafCommand[] = [];
  const hiddenPaths = new Set<string>();

  function walk(
    cmd: CommandObj,
    parentArgs: IRArg[],
    parentFlags: IRFlag[],
    depth: number,
    parentHidden: boolean,
  ) {
    const subcmdKeys = Object.keys(cmd.subcommands);
    const hasSubcmds = subcmdKeys.length > 0;
    const isHidden = parentHidden || cmd.hide;

    // Track hidden intermediate nodes for parser emission
    if (isHidden && cmd.full_cmd.length > 0) {
      hiddenPaths.add(cmd.full_cmd.join('.'));
    }

    // Convert this node's own args and flags
    const ownArgs = cmd.args.map(convertArg);
    const ownFlags = cmd.flags
      .filter(f => !f.global && !BUILTIN_FLAGS.has(f.name))
      .map(convertFlag);

    const allArgs = [...parentArgs, ...ownArgs];
    const allFlags = [...parentFlags, ...ownFlags];

    // Check whitelist (only for top-level commands)
    if (depth === 1 && whitelist && !whitelist.has(cmd.name)) {
      return;
    }

    // Determine if this is a leaf command
    const isLeaf =
      !hasSubcmds || (cmd.subcommand_required !== true && ownArgs.length > 0);

    if (isLeaf && cmd.full_cmd.length > 0) {
      // Determine if this command uses QueryOptions
      const nonGlobalFlags = allFlags.filter(f => !f.repeatable || true); // all
      const hasQueryFlags =
        queryFieldNames.size > 0 &&
        [...queryFieldNames].filter(qf =>
          nonGlobalFlags.some(f => f.fieldName === qf),
        ).length >= queryFieldNames.size * 0.6; // 60% threshold

      const commandFlags = hasQueryFlags
        ? nonGlobalFlags.filter(f => !queryFieldNames.has(f.fieldName))
        : nonGlobalFlags;

      leaves.push({
        kind: cmd.full_cmd.join('.'),
        typeName: toPascalCase(cmd.full_cmd) + 'Command',
        fullCmd: cmd.full_cmd,
        args: allArgs,
        flags: commandFlags,
        usesQueryOptions: hasQueryFlags,
        hidden: isHidden,
        help: cmd.help || '',
      });
    }

    // Recurse into subcommands
    if (hasSubcmds) {
      // For subcommands, pass along the parent's args and non-query flags
      // so nested commands inherit them
      const inheritedFlags = ownFlags.filter(f => !isQueryFlag({
        name: f.originalName,
      } as any));

      for (const key of subcmdKeys) {
        walk(
          cmd.subcommands[key],
          allArgs,
          // Only inherit non-query flags for non-leaf parents
          isLeaf ? [] : inheritedFlags,
          depth + 1,
          isHidden,
        );
      }
    }
  }

  for (const key of Object.keys(root.cmd.subcommands)) {
    walk(root.cmd.subcommands[key], [], [], 1, false);
  }

  return {globalFlags, queryOptionFlags, leaves, hiddenPaths};
}

// ---------------------------------------------------------------------------
// Phase 3: Emit types.ts
// ---------------------------------------------------------------------------

function emitTypes(ir: IR): string {
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w('// AUTO-GENERATED -- DO NOT EDIT');
  w('// Generated by scripts/generate-cli.ts from usage.json');
  w('');

  // GlobalOptions
  w('export interface GlobalOptions {');
  for (const f of ir.globalFlags) {
    const opt = f.required ? '' : '?';
    w(`  ${f.fieldName}${opt}: ${f.tsType};`);
  }
  w('}');
  w('');

  // QueryOptions
  if (ir.queryOptionFlags.length > 0) {
    w('export interface QueryOptions {');
    for (const f of ir.queryOptionFlags) {
      w(`  ${f.fieldName}?: ${f.tsType};`);
    }
    w('}');
    w('');
  }

  // Command interfaces
  for (const leaf of ir.leaves) {
    if (leaf.hidden) {
      w('/** @internal Hidden command */');
    }
    w(`export interface ${leaf.typeName} {`);
    w(`  kind: '${leaf.kind}';`);
    w('  globalOptions: GlobalOptions;');

    // queryOptions field (if this command uses query flags)
    if (leaf.usesQueryOptions) {
      w('  queryOptions: QueryOptions;');
    }

    // Positional args
    for (const arg of leaf.args) {
      const opt = arg.required ? '' : '?';
      w(`  ${arg.fieldName}${opt}: ${arg.tsType};`);
    }

    // Flags (non-query, non-global)
    for (const flag of leaf.flags) {
      const opt = flag.required ? '' : '?';
      w(`  ${flag.fieldName}${opt}: ${flag.tsType};`);
    }

    w('}');
    w('');
  }

  // Union type
  w('export type CliCommand =');
  for (let i = 0; i < ir.leaves.length; i++) {
    const sep = i === 0 ? '  ' : '| ';
    const end = i === ir.leaves.length - 1 ? ';' : '';
    w(`  ${sep}${ir.leaves[i].typeName}${end}`);
  }
  w('');

  // Handler type
  w('import type {Config} from \'../../config\';');
  w('');
  w('export type CommandHandler<T extends CliCommand = CliCommand> = (cmd: T, config: Config) => any;');
  w('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Phase 4: Emit parser.ts
// ---------------------------------------------------------------------------

function emitParser(ir: IR): string {
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w("// AUTO-GENERATED -- DO NOT EDIT");
  w("// Generated by scripts/generate-cli.ts from usage.json");
  w('');
  w("import { Command, Option } from 'commander';");
  // Import all command types for typed result assignment
  const typeImports = ir.leaves.map(l => l.typeName);
  w(`import type {`);
  w(`  CliCommand,`);
  w(`  GlobalOptions,`);
  for (let i = 0; i < typeImports.length; i++) {
    const comma = i < typeImports.length - 1 ? ',' : ',';
    w(`  ${typeImports[i]}${comma}`);
  }
  w(`} from './types';`);
  w('');

  // Reveal hidden commands/flags when MORGUE_REVEAL_HIDDEN is set
  w('const revealHidden = !!process.env.MORGUE_REVEAL_HIDDEN;');
  w('');

  // Helper: collect repeatable values
  w('function collectRepeatable(val: string, prev: string[]): string[] {');
  w('  return prev.concat([val]);');
  w('}');
  w('');

  // Helper: extract global options
  w('function extractGlobalOptions(cmd: Command): GlobalOptions {');
  w('  const opts = cmd.optsWithGlobals();');
  w('  return {');
  for (const f of ir.globalFlags) {
    if (f.tsType === 'boolean') {
      w(`    ${f.fieldName}: opts['${f.fieldName}'] ?? false,`);
    } else {
      w(`    ${f.fieldName}: opts['${f.fieldName}'],`);
    }
  }
  w('  };');
  w('}');
  w('');

  // createProgram
  w('export function createProgram(): { program: Command; getResult: () => CliCommand | undefined } {');
  w('  let result: CliCommand | undefined;');
  w('  const program = new Command(\'morgue\');');
  w('  program.allowExcessArguments(true);');
  w('');

  // Register global options
  for (const f of ir.globalFlags) {
    const flagStr = buildFlagString(f);
    if (f.tsType === 'boolean') {
      w(`  program.option('${flagStr}', '${esc(f.help)}', false);`);
    } else {
      w(`  program.option('${flagStr}', '${esc(f.help)}');`);
    }
  }
  w('');

  // Group leaves by top-level command for organized output
  const byTopLevel = new Map<string, LeafCommand[]>();
  for (const leaf of ir.leaves) {
    const top = leaf.fullCmd[0];
    if (!byTopLevel.has(top)) byTopLevel.set(top, []);
    byTopLevel.get(top)!.push(leaf);
  }

  // Track which parent commands we've already emitted
  const emittedParents = new Set<string>();

  for (const [topName, topLeaves] of byTopLevel) {
    w(`  // --- ${topName} ---`);
    emitCommandTree(w, ir, topLeaves, emittedParents);
    w('');
  }

  w('  return { program, getResult: () => result };');
  w('}');
  w('');

  return lines.join('\n');
}

function emitCommandTree(
  w: (s: string) => void,
  ir: IR,
  leaves: LeafCommand[],
  emittedParents: Set<string>,
) {
  // Sort by depth (shorter first) so parents are created before children
  const sorted = [...leaves].sort(
    (a, b) => a.fullCmd.length - b.fullCmd.length,
  );

  for (const leaf of sorted) {
    emitLeafCommand(w, ir, leaf, emittedParents, ir.leaves);
  }
}

function parentVarName(fullCmd: string[]): string {
  if (fullCmd.length <= 1) return 'program';
  return 'cmd_' + fullCmd.slice(0, -1).map(kebabToCamel).join('_');
}

function selfVarName(fullCmd: string[]): string {
  return 'cmd_' + fullCmd.map(kebabToCamel).join('_');
}

function emitLeafCommand(
  w: (s: string) => void,
  ir: IR,
  leaf: LeafCommand,
  emittedParents: Set<string>,
  allLeaves: LeafCommand[],
) {
  // Ensure all ancestor commands are created (up to and including this node
  // if it is also a parent of other leaves)
  for (let i = 1; i <= leaf.fullCmd.length; i++) {
    const ancestorPath = leaf.fullCmd.slice(0, i).join('.');
    if (emittedParents.has(ancestorPath)) continue;

    // Only create intermediate nodes (i < length) automatically.
    // For i === length (this leaf itself), only create a variable if
    // some other leaf has this path as a prefix (i.e., this node is a parent).
    if (i === leaf.fullCmd.length) {
      const isParent = allLeaves.some(
        other => other !== leaf &&
          other.fullCmd.length > leaf.fullCmd.length &&
          other.fullCmd.slice(0, leaf.fullCmd.length).join('.') === ancestorPath,
      );
      if (!isParent) break; // Not a parent — handle below as inline command
    }

    const pVar =
      i === 1 ? 'program' : 'cmd_' + leaf.fullCmd.slice(0, i - 1).map(kebabToCamel).join('_');
    const sVar = 'cmd_' + leaf.fullCmd.slice(0, i).map(kebabToCamel).join('_');
    const nodeHidden = ir.hiddenPaths.has(ancestorPath);
    if (nodeHidden) {
      w(`  const ${sVar} = ${pVar}.command('${leaf.fullCmd[i - 1]}', { hidden: !revealHidden });`);
    } else {
      w(`  const ${sVar} = ${pVar}.command('${leaf.fullCmd[i - 1]}');`);
    }
    emittedParents.add(ancestorPath);
  }

  // Now register this leaf command
  const isTopLevel = leaf.fullCmd.length === 1;
  const parent = parentVarName(leaf.fullCmd);

  // Determine if this leaf's path was already emitted as a parent node
  const leafPath = leaf.fullCmd.join('.');
  const alreadyCreated = emittedParents.has(leafPath);

  const hiddenOpt = leaf.hidden ? ', { hidden: !revealHidden }' : '';
  let cmdExpr: string;
  if (alreadyCreated) {
    // This node was already created as a parent variable; add args/action to it
    cmdExpr = selfVarName(leaf.fullCmd);
  } else if (isTopLevel) {
    cmdExpr = `${parent}.command('${leaf.fullCmd[0]}'${hiddenOpt})`;
  } else {
    cmdExpr = `${parent}.command('${leaf.fullCmd[leaf.fullCmd.length - 1]}'${hiddenOpt})`;
  }

  // Collect all flags for this leaf (own + query options if applicable)
  const allFlags = leaf.usesQueryOptions
    ? [...ir.queryOptionFlags, ...leaf.flags]
    : leaf.flags;

  // Build the chained call
  const chainLines: string[] = [];
  if (!alreadyCreated) {
    chainLines.push(`  ${cmdExpr}`);
  } else {
    chainLines.push(`  ${cmdExpr}`);
  }

  // Add arguments
  for (const arg of leaf.args) {
    const bracket = arg.variadic
      ? arg.required ? `<${arg.originalName}...>` : `[${arg.originalName}...]`
      : arg.required ? `<${arg.originalName}>` : `[${arg.originalName}]`;
    chainLines.push(`    .argument('${bracket}', '${esc(arg.fieldName)}')`);
  }

  // Add flags
  for (const flag of allFlags) {
    const flagStr = buildFlagString(flag);
    const hide = flag.hidden ? '.hideHelp(!revealHidden)' : '';

    // Use addOption for flags that need chaining (choices, hidden, or repeatable via argParser)
    if (flag.choices && flag.choices.length > 0) {
      const dflt = flag.repeatable ? '.default([])' : '';
      chainLines.push(
        `    .addOption(new Option('${flagStr}', '${esc(flag.help)}')` +
        `.choices(${JSON.stringify(flag.choices)})${dflt}${hide})`,
      );
    } else if (flag.hidden) {
      // Must use addOption to access .hideHelp()
      if (flag.repeatable) {
        chainLines.push(
          `    .addOption(new Option('${flagStr}', '${esc(flag.help)}')` +
          `.argParser(collectRepeatable).default([])${hide})`,
        );
      } else if (flag.tsType === 'boolean') {
        chainLines.push(
          `    .addOption(new Option('${flagStr}', '${esc(flag.help)}')` +
          `.default(false)${hide})`,
        );
      } else {
        chainLines.push(
          `    .addOption(new Option('${flagStr}', '${esc(flag.help)}')${hide})`,
        );
      }
    } else if (flag.repeatable) {
      chainLines.push(
        `    .option('${flagStr}', '${esc(flag.help)}', collectRepeatable, [])`,
      );
    } else if (flag.tsType === 'boolean') {
      chainLines.push(
        `    .option('${flagStr}', '${esc(flag.help)}', false)`,
      );
    } else {
      chainLines.push(`    .option('${flagStr}', '${esc(flag.help)}')`);
    }
  }

  // Build the action callback
  const argNames = leaf.args.map(a => a.fieldName);
  const actionParams = [...argNames, 'opts', 'cmd'].join(', ');

  chainLines.push(`    .action((${actionParams}) => {`);
  chainLines.push(`      const g = extractGlobalOptions(cmd);`);

  // Build result object
  chainLines.push(`      result = {`);
  chainLines.push(`        kind: '${leaf.kind}',`);
  chainLines.push(`        globalOptions: g,`);

  // queryOptions (nested object for query flags)
  if (leaf.usesQueryOptions) {
    chainLines.push(`        queryOptions: {`);
    for (const qf of ir.queryOptionFlags) {
      chainLines.push(`          ${qf.fieldName}: opts['${qf.fieldName}'],`);
    }
    chainLines.push(`        },`);
  }

  // Positional args
  for (const arg of leaf.args) {
    chainLines.push(`        ${arg.fieldName},`);
  }

  // Non-query flags from opts
  for (const flag of leaf.flags) {
    chainLines.push(`        ${flag.fieldName}: opts['${flag.fieldName}'],`);
  }

  chainLines.push(`      } satisfies ${leaf.typeName};`);
  chainLines.push(`    });`);

  w(chainLines.join('\n'));
  emittedParents.add(leafPath);
}

function buildFlagString(flag: IRFlag): string {
  const parts: string[] = [];
  for (const s of flag.shortNames) {
    parts.push(`-${s}`);
  }
  for (const l of flag.longNames) {
    parts.push(`--${l}`);
  }
  let result = parts.join(', ');
  // Add value placeholder if not boolean
  if (flag.tsType !== 'boolean') {
    if (flag.repeatable) {
      result += ` <${flag.originalName}>`;
    } else {
      result += ` <${flag.originalName}>`;
    }
  }
  return result;
}

function esc(s: string): string {
  return s.replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let whitelist: Set<string> | undefined;

  const onlyIdx = args.indexOf('--only');
  if (onlyIdx !== -1 && args[onlyIdx + 1]) {
    whitelist = new Set(args[onlyIdx + 1].split(','));
  }

  // Load usage.json
  const usagePath = path.resolve(__dirname, '..', 'usage.json');
  const raw = fs.readFileSync(usagePath, 'utf-8');
  const root: UsageRoot = JSON.parse(raw);

  // Build IR
  const ir = buildIR(root, whitelist);

  console.log(
    `Built IR: ${ir.leaves.length} leaf commands, ` +
    `${ir.globalFlags.length} global flags, ` +
    `${ir.queryOptionFlags.length} query option flags`,
  );

  // Output directory
  const outDir = path.resolve(__dirname, '..', 'lib', 'cli', 'generated');
  fs.mkdirSync(outDir, {recursive: true});

  // Emit types
  const typesContent = emitTypes(ir);
  const typesPath = path.join(outDir, 'types.ts');
  fs.writeFileSync(typesPath, typesContent);
  console.log(`Wrote ${typesPath}`);

  // Emit parser
  const parserContent = emitParser(ir);
  const parserPath = path.join(outDir, 'parser.ts');
  fs.writeFileSync(parserPath, parserContent);
  console.log(`Wrote ${parserPath}`);
}

main();
