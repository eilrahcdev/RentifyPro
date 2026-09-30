import Block from "./SkeletonBlock";

function FieldSkeleton({ className = "" }) {
  return (
    <div className={`min-w-0 space-y-2 ${className}`}>
      <Block className="h-4 w-24" />
      <Block className="h-11 w-full rounded-xl" />
    </div>
  );
}

function AuthPanelSkeleton() {
  return (
    <section className="hidden lg:flex lg:w-[44%] xl:w-[40%]">
      <div className="flex h-full w-full flex-col justify-between rounded-3xl bg-neutral-50 p-10">
        <Block className="h-10 w-28 rounded-full" />
        <div className="max-w-md space-y-4">
          <Block className="h-7 w-44 rounded-full" />
          <Block className="h-11 w-11/12" />
          <Block className="h-11 w-4/5" />
          <Block className="h-4 w-full" />
          <Block className="h-4 w-5/6" />
          <div className="space-y-3 pt-4">
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <Block className="h-4 w-4 shrink-0 !rounded-full" />
                <Block className={`h-4 ${item === 1 ? "w-3/4" : "w-5/6"}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FormHeadingSkeleton() {
  return (
    <div className="mb-6 space-y-3 text-center">
      <Block className="mx-auto h-6 w-20 rounded-full" />
      <Block className="mx-auto h-9 w-3/4 max-w-sm" />
      <Block className="mx-auto h-4 w-4/5 max-w-md" />
    </div>
  );
}

function SignInFormSkeleton() {
  return (
    <div className="space-y-4">
      <FieldSkeleton />
      <FieldSkeleton />
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-neutral-200 bg-neutral-100 p-4">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
          <Block className="h-11 w-11 shrink-0 sm:w-14" />
          <Block className="h-3 w-3 shrink-0" />
          <Block className="h-11 w-11 shrink-0 sm:w-14" />
          <Block className="h-3 w-3 shrink-0" />
          <Block className="h-11 w-14 shrink-0 sm:w-[72px]" />
        </div>
        <Block className="h-11 w-11 shrink-0 !rounded-full" />
      </div>
      <Block className="ml-auto h-4 w-32" />
      <Block className="h-12 w-full rounded-xl" />
      <Block className="mx-auto h-4 w-48 max-w-full" />
    </div>
  );
}

function ProgressSkeleton() {
  return (
    <div className="mb-7">
      <div className="flex items-center justify-between gap-4 sm:hidden">
        <Block className="h-4 w-20" />
        <Block className="h-4 w-24" />
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-neutral-300 sm:hidden" />
      <div className="hidden grid-cols-5 gap-2 sm:grid">
        {[0, 1, 2, 3, 4].map((item) => (
          <div key={item} className="relative flex min-w-0 flex-col items-center gap-2">
            {item > 0 && <span className="absolute right-[calc(50%+24px)] top-[17px] h-0.5 w-[calc(100%-48px)] bg-neutral-300" />}
            <Block className="relative h-9 w-9 !rounded-full" />
            <Block className="h-3 w-full max-w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RegistrationFormSkeleton({ owner = false }) {
  return (
    <>
      <ProgressSkeleton />
      <div className="space-y-4">
        {!owner && (
          <div className="space-y-3 rounded-2xl border border-neutral-200 bg-neutral-100 p-4">
            <Block className="h-4 w-28" />
            <Block className="h-3 w-3/4" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Block className="h-16 w-full rounded-xl" />
              <Block className="h-16 w-full rounded-xl" />
            </div>
          </div>
        )}
        <div className="space-y-2 rounded-2xl border border-neutral-200 bg-neutral-100 p-4">
          <Block className="h-5 w-40" />
          <Block className="h-4 w-5/6 max-w-md" />
        </div>
        {owner && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldSkeleton />
          <FieldSkeleton />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldSkeleton />
          <FieldSkeleton />
        </div>
        <div className="flex gap-3 pt-1">
          <Block className="h-12 min-w-0 flex-1 rounded-xl" />
          <Block className="h-12 min-w-0 flex-1 rounded-xl" />
        </div>
        <Block className="mx-auto h-4 w-52 max-w-full" />
      </div>
    </>
  );
}

function AuthShellSkeleton({ page, label }) {
  const registration = page === "register" || page === "register-owner";
  return (
    <div role="status" aria-label={label} className="relative min-h-screen overflow-hidden bg-neutral-100">
      <div aria-hidden="true" className="absolute inset-0 bg-neutral-100 lg:hidden" />
      <div aria-hidden="true" className="relative mx-auto flex min-h-screen w-full max-w-[1500px] items-stretch gap-4 p-4 sm:gap-6 sm:p-6 lg:h-[100dvh] lg:gap-8 lg:p-8">
        <AuthPanelSkeleton />
        <section className="flex min-w-0 flex-1 flex-col">
          <Block className="h-10 w-28 rounded-full lg:hidden" />
          <div className={`flex flex-1 justify-center overflow-y-auto py-2 sm:py-4 ${registration ? "items-start" : "items-center"}`}>
            <div className={`w-full pb-4 pt-4 sm:pb-6 ${registration ? "max-w-4xl" : "max-w-xl"}`}>
              <div className="min-w-0 rounded-3xl border border-neutral-200 bg-neutral-50 p-6 sm:p-8">
                <FormHeadingSkeleton />
                {registration ? <RegistrationFormSkeleton owner={page === "register-owner"} /> : <SignInFormSkeleton />}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function VerificationSkeleton({ page, label }) {
  const isCode = page === "registerotp" || page === "forgot-otp";
  const isReset = page === "reset-password";
  return (
    <div role="status" aria-label={label} className="min-h-screen bg-neutral-100">
      <div aria-hidden="true" className="mx-auto flex min-h-screen w-full max-w-[1400px]">
        <div className="hidden w-[44%] flex-col justify-between rounded-r-3xl bg-neutral-50 p-12 lg:flex">
          <div className="space-y-6"><Block className="h-8 w-32" /><Block className="h-10 w-4/5" /><Block className="h-4 w-full" /></div>
          <div className="space-y-3">{[0, 1, 2].map((item) => <Block key={item} className="h-4 w-3/4" />)}</div>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-lg rounded-3xl border border-neutral-200 bg-neutral-50 p-6 sm:p-8">
            {!isReset && <div className="mb-6 flex justify-between gap-3 rounded-2xl bg-neutral-100 p-4"><Block className="h-5 w-32" /><Block className="h-5 w-16" /></div>}
            <div className="mb-6 space-y-3 text-center"><Block className="mx-auto h-9 w-3/4" /><Block className="mx-auto h-4 w-2/3" /></div>
            {isCode ? (
              <div className="flex justify-center gap-2 sm:gap-3">{[0, 1, 2, 3, 4, 5].map((item) => <Block key={item} className="h-14 min-w-0 flex-1 rounded-xl sm:h-16" />)}</div>
            ) : isReset ? (
              <div className="space-y-4"><FieldSkeleton /><FieldSkeleton /></div>
            ) : <FieldSkeleton />}
            <div className="mt-6 grid grid-cols-2 gap-3"><Block className="h-12 w-full rounded-xl" /><Block className="h-12 w-full rounded-xl" /></div>
            <Block className="mx-auto mt-5 h-4 w-2/3" />
          </div>
        </div>
      </div>
    </div>
  );
}

function OwnerProceedSkeleton({ label }) {
  return (
    <div role="status" aria-label={label} className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <div aria-hidden="true" className="w-full max-w-5xl overflow-hidden rounded-2xl bg-neutral-50">
        <div className="flex h-16 items-center justify-between border-b border-neutral-200 px-4 sm:px-6"><Block className="h-9 w-20" /><Block className="h-7 w-28" /><span className="w-20" /></div>
        <div className="grid gap-6 p-5 sm:p-8 md:grid-cols-2 md:gap-10 lg:p-10">
          <Block className="mx-auto aspect-square w-full max-w-xs rounded-2xl" />
          <div className="space-y-4"><Block className="h-8 w-4/5" /><Block className="h-4 w-full" /><Block className="h-4 w-5/6" /><div className="space-y-3 pt-4">{[0, 1, 2].map((item) => <Block key={item} className="h-10 w-full" />)}</div><Block className="h-12 w-full" /></div>
        </div>
      </div>
    </div>
  );
}

export default function AuthRouteSkeleton({ page, label }) {
  if (["signin", "register", "register-owner"].includes(page)) return <AuthShellSkeleton page={page} label={label} />;
  if (page === "vehicle-owner-proceed") return <OwnerProceedSkeleton label={label} />;
  if (page === "vehicle-owner-verification") return (
    <div role="status" aria-label={label} className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
      <div aria-hidden="true" className="w-full max-w-md space-y-4 rounded-3xl border border-neutral-200 bg-neutral-50 p-8 text-center"><Block className="mx-auto h-8 w-40" /><Block className="mx-auto h-4 w-full" /><Block className="mx-auto h-12 w-36" /></div>
    </div>
  );
  return <VerificationSkeleton page={page} label={label} />;
}
