import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatMoney, minorUnitScale} from '../lib/money.ts';
test('dispute amounts respect Stripe currency minor units', () => {
  assert.equal(formatMoney(24800, 'usd'), '$248.00');
  assert.equal(formatMoney(24800, 'jpy'), '¥24,800');
  assert.equal(minorUnitScale('isk'), 100);
  assert.equal(minorUnitScale('ugx'), 100);
  assert.equal(minorUnitScale('mga'), 1);
  assert.equal(minorUnitScale('kwd'), 1000);
});
