import test from "node:test";
import assert from "node:assert/strict";
import { currentMonthKey, monthLabel, monthOptions } from "../src/admin/analyticsPeriods.js";

function freezeClock(t, reference = new Date()) {
  t.mock.timers.enable({ apis: ["Date"], now: reference.getTime() });
  t.after(() => t.mock.timers.reset());
  return reference;
}

function calendarMonth(key) {
  const [year, month] = key.split("-").map(Number);
  return year * 12 + month - 1;
}

test("currentMonthKey reflects the runtime local calendar month with a padded month", (t) => {
  const reference = freezeClock(t);
  const key = currentMonthKey();
  const [year, month] = key.split("-").map(Number);

  assert.match(key, /^\d{4}-\d{2}$/);
  assert.equal(year, reference.getFullYear());
  assert.equal(month, reference.getMonth() + 1);
});

test("an empty history still offers the current month and five preceding months", (t) => {
  freezeClock(t);
  const options = monthOptions([]);

  assert.equal(options.length, 6);
  assert.equal(options[0].value, currentMonthKey());
  assert.equal(calendarMonth(options[0].value) - calendarMonth(options.at(-1).value), 5);
  assert.ok(options.every((option) => /^\d{4}-\d{2}$/.test(option.value) && option.label.length > 0));
  assert.equal(new Set(options.map((option) => option.value)).size, options.length);
});

test("the oldest valid record extends the range and empty months remain selectable", (t) => {
  const reference = freezeClock(t);
  const oldest = new Date(reference.getFullYear(), reference.getMonth() - 9, 12, 12);
  const options = monthOptions([reference.toISOString(), oldest.toISOString(), oldest.toISOString()]);
  const last = options.at(-1).value.split("-").map(Number);

  assert.equal(options.length, 10);
  assert.equal(last[0], oldest.getFullYear());
  assert.equal(last[1], oldest.getMonth() + 1);
  assert.equal(options[0].value, currentMonthKey());
  assert.ok(options.slice(1).every((option, index) => calendarMonth(options[index].value) - calendarMonth(option.value) === 1));

  const recordedMonths = new Set([calendarMonth(options[0].value), calendarMonth(options.at(-1).value)]);
  assert.equal(options.filter((option) => !recordedMonths.has(calendarMonth(option.value))).length, 8);
});

test("future records never create future period options", (t) => {
  const reference = freezeClock(t);
  const nextMonth = new Date(reference.getFullYear(), reference.getMonth() + 1, 15, 12);
  const laterYear = new Date(reference.getFullYear() + 3, reference.getMonth(), 15, 12);
  const options = monthOptions([nextMonth.toISOString(), laterYear]);

  assert.deepEqual(options, monthOptions([]));
  assert.ok(options.every((option) => calendarMonth(option.value) <= calendarMonth(currentMonthKey())));
});

test("invalid, missing, and null record dates do not change the period range", (t) => {
  freezeClock(t);
  const invalidDates = [null, undefined, "", false, 0, "not-a-date", "9999-99-99", new Date(Number.NaN)];

  assert.deepEqual(monthOptions(invalidDates), monthOptions([]));
});

test("month labels and period order remain correct across January and December", (t) => {
  const runtimeYear = new Date().getFullYear();
  freezeClock(t, new Date(runtimeYear, 0, 31, 12));
  const options = monthOptions([]);

  assert.equal(currentMonthKey(), `${runtimeYear}-01`);
  assert.deepEqual(options.map((option) => option.value), [
    `${runtimeYear}-01`,
    `${runtimeYear - 1}-12`,
    `${runtimeYear - 1}-11`,
    `${runtimeYear - 1}-10`,
    `${runtimeYear - 1}-09`,
    `${runtimeYear - 1}-08`,
  ]);
  assert.equal(monthLabel(`${runtimeYear}-01`), `January ${runtimeYear}`);
  assert.equal(monthLabel(`${runtimeYear - 1}-12`), `December ${runtimeYear - 1}`);
  assert.equal(options[0].label, `January ${runtimeYear}`);
  assert.equal(options[1].label, `December ${runtimeYear - 1}`);
});
