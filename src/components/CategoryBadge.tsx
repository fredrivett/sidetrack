// Small pill showing an item's category. Shared so the board row and the
// detail sheet render categories identically — change the look in one place.
export function CategoryBadge({
  category,
  className = "",
}: {
  category: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 ${className}`}
    >
      {category}
    </span>
  );
}
