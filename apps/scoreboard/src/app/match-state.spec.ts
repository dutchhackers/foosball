import { cancelEnd, recordGoal, requestEnd, score, startMatch, undoGoal, validateFinalScore, MatchState } from './match-state';

const a = { id: 'a', name: 'A' };
const b = { id: 'b', name: 'B' };
const c = { id: 'c', name: 'C' };
const d = { id: 'd', name: 'D' };

function withGoals(red: number, blue: number): MatchState {
  let s = startMatch([a], [b]);
  for (let i = 0; i < red; i++) s = recordGoal(s, { team: 'red' });
  for (let i = 0; i < blue; i++) s = recordGoal(s, { team: 'blue' });
  return s;
}

describe('startMatch', () => {
  it('accepts 1v1 and 2v2', () => {
    expect(startMatch([a], [b]).status).toBe('in_progress');
    expect(startMatch([a, b], [c, d]).red).toHaveLength(2);
  });
  it('rejects uneven teams and duplicates', () => {
    expect(() => startMatch([a, b], [c])).toThrow(/1v1 or 2v2/);
    expect(() => startMatch([a], [a])).toThrow(/twice/);
  });
});

describe('recordGoal / undoGoal', () => {
  it('counts goals per team, red = home first', () => {
    expect(score(withGoals(3, 2))).toEqual([3, 2]);
  });
  it('credits an own goal to the named team and checks the player side', () => {
    const s = startMatch([a, c], [b, d]);
    const next = recordGoal(s, { team: 'blue', playerId: 'a', ownGoal: true });
    expect(score(next)).toEqual([0, 1]);
    expect(() => recordGoal(s, { team: 'blue', playerId: 'b', ownGoal: true })).toThrow(/plays for blue/);
    expect(() => recordGoal(s, { team: 'red', playerId: 'b' })).toThrow(/plays for blue/);
    expect(() => recordGoal(s, { team: 'red', playerId: 'zz' })).toThrow(/not in this match/);
  });
  it('refuses without a match and above 11', () => {
    expect(() => recordGoal({ status: 'idle', red: [], blue: [], goals: [] }, { team: 'red' })).toThrow(/Start a match/);
    expect(() => recordGoal(withGoals(11, 0), { team: 'red' })).toThrow(/cannot exceed/);
  });
  it('undo removes the last goal only', () => {
    const s = recordGoal(withGoals(1, 0), { team: 'blue', playerId: 'b' });
    const { state, removed } = undoGoal(s);
    expect(removed?.team).toBe('blue');
    expect(score(state)).toEqual([1, 0]);
    expect(undoGoal(startMatch([a], [b])).removed).toBeUndefined();
  });
});

describe('validateFinalScore (stricter than the API: a winner is required)', () => {
  it.each([
    [10, 0],
    [10, 9],
    [11, 10],
    [3, 11],
  ])('accepts %i-%i', (x, y) => expect(validateFinalScore([x, y])).toBeNull());
  it.each([
    [5, 3, /reached 10/],
    [0, 0, /reached 10/],
    [10, 10, /10-10/],
    [11, 11, /11-11/],
    [12, 3, /exceed/],
  ])('rejects %i-%i', (x, y, msg) => expect(validateFinalScore([x, y])).toMatch(msg));
});

describe('end confirmation', () => {
  it('locks scoring and snapshots the score until cancelled', () => {
    const s = requestEnd(withGoals(10, 4));
    expect(s.status).toBe('confirming');
    expect(s.pendingFinalScore).toEqual([10, 4]);
    expect(() => recordGoal(s, { team: 'blue' })).toThrow(/confirmation is open/);
    expect(() => undoGoal(s)).toThrow(/confirmation is open/);
    const resumed = cancelEnd(s);
    expect(resumed.status).toBe('in_progress');
    expect(resumed.pendingFinalScore).toBeUndefined();
  });
  it('refuses an unfinished score', () => {
    expect(() => requestEnd(withGoals(4, 4))).toThrow(/reached 10/);
  });
});
