import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createAdminDataRouter, mapTransaction, transactionMonthlyTrend, transactionMatchesSearch } from "../routes/adminData.routes.js";

const id = (value) => String(value).padStart(24, "0");
const renterId = id(901);
const ownerId = id(902);
const vehicleId = id(903);

function freezeClock(t, value = "2026-10-15T04:00:00.000Z") {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(value).getTime() });
  t.after(() => t.mock.timers.reset());
}

function booking(number, createdAt, amounts = {}) {
  return {
    _id: id(number), renter: renterId, owner: ownerId, vehicle: vehicleId,
    status: "confirmed", paymentStatus: "partial", totalAmount: 0,
    transactionFee: 0, paymentAmountPaid: 0, paymentAmountDue: 0,
    createdAt, ...amounts,
  };
}

function historicalBookings() {
  return [
    booking(1, "2024-01-15T12:00:00Z", { totalAmount: 100.005, lateReturnPenaltyFee: 2.005, transactionFee: 5.555, paymentAmountPaid: 50.115, paymentAmountDue: 57.445 }),
    booking(2, "2024-01-31T23:59:59.999Z", { totalAmount: 10, transactionFee: 1, paymentAmountPaid: 11, paymentStatus: "paid", paidAt: "2024-06-10T00:00:00Z" }),
    booking(3, "2024-03-01T00:30:00+08:00", { totalAmount: 80, paymentAmountPaid: 24, paymentAmountDue: 60, paidAt: "2024-05-10T00:00:00Z" }),
    booking(4, "2024-03-10T00:00:00Z", { totalAmount: 100, transactionFee: 2, paymentStatus: "paid", paymentAmountDue: undefined, status: "completed" }),
    booking(5, "2024-04-10T00:00:00Z", { totalAmount: 45, paymentAmountDue: 45, paymentStatus: "unpaid", status: "pending" }),
    booking(6, "2024-07-01T00:20:00+08:00", { totalAmount: 20, paymentAmountPaid: 10, paymentAmountDue: 10 }),
    booking(7, "2024-01-01T00:20:00+08:00", { totalAmount: 9, transactionFee: 1, paymentAmountPaid: 10, paymentStatus: "paid" }),
    booking(8, "invalid-date", { totalAmount: 7, paymentAmountPaid: 7, paymentStatus: "refunded", status: "cancelled", paidAt: "2024-06-12T00:00:00Z" }),
  ];
}

async function requestTransactions(bookings, query = {}) {
  const rows = {
    bookings,
    users: [
      { _id: renterId, name: "Synthetic renter", email: "renter@example.test" },
      { _id: ownerId, name: "Synthetic operator", email: "operator@example.test" },
    ],
    vehicles: [{ _id: vehicleId, name: "Synthetic vehicle", location: "Synthetic operating area" }],
  };
  const collectionReads = [];
  const fakeDb = {
    collection(name) {
      assert.ok(Object.hasOwn(rows, name), `Unexpected collection: ${name}`);
      collectionReads.push(name);
      return {
        aggregate(pipeline) {
          assert.equal(name, "bookings");
          const facet = pipeline.at(-1).$facet;
          assert.ok(facet.totals[0].$group, "All-time totals are computed by MongoDB.");
          const skip = facet.rows.find(stage => stage.$skip !== undefined).$skip;
          const pageLimit = facet.rows.find(stage => stage.$limit !== undefined).$limit;
          assert.ok(pageLimit <= 101, "Only a bounded page leaves MongoDB.");
          const users = new Map(rows.users.map(user => [String(user._id), user]));
          const vehicles = new Map(rows.vehicles.map(vehicle => [String(vehicle._id), vehicle]));
          const all = bookings.map(item => mapTransaction(item, users, vehicles));
          const sums = Object.fromEntries([['totalCollected','paymentAmountPaid'], ['totalOutstanding','paymentAmountDue'],
            ['totalPayable','amountPayable'], ['totalTransactionFees','transactionFee']].map(([key, field]) => [key, all.reduce((sum, item) => sum + item[field], 0)]));
          const totals = { ...sums, totalRecords: all.length,
            ...Object.fromEntries([['paidBookings','paid'], ['partialPayments','partial'], ['unpaidBookings','unpaid'], ['refundedBookings','refunded']]
              .map(([key, status]) => [key, all.filter(item => item.paymentStatus === status).length])),
            trendStartDate: all.filter(item => item.createdAt).map(item => item.createdAt).sort()[0] || null };
          const end = new Date(facet.monthlyTrend[0].$match._adminCreated.$lt); end.setUTCMonth(end.getUTCMonth() - 1);
          const monthlyTrend = transactionMonthlyTrend(all, 6, end.toISOString().slice(0, 7)).map(month => ({ ...month, _id: month.key }));
          const match = facet.rows.find(stage => stage.$match?._adminPaymentStatus)?.$match._adminPaymentStatus;
          const search = query.search || "";
          const matched = bookings.filter((item, index) => (!match || all[index].paymentStatus === match) && transactionMatchesSearch(all[index], search))
            .sort((first, second) => (new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()) || String(second._id).localeCompare(String(first._id)))
            .slice(skip, skip + pageLimit).map(item => ({ ...item,
              _adminRenter: [users.get(String(item.renter))].filter(Boolean), _adminOwner: [users.get(String(item.owner))].filter(Boolean),
              _adminVehicle: [vehicles.get(String(item.vehicle))].filter(Boolean) }));
          return { toArray: async () => [{ rows: matched, totals: [totals], monthlyTrend }] };
        },
        find(filter, { projection }) {
          const allowedIds = filter?._id?.$in?.map(String);
          const candidates = rows[name].filter((row) => !allowedIds || allowedIds.includes(String(row._id)));
          return {
            sort(order) {
              assert.equal(name, "bookings");
              assert.deepEqual(order, { createdAt: -1, _id: -1 });
              candidates.sort((first, second) => {
                const firstTime = new Date(first.createdAt).getTime();
                const secondTime = new Date(second.createdAt).getTime();
                const difference = (Number.isFinite(secondTime) ? secondTime : -Infinity) - (Number.isFinite(firstTime) ? firstTime : -Infinity);
                return difference || String(second._id).localeCompare(String(first._id));
              });
              return this;
            },
            async toArray() {
              return candidates.map((row) => Object.fromEntries(
                Object.entries(row).filter(([key]) => key === "_id" || projection[key] === 1),
              ));
            },
          };
        },
      };
    },
  };
  const previousDb = mongoose.connection.db;
  mongoose.connection.db = fakeDb;
  try {
    const session = (_request, _response, next) => next();
    const router = createAdminDataRouter({ requireAdminSession: session });
    const layer = router.stack.find((entry) => entry.route?.path === "/transactions" && entry.route.methods.get);
    assert.ok(layer);
    assert.ok(router.stack.indexOf(layer) > router.stack.findIndex((entry) => entry.handle === session));
    const response = {
      statusCode: 200,
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; },
    };
    await layer.route.stack[0].handle({ query }, response, (error) => { throw error; });
    return { statusCode: response.statusCode, body: response.body, collectionReads };
  } finally {
    mongoose.connection.db = previousDb;
  }
}

function allTimeSummary(summary) {
  const { monthlyTrend: _trend, ...remaining } = summary;
  return remaining;
}

test("selected historical cash-flow cohorts retain UTC creation dates, zero gaps, and existing payment rounding", async (t) => {
  freezeClock(t);
  const { statusCode, body } = await requestTransactions(historicalBookings(), { trendEndMonth: "2024-06" });

  assert.equal(statusCode, 200);
  assert.deepEqual(body.summary.monthlyTrend, [
    { key: "2024-01", label: "Jan", collected: 61.12, outstanding: 57.45, fees: 6.56, records: 2 },
    { key: "2024-02", label: "Feb", collected: 24, outstanding: 60, fees: 4, records: 1 },
    { key: "2024-03", label: "Mar", collected: 102, outstanding: 0, fees: 2, records: 1 },
    { key: "2024-04", label: "Apr", collected: 0, outstanding: 45, fees: 0, records: 1 },
    { key: "2024-05", label: "May", collected: 0, outstanding: 0, fees: 0, records: 0 },
    { key: "2024-06", label: "Jun", collected: 10, outstanding: 10, fees: 0, records: 1 },
  ]);
  assert.deepEqual(allTimeSummary(body.summary), {
    totalRecords: 8, paidBookings: 3, partialPayments: 3, unpaidBookings: 1, refundedBookings: 1,
    totalCollected: 214.12, totalOutstanding: 172.45, totalPayable: 386.57, totalTransactionFees: 13.56,
    trendStartMonth: "2023-12",
  });
  const roundedRecord = body.transactions.find((record) => record._id === id(1));
  assert.equal(roundedRecord.rentalAmount, 102.01);
  assert.equal(roundedRecord.amountPayable, 107.57);
  assert.equal(roundedRecord.paymentAmountPaid, 50.12);
  assert.equal(roundedRecord.paymentAmountDue, 57.45);
  assert.equal(roundedRecord.transactionFee, 5.56);
  assert.equal(body.transactions.find((record) => record._id === id(2)).paidAt, "2024-06-10T00:00:00.000Z");
});

test("omitting the period retains the current UTC six-month default and all-time totals", async (t) => {
  freezeClock(t);
  const defaults = await requestTransactions(historicalBookings());
  const selected = await requestTransactions(historicalBookings(), { trendEndMonth: "2024-06" });

  assert.equal(defaults.statusCode, 200);
  assert.deepEqual(defaults.body.summary.monthlyTrend.map((month) => month.key), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.ok(defaults.body.summary.monthlyTrend.every((month) => month.records === 0 && month.collected === 0 && month.outstanding === 0 && month.fees === 0));
  assert.deepEqual(defaults.body.transactions, selected.body.transactions);
  assert.deepEqual(defaults.body.page, selected.body.page);
  assert.deepEqual(allTimeSummary(defaults.body.summary), allTimeSummary(selected.body.summary));
});

test("selected trend periods do not affect payment/search filters, cursors, or earliest history beyond a page", async (t) => {
  freezeClock(t);
  const query = { paymentStatus: "partial", search: "SYNTHETIC VEHICLE", limit: "1" };
  const defaults = await requestTransactions(historicalBookings(), query);
  const selected = await requestTransactions(historicalBookings(), { ...query, trendEndMonth: "2024-06" });

  assert.equal(selected.statusCode, 200);
  assert.equal(selected.body.transactions.length, 1);
  assert.equal(selected.body.transactions[0]._id, id(6));
  assert.equal(selected.body.page.hasMore, true);
  assert.equal(selected.body.page.limit, 1);
  assert.deepEqual(selected.body.transactions, defaults.body.transactions);
  assert.deepEqual(selected.body.page, defaults.body.page);
  assert.deepEqual(allTimeSummary(selected.body.summary), allTimeSummary(defaults.body.summary));
  assert.equal(selected.body.summary.totalRecords, 8);
  assert.equal(selected.body.summary.trendStartMonth, "2023-12");
  assert.equal(selected.body.summary.monthlyTrend[0].records, 2, "Trend cohorts include paid records hidden by the partial-payment filter.");

  const nextQuery = { ...query, cursor: selected.body.page.nextCursor };
  const nextDefaults = await requestTransactions(historicalBookings(), nextQuery);
  const nextSelected = await requestTransactions(historicalBookings(), { ...nextQuery, trendEndMonth: "2024-06" });
  assert.equal(nextSelected.body.transactions[0]._id, id(3));
  assert.deepEqual(nextSelected.body.transactions, nextDefaults.body.transactions);
  assert.deepEqual(nextSelected.body.page, nextDefaults.body.page);
  assert.deepEqual(nextSelected.body.summary, selected.body.summary);
});

test("malformed and future trend periods are rejected before querying the database", async (t) => {
  freezeClock(t);
  const invalid = ["", null, [], ["2024-06"], {}, 202406, "2024-6", "2024-00", "2024-13", "0999-12", "10000-01", "2024-06-01", " 2024-06", "2024-06 ", "2024-06\n", "2026-11"];
  for (const trendEndMonth of invalid) {
    const result = await requestTransactions(historicalBookings(), { trendEndMonth });
    assert.equal(result.statusCode, 400, `Rejected malformed or future period: ${JSON.stringify(trendEndMonth)}`);
    assert.equal(typeof result.body.message, "string");
    assert.deepEqual(result.collectionReads, []);
  }
  const lowerYearBoundary = await requestTransactions([], { trendEndMonth: "1000-01" });
  assert.equal(lowerYearBoundary.statusCode, 200);
  assert.equal(lowerYearBoundary.body.summary.monthlyTrend.at(-1).key, "1000-01");
});

test("the current Manila month is selectable before UTC month rollover without changing UTC default cohorts", async (t) => {
  freezeClock(t, "2026-02-28T16:30:00.000Z");
  const defaults = await requestTransactions([]);
  const selected = await requestTransactions([], { trendEndMonth: "2026-03" });
  const future = await requestTransactions([], { trendEndMonth: "2026-04" });

  assert.equal(defaults.body.summary.monthlyTrend.at(-1).key, "2026-02");
  assert.equal(selected.statusCode, 200);
  assert.deepEqual(selected.body.summary.monthlyTrend.map((month) => month.key), ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
  assert.equal(future.statusCode, 400);
});

test("missing or invalid creation dates yield no history boundary and intentional empty cohorts", async (t) => {
  freezeClock(t);
  for (const records of [[], [booking(1, null), booking(2, "invalid-date")]]) {
    const result = await requestTransactions(records, { trendEndMonth: "2024-06" });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.summary.trendStartMonth, null);
    assert.equal(result.body.summary.totalRecords, records.length);
    assert.equal(result.body.summary.monthlyTrend.length, 6);
    assert.ok(result.body.summary.monthlyTrend.every((month) => month.records === 0 && month.collected === 0 && month.outstanding === 0 && month.fees === 0));
  }
});
