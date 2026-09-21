/**
 * The DigitWeb Lanka mark, on a white tile.
 *
 * The one component every place uses to show the logo, so changing it again
 * means replacing public/logo-mark.png rather than editing eight files.
 *
 * The tile is white on purpose. The mark is dark navy and light blue on a white
 * background with no transparency, so on the app's own navy header the navy
 * half would simply disappear. A white tile is what lets one asset sit correctly
 * on the navy headers and on the white pages alike.
 *
 * Only the emblem is used, not the full logo: the wordmark under it is 7 px tall
 * in the source image and cannot be read at any size the interface shows.
 */
export function BrandLogo({
  className = "h-9 w-9",
  rounded = "rounded-xl",
  label,
}: {
  /** Size and any extra utilities, e.g. "h-11 w-11 shadow-lg". */
  className?: string;
  rounded?: string;
  /** Accessible name. Leave out where the logo repeats decoratively, e.g. per chat message. */
  label?: string;
}) {
  return (
    // overflow-hidden is what keeps the corners round. The image is an opaque
    // white square sitting 7% in from each edge, while a rounded corner cuts in
    // about 8% along the diagonal — without clipping, the image's square corners
    // poke out past the curve as four small white nubs (worst on a dark header).
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-slate-900/10 ${rounded} ${className}`}
    >
      <img
        src="/logo-mark.png"
        alt={label ?? ""}
        aria-hidden={label ? undefined : true}
        draggable={false}
        className="h-[86%] w-[86%] select-none object-contain"
      />
    </span>
  );
}
