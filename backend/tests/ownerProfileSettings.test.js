import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { changePassword, updateProfile } from "../controllers/auth.controller.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

function fixture(t, overrides = {}) {
  const events = [];
  const user = {
    _id: "owner-fixture", name: "Fixture Owner", email: "owner@example.test", role: "owner",
    isVerified: true, kycStatus: "approved", ownerType: "business", businessName: "Fixture Rentals",
    permitNumber: "PERMIT-123", licenseNumber: "", phone: "9123456789",
    address: "12 Fixture Street", region: "R", province: "P", city: "C", barangay: "B",
    avatar: "uploads/avatars/avatar-existing-fixture.png",
    save: async () => { events.push("save"); },
    ...overrides,
  };
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  t.mock.method(User, "findOne", () => ({ select: async () => null }));
  const invoke = async (body) => {
    const res = response();
    await updateProfile({ user: { _id: user._id }, body, protocol: "http", get: () => "fixture.example.test" }, res);
    return res;
  };
  return { user, events, invoke };
}

test("registered owner verification fields cannot be edited at any KYC stage", async (t) => {
  const { user, events, invoke } = fixture(t);
  for (const status of ["not_started", "id_uploaded", "challenge_passed", "approved", "rejected"]) {
    user.kycStatus = status;
    for (const body of [
      { name: "Different Person" }, { firstName: "Different", lastName: "Person" }, { name: "" },
      { ownerType: "individual" }, { businessName: "Different Business" },
      { permitNumber: "" }, { licenseNumber: "DIFFERENT-LICENSE" },
    ]) {
      const res = await invoke(body);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, "OWNER_VERIFICATION_DETAILS_LOCKED");
      assert.equal(user.kycStatus, status);
      assert.equal(user.name, "Fixture Owner");
      assert.equal(user.businessName, "Fixture Rentals");
    }
  }
  assert.deepEqual(events, []);
});

test("unchanged registered fields and numberless supporting documents remain valid", async (t) => {
  const { user, invoke } = fixture(t, { permitNumber: "", licenseNumber: "" });
  const res = await invoke({ name: user.name, ownerType: "business", businessName: user.businessName, permitNumber: "", licenseNumber: "", phone: "9234567890" });
  assert.equal(res.statusCode, 200);
  assert.equal(user.phone, "9234567890");
  assert.equal(user.kycStatus, "approved");
});

test("individual owners retain editable contact details and protected identity", async (t) => {
  const { invoke } = fixture(t, { ownerType: "individual", businessName: "", permitNumber: "" });
  assert.equal((await invoke({ phone: "9234567890" })).statusCode, 200);
  assert.equal((await invoke({ name: "Another Owner" })).statusCode, 409);
});

test("owner profile updates do not change roles or KYC approval", async (t) => {
  const { user, invoke } = fixture(t);
  const res = await invoke({ phone: "9234567890", role: "admin", kycStatus: "rejected" });
  assert.equal(res.statusCode, 200);
  assert.equal(user.role, "owner");
  assert.equal(user.kycStatus, "approved");
});

test("renter profile name updates keep their existing behavior", async (t) => {
  const { user, invoke } = fixture(t, { role: "user" });
  const res = await invoke({ name: "Updated Renter" });
  assert.equal(res.statusCode, 200);
  assert.equal(user.name, "Updated Renter");
});

test("invalid and duplicate owner phone numbers are rejected without saving", async (t) => {
  const { user, events, invoke } = fixture(t);
  const invalid = await invoke({ phone: "99" });
  assert.equal(invalid.statusCode, 400);
  assert.ok(invalid.body.errors.phone);
  t.mock.method(User, "findOne", () => ({ select: async () => ({ _id: "other-fixture" }) }));
  const duplicate = await invoke({ phone: "9234567890" });
  assert.equal(duplicate.statusCode, 409);
  assert.ok(duplicate.body.errors.phone);
  assert.equal(user.phone, "9123456789");
  assert.deepEqual(events, []);
});

test("owner location validation rejects clearing required fields and oversize addresses", async (t) => {
  const { events, invoke } = fixture(t);
  for (const body of [{ address: "" }, { city: "" }, { region: "" }, { barangay: "" }, { address: "A".repeat(256) }, { address: { text: "invalid" } }]) {
    const res = await invoke(body);
    assert.equal(res.statusCode, 400);
    assert.ok(Object.keys(res.body.errors).length > 0);
  }
  assert.deepEqual(events, []);
});

test("locations without provinces can be saved without clearing KYC approval", async (t) => {
  const { user, invoke } = fixture(t);
  const res = await invoke({ address: "12 Fixture Street, Direct City", region: "N", province: "", city: "NC", barangay: "NB" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.province, "");
  assert.equal(user.kycStatus, "approved");
});

test("invalid avatar data does not delete the previous photo", async (t) => {
  const { events, invoke } = fixture(t);
  t.mock.method(fs, "unlink", async () => { events.push("unlink"); });
  const res = await invoke({ avatar: "data:image/png;base64," + Buffer.from("not an image").toString("base64") });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(events, []);
});

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
function mockPhotoStorage(t, events) {
  t.mock.method(fs, "mkdir", async () => { events.push("mkdir"); });
  t.mock.method(fs, "writeFile", async () => { events.push("write"); });
  t.mock.method(fs, "unlink", async (file) => { events.push(`unlink:${path.basename(file)}`); });
}

test("a replacement photo is written and saved before the old photo is deleted", async (t) => {
  const { events, invoke } = fixture(t);
  mockPhotoStorage(t, events);
  const res = await invoke({ avatar: png });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(events, ["mkdir", "write", "save", "unlink:avatar-existing-fixture.png"]);
  assert.ok(res.body.user.avatar.includes("uploads/avatars/avatar-"));
});

test("database failure removes the staged replacement and keeps the old photo", async (t) => {
  const { events, invoke } = fixture(t, { save: async () => { events.push("save-failed"); throw new Error("Simulated save failure"); } });
  mockPhotoStorage(t, events);
  const res = await invoke({ avatar: png });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(events.slice(0, 3), ["mkdir", "write", "save-failed"]);
  assert.equal(events.length, 4);
  assert.match(events[3], /^unlink:avatar-/);
  assert.notEqual(events[3], "unlink:avatar-existing-fixture.png");
});

test("photo removal deletes the old file only after a successful database save", async (t) => {
  const { events, invoke } = fixture(t);
  mockPhotoStorage(t, events);
  const res = await invoke({ avatar: "" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(events, ["save", "unlink:avatar-existing-fixture.png"]);
});

test("failed photo removal preserves the existing file", async (t) => {
  const { events, invoke } = fixture(t, { save: async () => { throw new Error("Simulated save failure"); } });
  mockPhotoStorage(t, events);
  assert.equal((await invoke({ avatar: "" })).statusCode, 500);
  assert.deepEqual(events, []);
});

test("submitting the current managed avatar URL does not delete its file", async (t) => {
  const { user, events, invoke } = fixture(t);
  mockPhotoStorage(t, events);
  assert.equal((await invoke({ avatar: user.avatar })).statusCode, 200);
  assert.deepEqual(events, ["save"]);
});

test("incorrect current password is a field error and retains the authenticated session", async (t) => {
  const { user } = fixture(t, { password: "fixture-password-hash" });
  t.mock.method(bcrypt, "compare", async () => false);
  const res = response();
  await changePassword({ user, body: { currentPassword: "WrongPassword1!", newPassword: "NewPassword1!" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "CURRENT_PASSWORD_INCORRECT");
  assert.ok(res.body.errors.currentPassword);
});
