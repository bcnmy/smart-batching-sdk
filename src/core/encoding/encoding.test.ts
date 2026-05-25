import { encodeAbiParameters, getAddress, parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  equalTo,
  greaterThanOrEqualTo,
  greaterThanOrEqualToSigned,
  lessThanOrEqualTo,
  lessThanOrEqualToSigned,
  orConstraint,
  toConstraintFields,
  validateAndProcessConstraints,
} from './encoding';
import { ConstraintType } from './types';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SOME_ADDRESS = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
const SOME_HEX = '0xdeadbeef' as const;

// Expected reference data for common values — encodeAbiParameters([bytes32], [padded value])
const ZERO_BYTES32 = encodeAbiParameters(
  [{ type: 'bytes32' }],
  ['0x0000000000000000000000000000000000000000000000000000000000000000'],
);
const ONE_BYTES32 = encodeAbiParameters(
  [{ type: 'bytes32' }],
  ['0x0000000000000000000000000000000000000000000000000000000000000001'],
);
// int256(-1) in two's complement = 0xffff...ff
const NEG_ONE_INT256 = encodeAbiParameters(
  [{ type: 'bytes32' }],
  [encodeAbiParameters([{ type: 'int256' }], [-1n])],
);
// int256(-42) in two's complement
const NEG_42_INT256 = encodeAbiParameters(
  [{ type: 'bytes32' }],
  [encodeAbiParameters([{ type: 'int256' }], [-42n])],
);

// ---------------------------------------------------------------------------
// toConstraintFields — all five constraint keys
// ---------------------------------------------------------------------------

describe('toConstraintFields', () => {
  it('maps { gte } to a GTE ConstraintField', () => {
    const [field] = toConstraintFields({ gte: 100n });
    expect(field.type).toBe(ConstraintType.GTE);
    expect(field.value).toBe(100n);
  });

  it('maps { lte } to a LTE ConstraintField', () => {
    const [field] = toConstraintFields({ lte: 500n });
    expect(field.type).toBe(ConstraintType.LTE);
    expect(field.value).toBe(500n);
  });

  it('maps { eq } to an EQ ConstraintField', () => {
    const [field] = toConstraintFields({ eq: 0n });
    expect(field.type).toBe(ConstraintType.EQ);
    expect(field.value).toBe(0n);
  });

  it('maps { gteSigned } to a GTE_SIGNED ConstraintField', () => {
    const [field] = toConstraintFields({ gteSigned: -1n });
    expect(field.type).toBe(ConstraintType.GTE_SIGNED);
    expect(field.value).toBe(-1n);
  });

  it('maps { lteSigned } to a LTE_SIGNED ConstraintField', () => {
    const [field] = toConstraintFields({ lteSigned: -100n });
    expect(field.type).toBe(ConstraintType.LTE_SIGNED);
    expect(field.value).toBe(-100n);
  });

  it('returns an empty array when given no constraint', () => {
    expect(toConstraintFields(undefined)).toHaveLength(0);
  });

  it('wraps a single constraint in an array of length 1', () => {
    expect(toConstraintFields({ gte: 1n })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// validateAndProcessConstraints — EQ
// ---------------------------------------------------------------------------

describe('validateAndProcessConstraints — EQ', () => {
  it('accepts a positive bigint and sets constraintType to EQ', () => {
    const [c] = validateAndProcessConstraints([equalTo(1_000_000n)]);
    expect(c.constraintType).toBe(ConstraintType.EQ);
  });

  it('accepts zero bigint', () => {
    const [c] = validateAndProcessConstraints([equalTo(0n)]);
    expect(c.constraintType).toBe(ConstraintType.EQ);
    expect(c.referenceData).toBe(ZERO_BYTES32);
  });

  it('accepts boolean true and encodes it as 1', () => {
    const [c] = validateAndProcessConstraints([equalTo(true)]);
    expect(c.constraintType).toBe(ConstraintType.EQ);
    expect(c.referenceData).toBe(ONE_BYTES32);
  });

  it('accepts boolean false and encodes it as 0', () => {
    const [c] = validateAndProcessConstraints([equalTo(false)]);
    expect(c.constraintType).toBe(ConstraintType.EQ);
    expect(c.referenceData).toBe(ZERO_BYTES32);
  });

  it('accepts an address and sets constraintType to EQ', () => {
    const [c] = validateAndProcessConstraints([equalTo(SOME_ADDRESS)]);
    expect(c.constraintType).toBe(ConstraintType.EQ);
  });

  it('accepts a hex value and sets constraintType to EQ', () => {
    const [c] = validateAndProcessConstraints([equalTo(SOME_HEX)]);
    expect(c.constraintType).toBe(ConstraintType.EQ);
  });

  it('rejects a negative bigint', () => {
    expect(() => validateAndProcessConstraints([equalTo(-1n)])).toThrow('Invalid constraint value');
  });

  it('rejects a plain string that is not a hex or address', () => {
    expect(() => validateAndProcessConstraints([equalTo('not-a-hex')])).toThrow(
      'Invalid constraint value',
    );
  });

  it('rejects a number (must use bigint)', () => {
    expect(() => validateAndProcessConstraints([equalTo(42)])).toThrow('Invalid constraint value');
  });
});

// ---------------------------------------------------------------------------
// validateAndProcessConstraints — GTE
// ---------------------------------------------------------------------------

describe('validateAndProcessConstraints — GTE', () => {
  it('accepts a positive bigint and sets constraintType to GTE', () => {
    const [c] = validateAndProcessConstraints([greaterThanOrEqualTo(500n)]);
    expect(c.constraintType).toBe(ConstraintType.GTE);
  });

  it('accepts zero as the lower bound', () => {
    const [c] = validateAndProcessConstraints([greaterThanOrEqualTo(0n)]);
    expect(c.constraintType).toBe(ConstraintType.GTE);
    expect(c.referenceData).toBe(ZERO_BYTES32);
  });

  it('accepts a boolean value', () => {
    const [c] = validateAndProcessConstraints([greaterThanOrEqualTo(true)]);
    expect(c.constraintType).toBe(ConstraintType.GTE);
  });

  it('accepts an address', () => {
    const [c] = validateAndProcessConstraints([greaterThanOrEqualTo(SOME_ADDRESS)]);
    expect(c.constraintType).toBe(ConstraintType.GTE);
  });

  it('accepts a hex value', () => {
    const [c] = validateAndProcessConstraints([greaterThanOrEqualTo(SOME_HEX)]);
    expect(c.constraintType).toBe(ConstraintType.GTE);
  });

  it('rejects a negative bigint because unsigned comparison on negative values is meaningless', () => {
    expect(() => validateAndProcessConstraints([greaterThanOrEqualTo(-1n)])).toThrow(
      'Invalid constraint value',
    );
  });

  it('rejects a plain string that is not a hex or address', () => {
    expect(() => validateAndProcessConstraints([greaterThanOrEqualTo('bad')])).toThrow(
      'Invalid constraint value',
    );
  });

  it('rejects a number (must use bigint)', () => {
    expect(() => validateAndProcessConstraints([greaterThanOrEqualTo(100)])).toThrow(
      'Invalid constraint value',
    );
  });
});

// ---------------------------------------------------------------------------
// validateAndProcessConstraints — LTE
// ---------------------------------------------------------------------------

describe('validateAndProcessConstraints — LTE', () => {
  it('accepts a positive bigint and sets constraintType to LTE', () => {
    const [c] = validateAndProcessConstraints([lessThanOrEqualTo(9_999n)]);
    expect(c.constraintType).toBe(ConstraintType.LTE);
  });

  it('accepts zero as the upper bound', () => {
    const [c] = validateAndProcessConstraints([lessThanOrEqualTo(0n)]);
    expect(c.constraintType).toBe(ConstraintType.LTE);
    expect(c.referenceData).toBe(ZERO_BYTES32);
  });

  it('accepts a boolean value', () => {
    const [c] = validateAndProcessConstraints([lessThanOrEqualTo(false)]);
    expect(c.constraintType).toBe(ConstraintType.LTE);
  });

  it('accepts an address', () => {
    const [c] = validateAndProcessConstraints([lessThanOrEqualTo(SOME_ADDRESS)]);
    expect(c.constraintType).toBe(ConstraintType.LTE);
  });

  it('accepts a hex value', () => {
    const [c] = validateAndProcessConstraints([lessThanOrEqualTo(SOME_HEX)]);
    expect(c.constraintType).toBe(ConstraintType.LTE);
  });

  it('rejects a negative bigint because unsigned comparison on negative values is meaningless', () => {
    expect(() => validateAndProcessConstraints([lessThanOrEqualTo(-50n)])).toThrow(
      'Invalid constraint value',
    );
  });

  it('rejects a plain string that is not a hex or address', () => {
    expect(() => validateAndProcessConstraints([lessThanOrEqualTo('bad')])).toThrow(
      'Invalid constraint value',
    );
  });

  it('rejects a number (must use bigint)', () => {
    expect(() => validateAndProcessConstraints([lessThanOrEqualTo(100)])).toThrow(
      'Invalid constraint value',
    );
  });
});

// ---------------------------------------------------------------------------
// validateAndProcessConstraints — GTE_SIGNED
// ---------------------------------------------------------------------------

describe('validateAndProcessConstraints — GTE_SIGNED', () => {
  it('accepts a positive bigint and sets constraintType to GTE_SIGNED', () => {
    const [c] = validateAndProcessConstraints([greaterThanOrEqualToSigned(100n)]);
    expect(c.constraintType).toBe(ConstraintType.GTE_SIGNED);
  });

  it('accepts zero and encodes it as a zero-padded int256', () => {
    const [c] = validateAndProcessConstraints([greaterThanOrEqualToSigned(0n)]);
    expect(c.constraintType).toBe(ConstraintType.GTE_SIGNED);
    expect(c.referenceData).toBe(ZERO_BYTES32);
  });

  it('accepts a negative bigint — key difference from unsigned GTE', () => {
    const [c] = validateAndProcessConstraints([greaterThanOrEqualToSigned(-1n)]);
    expect(c.constraintType).toBe(ConstraintType.GTE_SIGNED);
  });

  it('encodes -1 as twos-complement 0xffff...ff, not as a large unsigned number', () => {
    const [c] = validateAndProcessConstraints([greaterThanOrEqualToSigned(-1n)]);
    expect(c.referenceData).toBe(NEG_ONE_INT256);
  });

  it('encodes -42 with the high bytes set to 0xff (twos-complement)', () => {
    const [c] = validateAndProcessConstraints([greaterThanOrEqualToSigned(-42n)]);
    expect(c.referenceData).toBe(NEG_42_INT256);
    // Sanity: high bytes should be all 0xff
    expect(c.referenceData.slice(2, 10)).toBe('ffffffff');
  });

  it('encodes 1 as a positive int256 (same as unsigned)', () => {
    const [c] = validateAndProcessConstraints([greaterThanOrEqualToSigned(1n)]);
    expect(c.referenceData).toBe(ONE_BYTES32);
  });

  it('rejects a boolean because signed constraints only accept bigint', () => {
    expect(() =>
      validateAndProcessConstraints([{ type: ConstraintType.GTE_SIGNED, value: true }]),
    ).toThrow('signed constraints require bigint');
  });

  it('rejects an address because signed constraints only accept bigint', () => {
    expect(() =>
      validateAndProcessConstraints([{ type: ConstraintType.GTE_SIGNED, value: SOME_ADDRESS }]),
    ).toThrow('signed constraints require bigint');
  });

  it('rejects a hex string because signed constraints only accept bigint', () => {
    expect(() =>
      validateAndProcessConstraints([{ type: ConstraintType.GTE_SIGNED, value: SOME_HEX }]),
    ).toThrow('signed constraints require bigint');
  });
});

// ---------------------------------------------------------------------------
// validateAndProcessConstraints — LTE_SIGNED
// ---------------------------------------------------------------------------

describe('validateAndProcessConstraints — LTE_SIGNED', () => {
  it('accepts a positive bigint and sets constraintType to LTE_SIGNED', () => {
    const [c] = validateAndProcessConstraints([lessThanOrEqualToSigned(999n)]);
    expect(c.constraintType).toBe(ConstraintType.LTE_SIGNED);
  });

  it('accepts zero and encodes it as a zero-padded int256', () => {
    const [c] = validateAndProcessConstraints([lessThanOrEqualToSigned(0n)]);
    expect(c.constraintType).toBe(ConstraintType.LTE_SIGNED);
    expect(c.referenceData).toBe(ZERO_BYTES32);
  });

  it('accepts a negative bigint — key difference from unsigned LTE', () => {
    const [c] = validateAndProcessConstraints([lessThanOrEqualToSigned(-100n)]);
    expect(c.constraintType).toBe(ConstraintType.LTE_SIGNED);
  });

  it('encodes -1 as twos-complement 0xffff...ff, not as a large unsigned number', () => {
    const [c] = validateAndProcessConstraints([lessThanOrEqualToSigned(-1n)]);
    expect(c.referenceData).toBe(NEG_ONE_INT256);
  });

  it('encodes -42 with the high bytes set to 0xff (twos-complement)', () => {
    const [c] = validateAndProcessConstraints([lessThanOrEqualToSigned(-42n)]);
    expect(c.referenceData).toBe(NEG_42_INT256);
    expect(c.referenceData.slice(2, 10)).toBe('ffffffff');
  });

  it('encodes 1 as a positive int256 (same as unsigned)', () => {
    const [c] = validateAndProcessConstraints([lessThanOrEqualToSigned(1n)]);
    expect(c.referenceData).toBe(ONE_BYTES32);
  });

  it('rejects a boolean because signed constraints only accept bigint', () => {
    expect(() =>
      validateAndProcessConstraints([{ type: ConstraintType.LTE_SIGNED, value: false }]),
    ).toThrow('signed constraints require bigint');
  });

  it('rejects an address because signed constraints only accept bigint', () => {
    expect(() =>
      validateAndProcessConstraints([{ type: ConstraintType.LTE_SIGNED, value: SOME_ADDRESS }]),
    ).toThrow('signed constraints require bigint');
  });

  it('rejects a hex string because signed constraints only accept bigint', () => {
    expect(() =>
      validateAndProcessConstraints([{ type: ConstraintType.LTE_SIGNED, value: SOME_HEX }]),
    ).toThrow('signed constraints require bigint');
  });
});

// ---------------------------------------------------------------------------
// validateAndProcessConstraints — general behaviour
// ---------------------------------------------------------------------------

describe('validateAndProcessConstraints — general behaviour', () => {
  it('returns an empty array when no constraints are provided', () => {
    expect(validateAndProcessConstraints([])).toHaveLength(0);
  });

  it('processes multiple constraints in input order', () => {
    const result = validateAndProcessConstraints([
      greaterThanOrEqualTo(10n),
      lessThanOrEqualTo(90n),
      equalTo(50n),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].constraintType).toBe(ConstraintType.GTE);
    expect(result[1].constraintType).toBe(ConstraintType.LTE);
    expect(result[2].constraintType).toBe(ConstraintType.EQ);
  });

  it('handles a mix of signed and unsigned constraints in one call', () => {
    const result = validateAndProcessConstraints([
      greaterThanOrEqualToSigned(-10n),
      lessThanOrEqualToSigned(10n),
      equalTo(0n),
    ]);
    expect(result[0].constraintType).toBe(ConstraintType.GTE_SIGNED);
    expect(result[1].constraintType).toBe(ConstraintType.LTE_SIGNED);
    expect(result[2].constraintType).toBe(ConstraintType.EQ);
  });

  it('rejects IN constraint type — not supported for runtime functions', () => {
    expect(() => validateAndProcessConstraints([{ type: ConstraintType.IN, value: 0n }])).toThrow(
      'Invalid constraint type',
    );
  });

  it('rejects an unknown numeric constraint type', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: intentional invalid type for test
      validateAndProcessConstraints([{ type: 99 as any, value: 0n }]),
    ).toThrow('Invalid constraint type');
  });
});

// ---------------------------------------------------------------------------
// orConstraint helper
// ---------------------------------------------------------------------------

describe('orConstraint helper', () => {
  it('returns a ConstraintField with type OR', () => {
    const field = orConstraint([equalTo(0n)]);
    expect(field.type).toBe(ConstraintType.OR);
  });

  it('stores the sub-constraints array as the value', () => {
    const subs = [greaterThanOrEqualTo(10n), equalTo(0n)];
    const field = orConstraint(subs);
    expect(field.value).toBe(subs);
  });
});

// ---------------------------------------------------------------------------
// toConstraintFields — OR key
// ---------------------------------------------------------------------------

describe('toConstraintFields — OR', () => {
  it('maps { or: [...] } to an OR ConstraintField', () => {
    const [field] = toConstraintFields({ or: [{ eq: 0n }, { gte: 100n }] });
    expect(field.type).toBe(ConstraintType.OR);
  });

  it('sub-constraints inside OR are converted to ConstraintFields stored in value', () => {
    const [field] = toConstraintFields({ or: [{ eq: 0n }, { gte: 100n }] });
    const subs = field.value as ReturnType<typeof equalTo>[];
    expect(subs).toHaveLength(2);
    expect(subs[0].type).toBe(ConstraintType.EQ);
    expect(subs[1].type).toBe(ConstraintType.GTE);
  });

  it('OR sub-constraints can include signed variants (gteSigned, lteSigned)', () => {
    const [field] = toConstraintFields({ or: [{ gteSigned: -1n }, { lteSigned: 0n }] });
    const subs = field.value as ReturnType<typeof greaterThanOrEqualToSigned>[];
    expect(subs[0].type).toBe(ConstraintType.GTE_SIGNED);
    expect(subs[1].type).toBe(ConstraintType.LTE_SIGNED);
  });
});

// ---------------------------------------------------------------------------
// validateAndProcessConstraints — OR
// ---------------------------------------------------------------------------

describe('validateAndProcessConstraints — OR', () => {
  it('produces a constraint with type OR', () => {
    const [c] = validateAndProcessConstraints([orConstraint([equalTo(0n)])]);
    expect(c.constraintType).toBe(ConstraintType.OR);
  });

  it('referenceData is a non-empty hex string (ABI-encoded Constraint[] for the sub-constraints)', () => {
    const [c] = validateAndProcessConstraints([
      orConstraint([equalTo(0n), greaterThanOrEqualTo(100n)]),
    ]);
    expect(c.referenceData).toMatch(/^0x[0-9a-f]+$/i);
    expect(c.referenceData.length).toBeGreaterThan(2);
  });

  it('OR with unsigned sub-constraints — EQ and GTE — encodes without error', () => {
    expect(() =>
      validateAndProcessConstraints([orConstraint([equalTo(0n), greaterThanOrEqualTo(100n)])]),
    ).not.toThrow();
  });

  it('OR with unsigned sub-constraints — EQ and LTE — encodes without error', () => {
    expect(() =>
      validateAndProcessConstraints([orConstraint([equalTo(999n), lessThanOrEqualTo(50n)])]),
    ).not.toThrow();
  });

  it('OR with signed sub-constraint GTE_SIGNED — accepts negative reference value', () => {
    expect(() =>
      validateAndProcessConstraints([orConstraint([greaterThanOrEqualToSigned(-1n), equalTo(0n)])]),
    ).not.toThrow();
    const [c] = validateAndProcessConstraints([
      orConstraint([greaterThanOrEqualToSigned(-1n), equalTo(0n)]),
    ]);
    expect(c.constraintType).toBe(ConstraintType.OR);
  });

  it('OR with signed sub-constraint LTE_SIGNED — accepts negative reference value', () => {
    expect(() =>
      validateAndProcessConstraints([orConstraint([lessThanOrEqualToSigned(-100n)])]),
    ).not.toThrow();
  });

  it('OR alongside other constraints — all constraints are processed in order', () => {
    const result = validateAndProcessConstraints([
      greaterThanOrEqualTo(10n),
      orConstraint([equalTo(0n), greaterThanOrEqualTo(500n)]),
      lessThanOrEqualTo(1000n),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].constraintType).toBe(ConstraintType.GTE);
    expect(result[1].constraintType).toBe(ConstraintType.OR);
    expect(result[2].constraintType).toBe(ConstraintType.LTE);
  });

  it('referenceData changes when sub-constraints change — different inputs produce different encodings', () => {
    const [or1] = validateAndProcessConstraints([orConstraint([equalTo(0n)])]);
    const [or2] = validateAndProcessConstraints([orConstraint([equalTo(999n)])]);
    expect(or1.referenceData).not.toBe(or2.referenceData);
  });

  it('rejects nested OR — OR inside OR is not supported by the contract', () => {
    expect(() =>
      validateAndProcessConstraints([
        orConstraint([{ type: ConstraintType.OR, value: [equalTo(0n)] }]),
      ]),
    ).toThrow('Nested OR constraints are not supported');
  });

  it('rejects an OR with an empty sub-constraints array', () => {
    expect(() => validateAndProcessConstraints([orConstraint([])])).toThrow(
      'OR constraint must have at least one sub-constraint',
    );
  });

  it('rejects an OR sub-constraint with an invalid type', () => {
    expect(() =>
      validateAndProcessConstraints([
        // biome-ignore lint/suspicious/noExplicitAny: intentional invalid type for test
        orConstraint([{ type: 99 as any, value: 0n }]),
      ]),
    ).toThrow('Invalid constraint type');
  });

  it('rejects a GTE_SIGNED sub-constraint inside OR when value is not a bigint', () => {
    expect(() =>
      validateAndProcessConstraints([
        orConstraint([{ type: ConstraintType.GTE_SIGNED, value: true }]),
      ]),
    ).toThrow('signed constraints require bigint');
  });

  it('rejects an unsigned sub-constraint inside OR when value is a negative bigint', () => {
    expect(() =>
      validateAndProcessConstraints([orConstraint([greaterThanOrEqualTo(-1n)])]),
    ).toThrow('Invalid constraint value');
  });

  it("OR with two signed subs preserves two's-complement encoding for negative values", () => {
    const ONE_USDC = parseUnits('1', 6);

    const [c] = validateAndProcessConstraints([
      orConstraint([greaterThanOrEqualToSigned(-1n), lessThanOrEqualToSigned(ONE_USDC)]),
    ]);

    expect(c.constraintType).toBe(ConstraintType.OR);
    expect(c.referenceData).toMatch(/^0x[0-9a-f]+$/i);

    // int256(-1) in two's complement = 0xffff...ff (32 bytes all set).
    // Verifies the referenceData contains these bytes — unsigned arithmetic would
    // encode -1 as a very different positive value.
    const negOneHex = 'f'.repeat(64);
    expect(c.referenceData.toLowerCase()).toContain(negOneHex);
  });
});
