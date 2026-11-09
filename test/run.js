'use strict';
/* Minimal zero-dependency test runner. */
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; process.stdout.write('.'); }
  catch (e) { failed++; failures.push({ name, message: e.message }); process.stdout.write('F'); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function equal(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || 'equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function report() {
  console.log(`\n\n${passed} passed, ${failed} failed`);
  for (const f of failures) console.log(`  FAIL  ${f.name}\n        ${f.message}`);
  if (failed) process.exit(1);
}
module.exports = { test, assert, equal, report };
