import assert from "node:assert/strict";
import test from "node:test";

import { renderFuzzPy } from "../../src/core/projects/templates/fuzz.ts";

test("renders a Hypothesis fuzz suite for Mini App initData", () => {
  const source = renderFuzzPy();
  assert.match(source, /^from __future__ import annotations\n/);
  assert.match(source, /from hypothesis import HealthCheck, given, settings/);
  assert.match(source, /from hypothesis import strategies as st/);
  assert.match(source, /from app\.runtime\.miniapp_session import \(/);
  assert.match(source, /MiniAppAuthError/);
  assert.match(source, /max_examples=500/);
  assert.match(source, /@given\(init_data=st\.text\(\)\)/);
  assert.match(source, /validate_init_data\(init_data, BOT_TOKEN\)/);
});

test("renders both rejection and no-unexpected-error properties", () => {
  const source = renderFuzzPy();
  const tests = source.match(/^def test_/gm) ?? [];
  assert.equal(tests.length, 2);
  assert.match(source, /with pytest\.raises\(MiniAppAuthError\)/);
  assert.match(source, /except MiniAppAuthError:/);
  assert.doesNotMatch(source, /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/);
});
