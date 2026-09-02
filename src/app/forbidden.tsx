export default function Forbidden() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">Not your console</h1>
        <p className="mt-3 text-neutral-600">
          You are signed in, but this area is restricted to platform administrators.
        </p>
      </div>
    </main>
  );
}
