<<<<<<< HEAD
import { useEffect, useMemo, useState } from "react";
import { CarFront, ImagePlus, Settings2, UploadCloud, X } from "lucide-react";
import API from "../../utils/api";
=======
<<<<<<< HEAD
import React, { useEffect, useMemo, useState } from "react";
>>>>>>> 8422a2f (fixed bugs and updates)

const initialForm = {
  name: "",
  description: "",
  dailyRentalRate: "",
  location: "",
  availabilityStatus: "available",
  specType: "car",
  specSubType: "",
  specSeats: 4,
  specTransmission: "Automatic",
  specFuel: "Gasoline",
  specPlateNumber: "",
  driverOptionEnabled: false,
  driverDailyRate: "",
  existingImages: [],
  existingImagePaths: [],
  newImageFiles: [],
};

const formatCurrency = (value) => `\u20b1${Number(value || 0).toLocaleString("en-PH")}`;

function VehicleModal({ mode, form, setForm, loading, error, onClose, onSubmit }) {
  const newImagePreviews = useMemo(
    () =>
      form.newImageFiles.map((file) => ({
        key: `${file.name}-${file.lastModified}`,
        name: file.name,
        url: URL.createObjectURL(file),
      })),
    [form.newImageFiles]
  );

  useEffect(() => {
    return () => {
      newImagePreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [newImagePreviews]);

  const inputClass =
    "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:border-[#017FE6] focus:outline-none focus:ring-4 focus:ring-blue-100";
  const selectClass =
    "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 shadow-sm transition focus:border-[#017FE6] focus:outline-none focus:ring-4 focus:ring-blue-100";
  const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
        <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.35)]">
          <div className="border-b border-slate-200 bg-gradient-to-r from-[#eef6ff] via-white to-[#f7fbff] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#017FE6] text-white shadow-sm">
                  <CarFront size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {mode === "edit" ? "Edit Vehicle" : "Add Vehicle"}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-600">
                    Complete the details below to publish your listing with a premium look.
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto bg-slate-50/40 px-6 py-6">
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <CarFront size={16} className="text-[#017FE6]" />
                Basic Details
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass}>Vehicle Name</label>
                  <input
                    className={inputClass}
                    placeholder="Ex. Honda Civic RS"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Location</label>
                  <input
                    className={inputClass}
                    placeholder="Ex. Quezon City"
                    value={form.location}
                    onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Description</label>
                <textarea
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:border-[#017FE6] focus:outline-none focus:ring-4 focus:ring-blue-100"
                  rows={3}
                  placeholder="Describe the vehicle condition, notable features, and renter expectations."
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>

<<<<<<< HEAD
=======
=======
import { useEffect, useMemo, useState } from "react";
import { CarFront, ImagePlus, Settings2, UploadCloud, X } from "lucide-react";
import API from "../../utils/api";

const initialForm = {
  name: "",
  description: "",
  dailyRentalRate: "",
  location: "",
  availabilityStatus: "available",
  specType: "car",
  specSubType: "",
  specSeats: 4,
  specTransmission: "Automatic",
  specFuel: "Gasoline",
  specPlateNumber: "",
  driverOptionEnabled: false,
  driverDailyRate: "",
  existingImages: [],
  existingImagePaths: [],
  newImageFiles: [],
};

const formatCurrency = (value) => `\u20b1${Number(value || 0).toLocaleString("en-PH")}`;

function VehicleModal({ mode, form, setForm, loading, error, onClose, onSubmit }) {
  const newImagePreviews = useMemo(
    () =>
      form.newImageFiles.map((file) => ({
        key: `${file.name}-${file.lastModified}`,
        name: file.name,
        url: URL.createObjectURL(file),
      })),
    [form.newImageFiles]
  );

  useEffect(() => {
    return () => {
      newImagePreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [newImagePreviews]);

  const inputClass =
    "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:border-[#017FE6] focus:outline-none focus:ring-4 focus:ring-blue-100";
  const selectClass =
    "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 shadow-sm transition focus:border-[#017FE6] focus:outline-none focus:ring-4 focus:ring-blue-100";
  const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
        <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.35)]">
          <div className="border-b border-slate-200 bg-gradient-to-r from-[#eef6ff] via-white to-[#f7fbff] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#017FE6] text-white shadow-sm">
                  <CarFront size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {mode === "edit" ? "Edit Vehicle" : "Add Vehicle"}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-600">
                    Complete the details below to publish your listing with a premium look.
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto bg-slate-50/40 px-6 py-6">
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <CarFront size={16} className="text-[#017FE6]" />
                Basic Details
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass}>Vehicle Name</label>
                  <input
                    className={inputClass}
                    placeholder="Ex. Honda Civic RS"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Location</label>
                  <input
                    className={inputClass}
                    placeholder="Ex. Quezon City"
                    value={form.location}
                    onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Description</label>
                <textarea
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:border-[#017FE6] focus:outline-none focus:ring-4 focus:ring-blue-100"
                  rows={3}
                  placeholder="Describe the vehicle condition, notable features, and renter expectations."
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>

>>>>>>> 8422a2f (fixed bugs and updates)
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className={labelClass}>Daily Rate</label>
                  <input
                    type="number"
                    min="0"
                    className={inputClass}
                    placeholder="0"
                    value={form.dailyRentalRate}
                    onChange={(e) => setForm((prev) => ({ ...prev, dailyRentalRate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Availability</label>
                  <select
                    className={selectClass}
                    value={form.availabilityStatus}
                    onChange={(e) => setForm((prev) => ({ ...prev, availabilityStatus: e.target.value }))}
                  >
                    <option value="available">Available</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Plate Number</label>
                  <input
                    className={inputClass}
                    placeholder="Ex. ABC-1234"
                    value={form.specPlateNumber}
                    onChange={(e) => setForm((prev) => ({ ...prev, specPlateNumber: e.target.value }))}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Settings2 size={16} className="text-[#017FE6]" />
                Vehicle Specifications
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <div>
                  <label className={labelClass}>Type</label>
                  <select
                    className={selectClass}
                    value={form.specType}
                    onChange={(e) => setForm((prev) => ({ ...prev, specType: e.target.value }))}
                  >
                    <option value="car">Car</option>
                    <option value="motorcycle">Motorcycle</option>
                    <option value="van">Van</option>
                    <option value="truck">Truck</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Sub-type</label>
                  <input
                    className={inputClass}
                    placeholder="Ex. Sedan"
                    value={form.specSubType}
                    onChange={(e) => setForm((prev) => ({ ...prev, specSubType: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Seats</label>
                  <input
                    type="number"
                    min="1"
                    className={inputClass}
                    placeholder="4"
                    value={form.specSeats}
                    onChange={(e) => setForm((prev) => ({ ...prev, specSeats: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Transmission</label>
                  <select
                    className={selectClass}
                    value={form.specTransmission}
                    onChange={(e) => setForm((prev) => ({ ...prev, specTransmission: e.target.value }))}
                  >
                    <option>Automatic</option>
                    <option>Manual</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Fuel</label>
                  <select
                    className={selectClass}
                    value={form.specFuel}
                    onChange={(e) => setForm((prev) => ({ ...prev, specFuel: e.target.value }))}
                  >
                    <option>Gasoline</option>
                    <option>Diesel</option>
                    <option>Electric</option>
                    <option>Hybrid</option>
                  </select>
                </div>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Settings2 size={16} className="text-[#017FE6]" />
                Driver Option
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
<<<<<<< HEAD
                      driverOptionEnabled: true,
=======
<<<<<<< HEAD
                      interiorImages: prev.interiorImages.filter((_, x) => x !== i),
>>>>>>> 8422a2f (fixed bugs and updates)
                    }))
                  }
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    form.driverOptionEnabled
                      ? "border-[#017FE6] bg-blue-50 text-blue-700 ring-2 ring-blue-100"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:border-[#017FE6]"
                  }`}
                >
                  <p className="text-sm font-semibold">With driver</p>
                  <p className="mt-0.5 text-xs text-slate-500">Driver service enabled for this vehicle.</p>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      driverOptionEnabled: false,
                      driverDailyRate: "",
                    }))
                  }
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    !form.driverOptionEnabled
                      ? "border-[#017FE6] bg-blue-50 text-blue-700 ring-2 ring-blue-100"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:border-[#017FE6]"
                  }`}
                >
                  <p className="text-sm font-semibold">Without driver</p>
                  <p className="mt-0.5 text-xs text-slate-500">Self-drive only for this vehicle.</p>
                </button>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <ImagePlus size={16} className="text-[#017FE6]" />
                  Vehicle Images
                </div>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                  Up to 8 photos
                </span>
              </div>

              <label className="group flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 transition hover:border-[#017FE6] hover:bg-blue-50/40">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[#017FE6] shadow-sm ring-1 ring-slate-200">
                    <UploadCloud size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Upload vehicle photos</p>
                    <p className="text-xs text-slate-500">PNG, JPG, or WEBP format</p>
                  </div>
                </div>
                <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                  Choose Files
                </span>
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const selected = Array.from(e.target.files || []);
                    if (!selected.length) return;
                    setForm((prev) => ({
                      ...prev,
                      newImageFiles: [...prev.newImageFiles, ...selected].slice(0, 8),
                    }));
                  }}
                />
              </label>

              {form.newImageFiles.length > 0 && (
                <p className="text-xs text-slate-500">
                  {form.newImageFiles.length} new image(s) selected
                </p>
              )}

              {(form.existingImages.length > 0 || newImagePreviews.length > 0) && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {form.existingImages.map((image, index) => (
                    <div key={`existing-${index}`} className="group relative overflow-hidden rounded-xl border border-slate-200">
                      <img src={image} alt="vehicle" className="h-24 w-full object-cover" />
                      <button
                        type="button"
                        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-slate-700 shadow transition hover:bg-red-500 hover:text-white"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            existingImages: prev.existingImages.filter((_, idx) => idx !== index),
                            existingImagePaths: prev.existingImagePaths.filter((_, idx) => idx !== index),
                          }))
                        }
                        aria-label="Remove existing image"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}

                  {newImagePreviews.map((preview, index) => (
                    <div key={preview.key} className="group relative overflow-hidden rounded-xl border border-slate-200">
                      <img src={preview.url} alt={preview.name} className="h-24 w-full object-cover" />
                      <button
                        type="button"
                        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-slate-700 shadow transition hover:bg-red-500 hover:text-white"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            newImageFiles: prev.newImageFiles.filter((_, idx) => idx !== index),
                          }))
                        }
                        aria-label="Remove new image"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
            <button
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={loading}
              className="rounded-xl bg-[#017FE6] px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(1,127,230,0.35)] transition hover:bg-[#016fc8] disabled:opacity-70"
            >
<<<<<<< HEAD
              {loading ? "Saving..." : mode === "edit" ? "Save Changes" : "Add Vehicle"}
=======
              Add Vehicle
=======
                      driverOptionEnabled: true,
                    }))
                  }
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    form.driverOptionEnabled
                      ? "border-[#017FE6] bg-blue-50 text-blue-700 ring-2 ring-blue-100"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:border-[#017FE6]"
                  }`}
                >
                  <p className="text-sm font-semibold">With driver</p>
                  <p className="mt-0.5 text-xs text-slate-500">Driver service enabled for this vehicle.</p>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      driverOptionEnabled: false,
                      driverDailyRate: "",
                    }))
                  }
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    !form.driverOptionEnabled
                      ? "border-[#017FE6] bg-blue-50 text-blue-700 ring-2 ring-blue-100"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:border-[#017FE6]"
                  }`}
                >
                  <p className="text-sm font-semibold">Without driver</p>
                  <p className="mt-0.5 text-xs text-slate-500">Self-drive only for this vehicle.</p>
                </button>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <ImagePlus size={16} className="text-[#017FE6]" />
                  Vehicle Images
                </div>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                  Up to 8 photos
                </span>
              </div>

              <label className="group flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 transition hover:border-[#017FE6] hover:bg-blue-50/40">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[#017FE6] shadow-sm ring-1 ring-slate-200">
                    <UploadCloud size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Upload vehicle photos</p>
                    <p className="text-xs text-slate-500">PNG, JPG, or WEBP format</p>
                  </div>
                </div>
                <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                  Choose Files
                </span>
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const selected = Array.from(e.target.files || []);
                    if (!selected.length) return;
                    setForm((prev) => ({
                      ...prev,
                      newImageFiles: [...prev.newImageFiles, ...selected].slice(0, 8),
                    }));
                  }}
                />
              </label>

              {form.newImageFiles.length > 0 && (
                <p className="text-xs text-slate-500">
                  {form.newImageFiles.length} new image(s) selected
                </p>
              )}

              {(form.existingImages.length > 0 || newImagePreviews.length > 0) && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {form.existingImages.map((image, index) => (
                    <div key={`existing-${index}`} className="group relative overflow-hidden rounded-xl border border-slate-200">
                      <img src={image} alt="vehicle" className="h-24 w-full object-cover" />
                      <button
                        type="button"
                        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-slate-700 shadow transition hover:bg-red-500 hover:text-white"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            existingImages: prev.existingImages.filter((_, idx) => idx !== index),
                            existingImagePaths: prev.existingImagePaths.filter((_, idx) => idx !== index),
                          }))
                        }
                        aria-label="Remove existing image"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}

                  {newImagePreviews.map((preview, index) => (
                    <div key={preview.key} className="group relative overflow-hidden rounded-xl border border-slate-200">
                      <img src={preview.url} alt={preview.name} className="h-24 w-full object-cover" />
                      <button
                        type="button"
                        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-slate-700 shadow transition hover:bg-red-500 hover:text-white"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            newImageFiles: prev.newImageFiles.filter((_, idx) => idx !== index),
                          }))
                        }
                        aria-label="Remove new image"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
            <button
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={loading}
              className="rounded-xl bg-[#017FE6] px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(1,127,230,0.35)] transition hover:bg-[#016fc8] disabled:opacity-70"
            >
              {loading ? "Saving..." : mode === "edit" ? "Save Changes" : "Add Vehicle"}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
            </button>
          </div>
        </div>
      </div>
    </>
  );
<<<<<<< HEAD
=======
<<<<<<< HEAD
 }
=======
>>>>>>> 8422a2f (fixed bugs and updates)
}

export default function Vehicles() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [modalError, setModalError] = useState("");
  const [modalLoading, setModalLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(initialForm);

  const loadVehicles = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await API.getOwnerVehicles();
      setVehicles(response.vehicles || []);
    } catch (err) {
      setError(err.message || "Failed to load vehicles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVehicles();
  }, []);

  useEffect(() => {
    const openAdd = () => {
      setModalMode("create");
      setEditingId(null);
      setForm(initialForm);
      setModalError("");
      setModalOpen(true);
    };
    window.addEventListener("open-add-vehicle", openAdd);
    return () => window.removeEventListener("open-add-vehicle", openAdd);
  }, []);

  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const matchesSearch =
        !query ||
        vehicle.name?.toLowerCase().includes(query) ||
        vehicle.location?.toLowerCase().includes(query) ||
        vehicle.specs?.plateNumber?.toLowerCase().includes(query);

      const matchesStatus = statusFilter === "all" || vehicle.availabilityStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [vehicles, search, statusFilter]);

  const openCreateModal = () => {
    setModalMode("create");
    setEditingId(null);
    setForm(initialForm);
    setModalError("");
    setModalOpen(true);
  };

  const openEditModal = (vehicle) => {
    setModalMode("edit");
    setEditingId(vehicle._id);
    setForm({
      name: vehicle.name || "",
      description: vehicle.description || "",
      dailyRentalRate: String(vehicle.dailyRentalRate ?? ""),
      location: vehicle.location || "",
      availabilityStatus: vehicle.availabilityStatus || "available",
      specType: vehicle.specs?.type || "car",
      specSubType: vehicle.specs?.subType || "",
      specSeats: String(vehicle.specs?.seats ?? 4),
      specTransmission: vehicle.specs?.transmission || "Automatic",
      specFuel: vehicle.specs?.fuel || "Gasoline",
      specPlateNumber: vehicle.specs?.plateNumber || "",
      driverOptionEnabled: Boolean(vehicle.driverOptionEnabled),
      driverDailyRate: vehicle.driverOptionEnabled ? String(vehicle.driverDailyRate || "") : "",
      existingImages: vehicle.images || [],
      existingImagePaths: vehicle.imagePaths || vehicle.images || [],
      newImageFiles: [],
    });
    setModalError("");
    setModalOpen(true);
  };

  const buildFormData = () => {
    const body = new FormData();
    body.append("name", form.name);
    body.append("description", form.description);
    body.append("dailyRentalRate", String(form.dailyRentalRate));
    body.append("location", form.location);
    body.append("availabilityStatus", form.availabilityStatus);
    body.append("specType", form.specType);
    body.append("specSubType", form.specSubType);
    body.append("specSeats", String(form.specSeats));
    body.append("specTransmission", form.specTransmission);
    body.append("specFuel", form.specFuel);
    body.append("specPlateNumber", form.specPlateNumber);
    body.append("driverOptionEnabled", String(form.driverOptionEnabled));
    body.append("driverDailyRate", String(form.driverDailyRate || 0));
    body.append("existingImages", JSON.stringify(form.existingImagePaths || []));

    form.newImageFiles.forEach((file) => body.append("images", file));
    return body;
  };

  const submitModal = async () => {
    setModalLoading(true);
    setModalError("");
    try {
      if (modalMode === "create") {
        await API.createOwnerVehicle(buildFormData());
      } else {
        await API.updateOwnerVehicle(editingId, buildFormData());
      }
      setModalOpen(false);
      await loadVehicles();
    } catch (err) {
      setModalError(err.message || "Failed to save vehicle.");
    } finally {
      setModalLoading(false);
    }
  };

  const toggleAvailability = async (vehicle) => {
    const nextStatus = vehicle.availabilityStatus === "available" ? "unavailable" : "available";
    try {
      await API.setOwnerVehicleAvailability(vehicle._id, nextStatus);
      setVehicles((prev) =>
        prev.map((item) => (item._id === vehicle._id ? { ...item, availabilityStatus: nextStatus } : item))
      );
    } catch (err) {
      setError(err.message || "Failed to update availability.");
    }
  };

  const deleteVehicle = async (vehicleId) => {
    if (!window.confirm("Delete this vehicle?")) return;
    try {
      await API.deleteOwnerVehicle(vehicleId);
      setVehicles((prev) => prev.filter((vehicle) => vehicle._id !== vehicleId));
    } catch (err) {
      setError(err.message || "Failed to delete vehicle.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vehicle Management</h1>
          <p className="text-sm text-gray-600">
            Manage vehicle details, multiple images, availability, and driver options.
          </p>
        </div>
        <button onClick={openCreateModal} className="px-4 py-2 rounded-lg bg-[#017FE6] text-white font-semibold">
          Add Vehicle
        </button>
      </div>

      <div className="bg-white border rounded-xl p-4 flex flex-col md:flex-row gap-3">
        <input
          className="flex-1 rounded-lg border px-3 py-2"
          placeholder="Search by name, location, or plate number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded-lg border px-3 py-2"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Vehicles</option>
          <option value="available">Available</option>
          <option value="unavailable">Unavailable</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-gray-600">Loading vehicles...</p>}

      {!loading && filteredVehicles.length === 0 && (
        <div className="bg-white border rounded-xl p-6 text-sm text-gray-600">
          No vehicles found.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredVehicles.map((vehicle) => (
          <div key={vehicle._id} className="bg-white border rounded-xl overflow-hidden">
            <div className="h-44 bg-gray-100 flex items-center justify-center">
              {vehicle.imageUrl ? (
                <img src={vehicle.imageUrl} alt={vehicle.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm text-gray-500">No image</span>
              )}
            </div>
            <div className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-gray-900">{vehicle.name}</h3>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    vehicle.availabilityStatus === "available"
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-200 text-gray-700"
                  }`}
                >
                  {vehicle.availabilityStatus}
                </span>
              </div>

              <p className="text-sm text-gray-600 line-clamp-2">{vehicle.description}</p>
              <p className="text-sm text-gray-700">{vehicle.location}</p>
              <p className="text-sm text-gray-600">
                {vehicle.specs?.type || "vehicle"} {vehicle.specs?.subType ? `• ${vehicle.specs.subType}` : ""}
              </p>
              <p className="text-sm text-gray-600">
                Seats: {vehicle.specs?.seats || "-"} • {vehicle.specs?.transmission || "-"} • {vehicle.specs?.fuel || "-"}
              </p>
              <p className="text-sm text-gray-600">Plate: {vehicle.specs?.plateNumber || "-"}</p>

              <p className="font-bold text-[#017FE6]">{formatCurrency(vehicle.dailyRentalRate)} / day</p>
              <p className="text-sm text-blue-700">
                Driver option: {vehicle.driverOptionEnabled ? "With driver" : "Without driver"}
              </p>

              <p className="text-xs text-gray-500">{(vehicle.images || []).length} image(s)</p>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <button onClick={() => openEditModal(vehicle)} className="px-2 py-2 rounded-lg border text-sm">
                  Edit
                </button>
                <button
                  onClick={() => toggleAvailability(vehicle)}
                  className="px-2 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm"
                >
                  Toggle
                </button>
                <button
                  onClick={() => deleteVehicle(vehicle._id)}
                  className="px-2 py-2 rounded-lg bg-red-50 text-red-700 text-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && (
        <VehicleModal
          mode={modalMode}
          form={form}
          setForm={setForm}
          loading={modalLoading}
          error={modalError}
          onClose={() => setModalOpen(false)}
          onSubmit={submitModal}
        />
      )}
    </div>
  );
}
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
