import { isClassificationValuePopulated, resolveActiveColumns, buildClassificationFieldInputs } from './classification-coverage';

describe('isClassificationValuePopulated', () => {
  it.each([
    [null, false],
    [undefined, false],
    ['', false],
    ['   ', false],
    ['\t\n', false],
    [[], false],
    [{}, false],
    ['Finance', true],
    ['  Finance  ', true],
    [0, true],
    [false, true],
    [['Term A'], true],
    [{ Label: 'Term A' }, true],
  ])('treats %p as populated=%p', (value, expected) => {
    expect(isClassificationValuePopulated(value)).toBe(expected);
  });
});

describe('resolveActiveColumns', () => {
  const fields = [
    { id: 'f1', columnDefinitionId: 'c1', columnDisplayNameAtConfirmation: 'Department (old)' },
    { id: 'f2', columnDefinitionId: 'c2', columnDisplayNameAtConfirmation: 'Function' },
  ];

  it('resolves by stable columnDefinitionId and prefers the live display name', () => {
    const { resolved, staleIds } = resolveActiveColumns(fields, [
      { id: 'c1', name: 'Department', displayName: 'Department', hidden: false },
      { id: 'c2', name: 'Function', displayName: 'Function', hidden: false },
    ]);
    expect(staleIds).toEqual([]);
    expect(resolved.map((r) => r.columnName)).toEqual(['Department', 'Function']);
    expect(resolved[0]?.displayName).toBe('Department'); // live wins over 'Department (old)'
  });

  it('marks a field stale when its column no longer resolves, excluding it', () => {
    const { resolved, staleIds } = resolveActiveColumns(fields, [
      { id: 'c2', name: 'Function', displayName: 'Function', hidden: false },
    ]);
    expect(staleIds).toEqual(['f1']);
    expect(resolved.map((r) => r.fieldId)).toEqual(['f2']);
  });

  it('falls back to the confirmation snapshot when the live display name is empty', () => {
    const { resolved } = resolveActiveColumns([fields[0]!], [{ id: 'c1', name: 'Department', displayName: '', hidden: false }]);
    expect(resolved[0]?.displayName).toBe('Department (old)');
  });
});

describe('buildClassificationFieldInputs', () => {
  const columns = [
    { columnDefinitionId: 'c1', columnName: 'Department', displayName: 'Department' },
    { columnDefinitionId: 'c2', columnName: 'Function', displayName: 'Function' },
  ];

  it('flags each field populated from the document field values (presence only)', () => {
    const result = buildClassificationFieldInputs(columns, { Department: 'Finance', Function: '   ' });
    expect(result).toEqual([
      { columnDefinitionId: 'c1', displayName: 'Department', populated: true },
      { columnDefinitionId: 'c2', displayName: 'Function', populated: false },
    ]);
  });

  it('treats a document with no field-value row as all-unpopulated (measured, not D=0)', () => {
    const result = buildClassificationFieldInputs(columns, undefined);
    expect(result.every((f) => !f.populated)).toBe(true);
    expect(result).toHaveLength(2);
  });
});
