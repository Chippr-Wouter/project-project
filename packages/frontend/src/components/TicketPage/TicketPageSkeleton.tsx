export function TicketPageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex h-9 items-center gap-1.5 px-2">
          <div className="skeleton size-4 rounded bg-muted/60" />
          <div className="skeleton h-3 w-8 rounded bg-muted/60" />
        </div>
      </div>
      <header className="flex items-start gap-3">
        <div className="skeleton -mt-1 size-10 shrink-0 rounded-lg bg-muted/60" />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <div className="skeleton h-8 w-1/2 rounded bg-muted/60" />
          <div className="flex items-center gap-2">
            <div className="skeleton h-4 w-12 rounded bg-muted/60" />
            <div className="skeleton h-6 w-20 rounded-md bg-muted/60" />
          </div>
        </div>
      </header>
      <div className="h-px bg-border/60" />
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <div className="rounded-lg border border-transparent px-3 py-2">
            <div className="skeleton min-h-[8rem] rounded-lg bg-muted/60" />
          </div>
          <div className="mt-8 space-y-4">
            <div className="flex h-7 items-center gap-2">
              <div className="skeleton size-4 rounded bg-muted/60" />
              <div className="skeleton h-4 w-28 rounded bg-muted/60" />
            </div>
            <div className="rounded-md border border-border px-3 py-1.5">
              <div className="skeleton min-h-[1.5rem] rounded bg-muted/60" />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-5 lg:border-l lg:border-border/60 lg:pl-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="skeleton h-4 w-14 rounded bg-muted/60" />
              <div className="skeleton h-6 w-24 rounded bg-muted/60" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
