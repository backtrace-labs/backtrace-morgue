import {createProgram} from '../../../lib/cli/generated/parser';
import type {CliCommand} from '../../../lib/cli/generated/types';

function parse(args: string[]): CliCommand {
  const {program, getResult} = createProgram();
  program.exitOverride();
  program.parse(['node', 'morgue', ...args]);
  const result = getResult();
  if (!result) throw new Error('No command parsed');
  return result;
}

describe('CLI Parser', () => {
  describe('global and command flag syncing', () => {
    describe('flags provided only as global (before command name)', () => {
      it('should inherit global --universe into command field', () => {
        const cmd = parse(['--universe', 'yolo', 'nuke', '--project', 'p1']);
        expect(cmd.kind).toBe('nuke');
        if (cmd.kind !== 'nuke') return;
        expect(cmd.globalOptions.universe).toBe('yolo');
        expect(cmd.universe).toBe('yolo');
      });

      it('should inherit global --project into command field', () => {
        const cmd = parse(['--project', 'myproj', 'nuke', '--universe', 'u1']);
        expect(cmd.kind).toBe('nuke');
        if (cmd.kind !== 'nuke') return;
        expect(cmd.globalOptions.project).toBe('myproj');
        expect(cmd.project).toBe('myproj');
      });

      it('should inherit global --token into command field for token create', () => {
        const cmd = parse([
          '--token', 'tok123',
          'token', 'create',
          '--project', 'myproj',
          '--capability', 'error:post',
        ]);
        expect(cmd.kind).toBe('token.create');
        if (cmd.kind !== 'token.create') return;
        expect(cmd.globalOptions.token).toBe('tok123');
      });
    });

    describe('flags provided only after command name', () => {
      it('should sync command --universe back to globalOptions', () => {
        const cmd = parse(['nuke', '--universe', 'abc123', '--project', 'p1']);
        expect(cmd.kind).toBe('nuke');
        if (cmd.kind !== 'nuke') return;
        expect(cmd.universe).toBe('abc123');
        expect(cmd.globalOptions.universe).toBe('abc123');
      });

      it('should sync command --project back to globalOptions', () => {
        const cmd = parse(['nuke', '--universe', 'u1', '--project', 'foobar']);
        expect(cmd.kind).toBe('nuke');
        if (cmd.kind !== 'nuke') return;
        expect(cmd.project).toBe('foobar');
        expect(cmd.globalOptions.project).toBe('foobar');
      });
    });

    describe('flags in both positions (command-local wins)', () => {
      it('should prefer command-local --universe over global', () => {
        const cmd = parse([
          '--universe', 'global-u',
          'nuke',
          '--universe', 'local-u',
          '--project', 'p1',
        ]);
        expect(cmd.kind).toBe('nuke');
        if (cmd.kind !== 'nuke') return;
        expect(cmd.universe).toBe('local-u');
        expect(cmd.globalOptions.universe).toBe('local-u');
      });

      it('should prefer command-local --project over global', () => {
        const cmd = parse([
          '--project', 'global-p',
          'nuke',
          '--universe', 'u1',
          '--project', 'local-p',
        ]);
        expect(cmd.kind).toBe('nuke');
        if (cmd.kind !== 'nuke') return;
        expect(cmd.project).toBe('local-p');
        expect(cmd.globalOptions.project).toBe('local-p');
      });
    });

    describe('globalOptions and command fields always match', () => {
      it('should keep globalOptions and command fields identical for nuke', () => {
        const cmd = parse([
          '--universe', 'will-be-overridden',
          'nuke',
          '--universe', 'winner',
          '--project', 'myproj',
        ]);
        expect(cmd.kind).toBe('nuke');
        if (cmd.kind !== 'nuke') return;
        expect(cmd.universe).toBe(cmd.globalOptions.universe);
        expect(cmd.project).toBe(cmd.globalOptions.project);
      });
    });
  });

  describe('positional arg syncing to globalOptions', () => {
    it('should sync positional project to globalOptions.project for clean', () => {
      const cmd = parse(['clean', 'myproject']);
      expect(cmd.kind).toBe('clean');
      if (cmd.kind !== 'clean') return;
      expect(cmd.project).toBe('myproject');
      expect(cmd.globalOptions.project).toBe('myproject');
    });

    it('should sync positional project to globalOptions.project for list', () => {
      const cmd = parse(['list', 'myproject', '--json']);
      expect(cmd.kind).toBe('list');
      if (cmd.kind !== 'list') return;
      expect(cmd.project).toBe('myproject');
      expect(cmd.globalOptions.project).toBe('myproject');
    });

    it('should sync positional project for describe', () => {
      const cmd = parse(['describe', 'myproject']);
      expect(cmd.kind).toBe('describe');
      if (cmd.kind !== 'describe') return;
      expect(cmd.project).toBe('myproject');
      expect(cmd.globalOptions.project).toBe('myproject');
    });

    it('should preserve global --universe while syncing positional project', () => {
      const cmd = parse(['--universe', 'yolo', 'list', 'myproject']);
      expect(cmd.kind).toBe('list');
      if (cmd.kind !== 'list') return;
      expect(cmd.project).toBe('myproject');
      expect(cmd.globalOptions.project).toBe('myproject');
      expect(cmd.globalOptions.universe).toBe('yolo');
    });
  });

  describe('basic command parsing', () => {
    it('should parse login with positional url', () => {
      const cmd = parse(['login', 'http://localhost']);
      expect(cmd.kind).toBe('login');
      if (cmd.kind !== 'login') return;
      expect(cmd.url).toBe('http://localhost');
    });

    it('should parse login with --token and --debug', () => {
      const cmd = parse([
        'login', 'http://localhost',
        '--token', 'abc123',
        '--debug',
      ]);
      expect(cmd.kind).toBe('login');
      if (cmd.kind !== 'login') return;
      expect(cmd.url).toBe('http://localhost');
      expect(cmd.globalOptions.token).toBe('abc123');
      expect(cmd.globalOptions.debug).toBe(true);
    });

    it('should parse nested subcommands (attachment add)', () => {
      const cmd = parse([
        'attachment', 'add', 'myproject', 'obj123', 'file.txt',
        '--content-type', 'text/plain',
      ]);
      expect(cmd.kind).toBe('attachment.add');
      if (cmd.kind !== 'attachment.add') return;
      expect(cmd.project).toBe('myproject');
      expect(cmd.oid).toBe('obj123');
      expect(cmd.filename).toBe('file.txt');
      expect(cmd.contentType).toBe('text/plain');
    });

    it('should parse tenant subcommands', () => {
      const cmd = parse(['tenant', 'create', 'newtenant']);
      expect(cmd.kind).toBe('tenant.create');
      if (cmd.kind !== 'tenant.create') return;
      expect(cmd.name).toBe('newtenant');
    });

    it('should parse boolean flags with defaults', () => {
      const cmd = parse(['list', 'myproject']);
      expect(cmd.kind).toBe('list');
      if (cmd.kind !== 'list') return;
      expect(cmd.globalOptions.debug).toBe(false);
      expect(cmd.globalOptions.k).toBe(false);
    });

    it('should parse -k flag', () => {
      const cmd = parse(['-k', 'list', 'myproject']);
      expect(cmd.kind).toBe('list');
      if (cmd.kind !== 'list') return;
      expect(cmd.globalOptions.k).toBe(true);
    });

    it('should parse repeatable flags', () => {
      const cmd = parse([
        'list', 'myproject',
        '--select', 'hostname',
        '--select', 'callstack',
      ]);
      expect(cmd.kind).toBe('list');
      if (cmd.kind !== 'list') return;
      expect(cmd.queryOptions.select).toEqual(['hostname', 'callstack']);
    });
  });
});
