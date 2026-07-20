import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * The bulk-delete affordance shared by the list pages: a Delete button that
 * opens a confirmation before anything is removed. Rendered inside a DataTable's
 * `bulkActions`, so it only appears while rows are selected.
 */
export function BulkDeleteButton({
  count,
  noun,
  isPending,
  onConfirm,
}: {
  count: number;
  /** Singular noun, e.g. "conversation" or "knowledge gap". */
  noun: string;
  isPending: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const plural = count === 1 ? noun : `${noun}s`;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {count} selected {plural}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected {plural} and everything belonging to them. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
                setOpen(false);
              }}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
