import {
  universeCandidates,
  projectCandidates,
} from '../../../lib/cli/completion';
import {completionMeta} from '../../../lib/cli/generated/completions';

const universes = {
  yolo: {projects: ['crashpad', 'electron', 'blackhole']},
  test3: {projects: ['testing-bobby']},
  empty: {projects: []},
};

const vals = (cs: {value: string}[]) => cs.map(c => c.value);

describe('completion candidates', () => {
  describe('universeCandidates', () => {
    it('lists universe names with project counts', () => {
      const cs = universeCandidates(universes);
      expect(vals(cs)).toEqual(['yolo', 'test3', 'empty']);
      const byName = Object.fromEntries(cs.map(c => [c.value, c.description]));
      expect(byName['yolo']).toBe('3 projects');
      expect(byName['test3']).toBe('1 project');
      expect(byName['empty']).toBe('0 projects');
    });
  });

  describe('projectCandidates', () => {
    it('returns the de-duped union across universes when unscoped', () => {
      const cs = projectCandidates(universes, ['list', ''], '');
      expect(vals(cs)).toEqual([
        'crashpad',
        'electron',
        'blackhole',
        'testing-bobby',
      ]);
    });

    it('scopes to an explicit --universe (space form)', () => {
      const cs = projectCandidates(
        universes,
        ['--universe', 'test3', 'list', ''],
        '',
      );
      expect(vals(cs)).toEqual(['testing-bobby']);
    });

    it('scopes to an explicit --universe=value (equals form)', () => {
      const cs = projectCandidates(universes, ['list', '--universe=yolo', ''], '');
      expect(vals(cs)).toEqual(['crashpad', 'electron', 'blackhole']);
    });

    it('offers fully-qualified universe/project candidates when typing a slash', () => {
      const cs = projectCandidates(universes, ['list', 'yolo/'], 'yolo/');
      expect(vals(cs)).toEqual([
        'yolo/crashpad',
        'yolo/electron',
        'yolo/blackhole',
      ]);
    });

    it('returns nothing for an unknown universe', () => {
      expect(projectCandidates(universes, ['--universe', 'nope', ''], '')).toEqual(
        [],
      );
      expect(projectCandidates(universes, ['nope/'], 'nope/')).toEqual([]);
    });
  });
});

describe('completion metadata', () => {
  it('marks universe and project as value flags', () => {
    expect(completionMeta.valueFlags['universe']).toBe('universe');
    expect(completionMeta.valueFlags['project']).toBe('project');
  });

  it('registers a leading project positional for project commands', () => {
    expect(completionMeta.commands['list'][0]).toMatchObject({
      name: 'project',
      kind: 'project',
    });
    // Nested command paths use the space-joined form tab keys by.
    expect(completionMeta.commands['symbold symbolserver list'][0]).toMatchObject({
      name: 'project',
      kind: 'project',
    });
  });

  it('preserves trailing positionals (so tab indexes correctly) without a kind', () => {
    const send = completionMeta.commands['report send'];
    expect(send.map(a => a.name)).toEqual(['project', 'id', 'email']);
    expect(send[1].kind).toBeNull();
    expect(send[2].kind).toBeNull();
  });

  it('marks variadic positionals', () => {
    const del = completionMeta.commands['delete'];
    expect(del.find(a => a.name === 'target')?.variadic).toBe(true);
  });
});
