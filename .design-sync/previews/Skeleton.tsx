import { Skeleton } from 'coresense';

// Dark "Field Console" surface, sized like a list panel while contacts load.
function Surface({ children }) {
  return (
    <div className="w-72 rounded-lg border border-cs-border bg-cs-bg-2 p-4 text-cs-text">{children}</div>
  );
}

export function ContactRow() {
  return (
    <Surface>
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </Surface>
  );
}

export function ContactList() {
  return (
    <Surface>
      <div className="flex flex-col gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="size-2 rounded-full" />
          </div>
        ))}
      </div>
    </Surface>
  );
}

export function MessageThread() {
  return (
    <Surface>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-44" />
        <Skeleton className="h-3 w-52" />
        <Skeleton className="h-3 w-28" />
        <div className="self-end">
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="self-end">
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </Surface>
  );
}
