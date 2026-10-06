import { MOCK_PLAYERS, readConfig, EMULATOR_API_BASE } from './config';
import { initialMatchState, MatchState } from './match-state';
import { resolvePlayer } from './player-resolver';
import {
  BUDGET,
  createScoreboardTools,
  getModelContext,
  ModelContextTool,
  registerScoreboardTools,
  ScoreboardController,
  text,
} from './webmcp';

function setup() {
  let state: MatchState = initialMatchState;
  const ctrl: ScoreboardController & { confirmations: number } = {
    confirmations: 0,
    getPlayers: async () => MOCK_PLAYERS,
    getState: () => state,
    setState: s => (state = s),
    showEndConfirmation: () => ctrl.confirmations++,
  };
  const tools = Object.fromEntries(createScoreboardTools(ctrl).map(t => [t.name, t])) as Record<string, ModelContextTool<never>>;
  const call = async (name: string, input: object = {}) => {
    const result = await tools[name].execute(input as never);
    return { ...result, message: result.content[0].text };
  };
  return { ctrl, tools, call, state: () => state };
}

describe('tool definitions', () => {
  it('stay within the WebMCP budgets', () => {
    for (const tool of Object.values(setup().tools)) {
      expect(tool.name.length).toBeLessThanOrEqual(BUDGET.name);
      expect(tool.description.length).toBeLessThanOrEqual(BUDGET.description);
      const props = (tool.inputSchema as { properties: Record<string, { description?: string }> }).properties;
      for (const prop of Object.values(props)) {
        expect((prop.description ?? '').length).toBeLessThanOrEqual(BUDGET.paramDescription);
      }
    }
  });
  it('marks only end_match as consequential', () => {
    const { tools } = setup();
    expect(tools['end_match'].annotations?.consequentialHint).toBe(true);
    expect(tools['record_goal'].annotations?.consequentialHint).toBeFalsy();
  });
  it('clips output to 1500 chars', () => {
    expect(text('x'.repeat(5000)).content[0].text).toHaveLength(BUDGET.output);
  });
});

describe('player resolution', () => {
  it('prefers an exact nickname over prefix matches', () => {
    expect(resolvePlayer('alan', MOCK_PLAYERS).id).toBe('alan@example.com');
    expect(resolvePlayer('GRACE', MOCK_PLAYERS).id).toBe('grace@example.com');
    expect(resolvePlayer('hamil', MOCK_PLAYERS).id).toBe('margaret@example.com');
  });
  it('reports ambiguity and unknown names', () => {
    expect(() => resolvePlayer('al', MOCK_PLAYERS)).toThrow(/Alan.*Kay|several/);
    expect(() => resolvePlayer('nobody', MOCK_PLAYERS)).toThrow(/No known player/);
  });
});

describe('voice flow', () => {
  it('start, goals, undo, end via confirmation', async () => {
    const { call, ctrl, state } = setup();
    expect((await call('start_match', { red: ['Ada', 'Linus'], blue: ['Grace', 'Maggie'] })).message).toMatch(
      /Red \(Ada & Linus\) 0 - 0 Blue \(Amazing Grace & Maggie\)/
    );
    expect((await call('record_goal', { team: 'red', player: 'linus' })).message).toMatch(/goal for red by Linus.*1 - 0/);
    expect((await call('record_goal', { team: 'red', player: 'grace', ownGoal: true })).message).toMatch(/own goal.*2 - 0/);
    const wrong = await call('record_goal', { team: 'blue', player: 'ada' });
    expect(wrong.isError).toBe(true);
    await call('record_goal', { team: 'blue' });
    expect((await call('undo_goal')).message).toMatch(/Removed goal for blue.*2 - 0/);

    const early = await call('end_match');
    expect(early.isError).toBe(true);
    expect(ctrl.confirmations).toBe(0);

    for (let i = 0; i < 8; i++) await call('record_goal', { team: 'red' });
    const end = await call('end_match');
    expect(end.message).toMatch(/press Submit/);
    expect(ctrl.confirmations).toBe(1);
    expect(state().status).toBe('confirming');
    // The tool never saves; the match stays until a human submits.
    expect((await call('record_goal', { team: 'blue' })).isError).toBe(true);
  });
  it('asks back on ambiguous names and does not start', async () => {
    const { call, state } = setup();
    const result = await call('start_match', { red: ['al'], blue: ['Grace'] });
    expect(result.isError).toBe(true);
    expect(result.message).toMatch(/Ask which one/);
    expect(state().status).toBe('idle');
  });
  it('refuses to replace a running match with goals', async () => {
    const { call } = setup();
    await call('start_match', { red: ['Ada'], blue: ['Grace'] });
    await call('record_goal', { team: 'red' });
    expect((await call('start_match', { red: ['Linus'], blue: ['Kay'] })).isError).toBe(true);
  });
});

describe('registration', () => {
  it('is a no-op without modelContext', async () => {
    expect(getModelContext({}, {})).toBeUndefined();
    expect(await registerScoreboardTools([], new AbortController().signal, undefined)).toBe(false);
  });
  it('prefers document.modelContext and falls back to navigator', async () => {
    const registered: string[] = [];
    const ctx = { registerTool: (t: { name: string }) => void registered.push(t.name) };
    expect(getModelContext({}, { modelContext: ctx })).toBe(ctx);
    expect(getModelContext({ modelContext: ctx }, {})).toBe(ctx);
    await registerScoreboardTools(createScoreboardTools(setup().ctrl), new AbortController().signal, ctx);
    expect(registered).toEqual(['start_match', 'record_goal', 'undo_goal', 'end_match']);
  });
});

describe('config', () => {
  it('only accepts a local api override', () => {
    expect(readConfig('?api=http://localhost:5001/x/y/api/').apiBase).toBe('http://localhost:5001/x/y/api');
    expect(readConfig('?api=https://evil.example.com').apiBase).toBe(EMULATOR_API_BASE);
    expect(readConfig('?mock=1').mock).toBe(true);
  });
});
